// Block amqplib import that @nestjs/microservices tries to load eagerly
jest.mock('amqplib', () => ({}), { virtual: true });
jest.mock('../messaging/events.module', () => ({
  EventsModule: class {},
  RABBITMQ_CLIENT: 'RABBITMQ_CLIENT',
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, HttpStatus } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { EnforceController } from './enforce.controller';
import { EnforceService } from './enforce.service';

const validBody = {
  orgId: 'org-1',
  jobId: 'job-1',
  targetId: 'scraperapi',
  provider: 'scraperapi',
  features: [],
  idempotencyKey: 'key-001',
  requestTimestamp: '2026-01-01T00:00:00.000Z',
  retryIndex: 0,
};

function makeService(overrides: Partial<ReturnType<typeof buildService>> = {}) {
  return { enforce: jest.fn(), ...overrides };
}

function buildService() {
  return {
    enforce: jest.fn().mockResolvedValue({
      decision: 'ALLOWED' as const,
      costMicros: 1_000_000n,
      remainingMicros: 4_000_000n,
      state: 'CLOSED',
      budgetId: 'budget-uuid',
    }),
  };
}

async function buildApp(service: ReturnType<typeof buildService>) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [EnforceController],
    providers: [{ provide: EnforceService, useValue: service }],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Simulate the ApiKeyGuard having attached orgId to the request, as it does in production.
  app.use((req: any, _res: any, next: any) => {
    req.orgId = 'org-1';
    next();
  });
  await app.init();
  return app;
}

describe('EnforceController', () => {
  describe('POST /v1/enforce — ALLOWED', () => {
    it('returns 200 with decision ALLOWED and string monetary fields', async () => {
      const svc = buildService();
      const app = await buildApp(svc);

      const res = await request(app.getHttpServer())
        .post('/v1/enforce')
        .send(validBody)
        .expect(200);

      expect(res.body).toEqual({
        decision: 'ALLOWED',
        costMicros: '1000000',
        remainingMicros: '4000000',
        state: 'CLOSED',
      });

      expect(svc.enforce).toHaveBeenCalledWith(expect.objectContaining({
        orgId: 'org-1',
        jobId: 'job-1',
        retryIndex: 0,
      }));

      await app.close();
    });
  });

  describe('POST /v1/enforce — DENIED (budget exhausted)', () => {
    it('returns 402 with OPEN state', async () => {
      const svc = makeService({
        enforce: jest.fn().mockResolvedValue({
          decision: 'DENIED',
          costMicros: 1_000_000n,
          remainingMicros: 0n,
          state: 'OPEN',
          budgetId: 'budget-uuid',
        }),
      });
      const app = await buildApp(svc as ReturnType<typeof buildService>);

      const res = await request(app.getHttpServer())
        .post('/v1/enforce')
        .send(validBody)
        .expect(402);

      expect(res.body.decision).toBe('DENIED');
      expect(res.body.state).toBe('OPEN');
      expect(res.body.budgetId).toBe('budget-uuid');
      expect(res.body.message).toContain('org-1/job-1/scraperapi');

      await app.close();
    });
  });

  describe('POST /v1/enforce — DENIED (no budget)', () => {
    it('returns 402 with NO_BUDGET state', async () => {
      const svc = makeService({
        enforce: jest.fn().mockResolvedValue({
          decision: 'DENIED',
          costMicros: 0n,
          remainingMicros: 0n,
          state: 'NO_BUDGET',
        }),
      });
      const app = await buildApp(svc as ReturnType<typeof buildService>);

      const res = await request(app.getHttpServer())
        .post('/v1/enforce')
        .send(validBody)
        .expect(402);

      expect(res.body.state).toBe('NO_BUDGET');
      expect(res.body.message).toContain('No budget');

      await app.close();
    });
  });

  describe('POST /v1/enforce — STORE_UNAVAILABLE', () => {
    it('returns 503', async () => {
      const svc = makeService({
        enforce: jest.fn().mockResolvedValue({
          decision: 'DENIED',
          costMicros: 0n,
          remainingMicros: 0n,
          state: 'STORE_UNAVAILABLE',
        }),
      });
      const app = await buildApp(svc as ReturnType<typeof buildService>);

      const res = await request(app.getHttpServer())
        .post('/v1/enforce')
        .send(validBody)
        .expect(503);

      expect(res.body.state).toBe('STORE_UNAVAILABLE');
      expect(res.body.message).toContain('unreachable');

      await app.close();
    });
  });

  describe('POST /v1/enforce — validation', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
      app = await buildApp(buildService());
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects empty orgId', async () => {
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, orgId: '' })
        .expect(400);
    });

    it('rejects non-ISO8601 requestTimestamp', async () => {
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, requestTimestamp: 'not-a-date' })
        .expect(400);
    });

    it('rejects negative retryIndex', async () => {
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, retryIndex: -1 })
        .expect(400);
    });

    it('rejects string retryIndex that is not a number', async () => {
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, retryIndex: 'abc' })
        .expect(400);
    });

    it('rejects non-array features', async () => {
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, features: 'jsRender' })
        .expect(400);
    });

    it('rejects unknown extra fields (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, unknown: 'field' })
        .expect(400);
    });

    it('accepts retryIndex as string-encoded number (transform)', async () => {
      // transform: true converts "0" → 0
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, retryIndex: '0' })
        .expect(200);
    });
  });

  describe('POST /v1/enforce — org scoping (FR-008)', () => {
    it('rejects a request whose orgId does not match the authenticated caller\'s org', async () => {
      const svc = buildService();
      const app = await buildApp(svc);

      // req.orgId is stubbed to 'org-1' in buildApp; dto.orgId here is different.
      await request(app.getHttpServer())
        .post('/v1/enforce')
        .send({ ...validBody, orgId: 'org-2' })
        .expect(404);

      expect(svc.enforce).not.toHaveBeenCalled();

      await app.close();
    });
  });
});
