---
description: "Task list for Scraping Cost Control & Budget Governor"
---

# Tasks: Scraping Cost Control & Budget Governor

**Input**: Design documents from `specs/001-budget-governor/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/api.md ✅

**Tests**: Not explicitly requested — test tasks included only for critical Hot Path Lua enforcement (constitution mandates test-first for atomic scripts).

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: NX monorepo initialization, toolchain, and shared configuration.

- [x] T001 Initialize NX monorepo workspace at repo root (`nx.json`, `package.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`)
- [x] T002 [P] Configure NX module boundary ESLint rules in `.eslintrc.json` (scope:domain, scope:infra, scope:api, scope:worker, scope:frontend, scope:client dep constraints per plan.md)
- [x] T003 [P] Generate NX library scaffold: `libs/cost-engine` with tag `scope:domain` (`libs/cost-engine/project.json`, `libs/cost-engine/tsconfig.json`)
- [x] T004 [P] Generate NX library scaffold: `libs/budget-store` with tag `scope:infra` (`libs/budget-store/project.json`, `libs/budget-store/tsconfig.json`)
- [x] T005 [P] Generate NX library scaffold: `libs/playwright-hook` with tag `scope:client`, publishable (`libs/playwright-hook/project.json`, `libs/playwright-hook/package.json`)
- [x] T006 [P] Generate NX app scaffold: `apps/api` NestJS with tag `scope:api` (`apps/api/project.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`)
- [x] T007 [P] Generate NX app scaffold: `apps/worker` NestJS standalone with tag `scope:worker` (`apps/worker/project.json`, `apps/worker/src/main.ts`, `apps/worker/src/worker.module.ts`)
- [x] T008 [P] Generate NX app scaffold: `apps/dashboard` Next.js 14 with tag `scope:frontend` (`apps/dashboard/project.json`, `apps/dashboard/src/app/layout.tsx`)
- [x] T009 Create Docker Compose config for local infrastructure (`docker-compose.yml`: Redis Cluster on ports 7000-7005, PostgreSQL 16 on 5432, RabbitMQ 3.13 on 5672/15672)
- [x] T010 [P] Configure Jest preset for monorepo (`jest.preset.js`, `jest.config.ts` at root, individual jest configs in each lib/app)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core shared infrastructure all user stories depend on. MUST complete before US1–US3.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T011 Create TypeORM data source configuration in `apps/api/src/database/data-source.ts` (PostgreSQL connection, entity discovery, migration runner)
- [x] T012 [P] Create TypeORM entity: `Budget` in `apps/api/src/budgets/entities/budget.entity.ts` (all fields from data-model.md: id, orgId, jobId, targetId, capMicros as bigint, halfOpenTtlSeconds, createdAt, updatedAt; unique constraint on orgId+jobId+targetId)
- [x] T013 [P] Create TypeORM entity: `Provider` in `apps/api/src/providers/entities/provider.entity.ts` (id, name, baseRateMicros as bigint, multiplierRules as jsonb, active, createdAt, updatedAt)
- [x] T014 [P] Create TypeORM entity: `SpendEvent` in `apps/api/src/spend/entities/spend-event.entity.ts` (all fields from data-model.md; UNIQUE constraint on idempotencyKey; NO update/delete operations — append-only)
- [x] T015 [P] Create TypeORM entity: `AlertEvent` in `apps/api/src/alerts/entities/alert-event.entity.ts` (id, budgetId FK, orgId, eventType enum, spendAtEventMicros, capMicros, occurredAt)
- [x] T016 Generate TypeORM migration for all four entities (`apps/api/src/database/migrations/001_initial_schema.ts` — creates budgets, providers, spend_events, alert_events tables)
- [x] T017 Create Provider seed script `apps/api/src/database/seeds/providers.seed.ts` (scraperapi: baseRateMicros=1000000n, jsRender addend=5, residential addend=3; brightdata: baseRateMicros=2000000n, residential addend=3)
- [x] T018 Create `libs/cost-engine/src/lib/contracts.ts` defining `CostSignal` interface (orgId, jobId, targetId, provider, features: string[], idempotencyKey, requestTimestamp, retryIndex), `CostResult` interface (decision: 'ALLOWED'|'DENIED'|'TRIPPED', costMicros: bigint, remainingMicros: bigint, state: string), `CostAdapter` interface (evaluate(signal: CostSignal): CostResult)
- [x] T019 Create `libs/cost-engine/src/lib/pricing.ts` implementing additive multiplier computation: `computeCostMicros(baseRateMicros: bigint, activeFeatures: string[], multiplierRules: {feature: string, addend: number}[]): bigint` — pure function, BigInt only, no float. **CRITICAL (C1)**: addends are safe integers summed as `number` accumulator first (`rules.reduce((acc, r) => acc + r.addend, 1)`), then single `BigInt()` conversion: `baseRateMicros * BigInt(totalMultiplier)` — no intermediate float, no per-step BigInt conversion
- [x] T020 Create `libs/budget-store/src/lua/enforce.lua` — atomic Lua script implementing full FSM: OPEN state check → TTL expiry → HALF_OPEN probe → INCRBY spend → cap comparison → state transition → return `{allowed: 0|1, state: string, spendMicros: string, remainingMicros: string}`. **Fix I3**: if `cap` key is nil/missing, immediately `return {0, 'NO_BUDGET', '0', '0'}` — no INCRBY executed
- [x] T021 **[TEST-FIRST]** Create Jest unit tests for `enforce.lua` using ioredis-mock in `libs/budget-store/src/lua/__tests__/enforce.spec.ts` — cover: CLOSED→ALLOWED, CLOSED→TRIPPED, OPEN→DENIED, OPEN TTL expired→HALF_OPEN probe, HALF_OPEN→CLOSED, HALF_OPEN→OPEN, concurrent debit race, no-budget key scenario. Tests MUST fail before T022.
- [x] T022 Implement `libs/budget-store/src/lib/budget-store.service.ts` — NestJS injectable: `SCRIPT LOAD` enforce.lua on bootstrap via ioredis, `evalEnforce(signal)` calling EVALSHA with Hash Tag keys `{orgId:budgetId}`, cluster-pinned connection config, fail-safe deny on Redis connection error
- [x] T023 [P] Create RabbitMQ exchange/queue topology config in `apps/api/src/messaging/rabbitmq.config.ts` (topic exchange `governor.events`, queues `governor.spend` and `governor.alerts`, routing keys `spend.recorded` and `budget.breached`)
- [x] T024 [P] Create NestJS microservice client module in `apps/api/src/messaging/events.module.ts` using `@nestjs/microservices` RmqTransport, connecting to `governor.events` exchange

**Checkpoint**: Foundation ready — T011–T024 complete. User story implementation can begin.

---

## Phase 3: User Story 1 — Real-Time Budget Enforcement (Priority: P1) 🎯 MVP

**Goal**: Atomic budget check + circuit breaker enforcement via `POST /v1/enforce`. Playwright requests denied fail-fast when budget exhausted.

**Independent Test**: See quickstart.md Validation Scenario 1 — create $1.00 budget, send 3×$0.40 requests, verify 3rd TRIPS and 4th DENIED in <10ms with no upstream call.

### Implementation for User Story 1

- [x] T025 [US1] Create `apps/api/src/enforce/enforce.controller.ts` — `@Post('/v1/enforce')` endpoint: deserialize request, call BudgetStoreService.evalEnforce(), return typed response (ALLOWED 200 / DENIED 402 / STORE_UNAVAILABLE 503) with all fields from contracts/api.md
- [x] T026 [US1] Create `apps/api/src/enforce/enforce.service.ts` — orchestrates: lookup Budget by (orgId,jobId,targetId) in PostgreSQL → resolve Provider pricing → compute costMicros via cost-engine pricing.ts → call budget-store EVALSHA → publish `spend.recorded` event to RabbitMQ → return CostResult
- [x] T027 [P] [US1] Create `apps/api/src/budgets/budgets.controller.ts` — `@Post('/v1/budgets')` create endpoint: validate request body, check 409 conflict on duplicate scope, persist Budget entity, warm Redis cap key via BudgetStoreService
- [x] T028 [P] [US1] Create `apps/api/src/budgets/budgets.service.ts` — Budget CRUD service: create, findByScope (orgId+jobId+targetId), findById, softDelete; enforces no floating-point in capMicros
- [x] T029 [US1] Create `apps/api/src/budgets/budgets.controller.ts` — remaining endpoints: `@Get('/v1/budgets/:id')` (Budget + Redis state snapshot), `@Patch('/v1/budgets/:id')`, `@Delete('/v1/budgets/:id')`, `@Post('/v1/budgets/:id/reset')` (transitions circuit to CLOSED via BudgetStoreService)
- [x] T030 [P] [US1] Create `libs/cost-engine/src/lib/adapters/scraperapi.adapter.ts` implementing `CostAdapter` — applies multiplierRules from Provider config, uses pricing.ts computeCostMicros, returns CostResult with BigInt costMicros
- [x] T031 [P] [US1] Create `libs/cost-engine/src/lib/adapters/brightdata.adapter.ts` implementing `CostAdapter` — same pattern as scraperapi adapter
- [x] T032 [US1] Wire `apps/api/src/app.module.ts` — import BudgetStoreModule, CostEngineModule, EnforceModule, BudgetsModule, TypeOrmModule with all entities, RabbitMQ EventsModule
- [x] T033 [US1] Create `libs/playwright-hook/src/lib/governor-hook.ts` — `GovernorHook` class: constructor accepts `{apiUrl, orgId, jobId}`, `attach(page, {targetId, provider, features})` method calls `page.route('**/*')` handler that POSTs to `/v1/enforce`, calls `route.abort()` on DENIED/STORE_UNAVAILABLE response, calls `route.continue()` on ALLOWED; throws `GovernorDeniedError` with `.state` on denial
- [x] T034 [P] [US1] Create `libs/playwright-hook/src/lib/errors.ts` — `GovernorDeniedError extends Error` with `state: 'OPEN' | 'NO_BUDGET' | 'STORE_UNAVAILABLE'` and `budgetId?: string`

**Checkpoint**: US1 complete — `POST /v1/enforce` enforces budgets atomically. Playwright hook aborts denied requests. Circuit breaker trips and resets. Validate with quickstart.md Scenarios 1, 6, 7.

---

## Phase 4: User Story 2 — Provider Cost Attribution & Spend Tracking (Priority: P2)

**Goal**: Spend records queryable by Job/Target/Provider with correct additive multiplier attribution. Idempotent event processing.

**Independent Test**: See quickstart.md Validation Scenarios 2, 3, 8 — jsRender+residential = 8× cost, retries debit separately, duplicate idempotencyKey stored once.

### Implementation for User Story 2

- [x] T035 [US2] Create `apps/worker/src/spend-rollup/spend-rollup.consumer.ts` — RabbitMQ consumer on `governor.spend` queue, manual ack, dead-letter queue config; on `spend.recorded` event: check idempotency via `SpendEvent.idempotencyKey` UNIQUE constraint, INSERT SpendEvent record (append-only), ack message; on duplicate key violation: ack without insert (idempotent)
- [x] T036 [P] [US2] Create `apps/worker/src/alerts/alerts.consumer.ts` — RabbitMQ consumer on `governor.alerts` queue; on `budget.breached` event: INSERT AlertEvent record, dispatch alert (log + future notification hook)
- [x] T037 [P] [US2] Create `apps/api/src/spend/spend.controller.ts` — `@Get('/v1/spend')` endpoint with query params: orgId (required), jobId, targetId, provider, from, to, page, limit (max 500); returns paginated SpendEvent records matching contracts/api.md response schema
- [x] T038 [US2] Create `apps/api/src/spend/spend.service.ts` — TypeORM query builder for paginated spend lookup; all monetary fields serialized as strings in response; no float conversion
- [x] T039 [US2] Wire `apps/worker/src/worker.module.ts` — import SpendRollupModule, AlertsModule, TypeOrmModule with SpendEvent + AlertEvent entities, RmqTransport microservice config

**Checkpoint**: US2 complete — spend records persist with correct multiplier attribution. Idempotent. Query endpoint returns filterable spend history. Validate with quickstart.md Scenarios 2, 3.

---

## Phase 5: User Story 3 — Budget Configuration & Live Dashboard (Priority: P3)

**Goal**: Next.js dashboard with live spend gauge, circuit breaker state badge, breach alerts via SSE, and budget CRUD + reset UI.

**Independent Test**: See quickstart.md Validation Scenario 5 — open dashboard, trigger enforce calls, verify spend gauge updates within 5s and OPEN badge appears without page refresh; reset circuit via UI button.

### Implementation for User Story 3

- [x] T040 [US3] Create `apps/api/src/stream/stream.controller.ts` — `@Sse('/v1/stream/budgets/:budgetId')` endpoint using NestJS `@Sse()` + `fromEvent()` RxJS observable; emits `spend`, `state_change`, `reset` event types from contracts/api.md; subscribes to RabbitMQ events for the given budgetId
- [x] T041 [US3] Create `apps/api/src/stream/stream.service.ts` — maintains per-budget SSE Subject; RabbitMQ `spend.recorded` and `budget.breached` events fan-out to matching budgetId subjects; serializes all costMicros fields as strings
- [x] T042 [P] [US3] Create RTK Query API slice `apps/dashboard/src/store/api/governor.api.ts` — endpoints: `getBudget`, `createBudget`, `updateBudget`, `deleteBudget`, `resetCircuit`, `getSpend`; `onCacheEntryAdded` lifecycle for SSE streaming on `streamBudget`
- [x] T043 [P] [US3] Create SSE streaming hook `apps/dashboard/src/store/hooks/useBudgetStream.ts` — wraps RTK Query `streamBudget` endpoint; handles reconnection on EventSource close; updates cached budget state on `state_change` events
- [x] T044 [P] [US3] Create budget list page `apps/dashboard/src/app/budgets/page.tsx` — table of budgets with orgId/jobId/targetId, capMicros (formatted as USD), current spend, circuit state badge (CLOSED=green, OPEN=red, HALF_OPEN=amber)
- [x] T045 [P] [US3] Create budget detail page `apps/dashboard/src/app/budgets/[id]/page.tsx` — live spend gauge (spend/cap ratio), circuit state badge, breach alert banner, Reset Circuit button; all monetary displays formatted from micro-dollars at component boundary
- [x] T046 [P] [US3] Create budget create/edit form `apps/dashboard/src/features/budgets/BudgetForm.tsx` — fields: orgId, jobId, targetId, capMicros (input in USD, converted to micro-dollars before POST), halfOpenTtlSeconds; validation: capMicros > 0, TTL 10–3600
- [x] T047 [US3] Wire Next.js Redux store `apps/dashboard/src/store/store.ts` — configure RTK Query middleware, governor.api reducer; wrap app root in `StoreProvider`

**Checkpoint**: US3 complete — dashboard shows live spend, circuit state updates within 5s, operators can create/reset budgets. Validate with quickstart.md Scenario 5.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Observability, structured logging, error hardening, and validation guide verification.

- [ ] T048 [P] Add structured JSON logging to `apps/api/src/enforce/enforce.service.ts` — emit log on every decision: `{jobId, targetId, orgId, budgetId, costMicros: string, decision, state, timestamp}` (constitution Principle VI)
- [ ] T049 [P] Add ioredis retry and reconnection config to `libs/budget-store/src/lib/budget-store.service.ts` — exponential backoff, max 3 retries before returning STORE_UNAVAILABLE
- [ ] T050 [P] Add NestJS global validation pipe to `apps/api/src/main.ts` — `class-validator` DTOs for all enforce and budget endpoints; reject requests with unknown providers
- [ ] T051 [P] Add RabbitMQ dead-letter queue config to `apps/worker/src/spend-rollup/spend-rollup.consumer.ts` — DLQ `governor.spend.dlq` for poison messages; alert on DLQ depth > threshold
- [ ] T052 [P] Add NX affected CI config (`.github/workflows/ci.yml` or `nx.json` `targetDefaults`) — `nx affected --target=lint,test,build` on PR. **CRITICAL (C2)**: CI lint step MUST include `nx run-many --target=lint --all`; verify `@nx/enforce-module-boundaries` ESLint rule causes lint failure on any cross-boundary import (test by temporarily adding a cross-boundary import and confirming CI rejects it)
- [x] T053 [P] Add append-only enforcement to `apps/api/src/spend/entities/spend-event.entity.ts` — no TypeORM `update`/`delete` repository calls permitted; add PostgreSQL migration `REVOKE UPDATE, DELETE ON spend_events FROM api_role` in `apps/api/src/database/migrations/002_spend_events_readonly.ts` (fix G1)
- [ ] T054 Run quickstart.md validation scenarios end-to-end and document results (Scenarios 1–7 in quickstart.md); fix any gaps found

---

## Phase 7: Convergence

- [x] T055 [P] Remove duplicate `return` branch in `libs/budget-store/src/lua/enforce.lua` lines 70–73 — both the `if state == 'HALF_OPEN'` branch and the else return identical values; collapse to a single `return {0, 'TRIPPED', tostring(newSpend), '0'}` after the OPEN state SET (partial, enforce.lua)
- [x] T056 [P] Unify `CostResult.decision` and `EnforceOutcome.state` type sets in `libs/cost-engine/src/lib/contracts.ts` and `libs/budget-store/src/lib/budget-store.service.ts` — document intentional divergence or extract shared `EnforcementDecision` type to contracts.ts (partial, FR-002 / plan: adapter pattern)
- [x] T057 [P] Register `@governor/cost-engine` and `@governor/budget-store` path aliases in root `tsconfig.base.json` `paths` section once NX workspace is initialized (T001) — required for cross-lib imports to resolve without relative paths (missing, plan §NX workspace)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — no dependency on US2/US3
- **US2 (Phase 4)**: Depends on Phase 2 — no dependency on US1 (uses shared entities from Phase 2)
- **US3 (Phase 5)**: Depends on Phase 2 — integrates with US1 (SSE stream uses RabbitMQ events from enforce flow); can start in parallel with US2
- **Polish (Phase 6)**: Depends on US1–US3 complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — independent of US2, US3
- **US2 (P2)**: Can start after Phase 2 — independent of US1 (worker consumes events; no direct call to US1 code)
- **US3 (P3)**: Can start dashboard scaffold after Phase 2; SSE endpoint integration requires US1 RabbitMQ events to be wired (T023–T024)

### Within Each User Story

- Domain contracts (T018) → pricing logic (T019) → Lua script (T020) → tests FAIL (T021) → service (T022)
- Models → services → controllers → wiring
- Complete story before moving to next priority

### Parallel Opportunities

- T003–T010 (all Phase 1 lib/app scaffolds) run in parallel
- T012–T015 (entity creation) run in parallel after T011
- T027, T028, T030, T031, T034 run in parallel within US1
- T036, T037 run in parallel within US2
- T042–T047 run in parallel within US3
- T048–T052 run in parallel in Polish phase

---

## Parallel Example: Phase 2 Foundational

```bash
# Run in parallel:
Task T012: "Create Budget entity in apps/api/src/budgets/entities/budget.entity.ts"
Task T013: "Create Provider entity in apps/api/src/providers/entities/provider.entity.ts"
Task T014: "Create SpendEvent entity in apps/api/src/spend/entities/spend-event.entity.ts"
Task T015: "Create AlertEvent entity in apps/api/src/alerts/entities/alert-event.entity.ts"

