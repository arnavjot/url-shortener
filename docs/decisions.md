# Design decisions

Short notes on the choices that shape this service and what each one costs.

## 1. Redirect with 302, not 301
Browsers and CDNs cache a 301 indefinitely, so repeat visits would never reach the service
and click counts would drift low. A 302 with `Cache-Control: private, max-age=90` keeps the
service in the loop while still letting a browser skip us for a minute and a half.
Cost: more requests end at our API.

## 2. Publish click events after the response
Clicks are sent to Redis from a `BackgroundTask`, so the redirect never waits on analytics.
Cost: if the process dies between sending the response and the `XADD`, that one click is
lost. `shortener_clicks_dropped_total` makes the loss visible. For billing-grade events the
publish would move before the response.

## 3. Redis Streams instead of Kafka
Redis is already here for caching and rate limiting, and one consumer group at these rates
is well within what Streams handles. Kafka starts paying for itself with many independent
consumers, long retention or large replays. The stream is capped with `MAXLEN ~1M`, which
bounds memory and makes the retention limit explicit.

## 4. Effectively-once counting
Delivery is at-least-once. Each worker batch inserts the stream entry IDs into a
`processed_events` table and updates the rollups in the same transaction, then acks the
entries only after commit. A crash before the ack means redelivery; the ledger makes the
redelivered entries no-ops. Ledger rows older than 48h are purged by the daily job.

## 5. Short codes: 8 random characters, no look-alikes
The alphabet drops `0 O o 1 l I`, leaving 56 symbols, so a code copied off a screen or a
printed QR label can be typed back reliably. 56^8 is about 10^14 codes; collisions are
astronomically rare and still handled by the unique index plus a retry loop. Random codes
need no central counter and can't be enumerated.

## 6. Rate limiting fails differently for reads and writes
A token bucket per API key runs as one Lua script in Redis, so refill and spend are atomic.
If Redis is unreachable, reads are let through (cheap, harmless) and writes get a 503
(protects Postgres from an unthrottled write burst). Redirect cache misses have their own
per-IP bucket so code-scanning can't turn into a flood of database reads.

## 7. One uvicorn worker per container
`prometheus_client` keeps metrics per process. Several workers behind one `/metrics`
endpoint would each report partial numbers on alternate scrapes. Scale by adding
containers instead; Prometheus finds worker replicas through Docker DNS.

## 8. Bulk create validates row by row
`POST /api/v1/links/bulk` takes up to 50 rows and returns a result per row. Validating each
row separately means one bad URL in a pasted list doesn't reject the other 49.

## 9. Preview at `/{code}+`
Appending `+` shows the destination instead of redirecting, and doesn't count a click.
`+` is not allowed in codes or aliases, so the route can't collide with a real link.

## Known limits
- If Redis is fully down, redirects fail; a direct-to-Postgres fallback isn't built yet.
- URL validation blocks private and loopback IP literals (including decimal/octal/hex
  spellings) but not hostnames that resolve to private IPs. The service never fetches
  target URLs itself, which removes most of the risk.
- Listing uses limit/offset pagination, not keyset.
- The daily rollup runs from a `sleep 3600` loop in compose rather than a real scheduler.
- API keys are cached in-process for 60s, so a revoked key keeps working for up to a minute.
- The rate limiter uses the app server's clock; large clock skew between API replicas could
  hand out extra tokens. Using Redis `TIME` inside the script would fix that.
- Users behind one NAT share the per-IP redirect-miss bucket. Behind a reverse proxy, run
  uvicorn with `--proxy-headers` so the real client IP is used.
- Cache stampedes are softened with TTL jitter only; probabilistic early refresh isn't built.
