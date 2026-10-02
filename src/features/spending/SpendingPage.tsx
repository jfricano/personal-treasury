import { gatherPlaid } from '@/sources/gather';
import { isTauri } from '@/db/storage';
import { useEffect, useState } from 'react';
import { useTreasury } from '@/app/context';
import { Amount, CommitInput, Dialog, Field, Panel, useConfirm } from '@/components/ui';
import {
  buildReport,
  latePostingChanges,
  latestUnclearedMonth,
  liabilityKinds,
  clearBlockers,
  coverage,
  exactAmount,
  calendarDate,
  inMonth,
  mergeTransactions,
  monthPeriod,
  normalizedDescription,
  pairCandidates,
  possibleDuplicates,
  safeText,
  suggestRule,
  type InstitutionAccount,
  type Review,
  type Rule,
  type Transaction,
} from '@/domain/spending';
import { useReviewStore } from './useReviewStore';
import { StatementImport } from './StatementImport';
import { ClassificationDialog } from './ClassificationDialog';
import { ReportView } from './ReportView';
import { ReviewSyncPanel } from './ReviewSyncPanel';
import { RuleEditor } from './RuleEditor';
import { LiabilityDetails } from './LiabilityDetails';
import { exportSpendingReport } from '@/export/spendingReport';
import { saveFile } from '@/platform/files';

