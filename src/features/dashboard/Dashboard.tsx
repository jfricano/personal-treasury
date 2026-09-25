import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { Amount, MonthStatusBadge, Panel } from '@/components/ui';
import { monthLabel } from '@/domain/monthly';
import { dec, formatUSD } from '@/domain/money';
import { MonthSelect } from '@/features/monthly/MonthSelect';

export function Dashboard() {
  const { t, route, navigate, run } = useTreasury();
  const [showAll, setShowAll] = useState(false);

  if (t.isEmpty()) {
    return (
      <div className="empty">
        <h3>Welcome to Personal Treasury</h3>
        <p className="subtle">
          All data stays {t.storage.kind === 'session' ? 'in this browser tab' : 'on this computer'}. Start by
          importing your workbook, or set up accounts by hand.
        </p>
        <div className="choice">
          <button onClick={() => navigate({ page: 'import' })}>
            <b>Import workbook</b>
            Analyze Cash Flow and Account Ledger.xlsx, review the preview, then commit.
          </button>
          <button onClick={() => navigate({ page: 'accounts' })}>
            <b>Create manually</b>
            Add account buckets and a default allocation, then start a month.
          </button>
        </div>
      </div>
    );
  }

  const monthId = route.monthId && t.repos.getMonth(route.monthId) ? route.monthId : t.currentMonthId();
  const d = t.dashboard(monthId);
  const m = d.month;
  const code = t.codeOf;
  const accounts = t.accountMap();
  const goMonth = () => navigate({ page: 'monthly', monthId: m?.cycle.id });
  const required = m?.result.lines.filter((l) => l.required) ?? [];
  const rows = showAll ? (m?.result.lines ?? []) : required;
  const maxAlloc = m
    ? m.result.lines.reduce((mx, l) => (dec(l.budgetAmount).gt(mx) ? dec(l.budgetAmount) : mx), dec('0'))
    : dec('0');

  return (
    <>
      <div className="page-head">
        <h2>Dashboard</h2>
        {m && (
          <MonthSelect value={m.cycle.id} onChange={(id) => navigate({ page: 'dashboard', monthId: id })} />
        )}
        {m && <MonthStatusBadge status={m.result.status} closed={m.closed} />}
        <span className="spacer" />
        <button className="btn" onClick={() => navigate({ page: 'monthly', monthId: m?.cycle.id })}>
          Open reconciliation
        </button>
      </div>

      <div className="strip" role="group" aria-label="Summary">
        <button onClick={goMonth}>
          <div className="k">Month</div>
          <div className="v">{m ? monthLabel(m.cycle.month) : '—'}</div>
        </button>
        <button onClick={goMonth}>
          <div className="k">Expected cash</div>
          <div className="v">{m ? <Amount value={m.cycle.expectedCash} /> : '—'}</div>
        </button>
        <button onClick={goMonth}>
          <div className="k">Allocation difference</div>
          <div className={`v${m && !m.result.checks.allocation ? ' neg' : ''}`}>
            {m ? <Amount value={m.result.allocationDifference} /> : '—'}
          </div>
        </button>
        <button onClick={goMonth}>
          <div className="k">Transfers completed</div>
          <div className="v">{m ? `${m.result.doneCount} of ${m.result.requiredCount}` : '—'}</div>
        </button>
        <button onClick={() => navigate({ page: 'debts' })}>
          <div className="k">Non-zero debts</div>
          <div className="v">{d.debts.nonZeroCount}</div>
        </button>
        <button onClick={() => navigate({ page: 'debts' })}>
          <div className="k">Total debt outstanding</div>
          <div className="v">
            <Amount value={d.debts.totalOutstanding} />
          </div>
        </button>
      </div>

      <div className="grid-2">
        <div>
          <Panel
            title="Items requiring review"
            actions={m && <span className="small subtle">{m.result.issues.length} item(s)</span>}
          >
            <ul className="issues">
              {m?.result.issues.map((i, k) => (
                <li key={k}>
                  <span className={`dot${i.blocking ? '' : ' soft'}`} aria-hidden />
                  <span>
                    {i.message}{' '}
                    <button className="btn link small" onClick={goMonth}>
                      Resolve
                    </button>
                  </span>
                </li>
              ))}
              {d.needsReviewAccounts.map((a) => (
                <li key={a.id}>
                  <span className="dot" aria-hidden />
                  <span>
                    Imported account code <span className="code">{a.code}</span> needs review.{' '}
                    <button className="btn link small" onClick={() => navigate({ page: 'accounts' })}>
                      Review
                    </button>
                  </span>
                </li>
              ))}
              {d.budgetDiff && (
                <li>
                  <span className="dot soft" aria-hidden />
                  <span>
                    Budget {d.budgetDiff.versionLabel} differs from this month&apos;s allocations.{' '}
                    <button className="btn link small" onClick={goMonth}>
                      Review and refresh
                    </button>
                  </span>
                </li>
              )}
              {d.unresolvedWarnings.length > 0 && (
                <li>
                  <span className="dot" aria-hidden />
                  <span>
                    {d.unresolvedWarnings.length} high-severity import warning(s) are unresolved.{' '}
                    <button className="btn link small" onClick={() => navigate({ page: 'import' })}>
                      Open import report
                    </button>
                  </span>
                </li>
              )}
              {m &&
                m.result.issues.length === 0 &&
                d.needsReviewAccounts.length === 0 &&
                d.unresolvedWarnings.length === 0 &&
                !d.budgetDiff && (
                  <li className="subtle">Nothing needs attention for {monthLabel(m.cycle.month)}.</li>
                )}
              {!m && <li className="subtle">No months yet. Create one from Monthly reconciliation.</li>}
            </ul>
          </Panel>

          <Panel
            title="Required transfers"
            actions={
              <label className="small">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{' '}
                Show all
              </label>
            }
          >
            {m ? (
              <table className="t">
                <thead>
                  <tr>
                    <th className="l">Account</th>
                    <th className="num">Final transfer</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.accountId} className={l.required ? '' : 'muted'}>
                      <td className="code">{code(l.accountId)}</td>
                      <td className="num">
                        <Amount
                          value={l.finalTransfer}
                          redNegative
                          label={`${code(l.accountId)} final transfer`}
                        />
                      </td>
                      <td>
                        {l.effectiveState === 'done' ? (
                          <span className="badge complete">✓ Done</span>
                        ) : l.effectiveState === 'not_required' ? (
                          <span className="badge neutral">Not required</span>
                        ) : (
                          <span className="badge ready">Pending</span>
                        )}
                      </td>
                      <td>
                        {l.required && (
                          <label className="small">
                            <input
                              type="checkbox"
                              aria-label={`Mark ${code(l.accountId)} transfer done`}
                              checked={l.effectiveState === 'done'}
                              disabled={m.closed}
                              onChange={(e) =>
                                run(() =>
                                  t.setTransferState(
                                    m.cycle.id,
                                    l.accountId,
                                    e.target.checked ? 'done' : 'pending',
                                  ),
                                )
                              }
                            />{' '}
                            Done
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="subtle">
                        No non-zero transfers.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <p className="subtle">No month selected.</p>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Current allocations">
            {m ? (
              <table className="t">
                <thead>
                  <tr>
                    <th className="l">Account</th>
                    <th className="l">Name</th>
                    <th className="num">Allocation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {m.result.lines
                    .filter((l) => !dec(l.budgetAmount).isZero())
                    .map((l) => (
                      <tr key={l.accountId}>
                        <td className="code">{code(l.accountId)}</td>
                        <td className="subtle">{accounts.get(l.accountId)?.displayName ?? ''}</td>
                        <td className="num">
                          <Amount value={l.budgetAmount} />
                        </td>
                        <td style={{ width: 120 }}>
                          <div className="bar" aria-hidden>
                            <i
                              style={{
                                width: `${maxAlloc.isZero() ? 0 : dec(l.budgetAmount).div(maxAlloc).times(100).toNumber()}%`,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className="num">
                      <Amount value={m.result.totals.budget} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="subtle">No month selected.</p>
            )}
          </Panel>

          <Panel
            title="Budget"
            actions={
              <button className="btn small" onClick={() => navigate({ page: 'budget' })}>
                Open budget
              </button>
            }
          >
            {d.budget ? (
              <p style={{ margin: 0 }}>
                Active plan <b>{d.budget.label}</b>: take-home <b>{formatUSD(d.budget.takeHome)}</b> a month.
                {d.budget.taxDifference !== null && (
                  <>
                    {' '}
                    {d.budget.taxYear} tax estimate:{' '}
                    {dec(d.budget.taxDifference).isZero() ? (
                      'withholding matches.'
                    ) : dec(d.budget.taxDifference).isPositive() ? (
                      <b className="neg">projected underpayment {formatUSD(d.budget.taxDifference)}</b>
                    ) : (
                      <b>projected overpayment {formatUSD(dec(d.budget.taxDifference).abs().toFixed())}</b>
                    )}
                  </>
                )}
              </p>
            ) : (
              <p className="subtle" style={{ margin: 0 }}>
                No active budget. Import Personal Budget.xlsx on the Import and export page.
              </p>
            )}
          </Panel>

          <Panel
            title="Debts at a glance"
            actions={
              <button className="btn small" onClick={() => navigate({ page: 'debts' })}>
                Open debts
              </button>
            }
          >
            <p style={{ margin: 0 }}>
              {d.debts.nonZeroCount} non-zero debts totalling <b>{formatUSD(d.debts.totalOutstanding)}</b>.
              Largest <b>{formatUSD(d.debts.largestDebt)}</b> (Loan {d.debts.largestLoanIds.join(', ') || '—'}
              ).
            </p>
          </Panel>

          <Panel title="Recent activity">
            <ul className="issues">
              {d.recent.map((a) => (
                <li key={a.id}>
                  <span className="loc">{a.at.slice(0, 16).replace('T', ' ')}</span>
                  <span>
                    {a.action} {a.entity.replace('_', ' ')}
                    {a.note ? ` — ${a.note}` : ''}
                  </span>
                </li>
              ))}
              {d.recent.length === 0 && <li className="subtle">No activity yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
