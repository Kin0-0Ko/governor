# Quickstart Validation Guide: Scraping Cost Control & Budget Governor

Proves the feature works end-to-end across all three user stories.

## Prerequisites

- Node.js 20+, pnpm 9+
- Docker (for Redis Cluster + PostgreSQL + RabbitMQ)
- NX CLI: `pnpm add -g nx`

## 1. Start Infrastructure

```bash
docker compose up -d redis postgres rabbitmq
# Redis Cluster on :7000-7005, PostgreSQL on :5432, RabbitMQ on :5672/:15672
```

## 2. Bootstrap Workspace

```bash
pnpm install
nx run-many --target=build --projects=cost-engine,budget-store
nx run api:db:migrate          # TypeORM migrations → creates spend_events, budgets, providers, alert_events tables
nx run api:seed:providers      # seeds scraperapi + brightdata provider pricing
```

## 3. Start Services

```bash
# Terminal 1
nx serve api          # NestJS control plane on :3000

# Terminal 2
nx serve worker       # RabbitMQ consumer

# Terminal 3
nx serve dashboard    # Next.js on :4200
```

## Validation Scenario 1: Budget Enforcement (US1 — P1 Critical)

**Goal**: Confirm circuit breaker trips and denies requests atomically.

```bash
# Create a $1.00 budget for job-001 / target-abc
curl -X POST http://localhost:3000/v1/budgets \
  -H 'Content-Type: application/json' \
  -d '{"orgId":"org-test","jobId":"job-001","targetId":"target-abc","capMicros":"1000000","halfOpenTtlSeconds":60}'
# → 201 with budgetId

# Simulate 3 requests at $0.40 each (total $1.20 > $1.00 cap)
# Request 1 — ALLOWED
curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-test","jobId":"job-001","targetId":"target-abc","provider":"scraperapi","features":[],"idempotencyKey":"key-001","requestTimestamp":"2026-07-06T12:00:00Z","retryIndex":0}'
# → {"decision":"ALLOWED","costMicros":"400000",...}

# Request 2 — ALLOWED ($0.80 cumulative)
# (repeat with idempotencyKey:"key-002")

# Request 3 — TRIPPED ($1.20 would exceed $1.00 cap)
# → {"decision":"DENIED","state":"OPEN",...}

# Verify subsequent requests denied without upstream call (check api logs: no provider HTTP call)
curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-test","jobId":"job-001","targetId":"target-abc","provider":"scraperapi","features":[],"idempotencyKey":"key-004","requestTimestamp":"2026-07-06T12:00:03Z","retryIndex":0}'
# → {"decision":"DENIED","state":"OPEN",...}  ← instant, no upstream call
```

**Expected**: requests 1–2 ALLOWED, request 3 TRIPPED, request 4+ DENIED in <10ms.

---

## Validation Scenario 2: Multiplier Pricing (US2 — Provider Attribution)

**Goal**: Confirm additive multiplier pricing and correct spend attribution.

```bash
# jsRender (5×) + residential (3×) = 8× multiplier on $0.001 base = $0.008 per request
curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-test","jobId":"job-002","targetId":"target-xyz","provider":"scraperapi","features":["jsRender","residential"],"idempotencyKey":"key-multi-001","requestTimestamp":"2026-07-06T13:00:00Z","retryIndex":0}'
# → {"decision":"ALLOWED","costMicros":"8000000",...}  (8× base of 1000000 micros)

# Query spend attribution
curl "http://localhost:3000/v1/spend?orgId=org-test&jobId=job-002"
# → items[0].totalCostMicros = "8000000", multiplierSum = 8, features = ["jsRender","residential"]
```

**Expected**: `totalCostMicros = baseRateMicros * 8n`.

---

## Validation Scenario 3: Retry Cost Debit (US2 — Retry Attribution)

**Goal**: Confirm retries are debited independently.

```bash
# Same logical request, retryIndex 0 and 1 → two separate debits
curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-test","jobId":"job-003","targetId":"target-retry","provider":"scraperapi","features":[],"idempotencyKey":"key-retry-000","requestTimestamp":"2026-07-06T14:00:00Z","retryIndex":0}'
# → ALLOWED, costMicros debited

curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-test","jobId":"job-003","targetId":"target-retry","provider":"scraperapi","features":[],"idempotencyKey":"key-retry-001","requestTimestamp":"2026-07-06T14:00:01Z","retryIndex":1}'
# → ALLOWED or DENIED depending on remaining budget; either way a new debit occurs

# Query spend — should show 2 records for same job/target
curl "http://localhost:3000/v1/spend?orgId=org-test&jobId=job-003"
# → total: 2
```

---

## Validation Scenario 4: HALF_OPEN Probe (US1 — FSM)

```bash
# Wait 60s after circuit trips OR manually fast-forward TTL in Redis for testing:
redis-cli -p 7000 SET "budget:{org-test:<budgetId>}:ttl_exp" 0

# Next enforce call → HALF_OPEN probe allowed
curl -X POST http://localhost:3000/v1/enforce ...
# → {"decision":"ALLOWED","state":"HALF_OPEN",...} if budget still has headroom after partial reset
#   OR {"decision":"DENIED","state":"OPEN",...} if still exhausted
```

---

## Validation Scenario 5: Dashboard Live Update (US3)

1. Open `http://localhost:4200` → navigate to budget `job-001 / target-abc`
2. Send enforce requests via curl (Scenario 1 above)
3. **Expected**: spend gauge updates within 5 seconds, circuit breaker badge shows OPEN without page refresh
4. Click "Reset Circuit" → badge transitions to CLOSED within 5 seconds

---

## Validation Scenario 6: Fail-Safe on Store Unavailable

```bash
# Stop Redis
docker stop <redis-container>

curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-test","jobId":"job-001","targetId":"target-abc",...}'
# → 503 {"decision":"DENIED","state":"STORE_UNAVAILABLE",...}

# Restart Redis → service auto-reconnects (ioredis retry config)
docker start <redis-container>
```

---

## Validation Scenario 7: No Budget = Hard Deny

```bash
curl -X POST http://localhost:3000/v1/enforce \
  -d '{"orgId":"org-new","jobId":"job-unknown","targetId":"target-unknown","provider":"scraperapi","features":[],"idempotencyKey":"key-nobudget","requestTimestamp":"2026-07-06T15:00:00Z","retryIndex":0}'
# → 402 {"decision":"DENIED","state":"NO_BUDGET",...}
```

---

## Idempotency Check

```bash
# Send same idempotencyKey twice
curl -X POST http://localhost:3000/v1/enforce -d '{"idempotencyKey":"key-001",...}'  # first delivery
curl -X POST http://localhost:3000/v1/enforce -d '{"idempotencyKey":"key-001",...}'  # duplicate

# Query spend — should still show only ONE record for key-001
curl "http://localhost:3000/v1/spend?orgId=org-test" | jq '[.items[] | select(.idempotencyKey=="key-001")] | length'
# → 1
```

---

## See Also

- [API Contracts](./contracts/api.md) — full request/response schemas
- [Data Model](./data-model.md) — entity definitions and invariants
- [Research](./research.md) — technology decisions and rationale
