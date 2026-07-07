# Governor — Repository Audit Report

**Date:** 2026-07-06 · **Branch:** `dev` · **Scope:** full repo — correctness, security, production readiness, OSS/packaging readiness, DX, documentation, architecture.

Severity legend: 🔴 Critical (broken functionality or exploitable) · 🟠 High (will bite in production) · 🟡 Medium (should fix before release) · 🔵 Low (polish).

---

## 1. Functional bugs

### 🔴 1.1 Alerts pipeline is dead code
`RABBITMQ_ROUTING_ALERT = 'budget.breached'` is defined (`apps/api/src/messaging/rabbitmq.config.ts:5`) and the worker consumes it (`apps/worker/src/alerts/alerts.consumer.ts:26`), but **nothing anywhere emits `budget.breached`**. When the Lua script trips a circuit, no event is published. Consequences:

- `alert_events` table is never populated.
- `AlertEventType.CIRCUIT_TRIPPED`, `HALF_OPEN_PROBE`, `CIRCUIT_RESET` enum values are unused.
- The `governor.alerts` queue is declared in config but never bound or consumed (worker only listens on `governor.spend`).

**Fix:** emit the alert from `EnforceService` when `outcome.state === 'TRIPPED'` (and from the reset endpoint for `CIRCUIT_RESET`), and give the worker a second binding/queue for alert patterns.

### 🔴 1.2 SSE live streaming is dead code
`StreamService.emit()` (`apps/api/src/stream/stream.service.ts:40`) is **never called** by any producer. The dashboard's `useBudgetStream` opens an `EventSource` and RTK Query subscribes, but no `spend` / `state_change` / `reset` event is ever pushed. The dashboard's headline feature (live spend gauge) silently shows nothing. `cleanup()` is also never called → the `subjects` Map grows forever (memory leak per unique budgetId requested).

**Fix:** call `streamService.emit()` from `EnforceService` after each decision and from the reset endpoint; call `cleanup()` when the last subscriber disconnects (or use `finalize()`).

### 🔴 1.3 No CORS — dashboard cannot talk to the API at all
`apps/api/src/main.ts` never calls `app.enableCors()`. The dashboard runs on `:4200` and calls the API at `http://localhost:3000` directly (`NEXT_PUBLIC_API_URL`), so every browser fetch and the SSE connection is blocked by the same-origin policy.

**Fix:** `app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:4200' })`.

### 🔴 1.4 Lua script inflates spend on denied requests
`libs/budget-store/src/lua/enforce.lua`: the debit (`INCRBY`) happens **before** the cap check. The request that trips the breaker has its cost permanently added to the spend counter even though it is denied. Worse: after the OPEN TTL expires, every failed HALF_OPEN probe debits again — during a retry loop the spend counter drifts upward without bound, and `spendMicros` reported to clients diverges from the actual ledger in Postgres.

**Fix:** compute `newSpend = current + cost` first; only `INCRBY` when the request is allowed. Trip on the *would-be* breach without recording the denied cost.

### 🟠 1.5 HALF_OPEN allows unlimited concurrent probes
The comment in `enforce.lua` says "allow exactly one probe request through", but nothing enforces this. All requests arriving while state is HALF_OPEN pass through and debit. The script is atomic per call, not across calls — the first probe should flip a marker (e.g. `SET probe_inflight NX`) that subsequent calls respect.

### 🟠 1.6 Redis is the sole source of budget existence — no rehydration
`enforce.lua` returns `NO_BUDGET` when the cap key is missing. The cap key is only written by `warmCapKey()` on budget create/update. After a Redis flush, node replacement, or key eviction:

- **All traffic for existing budgets is denied** (`NO_BUDGET`) even though the budget exists in Postgres, and nothing ever re-warms the key.
- The spend key is equally volatile: losing it silently **resets spend to zero** — a fully consumed budget becomes spendable again with no trace.

**Fix:** in `EnforceService`, on `NO_BUDGET` outcome re-warm the cap from the Postgres row and retry once. For spend durability, either use AOF-everysec + document the tradeoff, or periodically reconcile the counter from `spend_events`.

