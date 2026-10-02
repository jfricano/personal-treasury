import { useState, useEffect } from 'react';
import { useTreasury } from '@/app/context';
import { Amount, Panel } from '@/components/ui';
import { clearBlockers, reportTotals, latestUnclearedMonth } from '@/domain/spending';
import { useReviewStore } from './useReviewStore';
export function SpendingDashboard() {
  const [intro, setIntro] = useState(() => {
    try {
      return localStorage.getItem('pt.v3.introSeen') !== '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('pt.v3.introSeen', '1');
    } catch {
      /* This introduction is optional when browser preferences are unavailable. */
    }
  }, []);
  const { t, navigate } = useTreasury(),
    { store, loaded, error } = useReviewStore(t);
  const entry = store
    .entries()
    .filter((e) => ['open', 'awaiting_upload'].includes(e.state))
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const review = entry ? store.get(entry.ref) : null,
    report = t.spending.reports()[0];
  const blockers = review
    ? clearBlockers(review, t.spending.accounts(), t.spending.budget(review.budgetVersionId))
    : [];
  return (
    <>
      {intro && (
        <Panel title="New in v3">
          <p>
            Budget Analysis compares a monthly spending review with your budget. Connected Accounts manages
            the bank and card accounts used in that review.
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => navigate({ page: 'analysis' })}>
              Explore Budget Analysis
            </button>
            <button className="btn" onClick={() => navigate({ page: 'connections' })}>
              Open Connected Accounts
            </button>
            <button className="btn" onClick={() => setIntro(false)}>
              Dismiss introduction
            </button>
          </div>
        </Panel>
      )}
      <Panel
        title="Spending review"
        actions={
          <button className="btn small" onClick={() => navigate({ page: 'analysis' })}>
            Budget Analysis
          </button>
        }
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : !loaded ? (
          <p>Opening reviews…</p>
        ) : entry ? (
          <>
            <p>
              {entry.month} · {entry.state.replaceAll('_', ' ')} · {blockers.length} items before clearing
            </p>
            {store.warning(entry.ref) && <p className="notice">{store.warning(entry.ref)}</p>}
          </>
        ) : (
          <p>No open spending review. Next uncleared month: {latestUnclearedMonth(t.spending.reports())}.</p>
        )}
        {report && (
          <p>
            Latest cleared net worth: <Amount value={reportTotals(report).netWorth} /> · {report.month}
          </p>
        )}
      </Panel>
    </>
  );
}
