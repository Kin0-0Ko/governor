import { Test } from '@nestjs/testing';
import { TerminusModule, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { REDIS_CLIENT } from '../budget-store/budget-store.module';

async function buildController(redisPing: () => Promise<unknown>, dbUp = true) {
  const db = {
    pingCheck: jest.fn().mockImplementation((key: string) =>
      dbUp
        ? Promise.resolve({ [key]: { status: 'up' } })
        : Promise.reject(new Error('db down')),
    ),
  };

  const module = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
      { provide: TypeOrmHealthIndicator, useValue: db },
      { provide: REDIS_CLIENT, useValue: { ping: redisPing } },
    ],
  }).compile();

  return { controller: module.get(HealthController), health: module.get(HealthCheckService) };
}

describe('HealthController', () => {
  describe('GET /health (liveness)', () => {
    it('always returns ok', async () => {
      const { controller } = await buildController(() => Promise.resolve('PONG'));
      expect(controller.liveness()).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/ready (readiness)', () => {
    it('returns status ok when db and redis are both healthy', async () => {
      const { controller } = await buildController(() => Promise.resolve('PONG'), true);
      const result = await controller.readiness();
      expect(result.status).toBe('ok');
    });

    it('throws (503 via terminus) when redis ping fails', async () => {
      const { controller } = await buildController(() => Promise.reject(new Error('ECONNREFUSED')), true);
      await expect(controller.readiness()).rejects.toBeTruthy();
    });

    it('throws (503 via terminus) when postgres ping fails', async () => {
      const { controller } = await buildController(() => Promise.resolve('PONG'), false);
      await expect(controller.readiness()).rejects.toBeTruthy();
    });
  });
});