### 🟠 1.7 RabbitMQ queue declaration mismatch → PRECONDITION_FAILED
API (`events.module.ts:19`) declares `governor.spend` with only `x-dead-letter-exchange`; worker (`apps/worker/src/main.ts:14-17`) declares the same queue with `x-dead-letter-exchange` **and** `x-dead-letter-routing-key`. RabbitMQ rejects re-declaration of an existing queue with different arguments — whichever process starts second will crash-loop with `PRECONDITION_FAILED`. Also the declared DLX (`governor.events.dlx`) is never created, so every `nack(…, false, false)` **discards the message permanently** instead of dead-lettering it.

**Fix:** single shared queue-options constant consumed by both apps (it already exists in `rabbitmq.config.ts` — the worker just doesn't import it), plus a startup script/definition file that declares the DLX and DLQ.

### 🟠 1.8 Inconsistent RabbitMQ default credentials
`rabbitmq.config.ts:7` defaults to `amqp://guest:guest@localhost` (API), while the worker defaults to `amqp://governor:governor_dev@localhost`. Compose provisions `governor / governor_dev`. Out of the box the API's spend emit fails silently (fire-and-forget) → **allowed spends are never recorded in the ledger**.

### 🟠 1.9 Worker never loads `.env` and has wrong DB default
`apps/worker/src/main.ts` lacks `import 'dotenv/config'` (only the API got it), and `worker.module.ts:15` defaults `DB_PASS` to `governor` while compose uses `governor_dev`. Worker DB writes fail unless env vars are exported manually.

### 🟠 1.10 `computeCostMicros` throws on fractional addends
`libs/cost-engine/src/lib/pricing.ts:20` — `BigInt(totalMultiplier)` throws `RangeError` if any `addend` is fractional (e.g. `0.5`). Nothing validates addends at seed/persist time (`multiplierRules` is untyped JSONB). One bad provider row → every enforce call for that provider becomes a 500. Also note the Lua side converts cost/cap with `tonumber` (IEEE double) — exact only below 2^53 micro-dollars (~$9B); fine in practice, worth a comment.

### 🟡 1.11 Playwright hook intercepts every subresource
`governor-hook.ts:39` routes `'**/*'` — every image, stylesheet, font, analytics beacon triggers a **separate** `POST /v1/enforce`, each debiting a full base rate (e.g. $1 for scraperapi). One page load = dozens of debits and dozens of round-trips before any asset loads. Additionally:

- Throwing `GovernorDeniedError` inside a route handler surfaces as an unhandled rejection in Playwright, not a catchable test error.
- `idempotencyKey` includes a millisecond ISO timestamp → unique per attempt, so retries are never deduplicated; `retryIndex` is hardcoded `0`.
- A non-OK response body that isn't JSON (proxy 502 HTML) makes `res.json()` throw before the abort.

**Fix:** filter to document/XHR requests (or accept a URL pattern option), report denial via an injectable callback instead of throwing, derive the idempotency key from stable request identity.

### 🟡 1.12 Spend query endpoint has no validation
`spend.controller.ts` takes raw `@Query` strings, bypassing the global `ValidationPipe` (no DTO). `orgId` can be missing (`undefined` → returns nothing but no 400), `page=abc` → `NaN` → `skip(NaN)` SQL error, `from=garbage` → `Invalid Date` → driver error → 500.

### 🟡 1.13 Duplicate-key detection by error-message substring
`spend-rollup.consumer.ts:65` — `err.message.includes('duplicate key')` is locale/driver fragile. Check the Postgres error code instead: `(err as any).code === '23505'`.

---

## 2. Security

### 🔴 2.1 No authentication or authorization anywhere
Every endpoint — budgets CRUD, `POST /v1/enforce`, spend query, SSE stream — is fully open, and `orgId` is caller-supplied:

- Any caller can read/modify/delete **any org's budgets** by UUID (`GET/PATCH/DELETE /v1/budgets/:id` does no org check — classic IDOR).
- Any caller can query any org's full spend ledger (`GET /v1/spend?orgId=…`).
- Any caller can subscribe to any budget's SSE stream.
- Any caller can spam `/v1/enforce` with a victim's scope to **deliberately exhaust their budget and trip their circuit** (cheap DoS).
- `POST /v1/budgets/:id/reset` lets anyone un-trip any circuit.

This is the single biggest blocker for both production and public OSS deployment. Minimum: API-key auth middleware that binds the key to an `orgId` and scopes every query by it.

### 🟠 2.2 `spend_events` read-only enforcement is theater
Migration 002 revokes UPDATE/DELETE from `api_role`, but the app connects as `governor` (superuser per compose), and `api_role` is never granted to anything. The append-only guarantee does not actually hold at runtime. Create a dedicated login role for the API, grant it `api_role`, and connect as that.

### 🟠 2.3 No rate limiting, no security headers
No `@nestjs/throttler`, no `helmet`. `/v1/enforce` is the hot path and is unauthenticated (see 2.1) — trivially floodable.

### 🟡 2.4 Default credentials baked into source
`guest:guest` (rabbitmq.config.ts), `governor/governor_dev` fallbacks in three files. Fine for local dev, but production misconfiguration fails *open into defaults* rather than failing fast. Prefer: crash on missing required env in `NODE_ENV=production`.

### 🟡 2.5 SSE subject map is an unauthenticated memory-growth vector
Combined with 1.2/2.1: any client can request random `budgetId`s and each one permanently allocates a `Subject`. Unbounded, unauthenticated memory growth.

### 🔵 2.6 Compose binds all services to 0.0.0.0
Postgres, Redis ×6, RabbitMQ (+ management UI 15672) all exposed on all interfaces with dev passwords. Acceptable for local dev; add a warning in README and consider `127.0.0.1:` port bindings.

---

## 3. Production readiness

| Area | Status |
|---|---|
| Health/readiness endpoints | ❌ none (`@nestjs/terminus` recommended) |
| Graceful shutdown | ❌ `enableShutdownHooks()` not called; in-flight SSE/RMQ not drained |
| Dockerfiles | ❌ **none exist** — README/strategy says apps ship as Docker images, but there is nothing to build |
| Metrics / tracing | ❌ none (no Prometheus, no OTel) |
| Structured logging | ⚠️ mixed — enforce logs a JSON object through Nest's text logger; no pino/winston, no request IDs |
| Horizontal scaling | ⚠️ SSE uses in-process `Subject` — works only single-replica; needs Redis pub/sub fan-out |
| Spend emit durability | ❌ fire-and-forget `emit().subscribe({error: log})` — if RMQ is down, the allowed spend is lost with only a log line; no outbox/retry |
| Ledger ↔ Redis reconciliation | ❌ none (see 1.6) |
| Redis cluster ops | ⚠️ compose healthchecks ping nodes pre-cluster-join; `cluster-announce-ip` not set, so host-side clients can be redirected to unreachable internal IPs on MOVED — worth verifying under real cluster redirects |
| CI | ⚠️ PR→main only; no CI on `dev` pushes; no e2e job; Postgres/Redis services not provisioned (unit tests only) |
| DB migrations in deploy | ⚠️ manual `nx run api:db:migrate`; no automated migrate-on-deploy story |

---

## 4. OSS & npm packaging readiness

### 🔴 4.1 Published packages are almost certainly broken
`libs/cost-engine/package.json` and `libs/playwright-hook/package.json` declare `"main": "./src/index.js"` and `"files": ["src"]`, but the project directories contain **TypeScript sources only** — `src/index.js` does not exist there. The build outputs to `dist/libs/<name>`, but `nx release publish` publishes from the **project root** unless the `nx-release-publish` target sets `packageRoot`. As configured, `npm install @governor/cost-engine` would deliver raw `.ts` files with a dead `main` field.

**Fix:** add to each publishable lib's `project.json`:
```json
"nx-release-publish": {
  "options": { "packageRoot": "dist/libs/{projectName}" }
}
```
and verify with `npm pack dist/libs/cost-engine` before the next release. Test the tarball in a scratch project.

### 🟡 4.2 Placeholders and doc drift
- `YOUR_ORG` placeholder in both lib `repository.url` fields and the README clone URL.
- **README documents the wrong migration command**: `pnpm nx run api:migration:run` (README line ~65) — the target is `db:migrate`. This exact drift caused a real onboarding failure today.
- npm badge links will 404 until first publish — fine, but note it.

### 🟡 4.3 `seed:providers` target still broken
`apps/api/project.json` — the seed target never got the `cross-env TS_NODE_PROJECT=…` fix applied to `db:migrate`/`serve`. It will fail with the same `Cannot find tsconfig.json` / path-alias errors. Quick-start step "seed providers" is broken.

### 🔵 4.4 Governance files present — good
LICENSE (MIT), CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md all exist. Missing niceties: issue/PR templates, `CODEOWNERS`, badges for CI status.

---

## 5. DX

- 🟠 **Cold-start was broken out of the box** (fixed in this session, uncommitted): removed `@nx/node:build|execute` executors, missing `baseUrl` in `tsconfig.base.json` (silently disabled all `@governor/*` aliases at runtime), six missing dependencies (`tslib`, `@types/express`, `amqplib`, `@types/amqplib`, `amqp-connection-manager`, `cross-env`, `dotenv`), invalid `CREATE ROLE IF NOT EXISTS` SQL in migration 002. **These fixes are sitting uncommitted on `dev` — commit them.**
- 🟡 Entity duplication: `apps/worker/src/entities/*` are hand-copies of the API's entities. Schema drift between the two is invisible until runtime. Move shared entities to a lib (`libs/entities` or into `budget-store`).
- 🟡 No e2e test at all — the three dead-wire bugs (1.1, 1.2, 1.3) are exactly the class of bug unit tests can't catch and one docker-compose e2e would.
- 🔵 `bash.exe.stackdump` junk file in repo root (already gitignored — delete it).
- 🔵 `.env.example` now exists (added today) — good; keep it in sync as config grows (RABBITMQ_URL, PORT, CORS_ORIGIN are missing from it).
- 🔵 Windows note for contributors: native PostgreSQL installs squatting port 5432 shadow the compose container with confusing auth errors (bit us today). Worth a "Troubleshooting" README section.

---

## 6. Architecture & code cleanliness

**Good:** clear hexagonal split (pure `cost-engine`, infra `budget-store`, thin API), BigInt micro-dollar discipline held consistently across TS/Postgres boundaries, Lua hash-tags for cluster slot locality, idempotency key + unique index on the ledger, DTO validation with global whitelist pipe, sensible unit test coverage (Lua FSM, pricing, hook, controllers).

Improvement points:

1. **Unknown provider silently charges $1** — `enforce.service.ts:49` defaults `baseRateMicros` to `1_000_000n` when the provider row is missing/inactive. A typo'd provider name bills a made-up rate instead of failing. Deny with an explicit `UNKNOWN_PROVIDER` state, or make the default configurable and log loudly.
2. `(this.redis as any).evalsha` ×3 in `budget-store.service.ts` — ioredis supports typed custom commands via `defineCommand`; kills the `any` casts and gives you EVALSHA-with-fallback for free.
3. `EnforceController` drops to `@Res()` manual responses — idiomatic Nest would use exceptions/filters or an interceptor; current style bypasses interceptors (relevant when you add metrics/logging interceptors).
4. Payload duplication in the spend event: `costMicros` and `totalCostMicros` carry the same value (`enforce.service.ts:75-78`); the worker recomputes `multiplierSum` from rules it's handed rather than receiving it. Slim the contract.
5. `getOrCreate` + never-`cleanup` in `StreamService` (see 1.2) — subscribe-side reference counting is the standard pattern.
6. Migration files use hand-rolled timestamps (`1000000000001`) — fine, but document the convention or generate via `typeorm migration:create`.
7. Nx `release.projects` includes `playwright-hook`/`cost-engine` but `budget-store` (also under `libs/`, not publishable) has no `package.json` — intentional and correct, but add a comment in `nx.json` so nobody "fixes" it.

---

## 7. Priority action list

1. **Auth + org scoping** on every endpoint (2.1) — blocks any real deployment.
2. **Wire the dead paths**: emit `budget.breached` (1.1), emit SSE events (1.2), enable CORS (1.3). These three make the advertised feature set actually function.
3. **Fix Lua debit-before-check + probe race** (1.4, 1.5) — money-correctness core of the product.
4. **Fix npm `packageRoot`** and verify tarballs before first publish (4.1).
5. **Unify RabbitMQ options + declare DLX/DLQ** (1.7, 1.8); add dotenv + correct defaults to worker (1.9).
6. **Redis rehydration/reconciliation strategy** (1.6).
7. Fix `seed:providers` target (4.3), README migration command (4.2), commit today's uncommitted bootstrap fixes (5).
8. Add healthchecks, graceful shutdown, Dockerfiles, and one docker-compose e2e smoke test (3).
