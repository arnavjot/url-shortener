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
from urllib.parse import urlsplit

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
    parts = urlsplit(url)
    secure = parts.scheme == "https"
    warning = "" if secure else (
        '<p class="warn">This link uses plain <b>http</b>: the connection to this site is not encrypted.</p>'
    )
    return HTMLResponse(
        PREVIEW_HTML.format(
            code=escape(code),
            host=escape(parts.hostname or parts.netloc),
            url=escape(url, quote=True),
            warning=warning,
            badge="secure" if secure else "insecure",
            badge_text="HTTPS" if secure else "Not secure",
        ),
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
<title>Where /{code} goes</title>
<style>
  /* Same Graphite tokens as the web app (frontend/src/tokens.css). */
  :root {{ color-scheme: light dark; --app:#fbfbfa; --card:#fff; --sunken:#f3f3f1; --ink:#121212;
          --muted:#63635f; --line:#e6e6e2; --accent:#1b55e8; --on-accent:#fff;
          --ok:#127a43; --ok-soft:#e6f4ec; --warn:#9a5800; --warn-soft:#fdf1dc; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --app:#0e1014; --card:#15181e; --sunken:#1b1f27;
          --ink:#e9ebef; --muted:#9aa1ad; --line:#242832; --accent:#86a8ff; --on-accent:#0e1014;
          --ok:#4cc38a; --ok-soft:#13301f; --warn:#f0b453; --warn-soft:#33260e; }} }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; padding:16px;
         background:var(--app); color:var(--ink);
         font:15px/1.55 "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }}
  main {{ width:min(100%, 520px); background:var(--card); border:1px solid var(--line);
         border-radius:16px; padding:28px; display:grid; gap:18px; }}
  .top {{ display:flex; align-items:center; justify-content:space-between; gap:12px; }}
  .eyebrow {{ color:var(--muted); font-size:13px; }}
  .eyebrow b {{ color:var(--ink); font-family:"IBM Plex Mono", ui-monospace, monospace; font-weight:600; }}
  .badge {{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600;
           padding:4px 10px; border-radius:999px; white-space:nowrap; }}
  .badge.secure {{ background:var(--ok-soft); color:var(--ok); }}
  .badge.insecure {{ background:var(--warn-soft); color:var(--warn); }}
  .badge svg {{ width:13px; height:13px; }}
  .dest {{ background:var(--sunken); border:1px solid var(--line); border-radius:12px; padding:16px; min-width:0; }}
  .host {{ font-size:22px; font-weight:700; letter-spacing:-.01em; overflow-wrap:anywhere; }}
  .full {{ margin-top:6px; color:var(--muted); font:13px/1.5 "IBM Plex Mono", ui-monospace, monospace;
          overflow-wrap:anywhere; }}
  .warn {{ margin:0; background:var(--warn-soft); color:var(--warn); border-radius:10px; padding:10px 12px; font-size:13px; }}
  .hint {{ margin:0; color:var(--muted); font-size:13px; }}
  .acts {{ display:flex; gap:8px; flex-wrap:wrap; }}
  .btn {{ display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:10px 18px;
         border-radius:10px; font:600 14px/1 inherit; text-decoration:none; cursor:pointer;
         border:1px solid var(--line); background:var(--card); color:var(--ink); }}
  .btn.primary {{ background:var(--accent); border-color:var(--accent); color:var(--on-accent); }}
  .btn:focus-visible {{ outline:2px solid var(--accent); outline-offset:2px; }}
</style></head>
<body><main>
  <div class="top">
    <div class="eyebrow">Short link <b>/{code}</b> goes to</div>
    <span class="badge {badge}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>{badge_text}</span>
  </div>
  <div class="dest">
    <div class="host">{host}</div>
    <div class="full">{url}</div>
  </div>
  {warning}
  <p class="hint">Check that this is the site you expect before continuing. Previews are not counted as clicks.</p>
  <div class="acts">
    <a class="btn primary" href="{url}" rel="noopener noreferrer">Continue to {host} →</a>
    <button class="btn" type="button" onclick="history.length > 1 ? history.back() : window.close()">Go back</button>
  </div>
</main></body></html>"""
