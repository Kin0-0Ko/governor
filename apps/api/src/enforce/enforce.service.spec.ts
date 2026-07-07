import { EnforceService } from './enforce.service';

function makeBudget(overrides = {}) {
  return {
    id: 'budget-uuid',
    orgId: 'org-1',
    jobId: 'job-1',
    targetId: 'scraperapi',
    capMicros: 50_000_000n,
    halfOpenTtlSeconds: 60,
    ...overrides,
  };
}

function makeProvider(overrides = {}) {
  return {
    name: 'scraperapi',
    baseRateMicros: 1_000_000n,
    multiplierRules: [],
    active: true,
    ...overrides,
  };
}

const validDto = {
  orgId: 'org-1',
  jobId: 'job-1',
  targetId: 'scraperapi',
  provider: 'scraperapi',
  features: [] as string[],
  idempotencyKey: 'key-1',
  requestTimestamp: '2026-01-01T00:00:00.000Z',
  retryIndex: 0,
};

function makeDeps() {
  const budgetRepo = { findOne: jest.fn() };
  const providerRepo = { findOne: jest.fn() };
  const budgetStore = { evalEnforce: jest.fn(), warmCapKey: jest.fn() };
  const rmqClient = { emit: jest.fn() };
  const streamService = { emit: jest.fn() };
  const outboxService = { recordFallback: jest.fn() };

  return { budgetRepo, providerRepo, budgetStore, rmqClient, streamService, outboxService };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new EnforceService(
    deps.budgetRepo as any,
    deps.providerRepo as any,
    deps.budgetStore as any,
    deps.rmqClient as any,
    deps.streamService as any,
    deps.outboxService as any,
  );
}

describe('EnforceService — alert emission ordering (Constitution Principle VI)', () => {
  it('awaits the breach alert emit before returning a TRIPPED denial', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(makeProvider());
    deps.budgetStore.evalEnforce.mockResolvedValue({
      allowed: false,
      state: 'TRIPPED',
      spendMicros: 50_000_000n,
      remainingMicros: 0n,
    });

    const order: string[] = [];
    deps.rmqClient.emit.mockImplementation((pattern: string) => {
      order.push(`emit:${pattern}`);
      return { subscribe: (obs: any) => obs?.next?.() };
    });

    const svc = makeService(deps);
    const result = await svc.enforce(validDto);
    order.push('response-returned');

    expect(order[0]).toBe('emit:budget.breached');
    expect(order[order.length - 1]).toBe('response-returned');
    expect(result.decision).toBe('DENIED');
    expect(result.state).toBe('TRIPPED');
  });

  it('falls back to outbox recording when the breach alert emit fails', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(makeProvider());
    deps.budgetStore.evalEnforce.mockResolvedValue({
      allowed: false,
      state: 'TRIPPED',
      spendMicros: 50_000_000n,
      remainingMicros: 0n,
    });
    deps.rmqClient.emit.mockImplementation(() => ({
      subscribe: (obs: any) => obs?.error?.(new Error('broker down')),
    }));

    const svc = makeService(deps);
    await svc.enforce(validDto);

    expect(deps.outboxService.recordFallback).toHaveBeenCalledWith(
      'budget.breached',
      expect.objectContaining({ budgetId: 'budget-uuid', orgId: 'org-1' }),
    );
  });

  it('does not emit a breach alert on a normal ALLOWED decision', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(makeProvider());
    deps.budgetStore.evalEnforce.mockResolvedValue({
      allowed: true,
      state: 'CLOSED',
      spendMicros: 1_000_000n,
      remainingMicros: 49_000_000n,
    });
    deps.rmqClient.emit.mockReturnValue({ subscribe: (obs: any) => obs?.next?.() });

    const svc = makeService(deps);
    await svc.enforce(validDto);

    const breachEmits = deps.rmqClient.emit.mock.calls.filter((c) => c[0] === 'budget.breached');
    expect(breachEmits).toHaveLength(0);
  });

  it('emits a spend stream event via StreamService on an ALLOWED decision', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(makeProvider());
    deps.budgetStore.evalEnforce.mockResolvedValue({
      allowed: true,
      state: 'CLOSED',
      spendMicros: 1_000_000n,
      remainingMicros: 49_000_000n,
    });
    deps.rmqClient.emit.mockReturnValue({ subscribe: (obs: any) => obs?.next?.() });

    const svc = makeService(deps);
    await svc.enforce(validDto);

    expect(deps.streamService.emit).toHaveBeenCalledWith(
      'budget-uuid',
      expect.objectContaining({ type: 'spend' }),
    );
  });

  it('emits a state_change stream event via StreamService on a TRIPPED decision', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(makeProvider());
    deps.budgetStore.evalEnforce.mockResolvedValue({
      allowed: false,
      state: 'TRIPPED',
      spendMicros: 50_000_000n,
      remainingMicros: 0n,
    });
    deps.rmqClient.emit.mockReturnValue({ subscribe: (obs: any) => obs?.next?.() });

    const svc = makeService(deps);
    await svc.enforce(validDto);

    expect(deps.streamService.emit).toHaveBeenCalledWith(
      'budget-uuid',
      expect.objectContaining({ type: 'state_change' }),
    );
  });
});

describe('EnforceService — unknown/inactive provider (FR-016)', () => {
  it('denies with UNKNOWN_PROVIDER and charges nothing when provider does not exist', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(null);

    const svc = makeService(deps);
    const result = await svc.enforce({ ...validDto, provider: 'does-not-exist' });

    expect(result.decision).toBe('DENIED');
    expect(result.state).toBe('UNKNOWN_PROVIDER');
    expect(result.costMicros).toBe(0n);
    expect(deps.budgetStore.evalEnforce).not.toHaveBeenCalled();
    expect(deps.rmqClient.emit).not.toHaveBeenCalled();
  });

  it('denies with UNKNOWN_PROVIDER when provider is inactive', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(null); // repo query filters active:true, inactive => not found

    const svc = makeService(deps);
    const result = await svc.enforce(validDto);

    expect(result.state).toBe('UNKNOWN_PROVIDER');
    expect(result.costMicros).toBe(0n);
  });
});

describe('EnforceService — NO_BUDGET rehydration (FR-006)', () => {
  it('retries once after re-warming the cap when store reports NO_BUDGET but Postgres has the budget', async () => {
    const deps = makeDeps();
    deps.budgetRepo.findOne.mockResolvedValue(makeBudget());
    deps.providerRepo.findOne.mockResolvedValue(makeProvider());
    deps.budgetStore.evalEnforce
      .mockResolvedValueOnce({ allowed: false, state: 'NO_BUDGET', spendMicros: 0n, remainingMicros: 0n })
      .mockResolvedValueOnce({ allowed: true, state: 'CLOSED', spendMicros: 1_000_000n, remainingMicros: 49_000_000n });
    deps.rmqClient.emit.mockReturnValue({ subscribe: (obs: any) => obs?.next?.() });

    const svc = makeService(deps);
    const result = await svc.enforce(validDto);

    expect(deps.budgetStore.warmCapKey).toHaveBeenCalledWith('org-1', 'budget-uuid', 50_000_000n);
    expect(deps.budgetStore.evalEnforce).toHaveBeenCalledTimes(2);
    expect(result.decision).toBe('ALLOWED');
  });
});
