'use client';
import { useState, FormEvent } from 'react';
import { useCreateBudgetMutation } from '../../store/api/governor.api';

export function BudgetForm() {
  const [create, { isLoading, error }] = useCreateBudgetMutation();
  const [form, setForm] = useState({
    orgId: '',
    jobId: '',
    targetId: '',
    capUsd: '',
    halfOpenTtlSeconds: '60',
  });

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const capUsd = parseFloat(form.capUsd);
    if (isNaN(capUsd) || capUsd <= 0) return;
    const capMicros = (BigInt(Math.round(capUsd * 1_000_000))).toString();
    const ttl = parseInt(form.halfOpenTtlSeconds, 10);
    await create({ orgId: form.orgId, jobId: form.jobId, targetId: form.targetId, capMicros, halfOpenTtlSeconds: ttl });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      <input placeholder="orgId" value={form.orgId} onChange={set('orgId')} required />
      <input placeholder="jobId" value={form.jobId} onChange={set('jobId')} required />
      <input placeholder="targetId" value={form.targetId} onChange={set('targetId')} required />
      <input
        placeholder="Cap (USD, e.g. 10.00)"
        type="number"
        step="0.01"
        min="0.000001"
        value={form.capUsd}
        onChange={set('capUsd')}
        required
      />
      <input
        placeholder="Half-open TTL (seconds, 10–3600)"
        type="number"
        min="10"
        max="3600"
        value={form.halfOpenTtlSeconds}
        onChange={set('halfOpenTtlSeconds')}
        required
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Budget'}
      </button>
      {error && <div style={{ color: '#ef4444' }}>Error creating budget</div>}
    </form>
  );
}
