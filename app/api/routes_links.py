from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AwareDatetime, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, rate_limit
from app.models import ApiKey, ClickRollupDaily, ClickRollupHourly, Link
from app.schemas.links import (
    AliasCheck,
    BulkIn,
    BulkOut,
    BulkResult,
    LinkCreate,
    LinkOut,
    StatsOut,
    StatsPoint,
)
from app.services.codegen import generate_code, is_valid_alias

router = APIRouter(prefix="/api/v1/links", tags=["links"])
aliases = APIRouter(prefix="/api/v1/aliases", tags=["links"])

MAX_CODE_RETRIES = 5


def _to_out(link: Link, base_url: str) -> LinkOut:
    return LinkOut(
        short_code=link.short_code,
        short_url=f"{base_url.rstrip('/')}/{link.short_code}",
        long_url=link.long_url,
        is_active=link.is_active,
        expires_at=link.expires_at,
        created_at=link.created_at,
    )


class AliasTaken(Exception):
    pass


async def _insert_link(session: AsyncSession, api_key: ApiKey, body: LinkCreate) -> Link:
    """Insert one link: the custom alias as given, or a random code with retry on collision."""
    attempts = 1 if body.custom_alias else MAX_CODE_RETRIES
    for _ in range(attempts):
        link = Link(
            short_code=body.custom_alias or generate_code(), long_url=body.long_url,
            api_key_id=api_key.id, expires_at=body.expires_at,
        )
        session.add(link)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            continue
        await session.refresh(link)  # load server-generated created_at
        return link
    if body.custom_alias:
        raise AliasTaken(body.custom_alias)
    raise RuntimeError("could not allocate a short code")


async def _create(request: Request, session: AsyncSession, api_key: ApiKey, body: LinkCreate) -> LinkOut:
    try:
        link = await _insert_link(session, api_key, body)
    except AliasTaken:
        raise HTTPException(status_code=409, detail="alias already taken")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    # warm the cache and drop any negative entry a previous miss left behind
    await request.app.state.link_cache.publish(link.short_code, link.long_url, link.expires_at)
    return _to_out(link, request.app.state.settings.base_url)


@router.post("", status_code=201, response_model=LinkOut)
async def create_link(
    body: LinkCreate,
    request: Request,
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    return await _create(request, session, api_key, body)


@router.post("/bulk", response_model=BulkOut)
async def create_links_bulk(
    body: BulkIn,
    request: Request,
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    """Create up to 50 links in one call. Each row succeeds or fails on its own,
    so one bad URL in a pasted CSV doesn't throw away the other 49."""
    results: list[BulkResult] = []
    for i, raw in enumerate(body.links):
        try:
            item = LinkCreate.model_validate(raw)
        except ValidationError as exc:
            msg = exc.errors()[0]["msg"].removeprefix("Value error, ")
            results.append(BulkResult(index=i, ok=False, error=msg))
            continue
        try:
            out = await _create(request, session, api_key, item)
        except HTTPException as exc:
            results.append(BulkResult(index=i, ok=False, error=str(exc.detail)))
            continue
        results.append(BulkResult(index=i, ok=True, link=out))
    return BulkOut(
        created=sum(r.ok for r in results), failed=sum(not r.ok for r in results), results=results
    )


@router.get("", response_model=list[LinkOut])
async def list_links(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    # MVP: limit/offset pagination. Keyset pagination is a documented stretch.
    rows = (
        await session.execute(
            select(Link)
            .where(Link.api_key_id == api_key.id)
            .order_by(Link.created_at.desc(), Link.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return [_to_out(r, request.app.state.settings.base_url) for r in rows]


async def _owned_link(session: AsyncSession, api_key: ApiKey, code: str) -> Link:
    row = (
        await session.execute(
            select(Link).where(Link.short_code == code, Link.api_key_id == api_key.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="link not found")
    return row


@router.get("/{code}", response_model=LinkOut)
async def get_link(
    code: str,
    request: Request,
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    link = await _owned_link(session, api_key, code)
    return _to_out(link, request.app.state.settings.base_url)


@router.delete("/{code}", status_code=204)
async def delete_link(
    code: str,
    request: Request,
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    link = await _owned_link(session, api_key, code)
    link.is_active = False
    await session.commit()
    await request.app.state.link_cache.tombstone(code)


@router.get("/{code}/stats", response_model=StatsOut)
async def link_stats(
    code: str,
    granularity: str = Query(default="hour", pattern="^(hour|day)$"),
    frm: AwareDatetime | None = Query(default=None, alias="from"),  # naive = ambiguous -> 422
    to: AwareDatetime | None = Query(default=None),
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    link = await _owned_link(session, api_key, code)
    now = datetime.now(timezone.utc)
    if to is None:
        to = now
    if frm is None:
        frm = now - (timedelta(hours=24) if granularity == "hour" else timedelta(days=30))
    async def buckets(table, start, end):
        return (
            await session.execute(
                select(table.bucket_start, table.clicks)
                .where(table.link_id == link.id, table.bucket_start >= start, table.bucket_start < end)
                .order_by(table.bucket_start)
            )
        ).all()

    if granularity == "hour":
        rows = await buckets(ClickRollupHourly, frm, to)
    else:
        # The daily table is filled by the hourly rollup job, so today and
        # yesterday may lag by up to an hour. Those days are summed from the
        # hourly rollups (at most 48 rows); older days come from the daily table.
        fresh_from = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        rows = list(await buckets(ClickRollupDaily, frm, min(to, fresh_from)))
        recent: dict[datetime, int] = {}
        for b, c in await buckets(ClickRollupHourly, max(frm, fresh_from), to):
            day = (b if b.tzinfo else b.replace(tzinfo=timezone.utc)).replace(hour=0, minute=0, second=0, microsecond=0)
            recent[day] = recent.get(day, 0) + c
        rows += sorted(recent.items())
    series = [StatsPoint(bucket_start=b, clicks=c) for b, c in rows]
    return StatsOut(
        short_code=code,
        granularity=granularity,
        total_clicks=sum(p.clicks for p in series),
        series=series,
    )


@aliases.get("/{alias}", response_model=AliasCheck)
async def check_alias(
    alias: str,
    api_key: ApiKey = Depends(rate_limit),
    session: AsyncSession = Depends(get_session),
):
    """Is this custom alias usable? Powers the live check in the create form."""
    if not is_valid_alias(alias):
        return AliasCheck(alias=alias, available=False, reason="3-32 letters, digits, - or _; not reserved")
    taken = (
        await session.execute(select(Link.id).where(Link.short_code == alias))
    ).scalar_one_or_none()
    if taken is not None:
        return AliasCheck(alias=alias, available=False, reason="already taken")
    return AliasCheck(alias=alias, available=True)
