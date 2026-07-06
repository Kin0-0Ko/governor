import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SpendRollupConsumer } from './spend-rollup.consumer';
import { SpendEvent, SpendDecision } from '../entities/spend-event.entity';

function makePayload(overrides = {}) {
  return {
    orgId: 'org-1',
    jobId: 'job-1',
    targetId: 'scraperapi',
    provider: 'scraperapi',
    features: ['jsRender'],
    idempotencyKey: 'key-001',
    requestTimestamp: '2026-01-01T00:00:00.000Z',
    budgetId: 'budget-uuid',
    baseRateMicros: '1000000',
    totalCostMicros: '5000000',
    multiplierRules: [{ feature: 'jsRender', addend: 4 }],
    ...overrides,
  };
}

function makeCtx(ack = jest.fn(), nack = jest.fn()) {
  return {
    getChannelRef: () => ({ ack, nack }),
    getMessage: () => ({}),
    _ack: ack,
    _nack: nack,
  };
}

async function buildConsumer(repoOverrides = {}) {
  const repo = {
    create: jest.fn((dto: Partial<SpendEvent>) => ({ ...dto })),
    save: jest.fn().mockResolvedValue({}),
    ...repoOverrides,
  };

  const module = await Test.createTestingModule({
    controllers: [SpendRollupConsumer],
    providers: [{ provide: getRepositoryToken(SpendEvent), useValue: repo }],
  }).compile();

  return { consumer: module.get(SpendRollupConsumer), repo };
}

describe('SpendRollupConsumer', () => {
  describe('handleSpendRecorded — happy path', () => {
    it('persists spend event with correct BigInt fields', async () => {
      const { consumer, repo } = await buildConsumer();
      const ctx = makeCtx();

      await consumer.handleSpendRecorded(makePayload(), ctx as never);

      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as SpendEvent;
      expect(saved.baseRateMicros).toBe(1_000_000n);
      expect(saved.totalCostMicros).toBe(5_000_000n);
      expect(saved.decision).toBe(SpendDecision.ALLOWED);
      expect(saved.idempotencyKey).toBe('key-001');
    });

    it('computes multiplierSum from active features', async () => {
      const { consumer, repo } = await buildConsumer();
      await consumer.handleSpendRecorded(
        makePayload({ features: ['jsRender'], multiplierRules: [{ feature: 'jsRender', addend: 4 }] }),
        makeCtx() as never,
      );
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as SpendEvent;
      expect(saved.multiplierSum).toBe(5); // 1 base + 4 addend
    });

    it('multiplierSum = 1 when no features active', async () => {
      const { consumer, repo } = await buildConsumer();
      await consumer.handleSpendRecorded(
        makePayload({ features: [], multiplierRules: [{ feature: 'jsRender', addend: 4 }] }),
        makeCtx() as never,
      );
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as SpendEvent;
      expect(saved.multiplierSum).toBe(1);
    });

    it('acks message on success', async () => {
      const { consumer } = await buildConsumer();
      const ctx = makeCtx();
      await consumer.handleSpendRecorded(makePayload(), ctx as never);
      expect(ctx._ack).toHaveBeenCalledTimes(1);
      expect(ctx._nack).not.toHaveBeenCalled();
    });

    it('parses requestTimestamp as Date', async () => {
      const { consumer, repo } = await buildConsumer();
      await consumer.handleSpendRecorded(makePayload(), makeCtx() as never);
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as SpendEvent;
      expect(saved.requestTimestamp).toBeInstanceOf(Date);
    });
  });

  describe('idempotency — duplicate key', () => {
    it('acks duplicate key error without re-throwing', async () => {
      const { consumer } = await buildConsumer({
        save: jest.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint')),
      });
      const ctx = makeCtx();
      await consumer.handleSpendRecorded(makePayload(), ctx as never);
      expect(ctx._ack).toHaveBeenCalledTimes(1);
      expect(ctx._nack).not.toHaveBeenCalled();
    });
  });

  describe('error path — nack to DLQ', () => {
    it('nacks with requeue=false on unexpected error', async () => {
      const { consumer } = await buildConsumer({
        save: jest.fn().mockRejectedValue(new Error('connection lost')),
      });
      const ctx = makeCtx();
      await consumer.handleSpendRecorded(makePayload(), ctx as never);
      expect(ctx._nack).toHaveBeenCalledWith(expect.anything(), false, false);
      expect(ctx._ack).not.toHaveBeenCalled();
    });
  });
});
