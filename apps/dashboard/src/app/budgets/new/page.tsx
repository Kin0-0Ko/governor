import { BudgetForm } from '../../../features/budgets/BudgetForm';

export default function NewBudgetPage() {
  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Create Budget</h1>
      <BudgetForm />
    </main>
  );
}
