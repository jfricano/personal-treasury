import { useState, type CSSProperties } from 'react';
import { useTreasury } from '@/app/context';
import {
  AccountField,
  Amount,
  DebtStatusBadge,
  Dialog,
  Field,
  Panel,
  todayIso,
  useConfirm,
} from '@/components/ui';
import type { DebtPosition } from '@/domain/debts';
import { formatUSD, isEffectivelyZero, parseMoneyInput, isStrictlyPositive, cmp } from '@/domain/money';
import type { Account } from '@/domain/types';
import { saveFile } from '@/platform/files';

type StateFilter = 'nonzero' | 'all' | 'OPEN' | 'PAID' | 'CREDIT' | 'review';

export function DebtsPage() {
  const { t, route, navigate, toast } = useTreasury();
  const [state, setState] = useState<StateFilter>('nonzero');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [largestOnly, setLargestOnly] = useState(false);
  const [payment, setPayment] = useState<{ open: boolean; debtId: string | null }>({
    open: false,
    debtId: null,
  });
  const [newDebt, setNewDebt] = useState(false);

  const board = t.debtBoard();
  const s = board.summary;
  const code = t.codeOf;
  const accountFilter = route.account ?? null;
  const role = route.role ?? null;
  const setAccount = (account: string | null, r: 'to' | 'by' | null = null) =>
    navigate({ page: 'debts', account, role: r, debtId: null });

  const rows = board.positions.filter((p) => {
    if (largestOnly && !s.largestLoanIds.includes(p.debt.loanId)) return false;
    if (state === 'nonzero' && isEffectivelyZero(p.currentBalance)) return false;
    if ((state === 'OPEN' || state === 'PAID' || state === 'CREDIT') && p.status !== state) return false;
    if (state === 'review' && !p.reviewNote) return false;
    if (accountFilter) {
      const involved =
        role === 'to'
          ? p.owedToAccountId === accountFilter
          : role === 'by'
            ? p.owedByAccountId === accountFilter
            : [
                p.owedByAccountId,
                p.owedToAccountId,
                p.debt.originDebtorAccountId,
                p.debt.originCreditorAccountId,
              ].includes(accountFilter);
      if (!involved) return false;
      if (role && isEffectivelyZero(p.currentBalance)) return false;
    }
    if (from && (p.lastActivity ?? '') < from) return false;
    if (to && p.debt.openedDate > to) return false;
    if (text.trim()) {
      const q = text.trim().toLowerCase();
      const hay = [
        p.debt.loanId,
        p.debt.description,
        p.displayNotes,
        p.debt.terms,
        ...p.events.map((e) => `${e.description ?? ''} ${e.notes ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const openDebt = route.debtId ? board.positions.find((p) => p.debt.id === route.debtId) : undefined;

  const exportCsv = async () => {
    const out = [
      [
        'Loan ID',
        'Date',
        'Sequence',
        'Description',
        'Origin debtor',
        'Origin creditor',
        'Prior balance',
        'Change',
        'Remaining balance',
        'Status',
        'Notes',
        'Source',
      ],
    ];
    for (const p of rows)
      for (const e of p.events)
        out.push([
          p.debt.loanId,
          e.eventDate,
          String(e.sequence),
          e.description ?? '',
          code(p.debt.originDebtorAccountId),
          code(p.debt.originCreditorAccountId),
          e.priorBalance,
          e.changeAmount,
          e.remainingBalance,
          e.status,
          e.notes ?? '',
          e.sourceSheet ? `${e.sourceSheet}!${e.sourceRange}` : 'app',
        ]);
    const csv = out.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    if (await saveFile('debt-events.csv', csv, 'text/csv')) toast('Debt events CSV exported', 'success');
  };

  return (
    <>
      <div className="page-head">
        <h2>Interaccount debts</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setNewDebt(true)}>
          New debt
        </button>
        <button className="btn" onClick={() => setPayment({ open: true, debtId: openDebt?.debt.id ?? null })}>
          Record payment
        </button>
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="strip" role="group" aria-label="Debt summary">
        <button
          onClick={() => {
            setState('nonzero');
            setLargestOnly(false);
            setAccount(null);
          }}
        >
          <div className="k">Non-zero debts</div>
          <div className="v" data-testid="debt-count">
            {s.nonZeroCount}
          </div>
        </button>
        <button
          onClick={() => {
            setState('nonzero');
            setLargestOnly(false);
            setAccount(null);
          }}
        >
          <div className="k">Total outstanding</div>
          <div className="v" data-testid="debt-total">
            <Amount value={s.totalOutstanding} />
          </div>
        </button>
        <button
          onClick={() => {
            setLargestOnly(true);
            setAccount(null);
          }}
        >
          <div className="k">Largest debt</div>
          <div className="v" data-testid="debt-largest">
            <Amount value={s.largestDebt} />{' '}
            <span className="small subtle">Loan {s.largestLoanIds.join(', ')}</span>
          </div>
        </button>
        <div>
          <div className="k">Net positions sum</div>
          <div className={`v${isEffectivelyZero(s.netSum) ? '' : ' neg'}`}>
            <Amount value={s.netSum} />
          </div>
        </div>
      </div>

      <div
        className="grid-2 debt-panels"
        style={{ '--cols': 'minmax(300px, 0.8fr) minmax(0, 2fr)' } as CSSProperties}
      >
        <Panel title="Net by account">
          <table className="t" aria-label="Net by account">
            <thead>
              <tr>
                <th className="l">Account</th>
                <th className="num">Owed to account</th>
                <th className="num">Owed by account</th>
                <th className="num">Net position</th>
              </tr>
            </thead>
            <tbody>
              {s.byAccount.map((a) => (
                <tr key={a.accountId} className={accountFilter === a.accountId ? 'sel' : ''}>
                  <td>
                    <button className="btn link code" onClick={() => setAccount(a.accountId)}>
                      {code(a.accountId)}
                    </button>
                  </td>
                  <td className="num">
                    <button
                      className="btn link"
                      onClick={() => setAccount(a.accountId, 'to')}
                      aria-label={`Debts owed to ${code(a.accountId)}`}
                    >
                      <Amount value={a.owedTo} />
                    </button>
                  </td>
                  <td className="num">
                    <button
                      className="btn link"
                      onClick={() => setAccount(a.accountId, 'by')}
                      aria-label={`Debts owed by ${code(a.accountId)}`}
                    >
                      <Amount value={a.owedBy} />
                    </button>
                  </td>
                  <td className="num">
                    <button className="btn link" onClick={() => setAccount(a.accountId)}>
                      <Amount value={a.net} parens redNegative label={`${code(a.accountId)} net position`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">
                  <Amount value={s.totalOutstanding} />
                </td>
                <td className="num">
                  <Amount value={s.totalOutstanding} />
                </td>
                <td className="num">
                  <Amount value={s.netSum} parens />
                </td>
              </tr>
            </tfoot>
          </table>
        </Panel>

        <Panel
          title="Debt detail"
          actions={
            <span className="small subtle">
              {rows.length} shown
              {accountFilter
                ? ` · ${role === 'to' ? 'owed to' : role === 'by' ? 'owed by' : 'involving'} ${code(accountFilter)}`
                : ''}
              {largestOnly ? ' · largest' : ''}
            </span>
          }
        >
          <div className="btn-row" style={{ marginBottom: 8 }}>
            <div className="tabs" role="group" aria-label="Debt state filter">
              {(
                [
                  ['nonzero', 'Non-zero'],
                  ['all', 'All'],
                  ['OPEN', 'Open'],
                  ['PAID', 'Paid'],
                  ['CREDIT', 'Credit'],
                  ['review', 'Review note'],
                ] as [StateFilter, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  aria-pressed={state === k}
                  onClick={() => {
                    setState(k);
                    setLargestOnly(false);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <select
              className="box"
              aria-label="Account filter"
              value={accountFilter ?? ''}
              onChange={(e) => setAccount(e.target.value || null)}
            >
              <option value="">All accounts</option>
              {t.accounts().map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                </option>
              ))}
            </select>
            <input
              className="box"
              type="search"
              placeholder="Search Loan ID, description, notes"
              aria-label="Search debts"
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <label className="small">
              Active from{' '}
              <input type="date" className="box" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="small">
              Opened by{' '}
              <input type="date" className="box" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            {(accountFilter || largestOnly || text || from || to || state !== 'nonzero') && (
              <button
                className="btn small"
                onClick={() => {
                  setState('nonzero');
                  setText('');
                  setFrom('');
                  setTo('');
                  setLargestOnly(false);
                  setAccount(null);
                }}
              >
                Reset
              </button>
            )}
          </div>
          <table className="t" aria-label="Debt detail">
            <thead>
              <tr>
                <th className="l">Loan ID</th>
                <th className="l">Description</th>
                <th className="l">Opened</th>
                <th className="l">Last activity</th>
                <th className="l">Owed by</th>
                <th className="l">Owed to</th>
                <th className="num">Remaining</th>
                <th className="l">Terms / notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.debt.id}
                  className={`clickable${openDebt?.debt.id === p.debt.id ? ' sel' : ''}${isEffectivelyZero(p.currentBalance) ? ' muted' : ''}`}
                  onClick={() => navigate({ page: 'debts', debtId: p.debt.id, account: accountFilter, role })}
                >
                  <td className="code">
                    <button
                      className="btn link code"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate({ page: 'debts', debtId: p.debt.id, account: accountFilter, role });
                      }}
                    >
                      {p.debt.loanId}
                    </button>
                  </td>
                  <td>{p.debt.description}</td>
                  <td className="nowrap">{p.debt.openedDate}</td>
                  <td className="nowrap">{p.lastActivity}</td>
                  <td className="code">{code(p.owedByAccountId)}</td>
                  <td className="code">
                    {code(p.owedToAccountId)}
                    {p.reversed && (
                      <span
                        className="badge ready"
                        title="Direction reversed by a negative balance"
                        style={{ marginLeft: 4 }}
                      >
                        ↔
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <Amount
                      value={p.displayBalance}
                      label={`${code(p.owedByAccountId)} owes ${code(p.owedToAccountId)}`}
                    />
                  </td>
                  <td>
                    {p.reviewNote ? (
                      <span className="badge warn">{p.displayNotes}</span>
                    ) : (
                      <span className="small">{p.displayNotes}</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="subtle">
                    No debts match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      {openDebt && (
        <DebtDrawer
          p={openDebt}
          onClose={() => navigate({ page: 'debts', account: accountFilter, role })}
          onPayment={() => setPayment({ open: true, debtId: openDebt.debt.id })}
        />
      )}
      <PaymentDialog
        open={payment.open}
        debtId={payment.debtId}
        onClose={() => setPayment({ open: false, debtId: null })}
      />
      <NewDebtDialog open={newDebt} onClose={() => setNewDebt(false)} />
    </>
  );
}

function DebtDrawer({
  p,
  onClose,
  onPayment,
}: {
  p: DebtPosition;
  onClose: () => void;
  onPayment: () => void;
}) {
  const { t, run, navigate } = useTreasury();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ eventDate: '', changeAmount: '', description: '', notes: '' });
  const code = t.codeOf;
  const detail = t.debtDetail(p.debt.id);
  const imported = !!p.debt.importRunId;

  const del = async (eventId: string, isImported: boolean) => {
    const ok = await confirm.ask(
      <>
        Delete this debt event? Every balance after it will be recalculated.
        {isImported && <p className="err">It was imported from the workbook. Command-Z restores it.</p>}
      </>,
      { danger: true, confirmLabel: 'Delete event' },
    );
    if (ok)
      run(() => t.deleteEvent(eventId, { confirmImported: isImported }), 'Event deleted — Command-Z to undo');
  };
  const delDebt = async () => {
    const ok = await confirm.ask(
      <>
        Delete Loan {p.debt.loanId} and all {p.events.length} event(s)?
        {imported && <p className="err">This debt was imported from the workbook.</p>}
      </>,
      { danger: true, confirmLabel: 'Delete debt' },
    );
    if (
      ok &&
      run(
        () => t.deleteDebt(p.debt.id, { confirmImported: imported }),
        `Loan ${p.debt.loanId} deleted — Command-Z to undo`,
      ) !== undefined
    )
      onClose();
  };

  return (
    <aside
      className="drawer"
      aria-label={`Loan ${p.debt.loanId}`}
      onKeyDown={(e) => e.key === 'Escape' && !editing && onClose()}
    >
      <header>
        <h3>Loan {p.debt.loanId}</h3>
        <DebtStatusBadge status={p.status} review={p.reviewNote} />
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={onPayment}>
          Record payment
        </button>
        <button className="btn small" onClick={onClose} aria-label="Close" autoFocus>
          ✕
        </button>
      </header>
      <div className="body">
        <div className="panel" style={{ margin: 0 }}>
          <header>Current balance</header>
          <div className="body" style={{ fontSize: 15 }}>
            {isEffectivelyZero(p.currentBalance) ? (
              <span>Paid — nothing owed.</span>
            ) : (
              <span>
                <b className="code">{code(p.owedByAccountId)}</b> owes{' '}
                <b className="code">{code(p.owedToAccountId)}</b> <b>{formatUSD(p.displayBalance)}</b>
                {p.reversed && (
                  <span className="subtle small">
                    {' '}
                    — direction reversed because the balance is {formatUSD(p.currentBalance)} relative to
                    origin
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <dl className="kv">
          <dt>Description</dt>
          <dd>{p.debt.description ?? '—'}</dd>
          <dt>Opened</dt>
          <dd>{p.debt.openedDate}</dd>
          <dt>Origin direction</dt>
          <dd>
            <span className="code">{code(p.debt.originDebtorAccountId)}</span> owes{' '}
            <span className="code">{code(p.debt.originCreditorAccountId)}</span> when positive
          </dd>
          <dt>Original terms</dt>
          <dd>{p.debt.terms ?? '—'}</dd>
          <dt>Source</dt>
          <dd className="loc">
            {p.debt.sourceSheet
              ? `${p.debt.sourceWorkbook} · ${p.debt.sourceSheet}!${p.debt.sourceRange}`
              : 'Entered in app'}
          </dd>
        </dl>

        <Panel title="Event history">
          <table className="t" aria-label="Debt events">
            <thead>
              <tr>
                <th className="l">Date</th>
                <th className="l">Description</th>
                <th className="num">Prior</th>
                <th className="num">Change</th>
                <th className="num">Remaining</th>
                <th className="l">Notes</th>
                <th className="l">Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.events.map((e) =>
                editing === e.id ? (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="date"
                        className="box"
                        aria-label="Event date"
                        value={draft.eventDate}
                        onChange={(x) => setDraft({ ...draft, eventDate: x.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="box"
                        aria-label="Event description"
                        value={draft.description}
                        onChange={(x) => setDraft({ ...draft, description: x.target.value })}
                      />
                    </td>
                    <td />
                    <td>
                      <input
                        className="box num"
                        aria-label="Signed change"
                        value={draft.changeAmount}
                        onChange={(x) => setDraft({ ...draft, changeAmount: x.target.value })}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td />
                    <td>
                      <input
                        className="box"
                        aria-label="Event notes"
                        value={draft.notes}
                        onChange={(x) => setDraft({ ...draft, notes: x.target.value })}
                      />
                    </td>
                    <td colSpan={2} className="nowrap">
                      <button
                        className="btn small primary"
                        onClick={() => {
                          const m = parseMoneyInput(draft.changeAmount);
                          if (m === null) return;
                          if (
                            run(
                              () =>
                                t.editEvent(e.id, {
                                  eventDate: draft.eventDate,
                                  changeAmount: m,
                                  description: draft.description,
                                  notes: draft.notes,
                                }),
                              'Event corrected (audited)',
                            ) !== undefined
                          )
                            setEditing(null);
                        }}
                      >
                        Save
                      </button>{' '}
                      <button className="btn small" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id}>
                    <td className="nowrap">{e.eventDate}</td>
                    <td>{e.description}</td>
                    <td className="num">
                      <Amount value={e.priorBalance} />
                    </td>
                    <td className="num">
                      <Amount value={e.changeAmount} signed redNegative />
                    </td>
                    <td className="num">
                      <Amount value={e.remainingBalance} redNegative />
                    </td>
                    <td>
                      {e.reviewNote ? (
                        <span className="badge warn">{e.notes}</span>
                      ) : (
                        <span className="small">{e.notes}</span>
                      )}
                    </td>
                    <td className="loc">
                      {e.sourceSheet
                        ? `${e.sourceSheet}!${e.sourceRange?.split(':')[0]}`
                        : e.journalEntryId
                          ? 'journal'
                          : 'app'}
                    </td>
                    <td className="nowrap">
                      <button
                        className="btn small"
                        onClick={() => {
                          setEditing(e.id);
                          setDraft({
                            eventDate: e.eventDate,
                            changeAmount: e.changeAmount,
                            description: e.description ?? '',
                            notes: e.notes ?? '',
                          });
                        }}
                      >
                        Correct
                      </button>{' '}
                      <button
                        className="btn small danger"
                        aria-label="Delete event"
                        onClick={() => del(e.id, !!e.importRunId)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <p className="small subtle" style={{ marginBottom: 0 }}>
            Prior and remaining balances are calculated and cannot be edited. Prefer an adjusting event once a
            month has been closed or exported.
          </p>
        </Panel>

        <Panel title="Linked monthly journal entries">
          {detail.linkedEntries.length === 0 ? (
            <p className="subtle" style={{ margin: 0 }}>
              No journal entries reference Loan {p.debt.loanId}.
            </p>
          ) : (
            <ul className="issues">
              {detail.linkedEntries.map(({ entry, month }) => (
                <li key={entry.id}>
                  <button
                    className="btn link"
                    onClick={() => navigate({ page: 'monthly', monthId: entry.monthlyCycleId })}
                  >
                    {month}
                  </button>
                  <span>
                    {entry.description ?? '(no description)'} ·{' '}
                    {entry.postings
                      .map((x) => `${code(x.accountId)} ${formatUSD(x.amount, { signed: true })}`)
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {detail.audit.length > 0 && (
          <details className="sec">
            <summary>Audit trail ({detail.audit.length})</summary>
            <div className="body">
              <ul className="warn-list">
                {detail.audit.map((a) => (
                  <li key={a.id} className="small">
                    <span className="loc">{a.at.slice(0, 19).replace('T', ' ')}</span> {a.action} {a.entity}{' '}
                    {a.note ?? ''}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
        <div>
          <button className="btn danger small" onClick={delDebt}>
            Delete debt…
          </button>
        </div>
      </div>
      {confirm.element}
    </aside>
  );
}

function PaymentDialog({
  open,
  debtId,
  onClose,
}: {
  open: boolean;
  debtId: string | null;
  onClose: () => void;
}) {
  const { t, run } = useTreasury();
  const [form, setForm] = useState<{
    debtId: string;
    date: string;
    amount: string;
    description: string;
    notes: string;
    advanced: boolean;
  } | null>(null);
  if (open && !form)
    setForm({
      debtId: debtId ?? '',
      date: todayIso(),
      amount: '',
      description: 'pmt',
      notes: '',
      advanced: false,
    });
  if (!open && form) setForm(null);
  if (!form)
    return (
      <Dialog open={false} title="" onClose={onClose}>
        {null}
      </Dialog>
    );

  const board = t.debtBoard();
  const choices = board.positions.filter(
    (p) => !isEffectivelyZero(p.currentBalance) || p.debt.id === form.debtId,
  );
  const debt = board.positions.find((p) => p.debt.id === form.debtId);
  const amount = parseMoneyInput(form.amount);
  const code = t.codeOf;
  let preview: ReturnType<typeof t.previewPayment> | null = null;
  let error: string | null = null;
  if (debt && amount !== null) {
    if (!form.advanced && !isStrictlyPositive(amount)) error = 'Enter a positive payment amount.';
    else
      preview = form.advanced
        ? t.previewAdjustment(debt.debt.id, amount, form.date)
        : t.previewPayment(debt.debt.id, amount, form.date);
  }
  const save = () => {
    if (!debt || amount === null || error) return;
    const res = form.advanced
      ? run(
          () =>
            t.recordAdjustment(debt.debt.id, {
              eventDate: form.date,
              change: amount,
              description: form.description,
              notes: form.notes,
            }),
          'Adjustment recorded',
        )
      : run(
          () =>
            t.recordPayment(debt.debt.id, {
              eventDate: form.date,
              payment: amount,
              description: form.description,
              notes: form.notes,
            }),
          'Payment recorded',
        );
    if (res) onClose();
  };
  const dir = (p: DebtPosition) =>
    isEffectivelyZero(p.currentBalance)
      ? 'Paid (nothing owed)'
      : `${code(p.owedByAccountId)} owes ${code(p.owedToAccountId)} ${formatUSD(p.displayBalance)}`;

  return (
    <Dialog
      open={open}
      title={form.advanced ? 'Record adjustment' : 'Record payment'}
      onClose={onClose}
      footer={
        <>
          <label className="small" style={{ marginRight: 'auto' }}>
            <input
              type="checkbox"
              checked={form.advanced}
              onChange={(e) => setForm({ ...form, advanced: e.target.checked })}
            />{' '}
            Advanced: signed adjustment
          </label>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!preview} onClick={save}>
            {form.advanced ? 'Save adjustment' : 'Save payment'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Loan" wide>
          <select
            className="box"
            aria-label="Loan"
            value={form.debtId}
            onChange={(e) => setForm({ ...form, debtId: e.target.value })}
            autoFocus={!debtId}
          >
            <option value="">Choose a debt…</option>
            {choices.map((p) => (
              <option key={p.debt.id} value={p.debt.id}>
                {p.debt.loanId} — {p.debt.description ?? ''} ({dir(p)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="box"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
        <Field label={form.advanced ? 'Signed change (relative to origin)' : 'Payment amount'}>
          <input
            className="box num"
            aria-label={form.advanced ? 'Signed change' : 'Payment amount'}
            inputMode="decimal"
            value={form.amount}
            autoFocus={!!debtId}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </Field>
        <Field label="Description">
          <input
            className="box"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <input
            className="box"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </div>
      {form.advanced && debt && (
        <p className="small subtle" style={{ margin: 0 }}>
          Positive changes increase what {code(debt.debt.originDebtorAccountId)} owes{' '}
          {code(debt.debt.originCreditorAccountId)}; negative changes reduce it. Crossing below zero reverses
          the direction.
        </p>
      )}
      {error && <p className="err">{error}</p>}
      {preview && (
        <div className="panel" style={{ margin: 0 }} aria-live="polite">
          <header>Preview</header>
          <div className="body">
            <table className="t">
              <tbody>
                <tr>
                  <td>Prior balance</td>
                  <td className="num">
                    <Amount value={preview.before.currentBalance} />
                  </td>
                  <td>{dir(preview.before)}</td>
                </tr>
                <tr>
                  <td>Change stored</td>
                  <td className="num">
                    <Amount value={preview.change} signed />
                  </td>
                  <td className="subtle small">relative to origin direction</td>
                </tr>
                <tr>
                  <td>
                    <b>Resulting balance</b>
                  </td>
                  <td className="num">
                    <b>
                      <Amount value={preview.after.currentBalance} />
                    </b>
                  </td>
                  <td>
                    <b>{dir(preview.after)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
            {preview.directionChanges && (
              <p className="err" style={{ marginBottom: 0 }}>
                This overpays the debt. The direction reverses: {dir(preview.after)}.
              </p>
            )}
            {cmp(preview.after.displayBalance, '0') === 0 && (
              <p className="small" style={{ marginBottom: 0, color: 'var(--green)' }}>
                This pays the debt off; it will leave the non-zero summary.
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function NewDebtDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, run, navigate } = useTreasury();
  const accounts: Account[] = t.accounts();
  const [form, setForm] = useState<{
    loanId: string;
    date: string;
    description: string;
    debtor: string | null;
    creditor: string | null;
    amount: string;
    terms: string;
  } | null>(null);
  if (open && !form)
    setForm({
      loanId: '',
      date: todayIso(),
      description: '',
      debtor: null,
      creditor: null,
      amount: '',
      terms: '',
    });
  if (!open && form) setForm(null);
  if (!form)
    return (
      <Dialog open={false} title="" onClose={onClose}>
        {null}
      </Dialog>
    );
  const amount = parseMoneyInput(form.amount);
  const code = t.codeOf;
  const exists = form.loanId.trim() && t.repos.getDebtByLoanId(form.loanId.trim());
  const ready =
    form.loanId.trim() &&
    !exists &&
    form.debtor &&
    form.creditor &&
    form.debtor !== form.creditor &&
    amount &&
    isStrictlyPositive(amount);
  const save = () => {
    const d = run(
      () =>
        t.createDebt({
          loanId: form.loanId,
          openedDate: form.date,
          description: form.description,
          debtorAccountId: form.debtor ?? '',
          creditorAccountId: form.creditor ?? '',
          openingChange: amount ?? '',
          terms: form.terms,
        }),
      `Loan ${form.loanId} created`,
    );
    if (d) {
      onClose();
      navigate({ page: 'debts', debtId: d.id });
    }
  };
  return (
    <Dialog
      open={open}
      title="New debt"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready} onClick={save}>
            Create debt
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field
          label="Loan ID"
          error={exists ? 'This Loan ID already exists — record a payment or adjustment instead.' : null}
        >
          <input
            className="box"
            aria-label="Loan ID"
            value={form.loanId}
            onChange={(e) => setForm({ ...form, loanId: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Opened date">
          <input
            type="date"
            className="box"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
        <Field label="Description" wide>
          <input
            className="box"
            aria-label="Debt description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Debtor account (owes)">
          <AccountField
            ariaLabel="Debtor account"
            accounts={accounts}
            value={form.debtor}
            onChange={(id) => setForm({ ...form, debtor: id })}
          />
        </Field>
        <Field label="Creditor account (is owed)">
          <AccountField
            ariaLabel="Creditor account"
            accounts={accounts}
            value={form.creditor}
            onChange={(id) => setForm({ ...form, creditor: id })}
          />
        </Field>
        <Field label="Opening amount">
          <input
            className="box num"
            aria-label="Opening amount"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </Field>
        <Field label="Terms / notes">
          <input
            className="box"
            value={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.value })}
          />
        </Field>
      </div>
      {ready && (
        <p style={{ margin: 0 }} aria-live="polite">
          After saving: <b className="code">{code(form.debtor!)}</b> owes{' '}
          <b className="code">{code(form.creditor!)}</b> <b>{formatUSD(amount!)}</b>.
        </p>
      )}
    </Dialog>
  );
}
