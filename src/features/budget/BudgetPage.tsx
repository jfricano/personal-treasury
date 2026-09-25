import { useState, type CSSProperties } from 'react';
import { useTreasury } from '@/app/context';
import { Amount, CommitInput, Dialog, Field, Panel, useConfirm } from '@/components/ui';
import type { VersionView } from '@/api/budget';
import { dec, formatUSD, isMoney, normalize, parseMoneyInput, sum } from '@/domain/money';
import { WITHHOLDING_COMPONENTS, WITHHOLDING_LABEL, type PayrollDeduction } from '@/domain/payroll';
import {
  JURISDICTION_LABEL,
  JURISDICTIONS,
  type Bracket,
  type Jurisdiction,
  type TaxRuleSet,
} from '@/domain/tax/rules';
import { monthLabel } from '@/domain/monthly';

const pct = (rate: string) => `${normalize(dec(rate).times(100))}%`;
const fromPct = (text: string) => {
  const m = parseMoneyInput(text.replace('%', ''));
  return m === null ? null : normalize(dec(m).div(100));
};

export function BudgetPage() {
  const { route, navigate } = useTreasury();
  const tab = route.tab ?? 'versions';
  return (
    <>
      <div className="page-head">
        <h2>Budget and tax</h2>
        <div className="tabs" role="group" aria-label="Budget sections">
          <button
            aria-pressed={tab === 'versions'}
            onClick={() => navigate({ page: 'budget', version: route.version })}
          >
            Budget versions
          </button>
          <button aria-pressed={tab === 'tax'} onClick={() => navigate({ page: 'budget', tab: 'tax' })}>
            Tax rules
          </button>
        </div>
        <span className="spacer" />
        <span className="subtle small">
          Budgets plan funding; they never create transfers. Treasury months take a copy when you create or
          refresh them.
        </span>
      </div>
      {tab === 'tax' ? <TaxRules /> : <Versions />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function Versions() {
  const { t, route, navigate, run } = useTreasury();
  const versions = t.budget.versions();
  const [newOpen, setNewOpen] = useState(false);
  if (!versions.length) {
    return (
      <div className="empty">
        <h3>No budget yet</h3>
        <p className="subtle">Import Personal Budget.xlsx, or start an empty draft.</p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => navigate({ page: 'import' })}>
            Import budget workbook
          </button>
          <button
            className="btn"
            onClick={() => {
              const id = run(() => t.budget.createDraft('New budget'));
              if (id) navigate({ page: 'budget', version: id });
            }}
          >
            New empty draft
          </button>
        </div>
      </div>
    );
  }
  const selectedId =
    route.version && versions.some((v) => v.version.id === route.version)
      ? route.version
      : (t.budget.activeVersion()?.id ?? versions[0].version.id);
  const view = t.budget.versionView(selectedId);

  return (
    <>
      <Panel
        title="Budget history"
        actions={
          <span className="btn-row">
            <button className="btn small" onClick={() => setNewOpen(true)}>
              New empty draft
            </button>
          </span>
        }
      >
        <table className="t" aria-label="Budget versions">
          <thead>
            <tr>
              <th className="l">Version</th>
              <th className="l">Status</th>
              <th className="l">In effect</th>
              <th className="l">Used by treasury months</th>
              <th className="num">Take-home</th>
              <th className="l">Detail</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr
                key={v.version.id}
                className={`clickable${v.version.id === selectedId ? ' sel' : ''}`}
                onClick={() => navigate({ page: 'budget', version: v.version.id })}
              >
                <td>
                  <button
                    className="btn link"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate({ page: 'budget', version: v.version.id });
                    }}
                  >
                    {v.version.label}
                  </button>
                </td>
                <td>
                  <StatusBadge status={v.version.status} locked={!!v.version.lockedAt} />
                </td>
                <td className="nowrap">
                  {range(v.version.effectiveFrom, v.version.effectiveTo, v.version.status)}
                </td>
                <td className="small">
                  {v.monthsUsed.length ? (
                    `${v.monthsUsed[0].month}${v.monthsUsed.length > 1 ? ` → ${v.monthsUsed[v.monthsUsed.length - 1].month}` : ''} (${v.monthsUsed.length})`
                  ) : (
                    <span className="subtle">none</span>
                  )}
                </td>
                <td className="num">{v.takeHome ? <Amount value={v.takeHome} /> : '—'}</td>
                <td className="small subtle">
                  {v.version.detailLevel === 'full' ? 'Full plan' : 'Summary only'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <VersionDetail key={selectedId} view={view} />
      <NewDraftDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}

const range = (from: string | null, to: string | null, status: string) =>
  from
    ? `${monthLabel(from)} → ${to ? monthLabel(to) : status === 'active' ? 'present' : '…'}`
    : status === 'draft'
      ? 'not yet active'
      : '—';

function StatusBadge({ status, locked }: { status: string; locked?: boolean }) {
  return (
    <span className="btn-row" style={{ gap: 4 }}>
      <span className={`badge ${status === 'active' ? 'complete' : status === 'draft' ? 'warn' : 'closed'}`}>
        {status === 'active' ? 'Active' : status === 'draft' ? 'Draft' : 'Archived'}
      </span>
      {locked && (
        <span className="badge neutral" title="Used by treasury months; duplicate to change amounts">
          Locked
        </span>
      )}
    </span>
  );
}

function NewDraftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, run, navigate } = useTreasury();
  const [label, setLabel] = useState('');
  return (
    <Dialog
      open={open}
      title="New empty budget draft"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const id = run(() => t.budget.createDraft(label));
              if (id) {
                onClose();
                navigate({ page: 'budget', version: id });
              }
            }}
          >
            Create draft
          </button>
        </>
      }
    >
      <Field label="Label">
        <input
          className="box"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Jan-27"
        />
      </Field>
      <p className="small subtle" style={{ margin: 0 }}>
        To change the current plan, duplicate it instead: that keeps every line and deduction.
      </p>
    </Dialog>
  );
}

