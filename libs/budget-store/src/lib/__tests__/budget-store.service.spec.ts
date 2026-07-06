import { Test, TestingModule } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { BudgetStoreService } from '../budget-store.service';

// ioredis-mock instance shared per test suite
let redisMock: InstanceType<typeof RedisMock>;
let service: BudgetStoreService;

const ORG = 'org-test';
const BUDGET_ID = 'budget-abc';
const CAP = 1_000_000n; // $1.00

async function warmBudget(cap: bigint = CAP) {
  await service.warmCapKey(ORG, BUDGET_ID, cap);
}

describe('BudgetStoreService', () => {
  beforeEach(async () => {
    redisMock = new RedisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetStoreService,
        { provide: 'REDIS_CLIENT', useValue: redisMock },
      ],
    })
      .overrideProvider(BudgetStoreService)
      .useFactory({
        factory: () => new BudgetStoreService(redisMock as any),
      })
      .compile();

    service = module.get<BudgetStoreService>(BudgetStoreService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await redisMock.flushall();
    await redisMock.quit();
  });

  // ── warmCapKey ─────────────────────────────────────────────────────────────

  describe('warmCapKey', () => {
    it('sets cap key with correct Hash Tag and value', async () => {
      await service.warmCapKey(ORG, BUDGET_ID, 5_000_000n);
      const val = await redisMock.get(`budget:{${ORG}:${BUDGET_ID}}:cap`);
      expect(val).toBe('5000000');
    });
  });

  // ── evalEnforce — NO_BUDGET ────────────────────────────────────────────────

  describe('evalEnforce — NO_BUDGET', () => {
    it('returns STORE_UNAVAILABLE deny when cap key missing', async () => {
      // No warmCapKey call → cap key absent
      const result = await service.evalEnforce({
        orgId: ORG,
        budgetId: BUDGET_ID,
        costMicros: 100_000n,
        ttlSeconds: 60,
      });
      // ioredis-mock returns NO_BUDGET from Lua; service maps it
      expect(result.allowed).toBe(false);
    });
  });

  // ── evalEnforce — ALLOWED ──────────────────────────────────────────────────

  describe('evalEnforce — ALLOWED', () => {
    it('allows request within budget', async () => {
      await warmBudget();
      const result = await service.evalEnforce({
        orgId: ORG,
        budgetId: BUDGET_ID,
        costMicros: 400_000n,
        ttlSeconds: 60,
      });
      expect(result.allowed).toBe(true);
      expect(result.state).toBe('ALLOWED');
      expect(result.spendMicros).toBe(400_000n);
      expect(result.remainingMicros).toBe(600_000n);
    });

    it('accumulates spend across multiple calls', async () => {
      await warmBudget();
      await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 300_000n, ttlSeconds: 60 });
      const r2 = await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 300_000n, ttlSeconds: 60 });
      expect(r2.spendMicros).toBe(600_000n);
    });
  });

  // ── evalEnforce — TRIPPED ─────────────────────────────────────────────────

  describe('evalEnforce — TRIPPED', () => {
    it('trips circuit when spend reaches cap', async () => {
      await warmBudget();
      await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 600_000n, ttlSeconds: 60 });
      const result = await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 400_000n, ttlSeconds: 60 });
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('TRIPPED');
    });

    it('denies subsequent calls after trip (OPEN state)', async () => {
      await warmBudget();
      // Exhaust budget
      await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 1_000_000n, ttlSeconds: 60 });
      // Manually set OPEN + future TTL to simulate fresh OPEN
      const tag = `{${ORG}:${BUDGET_ID}}`;
      await redisMock.set(`budget:${tag}:state`, 'OPEN');
      await redisMock.set(`budget:${tag}:ttl_exp`, String(Math.floor(Date.now() / 1000) + 3600));
      const denied = await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 100_000n, ttlSeconds: 60 });
      expect(denied.allowed).toBe(false);
      expect(denied.state).toBe('OPEN');
    });
  });

  // ── resetCircuit ───────────────────────────────────────────────────────────

  describe('resetCircuit', () => {
    it('returns previous state', async () => {
      const tag = `{${ORG}:${BUDGET_ID}}`;
      await redisMock.set(`budget:${tag}:state`, 'OPEN');
      const prev = await service.resetCircuit(ORG, BUDGET_ID);
      expect(prev).toBe('OPEN');
    });

    it('sets state to CLOSED', async () => {
      const tag = `{${ORG}:${BUDGET_ID}}`;
      await redisMock.set(`budget:${tag}:state`, 'OPEN');
      await service.resetCircuit(ORG, BUDGET_ID);
      const val = await redisMock.get(`budget:${tag}:state`);
      expect(val).toBe('CLOSED');
    });
  });

  // ── getState ───────────────────────────────────────────────────────────────

  describe('getState', () => {
    it('returns CLOSED with zero spend when no keys set', async () => {
      const state = await service.getState(ORG, BUDGET_ID, CAP);
      expect(state.state).toBe('CLOSED');
      expect(state.spendMicros).toBe(0n);
      expect(state.remainingMicros).toBe(CAP);
    });

    it('returns current spend and remaining', async () => {
      await warmBudget();
      await service.evalEnforce({ orgId: ORG, budgetId: BUDGET_ID, costMicros: 300_000n, ttlSeconds: 60 });
      const state = await service.getState(ORG, BUDGET_ID, CAP);
      expect(state.spendMicros).toBe(300_000n);
      expect(state.remainingMicros).toBe(700_000n);
    });
  });

  // ── fail-safe on Redis error ───────────────────────────────────────────────

  describe('fail-safe on store error', () => {
    it('returns STORE_UNAVAILABLE when Redis throws', async () => {
      // Override evalScript to throw
      jest.spyOn(redisMock, 'evalsha' as any).mockRejectedValue(new Error('ECONNREFUSED'));
      jest.spyOn(redisMock, 'eval' as any).mockRejectedValue(new Error('ECONNREFUSED'));

      await warmBudget();
      const result = await service.evalEnforce({
        orgId: ORG,
        budgetId: BUDGET_ID,
        costMicros: 100_000n,
        ttlSeconds: 60,
      });
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('STORE_UNAVAILABLE');
    });
  });
});
