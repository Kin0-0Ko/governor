# Feature Specification: Scraping Cost Control & Budget Governor

**Feature Branch**: `001-budget-governor`

**Created**: 2026-07-06

**Status**: Clarified

**Input**: User description: "Develop the Scraping Cost Control & Budget Governor platform. The application must intercept automated browser requests (specifically Playwright), dynamically track real-time operational expenditures across various anti-bot and proxy providers, attribute spending patterns to explicit Job IDs and Target IDs, and enforce live budget caps. When a defined budget scope is breached, an atomic circuit breaker must instantly trip, forcing subsequent automated requests within that scope to fail-fast and abort before incurring upstream provider costs."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real-Time Budget Enforcement (Priority: P1)

A scraping operator configures a budget cap for a specific Job ID and Target ID
combination. As their Playwright automation runs, each request is intercepted and
its cost is evaluated against the cap in real time. When the budget is exhausted,
all subsequent requests within that scope immediately fail-fast without contacting
the upstream provider, preventing cost overrun.

**Why this priority**: This is the core safety guarantee of the platform. Without
it no other feature provides value. It directly prevents financial harm.

**Independent Test**: Configure a $1.00 budget for Job `job-001` / Target `target-abc`.
Run a Playwright script that would cost $1.50 total. Verify the first N requests succeed
and the remaining requests fail immediately with a budget-exceeded error — and that
no upstream provider calls are made after the cap is hit.

**Acceptance Scenarios**:

1. **Given** a budget cap of $1.00 is set for `{jobId: "j1", targetId: "t1"}`,
   **When** Playwright requests accumulate $1.00 in provider costs,
   **Then** the circuit breaker trips to OPEN state and all further requests in that
   scope return a fail-fast error within 10ms without reaching the provider.

2. **Given** the circuit breaker is OPEN for a scope,
   **When** a new request arrives for that scope,
   **Then** it is denied immediately with no upstream call and a structured error
   payload identifying the breached budget.

3. **Given** a budget cap is configured for scope A,
   **When** requests arrive for scope B (different jobId/targetId),
   **Then** scope B requests are evaluated independently and are not affected by
   scope A's circuit breaker state.

---

### User Story 2 - Provider Cost Attribution & Spend Tracking (Priority: P2)

An operator can view a real-time breakdown of operational spend attributed to each
Job ID and Target ID, across multiple anti-bot and proxy providers. They can see
which providers are most expensive, identify cost spikes, and correlate spend to
specific scraping campaigns.

**Why this priority**: Visibility into spend patterns is essential for budget planning
and vendor cost negotiation. It enables operators to act before budgets are exhausted.

**Independent Test**: Run scraping jobs using two different provider configurations
(e.g., standard proxy vs. JS-rendering proxy). Query the spend attribution API for
a given Job ID and verify costs are split correctly by provider, with accurate
per-request cost records.

**Acceptance Scenarios**:

1. **Given** requests are routed through a JS-rendering provider (which applies a
   cost multiplier),
   **When** spend is recorded,
   **Then** the attributed cost reflects the multiplied rate, not the base rate.

2. **Given** multiple jobs are running concurrently across different target domains,
   **When** the operator queries spend by Job ID,
   **Then** spend records are correctly isolated per job with no cross-attribution.

3. **Given** a spend event is recorded,
   **When** the same event is delivered a second time (duplicate),
   **Then** the ledger records it only once (idempotent ingestion).

---

### User Story 3 - Budget Configuration & Live Dashboard (Priority: P3)

An operator can create, update, and delete budget caps for any combination of
organization, Job ID, and Target ID through a self-service interface. A live
dashboard displays current spend vs. budget, circuit breaker states, and recent
breach alerts in real time.

**Why this priority**: Without configuration tooling, budgets must be set via
direct infrastructure access. The dashboard closes the feedback loop so operators
act on live data rather than after-the-fact reports.

**Independent Test**: Create a budget cap via the UI, trigger a scraping job that
approaches the cap, and verify the dashboard updates spend in real time and displays
a breach alert when the cap is hit — without requiring a page refresh.

**Acceptance Scenarios**:

1. **Given** an operator submits a new budget cap via the dashboard,
   **When** the next request arrives for that scope,
   **Then** the enforcement layer applies the new cap without requiring a service restart.

2. **Given** a circuit breaker trips to OPEN,
   **When** the dashboard is open,
   **Then** the breach alert appears within 5 seconds without a manual refresh.

3. **Given** an operator resets a tripped circuit breaker via the dashboard,
   **When** the next request arrives for that scope,
   **Then** the breaker enters HALF_OPEN state and allows a probe request through.

---

### Edge Cases

- What happens when a provider returns a cost that would push spend over the cap
  mid-request? The cap must be enforced atomically — no partial overruns.
- How does the system handle a provider pricing configuration that has not yet been
  loaded (unknown provider)? Requests MUST be denied fail-safe until pricing is known.
- What happens if the enforcement store (Redis) is temporarily unreachable?
  The system MUST fail-safe: deny requests rather than allow uncapped spend.
- What if two requests for the same scope arrive simultaneously and together would
  exceed the budget? Atomic enforcement MUST prevent both from passing when only one
  fits within the remaining headroom.
