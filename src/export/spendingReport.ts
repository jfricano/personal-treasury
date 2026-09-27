import * as XLSX from 'xlsx';
import { reportTotals, variance, yearToDate, type Report, type Review } from '@/domain/spending';
/** SheetJS string cells remain text, including values starting with '='. */
export function exportSpendingReport(report: Report, reports: Report[] = [], working?: Review): Uint8Array {
  const book = XLSX.utils.book_new(),
    totals = reportTotals(report),
    ytd = yearToDate(reports, report.month);
  const sheet = (name: string, rows: (string | number | null)[][]) => {
    const s = XLSX.utils.aoa_to_sheet(rows);
    s['!cols'] = rows[0].map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(book, s, name);
  };
  sheet('Summary', [
    ['Spending report', report.month],
    ['Budget', report.budgetLabel],
    ['Cleared', report.clearedAt],
    ['Planned spending', Number(totals.planned)],
    ['Actual spending', Number(totals.actual)],
    ['Take-home', Number(report.income.takeHome)],
    ['Other income', Number(report.income.other)],
    ['Assets', Number(totals.assets)],
    ['Liabilities', Number(totals.liabilities)],
    ['Net worth', Number(totals.netWorth)],
    ['YTD missing months', ytd.missing.join(', ')],
    ['Note', report.note],
  ]);
  sheet('Lines', [
    [
      'Category',
      'Line',
      'Funding account',
      'Role',
      'Planned',
      'Actual',
      'Over / under',
      'Status',
      'Count',
      'Note',
    ],
    ...report.lines.map((l) => [
      l.category,
      l.label,
      l.fundingAccount,
      l.role,
      Number(l.planned),
      Number(l.actual),
      Number(variance(l.actual, l.planned).over),
      variance(l.actual, l.planned).status,
      l.count,
      l.note,
    ]),
  ]);
  for (const [name, key] of [
    ['Categories', 'category'],
    ['Funding accounts', 'fundingAccount'],
  ] as const) {
    const groups = new Map<string, { planned: string[]; actual: string[] }>();
    for (const l of report.lines) {
      const g = groups.get(l[key]) ?? { planned: [], actual: [] };
      g.planned.push(l.planned);
      g.actual.push(l.actual);
      groups.set(l[key], g);
    }
    sheet(name, [
      ['Name', 'Planned', 'Actual'],
      ...[...groups].map(([k, g]) => [k, Number(sum(g.planned)), Number(sum(g.actual))]),
    ]);
  }
  sheet('Coverage', [
    ['Account', 'Kind', 'Source', 'Status', 'Waiver', 'Count', 'Inflows', 'Outflows'],
    ...report.sources.map((s) => [
      s.label,
      s.kind,
      s.source,
      s.status,
      s.waiver,
      s.count,
      Number(s.inflows),
      Number(s.outflows),
    ]),
  ]);
  sheet('Transfers and exclusions', [
    ['Disposition', 'Count', 'Total'],
    ...report.flows.map((f) => [f.kind, f.count, Number(f.total)]),
  ]);
  sheet('Assets and liabilities', [
    ['Account', 'Kind', 'Value', 'As of', 'Method'],
    ...report.balances.map((b) => [
      b.label,
      b.kind,
      b.value === null ? null : Number(b.value),
      b.asOf,
      b.unavailable ? 'Unavailable' : b.estimate ? 'Estimate' : 'As of',
    ]),
  ]);
  if (working)
    sheet('Transactions', [
      ['Date', 'Account', 'Description', 'Amount', 'Disposition'],
      ...working.transactions.map((t) => [
        t.postedDate,
        t.institutionAccountId,
        t.description,
        Number(t.amount),
        t.disposition?.kind ?? 'Unclassified',
      ]),
    ]);
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}
import { sum } from '@/domain/money';
