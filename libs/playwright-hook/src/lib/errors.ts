export class GovernorDeniedError extends Error {
  constructor(
    public readonly state: 'OPEN' | 'NO_BUDGET' | 'STORE_UNAVAILABLE',
    public readonly budgetId?: string,
  ) {
    super(`Governor denied request: state=${state}${budgetId ? ` budgetId=${budgetId}` : ''}`);
    this.name = 'GovernorDeniedError';
  }
}
