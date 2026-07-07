'use client';
import Link from 'next/link';
import { Card, Chip, ProgressBar } from '@heroui/react';
import type { Budget } from '../../store/api/governor.api';
import { formatUsd, stateColor } from './stateColor';

export function BudgetListItem({ budget }: { budget: Budget }) {
  const cap = BigInt(budget.capMicros);
  const spend = BigInt(budget.spendMicros ?? '0');
  const pct = cap > 0n ? Number((spend * 10000n) / cap) / 100 : 0;

  return (
    <Link href={`/budgets/${budget.id}`} className="block">
      <Card className="hover:opacity-90 transition-opacity">
        <Card.Header className="flex items-center justify-between">
          <Card.Title>
            {budget.orgId} / {budget.jobId} / {budget.targetId}
          </Card.Title>
          <Chip color={stateColor(budget.circuitState)}>
            <Chip.Label>{budget.circuitState ?? 'UNKNOWN'}</Chip.Label>
          </Chip>
        </Card.Header>
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
            color={budget.circuitState === 'OPEN' ? 'danger' : 'accent'}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </Card.Content>
      </Card>
    </Link>
  );
}
