'use client';
import Link from 'next/link';
import { Alert, EmptyState, Spinner } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';

export function LoadingView() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner size="lg" />
    </div>
  );
}

export function ConnectionErrorView({ message }: { message?: string }) {
  return (
    <Alert status="danger" className="my-8">
      <Alert.Content>
        <Alert.Title>Can&apos;t reach the server</Alert.Title>
        <Alert.Description>
          {message ?? 'The dashboard could not load data from the API. Check that the backend is running and try again.'}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

export function NotFoundView({ label }: { label: string }) {
  return (
    <EmptyState className="my-16">
      <p className="text-lg font-medium">{label}</p>
    </EmptyState>
  );
}

export function EmptyBudgetsView() {
  return (
    <EmptyState className="my-16">
      <p className="text-lg font-medium">No budgets yet</p>
      <p className="text-sm opacity-70 mb-4">Create a budget to start monitoring scraping spend.</p>
      <Link href="/budgets/new" className={buttonVariants({ variant: 'primary' })}>
        Create a budget
      </Link>
    </EmptyState>
  );
}
