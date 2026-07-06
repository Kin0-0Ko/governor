# Research: Scraping Cost Control & Budget Governor

## NX Monorepo Structure

**Decision**: NX workspace with `apps/` and `libs/` enforced via project tags and `@nx/enforce-module-boundaries` ESLint rule.

**Rationale**: NX provides build caching, affected-graph CI, and compile-time module boundary enforcement matching the constitution's scope tag taxonomy. Alternative (Turborepo) lacks the mature module boundary plugin.

**Tag enforcement config** (`.eslintrc.json` root):
```json
{
  "depConstraints": [
    { "sourceTag": "scope:domain",   "onlyDependOnLibsWithTags": ["scope:domain"] },
    { "sourceTag": "scope:infra",    "onlyDependOnLibsWithTags": ["scope:domain", "scope:infra"] },
    { "sourceTag": "scope:api",      "onlyDependOnLibsWithTags": ["scope:domain", "scope:infra"] },
    { "sourceTag": "scope:worker",   "onlyDependOnLibsWithTags": ["scope:domain", "scope:infra"] },
    { "sourceTag": "scope:frontend", "onlyDependOnLibsWithTags": ["scope:domain"] },
    { "sourceTag": "scope:client",   "onlyDependOnLibsWithTags": ["scope:domain"] }
  ]
}
```

---

## Hot Path: Redis Lua + ioredis EVALSHA

**Decision**: Single Lua script loaded via `SCRIPT LOAD` at NestJS bootstrap; invoked via `EVALSHA` on every request interception. Hash Tags `{orgId:budgetId}` on all Hot Path keys.

**Rationale**: `EVALSHA` eliminates script transmission overhead on repeated calls. Single atomic `EVAL` guarantees no race between read-check-increment. Hash Tags pin all keys for a budget scope to one Redis slot — mandatory for Cluster mode to avoid CROSSSLOT errors.

**Key naming convention**:
```
budget:{orgId:budgetId}:spend    → INCR target (BigInt micro-dollars as string)
budget:{orgId:budgetId}:state    → FSM state string: CLOSED | OPEN | HALF_OPEN
budget:{orgId:budgetId}:cap      → ceiling in micro-dollars
budget:{orgId:budgetId}:ttl_exp  → UNIX timestamp of OPEN→HALF_OPEN probe window
```

**Alternatives considered**: Redis Streams with server-side consumer (too much latency); application-layer check-then-set with optimistic locking (race window exists).

---

## Lua FSM Logic

**Decision**: Lua script encodes all three FSM transitions atomically:

```lua
-- Pseudocode (full implementation in libs/budget-store/src/lua/enforce.lua)
local state = redis.call('GET', stateKey)
if state == 'OPEN' then
  local exp = tonumber(redis.call('GET', ttlKey) or '0')
  if now < exp then return {0, 'OPEN'} end   -- still within OPEN window → deny
  redis.call('SET', stateKey, 'HALF_OPEN')
  state = 'HALF_OPEN'
end
if state == 'HALF_OPEN' then
  -- only one probe allowed; immediately re-OPEN if over cap after probe
end
local spend = redis.call('INCRBY', spendKey, costMicros)
local cap   = tonumber(redis.call('GET', capKey))
if spend >= cap then
  redis.call('SET', stateKey, 'OPEN')
  redis.call('SET', ttlKey, now + ttlSeconds)
  return {0, 'TRIPPED'}
end
return {1, 'ALLOWED'}
```

---

## Cold Path: PostgreSQL + TypeORM Append-Only Ledger

**Decision**: TypeORM entities with no `UPDATE`/`DELETE` on `spend_events`. Idempotency via unique constraint on `(idempotency_key)`. RabbitMQ events trigger Cold Path writes asynchronously.

**Rationale**: Append-only ensures audit trail integrity for vendor invoice reconciliation (FR-008). Unique constraint on idempotency key enforces FR-009 at the DB level, not just application layer.

**Idempotency key**: `SHA256(jobId + targetId + provider + requestTimestamp + retryIndex)` — deterministic, derivable by the hook without coordination.

**Alternatives considered**: Event sourcing with separate event store (Kafka) — overkill for v1; adds operational complexity without benefit at current scale.

---

## RabbitMQ NestJS Integration

**Decision**: `@nestjs/microservices` with `RmqTransport`. `apps/api` publishes spend events post-Hot-Path gate. `apps/worker` consumes with manual ack and dead-letter queue.

**Rationale**: Manual ack prevents event loss on worker crash. DLQ captures poison messages for ops investigation without blocking the queue.

**Exchange topology**:
```
Exchange: governor.events (topic)
  Routing key: spend.recorded   → queue: governor.spend
  Routing key: budget.breached  → queue: governor.alerts
```

---

## Real-Time Dashboard: RTK Query + SSE

**Decision**: Server-Sent Events (SSE) via NestJS `@Sse()` endpoint; RTK Query `onCacheEntryAdded` lifecycle for streaming updates.

**Rationale**: SSE is unidirectional (server→client), simpler than WebSockets for this use case (no client→server stream needed). RTK Query's streaming lifecycle handles connection management and cache invalidation cleanly.

**Alternatives considered**: WebSockets (bidirectional overhead not needed); polling every N seconds (violates SC-005 <5s update requirement at low poll intervals, wasteful at high intervals).

---

## Playwright Hook Design

**Decision**: `libs/playwright-hook` uses Playwright's `page.route()` interception API. Before each request is fulfilled, it calls the Governor API (`POST /v1/enforce`) synchronously and aborts the route if denied.

**Rationale**: `page.route()` is the only Playwright-native interception point that supports aborting before the network call. The hook is a thin client — all pricing and FSM logic stays server-side.

**publishable**: Yes — packaged as `@governor/playwright-hook` for npm distribution. Zero NestJS/framework dependencies; only peer dep is `playwright`.

---

## BigInt Transport

**Decision**: All micro-dollar values serialized as strings in JSON (`"costMicros": "5000000"`) and parsed to `BigInt` at library boundaries. Never serialized as JSON `number`.

**Rationale**: JSON `number` loses precision for large BigInt values. String round-trips safely. Matches constitution Principle II.
