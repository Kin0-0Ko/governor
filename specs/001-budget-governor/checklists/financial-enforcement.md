# Financial Enforcement Checklist: Scraping Cost Control & Budget Governor

**Purpose**: Validate the completeness, clarity, consistency, and measurability of requirements
covering financial precision, circuit breaker FSM, Hot/Cold path boundaries, and fail-safe behavior.
**Created**: 2026-07-06
**Feature**: [spec.md](../spec.md) | [data-model.md](../data-model.md) | [contracts/api.md](../contracts/api.md)

---

## Requirement Completeness — Financial Precision

- [ ] CHK001 Are BigInt micro-dollar conversion rules specified for ALL monetary fields across the data model, not just spend totals? [Completeness, Spec §FR-002, data-model.md]
- [ ] CHK002 Is the maximum allowable `capMicros` value documented to prevent silent overflow when multiplied by BigInt multipliers? [Completeness, Gap]
- [ ] CHK003 Are requirements defined for how `baseRateMicros` is sourced — loaded from Provider config at interception time vs. cached per-session? [Completeness, Spec §FR-007]
- [ ] CHK004 Is the additive multiplier formula (`baseRateMicros * BigInt(1 + sum(addends))`) explicitly stated in the spec, or only implied by examples? [Clarity, Spec §FR-007, Clarifications §Session-2026-07-06]
- [ ] CHK005 Are requirements defined for what happens when a Provider's `baseRateMicros` is updated while a job is mid-execution — which rate applies? [Completeness, Gap]
- [ ] CHK006 Is BigInt JSON serialization format (string) documented as a contract requirement, not just an implementation detail? [Clarity, contracts/api.md]
- [ ] CHK007 Are requirements specified for what `multiplierSum` equals when no premium features are active — is the default multiplier 1 or 0? [Clarity, data-model.md §SpendEvent]

---

## Requirement Completeness — Circuit Breaker FSM

- [ ] CHK008 Are all four FSM transition triggers explicitly documented (CLOSED→OPEN, OPEN→HALF_OPEN, HALF_OPEN→CLOSED, HALF_OPEN→OPEN)? [Completeness, Spec §FR-013, constitution §Circuit Breaker FSM]
- [ ] CHK009 Is the HALF_OPEN "single probe allowed" requirement specified with a concurrency constraint — what happens if two requests arrive simultaneously during HALF_OPEN? [Clarity, Gap]
- [ ] CHK010 Are requirements defined for the manual reset operation — does it transition from ANY state to CLOSED, or only from OPEN? [Completeness, contracts/api.md §POST /reset]
- [ ] CHK011 Is the TTL expiry mechanism specified — does the system poll for expiry, or does TTL trigger transition lazily on the next incoming request? [Clarity, Spec §FR-013]
- [ ] CHK012 Are requirements defined for what happens to the HALF_OPEN TTL window if Redis is restarted — does the TTL survive? [Edge Case, Gap]
- [ ] CHK013 Is the circuit breaker scope isolation requirement (scope A breach does not affect scope B) stated as an explicit functional requirement, not just implied? [Completeness, Spec §US1 Acceptance Scenario 3]

---

## Requirement Clarity — Enforcement Semantics

- [ ] CHK014 Is "fail-fast" quantified with a specific latency bound in the OPEN state, separate from the <10ms Hot Path requirement? [Clarity, Spec §SC-001]
- [ ] CHK015 Is "atomic increment" defined clearly enough to exclude race conditions — does the spec state this requires a single Redis EVAL call rather than read-then-write? [Clarity, Spec §FR-003]
- [ ] CHK016 Are requirements specified for what "debited at interception" means for retry `retryIndex > 0` — is the idempotency key uniqueness per retry explicitly required? [Clarity, Spec §Clarifications, Spec §FR-001]
- [ ] CHK017 Is the term "upstream provider call" consistently defined — does it mean any outbound network call, or only the proxied browser request? [Clarity, Ambiguity]
- [ ] CHK018 Is "no upstream call made after cap is hit" testable from the spec alone, or does it require implementation knowledge to verify? [Measurability, Spec §US1 Acceptance Scenario 2]

---

## Requirement Consistency — Cross-Artifact Alignment

- [ ] CHK019 Does the `SpendEvent.multiplierSum` field in data-model.md match the additive formula documented in Spec §FR-007 and the Clarifications section? [Consistency]
- [ ] CHK020 Are the four Redis key names in data-model.md (`spend`, `state`, `cap`, `ttl_exp`) consistent with the key names referenced in research.md and any Lua pseudocode? [Consistency, data-model.md §CircuitBreakerState]
- [ ] CHK021 Does the `POST /v1/enforce` contract in contracts/api.md include all fields required by the idempotency key derivation formula in data-model.md (`jobId`, `targetId`, `provider`, `requestTimestamp`, `retryIndex`)? [Consistency, contracts/api.md]
- [ ] CHK022 Is the `halfOpenTtlSeconds` field range [10, 3600] in data-model.md consistent with the 60s default stated in Spec §FR-013 and the Clarifications section? [Consistency]
- [ ] CHK023 Does the `NO_BUDGET` denial state in contracts/api.md align with the hard-deny requirement in Spec §Edge Cases and Spec §Clarifications? [Consistency]

