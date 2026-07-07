'use client';
import Link from 'next/link';
import { buttonVariants } from '@heroui/styles';
import { useGetBudgetsQuery } from '../store/api/governor.api';
import { BudgetListItem } from '../features/budgets/BudgetListItem';
import { ConnectionErrorView, EmptyBudgetsView, LoadingView } from '../features/budgets/StateViews';

export default function HomePage() {
  const { data: budgets, isLoading, isError } = useGetBudgetsQuery();

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Governor Dashboard</h1>
        {budgets && budgets.length > 0 && (
          <Link href="/budgets/new" className={buttonVariants({ variant: 'primary' })}>
            Create Budget
          </Link>
        )}
      </div>

      {isLoading && <LoadingView />}
      {isError && <ConnectionErrorView />}
      {!isLoading && !isError && budgets?.length === 0 && <EmptyBudgetsView />}
      {!isLoading && !isError && budgets && budgets.length > 0 && (
        <div className="flex flex-col gap-4">
          {budgets.map((budget) => (
            <BudgetListItem key={budget.id} budget={budget} />
          ))}
        </div>
      )}
    </main>
  );
}
