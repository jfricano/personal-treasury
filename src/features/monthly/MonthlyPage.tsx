import { useEffect, useRef, useState } from 'react';
import { useTreasury } from '@/app/context';
import type { EntryView, Treasury } from '@/api/treasury';
import {
  AccountField,
  Amount,
  CommitInput,
  Dialog,
  Field,
  MonthStatusBadge,
  Panel,
  todayIso,
  useConfirm,
} from '@/components/ui';
import { monthLabel, TRANSFER_ERROR_TEXT, validateTransfer } from '@/domain/monthly';
import { formatUSD, isEffectivelyZero, isStrictlyPositive, parseMoneyInput, sum } from '@/domain/money';
import type { Account, TransferState } from '@/domain/types';
import { saveFile } from '@/platform/files';
import { MonthSelect } from './MonthSelect';

export function MonthlyPage() {
  const { t, route, navigate, run, toast } = useTreasury();
  const [newMonthOpen, setNewMonthOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<{ open: boolean; entry: EntryView | null }>({
    open: false,
    entry: null,
  });
  const [closeOpen, setCloseOpen] = useState(false);
  const confirm = useConfirm();

  const monthId = route.monthId && t.repos.getMonth(route.monthId) ? route.monthId : t.currentMonthId();
  useEffect(() => {
    if (!monthId || !route.target) return;
    const target = route.target;
    const id = target.startsWith('done:')
      ? `month-done-${target.slice(5)}`
      : target.startsWith('entry:')
        ? `month-entry-${target.slice(6)}`
        : target === 'budget-refresh'
          ? 'month-budget-refresh'
          : 'month-summary';
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(id);
      element?.scrollIntoView({ block: 'center', inline: 'nearest' });
      element?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [monthId, route.target]);
  if (!monthId) {
    return (
      <>
        <div className="page-head">
          <h2>Monthly reconciliation</h2>
        </div>
        <div className="empty">
          <h3>No months yet</h3>
          <p className="subtle">Start a month from your allocation template, or import your workbook.</p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => setNewMonthOpen(true)}>
              New month
            </button>
            <button className="btn" onClick={() => navigate({ page: 'import' })}>
              Import workbook
            </button>
          </div>
        </div>
        <NewMonthDialog open={newMonthOpen} onClose={() => setNewMonthOpen(false)} />
      </>
    );
  }

  const v = t.monthView(monthId);
  const r = v.result;
  const code = t.codeOf;
  const accounts = t.accounts();
  const readOnly = v.closed;
  const allocMeta = new Map(t.repos.listAllocations(monthId).map((a) => [a.accountId, a]));
  const monthBudget = v.cycle.budgetVersionId
    ? t.budget.repos.getVersion(v.cycle.budgetVersionId)
    : undefined;
  const entries = accountFilter
    ? v.entries.filter((e) => e.entry.postings.some((p) => p.accountId === accountFilter))
    : v.entries;

  const exportCsv = async () => {
    const rows = [['Date', 'Loan ID', 'Description', 'Account', 'Amount', 'Notes', 'Source']];
    for (const e of v.entries)
      for (const p of e.entry.postings)
        rows.push([
          e.entry.entryDate ?? '',
          e.entry.loanId ?? '',
          e.entry.description ?? '',
          code(p.accountId),
          p.amount,
          e.entry.notes ?? '',
          `${e.entry.sourceSheet ?? ''}!${e.entry.sourceRange ?? ''}`,
        ]);
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    if (await saveFile(`journal-${v.cycle.month}.csv`, csv, 'text/csv'))
      toast('Journal CSV exported', 'success');
  };

  const deleteEntry = async (e: EntryView) => {
    const imported = !!e.entry.importRunId;
    const ok = await confirm.ask(
      <>
        Delete this journal entry{e.entry.description ? ` “${e.entry.description}”` : ''}?
        {imported && (
          <p className="err">
            It was imported from {e.entry.sourceSheet}!{e.entry.sourceRange}. You can undo with Command-Z.
          </p>
        )}
        {e.debtLinks.length > 0 && (
          <p>The linked debt event on Loan {e.debtLinks[0].loanId} stays in the debt ledger.</p>
        )}
      </>,
      { danger: true, confirmLabel: 'Delete entry' },
    );
    if (ok)
      run(
        () => t.deleteEntry(e.entry.id, { confirmImported: imported }),
        'Entry deleted — Command-Z to undo',
      );
  };

  return (
    <>
      <div className="page-head monthly-head">
        <h2>Monthly reconciliation</h2>
        <MonthSelect value={monthId} onChange={(id) => navigate({ page: 'monthly', monthId: id })} />
        <MonthStatusBadge status={r.status} closed={v.closed} />
        {monthBudget ? (
          <button
            className="badge ready"
            style={{ cursor: 'pointer' }}
            title="Budget version this month was created or refreshed from"
            onClick={() => navigate({ page: 'budget', version: monthBudget.id })}
          >
            Budget {monthBudget.label}
          </button>
        ) : v.cycle.expectedCashOrigin === 'import' ? (
          <span
            className="badge neutral"
            title="Imported workbook month kept for archival purposes; not linked to a budget"
          >
            Archival
          </span>
        ) : null}
        <span className="spacer" />
        <div className="monthly-actions">
          <button className="btn" onClick={() => setNewMonthOpen(true)}>
            New month
          </button>
          {v.closed ? (
            <button
              className="btn"
              onClick={() => run(() => t.reopenMonth(monthId), `${v.cycle.month} reopened`)}
            >
              Reopen month
            </button>
          ) : (
            <button
              className="btn"
              onClick={() =>
                r.status === 'REVIEW'
                  ? setCloseOpen(true)
                  : run(() => t.closeMonth(monthId), `${v.cycle.month} closed`)
              }
            >
              Close month
            </button>
          )}
          <button className="btn" onClick={exportCsv}>
            Export journal CSV
          </button>
        </div>
      </div>

      {v.closed && (
        <p className="subtle" role="note">
          {monthLabel(v.cycle.month)} is closed and read-only. Reopen it to make changes.
          {v.cycle.closeOverrideNote && (
            <span className="err"> Closed with Review override: {v.cycle.closeOverrideNote}</span>
          )}
        </p>
      )}

      {!v.closed && <BudgetBanner monthId={monthId} />}

      <div
        id="month-summary"
        tabIndex={-1}
        className={route.target === 'summary' ? 'review-target' : undefined}
      >
        <Panel title="Reconciliation">
          <div className="checks" role="list">
            <label className="check" role="listitem">
              <div className="k">Expected cash</div>
              <CommitInput
                money
                ariaLabel="Expected cash"
                value={v.cycle.expectedCash}
                disabled={readOnly}
                className="cell"
                onCommit={(m) => run(() => t.updateMonth(monthId, { expectedCash: m }))}
              />
            </label>
            <Check
              label="Allocation difference"
              ok={r.checks.allocation}
              value={<Amount value={r.allocationDifference} />}
            />
            <Check
              label="Journal difference"
              ok={r.checks.journal}
              value={<Amount value={r.journalDifference} />}
            />
            <Check
              label="Final transfer difference"
              ok={r.checks.finalTransfer}
              value={<Amount value={r.finalTransferDifference} />}
            />
            <Check label="Invalid entries" ok={r.checks.entries} value={r.invalidEntryCount} />
            <Check label="Negative transfers" ok={r.checks.negatives} value={r.negativeTransferCount} />
            <div className={`check${r.status === 'REVIEW' ? ' fail' : ''}`} role="listitem">
              <div className="k">Overall status</div>
              <div className="v">
                <MonthStatusBadge status={r.status} />
              </div>
              <div className="small subtle">
                {r.doneCount} of {r.requiredCount} transfers done
              </div>
            </div>
          </div>
          {r.issues.some((i) => i.blocking) && (
            <ul className="issues" style={{ marginTop: 10 }} aria-label="Needs review">
              {r.issues
                .filter((i) => i.blocking)
                .map((i, k) => (
                  <li key={k}>
                    <span className="dot" aria-hidden />
                    <span className="neg">{i.message}</span>
                  </li>
                ))}
            </ul>
          )}
          {r.issues.some((i) => !i.blocking) && (
            <p className="small subtle" role="status">
              {r.requiredCount - r.doneCount} transfer(s) awaiting confirmation. Mark them Done in the account
              summary.
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title="Account transfer summary"
        actions={
          accountFilter && (
            <button className="btn small" onClick={() => setAccountFilter(null)}>
              Clear filter ({code(accountFilter)})
            </button>
          )
        }
      >
        <table className="t" aria-label="Account transfer summary">
          <thead>
            <tr>
              <th className="l">Account</th>
              <th className="num">Budget allocation</th>
              <th className="num">Transfers in</th>
              <th className="num">Transfers out</th>
              <th className="num">Final transfer</th>
              <th>Transferred?</th>
              <th className="l">Notes</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.accountId} className={accountFilter === l.accountId ? 'sel' : ''}>
                <td>
                  <button
                    className="btn link code"
                    title="Show entries for this account"
                    onClick={() => setAccountFilter(accountFilter === l.accountId ? null : l.accountId)}
                  >
                    {code(l.accountId)}
                  </button>
                </td>
                <td style={{ width: 170 }}>
                  <div className="btn-row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                    {allocMeta.get(l.accountId)?.origin === 'manual_override' && (
                      <span
                        className="badge warn"
                        title={`Manual override. Budget planned ${formatUSD(allocMeta.get(l.accountId)?.plannedAmount ?? '0')}`}
                      >
                        override
                      </span>
                    )}
                    <CommitInput
                      money
                      ariaLabel={`${code(l.accountId)} budget allocation`}
                      value={l.budgetAmount}
                      disabled={readOnly}
                      onCommit={(m) => run(() => t.setAllocation(monthId, l.accountId, { budgetAmount: m }))}
                    />
                  </div>
                </td>
                <td className="num">
                  <Amount value={l.transfersIn} />
                </td>
                <td className="num">
                  <Amount value={l.transfersOut} />
                </td>
                <td className="num" style={{ fontWeight: 600 }}>
                  <Amount value={l.finalTransfer} redNegative label={`${code(l.accountId)} final transfer`} />
                </td>
                <td style={{ width: 140 }}>
                  {l.required ? (
                    <select
                      id={`month-done-${l.accountId}`}
                      className={`cell${l.effectiveState === 'done' ? ' btn done' : ''}`}
                      aria-label={`${code(l.accountId)} transferred`}
                      disabled={readOnly}
                      value={l.effectiveState}
                      onChange={(e) =>
                        run(() => t.setTransferState(monthId, l.accountId, e.target.value as TransferState))
                      }
                    >
                      <option value="pending">Pending</option>
                      <option value="done">Done</option>
                    </select>
                  ) : (
                    <span className="subtle small">Not required</span>
                  )}
                </td>
                <td>
                  <CommitInput
                    ariaLabel={`${code(l.accountId)} notes`}
                    value={l.notes ?? ''}
                    disabled={readOnly}
                    onCommit={(s) => run(() => t.setAllocation(monthId, l.accountId, { notes: s }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">
                <Amount value={r.totals.budget} />
              </td>
              <td className="num">
                <Amount value={r.totals.transfersIn} />
              </td>
              <td className="num">
                <Amount value={r.totals.transfersOut} />
              </td>
              <td className="num">
                <Amount value={r.totals.finalTransfer} />
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </Panel>

      <Panel
        title={`Transfer journal${accountFilter ? ` — ${code(accountFilter)}` : ''}`}
        actions={
          !readOnly && (
            <button className="btn small" onClick={() => setAdvanced({ open: true, entry: null })}>
              Advanced entry
            </button>
          )
        }
      >
        <table className="t" aria-label="Transfer journal">
          <thead>
            <tr>
              <th style={{ width: 18 }} />
              <th className="l" style={{ width: 118 }}>
                Date
              </th>
              <th className="l" style={{ width: 80 }}>
                Loan ID
              </th>
              <th className="l" style={{ minWidth: 180 }}>
                Description
              </th>
              <th className="l" style={{ width: 86 }}>
                From
              </th>
              <th className="l" style={{ width: 86 }}>
                To
              </th>
              <th className="num" style={{ width: 110 }}>
                Amount
              </th>
              <th className="l">Notes</th>
              <th className="l">Check</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <JournalRow
                key={e.entry.id}
                e={e}
                monthId={monthId}
                accounts={accounts}
                readOnly={readOnly}
                onDelete={() => deleteEntry(e)}
                onAdvanced={() => setAdvanced({ open: true, entry: e })}
              />
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={10} className="subtle">
                  No journal entries{accountFilter ? ` touching ${code(accountFilter)}` : ''} yet.
                </td>
              </tr>
            )}
            {!readOnly && (
              <NewTransferRow key={monthId} monthId={monthId} month={v.cycle.month} accounts={accounts} />
            )}
          </tbody>
        </table>
        {!readOnly && (
          <p className="small subtle">
            Tab between fields; Enter on the last field saves and starts another row. Escape clears the row.
          </p>
        )}
      </Panel>

      <Panel title="Month notes">
        <CommitInput
          multiline
          ariaLabel="Month notes"
          className="box"
          value={v.cycle.notes ?? ''}
          disabled={readOnly}
          onCommit={(s) => run(() => t.updateMonth(monthId, { notes: s || null }))}
        />
        {v.imported && (
          <p className="small subtle">
            Imported from {v.cycle.sourceWorkbook} · sheet {v.cycle.sourceSheet}
          </p>
        )}
      </Panel>

      <NewMonthDialog open={newMonthOpen} onClose={() => setNewMonthOpen(false)} />
      <AdvancedEntryDialog
        state={advanced}
        monthId={monthId}
        accounts={accounts}
        onClose={() => setAdvanced({ open: false, entry: null })}
        readOnly={readOnly}
      />
      <CloseOverrideDialog
        open={closeOpen}
        monthId={monthId}
        issues={r.issues.filter((i) => i.blocking).map((i) => i.message)}
        onClose={() => setCloseOpen(false)}
      />
      {confirm.element}
    </>
  );
}

function Check({ label, ok, value }: { label: string; ok: boolean; value: React.ReactNode }) {
  return (
    <div
      className={`check${ok ? '' : ' fail'}`}
      role="listitem"
      aria-label={`${label}: ${ok ? 'passes' : 'fails'}`}
    >
      <div className="k">
        <span>{label}</span>
        <span>{ok ? '✓' : '✕'}</span>
      </div>
      <div className="v">{value}</div>
    </div>
  );
}

function JournalRow({
  e,
  monthId,
  accounts,
  readOnly,
  onDelete,
  onAdvanced,
}: {
  e: EntryView;
  monthId: string;
  accounts: Account[];
  readOnly: boolean;
  onDelete: () => void;
  onAdvanced: () => void;
}) {
  const { t, run, navigate } = useTreasury();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const code = t.codeOf;
  const en = e.entry;
  const multi = !e.simple;
  const source = en.sourceSheet ? `${en.sourceSheet}!${en.sourceRange}` : null;

  if (editing && e.simple) {
    return (
      <TransferEditor
        monthId={monthId}
        accounts={accounts}
        initial={{
          entryDate: en.entryDate ?? '',
          loanId: en.loanId ?? '',
          description: en.description ?? '',
          from: e.simple.fromAccountId,
          to: e.simple.toAccountId,
          amount: e.simple.amount,
          notes: en.notes ?? '',
        }}
        onSave={(input) => {
          const ok = run(() => t.updateTransfer(en.id, input), 'Transfer updated');
          if (ok !== undefined) setEditing(false);
          return ok !== undefined;
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <>
      <tr id={`month-entry-${en.id}`} tabIndex={-1} className={e.result.valid ? '' : 'sel'}>
        <td>
          {multi && (
            <button
              className="expand"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse postings' : 'Expand postings'}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
        </td>
        <td className="nowrap">{en.entryDate ?? <span className="subtle small">month only</span>}</td>
        <td className="code">{en.loanId ?? ''}</td>
        <td>
          {en.description ?? <span className="subtle">—</span>}
          {source && (
            <div className="loc" title="Source workbook location">
              {source}
            </div>
          )}
        </td>
        {e.simple ? (
          <>
            <td className="code">{code(e.simple.fromAccountId)}</td>
            <td className="code">{code(e.simple.toAccountId)}</td>
            <td className="num">
              <Amount value={e.simple.amount} />
            </td>
          </>
        ) : (
          <>
            <td colSpan={2}>
              <span className="badge neutral">
                {en.postings.length === 1 ? '1 posting' : `${en.postings.length} postings`}
              </span>
            </td>
            <td className="num">
              <Amount
                value={sum(en.postings.filter((p) => !p.amount.startsWith('-')).map((p) => p.amount))}
              />
            </td>
          </>
        )}
        <td className="small">{en.notes}</td>
        <td className="small">
          {e.result.valid ? (
            <span className="subtle">OK</span>
          ) : (
            <span className="neg">{e.result.reasons.join('; ')}</span>
          )}
          {e.debtLinks.map((l) => (
            <div key={l.eventId}>
              <button
                className="btn link small"
                onClick={() => navigate({ page: 'debts', debtId: l.debtId })}
              >
                Loan {l.loanId} {formatUSD(l.changeAmount, { signed: true })}
              </button>
            </div>
          ))}
          {e.debtSuggestion && !readOnly && (
            <div>
              <button
                className="btn small"
                title="Record this transfer as a debt event (shown before saving)"
                onClick={() =>
                  run(
                    () => t.recordEntryOnDebt(en.id),
                    `Recorded ${formatUSD(e.debtSuggestion!.change, { signed: true })} on Loan ${e.debtSuggestion!.loanId}`,
                  )
                }
              >
                Record on Loan {e.debtSuggestion.loanId}:{' '}
                {formatUSD(e.debtSuggestion.change, { signed: true })}
              </button>
            </div>
          )}
        </td>
        <td className="nowrap">
          {!readOnly && (
            <span className="btn-row">
              <button
                className="btn small"
                onClick={() => (e.simple && !en.draftReason ? setEditing(true) : onAdvanced())}
              >
                Edit
              </button>
              <button className="btn small danger" aria-label="Delete entry" onClick={onDelete}>
                ✕
              </button>
            </span>
          )}
        </td>
      </tr>
      {multi &&
        expanded &&
        en.postings.map((p) => (
          <tr key={p.id} className="sub-row">
            <td />
            <td colSpan={3} className="subtle">
              Posting {p.position + 1}
              {p.originalCode ? ` (source “${p.originalCode}”)` : ''}
            </td>
            <td className="code" colSpan={2}>
              {code(p.accountId)}
            </td>
            <td className="num">
              <Amount value={p.amount} signed redNegative />
            </td>
            <td colSpan={3} />
          </tr>
        ))}
    </>
  );
}

interface TransferDraft {
  entryDate: string;
  loanId: string;
  description: string;
  from: string | null;
  to: string | null;
  amount: string;
  notes: string;
}

function NewTransferRow({
  monthId,
  month,
  accounts,
}: {
  monthId: string;
  month: string;
  accounts: Account[];
}) {
  const { t, run } = useTreasury();
  const [key, setKey] = useState(0);
  const today = todayIso();
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;
  return (
    <TransferEditor
      key={key}
      isNew
      monthId={monthId}
      accounts={accounts}
      initial={{
        entryDate: defaultDate,
        loanId: '',
        description: '',
        from: null,
        to: null,
        amount: '',
        notes: '',
      }}
      onSave={(input) => {
        const res = run(() => t.addTransfer(monthId, input));
        if (res) {
          setKey((k) => k + 1);
          return true;
        }
        return false;
      }}
      onCancel={() => setKey((k) => k + 1)}
    />
  );
}

function TransferEditor({
  initial,
  accounts,
  onSave,
  onCancel,
  isNew,
}: {
  monthId: string;
  initial: TransferDraft;
  accounts: Account[];
  onSave: (input: {
    entryDate: string | null;
    loanId: string | null;
    description: string | null;
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    notes: string | null;
  }) => boolean;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const [d, setD] = useState<TransferDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<TransferDraft>) => setD((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const save = () => {
    const amount = parseMoneyInput(d.amount);
    const errors = validateTransfer({ fromAccountId: d.from, toAccountId: d.to, amount: amount ?? '' });
    if (errors.length) {
      setError(errors.map((x) => TRANSFER_ERROR_TEXT[x]).join('; '));
      return;
    }
    setError(null);
    const ok = onSave({
      entryDate: d.entryDate || null,
      loanId: d.loanId || null,
      description: d.description || null,
      fromAccountId: d.from!,
      toAccountId: d.to!,
      amount: amount!,
      notes: d.notes || null,
    });
    if (ok && isNew) setTimeout(() => firstRef.current?.focus());
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setError(null);
      onCancel();
    }
  };
  const parsedAmount = parseMoneyInput(d.amount);
  const amountInvalid =
    d.amount.trim() !== '' && (parsedAmount === null || !isStrictlyPositive(parsedAmount));

  return (
    <>
      <tr className="new-row" onKeyDown={onKey} aria-label={isNew ? 'New transfer' : 'Edit transfer'}>
        <td>
          {dirty && (
            <span title="Unsaved" aria-label="Unsaved changes">
              ●
            </span>
          )}
        </td>
        <td>
          <input
            ref={firstRef}
            type="date"
            className="box"
            aria-label="Date"
            value={d.entryDate}
            onChange={(e) => set({ entryDate: e.target.value })}
            style={{ width: '100%' }}
          />
        </td>
        <td>
          <input
            className="box"
            aria-label="Loan ID"
            value={d.loanId}
            onChange={(e) => set({ loanId: e.target.value })}
            style={{ width: '100%' }}
          />
        </td>
        <td>
          <input
            className="box"
            aria-label="Description"
            value={d.description}
            onChange={(e) => set({ description: e.target.value })}
            style={{ width: '100%' }}
          />
        </td>
        <td>
          <AccountField
            ariaLabel="From account"
            accounts={accounts}
            value={d.from}
            onChange={(id) => set({ from: id })}
          />
        </td>
        <td>
          <AccountField
            ariaLabel="To account"
            accounts={accounts}
            value={d.to}
            onChange={(id) => set({ to: id })}
          />
        </td>
        <td>
          <input
            className={`box num${amountInvalid ? ' invalid' : ''}`}
            aria-label="Amount"
            inputMode="decimal"
            value={d.amount}
            onChange={(e) => set({ amount: e.target.value })}
            style={{ width: '100%' }}
          />
        </td>
        <td>
          <input
            className="box"
            aria-label="Notes"
            value={d.notes}
            onChange={(e) => set({ notes: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
            style={{ width: '100%' }}
          />
        </td>
        <td colSpan={2} className="nowrap">
          <span className="btn-row">
            <button className="btn primary small" onClick={save}>
              {isNew ? 'Add' : 'Save'}
            </button>
            {!isNew && (
              <button className="btn small" onClick={onCancel}>
                Cancel
              </button>
            )}
          </span>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={10} className="err" role="alert">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

function AdvancedEntryDialog({
  state,
  monthId,
  accounts,
  onClose,
  readOnly,
}: {
  state: { open: boolean; entry: EntryView | null };
  monthId: string;
  accounts: Account[];
  onClose: () => void;
  readOnly: boolean;
}) {
  const { t, run } = useTreasury();
  const e = state.entry?.entry;
  const [form, setForm] = useState<{
    key: string;
    entryDate: string;
    loanId: string;
    description: string;
    notes: string;
    postings: { accountId: string | null; amount: string }[];
  } | null>(null);
  const key = `${state.open}-${e?.id ?? 'new'}`;
  if (state.open && form?.key !== key) {
    setForm({
      key,
      entryDate: e?.entryDate ?? '',
      loanId: e?.loanId ?? '',
      description: e?.description ?? '',
      notes: e?.notes ?? '',
      postings: e
        ? e.postings.map((p) => ({ accountId: p.accountId, amount: p.amount }))
        : [
            { accountId: null, amount: '' },
            { accountId: null, amount: '' },
          ],
    });
  }
  if (!state.open || !form)
    return (
      <Dialog open={false} title="" onClose={onClose}>
        {null}
      </Dialog>
    );
  const amounts = form.postings.map((p) => parseMoneyInput(p.amount));
  const valid = amounts.every((a) => a !== null) && form.postings.every((p) => p.accountId);
  const diff = valid ? sum(amounts as string[]) : null;
  const balanced = diff !== null && isEffectivelyZero(diff);
  const setP = (i: number, patch: Partial<{ accountId: string | null; amount: string }>) =>
    setForm({ ...form, postings: form.postings.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const save = () => {
    const input = {
      entryDate: form.entryDate || null,
      loanId: form.loanId || null,
      description: form.description || null,
      notes: form.notes || null,
      postings: form.postings.map((p, i) => ({ accountId: p.accountId!, amount: amounts[i]! })),
    };
    const ok = run(
      () => (e ? t.updateAdvancedEntry(e.id, input) : t.addAdvancedEntry(monthId, input)),
      e ? 'Entry updated' : 'Entry added',
    );
    if (ok !== undefined) onClose();
  };
  return (
    <Dialog
      open
      wide
      title={e ? 'Edit multi-posting entry' : 'Advanced entry'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!balanced || readOnly} onClick={save}>
            Save balanced entry
          </button>
        </>
      }
    >
      <p className="small subtle" style={{ margin: 0 }}>
        Signed postings: negative decreases an account, positive increases it. The entry must balance to
        $0.00. Imported entries that do not balance are preserved as-is and can be corrected here.
      </p>
      <div className="form-grid">
        <Field label="Date">
          <input
            type="date"
            className="box"
            value={form.entryDate}
            onChange={(x) => setForm({ ...form, entryDate: x.target.value })}
          />
        </Field>
        <Field label="Loan ID">
          <input
            className="box"
            value={form.loanId}
            onChange={(x) => setForm({ ...form, loanId: x.target.value })}
          />
        </Field>
        <Field label="Description" wide>
          <input
            className="box"
            value={form.description}
            onChange={(x) => setForm({ ...form, description: x.target.value })}
          />
        </Field>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th className="l">Account</th>
            <th className="num">Signed amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {form.postings.map((p, i) => (
            <tr key={i}>
              <td>
                <AccountField
                  ariaLabel={`Posting ${i + 1} account`}
                  accounts={accounts}
                  value={p.accountId}
                  onChange={(id) => setP(i, { accountId: id })}
                />
              </td>
              <td>
                <input
                  className={`box num${p.amount && amounts[i] === null ? ' invalid' : ''}`}
                  aria-label={`Posting ${i + 1} amount`}
                  value={p.amount}
                  onChange={(x) => setP(i, { amount: x.target.value })}
                />
              </td>
              <td>
                <button
                  className="btn small danger"
                  disabled={form.postings.length <= 2}
                  onClick={() => setForm({ ...form, postings: form.postings.filter((_, k) => k !== i) })}
                  aria-label="Remove posting"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <button
                className="btn small"
                onClick={() =>
                  setForm({ ...form, postings: [...form.postings, { accountId: null, amount: '' }] })
                }
              >
                + Posting
              </button>
            </td>
            <td className={`num${balanced ? '' : ' neg'}`}>
              Difference {diff === null ? '—' : formatUSD(diff)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
      {state.entry && !state.entry.result.valid && (
        <p className="err">Current problems: {state.entry.result.reasons.join('; ')}</p>
      )}
      <Field label="Notes">
        <input
          className="box"
          value={form.notes}
          onChange={(x) => setForm({ ...form, notes: x.target.value })}
        />
      </Field>
    </Dialog>
  );
}

function NewMonthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, run, navigate } = useTreasury();
  const [form, setForm] = useState<{
    month: string;
    source: 'budget' | 'template' | 'duplicate' | 'blank';
    dup: string;
    expected: string;
  } | null>(null);
  const activeBudget = t.budget.activeVersion();
  if (open && !form) {
    const months = t.months();
    setForm({
      month: t.proposedNextMonth(),
      source: activeBudget
        ? 'budget'
        : t.activeProfile()
          ? 'template'
          : months.length
            ? 'duplicate'
            : 'blank',
      dup: months[months.length - 1]?.id ?? '',
      expected: '',
    });
  }
  if (!open && form) setForm(null);
  if (!form)
    return (
      <Dialog open={false} title="" onClose={onClose}>
        {null}
      </Dialog>
    );
  const profile = t.activeProfile();
  const budgetTakeHome = activeBudget ? t.budget.compute(activeBudget.id).payroll.takeHome : null;
  const create = () => {
    const id = run(
      () =>
        t.createMonth({
          month: form.month,
          source: form.source,
          duplicateFromMonthId: form.dup || null,
          expectedCash: parseMoneyInput(form.expected) ?? undefined,
        }),
      `${form.month} created`,
    );
    if (id) {
      onClose();
      navigate({ page: 'monthly', monthId: id });
    }
  };
  return (
    <Dialog
      open={open}
      title="New month"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create}>
            Create month
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Month">
          <input
            type="month"
            className="box"
            value={form.month}
            onChange={(e) => setForm({ ...form, month: e.target.value })}
          />
        </Field>
        <Field label="Expected cash">
          <input
            className="box num"
            value={form.expected}
            onChange={(e) => setForm({ ...form, expected: e.target.value })}
            placeholder={
              form.source === 'budget' && budgetTakeHome
                ? `${formatUSD(budgetTakeHome)} take-home`
                : 'From template'
            }
          />
        </Field>
        <Field label="Start from" wide>
          <select
            className="box"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value as 'template' })}
          >
            <option value="budget" disabled={!activeBudget}>
              Active budget
              {activeBudget
                ? ` ${activeBudget.label} (take-home ${formatUSD(budgetTakeHome!)})`
                : ' — none yet'}
            </option>
            <option value="template" disabled={!profile}>
              Legacy allocation template{profile ? ` (${formatUSD(profile.expectedCash)})` : ' — none yet'}
            </option>
            <option value="duplicate">Duplicate a prior month</option>
            <option value="blank">Blank (all active accounts at $0)</option>
          </select>
        </Field>
        {form.source === 'duplicate' && (
          <Field label="Month to duplicate" wide>
            <select
              className="box"
              value={form.dup}
              onChange={(e) => setForm({ ...form, dup: e.target.value })}
            >
              {t
                .months()
                .slice()
                .reverse()
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {monthLabel(m.month)}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
      <p className="small subtle" style={{ margin: 0 }}>
        {form.source === 'budget'
          ? "Expected cash is the budget's take-home pay and each account gets the budget lines it funds. These are planned amounts only: no transfers are created. Leave expected cash blank to use take-home pay."
          : 'Allocations are copied exactly; the app never adjusts amounts to make them tie. Any difference is shown as a Review item.'}
      </p>
    </Dialog>
  );
}

function CloseOverrideDialog({
  open,
  monthId,
  issues,
  onClose,
}: {
  open: boolean;
  monthId: string;
  issues: string[];
  onClose: () => void;
}) {
  const { t, run } = useTreasury();
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={open}
      title="Close a month that needs review?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} autoFocus>
            Keep open
          </button>
          <button
            className="btn danger"
            disabled={!note.trim()}
            onClick={() => {
              if (run(() => t.closeMonth(monthId, note), 'Closed with a recorded override') !== undefined)
                onClose();
            }}
          >
            Close with override
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>The safer choice is to resolve these first:</p>
      <ul className="warn-list">
        {issues.map((i) => (
          <li key={i} className="neg">
            {i}
          </li>
        ))}
      </ul>
      <Field label="Reason for override (recorded)">
        <input className="box" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}

type MonthBudgetDiff = NonNullable<ReturnType<Treasury['budgetDiff']>>;

function BudgetBanner({ monthId }: { monthId: string }) {
  const { t, navigate } = useTreasury();
  const [open, setOpen] = useState(false);
  const diff = t.budgetDiff(monthId);
  if (!diff || !diff.hasChanges) return null;
  const code = t.codeOf;

  if (!diff.needsRefresh) {
    // Only kept manual values differ: note them quietly instead of asking for a refresh.
    const parts = [
      ...(diff.cashOverride
        ? [
            `expected cash ${formatUSD(diff.cashOverride.current)} (budget ${formatUSD(diff.cashOverride.proposed)})`,
          ]
        : []),
      ...diff.overrides.map(
        (o) => `${code(o.accountId)} ${formatUSD(o.current)} (budget ${formatUSD(o.proposed)})`,
      ),
    ];
    return (
      <>
        <p className="small subtle" role="note" aria-label="Budget overrides">
          Manual overrides of budget {diff.versionLabel}: {parts.join('; ')}.{' '}
          <button className="btn link small" onClick={() => setOpen(true)}>
            Review
          </button>
        </p>
        <RefreshDialog monthId={monthId} diff={diff} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  const changed = diff.rows.filter((r) => r.after !== r.current || r.changed);
  const isSameVersion = diff.monthVersionId === diff.versionId;
  return (
    <section
      id="month-budget-refresh"
      tabIndex={-1}
      className="panel"
      aria-label="Budget differences"
      style={{ borderColor: '#f1d9a6' }}
    >
      <header style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
        {isSameVersion
          ? `This month differs from budget ${diff.versionLabel}`
          : `The active budget is ${diff.versionLabel}; this month ${diff.monthVersionId ? 'uses an earlier version' : 'is not linked to a budget'}`}
        <span className="spacer" />
        <button className="btn small" onClick={() => navigate({ page: 'budget', version: diff.versionId })}>
          Open budget
        </button>
        <button className="btn small primary" onClick={() => setOpen(true)}>
          Review and refresh…
        </button>
      </header>
      <div className="body small">
        {diff.expectedCash.changed && (
          <span>
            Expected cash {formatUSD(diff.expectedCash.current)} → {formatUSD(diff.expectedCash.proposed)}
            .{' '}
          </span>
        )}
        {changed.length > 0 && (
          <span>
            {changed.length} account allocation(s) differ:{' '}
            {changed
              .map(
                (r) =>
                  `${code(r.accountId)} ${formatUSD(r.current)} → ${formatUSD(r.proposed)}${r.overridden ? ' (your override)' : ''}`,
              )
              .join('; ')}
            .
          </span>
        )}{' '}
        Nothing changes until you refresh.
      </div>
      <RefreshDialog monthId={monthId} diff={diff} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function RefreshDialog({
  monthId,
  diff,
  open,
  onClose,
}: {
  monthId: string;
  diff: MonthBudgetDiff;
  open: boolean;
  onClose: () => void;
}) {
  const { t, run } = useTreasury();
  const [reset, setReset] = useState(false);
  const shown = reset ? t.budgetDiff(monthId, diff.versionId, { resetOverrides: true })! : diff;
  const manualCash = t.repos.getMonth(monthId)?.expectedCashOrigin === 'manual';
  const code = t.codeOf;
  return (
    <Dialog
      open={open}
      wide
      title={`Refresh from budget ${diff.versionLabel}`}
      onClose={onClose}
      footer={
        <>
          <label className="small" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} /> Also
            replace my manual overrides
          </label>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!shown.needsRefresh}
            onClick={() => {
              if (
                run(
                  () =>
                    t.refreshMonthFromBudget(monthId, { versionId: diff.versionId, resetOverrides: reset }),
                  'Allocations refreshed from budget — Command-Z to undo',
                ) !== undefined
              )
                onClose();
            }}
          >
            Refresh allocations
          </button>
        </>
      }
    >
      <table className="t" aria-label="Budget refresh preview">
        <thead>
          <tr>
            <th className="l">Account</th>
            <th className="num">Current</th>
            <th className="num">Budget</th>
            <th className="num">After refresh</th>
            <th className="l">Note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Expected cash</td>
            <td className="num">
              <Amount value={shown.expectedCash.current} />
            </td>
            <td className="num">
              <Amount value={shown.expectedCash.proposed} />
            </td>
            <td className="num">
              <Amount
                value={manualCash && !reset ? shown.expectedCash.current : shown.expectedCash.proposed}
              />
            </td>
            <td className="small">
              {manualCash ? (reset ? 'Manual value replaced' : 'Manual value kept') : ''}
            </td>
          </tr>
          {shown.rows.map((r) => (
            <tr key={r.accountId} className={r.after === r.current ? 'muted' : ''}>
              <td className="code">{code(r.accountId)}</td>
              <td className="num">
                <Amount value={r.current} />
              </td>
              <td className="num">
                <Amount value={r.proposed} />
              </td>
              <td className="num">
                <b>
                  <Amount value={r.after} />
                </b>
              </td>
              <td className="small">
                {r.overridden && !reset && 'Your override is kept. '}
                {r.resetsDone && <span className="neg">Marked Done; returns to Pending. </span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small subtle" style={{ margin: 0 }}>
        Only planned allocations and expected cash change. No transfers or postings are created, and closed
        months are never refreshed.
      </p>
    </Dialog>
  );
}
