'use client';
import { useGetBudgetQuery } from '../../store/api/governor.api';

function formatUsd(micros: string | undefined): string {
  if (!micros) return '$0.00';
  return `$${(Number(BigInt(micros)) / 1_000_000).toFixed(2)}`;
}

function Statebadge({ state }: { state: string | undefined }) {
  const color =
    state === 'CLOSED' ? '#22c55e' :
    state === 'OPEN' ? '#ef4444' :
    state === 'HALF_OPEN' ? '#f59e0b' : '#6b7280';
  return (
    <span style={{ background: color, color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
      {state ?? 'UNKNOWN'}
    </span>
  );
}

export default function BudgetsPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Budgets</h1>
      <p style={{ color: '#6b7280' }}>
        Select a budget from the URL: <code>/budgets/[id]</code>
      </p>
    </main>
  );
}

export { formatUsd, Statebadge };
