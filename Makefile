.PHONY: up down logs migrate seed seed-load test itest load rollup ps clean web

up:            ## build + start the full stack (web, api, worker, postgres, redis, prometheus, grafana)
	docker compose up -d --build

down:
	docker compose down

clean:         ## down + wipe postgres volume
	docker compose down -v

logs:
	docker compose logs -f api worker

ps:
	docker compose ps

migrate:       ## run alembic migrations (also runs automatically on `make up`)
	docker compose run --rm migrate

seed:          ## demo API key + 20 sample links (prints the key once)
	docker compose run --rm api python -m scripts.seed

seed-load:     ## 10k links for load testing
	docker compose run --rm api python -m scripts.seed --links 10000

test:          ## unit + component tests (no services/Docker needed)
	pytest tests/unit tests/component -q

itest:         ## integration tests against the running stack (needs SEED_API_KEY)
	INTEGRATION=1 pytest tests/integration -q

load:          ## dockerized k6 against the host stack (run `make seed-load` first)
	docker run --rm -i -v $(PWD)/load:/load -e BASE_URL=http://host.docker.internal:8000 \
		--add-host=host.docker.internal:host-gateway grafana/k6 run /load/redirect_hot.js

load-net:      ## k6 on the Compose network (use this on Docker Desktop for Windows)
	docker run --rm -i --network url-shortener_default -v $(PWD)/load:/load -e BASE_URL=http://api:8000 \
		grafana/k6 run --summary-trend-stats="med,p(90),p(95),p(99),max" /load/redirect_hot.js

rollup:        ## one-shot daily rollup + ledger purge
	docker compose run --rm api python -m workers.rollup_daily

web:           ## run the React UI with hot reload on :5173 (needs the API on :8000)
	cd frontend && npm install && npm run dev
