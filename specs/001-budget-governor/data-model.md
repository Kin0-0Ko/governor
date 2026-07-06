# Data Model: Scraping Cost Control & Budget Governor

## Entities

---

### Budget

Represents a spending cap for a three-part scope key.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | UUID | PK, auto-generated |
| `orgId` | string | NOT NULL, indexed |
| `jobId` | string | NOT NULL, indexed |
| `targetId` | string | NOT NULL, indexed |
| `capMicros` | bigint | NOT NULL, > 0 |
| `halfOpenTtlSeconds` | integer | NOT NULL, default 60 |
| `createdAt` | timestamp | NOT NULL |
| `updatedAt` | timestamp | NOT NULL |

**Unique constraint**: `(orgId, jobId, targetId)` — one budget per scope triple.

**Validation rules**:
- `capMicros` MUST be > 0 and expressed as BigInt micro-dollars.
- `halfOpenTtlSeconds` MUST be in range [10, 3600].
- All three scope fields MUST be non-empty strings.

---

### CircuitBreakerState (Redis-only, not persisted in PostgreSQL)

Maintained exclusively in Redis Hot Path keys. Not a PostgreSQL entity.

| Redis Key | Value | Notes |
|-----------|-------|-------|
| `budget:{orgId:budgetId}:state` | `CLOSED` \| `OPEN` \| `HALF_OPEN` | FSM state |
| `budget:{orgId:budgetId}:spend` | string (micro-dollars) | Cumulative spend, atomic |
| `budget:{orgId:budgetId}:cap` | string (micro-dollars) | Mirrored from PostgreSQL |
| `budget:{orgId:budgetId}:ttl_exp` | UNIX timestamp string | OPEN expiry for HALF_OPEN probe |

**State transitions**:
```
CLOSED ──(spend >= cap)──► OPEN
OPEN   ──(TTL expired)──► HALF_OPEN
HALF_OPEN ──(probe passes)──► CLOSED
HALF_OPEN ──(probe fails)──► OPEN
Manual reset ──────────────► CLOSED (any state)
```

---

### SpendEvent (PostgreSQL — append-only)

Immutable record of a single intercepted request's attributed cost.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | UUID | PK, auto-generated |
| `idempotencyKey` | string | UNIQUE, NOT NULL |
| `orgId` | string | NOT NULL, indexed |
| `jobId` | string | NOT NULL, indexed |
| `targetId` | string | NOT NULL, indexed |
| `budgetId` | UUID | FK → Budget.id, NOT NULL |
| `provider` | string | NOT NULL (e.g., `scraperapi`, `brightdata`) |
| `baseRateMicros` | bigint | NOT NULL, base cost before multipliers |
| `totalCostMicros` | bigint | NOT NULL, final debited cost |
| `multiplierSum` | integer | NOT NULL, default 1 (additive sum of active multipliers) |
| `features` | string[] | Active premium features (e.g., `["jsRender", "residential"]`) |
| `decision` | enum | `ALLOWED` \| `DENIED` \| `TRIPPED` |
| `requestTimestamp` | timestamp | NOT NULL |
| `recordedAt` | timestamp | NOT NULL, server-side |

**No UPDATE or DELETE permitted on this table** — append-only by design.

**Idempotency key derivation**:
```
SHA256(jobId + ":" + targetId + ":" + provider + ":" + requestTimestamp.toISOString() + ":" + retryIndex)
```

---

### Provider (configuration — PostgreSQL)

Pricing configuration for an anti-bot or proxy vendor.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | UUID | PK |
| `name` | string | UNIQUE, NOT NULL (e.g., `scraperapi`) |
| `baseRateMicros` | bigint | NOT NULL, cost per request in micro-dollars |
| `multiplierRules` | jsonb | Array of `{feature: string, addend: integer}` |
| `active` | boolean | NOT NULL, default true |
| `createdAt` | timestamp | NOT NULL |
| `updatedAt` | timestamp | NOT NULL |

**Multiplier rule example**:
```json
[
  { "feature": "jsRender",    "addend": 5 },
  { "feature": "residential", "addend": 3 }
]
```
Total multiplier = 1 (base) + sum of addends for active features.
Total cost = `baseRateMicros * BigInt(totalMultiplier)`.

---

### AlertEvent (PostgreSQL — append-only)

Records budget breach and circuit breaker trip events for audit and dashboard.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | UUID | PK |
| `budgetId` | UUID | FK → Budget.id, NOT NULL |
| `orgId` | string | NOT NULL, indexed |
| `eventType` | enum | `BUDGET_BREACHED` \| `CIRCUIT_TRIPPED` \| `HALF_OPEN_PROBE` \| `CIRCUIT_RESET` |
| `spendAtEventMicros` | bigint | NOT NULL |
| `capMicros` | bigint | NOT NULL |
| `occurredAt` | timestamp | NOT NULL |

---

## Relationships

```
Organization (orgId: string, external)
  └── 1:N Budget
         └── 1:N SpendEvent
         └── 1:N AlertEvent

Provider (global config)
  └── referenced by SpendEvent.provider (string name)
```

---

## Key Invariants

1. `SpendEvent.totalCostMicros = SpendEvent.baseRateMicros * BigInt(SpendEvent.multiplierSum)`
2. `CircuitBreakerState.spend` (Redis) converges with `SUM(SpendEvent.totalCostMicros WHERE budgetId = X AND decision = 'ALLOWED')` in Cold Path (eventual consistency acceptable; Hot Path is authoritative for enforcement).
3. No floating-point values anywhere in the data model — all monetary fields are `bigint`.
4. `SpendEvent` table has no foreign key cascade deletes; Budget deletion is a soft operation only.
