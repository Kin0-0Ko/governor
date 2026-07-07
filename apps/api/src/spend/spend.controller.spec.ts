import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { SpendController } from './spend.controller';
import { SpendService } from './spend.service';

function makeService() {
  return {
    query: jest.fn().mockResolvedValue({ total: 0, page: 1, limit: 50, items: [] }),
  };
}

async function buildApp(service: ReturnType<typeof makeService>, orgId = 'org-1') {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [SpendController],
    providers: [{ provide: SpendService, useValue: service }],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.use((req: any, _res: any, next: any) => {
    req.orgId = orgId;
    next();
  });
  await app.init();
  return app;
}

describe('SpendController — org scoping (FR-008)', () => {
  it('uses the authenticated orgId, ignoring a caller-supplied orgId that differs', async () => {
    const svc = makeService();
    const app = await buildApp(svc, 'org-1');

    await request(app.getHttpServer())
      .get('/v1/spend')
      .query({ orgId: 'org-2' })
      .expect(200);

    expect(svc.query).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));

    await app.close();
  });
});

describe('SpendController — query validation (FR-017)', () => {
  it('rejects a non-numeric page', async () => {
    const app = await buildApp(makeService());
    await request(app.getHttpServer())
      .get('/v1/spend')
      .query({ page: 'abc' })
      .expect(400);
    await app.close();
  });

  it('rejects a negative limit', async () => {
    const app = await buildApp(makeService());
    await request(app.getHttpServer())
      .get('/v1/spend')
      .query({ limit: '-5' })
      .expect(400);
    await app.close();
  });

  it('rejects a limit above 500', async () => {
    const app = await buildApp(makeService());
    await request(app.getHttpServer())
      .get('/v1/spend')
      .query({ limit: '501' })
      .expect(400);
    await app.close();
  });

  it('rejects a non-ISO8601 from date', async () => {
    const app = await buildApp(makeService());
    await request(app.getHttpServer())
      .get('/v1/spend')
      .query({ from: 'not-a-date' })
      .expect(400);
    await app.close();
  });

  it('accepts valid pagination and date filters', async () => {
    const svc = makeService();
    const app = await buildApp(svc);
    await request(app.getHttpServer())
      .get('/v1/spend')
      .query({ page: '2', limit: '25', from: '2026-01-01T00:00:00.000Z' })
      .expect(200);

    expect(svc.query).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 25 }));
    await app.close();
  });
});
