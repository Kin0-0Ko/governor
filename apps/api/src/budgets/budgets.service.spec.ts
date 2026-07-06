import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BudgetsService, CreateBudgetDto, UpdateBudgetDto } from './budgets.service';
import { Budget } from './entities/budget.entity';
import { BudgetStoreService } from '@governor/budget-store';

function makeBudgetEntity(overrides: Partial<Budget> = {}): Budget {
  const base: Budget = {
    id: 'budget-uuid',
    orgId: 'org-1',
    jobId: 'job-1',
    targetId: 'scraperapi',
    capMicros: 5_000_000n,
    halfOpenTtlSeconds: 60,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Budget;
  return { ...base, ...overrides };
}

function makeRepo(overrides = {}) {
  return {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn((dto: Partial<Budget>) => ({ ...makeBudgetEntity(), ...dto })),
    save: jest.fn(async (entity: Budget) => entity),
    softDelete: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeStore() {
  return {
    warmCapKey: jest.fn().mockResolvedValue(undefined),
    resetCircuit: jest.fn().mockResolvedValue('CLOSED'),
  };
}

async function buildService(repoOverrides = {}) {
  const repo = makeRepo(repoOverrides);
  const store = makeStore();

  const module = await Test.createTestingModule({
    providers: [
      BudgetsService,
      { provide: getRepositoryToken(Budget), useValue: repo },
      { provide: BudgetStoreService, useValue: store },
    ],
  }).compile();

  return {
    svc: module.get(BudgetsService),
    repo,
    store,
  };
}

describe('BudgetsService', () => {
  describe('create', () => {
    it('persists budget and warms Redis', async () => {
      const { svc, repo, store } = await buildService({
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue(makeBudgetEntity({ id: 'new-id' })),
      });

      const dto: CreateBudgetDto = {
        orgId: 'org-1',
        jobId: 'job-1',
        targetId: 'scraperapi',
        capMicros: '5000000',
        halfOpenTtlSeconds: 60,
      };
      const result = await svc.create(dto);

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(store.warmCapKey).toHaveBeenCalledWith('org-1', 'new-id', 5_000_000n);
      expect(result.id).toBe('new-id');
    });

    it('converts capMicros string to BigInt', async () => {
      const { svc, repo } = await buildService({
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation(async (e: Budget) => e),
      });

      const dto: CreateBudgetDto = { orgId: 'o', jobId: 'j', targetId: 't', capMicros: '9007199254740993' };
      await svc.create(dto);

      const saved = repo.save.mock.calls[0][0] as Budget;
      expect(typeof saved.capMicros).toBe('bigint');
      expect(saved.capMicros).toBe(9_007_199_254_740_993n);
    });

    it('defaults halfOpenTtlSeconds to 60 when not provided', async () => {
      const { svc, repo } = await buildService({
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation(async (e: Budget) => e),
      });

      await svc.create({ orgId: 'o', jobId: 'j', targetId: 't', capMicros: '1000000' });
      const saved = (repo.create as jest.Mock).mock.calls[0][0] as Budget;
      expect(saved.halfOpenTtlSeconds).toBe(60);
    });

    it('throws ConflictException when scope already exists', async () => {
      const { svc } = await buildService({
        findOne: jest.fn().mockResolvedValue(makeBudgetEntity()),
      });

      await expect(
        svc.create({ orgId: 'org-1', jobId: 'job-1', targetId: 'scraperapi', capMicros: '1000000' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('returns budget when found', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(makeBudgetEntity()),
      });
      const result = await svc.findById('budget-uuid');
      expect(result.id).toBe('budget-uuid');
    });

    it('throws NotFoundException when not found', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(null),
      });
      await expect(svc.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates capMicros as BigInt and re-warms Redis', async () => {
      const existing = makeBudgetEntity();
      const { svc, store } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(existing),
        save: jest.fn().mockImplementation(async (e: Budget) => e),
      });

      const dto: UpdateBudgetDto = { capMicros: '10000000' };
      const result = await svc.update('budget-uuid', dto);

      expect(result.capMicros).toBe(10_000_000n);
      expect(store.warmCapKey).toHaveBeenCalledWith('org-1', 'budget-uuid', 10_000_000n);
    });

    it('updates halfOpenTtlSeconds without touching capMicros', async () => {
      const existing = makeBudgetEntity({ capMicros: 5_000_000n });
      const { svc, store } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(existing),
        save: jest.fn().mockImplementation(async (e: Budget) => e),
      });

      const result = await svc.update('budget-uuid', { halfOpenTtlSeconds: 120 });

      expect(result.capMicros).toBe(5_000_000n);
      expect(result.halfOpenTtlSeconds).toBe(120);
      expect(store.warmCapKey).toHaveBeenCalledWith('org-1', 'budget-uuid', 5_000_000n);
    });

    it('throws NotFoundException when budget missing', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(null),
      });
      await expect(svc.update('nope', { capMicros: '1000000' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('calls softDelete on repo', async () => {
      const { svc, repo } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(makeBudgetEntity()),
      });

      await svc.softDelete('budget-uuid');
      expect(repo.softDelete).toHaveBeenCalledWith('budget-uuid');
    });

    it('throws NotFoundException when budget missing', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(null),
      });
      await expect(svc.softDelete('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
