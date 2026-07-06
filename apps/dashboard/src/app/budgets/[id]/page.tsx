'use client';
import { useParams } from 'next/navigation';
import { useBudgetStream } from '../../../store/hooks/useBudgetStream';
import { useResetCircuitMutation } from '../../../store/api/governor.api';
import { formatUsd, Statebadge } from '../page';

export default function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: budget, isLoading, error } = useBudgetStream(id);
  const [resetCircuit, { isLoading: resetting }] = useResetCircuitMutation();

  if (isLoading) return <main style={{ padding: 24 }}>Loading...</main>;
  if (error || !budget) return <main style={{ padding: 24 }}>Budget not found.</main>;

  const cap = BigInt(budget.capMicros);
  const spend = BigInt(budget.spendMicros ?? '0');
  const pct = cap > 0n ? Number((spend * 10000n) / cap) / 100 : 0;

  return (
    <main style={{ padding: 24 }}>
      <h1>
        Budget <code>{id}</code>
      </h1>

      <div style={{ marginBottom: 16 }}>
        <Statebadge state={budget.circuitState} />
        {budget.circuitState === 'OPEN' && (
          <div style={{ background: '#fef2f2', border: '1px solid #ef4444', borderRadius: 4, padding: 8, marginTop: 8 }}>
            Budget breached — circuit OPEN
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div>Spend: {formatUsd(budget.spendMicros)} / {formatUsd(budget.capMicros)}</div>
        <div style={{ background: '#e5e7eb', borderRadius: 4, height: 12, marginTop: 4 }}>
          <div
            style={{
              background: budget.circuitState === 'OPEN' ? '#ef4444' : '#3b82f6',
              width: `${Math.min(pct, 100)}%`,
              height: '100%',
              borderRadius: 4,
              transition: 'width 0.5s',
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{pct.toFixed(1)}% used</div>
      </div>

      <button
        onClick={() => resetCircuit(id)}
        disabled={resetting || budget.circuitState === 'CLOSED'}
        style={{ padding: '8px 16px', cursor: 'pointer' }}
      >
        {resetting ? 'Resetting...' : 'Reset Circuit'}
      </button>

      <div style={{ marginTop: 24 }}>
        <div><strong>Org:</strong> {budget.orgId}</div>
        <div><strong>Job:</strong> {budget.jobId}</div>
        <div><strong>Target:</strong> {budget.targetId}</div>
        <div><strong>TTL:</strong> {budget.halfOpenTtlSeconds}s</div>
        <div><strong>Remaining:</strong> {formatUsd(budget.remainingMicros)}</div>
      </div>
    </main>
  );
}
