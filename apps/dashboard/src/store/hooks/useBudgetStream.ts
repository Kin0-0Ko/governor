'use client';
import { useEffect, useRef } from 'react';
import { useStreamBudgetQuery } from '../api/governor.api';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export function useBudgetStream(budgetId: string) {
  const result = useStreamBudgetQuery(budgetId);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!budgetId) return;

    const connect = () => {
      const es = new EventSource(`${API_BASE}/v1/stream/budgets/${budgetId}`);
      esRef.current = es;

      es.onerror = () => {
        es.close();
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      esRef.current?.close();
    };
  }, [budgetId]);

  return result;
}
