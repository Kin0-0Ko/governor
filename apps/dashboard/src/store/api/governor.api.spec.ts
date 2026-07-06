import { governorApi } from './governor.api';

describe('governorApi RTK Query slice', () => {
  it('is defined', () => {
    expect(governorApi).toBeDefined();
  });

  it('has expected endpoint names', () => {
    const endpoints = Object.keys(governorApi.endpoints);
    expect(endpoints).toContain('getBudget');
    expect(endpoints).toContain('createBudget');
    expect(endpoints).toContain('updateBudget');
    expect(endpoints).toContain('deleteBudget');
    expect(endpoints).toContain('resetCircuit');
    expect(endpoints).toContain('getSpend');
  });

  it('reducerPath is governorApi', () => {
    expect(governorApi.reducerPath).toBe('governorApi');
  });
});
