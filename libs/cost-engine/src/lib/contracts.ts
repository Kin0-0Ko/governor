/** Shared enforcement state type used by both cost-engine and budget-store */
export type EnforcementState = 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'NO_BUDGET' | 'STORE_UNAVAILABLE';

/** Enforcement decision as visible to callers (superset of FSM states for result semantics) */
export type EnforcementDecision = 'ALLOWED' | 'DENIED' | 'TRIPPED' | 'NO_BUDGET' | 'STORE_UNAVAILABLE';

export interface CostSignal {
  orgId: string;
  jobId: string;
  targetId: string;
  provider: string;
  features: string[];
  idempotencyKey: string;
  requestTimestamp: string; // ISO-8601
  retryIndex: number;
}

export interface CostResult {
  decision: EnforcementDecision;
  costMicros: bigint;
  remainingMicros: bigint;
  state: EnforcementState;
}

export interface MultiplierRule {
  feature: string;
  addend: number; // safe integer; summed as number, converted to BigInt once
}

export interface ProviderConfig {
  name: string;
  baseRateMicros: bigint;
  multiplierRules: MultiplierRule[];
}

export interface CostAdapter {
  readonly provider: string;
  computeCost(signal: CostSignal, config: ProviderConfig): bigint;
}