- What if a job has no explicit budget cap configured? Requests MUST be hard-denied —
  no cap configured means zero spend authorized. There is no org-level fallback cap;
  operators MUST explicitly create a budget before any spend for that scope is allowed.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST intercept all outbound HTTP requests made by Playwright
  automation scripts before they reach upstream anti-bot or proxy providers. Each
  interception (including retries of a previously failed request) is treated as an
  independent cost event — cost is debited at the interception gate regardless of
  whether the upstream call ultimately succeeds or fails.
- **FR-002**: The system MUST evaluate the projected cost of each intercepted request
  against the active budget cap for the associated Job ID and Target ID scope within
  10ms of interception.
- **FR-003**: The system MUST atomically increment spend and enforce budget caps such
  that no race condition can allow spend to exceed the configured cap.
- **FR-004**: The system MUST trip the circuit breaker to OPEN state the moment
  cumulative spend reaches or exceeds the configured cap for a scope.
- **FR-005**: The system MUST return a fail-fast denial to the Playwright hook for
  any request arriving while the circuit breaker is OPEN, without making any upstream
  provider call.
- **FR-006**: The system MUST attribute every spend event to an explicit Job ID,
  Target ID, and provider identity.
- **FR-007**: The system MUST support dynamic pricing rules per provider, including
  cost multipliers for premium features (e.g., JavaScript rendering, residential
  proxy routing). When multiple premium features are active on a single request,
  their multipliers MUST be summed additively (e.g., jsRender 5× + residential 3×
  = 8× base rate) to produce a single deterministic total multiplier.
- **FR-008**: The system MUST persist every spend event to an append-only ledger
  suitable for vendor invoice reconciliation.
- **FR-009**: The system MUST accept spend events idempotently — duplicate event
  delivery MUST NOT result in double-counted spend.
- **FR-010**: The system MUST provide a self-service interface for operators to
  create, update, and delete budget caps per organization, Job ID, and Target ID.
- **FR-011**: The system MUST display live spend-vs-budget metrics and circuit
  breaker states on a dashboard with updates delivered within 5 seconds of the
  underlying event.
- **FR-012**: When the enforcement store is unreachable, the system MUST deny all
  requests fail-safe rather than allow uncapped spend.
- **FR-013**: The system MUST support the HALF_OPEN circuit breaker probe state,
  allowing a single probe request after a configurable TTL (default: 60 seconds,
  configurable per budget scope), transitioning back to CLOSED if the probe passes
  within budget headroom, or back to OPEN if the scope remains exhausted.

### Key Entities

- **Budget**: A spending cap scoped to an `{orgId, jobId, targetId}` triple, expressed
  as a micro-dollar BigInt ceiling, with an associated circuit breaker state.
- **SpendEvent**: An immutable record of a single request's attributed cost, linked to
  a Budget scope, provider identity, request timestamp, and idempotency key.
- **Provider**: A configured anti-bot or proxy vendor with a base cost rate and
  conditional multiplier rules (e.g., jsRender: 5× base rate).
- **CircuitBreaker**: The FSM state (`CLOSED` / `OPEN` / `HALF_OPEN`) associated with
  a Budget, controlling whether requests in that scope are allowed or denied.
- **Job**: A logical grouping of scraping tasks identified by Job ID, owned by an
  organization, with one or more associated Budgets.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Budget enforcement decisions are returned to the Playwright hook in
  under 10ms at p99 under production load.
- **SC-002**: Zero cases of spend exceeding a configured cap due to race conditions
  under concurrent load testing with 100+ simultaneous requests per scope.
- **SC-003**: Spend attribution accuracy is 100% — every upstream provider call is
  recorded in the ledger with correct cost, Job ID, Target ID, and provider identity.
- **SC-004**: Duplicate spend event delivery results in 0% double-counting across
  1,000 idempotency test cases.
- **SC-005**: Dashboard spend metrics reflect real-time events within 5 seconds of
  occurrence for 95% of updates.
- **SC-006**: Operators can create or update a budget cap and have it enforced on the
  next arriving request without any service restart.
- **SC-007**: When the enforcement store is unavailable, 100% of requests are denied
  (fail-safe) rather than passed through uncapped.

---

## Clarifications

### Session 2026-07-06

- Q: When a Playwright request fails at the provider and is retried, how is cost attributed? → A: Each retry attempt is treated as a new independent request — cost debited at interception, regardless of upstream outcome.
- Q: When multiple premium features are active on a single request, how are cost multipliers combined? → A: Additive — multipliers sum (e.g., jsRender 5× + residential 3× = 8× base rate).
- Q: What TTL governs automatic OPEN → HALF_OPEN transition? → A: 60 seconds (default, operator-configurable per budget scope).
- Q: When no budget cap is configured for a scope, what happens? → A: Hard deny — no cap = zero spend authorized; no org-level fallback; operators must explicitly configure a budget before spend is allowed.

---

## Assumptions

- Playwright is the primary (and initially only) automation framework to be instrumented;
  other browser automation tools are out of scope for v1.
- Provider pricing configurations are managed by platform operators, not end users;
  self-service provider onboarding is out of scope for v1.
- A single Redis deployment (cluster-mode capable) serves as the enforcement store;
  multi-region active-active Redis is out of scope for v1.
- Budget scopes are always a three-part key (`orgId + jobId + targetId`). No
  org-level fallback cap exists; absence of an explicit budget = hard deny.
- The append-only spend ledger is the system of record for billing reconciliation;
  the platform does not itself bill providers — it records what was spent.
- Operators authenticate via the existing organizational identity system; the platform
  does not implement its own auth.
- Budget caps are denominated in USD micro-dollars (BigInt); multi-currency support
  is out of scope for v1.
