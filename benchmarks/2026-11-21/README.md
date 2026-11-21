# Benchmark run: 2026-11-21

## Hardware and environment

- Lenovo IdeaPad Flex 5 14ITL05: Intel Core i7-1165G7 (**4 cores / 8 threads**), 16 GB RAM, Windows
- Docker Desktop (WSL 2) with **8 CPUs / 7.5 GB**
- Everything on the one laptop: k6, the API (1 uvicorn worker), 1 analytics worker, Postgres 16,
  Redis 7, Prometheus and Grafana
- Freshly restarted, on mains power, no other applications running
- Data: 10,000 seeded links (`make seed-load`); k6 picks codes with a Zipf-like skew

## Method

`load/redirect_hot.js`: ramping arrival rate, ramp to 500 req/s over 1 minute, hold 500 req/s for
3 minutes, ramp down over 30 seconds. `redirects: 0`, so k6 measures the shortener's 302, not the
destination site. Thresholds: error rate under 0.1%, p99 under 250 ms.

k6 ran on the Compose network and called the API by its service name (`make load-net`):

```bash
docker run --rm -i --network url-shortener_default -v "$PWD/load:/load" \
  -e BASE_URL=http://api:8000 grafana/k6 run \
  --summary-trend-stats="med,p(90),p(95),p(99),max" /load/redirect_hot.js
```

## Result

```
THRESHOLDS
  http_req_duration  ✓ 'p(99)<250'  p(99)=12.37ms
  http_req_failed    ✓ 'rate<0.001' rate=0.00%

checks_succeeded...: 100.00% 113999 out of 113999   (status is 302)
http_req_duration..: med=997.25µs p(90)=1.57ms p(95)=2.16ms p(99)=12.37ms max=83.96ms
http_req_failed....: 0.00%  0 out of 113999
http_reqs..........: 113999 422.21687/s
vus................: max=13   vus_max: 100
dropped_iterations.: 0
```

- **113,999 requests, 0 failures**, every response a 302
- k6 latency: p50 1.00 ms · p90 1.57 ms · p95 2.16 ms · p99 12.37 ms · max 84 ms
- 422 req/s is the average over the whole run including the ramps; the hold was a flat 500 req/s
- Grafana during the run (`grafana-during-run.png`): server-side p50 and p95 in the first histogram
  buckets (about 2.5 ms and 5 ms), p99 about 5 ms with two short bumps to 10–16 ms; cache hit ratio
  100%; zero 429s; consumer lag 0; clicks published equal clicks processed; dead-letter queue and
  dropped events 0

## Getting a clean run on Windows

- **k6 through `host.docker.internal` failed** on Docker Desktop for Windows: 1.3% of requests
  ended in `dial: i/o timeout`, 18,481 iterations were dropped and p99 reached 10 s. The bottleneck
  was Windows port forwarding, not the shortener: running k6 on the Compose network instead gave
  zero errors.
- **Earlier runs on the same laptop varied** from a p99 of 168 ms to 1.2 s, with latency climbing in
  the second half of the hold. Background load and likely thermal throttling: a fresh restart on
  mains power with nothing else open produced the result above.

## Interpretation limits

k6, the API and every datastore share four CPU cores over a local network, so these numbers show
how the design behaves (the cache absorbs the redirect load, the click pipeline keeps up, the tail
stays short), not production capacity.
