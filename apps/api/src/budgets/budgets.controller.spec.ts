jest.mock('amqplib', () => ({}), { virtual: true });

import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, NotFoundException, ConflictException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { BudgetStoreService } from '@governor/budget-store';
import { StreamService } from '../stream/stream.service';
import { RABBITMQ_CLIENT } from '../messaging/events.module';

const BUDGET_ID = 'budget-uuid-001';

function makeBudget(overrides = {}) {
  return {
    id: BUDGET_ID,
    orgId: 'org-1',
    jobId: 'job-1',
    targetId: 'scraperapi',
    capMicros: 50_000_000n,
    halfOpenTtlSeconds: 60,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeLiveState(overrides = {}) {
  return {
    state: 'CLOSED',
    spendMicros: 5_000_000n,
    remainingMicros: 45_000_000n,
    ...overrides,
  };
}

function makeServices() {
  const budgetSvc = {
    create: jest.fn().mockResolvedValue(makeBudget()),
    findById: jest.fn().mockResolvedValue(makeBudget()),
    findAllByOrg: jest.fn().mockResolvedValue([makeBudget()]),
    update: jest.fn().mockResolvedValue(makeBudget()),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };
  const storeSvc = {
    getState: jest.fn().mockResolvedValue(makeLiveState()),
    warmCapKey: jest.fn().mockResolvedValue(undefined),
    resetCircuit: jest.fn().mockResolvedValue('OPEN'),
  };
  return { budgetSvc, storeSvc };
}

function makeRmqClient() {
  return { emit: jest.fn().mockReturnValue({ subscribe: (obs: any) => obs?.next?.() }) };
}

function makeStreamService() {
  return { emit: jest.fn() };
}

async function buildApp(
  budgetSvc: object,
  storeSvc: object,
  rmqClient: object = makeRmqClient(),
  streamSvc: object = makeStreamService(),
) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [BudgetsController],
    providers: [
      { provide: BudgetsService, useValue: budgetSvc },
      { provide: BudgetStoreService, useValue: storeSvc },
      { provide: RABBITMQ_CLIENT, useValue: rmqClient },
      { provide: StreamService, useValue: streamSvc },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

describe('BudgetsController', () => {
  describe('POST /v1/budgets', () => {
    it('creates budget and returns 201 with string capMicros', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      const res = await request(app.getHttpServer())
        .post('/v1/budgets')
        .send({ orgId: 'org-1', jobId: 'job-1', targetId: 'scraperapi', capMicros: '50000000' })
        .expect(201);

      expect(res.body.id).toBe(BUDGET_ID);
      expect(res.body.capMicros).toBe('50000000');
      expect(typeof res.body.createdAt).toBe('string');
      expect(budgetSvc.create).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));

      await app.close();
    });

    it('returns 409 on duplicate scope', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      budgetSvc.create.mockRejectedValue(new ConflictException('Budget already exists for this scope'));
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .post('/v1/budgets')
        .send({ orgId: 'org-1', jobId: 'job-1', targetId: 'scraperapi', capMicros: '50000000' })
        .expect(409);

      await app.close();
    });

    it('rejects non-numeric capMicros', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .post('/v1/budgets')
        .send({ orgId: 'org-1', jobId: 'job-1', targetId: 'scraperapi', capMicros: 'one-dollar' })
        .expect(400);

      await app.close();
    });

    it('rejects halfOpenTtlSeconds below minimum (10)', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .post('/v1/budgets')
        .send({ orgId: 'org-1', jobId: 'job-1', targetId: 'scraperapi', capMicros: '50000000', halfOpenTtlSeconds: 5 })
        .expect(400);

      await app.close();
    });
  });

  describe('GET /v1/budgets', () => {
    it('returns the authenticated org\'s budgets merged with live state', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      budgetSvc.findAllByOrg.mockResolvedValue([makeBudget()]);
      const app = await buildApp(budgetSvc, storeSvc);

      const res = await request(app.getHttpServer())
        .get('/v1/budgets')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(BUDGET_ID);
      expect(res.body[0].circuitState).toBe('CLOSED');
      expect(res.body[0].spendMicros).toBe('5000000');
      expect(storeSvc.getState).toHaveBeenCalledWith('org-1', BUDGET_ID, 50_000_000n);

      await app.close();
    });

    it('returns 200 with an empty array when the org has no budgets', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      budgetSvc.findAllByOrg.mockResolvedValue([]);
      const app = await buildApp(budgetSvc, storeSvc);

      const res = await request(app.getHttpServer())
        .get('/v1/budgets')
        .expect(200);

      expect(res.body).toEqual([]);

      await app.close();
    });
  });

  describe('GET /v1/budgets/:id', () => {
    it('returns budget with live Redis state', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      const res = await request(app.getHttpServer())
        .get(`/v1/budgets/${BUDGET_ID}`)
        .expect(200);

      expect(res.body.id).toBe(BUDGET_ID);
      expect(res.body.circuitState).toBe('CLOSED');
      expect(res.body.spendMicros).toBe('5000000');
      expect(res.body.remainingMicros).toBe('45000000');
      expect(storeSvc.getState).toHaveBeenCalledWith('org-1', BUDGET_ID, 50_000_000n);

      await app.close();
    });

    it('returns 404 when budget not found', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      budgetSvc.findById.mockRejectedValue(new NotFoundException('Budget not found'));
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .get(`/v1/budgets/nonexistent`)
        .expect(404);

      await app.close();
    });

    it('passes the authenticated orgId through to the service (FR-008)', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .get(`/v1/budgets/${BUDGET_ID}`)
        .expect(200);

      // req.orgId is undefined in this isolated controller test (no real
      // ApiKeyGuard registered), but the controller must still be the one
      // passing whatever req.orgId resolves to — the actual enforcement of
      // matching happens in BudgetsService (see budgets.service.spec.ts).
      expect(budgetSvc.findById).toHaveBeenCalledWith(BUDGET_ID, undefined);

      await app.close();
    });
  });

  describe('PATCH /v1/budgets/:id', () => {
    it('updates budget and returns 200', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      budgetSvc.update.mockResolvedValue(makeBudget({ capMicros: 100_000_000n }));
      const app = await buildApp(budgetSvc, storeSvc);

      const res = await request(app.getHttpServer())
        .patch(`/v1/budgets/${BUDGET_ID}`)
        .send({ capMicros: '100000000' })
        .expect(200);

      expect(res.body.capMicros).toBe('100000000');

      await app.close();
    });

    it('rejects float capMicros on update', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .patch(`/v1/budgets/${BUDGET_ID}`)
        .send({ capMicros: '1.5' })
        .expect(400);

      await app.close();
    });
  });

  describe('DELETE /v1/budgets/:id', () => {
    it('soft-deletes and returns 204', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      await request(app.getHttpServer())
        .delete(`/v1/budgets/${BUDGET_ID}`)
        .expect(204);

      expect(budgetSvc.softDelete).toHaveBeenCalledWith(BUDGET_ID, undefined);

      await app.close();
    });
  });

  describe('POST /v1/budgets/:id/reset', () => {
    it('resets circuit and returns previous state', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const app = await buildApp(budgetSvc, storeSvc);

      const res = await request(app.getHttpServer())
        .post(`/v1/budgets/${BUDGET_ID}/reset`)
        .expect(201); // NestJS default for POST

      expect(res.body.budgetId).toBe(BUDGET_ID);
      expect(res.body.previousState).toBe('OPEN');
      expect(res.body.newState).toBe('CLOSED');
      expect(typeof res.body.resetAt).toBe('string');
      expect(storeSvc.resetCircuit).toHaveBeenCalledWith('org-1', BUDGET_ID);

      await app.close();
    });

    it('emits a CIRCUIT_RESET alert', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const rmqClient = makeRmqClient();
      const app = await buildApp(budgetSvc, storeSvc, rmqClient);

      await request(app.getHttpServer())
        .post(`/v1/budgets/${BUDGET_ID}/reset`)
        .expect(201);

      expect(rmqClient.emit).toHaveBeenCalledWith(
        'budget.breached',
        expect.objectContaining({ budgetId: BUDGET_ID, orgId: 'org-1', eventType: 'CIRCUIT_RESET' }),
      );

      await app.close();
    });

    it('emits a reset event via StreamService', async () => {
      const { budgetSvc, storeSvc } = makeServices();
      const streamSvc = makeStreamService();
      const app = await buildApp(budgetSvc, storeSvc, makeRmqClient(), streamSvc);

      await request(app.getHttpServer())
        .post(`/v1/budgets/${BUDGET_ID}/reset`)
        .expect(201);

      expect(streamSvc.emit).toHaveBeenCalledWith(
        BUDGET_ID,
        expect.objectContaining({ type: 'reset' }),
      );

      await app.close();
    });
  });
});
