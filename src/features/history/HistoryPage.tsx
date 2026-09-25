import { useTreasury } from '@/app/context';
import { Amount, MonthStatusBadge, Panel } from '@/components/ui';
import { monthLabel } from '@/domain/monthly';

export function HistoryPage() {
  const { t, navigate } = useTreasury();
  const rows = t.monthSummaries().slice().reverse();
  return (
    <>
      <div className="page-head">
        <h2>History</h2>
        <span className="subtle">{rows.length} month(s)</span>
      </div>
      <Panel title="Monthly reconciliations">
        <table className="t" aria-label="Month history">
          <thead>
            <tr>
              <th className="l">Month</th>
              <th className="num">Expected cash</th>
              <th className="l">Status</th>
              <th className="num">Allocation difference</th>
              <th className="num">Journal difference</th>
              <th className="num">Final total</th>
              <th className="l">Closed</th>
              <th className="l">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr
                key={m.id}
                className="clickable"
                onClick={() => navigate({ page: 'monthly', monthId: m.id })}
              >
                <td>
                  <button
                    className="btn link"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate({ page: 'monthly', monthId: m.id });
                    }}
                  >
                    {monthLabel(m.month)}
                  </button>
                </td>
                <td className="num">
                  <Amount value={m.expectedCash} />
                </td>
                <td>
                  <MonthStatusBadge status={m.status} />
                  {m.issueCount > 0 && <span className="small subtle"> {m.issueCount} issue(s)</span>}
                </td>
                <td className="num">
                  <Amount value={m.allocationDifference} redNegative />
                </td>
                <td className="num">
                  <Amount value={m.journalDifference} redNegative />
                </td>
                <td className="num">
                  <Amount value={m.finalTotal} />
                </td>
                <td>
                  {m.closedAt ? (
                    <span className="badge closed">Closed {m.closedAt.slice(0, 10)}</span>
                  ) : (
                    <span className="badge ready">Open</span>
                  )}
                </td>
                <td className="small subtle">{m.imported ? 'Workbook import' : 'Entered in app'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="subtle">
                  No months yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="small subtle" style={{ marginBottom: 0 }}>
          Imported legacy months had no expected-cash cell; their expected cash equals the sheet’s allocation
          total. Their original “Balanced/Review” result reflected the journal difference only; the status
          here also applies the full reconciliation rules.
        </p>
      </Panel>
    </>
  );
}
