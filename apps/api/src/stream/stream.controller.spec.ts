import { Test, TestingModule } from '@nestjs/testing';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { BudgetsService } from '../budgets/budgets.service';

const BUDGET_ID = 'budget-uuid-001';

function makeBudgetsService(overrides = {}) {
  return {
    findById: jest.fn().mockResolvedValue({ id: BUDGET_ID, orgId: 'org-1' }),
    ...overrides,
  };
}

function makeStreamService() {
  return {
    getOrCreate: jest.fn().mockReturnValue({
      asObservable: () => ({ pipe: (..._ops: unknown[]) => 'piped-observable' }),
    }),
    cleanup: jest.fn(),
  };
}

async function buildController(budgetsSvc: object, streamSvc: object) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [StreamController],
    providers: [
      { provide: BudgetsService, useValue: budgetsSvc },
      { provide: StreamService, useValue: streamSvc },
    ],
  }).compile();

  return module.get(StreamController);
}

describe('StreamController — org scoping (FR-008)', () => {
  it('resolves the stream when the budget belongs to the authenticated org', async () => {
    const budgetsSvc = makeBudgetsService();
    const streamSvc = makeStreamService();
    const controller = await buildController(budgetsSvc, streamSvc);

    const req = { orgId: 'org-1' } as any;
    const result = await controller.streamBudget(BUDGET_ID, req);

    expect(budgetsSvc.findById).toHaveBeenCalledWith(BUDGET_ID, 'org-1');
    expect(streamSvc.getOrCreate).toHaveBeenCalledWith(BUDGET_ID);
    expect(result).toBeDefined();
  });

  it('rejects (throws) when the budget does not belong to the authenticated org', async () => {
    const budgetsSvc = makeBudgetsService({
      findById: jest.fn().mockRejectedValue(new Error('not found')),
    });
    const streamSvc = makeStreamService();
    const controller = await buildController(budgetsSvc, streamSvc);

    const req = { orgId: 'org-2' } as any;
    await expect(controller.streamBudget(BUDGET_ID, req)).rejects.toThrow();
    expect(streamSvc.getOrCreate).not.toHaveBeenCalled();
  });
});