# Then sequentially:
Task T016: "Generate TypeORM migration for all four entities"
```

## Parallel Example: User Story 1

```bash
# Run in parallel after T022 complete:
Task T027: "Create budgets POST controller in apps/api/src/budgets/budgets.controller.ts"
Task T028: "Create BudgetsService in apps/api/src/budgets/budgets.service.ts"
Task T030: "Create scraperapi adapter in libs/cost-engine/src/lib/adapters/scraperapi.adapter.ts"
Task T031: "Create brightdata adapter in libs/cost-engine/src/lib/adapters/brightdata.adapter.ts"
Task T034: "Create GovernorDeniedError in libs/playwright-hook/src/lib/errors.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 6, 7 independently
5. Deploy/demo enforcement working end-to-end

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Enforcement live → Validate → Demo (MVP!)
3. US2 → Attribution + spend query → Validate → Demo
4. US3 → Dashboard → Validate → Demo
5. Polish → Hardening + CI

### Parallel Team Strategy

With multiple developers after Phase 2 complete:
- Developer A: US1 (enforcement + Playwright hook)
- Developer B: US2 (worker + spend query)
- Developer C: US3 (dashboard scaffold while US1 SSE events being wired)

---

## Notes

- `[P]` = different files, no blocking dependencies — safe to run in parallel
- `[Story]` label maps task to user story for independent delivery traceability
- T021 is marked TEST-FIRST per constitution Principle V — enforce.lua tests MUST fail before T022 implements the service
- All monetary BigInt fields serialize as strings in JSON — never use `JSON.parse` directly on costMicros values
- Commit after each task or logical group; stop at any checkpoint to validate story independently
- Checklist format: every task has checkbox `- [ ]`, task ID `TXXX`, optional `[P]` and `[US?]` labels, exact file path