---

## Acceptance Criteria Quality — Measurability

- [ ] CHK024 Is SC-001 (<10ms p99 under "production load") sufficiently precise — is "production load" defined with a specific concurrency or request rate? [Measurability, Spec §SC-001]
- [ ] CHK025 Is SC-002 ("zero cases of spend exceeding cap under concurrent load") testable — does the spec define the load parameters (e.g., "100+ simultaneous requests per scope")? [Measurability, Spec §SC-002]
- [ ] CHK026 Is SC-004 ("0% double-counting across 1,000 idempotency test cases") specifying test scope clearly — 1,000 unique keys, 1,000 duplicates, or 1,000 total events? [Clarity, Spec §SC-004]
- [ ] CHK027 Is SC-005 ("within 5 seconds for 95% of updates") testable without implementation details — is the measurement point defined (event occurrence vs. database write vs. SSE delivery)? [Measurability, Spec §SC-005]
- [ ] CHK028 Is SC-007 ("100% of requests denied when store unavailable") measurable — is "unavailable" defined (connection refused, timeout, partial cluster failure)? [Clarity, Spec §SC-007]

---

## Scenario Coverage — Exception & Recovery Flows

- [ ] CHK029 Are requirements defined for provider pricing config being unavailable at enforce time — is the fail-safe behavior (deny vs. use cached rate) specified? [Coverage, Gap, Spec §Edge Cases]
- [ ] CHK030 Are requirements specified for RabbitMQ being unavailable when `apps/api` attempts to publish a spend event — does the Hot Path succeed or fail? [Coverage, Gap]
- [ ] CHK031 Is the Cold Path catch-up behavior specified when `apps/worker` recovers from downtime — are missed events replayed from a queue or lost? [Coverage, Gap]
- [ ] CHK032 Are requirements defined for budget cap updates (PATCH /budgets/:id) that lower the cap below current spend — does the circuit trip immediately? [Coverage, Edge Case, contracts/api.md]
- [ ] CHK033 Are requirements specified for concurrent budget creation races — what happens if two `POST /v1/budgets` requests for the same scope arrive simultaneously? [Coverage, Edge Case]
- [ ] CHK034 Are requirements defined for what happens if `SCRIPT LOAD` fails at API bootstrap — does the service fail to start or degrade gracefully? [Coverage, Exception Flow, Gap]

---

## Non-Functional Requirements Coverage

- [ ] CHK035 Are observability requirements specified at the field level — is the exact log schema (fields, types, log level) documented, or only described narratively? [Completeness, constitution §VI]
- [ ] CHK036 Are security requirements defined for the `POST /v1/enforce` endpoint — can any caller invoke it, or is org-scoped authentication required? [Gap, Security]
- [ ] CHK037 Are rate-limiting requirements defined for the enforcement endpoint to prevent Hot Path abuse? [Gap, Non-Functional]
- [ ] CHK038 Are data retention requirements specified for the append-only `spend_events` ledger? [Gap, Non-Functional]
- [ ] CHK039 Are requirements defined for Redis Cluster failover behavior — does the system maintain latency guarantees during a primary node failover? [Gap, Reliability]
- [ ] CHK040 Is the `@governor/playwright-hook` npm package's compatibility matrix specified — which Playwright versions and Node.js versions are supported? [Completeness, Gap]

---

## Dependencies & Assumptions

- [ ] CHK041 Is the assumption "operators authenticate via the existing organizational identity system" validated — is that system available and its contract documented? [Assumption, Spec §Assumptions]
- [ ] CHK042 Are requirements defined for how `orgId` values are validated — are they free-form strings or must they match a known registry? [Clarity, Gap]
- [ ] CHK043 Is the assumption "Redis Cluster hash tag slot locality eliminates CROSSSLOT errors" verified as a stated requirement, not just a research finding? [Assumption, research.md]
- [ ] CHK044 Are requirements defined for how Provider pricing configs are initially seeded and updated — self-service, operator-only, or deployment-time? [Completeness, Spec §Assumptions]

---

## Notes

- Items marked `[Gap]` indicate requirements absent from current artifacts — these need spec additions before implementation.
- Items marked `[Ambiguity]` have vague language that needs quantification.
- Items marked `[Consistency]` cross-reference multiple artifacts — verify both sides before marking resolved.
- Mark items checked: `[x]`
- Reference resolution: add inline comment with spec section or PR link when resolving a Gap.
