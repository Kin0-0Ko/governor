'use client';
import { useStreamBudgetQuery } from '../api/governor.api';

/**
 * Live budget state, kept up to date via streamBudget's own internal SSE
 * connection (see governor.api.ts's onCacheEntryAdded) rather than a
 * separate EventSource here.
 */
export function useBudgetStream(budgetId: string) {
  return useStreamBudgetQuery(budgetId);
}