---

## Phase 8: Convergence

- [x] T058 CRITICAL: Remove `app.setGlobalPrefix('v1')` from `apps/api/src/main.ts` — controllers already declare `v1/` in their `@Controller()` decorators producing double-prefix `/v1/v1/*` routes that break all API endpoints (contradicts, FR-002 / US1)
- [x] T059 [P] Create `libs/playwright-hook/package.json` — `name: @governor/playwright-hook`, `publishConfig.access=public`, `peerDependencies: { playwright: ">=1.40.0", "@playwright/test": ">=1.40.0" }` (both optional), `exports` map, `files: ["src", "!src/**/*.spec.*", "!src/**/__tests__"]`, `version: 0.1.0`, `license: MIT` per plan: package config (missing)
- [x] T060 [P] Create `libs/cost-engine/package.json` — `name: @governor/cost-engine`, `publishConfig.access=public`, zero `dependencies`, `exports` map, `files: ["src", "!src/**/*.spec.*", "!src/**/__tests__"]`, `version: 0.1.0`, `license: MIT` per plan: package config (missing)
- [x] T061 Add `release` config block to `nx.json` — `projects: ["playwright-hook", "cost-engine"]`, `projectsRelationship: "independent"`, `version.conventionalCommits: true`, `version.generatorOptions.currentVersionResolver: "git-tag"`, `changelog.projectChangelogs: true`, `releaseTagPattern: "{projectName}@{version}"` per plan: nx release (missing)
- [x] T062 [P] Create `.github/workflows/ci.yml` — triggers on `pull_request` to `main`; steps: `actions/checkout@v4` with `fetch-depth: 0`, `pnpm/action-setup@v3`, `actions/setup-node@v4` with cache, `pnpm install --frozen-lockfile`, `pnpm nx affected --target=lint --base=origin/main`, `pnpm nx affected --target=test --base=origin/main`, `pnpm nx affected --target=build --base=origin/main` per plan: CI/CD (missing)
- [x] T063 [P] Create `.github/workflows/release.yml` — triggers on push to `main`; permissions `contents: write`, `id-token: write`; steps: checkout, pnpm setup, node setup with `registry-url: https://registry.npmjs.org`, install, build both publishable libs, `git config` for bot, `pnpm nx release --skip-publish`, `pnpm nx release publish` with `NODE_AUTH_TOKEN` and `NPM_CONFIG_PROVENANCE=true` per plan: CI/CD (missing)
- [x] T064 Install `class-validator` and `class-transformer` at workspace root (`pnpm add class-validator class-transformer -w`), add `useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))` to `apps/api/src/main.ts`, create request DTO classes with decorators for `EnforceRequestDto` in `apps/api/src/enforce/enforce.controller.ts` and `CreateBudgetDto`/`UpdateBudgetDto` in `apps/api/src/budgets/budgets.service.ts` per T050 / FR-002 (missing)
- [x] T065 Add dead-letter-exchange args to worker RmqTransport options in `apps/worker/src/main.ts` — `queueOptions.arguments: { 'x-dead-letter-exchange': 'governor.events.dlx', 'x-dead-letter-routing-key': 'governor.spend.dlq' }` per T051 (partial)
- [x] T066 [P] Create `LICENSE` at repo root — MIT license, copyright line `Copyright (c) 2026 Governor Contributors` per plan: open-source governance (missing)
- [x] T067 [P] Create `CONTRIBUTING.md` at repo root — sections: fork/clone, branch naming (`feat/`, `fix/`, `chore/`), local dev setup (`pnpm install`, `docker compose up -d`, `pnpm nx test`), Conventional Commits format, constitution check requirement, PR process per plan: open-source governance (missing)
- [x] T068 [P] Create `SECURITY.md` at repo root — responsible disclosure policy: report via GitHub private security advisory, response SLA 7 days, no public disclosure until patch released per plan: open-source governance (missing)
- [x] T069 [P] Create `.github/PULL_REQUEST_TEMPLATE.md` — checklist: constitution principles I–VI, BigInt compliance (`no number for money`), test coverage, CHANGELOG entry for public lib changes, peerDependencies updated if new peer added per plan: open-source governance (missing)
- [x] T070 Fix structured log in `apps/api/src/enforce/enforce.service.ts` ALLOWED/DENIED paths — add `budgetId` field to the `this.logger.log(...)` call that fires after `evalEnforce()` returns; ensures every decision log contains all 7 required fields per constitution VI (partial)
- [x] T071 [P] Create `CODE_OF_CONDUCT.md` at repo root — Contributor Covenant 2.1 text, enforcement contact email placeholder per plan: open-source governance (missing)
- [ ] T072 Run quickstart.md validation scenarios 1–7 against a live stack (`docker compose up -d` + `pnpm nx serve api`) and document pass/fail results inline in `specs/001-budget-governor/quickstart.md` per T054 (missing)
