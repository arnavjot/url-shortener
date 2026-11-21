"""Prometheus metrics: API side."""
import time

from prometheus_client import Counter, Histogram
from starlette.requests import Request

REQUEST_LATENCY = Histogram(
    "shortener_http_request_duration_seconds",
    "HTTP request latency",
    ["route", "method", "status"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0],
)
# result: hit | miss | negative | unavailable (Redis down: served from Postgres)
CACHE_OPS = Counter("shortener_cache_ops_total", "Link cache lookups", ["result"])
RATE_LIMIT_DECISIONS = Counter("shortener_rate_limit_decisions_total", "Token bucket decisions", ["allowed"])
CLICKS_PUBLISHED = Counter("shortener_clicks_published_total", "Click events published to the stream")
CLICKS_DROPPED = Counter("shortener_clicks_dropped_total", "Click events dropped (Redis unavailable)")
API_ERRORS = Counter("shortener_api_errors_total", "Unhandled API errors", ["route"])


async def latency_middleware(request: Request, call_next):
    start = time.perf_counter()
    status = "500"
    try:
        response = await call_next(request)
        status = str(response.status_code)
        return response
    except Exception:
        API_ERRORS.labels(route=_route_label(request)).inc()
        raise
    finally:
        REQUEST_LATENCY.labels(route=_route_label(request), method=request.method, status=status).observe(
            time.perf_counter() - start
        )


def _route_label(request: Request) -> str:
    # never fall back to the raw URL path: every scanner probe would mint a
    # new label value and blow up Prometheus cardinality
    return getattr(request.scope.get("route"), "path", "unmatched")
