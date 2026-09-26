import type { ImportPlan, Severity } from './plan';

export const SEVERITY_ORDER: Severity[] = ['fatal', 'high', 'warning', 'info'];

export interface ReportOutcome {
  committed: boolean;
  runId?: string;
  error?: string;
  safetyCopy?: string | null;
}

export function reportJson(plan: ImportPlan, outcome: ReportOutcome) {
  return JSON.stringify({ ...plan, outcome }, null, 2);
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function reportMarkdown(plan: ImportPlan, outcome: ReportOutcome): string {
  const lines: string[] = [];
  const accountName = (code: string) =>
    plan.accounts.find((account) => account.code === code)?.displayName || code;
  lines.push(`# Import report — ${plan.filename}`, '');
  lines.push(`- Analyzed: ${plan.analyzedAt}`);
  lines.push(`- SHA-256: \`${plan.hash}\``);
  lines.push(`- Recognizer: ${plan.recognizerVersion}`);
  lines.push(
    `- Outcome: ${outcome.committed ? `committed (run ${outcome.runId})` : outcome.error ? `rolled back — ${outcome.error}` : 'preview only (nothing written)'}`,
  );
  if (outcome.safetyCopy) lines.push(`- Safety copy of previous database: ${outcome.safetyCopy}`);
  lines.push('', '## Sheets', '', '| Sheet | Treatment |', '| --- | --- |');
  for (const s of plan.sheets) lines.push(`| ${esc(s.name)} | ${esc(s.detail)} |`);
  lines.push('', '## Imported counts', '', '| Entity | Count |', '| --- | ---: |');
  for (const [k, v] of Object.entries(plan.counts)) lines.push(`| ${k} | ${v} |`);
  lines.push(
    '',
    '## Accounts',
    '',
    plan.accounts
      .map((a) => `${a.displayName || a.code}${a.needsReview ? ' (needs review)' : ''}`)
      .join(', '),
  );
  lines.push('', '## Workbook account names matched', '');
  if (!plan.aliasApplications.length) lines.push('None.');
  for (const a of plan.aliasApplications)
    lines.push(`- ${a.sheet}!${a.cell}: “${a.original}” → ${accountName(a.code)}`);
  lines.push(
    '',
    '## Control comparisons',
    '',
    '| Group | Control | Workbook | App | Result |',
    '| --- | --- | ---: | ---: | --- |',
  );
  for (const c of plan.controls)
    lines.push(
      `| ${esc(c.group)} | ${esc(c.name)} | ${c.expected ?? '—'} | ${c.actual} | ${c.pass ? 'Pass' : `**Fail**${c.detail ? ` — ${esc(c.detail)}` : ''}`} |`,
    );
  lines.push('', '## Warnings', '');
  for (const sev of SEVERITY_ORDER) {
    const ws = plan.warnings.filter((w) => w.severity === sev);
    if (!ws.length) continue;
    lines.push(`### ${sev} (${ws.length})`, '');
    for (const w of ws)
      lines.push(
        `- \`${w.code}\` ${w.sheet ? `${w.sheet}${w.cell ? `!${w.cell}` : ''}` : '(workbook)'} — ${w.message}`,
      );
    lines.push('');
  }
  return lines.join('\n');
}
