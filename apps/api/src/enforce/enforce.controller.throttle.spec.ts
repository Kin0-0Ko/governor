import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { EnforceController } from './enforce.controller';
import { EnforceService } from './enforce.service';

describe('EnforceController — rate limiting (FR / research.md #3)', () => {
  it('returns 429 once the configured request rate is exceeded', async () => {
    const enforceService = {
      enforce: jest.fn().mockResolvedValue({
        decision: 'ALLOWED',
        costMicros: 1n,
        remainingMicros: 1n,
        state: 'CLOSED',
        budgetId: 'budget-1',
      }),
    };

    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 1000, limit: 2 }])],
      controllers: [EnforceController],
      providers: [
        { provide: EnforceService, useValue: enforceService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    const app = module.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.orgId = 'org-1';
      next();
    });
    await app.init();

    const body = {
      orgId: 'org-1',
      jobId: 'job-1',
      targetId: 'scraperapi',
      provider: 'scraperapi',
      features: [],
      idempotencyKey: 'k1',
      requestTimestamp: '2026-01-01T00:00:00.000Z',
      retryIndex: 0,
    };

    await request(app.getHttpServer()).post('/v1/enforce').send(body).expect(200);
    await request(app.getHttpServer()).post('/v1/enforce').send(body).expect(200);
    await request(app.getHttpServer()).post('/v1/enforce').send(body).expect(429);

    await app.close();
  });
});
