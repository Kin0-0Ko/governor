# Governor

Atomic scraping cost control. Pre-authorise every HTTP request against a Redis circuit-breaker before it leaves the machine — no floats, no races, no surprise bills.

```
POST /v1/enforce  →  ALLOWED / DENIED  (<10ms p99)
```

## Architecture

```
Playwright page
  └─ @scrape-governor/playwright-hook
       └─ POST /v1/enforce  ──→  apps/api  (NestJS)
                                    ├─ Redis Lua EVALSHA  (hot path, <10ms)
                                    ├─ PostgreSQL         (cold path ledger)
                                    └─ RabbitMQ emit      (async spend record)
                                              └─ apps/worker  (consumer)
                                                    └─ spend_events table

apps/dashboard  (Next.js + RTK Query + SSE)  ──→  live circuit state & spend gauge
```

**Money rule:** every monetary value is micro-dollars stored as `bigint`. `1_000_000n = $1.00`. No floats anywhere.

## Packages

| Package | npm | Description |
|---|---|---|
| `@scrape-governor/cost-engine` | [![npm](https://img.shields.io/npm/v/@scrape-governor/cost-engine)](https://www.npmjs.com/package/@scrape-governor/cost-engine) | Pure pricing contracts + `computeCostMicros` |
| `@scrape-governor/playwright-hook` | [![npm](https://img.shields.io/npm/v/@scrape-governor/playwright-hook)](https://www.npmjs.com/package/@scrape-governor/playwright-hook) | Playwright request interceptor |

Private apps (not published): `api`, `worker`, `dashboard`.

---

## Quick start (5 minutes)

### Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- Docker Desktop

### 1 — Clone and install

```bash
git clone https://github.com/Kin0-0Ko/governor.git
cd governor
pnpm install
```

### 2 — Start infrastructure

```bash
docker compose up -d
```

Starts: Redis 7.4 cluster (6 nodes, ports 7000–7005), PostgreSQL 17 (port 5432), RabbitMQ 4.0 (ports 5672 + 15672).

Wait ~10s for the Redis cluster-init container to form the cluster.

### 3 — Run migrations

```bash
pnpm nx run api:db:migrate
```

### 4 — Seed reference data and create an API key

```bash
pnpm nx run api:seed:providers
pnpm nx run api:seed:api-key -- org-1 "local-dev"
```

The second command prints a raw API key once — copy it, it is only ever shown here (only its hash is stored). Export it for the next steps:

```bash
export GOVERNOR_API_KEY=<the raw key printed above>
```

### 5 — Start the API

```bash
pnpm nx serve api
```

API listens on `http://localhost:3000`.

### 6 — Create a budget and enforce

Every request below requires the API key from step 4 via `Authorization: Bearer <key>`.

```bash
# Create $5.00 budget for a scraping job
curl -s -X POST http://localhost:3000/v1/budgets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GOVERNOR_API_KEY" \
  -d '{
    "orgId": "org-1",
    "jobId": "job-scrape-001",
    "targetId": "scraperapi",
    "capMicros": "5000000",
    "halfOpenTtlSeconds": 30
  }' | jq .

# Enforce — should return ALLOWED
curl -s -X POST http://localhost:3000/v1/enforce \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GOVERNOR_API_KEY" \
  -d '{
    "orgId": "org-1",
    "jobId": "job-scrape-001",
    "targetId": "scraperapi",
    "provider": "scraperapi",
    "features": [],
    "idempotencyKey": "req-001",
    "requestTimestamp": "2026-01-01T00:00:00Z",
    "retryIndex": 0
  }' | jq .
```

---

## Using `@scrape-governor/playwright-hook`

```bash
npm install @scrape-governor/playwright-hook
# peer deps (one of):
npm install playwright
npm install @playwright/test
```

```typescript
import { GovernorHook, GovernorDeniedError } from '@scrape-governor/playwright-hook';
import { test } from '@playwright/test';

const hook = new GovernorHook({
  apiUrl: 'http://localhost:3000',
  orgId: 'org-1',
  jobId: 'job-scrape-001',
});

test('scrape with budget enforcement', async ({ page }) => {
  await hook.attach(page, {
    targetId: 'scraperapi',
    provider: 'scraperapi',
    features: ['jsRender'], // 5x multiplier
  });

  try {
    await page.goto('https://example.com');
    // ... scraping logic
  } catch (err) {
    if (err instanceof GovernorDeniedError) {
      console.log(`Blocked: ${err.state}`); // 'OPEN' | 'NO_BUDGET' | 'STORE_UNAVAILABLE'
    }
    throw err;
  }
});
```

`GovernorDeniedError.state` values:

| State | Meaning |
|---|---|
| `OPEN` | Budget exhausted, circuit tripped |
| `NO_BUDGET` | No budget configured for this scope |
| `STORE_UNAVAILABLE` | Redis unreachable — fail-safe deny |

---

## Using `@scrape-governor/cost-engine`

```bash
npm install @scrape-governor/cost-engine
```

```typescript
import { computeCostMicros, ScraperApiAdapter, type CostAdapter } from '@scrape-governor/cost-engine';

// Direct computation
const cost = computeCostMicros(
  1_000_000n,           // $1.00 base rate
  ['jsRender'],         // active features
  [{ feature: 'jsRender', addend: 4 }], // +4 addend → 5x total
);
// cost === 5_000_000n  ($5.00)

// Custom adapter
class MyProviderAdapter implements CostAdapter {
  readonly provider = 'my-provider';

  computeCost(signal, config) {
    return computeCostMicros(config.baseRateMicros, signal.features, config.multiplierRules);
  }
}
```

**Multiplier model:** `totalMultiplier = 1 + sum(matched addends)`. Addends summed as `number`, converted to `BigInt` once. No floats.

---

## API reference

Base URL: `http://localhost:3000/v1`  
All monetary fields are strings (micro-dollar integers).

### POST /v1/enforce

Pre-authorise a scraping request. Called before every HTTP request in the hot path.

**Request**

```json
{
  "orgId": "org-1",
  "jobId": "job-scrape-001",
  "targetId": "scraperapi",
  "provider": "scraperapi",
  "features": ["jsRender"],
  "idempotencyKey": "sha256-hex-string",
  "requestTimestamp": "2026-01-01T00:00:00.000Z",
  "retryIndex": 0
}
```

**Responses**

| Status | `decision` | `state` | Meaning |
|---|---|---|---|
| 200 | `ALLOWED` | `CLOSED` | Request authorised, spend debited |
| 402 | `DENIED` | `OPEN` | Budget exhausted |
| 402 | `DENIED` | `NO_BUDGET` | No budget for scope |
| 503 | `DENIED` | `STORE_UNAVAILABLE` | Redis unreachable |

```json
{ "decision": "ALLOWED", "costMicros": "5000000", "remainingMicros": "45000000", "state": "CLOSED" }
```

### POST /v1/budgets

```json
{ "orgId": "org-1", "jobId": "job-1", "targetId": "scraperapi", "capMicros": "50000000", "halfOpenTtlSeconds": 60 }
```

Returns `201` with `{ id, orgId, jobId, targetId, capMicros, halfOpenTtlSeconds, createdAt }`.  
Returns `409` if budget already exists for the scope.

### GET /v1/budgets

Lists every budget for the authenticated caller's org, each merged with live circuit state (same shape as `GET /v1/budgets/:id`). Returns `[]` when the org has no budgets.

### GET /v1/budgets/:id

Returns budget + live circuit state from Redis:

```json
{
  "id": "uuid",
  "capMicros": "50000000",
  "circuitState": "CLOSED",
  "spendMicros": "5000000",
  "remainingMicros": "45000000"
}
```

### PATCH /v1/budgets/:id

Update `capMicros` and/or `halfOpenTtlSeconds`. Warms Redis immediately.

### DELETE /v1/budgets/:id

Soft-delete. Returns `204`.

### POST /v1/budgets/:id/reset

Reset circuit breaker to `CLOSED`.

```json
{ "budgetId": "uuid", "previousState": "OPEN", "newState": "CLOSED", "resetAt": "..." }
```

### GET /v1/spend

Query spend ledger.

**Params:** `orgId` (required), `jobId`, `targetId`, `provider`, `from`, `to` (ISO 8601), `page`, `limit` (max 500).

### GET /v1/stream/budgets/:id

Server-Sent Events stream. Three event types:

```
event: spend
data: {"spendMicros":"5000000","remainingMicros":"45000000","state":"CLOSED","ts":"..."}

event: state_change
data: {"previousState":"CLOSED","newState":"OPEN","ts":"...","budgetId":"uuid"}

event: reset
data: {"newState":"CLOSED","ts":"...","budgetId":"uuid"}
```

---

## Circuit breaker

The circuit breaker runs entirely in a Redis Lua script (atomic, no race conditions).

```
CLOSED  →  spend < cap  →  CLOSED   (normal operation)
CLOSED  →  spend ≥ cap  →  OPEN     (budget exhausted)
OPEN    →  TTL expires  →  HALF_OPEN (probe allowed)
HALF_OPEN → probe spend ≥ cap → OPEN (still exhausted)
HALF_OPEN → probe spend < cap → CLOSED (recovered)
```

`halfOpenTtlSeconds` (default 60): how long the circuit stays OPEN before allowing one probe request.

---

## Development

### Run tests

```bash
pnpm nx run-many --target=test --all           # all projects
pnpm nx test cost-engine                        # single project
pnpm nx test budget-store                       # Lua FSM + service tests
```

### Lint

```bash
pnpm nx run-many --target=lint --all
```

### Build publishable libs

```bash
pnpm nx run-many --target=build --projects=playwright-hook,cost-engine
```

### Run all apps locally

```bash
# Terminal 1
pnpm nx serve api

# Terminal 2
pnpm nx serve worker

# Terminal 3
pnpm nx serve dashboard  # http://localhost:4200
```

The dashboard needs an `apps/dashboard/.env.local` (gitignored) with the API key it should use for every request and the SSE stream — every endpoint except `/health*` requires auth:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_GOVERNOR_API_KEY=<the raw key from api:seed:api-key>
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API HTTP port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `governor` | PostgreSQL superuser — migrations only |
| `DB_PASS` | `governor_dev` | PostgreSQL superuser password — migrations only |
| `DB_NAME` | `governor` | PostgreSQL database |
| `DB_APP_USER` | `governor_api` | Least-privilege login used by api/worker at runtime (granted `api_role` by migration 005) |
| `DB_APP_PASS` | `governor_dev` | Password for `DB_APP_USER` |
| `REDIS_HOST` | `localhost` | Redis cluster seed host |
| `REDIS_PORT` | `7000` | Redis cluster seed port |
| `RABBITMQ_URL` | `amqp://governor:governor_dev@localhost:5672` | RabbitMQ connection |
| `GOVERNOR_API_URL` | `http://localhost:3000` | Used by playwright-hook |

---

## Troubleshooting

**`docker compose up -d` fails to bind Postgres on port 5432, or the API can't connect / auth fails against the containerized DB.**

A native PostgreSQL install running locally on Windows/macOS (as a service) frequently already owns port 5432, so the docker-compose Postgres container silently loses the port or the API connects to the wrong (native) instance with different credentials. Check what's listening first:

```bash
# Windows
netstat -ano | findstr :5432

# macOS/Linux
lsof -i :5432
```

If a native Postgres service owns the port, either stop it (`services.msc` on Windows, `brew services stop postgresql` on macOS) before running `docker compose up -d`, or remap the container port in `docker-compose.yml` (e.g. `"5433:5432"`) and set `DB_PORT=5433` in `.env` to match.

---

## Project structure

```
governor/
├── apps/
│   ├── api/          NestJS REST API (hot + cold path)
│   ├── worker/       RabbitMQ consumers (spend-rollup, alerts)
│   └── dashboard/    Next.js SSE dashboard
├── libs/
│   ├── cost-engine/  @scrape-governor/cost-engine  (publishable)
│   └── budget-store/ Redis Lua enforcement  (internal)
│   └── playwright-hook/ @scrape-governor/playwright-hook (publishable)
├── specs/            Feature specification, plan, tasks
└── docker-compose.yml
```

NX scope tags enforce boundaries:

| Tag | Can import from |
|---|---|
| `scope:domain` | nothing internal |
| `scope:infra` | `scope:domain` |
| `scope:api` | `scope:domain`, `scope:infra` |
| `scope:worker` | `scope:domain`, `scope:infra` |
| `scope:frontend` | `scope:domain`, `scope:client` |

---

## Publishing (maintainers)

First release:
```bash
pnpm nx release --first-release
```

Subsequent releases (on merge to `main`, CI handles automatically):
```bash
pnpm nx release   # versions + changelogs + publish
```

Requires `NPM_TOKEN` secret in GitHub repository settings.  
Provenance attestation (SLSA) enabled via `NPM_CONFIG_PROVENANCE=true`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Branch off `dev`, PR to `dev`, squash-merge to `main` triggers release.

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
