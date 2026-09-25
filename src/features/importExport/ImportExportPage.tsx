import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { Field, Panel, useConfirm } from '@/components/ui';
import { analyzeWorkbook } from '@/import/analyze';
import type { ImportPlan } from '@/import/plan';
import { SEVERITY_ORDER, reportJson, reportMarkdown, type ReportOutcome } from '@/import/report';
import { exportWorkbook } from '@/export/workbook';
import {
  buildDatabaseFromBackup,
  createBackup,
  readBackup,
  type BackupFile,
  type RestoreSummary,
} from '@/export/backup';
import { loadSqlJs } from '@/db/driver';
import { pickFile, saveFile, stamp } from '@/platform/files';
import { BudgetImportPanel } from './BudgetImportPanel';

type ImportState =
  | { step: 'idle' }
  | { step: 'analyzing'; name: string }
  | { step: 'preview'; plan: ImportPlan }
  | { step: 'committing'; plan: ImportPlan }
  | { step: 'done'; plan: ImportPlan; outcome: ReportOutcome };

export function ImportExportPage() {
  const { t, toast, navigate, switchProfile, extras } = useTreasury();
  // The public demo has a single database per browser tab, so there are no profiles to restore into.
  const demo = t.storage.kind === 'session';
  const where = demo ? 'this demo' : `profile “${t.profile}”`;
  const [imp, setImp] = useState<ImportState>({ step: 'idle' });
  const [replaceOk, setReplaceOk] = useState(false);
  const [restore, setRestore] = useState<{
    name: string;
    backup: BackupFile;
    summary: RestoreSummary;
    profile: string;
  } | null>(null);
  const confirm = useConfirm();

  const choose = async () => {
    try {
      const f = await pickFile(['.xlsx', '.xlsm', '.xls']);
      if (!f) return;
      setImp({ step: 'analyzing', name: f.name });
      const plan = await analyzeWorkbook(f.bytes, f.name, {
        existingAliases: t.existingAliasesForImport(),
        committedHashes: t.committedHashes(),
      });
      setImp({ step: 'preview', plan });
      setReplaceOk(false);
    } catch (err) {
      toast(`Could not analyze workbook: ${(err as Error).message}`, 'error');
      setImp({ step: 'idle' });
    }
  };

  const commit = async (plan: ImportPlan) => {
    setImp({ step: 'committing', plan });
    try {
      const res = await t.commitImport(plan, t.isEmpty() ? 'empty' : 'replace');
      setImp({
        step: 'done',
        plan,
        outcome: { committed: true, runId: res.runId, safetyCopy: res.safetyCopy },
      });
      toast('Import committed', 'success');
    } catch (err) {
      setImp({ step: 'done', plan, outcome: { committed: false, error: (err as Error).message } });
      toast(`Import rolled back: ${(err as Error).message}`, 'error');
    }
  };

  const exportXlsx = async () => {
    try {
      if (
        await saveFile(
          `Personal Treasury export ${stamp()}.xlsx`,
          exportWorkbook(t),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
      )
        toast('Workbook exported', 'success');
    } catch (err) {
      toast(`Export failed; nothing was changed: ${(err as Error).message}`, 'error');
    }
  };
  const exportJson = async () => {
    try {
      if (
        await saveFile(
          `personal-treasury-backup-${stamp()}.json`,
          JSON.stringify(createBackup(t.db), null, 1),
          'application/json',
        )
      )
        toast('Backup saved', 'success');
    } catch (err) {
      toast(`Backup failed: ${(err as Error).message}`, 'error');
    }
  };
  const chooseBackup = async () => {
    try {
      const f = await pickFile(['.json']);
      if (!f) return;
      const { backup, summary } = readBackup(new TextDecoder().decode(f.bytes));
      setRestore({ name: f.name, backup, summary, profile: `restored-${stamp()}` });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const restoreNew = async () => {
    if (!restore) return;
    try {
      const name = restore.profile.trim();
      if (!/^[\w.-]+$/.test(name))
        throw new Error('Profile names may use letters, numbers, dot, dash and underscore.');
      if ((await t.storage.list()).includes(name)) throw new Error(`Profile ${name} already exists.`);
      const bytes = buildDatabaseFromBackup(await loadSqlJs(), restore.backup);
      await t.storage.save(name, bytes);
      toast(`Restored into profile ${name}`, 'success');
      switchProfile(name);
    } catch (err) {
      toast(`Restore failed; nothing was changed: ${(err as Error).message}`, 'error');
    }
  };
  const restoreReplace = async () => {
    if (!restore) return;
    const ok = await confirm.ask(
      <>
        Replace everything in {where} with this backup? A safety copy of the current database is saved first.
      </>,
      { danger: true, confirmLabel: 'Replace current data' },
    );
    if (!ok) return;
    try {
      const bytes = buildDatabaseFromBackup(await loadSqlJs(), restore.backup);
      const copy = await t.saveSafetyCopy('before-restore');
      t.replaceDatabase(bytes, `Restored backup ${restore.name}; safety copy ${copy}`);
      await t.flush();
      setRestore(null);
      toast('Backup restored', 'success');
      navigate({ page: 'dashboard' });
    } catch (err) {
      toast(`Restore failed; nothing was changed: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <>
      <div className="page-head">
        <h2>Import and export</h2>
        <span className="subtle">
          Files are only read or written when you choose them. The source workbook is never modified.
        </span>
      </div>

      <Panel
        title="Import treasury workbook"
        actions={
          imp.step !== 'idle' && imp.step !== 'analyzing' && imp.step !== 'committing' ? (
            <button className="btn small" onClick={() => setImp({ step: 'idle' })}>
              Start over
            </button>
          ) : null
        }
      >
        {imp.step === 'idle' && (
          <div className="btn-row">
            <button className="btn primary" onClick={choose}>
              Choose workbook…
            </button>
            <span className="subtle">The workbook is analyzed first. Nothing is saved until you commit.</span>
          </div>
        )}
        {imp.step === 'idle' && extras.sampleWorkbook && (
          <p className="small subtle" style={{ marginBottom: 0 }}>
            No workbook handy?{' '}
            <button
              className="btn link small"
              onClick={async () => {
                const wb = extras.sampleWorkbook!;
                try {
                  await saveFile(
                    wb.fileName,
                    await wb.build(),
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  );
                } catch (err) {
                  toast(`Download failed: ${(err as Error).message}`, 'error');
                }
              }}
            >
              Download the sample household's workbook
            </button>
            , then choose it above. To import into an empty database, use <b>Start blank</b> first.
          </p>
        )}
        {imp.step === 'analyzing' && <p role="status">Analyzing {imp.name}…</p>}
        {(imp.step === 'preview' || imp.step === 'committing') && (
          <>
            <PlanView plan={imp.plan} />
            <div className="btn-row" style={{ marginTop: 12 }}>
              {!t.isEmpty() && (
                <label>
                  <input
                    type="checkbox"
                    checked={replaceOk}
                    onChange={(e) => setReplaceOk(e.target.checked)}
                  />{' '}
                  Replace the data in {where} (a safety copy is saved first)
                </label>
              )}
              <button
                className="btn primary"
                disabled={imp.plan.fatal || imp.step === 'committing' || (!t.isEmpty() && !replaceOk)}
                onClick={() => commit(imp.plan)}
              >
                {imp.step === 'committing' ? 'Committing…' : 'Commit import'}
              </button>
              {imp.plan.fatal && (
                <span className="err">Fatal structural problems must be fixed in the workbook first.</span>
              )}
              <ReportButtons plan={imp.plan} outcome={{ committed: false }} />
            </div>
          </>
        )}
        {imp.step === 'done' && (
          <>
            <p className={imp.outcome.committed ? '' : 'err'} role="status">
              {imp.outcome.committed
                ? `Committed ${imp.plan.filename}. All derived values were recalculated from source events.`
                : `Rolled back — nothing was saved. ${imp.outcome.error}`}
              {imp.outcome.safetyCopy && (
                <span className="subtle"> Previous data saved as {imp.outcome.safetyCopy}.</span>
              )}
            </p>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              {imp.outcome.committed && (
                <button className="btn primary" onClick={() => navigate({ page: 'dashboard' })}>
                  Go to dashboard
                </button>
              )}
              <ReportButtons plan={imp.plan} outcome={imp.outcome} />
            </div>
            <PlanView plan={imp.plan} />
          </>
        )}
      </Panel>

      <BudgetImportPanel />

      <div className="grid-2">
        <Panel title="Export">
          <div className="btn-row">
            <button className="btn" onClick={exportXlsx} disabled={t.isEmpty()}>
              Excel workbook
            </button>
            <button className="btn" onClick={exportJson}>
              Complete JSON backup
            </button>
            <button className="btn" onClick={() => navigate({ page: 'monthly' })}>
              Journal CSV (per month)…
            </button>
            <button className="btn" onClick={() => navigate({ page: 'debts' })}>
              Debt events CSV…
            </button>
          </div>
          <p className="small subtle" style={{ marginBottom: 0 }}>
            The workbook contains Overview, Monthly Template, Account Ledger, one sheet per month, Interco
            Debt Summary and account/debt/month tables so it can be re-imported without loss. Excel stores
            numbers as doubles; the JSON backup keeps every decimal exactly.
          </p>
        </Panel>
        <Panel title="Restore JSON backup">
          {!restore ? (
            <button className="btn" onClick={chooseBackup}>
              Choose backup…
            </button>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                <b>{restore.name}</b> · schema v{restore.summary.schemaVersion} · exported{' '}
                {restore.summary.exportedAt.slice(0, 19).replace('T', ' ')}
              </p>
              <p className="small">
                {Object.entries(restore.summary.counts)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`)
                  .join(' · ')}
              </p>
              {!demo && (
                <div className="form-grid">
                  <Field label="New profile name">
                    <input
                      className="box"
                      aria-label="New profile name"
                      value={restore.profile}
                      onChange={(e) => setRestore({ ...restore, profile: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              <div className="btn-row" style={{ marginTop: 10 }}>
                {!demo && (
                  <button className="btn primary" onClick={restoreNew}>
                    Restore into new profile
                  </button>
                )}
                <button className="btn danger" onClick={restoreReplace}>
                  {demo ? 'Replace demo data…' : 'Replace current profile…'}
                </button>
                <button className="btn" onClick={() => setRestore(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </Panel>
      </div>

      <ImportHistory />
      {confirm.element}
    </>
  );
}

function ReportButtons({ plan, outcome }: { plan: ImportPlan; outcome: ReportOutcome }) {
  const base = plan.filename.replace(/\.[^.]+$/, '');
  return (
    <>
      <button
        className="btn small"
        onClick={() => saveFile(`${base} import report.md`, reportMarkdown(plan, outcome), 'text/markdown')}
      >
        Report (Markdown)
      </button>
      <button
        className="btn small"
        onClick={() => saveFile(`${base} import report.json`, reportJson(plan, outcome), 'application/json')}
      >
        Report (JSON)
      </button>
    </>
  );
}

function PlanView({ plan }: { plan: ImportPlan }) {
  const failed = plan.controls.filter((c) => !c.pass);
  const recognized = plan.sheets.filter((s) => s.role !== 'ignored');
  const ignored = plan.sheets.filter((s) => s.role === 'ignored');
  const debtCtl = plan.controls.filter(
    (c) => c.group === 'Interco Debt Summary' || c.group === 'Overview' || c.group === 'Debts',
  );
  return (
    <div aria-label="Import preview">
      <div className="strip">
        <div>
          <div className="k">Workbook</div>
          <div className="v" style={{ fontSize: 14 }}>
            {plan.filename}
          </div>
          <div className="loc">SHA-256 {plan.hash.slice(0, 16)}…</div>
        </div>
        <div>
          <div className="k">Sheets</div>
          <div className="v">
            {recognized.length} recognized{ignored.length ? `, ${ignored.length} ignored` : ''}
          </div>
        </div>
        <div>
          <div className="k">Accounts / aliases</div>
          <div className="v">
            {plan.counts.accounts} / {plan.counts.aliases}
          </div>
        </div>
        <div>
          <div className="k">Months / entries</div>
          <div className="v">
            {plan.counts.months} / {plan.counts.journalEntries}
          </div>
        </div>
        <div>
          <div className="k">Debts / events</div>
          <div className="v">
            {plan.counts.debts} / {plan.counts.debtEvents}
          </div>
        </div>
        <div>
          <div className="k">Controls</div>
          <div className={`v${failed.length ? ' neg' : ''}`} data-testid="controls-result">
            {failed.length ? `${failed.length} failed` : `All ${plan.controls.length} pass`}
          </div>
        </div>
      </div>

      <details className="sec" open>
        <summary>Current control comparison</summary>
        <div className="body">
          <table className="t" aria-label="Control comparison">
            <thead>
              <tr>
                <th className="l">Control</th>
                <th className="num">Workbook</th>
                <th className="num">App (recalculated)</th>
                <th className="l">Result</th>
              </tr>
            </thead>
            <tbody>
              {[...failed, ...debtCtl.filter((c) => c.pass)].map((c, i) => (
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
          <details style={{ marginTop: 6 }}>
            <summary className="small">All {plan.controls.length} controls</summary>
            <table className="t">
              <tbody>
                {plan.controls.map((c, i) => (
                  <tr key={i}>
                    <td className="small">
                      {c.group} · {c.name}
                    </td>
                    <td className="num small">{c.expected ?? '—'}</td>
                    <td className="num small">{c.actual}</td>
                    <td className="small">{c.pass ? 'Pass' : 'Fail'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </details>

      <details className="sec">
        <summary>Warnings ({plan.warnings.length})</summary>
        <div className="body">
          {SEVERITY_ORDER.map((sev) => {
            const ws = plan.warnings.filter((w) => w.severity === sev);
            if (!ws.length) return null;
            return (
              <details key={sev} open={sev === 'fatal' || sev === 'high'}>
                <summary>
                  <span
                    className={`badge ${sev === 'fatal' || sev === 'high' ? 'review' : sev === 'warning' ? 'warn' : 'neutral'}`}
                  >
                    {sev}
                  </span>{' '}
                  {ws.length}
                </summary>
                <ul className="warn-list">
                  {ws.map((w, i) => (
                    <li key={i} className="small">
                      <span className="loc">
                        {w.sheet ? `${w.sheet}${w.cell ? `!${w.cell}` : ''}` : 'workbook'}
                      </span>{' '}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </details>

      <details className="sec">
        <summary>Sheets, accounts and aliases</summary>
        <div className="body">
          <ul className="warn-list">
            {plan.sheets.map((s) => (
              <li key={s.name} className="small">
                <b>{s.name}</b> — {s.detail}
              </li>
            ))}
          </ul>
          <p className="small">
            Accounts:{' '}
            {plan.accounts.map((a) => (
              <span key={a.code} className="pill">
                {a.code}
                {a.needsReview ? ' ⚠' : ''}
              </span>
            ))}
          </p>
          <p className="small">
            Aliases:{' '}
            {plan.aliases.map((a) => (
              <span key={a.alias} className="pill">
                {a.alias} → {a.targetCode}
              </span>
            ))}{' '}
            · applied {plan.aliasApplications.length} time(s)
          </p>
        </div>
      </details>

      <details className="sec">
        <summary>
          Months ({plan.months.length}) and debts ({plan.debts.length})
        </summary>
        <div className="body">
          <table className="t">
            <thead>
              <tr>
                <th className="l">Month</th>
                <th className="l">Format</th>
                <th className="num">Allocations</th>
                <th className="num">Entries</th>
                <th className="l">Imported as</th>
              </tr>
            </thead>
            <tbody>
              {plan.months.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{m.format === 'legacy_matrix' ? 'Legacy matrix' : 'Normalized'}</td>
                  <td className="num">{m.allocations.length}</td>
                  <td className="num">{m.entries.length}</td>
                  <td>{m.closed ? 'Closed history' : 'Open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            {plan.debts.length} Loan IDs with {plan.counts.debtEvents} events; repeated Loan IDs are treated
            as events on one debt.
          </p>
        </div>
      </details>
    </div>
  );
}

function ImportHistory() {
  const { t, run } = useTreasury();
  const runs = t.importRuns();
  if (!runs.length) return null;
  return (
    <Panel title="Import history">
      {runs.map((r) => {
        const ws = t.importWarnings(r.id);
        const open = ws.filter((w) => !w.resolved && (w.severity === 'high' || w.severity === 'warning'));
        return (
          <details className="sec" key={r.id}>
            <summary>
              {r.filename} · {r.startedAt.slice(0, 16).replace('T', ' ')} ·{' '}
              {r.committed ? 'committed' : 'not committed'} · {open.length} open warning(s)
            </summary>
            <div className="body">
              <ul className="warn-list">
                {ws
                  .filter((w) => w.severity !== 'info')
                  .map((w) => (
                    <li key={w.id} className="small" style={w.resolved ? { opacity: 0.55 } : undefined}>
                      <label>
                        <input
                          type="checkbox"
                          checked={w.resolved}
                          onChange={(e) => run(() => t.resolveWarning(w.id, e.target.checked))}
                          aria-label="Mark reviewed"
                        />{' '}
                        <span className={`badge ${w.severity === 'high' ? 'review' : 'warn'}`}>
                          {w.severity}
                        </span>{' '}
                        <span className="loc">
                          {w.sheet}
                          {w.cell ? `!${w.cell}` : ''}
                        </span>{' '}
                        {w.message}
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          </details>
        );
      })}
    </Panel>
  );
}
