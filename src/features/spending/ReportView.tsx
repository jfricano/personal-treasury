import { Amount, CommitInput, Panel } from '@/components/ui';
import {
  reportTotals,
  reportGroups,
  lineYearToDate,
  variance,
  yearToDate,
  type Report,
} from '@/domain/spending';
import { formatUSD, sub } from '@/domain/money';
export function ReportView({
  report,
  reports,
  onLine,
  onNote,
}: {
  report: Report;
  reports: Report[];
  onLine?: (key: string) => void;
  onNote?: (note: string, key?: string) => void;
}) {
  const totals = reportTotals(report),
    ytd = yearToDate(reports, report.month),
    previous = reports
      .filter((r) => r.month < report.month)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
  return (
    <>
      <div className="v3-metrics">
        <div>
          <span>Planned spending</span>
          <strong>{formatUSD(totals.planned)}</strong>
        </div>
        <div>
          <span>Actual spending</span>
          <strong>{formatUSD(totals.actual)}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{formatUSD(sub(totals.planned, totals.actual))}</strong>
        </div>
        <div>
          <span>Net worth</span>
          <strong>{formatUSD(totals.netWorth)}</strong>
        </div>
      </div>
      <Panel title="Budget compared with actual">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category / line</th>
                <th>Funding</th>
                <th>Role</th>
                <th className="num">Planned</th>
                <th className="num">Actual</th>
                <th>Status</th>
                <th>YTD planned / actual</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => {
                const v = variance(l.actual, l.planned);
                return (
                  <tr key={l.lineKey}>
                    <td>
                      {onLine ? (
                        <button className="link-button" onClick={() => onLine(l.lineKey)}>
                          {l.label}
                        </button>
                      ) : (
                        l.label
                      )}
                      <div className="small subtle">{l.category}</div>
                    </td>
                    <td>{l.fundingAccount}</td>
                    <td>{l.role === 'set_aside' ? 'Set-aside' : 'Spending'}</td>
                    <td className="num">
                      <Amount value={l.planned} />
                    </td>
                    <td className="num">
                      <Amount value={l.actual} />
                    </td>
                    <td>
                      <span className={`badge ${v.status === 'Over' ? 'warn' : 'neutral'}`}>
                        {v.status === 'On plan'
                          ? 'On plan'
                          : `${v.status} by ${formatUSD(v.status === 'Under' ? sub('0', v.over) : v.over)}`}
                      </span>
                    </td>
                    <td>
                      <Amount value={lineYearToDate(reports, report.month, l.lineKey).planned} /> /{' '}
                      <Amount value={lineYearToDate(reports, report.month, l.lineKey).actual} />
                    </td>
                    <td>
                      {onNote ? (
                        <CommitInput
                          value={l.note}
                          ariaLabel={`Note for ${l.label}`}
                          onCommit={(v) => onNote(v, l.lineKey)}
                        />
                      ) : (
                        l.note
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>Unbudgeted</td>
                <td />
                <td>Spending</td>
                <td className="num">$0.00</td>
                <td className="num">
                  <Amount value={report.unbudgeted.actual} />
                </td>
                <td colSpan={3}>{report.unbudgeted.count} transactions</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
      {(['category', 'fundingAccount'] as const).map((field) => (
        <Panel key={field} title={field === 'category' ? 'Categories' : 'Funding accounts'}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Over / under</th>
                </tr>
              </thead>
              <tbody>
                {reportGroups(report, field).map((g) => (
                  <tr key={`${g.role}|${g.label}`}>
                    <td>{g.label}</td>
                    <td>{g.role === 'set_aside' ? 'Set-aside' : 'Spending'}</td>
                    <td>
                      <Amount value={g.planned} />
                    </td>
                    <td>
                      <Amount value={g.actual} />
                    </td>
                    <td>
                      <Amount value={sub(g.actual, g.planned)} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <Panel title="Report coverage">
        {report.sources.map((s) => (
          <div key={s.accountId} className="v3-rule">
            <strong>{s.label}</strong>
            <span>
              {s.status} · {s.source}
            </span>
            <span>{s.periods.map((p) => `${p.start} to ${p.end}`).join(', ') || 'No gathered window'}</span>
            {s.waiver && <span>{s.waiver}</span>}
            <span>
              {s.count} transactions; inflows <Amount value={s.inflows} />, outflows{' '}
              <Amount value={s.outflows} />
            </span>
          </div>
        ))}
      </Panel>
      <div className="grid-2">
        <Panel title="Income">
          <p>
            Take-home: <Amount value={report.income.takeHome} /> received /{' '}
            <Amount value={report.income.planned} /> planned
          </p>
          <p>
            Other income: <Amount value={report.income.other} />
          </p>
        </Panel>
        <Panel title="Year to date">
          <p>
            Actual spending: <Amount value={ytd.actual} /> / <Amount value={ytd.planned} /> planned in cleared
            reports.
          </p>
          <p className="subtle">
            {ytd.missing.length
              ? `Missing months: ${ytd.missing.join(', ')}`
              : 'Every month through this report is cleared.'}
          </p>
        </Panel>
      </div>
      <Panel title="Assets and liabilities">
        <p>
          Assets <Amount value={totals.assets} /> · Liabilities <Amount value={totals.liabilities} />
          {previous && (
            <>
              {' '}
              · Change <Amount value={sub(totals.netWorth, reportTotals(previous).netWorth)} signed />
            </>
          )}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Kind</th>
                <th>Value</th>
                <th>As of</th>
                <th>Method / source / captured</th>
                <th>Statement / loan details</th>
              </tr>
            </thead>
            <tbody>
              {report.balances.map((b) => (
                <tr key={b.accountId}>
                  <td>{b.label}</td>
                  <td>{b.kind.replaceAll('_', ' ')}</td>
                  <td>{b.value === null ? 'Unavailable' : <Amount value={b.value} />}</td>
                  <td>{b.asOf}</td>
                  <td>
                    {b.unavailable ? 'Unavailable' : b.estimate ? 'Month-end estimate' : 'As-of value'}
                    <div className="subtle small">
                      {b.source ?? ''}
                      {b.capturedAt && ` · ${new Date(b.capturedAt).toLocaleString()}`}
                    </div>
                  </td>
                  <td>
                    {b.details && (
                      <dl>
                        {(
                          [
                            ['statementBalance', 'Statement balance'],
                            ['minimumPayment', 'Minimum payment'],
                            ['originalPrincipal', 'Original principal'],
                            ['apr', 'APR (%)'],
                            ['dueDate', 'Next due date'],
                          ] as const
                        )
                          .filter(([key]) => b.details?.[key] !== undefined)
                          .map(([key, title]) => (
                            <div key={key}>
                              <dt>{title}</dt>
                              <dd>
                                {key === 'dueDate' || key === 'apr' ? (
                                  b.details![key]
                                ) : (
                                  <Amount value={b.details![key]!} />
                                )}
                              </dd>
                            </div>
                          ))}
                        <dt>Source</dt>
                        <dd>{b.details.source}</dd>
                      </dl>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {previous && (
          <p className="subtle">
            New accounts:{' '}
            {report.balances
              .filter((b) => !previous.balances.some((p) => p.accountId === b.accountId))
              .map((b) => b.label)
              .join(', ') || 'None'}
            . Missing accounts:{' '}
            {previous.balances
              .filter((b) => !report.balances.some((p) => p.accountId === b.accountId))
              .map((b) => b.label)
              .join(', ') || 'None'}
            .
          </p>
        )}
      </Panel>
      <Panel title="Transfers and exclusions">
        <ul>
          {report.flows.map((f) => (
            <li key={f.kind}>
              {f.kind}: {f.count} transactions, <Amount value={f.total} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Report note">
        {onNote ? (
          <CommitInput multiline value={report.note} ariaLabel="Report note" onCommit={(v) => onNote(v)} />
        ) : (
          <p>{report.note || 'No note'}</p>
        )}
      </Panel>
    </>
  );
}