function VersionDetail({ view }: { view: VersionView }) {
  const { t, run, navigate } = useTreasury();
  const confirm = useConfirm();
  const [activateOpen, setActivateOpen] = useState(false);
  const v = view.version;
  const ed = view.editable;

  const duplicate = () => {
    const id = run(() => t.budget.duplicateVersion(v.id), `Duplicated ${v.label}`);
    if (id) navigate({ page: 'budget', version: id });
  };
  const del = async () => {
    if (await confirm.ask(`Delete draft ${v.label}?`, { danger: true, confirmLabel: 'Delete draft' })) {
      if (run(() => t.budget.deleteVersion(v.id), 'Draft deleted') !== undefined)
        navigate({ page: 'budget' });
    }
  };

  return (
    <>
      <Panel
        title={
          <span>
            {v.label} <StatusBadge status={v.status} locked={!!v.lockedAt} />
          </span>
        }
        actions={
          <span className="btn-row">
            {v.detailLevel === 'full' && (
              <button className="btn small" onClick={duplicate}>
                Duplicate
              </button>
            )}
            {v.detailLevel === 'full' && v.status !== 'active' && (
              <button className="btn small primary" onClick={() => setActivateOpen(true)}>
                Activate…
              </button>
            )}
            {v.status === 'draft' && (
              <button className="btn small danger" onClick={del}>
                Delete draft
              </button>
            )}
          </span>
        }
      >
        <div className="form-grid" style={{ '--cols': 'repeat(4, minmax(0, 1fr))' } as CSSProperties}>
          <Field label="Label">
            <CommitInput
              className="box"
              ariaLabel="Version label"
              value={v.label}
              onCommit={(s) => run(() => t.budget.updateVersionInfo(v.id, { label: s }))}
            />
          </Field>
          <Field label="In effect from">
            <input
              type="month"
              className="box"
              aria-label="Effective from"
              value={v.effectiveFrom ?? ''}
              onChange={(e) =>
                run(() => t.budget.updateVersionInfo(v.id, { effectiveFrom: e.target.value || null }))
              }
            />
          </Field>
          <Field label="In effect through">
            <input
              type="month"
              className="box"
              aria-label="Effective through"
              value={v.effectiveTo ?? ''}
              onChange={(e) =>
                run(() => t.budget.updateVersionInfo(v.id, { effectiveTo: e.target.value || null }))
              }
            />
          </Field>
          <Field label="Tax year for estimate">
            <CommitInput
              className="box"
              ariaLabel="Tax year"
              value={v.taxYear ? String(v.taxYear) : ''}
              onCommit={(s) =>
                run(() => t.budget.updateVersionInfo(v.id, { taxYear: s ? Number.parseInt(s, 10) : null }))
              }
            />
          </Field>
          <Field label="Notes" wide>
            <CommitInput
              multiline
              className="box"
              ariaLabel="Version notes"
              value={v.notes ?? ''}
              onCommit={(s) => run(() => t.budget.updateVersionInfo(v.id, { notes: s || null }))}
            />
          </Field>
        </div>
        {v.lockedAt && (
          <p className="small subtle" style={{ marginBottom: 0 }}>
            Locked because treasury months use it ({view.monthsUsed.map((m) => m.month).join(', ')}). Amounts
            can't change; duplicate it to plan changes. Dates, label, notes and tax year stay editable.
          </p>
        )}
        {v.status === 'archived' && v.detailLevel === 'full' && !v.lockedAt && (
          <p className="small subtle" style={{ marginBottom: 0 }}>
            Archived versions are read-only. Duplicate to reuse it.
          </p>
        )}
        {v.copiedFromVersionId && (
          <p className="small subtle" style={{ marginBottom: 0 }}>
            Copied from {t.budget.repos.getVersion(v.copiedFromVersionId)?.label ?? 'another version'}.
          </p>
        )}
      </Panel>

      {v.detailLevel === 'summary' ? (
        <Panel title="Historical summary (as recorded in Budget History)">
          <table className="t">
            <thead>
              <tr>
                <th className="l">Description</th>
                <th className="num">Monthly</th>
                <th className="l">Source</th>
              </tr>
            </thead>
            <tbody>
              {view.summaryRows.map((r) => (
                <tr key={r.position}>
                  <td>{r.description}</td>
                  <td className="num">
                    {r.monthlyAmount === null ? (
                      <span className="subtle">not stated</span>
                    ) : (
                      <Amount value={r.monthlyAmount} redNegative />
                    )}
                  </td>
                  <td className="loc">{r.sourceRange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : (
        <>
          <div className="grid-2">
            <PayrollPanel view={view} editable={ed} />
            <TaxPanel view={view} />
          </div>
          <LinesPanel view={view} editable={ed} />
        </>
      )}
      <ActivateDialog open={activateOpen} view={view} onClose={() => setActivateOpen(false)} />
      {confirm.element}
    </>
  );
}

function ActivateDialog({ open, view, onClose }: { open: boolean; view: VersionView; onClose: () => void }) {
  const { t, run } = useTreasury();
  const [month, setMonth] = useState(t.budget.suggestedEffectiveMonth());
  const current = t.budget.activeVersion();
  return (
    <Dialog
      open={open}
      title={`Activate ${view.version.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (
                run(
                  () => t.budget.activate(view.version.id, month),
                  `${view.version.label} is now the active budget`,
                ) !== undefined
              )
                onClose();
            }}
          >
            Activate
          </button>
        </>
      }
    >
      <Field label="In effect from">
        <input type="month" className="box" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>
      <p className="small" style={{ margin: 0 }}>
        {current ? (
          <>{current.label} will be archived, in effect through the month before.</>
        ) : (
          'There is no active budget yet.'
        )}{' '}
        Open treasury months are not changed: each shows the differences and lets you refresh it explicitly.
        Closed months keep their allocations.
      </p>
      {view.budget && view.budget.issues.length > 0 && (
        <ul className="warn-list">
          {view.budget.issues.map((i) => (
            <li key={i} className="neg">
              {i}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

function PayrollPanel({ view, editable }: { view: VersionView; editable: boolean }) {
  const { t, run } = useTreasury();
  const p = view.payroll!;
  const v = view.version;
  const [adding, setAdding] = useState<{
    label: string;
    timing: 'pretax' | 'posttax';
    amount: string;
  } | null>(null);
  const flags = (d: PayrollDeduction, patch: Partial<PayrollDeduction>) =>
    run(() => t.budget.updateDeduction(d.id, { ...d, ...patch }));
  return (
    <Panel title="Pay and payroll deductions (monthly)">
      <table className="t" aria-label="Payroll">
        <thead>
          <tr>
            <th className="l">Item</th>
            <th className="num">Amount</th>
            <th title="Reduces federal taxable income">Fed</th>
            <th title="Reduces California taxable income">CA</th>
            <th title="Reduces Social Security and Medicare wages">FICA</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <b>Gross pay</b>
            </td>
            <td style={{ width: 150 }}>
              <CommitInput
                money
                ariaLabel="Gross pay"
                value={v.grossMonthly ?? '0'}
                disabled={!editable}
                onCommit={(m) => run(() => t.budget.setGross(v.id, m))}
              />
            </td>
            <td colSpan={4} />
          </tr>
          {(['pretax', 'posttax'] as const).map((timing) => (
            <DeductionGroup key={timing} timing={timing} view={view} editable={editable} onFlags={flags} />
          ))}
          <tr className="sub-row">
            <td colSpan={6}>
              <b>Actual withholding</b>{' '}
              <span className="subtle">(from your pay stub; the tax estimate never replaces these)</span>
            </td>
          </tr>
          {WITHHOLDING_COMPONENTS.map((c) => (
            <tr key={c}>
              <td>{WITHHOLDING_LABEL[c]}</td>
              <td>
                <CommitInput
                  money
                  ariaLabel={`${WITHHOLDING_LABEL[c]} withholding`}
                  value={view.withholdings[c] ?? '0'}
                  disabled={!editable}
                  onCommit={(m) => run(() => t.budget.setWithholding(v.id, c, m))}
                />
              </td>
              <td colSpan={4} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Pretax deductions</td>
            <td className="num">
              <Amount value={p.pretaxTotal} />
            </td>
            <td colSpan={4} />
          </tr>
          <tr>
            <td>Post-tax deductions</td>
            <td className="num">
              <Amount value={p.posttaxTotal} />
            </td>
            <td colSpan={4} />
          </tr>
          <tr>
            <td>Withholding</td>
            <td className="num">
              <Amount value={p.withholdingTotal} />
            </td>
            <td colSpan={4} />
          </tr>
          <tr>
            <td>Take-home pay</td>
            <td className="num" data-testid="take-home">
              <Amount value={p.takeHome} />
            </td>
            <td colSpan={4} className="small subtle">
              = cash available to budget
            </td>
          </tr>
        </tfoot>
      </table>
      {editable &&
        (adding ? (
          <form
            className="btn-row"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const amt = parseMoneyInput(adding.amount);
              if (amt === null) return;
              const retirement = /pension|457|403|401/i.test(adding.label);
              if (
                run(
                  () =>
                    t.budget.addDeduction(v.id, {
                      label: adding.label,
                      timing: adding.timing,
                      method: 'fixed',
                      monthlyAmount: amt,
                      reducesFederalIncome: adding.timing === 'pretax',
                      reducesCaIncome: adding.timing === 'pretax',
                      reducesFicaWages: adding.timing === 'pretax' && !retirement,
                    }),
                  'Deduction added',
                ) !== undefined
              )
                setAdding(null);
            }}
          >
            <input
              className="box"
              placeholder="Label"
              aria-label="New deduction label"
              value={adding.label}
              onChange={(e) => setAdding({ ...adding, label: e.target.value })}
            />
            <select
              className="box"
              aria-label="New deduction timing"
              value={adding.timing}
              onChange={(e) => setAdding({ ...adding, timing: e.target.value as 'pretax' })}
            >
              <option value="pretax">Pretax</option>
              <option value="posttax">Post-tax</option>
            </select>
            <input
              className="box num"
              placeholder="Monthly amount"
              aria-label="New deduction amount"
              value={adding.amount}
              onChange={(e) => setAdding({ ...adding, amount: e.target.value })}
              style={{ width: 120 }}
            />
            <button className="btn small primary">Add</button>
            <button type="button" className="btn small" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            onClick={() => setAdding({ label: '', timing: 'pretax', amount: '' })}
          >
            + Deduction
          </button>
        ))}
      <p className="small subtle" style={{ marginBottom: 0 }}>
        Enter deductions as positive amounts taken from pay (an employer credit is negative). The Fed / CA /
        FICA ticks record which wage bases a pretax deduction reduces.
      </p>
    </Panel>
  );
}

function DeductionGroup({
  timing,
  view,
  editable,
  onFlags,
}: {
  timing: 'pretax' | 'posttax';
  view: VersionView;
  editable: boolean;
  onFlags: (d: PayrollDeduction, patch: Partial<PayrollDeduction>) => void;
}) {
  const { t, run } = useTreasury();
  const rows = view.payroll!.deductions.filter((d) => d.timing === timing);
  return (
    <>
      <tr className="sub-row">
        <td colSpan={6}>
          <b>{timing === 'pretax' ? 'Pretax deductions' : 'Post-tax deductions'}</b>
        </td>
      </tr>
      {rows.map((d) => (
        <tr key={d.id}>
          <td>
            <CommitInput
              ariaLabel={`${d.label} label`}
              value={d.label}
              disabled={!editable}
              onCommit={(s) => run(() => t.budget.updateDeduction(d.id, { ...d, label: s }))}
            />
            {d.method === 'rate_of_gross_less_exclusion' && (
              <div className="small subtle btn-row" style={{ gap: 4 }}>
                <span>=</span>
                <CommitInput
                  className="cell"
                  ariaLabel={`${d.label} rate percent`}
                  value={pct(d.rate ?? '0').replace('%', '')}
                  disabled={!editable}
                  onCommit={(s) => {
                    const r = fromPct(s);
                    if (r) run(() => t.budget.updateDeduction(d.id, { ...d, rate: r }));
                  }}
                />
                <span>% × (gross −</span>
                <CommitInput
                  className="cell"
                  ariaLabel={`${d.label} exclusion`}
                  money
                  value={d.monthlyExclusion ?? '0'}
                  disabled={!editable}
                  onCommit={(m) => run(() => t.budget.updateDeduction(d.id, { ...d, monthlyExclusion: m }))}
                />
                <span>)</span>
              </div>
            )}
          </td>
          <td>
            {d.method === 'fixed' ? (
              <CommitInput
                money
                ariaLabel={`${d.label} amount`}
                value={d.monthlyAmount ?? '0'}
                disabled={!editable}
                onCommit={(m) => run(() => t.budget.updateDeduction(d.id, { ...d, monthlyAmount: m }))}
              />
            ) : (
              <span className="num" style={{ display: 'block', paddingRight: 6 }}>
                <Amount value={d.amount} />
              </span>
            )}
          </td>
          {(['reducesFederalIncome', 'reducesCaIncome', 'reducesFicaWages'] as const).map((k) => (
            <td key={k} style={{ textAlign: 'center' }}>
              {timing === 'pretax' ? (
                <input
                  type="checkbox"
                  aria-label={`${d.label} ${k}`}
                  checked={d[k]}
                  disabled={!editable}
                  onChange={(e) => onFlags(d, { [k]: e.target.checked })}
                />
              ) : (
                <span className="subtle">—</span>
              )}
            </td>
          ))}
          <td>
            {editable && (
              <button
                className="btn small danger"
                aria-label={`Delete ${d.label}`}
                onClick={() => run(() => t.budget.deleteDeduction(d.id))}
              >
                ✕
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tax estimate
// ---------------------------------------------------------------------------

function TaxPanel({ view }: { view: VersionView }) {
  const { navigate } = useTreasury();
  const tax = view.tax;
  return (
    <Panel
      title={`Tax estimate${tax ? ` — ${tax.taxYear}` : ''}`}
      actions={
        <button className="btn small" onClick={() => navigate({ page: 'budget', tab: 'tax' })}>
          Edit tax rules
        </button>
      }
    >
      {!tax ? (
        <p className="err" style={{ margin: 0 }}>
          {view.taxError}
        </p>
      ) : (
        <>
          {tax.provenance
            .filter((p) => p.provisional || p.ratesFromYear !== p.taxYear)
            .map((p) => (
              <p
                key={p.jurisdiction}
                className="badge warn"
                style={{ display: 'block', margin: '0 0 8px', padding: '6px 10px', whiteSpace: 'normal' }}
                role="note"
              >
                {JURISDICTION_LABEL[p.jurisdiction]}: using {p.ratesFromYear} rates for {p.taxYear}
                {p.provisional ? ' (provisional)' : ''}. Update them in Tax rules when {p.taxYear} figures are
                published.
              </p>
            ))}
          <table className="t" aria-label="Tax estimate">
            <thead>
              <tr>
                <th className="l">Annual</th>
                <th className="num">Taxable / wages</th>
                <th className="num">Estimated liability</th>
                <th className="num">Withheld</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {tax.components.map((c) => (
                <tr key={c.component}>
                  <td>{c.label}</td>
                  <td className="num">
                    <Amount value={c.base} />
                  </td>
                  <td className="num">
                    <Amount value={c.liabilityRounded} />
                  </td>
                  <td className="num">
                    <Amount value={c.withheld} />
                  </td>
                  <td className="num">
                    <Diff value={c.difference} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="num">
                  <Amount value={tax.total.liabilityRounded} />
                </td>
                <td className="num">
                  <Amount value={tax.total.withheld} />
                </td>
                <td className="num" data-testid="tax-difference">
                  <Diff value={tax.total.difference} />
                </td>
              </tr>
            </tfoot>
          </table>
          <p style={{ marginBottom: 0 }}>
            {dec(tax.total.difference).isZero() ? (
              'Withholding matches the estimate.'
            ) : dec(tax.total.difference).isPositive() ? (
              <>
                Projected <b className="neg">underpayment of {formatUSD(tax.total.difference)}</b> for the
                year.
              </>
            ) : (
              <>
                Projected <b>overpayment of {formatUSD(dec(tax.total.difference).abs().toFixed())}</b> for the
                year.
              </>
            )}
          </p>
          <p className="small subtle" style={{ marginBottom: 0 }}>
            Single filer. Federal taxable = wages − flagged pretax deductions −{' '}
            {formatUSD(tax.federal.standardDeduction)} standard deduction; California taxable = wages −
            flagged deductions − {formatUSD(tax.california.standardDeduction)}, less the{' '}
            {formatUSD(tax.california.exemptionCredit)} exemption credit. Employment tax rounded together:{' '}
            {formatUSD(tax.employment.liabilityRounded)}. The estimate is for comparison only and never
            changes take-home pay, the budget or the treasury.
          </p>
        </>
      )}
    </Panel>
  );
}

function Diff({ value }: { value: string }) {
  const d = dec(value);
  if (d.isZero()) return <span className="subtle">even</span>;
  return (
    <span
      className={d.isPositive() ? 'neg' : ''}
      title={d.isPositive() ? 'Projected underpayment' : 'Projected overpayment'}
    >
      {d.isPositive() ? `${formatUSD(value)} under` : `${formatUSD(d.abs().toFixed())} over`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Budget lines
// ---------------------------------------------------------------------------

function LinesPanel({ view, editable }: { view: VersionView; editable: boolean }) {
  const { t, run } = useTreasury();
  const categories = t.budget.categories();
  const accounts = t.accounts();
  const b = view.budget!;
  const resolved = new Map(b.lines.map((l) => [l.id, l]));
  const [adding, setAdding] = useState<{
    categoryId: string;
    label: string;
    amount: string;
    funding: string;
    residual: boolean;
  } | null>(null);
  const [newCat, setNewCat] = useState('');
  const code = t.codeOf;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '?';
  // Groups follow category order (not line order), so split lines sit with their category.
  const used = new Set(view.lines.map((l) => l.categoryId));
  const order = categories.filter((c) => used.has(c.id)).map((c) => c.id);

  return (
    <div className="grid-2" style={{ '--cols': 'minmax(0, 2fr) minmax(280px, 1fr)' } as CSSProperties}>
      <Panel
        title="Planned allocations"
        actions={<span className="small subtle">Category = purpose · Account = funding source</span>}
      >
        <table className="t" aria-label="Budget lines">
          <thead>
            <tr>
              <th className="l">Item</th>
              <th className="num">Monthly</th>
              <th className="l">Funded by</th>
              <th className="l">Notes</th>
              <th />
            </tr>
          </thead>
          {order.map((cid) => {
            const lines = view.lines.filter((l) => l.categoryId === cid);
            const total = sum(lines.map((l) => resolved.get(l.id)!.amount));
            return (
              <tbody key={cid}>
                <tr className="sub-row">
                  <td>
                    <b>{catName(cid)}</b>{' '}
                    <span className="small subtle">
                      {categories.find((c) => c.id === cid)?.description ?? ''}
                    </span>
                  </td>
                  <td className="num">
                    <b>
                      <Amount value={total} />
                    </b>
                  </td>
                  <td colSpan={3} />
                </tr>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <CommitInput
                        ariaLabel={`${l.label} label`}
                        value={l.label}
                        disabled={!editable}
                        onCommit={(s) =>
                          run(() =>
                            t.budget.updateLine(l.id, {
                              ...l,
                              label: s,
                              fundingAccountId: l.fundingAccountId ?? '',
                            }),
                          )
                        }
                      />
                    </td>
                    <td style={{ width: 140 }}>
                      {l.kind === 'residual' ? (
                        <span
                          className="num"
                          style={{ display: 'block', paddingRight: 6 }}
                          title="Take-home pay minus every other line"
                        >
                          <Amount value={resolved.get(l.id)!.amount} redNegative />{' '}
                          <span className="small subtle">remainder</span>
                        </span>
                      ) : (
                        <CommitInput
                          money
                          ariaLabel={`${l.label} amount`}
                          value={l.monthlyAmount ?? '0'}
                          disabled={!editable}
                          onCommit={(m) =>
                            run(() =>
                              t.budget.updateLine(l.id, {
                                ...l,
                                monthlyAmount: m,
                                fundingAccountId: l.fundingAccountId ?? '',
                              }),
                            )
                          }
                        />
                      )}
                    </td>
                    <td style={{ width: 110 }}>
                      <select
                        className="cell code"
                        aria-label={`${l.label} funding account`}
                        value={l.fundingAccountId ?? ''}
                        disabled={!editable}
                        onChange={(e) =>
                          run(() => t.budget.updateLine(l.id, { ...l, fundingAccountId: e.target.value }))
                        }
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="small subtle">
                      {l.notes}
                      {l.grossAmount ? ` (gross ${formatUSD(l.grossAmount)})` : ''}
                    </td>
                    <td>
                      {editable && (
                        <button
                          className="btn small danger"
                          aria-label={`Delete ${l.label}`}
                          onClick={() => run(() => t.budget.deleteLine(l.id))}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
          <tfoot>
            <tr>
              <td>Total allocated</td>
              <td className="num">
                <Amount value={b.totalAllocated} />
              </td>
              <td colSpan={3} className="small subtle">
                Take-home {formatUSD(b.takeHome)}
              </td>
            </tr>
          </tfoot>
        </table>
        {b.issues.length > 0 && (
          <ul className="warn-list">
            {b.issues.map((i) => (
              <li key={i} className="neg">
                {i}
              </li>
            ))}
          </ul>
        )}
        {editable &&
          (adding ? (
            <form
              className="btn-row"
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                const amt = adding.residual ? null : parseMoneyInput(adding.amount);
                if (!adding.residual && amt === null) return;
                if (
                  run(
                    () =>
                      t.budget.addLine(view.version.id, {
                        categoryId: adding.categoryId,
                        label: adding.label,
                        kind: adding.residual ? 'residual' : 'amount',
                        monthlyAmount: amt,
                        fundingAccountId: adding.funding,
                      }),
                    'Line added',
                  ) !== undefined
                )
                  setAdding(null);
              }}
            >
              <select
                className="box"
                aria-label="New line category"
                value={adding.categoryId}
                onChange={(e) => setAdding({ ...adding, categoryId: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="box"
                placeholder="Item"
                aria-label="New line label"
                value={adding.label}
                onChange={(e) => setAdding({ ...adding, label: e.target.value })}
              />
              <input
                className="box num"
                placeholder="Monthly"
                aria-label="New line amount"
                disabled={adding.residual}
                value={adding.amount}
                onChange={(e) => setAdding({ ...adding, amount: e.target.value })}
                style={{ width: 110 }}
              />
              <select
                className="box"
                aria-label="New line funding account"
                value={adding.funding}
                onChange={(e) => setAdding({ ...adding, funding: e.target.value })}
              >
                <option value="">Funded by…</option>
                {accounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code}
                    </option>
                  ))}
              </select>
              <label className="small">
                <input
                  type="checkbox"
                  checked={adding.residual}
                  onChange={(e) => setAdding({ ...adding, residual: e.target.checked })}
                />{' '}
                Remainder
              </label>
              <button className="btn small primary">Add</button>
              <button type="button" className="btn small" onClick={() => setAdding(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                className="btn small"
                onClick={() =>
                  setAdding({
                    categoryId: categories[0]?.id ?? '',
                    label: '',
                    amount: '',
                    funding: '',
                    residual: false,
                  })
                }
                disabled={!categories.length}
              >
                + Line
              </button>
              <form
                className="btn-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (run(() => t.budget.addCategory(newCat), `Category ${newCat} added`)) setNewCat('');
                }}
              >
                <input
                  className="box"
                  placeholder="New category"
                  aria-label="New category"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                />
                <button className="btn small" disabled={!newCat.trim()}>
                  Add category
                </button>
              </form>
            </div>
          ))}
      </Panel>
      <div>
        <Panel title="Funding by treasury account">
          <table className="t" aria-label="Funding by account">
            <thead>
              <tr>
                <th className="l">Account</th>
                <th className="num">Monthly</th>
                <th className="num">% of take-home</th>
              </tr>
            </thead>
            <tbody>
              {b.byFundingAccount.map((f) => (
                <tr key={f.accountId}>
                  <td className="code">{code(f.accountId)}</td>
                  <td className="num">
                    <Amount value={f.amount} />
                  </td>
                  <td className="num small">
                    {dec(b.takeHome).isZero()
                      ? '—'
                      : `${dec(f.amount).div(dec(b.takeHome)).times(100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">
                  <Amount value={b.totalAllocated} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="small subtle" style={{ marginBottom: 0 }}>
            These become the treasury month's budget allocations when a month is created or refreshed from
            this version.
          </p>
        </Panel>
        <Panel title="By category (purpose)">
          <table className="t">
            <tbody>
              {b.byCategory.map((c) => (
                <tr key={c.categoryId}>
                  <td>{catName(c.categoryId)}</td>
                  <td className="num">
                    <Amount value={c.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tax rules editor
// ---------------------------------------------------------------------------

function TaxRules() {
  const { t, run } = useTreasury();
  const sets = t.budget.ruleSets();
  const years = [...new Set(sets.map((s) => s.taxYear))].sort((a, b) => b - a);
  const [year, setYear] = useState<number | null>(null);
  const [copyTo, setCopyTo] = useState('');
  const selected = year ?? years[0] ?? new Date().getFullYear();
  return (
    <>
      <Panel
        title="Tax years"
        actions={
          <form
            className="btn-row"
            onSubmit={(e) => {
              e.preventDefault();
              const to = Number.parseInt(copyTo, 10);
              if (
                run(() => t.budget.copyTaxYear(selected, to), `Copied ${selected} rules to ${to}`) !==
                undefined
              ) {
                setYear(to);
                setCopyTo('');
              }
            }}
          >
            <span className="small">Copy {selected} to</span>
            <input
              className="box"
              style={{ width: 80 }}
              aria-label="Copy to year"
              placeholder="year"
              value={copyTo}
              onChange={(e) => setCopyTo(e.target.value)}
            />
            <button className="btn small" disabled={!/^\d{4}$/.test(copyTo)}>
              Copy
            </button>
          </form>
        }
      >
        <div className="tabs" role="group" aria-label="Tax year">
          {years.map((y) => (
            <button key={y} aria-pressed={y === selected} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
          {!years.includes(selected) && <button aria-pressed>{selected}</button>}
        </div>
        <p className="small subtle" style={{ marginBottom: 0 }}>
          Rates, brackets, deductions and wage bases are stored per tax year. “Rates from” records which
          year's published figures are in use; provisional years are flagged on every estimate. Single filer.
        </p>
      </Panel>
      {JURISDICTIONS.map((j) => (
        <RuleSetEditor
          key={`${selected}-${j}-${sets.find((s) => s.taxYear === selected && s.jurisdiction === j)?.id ?? 'new'}`}
          year={selected}
          jurisdiction={j}
          existing={sets.find((s) => s.taxYear === selected && s.jurisdiction === j)}
        />
      ))}
    </>
  );
}

type Draft = {
  ratesFromYear: string;
  provisional: boolean;
  sourceNote: string;
  fields: Record<string, string>;
  brackets: { threshold: string; rate: string }[];
  credits: { label: string; amount: string }[];
};

function RuleSetEditor({
  year,
  jurisdiction,
  existing,
}: {
  year: number;
  jurisdiction: Jurisdiction;
  existing?: TaxRuleSet;
}) {
  const { t, run } = useTreasury();
  const r = (existing?.rules ?? {}) as Record<string, unknown>;
  const initial = (): Draft => ({
    ratesFromYear: String(existing?.ratesFromYear ?? year),
    provisional: existing?.provisional ?? false,
    sourceNote: existing?.sourceNote ?? '',
    fields: Object.fromEntries(
      Object.entries(r)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, /rate$/i.test(k) ? normalize(dec(v as string).times(100)) : (v as string)]),
    ),
    brackets: ((r.brackets as Bracket[] | undefined) ?? [{ threshold: '0', rate: '0' }]).map((b) => ({
      threshold: b.threshold,
      rate: normalize(dec(b.rate).times(100)),
    })),
    credits: ((r.credits as { label: string; amount: string }[] | undefined) ?? []).map((c) => ({ ...c })),
  });
  const [d, setD] = useState<Draft>(initial);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial());
  const field = (key: string, label: string, isRate = false) => (
    <Field label={`${label}${isRate ? ' (%)' : ''}`}>
      <input
        className={`box num${d.fields[key] && !isMoney(d.fields[key]) ? ' invalid' : ''}`}
        aria-label={`${JURISDICTION_LABEL[jurisdiction]} ${label}`}
        value={d.fields[key] ?? ''}
        onChange={(e) => setD({ ...d, fields: { ...d.fields, [key]: e.target.value.trim() } })}
      />
    </Field>
  );
  const save = () => {
    const rateKeys = new Set([
      'socialSecurityRate',
      'medicareRate',
      'additionalMedicareRate',
      'mentalHealthServicesRate',
    ]);
    const fields = Object.fromEntries(
      Object.entries(d.fields)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => [k, rateKeys.has(k) && isMoney(v) ? normalize(dec(v).div(100)) : v]),
    );
    const rules =
      jurisdiction === 'fica'
        ? fields
        : {
            ...fields,
            brackets: d.brackets.map((b) => ({
              threshold: b.threshold,
              rate: isMoney(b.rate) ? normalize(dec(b.rate).div(100)) : b.rate,
            })),
            ...(jurisdiction === 'federal' ? { credits: d.credits } : {}),
          };
    run(
      () =>
        t.budget.saveRuleSet({
          taxYear: year,
          jurisdiction,
          ratesFromYear: Number.parseInt(d.ratesFromYear, 10),
          provisional: d.provisional,
          rules,
          sourceNote: d.sourceNote || null,
        }),
      `${year} ${JURISDICTION_LABEL[jurisdiction]} saved`,
    );
  };
  return (
    <Panel
      title={
        <span>
          {JURISDICTION_LABEL[jurisdiction]} — {year}{' '}
          {existing?.provisional && (
            <span className="badge warn">Provisional: {existing.ratesFromYear} rates</span>
          )}{' '}
          {!existing && <span className="badge review">Not set</span>}
        </span>
      }
      actions={
        <span className="btn-row">
          {dirty && (
            <button className="btn small" onClick={() => setD(initial())}>
              Discard
            </button>
          )}
          <button className="btn small primary" disabled={!dirty} onClick={save}>
            Save
          </button>
        </span>
      }
    >
      <div className="form-grid" style={{ '--cols': 'repeat(4, minmax(0, 1fr))' } as CSSProperties}>
        <Field label="Rates from year">
          <input
            className="box"
            aria-label={`${JURISDICTION_LABEL[jurisdiction]} rates from year`}
            value={d.ratesFromYear}
            onChange={(e) => setD({ ...d, ratesFromYear: e.target.value })}
          />
        </Field>
        <Field label="Provisional">
          <label className="small">
            <input
              type="checkbox"
              checked={d.provisional}
              onChange={(e) => setD({ ...d, provisional: e.target.checked })}
            />{' '}
            Flag on estimates
          </label>
        </Field>
        <Field label="Source note" wide>
          <input
            className="box"
            value={d.sourceNote}
            onChange={(e) => setD({ ...d, sourceNote: e.target.value })}
          />
        </Field>
        {jurisdiction === 'federal' && field('standardDeduction', 'Standard deduction')}
        {jurisdiction === 'california' && (
          <>
            {field('standardDeduction', 'Standard deduction')}
            {field('exemptionCredit', 'Personal exemption credit')}
            {field('mentalHealthServicesThreshold', 'Mental Health Services threshold')}
            {field('mentalHealthServicesRate', 'Mental Health Services rate', true)}
          </>
        )}
        {jurisdiction === 'fica' && (
          <>
            {field('socialSecurityRate', 'Social Security rate', true)}
            {field('socialSecurityWageBase', 'Social Security wage base')}
            {field('medicareRate', 'Medicare rate', true)}
            {field('additionalMedicareRate', 'Additional Medicare rate', true)}
            {field('additionalMedicareThreshold', 'Additional Medicare threshold')}
          </>
        )}
      </div>
      {jurisdiction !== 'fica' && (
        <table
          className="t"
          style={{ marginTop: 10, maxWidth: 520 }}
          aria-label={`${JURISDICTION_LABEL[jurisdiction]} brackets`}
        >
          <thead>
            <tr>
              <th className="l">Taxable income over</th>
              <th className="num">Rate (%)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.brackets.map((b, i) => (
              <tr key={i}>
                <td>
                  <input
                    className={`cell num${!isMoney(b.threshold) ? ' invalid' : ''}`}
                    aria-label={`Bracket ${i + 1} threshold`}
                    value={b.threshold}
                    onChange={(e) =>
                      setD({
                        ...d,
                        brackets: d.brackets.map((x, k) =>
                          k === i ? { ...x, threshold: e.target.value.trim() } : x,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className={`cell num${!isMoney(b.rate) ? ' invalid' : ''}`}
                    aria-label={`Bracket ${i + 1} rate`}
                    value={b.rate}
                    onChange={(e) =>
                      setD({
                        ...d,
                        brackets: d.brackets.map((x, k) =>
                          k === i ? { ...x, rate: e.target.value.trim() } : x,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    className="btn small danger"
                    disabled={d.brackets.length <= 1}
                    aria-label="Remove bracket"
                    onClick={() => setD({ ...d, brackets: d.brackets.filter((_, k) => k !== i) })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <button
                  className="btn small"
                  onClick={() => setD({ ...d, brackets: [...d.brackets, { threshold: '', rate: '' }] })}
                >
                  + Bracket
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {jurisdiction === 'federal' && (
        <div style={{ marginTop: 10 }}>
          <b className="small">Credits</b>
          {d.credits.map((c, i) => (
            <div key={i} className="btn-row" style={{ marginTop: 4 }}>
              <input
                className="box"
                value={c.label}
                aria-label={`Credit ${i + 1} label`}
                onChange={(e) =>
                  setD({
                    ...d,
                    credits: d.credits.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)),
                  })
                }
              />
              <input
                className="box num"
                value={c.amount}
                aria-label={`Credit ${i + 1} amount`}
                onChange={(e) =>
                  setD({
                    ...d,
                    credits: d.credits.map((x, k) => (k === i ? { ...x, amount: e.target.value.trim() } : x)),
                  })
                }
              />
              <button
                className="btn small danger"
                onClick={() => setD({ ...d, credits: d.credits.filter((_, k) => k !== i) })}
                aria-label="Remove credit"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn small"
            style={{ marginTop: 4 }}
            onClick={() => setD({ ...d, credits: [...d.credits, { label: '', amount: '' }] })}
          >
            + Credit
          </button>
        </div>
      )}
      {existing?.sourceNote && (
        <p className="small subtle" style={{ marginBottom: 0 }}>
          {existing.sourceNote}
        </p>
      )}
    </Panel>
  );
}
