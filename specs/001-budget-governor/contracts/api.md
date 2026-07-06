# API Contracts: Scraping Cost Control & Budget Governor

All monetary values transmitted as **strings** representing micro-dollars (BigInt-safe).
Base URL: `http://localhost:3000/v1` (configurable via `GOVERNOR_API_URL`).

---

## Hot Path Enforcement

### POST /v1/enforce

Atomic budget check + spend debit. Called by `libs/playwright-hook` before each request.
Must respond in <10ms p99.

**Request**:
```json
{
  "orgId": "org-123",
  "jobId": "job-456",
  "targetId": "target-789",
  "provider": "scraperapi",
  "features": ["jsRender"],
  "idempotencyKey": "sha256-derived-key",
  "requestTimestamp": "2026-07-06T12:00:00.000Z",
  "retryIndex": 0
}
```

**Response 200 — ALLOWED**:
```json
{
  "decision": "ALLOWED",
  "costMicros": "5000000",
  "remainingMicros": "45000000",
  "state": "CLOSED"
}
```

**Response 402 — DENIED (budget exhausted)**:
```json
{
  "decision": "DENIED",
  "state": "OPEN",
  "budgetId": "uuid",
  "message": "Budget cap reached for scope org-123/job-456/target-789"
}
```

**Response 402 — DENIED (no budget configured)**:
```json
{
  "decision": "DENIED",
  "state": "NO_BUDGET",
  "message": "No budget configured for scope. Explicit budget required before spend is authorized."
}
```

**Response 503 — enforcement store unavailable**:
```json
{
  "decision": "DENIED",
  "state": "STORE_UNAVAILABLE",
  "message": "Enforcement store unreachable. Fail-safe deny."
}
```

---

## Budget Management

### POST /v1/budgets

Create a budget cap for a scope.

**Request**:
```json
{
  "orgId": "org-123",
  "jobId": "job-456",
  "targetId": "target-789",
  "capMicros": "1000000000",
  "halfOpenTtlSeconds": 60
}
```

**Response 201**:
```json
{
  "id": "uuid",
  "orgId": "org-123",
  "jobId": "job-456",
  "targetId": "target-789",
  "capMicros": "1000000000",
  "halfOpenTtlSeconds": 60,
  "createdAt": "2026-07-06T12:00:00.000Z"
}
```

**Response 409** — budget already exists for scope.

---

### GET /v1/budgets/:budgetId

Retrieve budget + current circuit breaker state.

**Response 200**:
```json
{
  "id": "uuid",
  "orgId": "org-123",
  "jobId": "job-456",
  "targetId": "target-789",
  "capMicros": "1000000000",
  "halfOpenTtlSeconds": 60,
  "circuitState": "CLOSED",
  "spendMicros": "125000000",
  "remainingMicros": "875000000",
  "updatedAt": "2026-07-06T12:00:00.000Z"
}
```

---

### PATCH /v1/budgets/:budgetId

Update cap or TTL. Takes effect on next enforcement evaluation.

**Request** (partial):
```json
{
  "capMicros": "2000000000",
  "halfOpenTtlSeconds": 120
}
```

**Response 200**: Updated budget object (same shape as GET).

---

### DELETE /v1/budgets/:budgetId

Soft-delete budget (sets `active: false`). Existing spend records retained.

**Response 204**: No content.

---

### POST /v1/budgets/:budgetId/reset

Manually reset circuit breaker to CLOSED state.

**Response 200**:
```json
{
  "budgetId": "uuid",
  "previousState": "OPEN",
  "newState": "CLOSED",
  "resetAt": "2026-07-06T12:05:00.000Z"
}
```

---

## Spend Query

### GET /v1/spend

Query spend records with filters. Used for attribution dashboard and reconciliation export.

**Query params**:
- `orgId` (required)
- `jobId` (optional)
- `targetId` (optional)
- `provider` (optional)
- `from` (ISO8601, optional)
- `to` (ISO8601, optional)
- `page` (integer, default 1)
- `limit` (integer, default 50, max 500)

**Response 200**:
```json
{
  "total": 1240,
  "page": 1,
  "limit": 50,
  "items": [
    {
      "id": "uuid",
      "jobId": "job-456",
      "targetId": "target-789",
      "provider": "scraperapi",
      "features": ["jsRender"],
      "baseRateMicros": "1000000",
      "totalCostMicros": "5000000",
      "multiplierSum": 5,
      "decision": "ALLOWED",
      "requestTimestamp": "2026-07-06T12:00:00.000Z"
    }
  ]
}
```

---

## Real-Time Dashboard Stream

### GET /v1/stream/budgets/:budgetId

Server-Sent Events stream for live dashboard updates.

**Event types**:
```
event: spend
data: {"spendMicros":"125000000","remainingMicros":"875000000","state":"CLOSED","ts":"2026-07-06T12:00:01Z"}

event: state_change
data: {"previousState":"CLOSED","newState":"OPEN","ts":"2026-07-06T12:05:00Z","budgetId":"uuid"}

event: reset
data: {"newState":"CLOSED","ts":"2026-07-06T12:10:00Z","budgetId":"uuid"}
```

**Connection**: `text/event-stream`, keep-alive. Client reconnects on disconnect.

---

## Playwright Hook Client Contract

### `@governor/playwright-hook` npm package API

```typescript
// Initialization
import { GovernorHook } from '@governor/playwright-hook';

const hook = new GovernorHook({
  apiUrl: 'http://localhost:3000',
  orgId: 'org-123',
  jobId: 'job-456',
});

// Attach to Playwright page (intercepts all requests)
await hook.attach(page, {
  targetId: 'target-789',
  provider: 'scraperapi',
  features: ['jsRender'],
});

// hook.attach() returns void; throws GovernorDeniedError on DENIED decisions
// GovernorDeniedError.state: 'OPEN' | 'NO_BUDGET' | 'STORE_UNAVAILABLE'
```

All cost values in hook configuration are strings (micro-dollars). The hook has no
pricing logic — it forwards request metadata to `POST /v1/enforce` and aborts the
Playwright route on non-ALLOWED decisions.
