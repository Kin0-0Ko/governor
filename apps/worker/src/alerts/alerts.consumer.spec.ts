import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertsConsumer } from './alerts.consumer';
import { AlertEvent, AlertEventType } from '../entities/alert-event.entity';

function makePayload(overrides = {}) {
  return {
    budgetId: 'budget-uuid',
    orgId: 'org-1',
    eventType: AlertEventType.BUDGET_BREACHED,
    spendAtEventMicros: '50000000',
    capMicros: '50000000',
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
    create: jest.fn((dto: Partial<AlertEvent>) => ({ ...dto })),
    save: jest.fn().mockResolvedValue({}),
    ...repoOverrides,
  };

  const module = await Test.createTestingModule({
    controllers: [AlertsConsumer],
    providers: [{ provide: getRepositoryToken(AlertEvent), useValue: repo }],
  }).compile();

  return { consumer: module.get(AlertsConsumer), repo };
}

describe('AlertsConsumer', () => {
  describe('handleBudgetBreached — happy path', () => {
    it('persists alert with BigInt spend and cap', async () => {
      const { consumer, repo } = await buildConsumer();
      await consumer.handleBudgetBreached(makePayload(), makeCtx() as never);

      const saved = (repo.create as jest.Mock).mock.calls[0][0] as AlertEvent;
      expect(saved.spendAtEventMicros).toBe(50_000_000n);
      expect(saved.capMicros).toBe(50_000_000n);
      expect(saved.budgetId).toBe('budget-uuid');
      expect(saved.orgId).toBe('org-1');
    });

    it('acks on successful persist', async () => {
      const { consumer } = await buildConsumer();
      const ctx = makeCtx();
      await consumer.handleBudgetBreached(makePayload(), ctx as never);
      expect(ctx._ack).toHaveBeenCalledTimes(1);
      expect(ctx._nack).not.toHaveBeenCalled();
    });

    it('persists CIRCUIT_TRIPPED event type', async () => {
      const { consumer, repo } = await buildConsumer();
      await consumer.handleBudgetBreached(
        makePayload({ eventType: AlertEventType.CIRCUIT_TRIPPED }),
        makeCtx() as never,
      );
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as AlertEvent;
      expect(saved.eventType).toBe(AlertEventType.CIRCUIT_TRIPPED);
    });

    it('falls back to BUDGET_BREACHED when eventType missing', async () => {
      const { consumer, repo } = await buildConsumer();
      const payload = makePayload();
      delete (payload as Partial<typeof payload>).eventType;
      await consumer.handleBudgetBreached(payload, makeCtx() as never);
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as AlertEvent;
      expect(saved.eventType).toBe(AlertEventType.BUDGET_BREACHED);
    });
  });

  describe('error path — nack to DLQ', () => {
    it('nacks with requeue=false on save failure', async () => {
      const { consumer } = await buildConsumer({
        save: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });
      const ctx = makeCtx();
      await consumer.handleBudgetBreached(makePayload(), ctx as never);
      expect(ctx._nack).toHaveBeenCalledWith(expect.anything(), false, false);
      expect(ctx._ack).not.toHaveBeenCalled();
    });
  });
});
