import { BudgetVersions } from '@/features/budget/BudgetPage';

export function HistoryPage() {
  return (
    <>
      <div className="page-head">
        <h1>Budget History</h1>
        <span className="subtle">Review, duplicate or remove past budget versions.</span>
      </div>
      <BudgetVersions />
    </>
  );
}
