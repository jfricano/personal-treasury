import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { Amount, Panel } from '@/components/ui';
import { analyzeBudgetWorkbook, type BudgetImportPlan } from '@/import/budget/analyzeBudget';
import { SEVERITY_ORDER } from '@/import/report';
import { monthLabel } from '@/domain/monthly';
import { pickFile } from '@/platform/files';

type State =
  | { step: 'idle' }
  | { step: 'analyzing'; name: string }
  | { step: 'preview'; plan: BudgetImportPlan }
  | { step: 'done'; plan: BudgetImportPlan; message: string; ok: boolean };

export function BudgetImportPanel() {
  const { t, toast, navigate } = useTreasury();
  const [s, setS] = useState<State>({ step: 'idle' });
  const [activate, setActivate] = useState(true);
  const [replaceTax, setReplaceTax] = useState(false);

  const choose = async () => {
    const f = await pickFile(['.xlsx', '.xlsm']);
    if (!f) return;
    setS({ step: 'analyzing', name: f.name });
    // Compare budget funding with the most recent treasury month, when there is one.
    const months = t.months();
    const last = months[months.length - 1];
    const treasuryReference = last
      ? {
          month: last.month,
          allocations: Object.fromEntries(
            t.repos.listAllocations(last.id).map((a) => [t.codeOf(a.accountId), a.budgetAmount]),
          ),
        }
      : null;
    try {
      const plan = await analyzeBudgetWorkbook(f.bytes, f.name, {
        committedHashes: t.committedHashes(),
        treasuryReference,
      });
      setActivate(true);
      setReplaceTax(false);
      setS({ step: 'preview', plan });
    } catch (err) {
      toast(`Could not analyze ${f.name}: ${(err as Error).message}`, 'error');
      setS({ step: 'idle' });
    }
  };

  const commit = async (plan: BudgetImportPlan) => {
    try {
      const r = await t.budget.commitImport(plan, { activate, replaceTaxRules: replaceTax });
      setS({
        step: 'done',
        plan,
        ok: true,
        message: `Imported ${r.versionIds.length} budget version(s).${r.skippedTaxRules.length ? ` Kept existing tax rules for ${r.skippedTaxRules.join(', ')}.` : ''}`,
      });
      toast('Budget imported', 'success');
    } catch (err) {
      setS({
        step: 'done',
        plan,
        ok: false,
        message: `Rolled back — nothing was saved. ${(err as Error).message}`,
      });
    }
  };

  const existingTax = t.budget.ruleSets().length > 0;
  return (
    <Panel
      title="Import budget workbook"
      actions={
        s.step === 'preview' || s.step === 'done' ? (
          <button className="btn small" onClick={() => setS({ step: 'idle' })}>
            Start over
          </button>
        ) : null
      }
    >
      {s.step === 'idle' && (
        <div className="btn-row">
          <button className="btn primary" onClick={choose}>
            Choose budget workbook…
          </button>
          <span className="subtle">
            Personal Budget.xlsx: plan, payroll, withholding, tax rules and budget history. Treasury data is
            not changed.
          </span>
        </div>
      )}
      {s.step === 'analyzing' && <p role="status">Analyzing {s.name}…</p>}
      {(s.step === 'preview' || s.step === 'done') && (
        <>
          {s.step === 'done' && (
            <p className={s.ok ? '' : 'err'} role="status">
              {s.message}
            </p>
          )}
          <BudgetPlanView plan={s.plan} />
          {s.step === 'preview' && (
            <div className="btn-row" style={{ marginTop: 10 }}>
              <label>
                <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />{' '}
                Make the workbook's current plan the active budget
              </label>
              {existingTax && (
                <label>
                  <input
                    type="checkbox"
                    checked={replaceTax}
                    onChange={(e) => setReplaceTax(e.target.checked)}
                  />{' '}
                  Replace existing tax rules for the same year
                </label>
              )}
              <button className="btn primary" disabled={s.plan.fatal} onClick={() => commit(s.plan)}>
                Commit budget import
              </button>
            </div>
          )}
          {s.step === 'done' && s.ok && (
            <button
              className="btn primary"
              style={{ marginTop: 10 }}
              onClick={() => navigate({ page: 'budget' })}
            >
              Open budget
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function BudgetPlanView({ plan }: { plan: BudgetImportPlan }) {
  const failed = plan.controls.filter((c) => !c.pass);
  return (
    <div aria-label="Budget import preview">
      <div className="strip">
        <div>
          <div className="k">Workbook</div>
          <div className="v" style={{ fontSize: 14 }}>
            {plan.filename}
          </div>
        </div>
        <div>
          <div className="k">Versions</div>
          <div className="v">{plan.versions.length}</div>
        </div>
        <div>
          <div className="k">Budget lines</div>
          <div className="v">{plan.counts.budgetLines}</div>
        </div>
        <div>
          <div className="k">Tax rule sets</div>
          <div className="v">{plan.taxRuleSets.length}</div>
        </div>
        <div>
          <div className="k">Controls</div>
          <div className={`v${failed.length ? ' neg' : ''}`} data-testid="budget-controls-result">
            {failed.length ? `${failed.length} failed` : `All ${plan.controls.length} pass`}
          </div>
        </div>
      </div>
      <table className="t" aria-label="Budget versions to import">
        <thead>
          <tr>
            <th className="l">Version</th>
            <th className="l">Imported as</th>
            <th className="l">In effect</th>
            <th className="l">Detail</th>
            <th className="num">Take-home</th>
          </tr>
        </thead>
        <tbody>
          {plan.versions.map((v) => (
            <tr key={v.label}>
              <td>{v.label}</td>
              <td>{v.status === 'active' ? 'Current plan' : 'History'}</td>
              <td>
                {v.effectiveFrom
                  ? `${monthLabel(v.effectiveFrom)} → ${v.effectiveTo ? monthLabel(v.effectiveTo) : 'present'}`
                  : '—'}
              </td>
              <td>
                {v.detailLevel === 'full'
                  ? `${v.lines.length} lines, ${v.deductions.length} deductions`
                  : `${v.summaryRows.length} summary rows`}
              </td>
              <td className="num">
                {(() => {
                  const th = v.summaryRows.find((r) => /take-home/i.test(r.description))?.monthlyAmount;
                  return th ? (
                    <Amount value={th} />
                  ) : v.detailLevel === 'full' ? (
                    <span className="small subtle">calculated</span>
                  ) : (
                    '—'
                  );
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="sec" open style={{ marginTop: 10 }}>
        <summary>Control comparison ({plan.controls.length})</summary>
        <div className="body">
          <table className="t" aria-label="Budget control comparison">
            <thead>
              <tr>
                <th className="l">Control</th>
                <th className="num">Workbook</th>
                <th className="num">App</th>
                <th className="l">Result</th>
              </tr>
            </thead>
            <tbody>
              {plan.controls.map((c, i) => (
                <tr key={i}>
                  <td>
                    {c.group} · {c.name}
                  </td>
                  <td className="num">{c.expected ?? '—'}</td>
                  <td className="num">{c.actual}</td>
                  <td>
                    {c.pass ? (
                      <span className="badge complete">Pass</span>
                    ) : (
                      <span className="badge review">Fail{c.detail ? ` — ${c.detail}` : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="sec">
        <summary>Warnings ({plan.warnings.length})</summary>
        <div className="body">
          <ul className="warn-list">
            {SEVERITY_ORDER.flatMap((sev) => plan.warnings.filter((w) => w.severity === sev)).map((w, i) => (
              <li key={i} className="small">
                <span
                  className={`badge ${w.severity === 'high' || w.severity === 'fatal' ? 'review' : w.severity === 'warning' ? 'warn' : 'neutral'}`}
                >
                  {w.severity}
                </span>{' '}
                <span className="loc">
                  {w.sheet ? `${w.sheet}${w.cell ? `!${w.cell}` : ''}` : 'workbook'}
                </span>{' '}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
