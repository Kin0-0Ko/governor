'use client';
import { useParams } from 'next/navigation';
import { Alert, Button, Card, Chip, ProgressBar } from '@heroui/react';
import { useBudgetStream } from '../../../store/hooks/useBudgetStream';
import { useResetCircuitMutation } from '../../../store/api/governor.api';
import { formatUsd, stateColor } from '../../../features/budgets/stateColor';
import { ConnectionErrorView, LoadingView, NotFoundView } from '../../../features/budgets/StateViews';

export default function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: budget, isLoading, error } = useBudgetStream(id);
  const [resetCircuit, { isLoading: resetting }] = useResetCircuitMutation();

  if (isLoading) return <main className="p-6 max-w-2xl mx-auto"><LoadingView /></main>;

  const httpStatus = error && 'status' in error ? error.status : undefined;
  if (httpStatus === 404) {
    return <main className="p-6 max-w-2xl mx-auto"><NotFoundView label={`Budget ${id} not found`} /></main>;
  }
  if (error || !budget) {
    return <main className="p-6 max-w-2xl mx-auto"><ConnectionErrorView /></main>;
  }

  const cap = BigInt(budget.capMicros);
  const spend = BigInt(budget.spendMicros ?? '0');
  const pct = cap > 0n ? Number((spend * 10000n) / cap) / 100 : 0;
  const isOpen = budget.circuitState === 'OPEN';

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">
        Budget <code className="text-base opacity-70">{id}</code>
      </h1>

      <div className="mb-4 flex items-center gap-3">
        <Chip color={stateColor(budget.circuitState)}>
          <Chip.Label>{budget.circuitState ?? 'UNKNOWN'}</Chip.Label>
        </Chip>
      </div>

      {isOpen && (
        <Alert status="danger" className="mb-6">
          <Alert.Content>
            <Alert.Title>Budget breached — circuit OPEN</Alert.Title>
            <Alert.Description>All requests in this scope are being denied until the circuit resets.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <Card className="mb-6">
        <Card.Content>
          <div className="flex justify-between text-sm mb-1">
            <span>
              {formatUsd(budget.spendMicros)} / {formatUsd(budget.capMicros)}
            </span>
            <span>{pct.toFixed(1)}% used</span>
          </div>
          <ProgressBar
            aria-label="Budget spend"
            value={Math.min(pct, 100)}
            minValue={0}
            maxValue={100}
            color={isOpen ? 'danger' : 'accent'}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </Card.Content>
      </Card>

      <Button
        onPress={() => resetCircuit(id)}
        isDisabled={resetting || budget.circuitState === 'CLOSED'}
      >
        {resetting ? 'Resetting…' : 'Reset Circuit'}
      </Button>

      <Card className="mt-6">
        <Card.Content className="grid grid-cols-2 gap-2 text-sm">
          <div><strong>Org:</strong> {budget.orgId}</div>
          <div><strong>Job:</strong> {budget.jobId}</div>
          <div><strong>Target:</strong> {budget.targetId}</div>
          <div><strong>TTL:</strong> {budget.halfOpenTtlSeconds}s</div>
          <div><strong>Remaining:</strong> {formatUsd(budget.remainingMicros)}</div>
        </Card.Content>
      </Card>
    </main>
  );
}