type Tab = 'Coverage' | 'Transactions' | 'Summary' | 'Assets and liabilities' | 'Reports' | 'Rules';
export function SpendingPage() {
  const { t, run, toast, navigate, syncSession, extras } = useTreasury();
  const { store, loaded, error } = useReviewStore(t);
  const confirm = useConfirm();
  const [month, setMonth] = useState(() => latestUnclearedMonth(t.spending.reports())),
    [ref, setRef] = useState(''),
    [tab, setTab] = useState<Tab>('Coverage'),
    [importAccount, setImportAccount] = useState<InstitutionAccount | null>(null),
    [classify, setClassify] = useState<Transaction | null>(null),
    [filter, setFilter] = useState(''),
    [lineFilter, setLineFilter] = useState(''),
    [onlyUnclassified, setOnlyUnclassified] = useState(false),
    [manual, setManual] = useState(''),
    [manualDate, setManualDate] = useState(''),
    [manualDescription, setManualDescription] = useState(''),
    [manualAmount, setManualAmount] = useState(''),
    [selectedReport, setSelectedReport] = useState(''),
    [remember, setRemember] = useState<Transaction | null>(null),
    [pattern, setPattern] = useState(''),
    [ruleEdit, setRuleEdit] = useState<Rule | null>(null),
    [accountFilter, setAccountFilter] = useState(''),
    [dispositionFilter, setDispositionFilter] = useState(''),
    [waive, setWaive] = useState(''),
    [waiverReason, setWaiverReason] = useState('no activity'),
    [waiverNote, setWaiverNote] = useState('');
  const review = ref ? store.get(ref) : null,
    entry = store.entries().find((e) => e.ref === ref),
    accounts = t.spending.accounts().filter((a) => a.active),
    budget = review ? t.spending.budget(review.budgetVersionId) : null,
    reports = t.spending.reports();
  const edit = (fn: (r: Review) => void) => run(() => store.edit(ref, fn));
  const fail = (e: unknown) => toast((e as Error).message, 'error');
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'z' &&
        !e.shiftKey &&
        !(e.target as HTMLElement).closest('input,textarea,select') &&
        store.canUndo(ref)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        store.undo(ref);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [store, ref]);
  const chooseVersion = (id: string) =>
    edit((r) => {
      r.budgetVersionId = id;
      const keys = new Set(t.spending.budget(id)?.lines.map((l) => l.lineKey));
      for (const tx of r.transactions)
        if (tx.disposition?.kind === 'budget' && tx.disposition.parts.some((p) => !keys.has(p.lineKey)))
          delete tx.disposition;
    });
  const applyRules = () =>
    edit((r) => {
      const keys = new Set(budget?.lines.map((l) => l.lineKey));
      r.transactions = r.transactions.map((tx) =>
        tx.disposition?.state === 'accepted'
          ? tx
          : { ...tx, disposition: suggestRule(tx, t.spending.rules(), keys) },
      );
    });
  const start = async (targetMonth = month) => {
    if (
      reports.some((r) => r.month === targetMonth) &&
      !(await confirm.ask(
        'Re-run this month? The existing report remains visible until the new review is cleared.',
      ))
    )
      return;
    try {
      const settings = t.spending.reviewSettings();
      const r = store.create(
        targetMonth,
        t.spending.defaultVersion(targetMonth),
        settings.timeZone,
        settings,
      );
      setMonth(targetMonth);
      setRef(r.ref);
      setTab('Coverage');
    } catch (e) {
      fail(e);
    }
  };
  const sample = async () => {
    try {
      const sampleMonth = '2026-08';
      if (
        store.entries().some((e) => e.month === sampleMonth && ['open', 'awaiting_upload'].includes(e.state))
      )
        throw new Error('Resume the existing August review first.');
      let connection = t.spending
        .connections()
        .find((c) => c.displayName === 'Harper sample statements' && c.status !== 'removed');
      if (!connection) {
        const id = t.spending.addConnection('Harper sample statements');
        connection = t.spending.connections().find((c) => c.id === id)!;
        for (const [displayName, kind, mask] of [
          ['Harper Checking', 'checking', '1111'],
          ['Harper Card', 'credit_card', '3333'],
        ] as const)
          t.spending.saveAccount({
            id: crypto.randomUUID(),
            connectionId: id,
            providerRef: crypto.randomUUID(),
            displayName,
            mask,
            kind,
            inReview: true,
            inSnapshot: true,
            confirmed: true,
            treasuryAccountId: null,
            shared: true,
            active: true,
            csvProfile: null,
          });
      }
      const sampleAccounts = t.spending.accounts().filter((a) => a.connectionId === connection.id),
        checking = sampleAccounts[0],
        card = sampleAccounts[1];
      const v =
        t.spending.defaultVersion(sampleMonth) ||
        t.budget.versions().find((v) => v.version.detailLevel === 'full')?.version.id ||
        '';
      const r = store.create(sampleMonth, v);
      store.edit(r.ref, (r) => {
        const rows = [
          ['2026-08-02', 'Harbor Market', '-82.50', checking.id],
          ['2026-08-04', 'Monthly pay', '5200', checking.id],
          ['2026-08-09', 'Card payment', '-300', checking.id],
          ['2026-08-10', 'Payment received', '300', card.id],
          ['2026-08-12', 'Corner Cafe', '-18.40', card.id],
          ['2026-08-17', 'Household and travel supplies', '-120', card.id],
          ['2026-08-22', 'Market refund', '12.50', checking.id],
        ];
        r.transactions = rows.map(([postedDate, description, amount, institutionAccountId]) => ({
          id: crypto.randomUUID(),
          institutionAccountId,
          postedDate,
          description,
          amount,
          sourceAmount: amount,
          source: { kind: 'file', name: 'Harper sample.csv' },
          pending: false,
          removedAtSource: false,
        }));
        for (const a of sampleAccounts) {
          r.evidence[a.id] = {
            source: 'file',
            periods: [monthPeriod(sampleMonth)],
            gatheredAt: new Date().toISOString(),
          };
          r.balances[a.id] = {
            value: a.kind === 'credit_card' ? '-812.40' : '2400',
            asOf: '2026-08-31',
            source: 'file',
            capturedAt: new Date().toISOString(),
            unavailable: false,
            periods: [monthPeriod(sampleMonth)],
          };
        }
      });
      setRef(r.ref);
      setMonth(sampleMonth);
      setTab('Transactions');
      toast('Sample review ready. Classify the seven transactions, then clear the report.', 'success');
    } catch (e) {
      fail(e);
    }
  };
  if (error) return <div role="alert">{error}</div>;
  if (!loaded) return <p>Opening temporary reviews…</p>;
  const visible =
    review?.transactions.filter(
      (tx) =>
        (!accountFilter || tx.institutionAccountId === accountFilter) &&
        (!dispositionFilter ||
          (dispositionFilter === 'suggested'
            ? tx.disposition?.state === 'suggested'
            : dispositionFilter === 'pairs'
              ? pairCandidates(tx, review!.transactions, accounts, review!.pairingDays).length > 0
              : tx.disposition?.kind === dispositionFilter)) &&
        (!onlyUnclassified || tx.disposition?.state !== 'accepted') &&
        (!lineFilter ||
          (tx.disposition?.kind === 'budget' &&
            tx.disposition.parts.some((p) => p.lineKey === lineFilter))) &&
        `${tx.description} ${tx.postedDate}`.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  const blockers = review ? clearBlockers(review, accounts, budget) : [];
  const preview = review && budget ? buildReport(review, accounts, budget, 'Working copy', true) : null;
  const repeated = (review?.transactions ?? []).filter((tx, index, all) => {
    const d = tx.disposition;
    if (
      d?.state !== 'accepted' ||
      d.ruleId ||
      tx.pending ||
      !['budget', 'income', 'unbudgeted'].includes(d.kind) ||
      (d.kind === 'budget' && d.parts.length !== 1)
    )
      return false;
    const name = normalizedDescription(tx.description);
    const action = (x: Transaction) =>
      x.disposition?.kind === 'budget'
        ? `budget:${x.disposition.parts[0]?.lineKey}`
        : x.disposition?.kind === 'income'
          ? `income:${x.disposition.incomeKind}`
          : x.disposition?.kind;
    return (
      !!name &&
      all.filter(
        (x) =>
          normalizedDescription(x.description) === name &&
          x.disposition?.state === 'accepted' &&
          !x.disposition.ruleId &&
          action(x) === action(tx),
      ).length > 1 &&
      all.findIndex((x) => normalizedDescription(x.description) === name && action(x) === action(tx)) ===
        index
    );
  });
  const report = reports.find((r) => r.month === (selectedReport || reports[0]?.month));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget Analysis</h1>
          <p className="subtle">Review a month. Keep the report. Let the transaction details go.</p>
        </div>
        <span className={`badge ${store.status === 'error' ? 'warn' : 'neutral'}`} role="status">
          {store.status === 'saved'
            ? 'Saved'
            : store.status === 'saving'
              ? 'Saving…'
              : `Save failed: ${store.error}`}
        </span>
      </div>
      {extras.security && <ReviewSyncPanel session={extras.security} store={store} />}
      <Panel
        title="Monthly reviews"
        actions={
          <button className="btn small" onClick={() => navigate({ page: 'connections' })}>
            Connected Accounts
          </button>
        }
      >
        <div className="btn-row">
          <Field label="Review month">
            <input className="box" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <button className="btn primary" onClick={() => void start()}>
            Start review
          </button>
          {t.storage.kind === 'session' && (
            <button className="btn" onClick={() => void sample()}>
              Try a sample review
            </button>
          )}
          <button className="btn" onClick={() => setTab('Reports')}>
            View reports ({reports.length})
          </button>
        </div>
        <div className="v3-review-list">
          {store.entries().map((e) => (
            <button
              key={e.ref}
              className={`btn small ${ref === e.ref ? 'active' : ''}`}
              onClick={() => {
                setRef(e.ref);
                setMonth(e.month);
                setTab(e.state === 'cleared' ? 'Reports' : 'Coverage');
                if (e.state === 'cleared') setSelectedReport(e.month);
              }}
            >
              {e.month} · {e.state.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      </Panel>
      <div className="tabs" role="tablist" aria-label="Budget Analysis views">
        {(['Coverage', 'Transactions', 'Summary', 'Assets and liabilities', 'Reports', 'Rules'] as Tab[]).map(
          (name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              className={`btn ${tab === name ? 'active' : ''}`}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ),
        )}
      </div>
      {tab === 'Reports' ? (
        report ? (
          <>
            <div className="btn-row">
              <Field label="Report month">
                <select
                  className="box"
                  value={report.month}
                  onChange={(e) => setSelectedReport(e.target.value)}
                >
                  {reports.map((r) => (
                    <option key={r.month}>{r.month}</option>
                  ))}
                </select>
              </Field>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await saveFile(
                      `Spending report ${report.month}.xlsx`,
                      exportSpendingReport(report, reports),
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    );
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Export report
              </button>
              <button
                className="btn"
                onClick={async () => {
                  if (await confirm.ask('Delete this report? You can undo this deletion.', { danger: true }))
                    run(() => t.spending.deleteReport(report.month));
                }}
              >
                Delete report
              </button>
            </div>
            <p className="subtle">
              Cleared {report.clearedAt.slice(0, 10)} · {report.budgetLabel}. Transaction details have been
              deleted.
            </p>
            <ReportView
              report={report}
              reports={reports}
              onNote={(note, key) => run(() => t.spending.setReportNote(report.month, note, key))}
            />
          </>
        ) : (
          <div className="empty-state">
            <h2>No cleared reports yet</h2>
            <p>
              Start a monthly review, classify its transactions, then clear it to keep a permanent report.
            </p>
          </div>
        )
      ) : tab === 'Rules' ? (
        <Panel title="Categorization rules">
          <p>
            Rules suggest classifications. They never accept a transaction for you. Use Remember this on a
            classified transaction to add a rule.
          </p>
          <button
            className="btn"
            onClick={() =>
              setRuleEdit({
                id: crypto.randomUUID(),
                position: t.spending.rules().length,
                enabled: true,
                createdAt: new Date().toISOString(),
                pattern: '',
                match: 'contains',
                direction: 'any',
                action: { kind: 'unbudgeted' },
              })
            }
          >
            New rule
          </button>
          {t.spending.rules().map((r) => (
            <div className="v3-rule" key={r.id}>
              <label>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => run(() => t.spending.saveRule({ ...r, enabled: e.target.checked }))}
                />{' '}
                {r.match.replaceAll('_', ' ')} “{r.pattern}” → {r.action.kind}
              </label>
              <Field label={`Priority for ${r.pattern}`}>
                <input
                  type="number"
                  className="box"
                  value={r.position}
                  onChange={(e) => run(() => t.spending.saveRule({ ...r, position: Number(e.target.value) }))}
                />
              </Field>
              {r.action.kind === 'budget' &&
                budget &&
                !budget.lines.some((l) => l.lineKey === (r.action as { lineKey: string }).lineKey) && (
                  <span className="badge warn">Stale</span>
                )}
              <button className="btn small" onClick={() => setRuleEdit(r)}>
                Edit rule
              </button>
              <button className="btn small" onClick={() => run(() => t.spending.deleteRule(r.id))}>
                Delete
              </button>
            </div>
          ))}
        </Panel>
      ) : !review ? (
        <div className="empty-state">
          <h2>{entry ? `Review ${entry.state.replaceAll('_', ' ')}` : 'Choose a month to get started'}</h2>
          <p>
            {entry
              ? 'Its temporary transactions are no longer available. Start a new review to gather them again.'
              : 'Choose a full-detail budget and bring in statements from your connected accounts.'}
          </p>
        </div>
      ) : (
        <>
          <div className="v3-toolbar">
            <Field label="Budget version">
              <select
                className="box"
                value={review.budgetVersionId}
                disabled={entry?.state !== 'open'}
                onChange={(e) => chooseVersion(e.target.value)}
              >
                <option value="">Choose a full-detail budget</option>
                {t.budget
                  .versions()
                  .filter((v) => v.version.detailLevel === 'full')
                  .map((v) => (
                    <option key={v.version.id} value={v.version.id}>
                      {v.version.label}
                    </option>
                  ))}
              </select>
            </Field>
            <span>
              {review.month} · {review.transactions.filter((tx) => inMonth(tx, review, accounts)).length}{' '}
              posted transactions
            </span>
            <button className="btn" disabled={!store.canUndo(ref)} onClick={() => store.undo(ref)}>
              Undo review edit
            </button>
            <button className="btn" disabled={entry?.state !== 'open'} onClick={() => edit(() => undefined)}>
              Keep open
            </button>
            {preview && (
              <button
                className="btn"
                onClick={async () => {
                  if (
                    !(await confirm.ask(
                      'This working copy includes individual transaction descriptions and amounts. Save it only where you want those details kept.',
                      { confirmLabel: 'Export working copy' },
                    ))
                  )
                    return;
                  try {
                    await saveFile(
                      `Working spending review ${review.month}.xlsx`,
                      exportSpendingReport(preview, reports, review),
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    );
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Export working copy
              </button>
            )}
            <button
              className="btn"
              onClick={async () => {
                if (
                  await confirm.ask(
                    'Discard this review? Its transactions will be deleted and cannot be restored with Undo.',
                    { danger: true, confirmLabel: 'Discard review' },
                  )
                ) {
                  try {
                    await store.finish(ref, 'discarded');
                  } catch (e) {
                    fail(e);
                  }
                }
              }}
            >
              Discard review
            </button>
          </div>
          {latePostingChanges(review, reports).map((change) => (
            <div className="notice" key={change.account}>
              <p>
                {change.account}: the final week of {change.month} changed by {change.countChange}{' '}
                transactions and {change.amountChange} dollars since clearing.
              </p>
              <button className="btn" onClick={() => void start(change.month)}>
                Re-run {change.month}
              </button>
              <p className="subtle">
                Only the final seven days are compared. Earlier late postings are not detected.
              </p>
            </div>
          ))}
          {store.warning(ref) && <p className="notice">{store.warning(ref)}</p>}
          {entry?.state === 'awaiting_upload' && (
            <p className="notice">
              Report saved; awaiting upload before deleting temporary data.{' '}
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await store.finish(ref, 'cleared', async () => {
                      await t.flush();
                      if (extras.security) await extras.security.flush();
                      else if (syncSession)
                        throw new Error('Reconnect with v3 encrypted sync before completing this review.');
                    });
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Retry completion
              </button>
            </p>
          )}
          {tab === 'Coverage' && (
            <>
              <p className="subtle">
                Every account in spending review needs a complete statement period or an explicit waiver.
              </p>
              {accounts
                .filter((a) => a.inReview)
                .map((a) => {
                  const c = coverage(
                    review.month,
                    review.evidence[a.id],
                    review.transactions.filter((tx) => tx.institutionAccountId === a.id),
                    review.settleDays,
                    review.timeZone,
                  );
                  return (
                    <Panel
                      key={a.id}
                      id={a.id}
                      title={a.displayName}
                      actions={
                        <span
                          className={`badge ${c.status === 'complete' ? 'complete' : c.status === 'waived' ? 'neutral' : 'warn'}`}
                        >
                          {c.status}
                        </span>
                      }
                    >
                      <p>{c.reason}</p>
                      {c.reason === 'Confirm history' && (
                        <button
                          className="btn"
                          onClick={() =>
                            edit((r) => {
                              r.evidence[a.id].historyConfirmed = true;
                            })
                          }
                        >
                          Confirm history covers this month
                        </button>
                      )}
                      <div className="btn-row">
                        {isTauri() &&
                          extras.security &&
                          t.spending
                            .connections()
                            .some((c) => c.id === a.connectionId && c.provider === 'plaid') && (
                            <button
                              className="btn"
                              onClick={async () => {
                                try {
                                  const result = await gatherPlaid(
                                    t,
                                    extras.security!,
                                    a.connectionId,
                                    review,
                                  );
                                  edit((r) => {
                                    r.transactions = mergeTransactions(r.transactions, result.transactions);
                                    Object.assign(r.evidence, result.evidence);
                                    Object.assign(r.balances, result.balances);
                                  });
                                } catch (e) {
                                  fail(e);
                                }
                              }}
                            >
                              Gather from Plaid
                            </button>
                          )}
                        <button className="btn" onClick={() => setImportAccount(a)}>
                          Import statement
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            setManual(a.id);
                            setManualDate(`${review.month}-01`);
                          }}
                        >
                          Manual entry
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            setWaive(a.id);
                            setWaiverNote('');
                          }}
                        >
                          Waive account
                        </button>
                      </div>
                    </Panel>
                  );
                })}
              {!accounts.some((a) => a.inReview) && (
                <button className="btn primary" onClick={() => navigate({ page: 'connections' })}>
                  Add connected accounts
                </button>
              )}
            </>
          )}
          {tab === 'Transactions' && (
            <>
              <div className="v3-toolbar">
                <Field label="Search transactions">
                  <input
                    className="box"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Description or date"
                  />
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={onlyUnclassified}
                    onChange={(e) => setOnlyUnclassified(e.target.checked)}
                  />{' '}
                  Needs classification
                </label>
                <Field label="Filter account">
                  <select
                    className="box"
                    value={accountFilter}
                    onChange={(e) => setAccountFilter(e.target.value)}
                  >
                    <option value="">All accounts</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Filter classification">
                  <select
                    className="box"
                    value={dispositionFilter}
                    onChange={(e) => setDispositionFilter(e.target.value)}
                  >
                    <option value="">All classifications</option>
                    {['suggested', 'budget', 'income', 'transfer', 'excluded', 'unbudgeted', 'pairs'].map(
                      (d) => (
                        <option key={d}>{d}</option>
                      ),
                    )}
                  </select>
                </Field>
                <button className="btn" onClick={applyRules}>
                  Apply rules
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    edit((r) => {
                      for (const tx of r.transactions)
                        if (visible.some((v) => v.id === tx.id) && tx.disposition?.state === 'suggested')
                          tx.disposition.state = 'accepted';
                    })
                  }
                >
                  Accept visible suggestions
                </button>
                {lineFilter && (
                  <button className="btn" onClick={() => setLineFilter('')}>
                    Clear line filter
                  </button>
                )}
              </div>
              <div className="table-scroll">
                <table className="v3-transactions">
                  <thead>
                    <tr>
                      <th>Date / account</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th>Classification</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((tx) => {
                      const candidates = pairCandidates(
                          tx,
                          review.transactions,
                          accounts,
                          review.pairingDays,
                        ),
                        dupe = possibleDuplicates(review.transactions).some((pair) => pair.includes(tx.id));
                      return (
                        <tr key={tx.id} id={tx.id}>
                          <td>
                            {tx.postedDate}
                            <div className="small subtle">
                              {accounts.find((a) => a.id === tx.institutionAccountId)?.displayName}
                            </div>
                            {!inMonth(tx, review, accounts) && (
                              <span className="badge neutral">{tx.pending ? 'Pending' : 'Context'}</span>
                            )}
                          </td>
                          <td>
                            {tx.description}
                            {tx.changed && <div className="badge warn">Amount changed; re-accept</div>}
                            {dupe && !tx.duplicateConfirmed && (
                              <div>
                                <button
                                  className="btn small"
                                  onClick={() =>
                                    edit((r) => {
                                      for (const pair of possibleDuplicates(r.transactions).filter((p) =>
                                        p.includes(tx.id),
                                      ))
                                        for (const id of pair) {
                                          const row = r.transactions.find((t) => t.id === id)!;
                                          row.duplicateConfirmed = true;
                                        }
                                    })
                                  }
                                >
                                  Confirm both are distinct
                                </button>
                              </div>
                            )}
                            {tx.removedAtSource && !tx.removalConfirmed && (
                              <button
                                className="btn small"
                                onClick={() =>
                                  edit((r) => {
                                    r.transactions.find((t) => t.id === tx.id)!.removalConfirmed = true;
                                  })
                                }
                              >
                                Confirm removed at source
                              </button>
                            )}
                          </td>
                          <td className="num">
                            <Amount value={tx.amount} />
                          </td>
                          <td>
                            {tx.disposition
                              ? `${tx.disposition.kind} · ${tx.disposition.state}`
                              : 'Unclassified'}
                            {tx.disposition?.kind === 'budget' && (
                              <div className="small subtle">
                                {tx.disposition.parts
                                  .map(
                                    (p) =>
                                      budget?.lines.find((l) => l.lineKey === p.lineKey)?.label ??
                                      'Missing line',
                                  )
                                  .join(' / ')}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="btn-row">
                              <button
                                className="btn small"
                                disabled={tx.pending || !budget}
                                onClick={() => setClassify(tx)}
                              >
                                Classify
                              </button>
                              {tx.disposition?.state === 'accepted' && (
                                <button
                                  className="btn small"
                                  onClick={() => {
                                    setRemember(tx);
                                    setPattern(normalizedDescription(tx.description));
                                  }}
                                >
                                  Remember this
                                </button>
                              )}
                              {tx.disposition?.kind === 'transfer' && tx.disposition.pairedId && (
                                <button
                                  className="btn small"
                                  onClick={() =>
                                    edit((r) => {
                                      const pair =
                                        tx.disposition?.kind === 'transfer'
                                          ? tx.disposition.pairedId
                                          : undefined;
                                      for (const row of r.transactions.filter(
                                        (row) => row.id === tx.id || row.id === pair,
                                      ))
                                        row.disposition = {
                                          kind: 'transfer',
                                          state: 'accepted',
                                          counterparty: 'own_unconnected',
                                        };
                                    })
                                  }
                                >
                                  Unpair
                                </button>
                              )}
                              {candidates.length > 0 && (
                                <select
                                  className="box"
                                  aria-label={`Pair ${tx.description}`}
                                  value=""
                                  onChange={(e) => {
                                    if (!e.target.value) return;
                                    const other = e.target.value;
                                    edit((r) => {
                                      r.transactions.find((t) => t.id === tx.id)!.disposition = {
                                        kind: 'transfer',
                                        state: 'accepted',
                                        pairedId: other,
                                      };
                                      r.transactions.find((t) => t.id === other)!.disposition = {
                                        kind: 'transfer',
                                        state: 'accepted',
                                        pairedId: tx.id,
                                      };
                                    });
                                  }}
                                >
                                  <option value="">
                                    {candidates.length === 1 &&
                                    pairCandidates(
                                      candidates[0],
                                      review.transactions,
                                      accounts,
                                      review.pairingDays,
                                    ).length === 1
                                      ? 'Suggested pair…'
                                      : 'Choose a pair…'}
                                  </option>
                                  {candidates.map((c) => (
                                    <option value={c.id} key={c.id}>
                                      {c.postedDate} · {c.description}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visible.length === 0 && <p className="empty-state">No transactions match this view.</p>}
            </>
          )}
          {tab === 'Assets and liabilities' && (
            <>
              <p>
                Enter signed account values: positive for assets, negative when money is owed. A card credit
                balance is positive.
              </p>
              {accounts
                .filter((a) => a.inSnapshot)
                .map((a) => {
                  const b = review.balances[a.id];
                  return (
                    <Panel key={a.id} title={a.displayName}>
                      <div className="v3-toolbar">
                        <Field label={`Balance for ${a.displayName}`}>
                          <CommitInput
                            value={b?.value ?? ''}
                            money
                            ariaLabel={`Balance for ${a.displayName}`}
                            onCommit={(value) =>
                              edit((r) => {
                                r.balances[a.id] = {
                                  ...r.balances[a.id],
                                  value: exactAmount(value),
                                  source: 'manual',
                                  capturedAt: new Date().toISOString(),
                                  asOf: b?.asOf ?? monthPeriod(review.month).end,
                                  unavailable: false,
                                  periods: b?.periods ?? [],
                                };
                              })
                            }
                          />
                        </Field>
                        <Field label={`As of ${a.displayName}`}>
                          <input
                            className="box"
                            type="date"
                            value={b?.asOf ?? monthPeriod(review.month).end}
                            onChange={(e) =>
                              edit((r) => {
                                r.balances[a.id] = {
                                  ...r.balances[a.id],
                                  value: b?.value ?? null,
                                  source: 'manual',
                                  capturedAt: new Date().toISOString(),
                                  unavailable: false,
                                  periods: b?.periods ?? [],
                                  asOf: calendarDate(e.target.value),
                                };
                              })
                            }
                          />
                        </Field>
                        <label>
                          <input
                            type="checkbox"
                            checked={b?.unavailable ?? false}
                            onChange={(e) =>
                              edit((r) => {
                                r.balances[a.id] = {
                                  ...r.balances[a.id],
                                  value: e.target.checked ? null : (b?.value ?? null),
                                  asOf: b?.asOf ?? '',
                                  periods: b?.periods ?? [],
                                  unavailable: e.target.checked,
                                };
                              })
                            }
                          />{' '}
                          Unavailable this month
                        </label>
                      </div>
                      {liabilityKinds.includes(a.kind) && (
                        <LiabilityDetails
                          details={b?.details}
                          label={a.displayName}
                          onChange={(details) =>
                            edit((r) => {
                              r.balances[a.id] = {
                                ...b,
                                value: b?.value ?? null,
                                asOf: b?.asOf ?? monthPeriod(review.month).end,
                                unavailable: b?.unavailable ?? false,
                                periods: b?.periods ?? [],
                                details,
                              };
                            })
                          }
                        />
                      )}
                    </Panel>
                  );
                })}
            </>
          )}
          {tab === 'Summary' && (
            <>
              {preview && (
                <>
                  <p className="notice">Working summary. Only accepted classifications count.</p>
                  <Field label="Review note">
                    <CommitInput
                      multiline
                      value={review.note}
                      ariaLabel="Review note"
                      onCommit={(value) =>
                        edit((r) => {
                          r.note = safeText(value);
                        })
                      }
                    />
                  </Field>
                  <ReportView
                    report={preview}
                    reports={reports}
                    onLine={(key) => {
                      setLineFilter(key);
                      setTab('Transactions');
                    }}
                  />
                  <Panel title="Line roles">
                    <p>Set-asides stay separate from spending totals. Choose roles explicitly.</p>
                    {budget?.lines.map((l) => (
                      <label className="v3-rule" key={l.lineKey}>
                        <input
                          type="checkbox"
                          checked={l.role === 'set_aside'}
                          onChange={(e) =>
                            run(() =>
                              t.spending.setRole(l.lineKey, e.target.checked ? 'set_aside' : 'spending'),
                            )
                          }
                        />
                        {l.label} is a set-aside
                      </label>
                    ))}
                  </Panel>
                </>
              )}
              <Panel title={blockers.length ? `${blockers.length} items before clearing` : 'Ready to clear'}>
                <ul className="issues">
                  {blockers.map((b, i) => (
                    <li key={i}>
                      <button
                        className="link-button"
                        onClick={() => {
                          setTab(
                            b.target === 'budget'
                              ? 'Coverage'
                              : review.transactions.some((t) => t.id === b.target)
                                ? 'Transactions'
                                : 'Coverage',
                          );
                          requestAnimationFrame(() =>
                            document.getElementById(b.target)?.scrollIntoView({ block: 'center' }),
                          );
                        }}
                      >
                        {b.message}
                      </button>
                    </li>
                  ))}
                </ul>
                {repeated.length > 0 && (
                  <div className="notice">
                    <p>
                      These repeated manual classifications could become rules for future months. Saving a
                      rule keeps its chosen pattern after transactions are deleted.
                    </p>
                    {repeated.map((tx) => (
                      <button
                        key={tx.id}
                        className="btn small"
                        onClick={() => {
                          setRemember(tx);
                          setPattern('');
                        }}
                      >
                        Remember {normalizedDescription(tx.description)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="btn primary"
                  disabled={blockers.length > 0 || entry?.state !== 'open' || extras.security?.offline}
                  onClick={async () => {
                    if (
                      !(await confirm.ask(
                        'Clear this month? The report is saved, then its temporary transactions are deleted. Undo restores the previous report, but cannot restore these transactions.',
                        { confirmLabel: 'Clear month' },
                      ))
                    )
                      return;
                    try {
                      if (syncSession)
                        throw new Error(
                          'Complete v3 encrypted sync setup before clearing a connected profile.',
                        );
                      await store.flush();
                      const latest = store.get(ref);
                      if (!latest) throw new Error('This review was deleted on another device.');
                      t.spending.clear(latest);
                      await store.finish(ref, 'cleared', async () => {
                        await t.flush();
                        if (extras.security) await extras.security.flush();
                      });
                      setSelectedReport(review.month);
                      setRemember(null);
                      setPattern('');
                      setTab('Reports');
                      toast('Month cleared. Temporary transactions deleted.', 'success');
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  Clear month
                </button>
              </Panel>
            </>
          )}
        </>
      )}
      {importAccount && review && (
        <StatementImport
          account={importAccount}
          month={review.month}
          onClose={() => setImportAccount(null)}
          onImport={(s, profile) => {
            if (review.importedHashes.includes(s.hash))
              throw new Error('This exact file was already imported into this review.');
            store.edit(ref, (r) => {
              r.transactions = mergeTransactions(r.transactions, s.transactions);
              const previous = r.evidence[importAccount.id];
              r.evidence[importAccount.id] = {
                source: 'file',
                periods: [...(previous?.periods ?? []), s.period],
                gatheredAt: new Date().toISOString(),
              };
              if (s.balance) r.balances[importAccount.id] = s.balance;
              r.importedHashes.push(s.hash);
            });
            if (profile) t.spending.saveAccount({ ...importAccount, csvProfile: profile });
            setImportAccount(null);
            toast('Statement imported. Review the classifications.', 'success');
          }}
        />
      )}
      {classify && budget && review && (
        <ClassificationDialog
          transaction={classify}
          fundingAccountId={
            accounts.find((a) => a.id === classify.institutionAccountId)?.shared === false
              ? accounts.find((a) => a.id === classify.institutionAccountId)?.treasuryAccountId
              : null
          }
          budget={budget}
          transactions={review.transactions}
          onClose={() => setClassify(null)}
          onSave={(d) => {
            store.edit(ref, (r) => {
              r.transactions.find((tx) => tx.id === classify.id)!.disposition = d;
            });
            setClassify(null);
          }}
        />
      )}
      <Dialog open={!!manual} title="Manual statement entry" onClose={() => setManual('')}>
        <form
          className="v3-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const date = calendarDate(manualDate),
                amount = exactAmount(manualAmount);
              store.edit(ref, (r) => {
                r.transactions.push({
                  id: crypto.randomUUID(),
                  institutionAccountId: manual,
                  postedDate: date,
                  amount,
                  sourceAmount: manualAmount,
                  description: safeText(manualDescription),
                  pending: false,
                  removedAtSource: false,
                  source: { kind: 'manual', name: new Date().toISOString() },
                });
              });
              setManualDescription('');
              setManualAmount('');
              toast('Entry added. Confirm statement coverage when finished.', 'success');
            } catch (e) {
              fail(e);
            }
          }}
        >
          <Field label="Posted date">
            <input
              className="box"
              type="date"
              required
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <input
              className="box"
              required
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
            />
          </Field>
          <Field label="Signed amount">
            <input
              className="box"
              required
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
            />
          </Field>
          <button className="btn">Add entry</button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              edit((r) => {
                r.evidence[manual] = {
                  source: 'manual',
                  periods: [monthPeriod(r.month)],
                  gatheredAt: new Date().toISOString(),
                };
              });
              setManual('');
            }}
          >
            Confirm the entire month is entered
          </button>
        </form>
      </Dialog>
      <Dialog open={!!waive} title="Waive account for this month" onClose={() => setWaive('')}>
        <form
          className="v3-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              edit((r) => {
                if (
                  r.transactions.some(
                    (t) => t.institutionAccountId === waive && !t.pending && t.postedDate.startsWith(r.month),
                  )
                )
                  throw new Error(
                    'An account with posted activity cannot be waived. Classify or exclude those transactions.',
                  );
                r.evidence[waive] = {
                  source: 'manual',
                  periods: [],
                  gatheredAt: new Date().toISOString(),
                  waiver: { reason: waiverReason, note: safeText(waiverNote) },
                };
              }) !== undefined
            )
              setWaive('');
          }}
        >
          <Field label="Waiver reason">
            <select className="box" value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)}>
              {['no activity', 'account closed', 'not used this month', 'data unavailable'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <input
              required
              className="box"
              value={waiverNote}
              onChange={(e) => setWaiverNote(e.target.value)}
            />
          </Field>
          <button className="btn primary">Save waiver</button>
        </form>
      </Dialog>
      <Dialog open={!!remember} title="Remember a classification rule" onClose={() => setRemember(null)}>
        <p>This pattern will be kept in your database. Choose only the text you want to remember.</p>
        <form
          className="v3-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = remember?.disposition;
            if (!d) return;
            let action: Rule['action'];
            if (d.kind === 'budget') {
              if (d.parts.length !== 1) {
                toast(
                  'Rules classify to one line. Split transactions must be reviewed individually.',
                  'error',
                );
                return;
              }
              action = { kind: 'budget', lineKey: d.parts[0].lineKey };
            } else if (d.kind === 'transfer') action = { kind: 'transfer', counterparty: 'own_unconnected' };
            else action = d;
            if (
              run(() =>
                t.spending.saveRule({
                  id: crypto.randomUUID(),
                  position: t.spending.rules().length,
                  enabled: true,
                  createdAt: new Date().toISOString(),
                  pattern,
                  match: 'contains',
                  direction: 'any',
                  action,
                }),
              ) !== undefined
            )
              setRemember(null);
          }}
        >
          <Field label="Description contains">
            <input className="box" required value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </Field>
          <button className="btn primary">Save rule</button>
        </form>
      </Dialog>
      {ruleEdit && (
        <RuleEditor
          rule={ruleEdit}
          accounts={accounts}
          lines={(budget ?? t.spending.budget(t.spending.defaultVersion(month)))?.lines ?? []}
          onClose={() => setRuleEdit(null)}
          onSave={(r) => {
            t.spending.saveRule(r);
            setRuleEdit(null);
          }}
        />
      )}
      {confirm.element}
    </>
  );
}
