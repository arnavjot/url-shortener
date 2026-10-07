"""The redirect hot path.

Cache hit: 1 Redis GET + 1 background XADD, no DB session at all.
Cache miss: per-IP token bucket, then a single point-read on the unique
short_code index, then cache fill.
/{code}+ resolves the same way but renders a preview page instead of redirecting.
302 (not 301) so browsers/CDNs don't cache us out of our own analytics;
Cache-Control bounds the load tradeoff.
"""
from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from redis.exceptions import RedisError
from sqlalchemy import select

from app.core.events import emit_click
from app.models import Link
from app.observability.metrics import CACHE_OPS
from app.services.codegen import is_valid_alias

router = APIRouter(tags=["redirect"])


async def _resolve(request: Request, code: str) -> str:
    """code -> destination URL via cache, falling back to one DB point-read.
    Raises 404 for unknown/expired/deleted codes, 429 for scanners."""
    if not is_valid_alias(code):
        raise HTTPException(status_code=404)
    app = request.app
    cache = app.state.link_cache
    settings = app.state.settings

    url, negative = await cache.lookup(code)
    if negative:  # checked first: wins over a stale positive entry (see LinkCache.lookup)
        CACHE_OPS.labels(result="negative").inc()
        raise HTTPException(status_code=404)
    if url is not None:
        CACHE_OPS.labels(result="hit").inc()
        return url

    CACHE_OPS.labels(result="miss").inc()
    # misses are what cost a DB read (+ a negative key): cap them per client IP
    # so random-code scans can't hammer PostgreSQL. Hits stay one Redis call.
    # Behind a proxy, run uvicorn with --proxy-headers so client.host is real.
    ip = request.client.host if request.client else "unknown"
    try:
        d = await app.state.rate_limiter.take(
            f"ip:{ip}", settings.redirect_miss_capacity, settings.redirect_miss_refill_per_s
        )
    except RedisError:
        d = None  # fail open: redirects are reads (same policy as api/deps.py)
    if d is not None and not d.allowed:
        raise HTTPException(status_code=429, headers={"Retry-After": str(d.retry_after_s)})
    async with app.state.sessionmaker() as session:
        row = (
            await session.execute(select(Link).where(Link.short_code == code))
        ).scalar_one_or_none()
    if row is None or not row.is_redirectable(datetime.now(timezone.utc)):
        await cache.set_negative_if_uncached(code)
        raise HTTPException(status_code=404)
    await cache.set_url(code, row.long_url, expires_at=row.expires_at)
    return row.long_url


# registered before /{code}: '+' can't appear in a code, so there's no overlap
@router.get("/{code}+", response_class=HTMLResponse)
async def preview(request: Request, code: str):
    """Show where a short link goes without following it (and without counting a click)."""
    url = await _resolve(request, code)
    return HTMLResponse(
        PREVIEW_HTML.format(code=escape(code), url=escape(url, quote=True)),
        headers={"Cache-Control": "private, max-age=90", "X-Robots-Tag": "noindex"},
    )


@router.get("/{code}")
async def redirect(request: Request, background: BackgroundTasks, code: str):
    # validation happens in _resolve, not via Path(...): malformed codes
    # (favicon.ico, scanner probes) get a plain 404 rather than a 422
    url = await _resolve(request, code)
    # privacy by design: the event is code + timestamp only, no IP/UA/referrer
    background.add_task(emit_click, request.app.state.redis, request.app.state.settings, code)
    return RedirectResponse(
        url, status_code=302, headers={"Cache-Control": "private, max-age=90"}
    )


PREVIEW_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link preview</title>
<style>
  :root {{ color-scheme: light dark; --bg:#f6f7fb; --card:#fff; --fg:#111827;
          --muted:#6b7280; --accent:#4f46e5; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#0b0d14; --card:#151925; --fg:#e5e7eb;
          --muted:#9ca3af; --accent:#818cf8; }} }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; padding:16px; box-sizing:border-box; }}
  .card {{ background:var(--card); border-radius:16px; padding:28px; max-width:560px; width:100%;
          box-shadow:0 10px 30px rgba(0,0,0,.08); }}
  .label {{ color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.06em; }}
  .url {{ word-break:break-all; font-family:ui-monospace, monospace; font-size:15px; margin:8px 0 24px; }}
  a.btn {{ display:inline-block; background:var(--accent); color:#fff; text-decoration:none;
          padding:10px 18px; border-radius:10px; font-weight:600; }}
</style></head>
<body><main class="card">
  <div class="label">/{code} goes to</div>
  <div class="url">{url}</div>
  <a class="btn" href="{url}" rel="noopener noreferrer">Continue</a>
</main></body></html>"""
