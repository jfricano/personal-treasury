import * as XLSX from 'xlsx';
import {
  reportTotals,
  reportGroups,
  lineYearToDate,
  variance,
  yearToDate,
  type Report,
  type Review,
} from '@/domain/spending';
/** Explicit string cells prevent formula execution. Exported numbers are display copies of exact decimal records. */
export function exportSpendingReport(report: Report, reports: Report[] = [], working?: Review): Uint8Array {
  const book = XLSX.utils.book_new(),
    totals = reportTotals(report),
    ytd = yearToDate(reports, report.month);
  const previous = reports
    .filter((r) => r.month < report.month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const sheet = (name: string, rows: (string | number | null)[][], moneyColumns: number[] = []) => {
    const s = XLSX.utils.aoa_to_sheet(rows);
    s['!cols'] = rows[0].map(() => ({ wch: 24 }));
    for (let row = 1; row < rows.length; row++)
      for (const col of moneyColumns) {
        const cell = s[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell?.t === 'n') cell.z = '#,##0.00;[Red]-#,##0.00';
      }
    XLSX.utils.book_append_sheet(book, s, name);
  };
  sheet(
    'Summary',
    [
      ['Spending report', report.month],
      ['Budget', report.budgetLabel],
      [
        working ? 'Working copy' : 'Cleared',
        working ? 'Not cleared; accepted classifications only' : report.clearedAt,
      ],
      ['Time zone', report.timeZone],
      ['App version', report.appVersion],
      ['Planned spending', Number(totals.planned)],
      ['Actual spending', Number(totals.actual)],
      ['Take-home', Number(report.income.takeHome)],
      ['Other income', Number(report.income.other)],
      ['Assets', Number(totals.assets)],
      ['Liabilities', Number(totals.liabilities)],
      ['Net worth', Number(totals.netWorth)],
      ['Net worth change', previous ? Number(sub(totals.netWorth, reportTotals(previous).netWorth)) : null],
      ['YTD planned', Number(ytd.planned)],
      ['YTD actual', Number(ytd.actual)],
      ['YTD missing months', ytd.missing.join(', ')],
      ['Coverage', report.sources.map((s) => `${s.label}: ${s.status}`).join('; ')],
      ['Note', report.note],
    ],
    [1],
  );
  sheet(
    'Lines',
    [
      [
        'Category',
        'Line',
        'Funding account',
        'Role',
        'Planned',
        'Actual',
        'Over / under',
        'Status',
        'YTD planned',
        'YTD actual',
        'Count',
        'Note',
      ],
      ...report.lines.map((l) => {
        const cumulative = lineYearToDate(reports, report.month, l.lineKey);
        return [
          l.category,
          l.label,
          l.fundingAccount,
          l.role,
          Number(l.planned),
          Number(l.actual),
          Number(variance(l.actual, l.planned).over),
          variance(l.actual, l.planned).status,
          Number(cumulative.planned),
          Number(cumulative.actual),
          l.count,
          l.note,
        ];
      }),
    ],
    [4, 5, 6, 8, 9],
  );
  for (const [name, key] of [
    ['Categories', 'category'],
    ['Funding accounts', 'fundingAccount'],
  ] as const)
    sheet(
      name,
      [
        ['Name', 'Role', 'Planned', 'Actual', 'Over / under'],
        ...reportGroups(report, key).map((g) => [
          g.label,
          g.role,
          Number(g.planned),
          Number(g.actual),
          Number(sub(g.actual, g.planned)),
        ]),
      ],
      [2, 3, 4],
    );
  sheet(
    'Coverage',
    [
      [
        'Account',
        'Kind',
        'Source',
        'Status',
        'Waiver',
        'History confirmed',
        'Source windows',
        'Count',
        'Inflows',
        'Outflows',
        'Final week count',
        'Final week sum',
      ],
      ...report.sources.map((s) => [
        s.label,
        s.kind,
        s.source,
        s.status,
        s.waiver,
        s.historyConfirmed ? 'Yes' : 'No',
        s.periods.map((p) => `${p.start} to ${p.end}`).join('; '),
        s.count,
        Number(s.inflows),
        Number(s.outflows),
        s.tailCount,
        Number(s.tailSum),
      ]),
    ],
    [8, 9, 11],
  );
  sheet(
    'Transfers and exclusions',
    [['Disposition', 'Count', 'Total'], ...report.flows.map((f) => [f.kind, f.count, Number(f.total)])],
    [2],
  );
  sheet(
    'Assets and liabilities',
    [
      [
        'Account',
        'Kind',
        'Value',
        'As of',
        'Method',
        'Statement balance',
        'Minimum payment',
        'APR',
        'Due date',
        'Original principal',
        'Detail source',
        'Captured at',
        'Balance source',
      ],
      ...report.balances.map((b) => [
        b.label,
        b.kind,
        b.value === null ? null : Number(b.value),
        b.asOf,
        b.unavailable ? 'Unavailable' : b.estimate ? 'Estimate' : 'As of',
        b.details?.statementBalance ? Number(b.details.statementBalance) : null,
        b.details?.minimumPayment ? Number(b.details.minimumPayment) : null,
        b.details?.apr ?? '',
        b.details?.dueDate ?? '',
        b.details?.originalPrincipal ? Number(b.details.originalPrincipal) : null,
        b.details?.source ?? '',
        b.capturedAt ?? '',
        b.source ?? '',
      ]),
    ],
    [2, 5, 6, 9],
  );
  if (working)
    sheet(
      'Transactions',
      [
        ['Date', 'Account', 'Description', 'Amount', 'Disposition', 'State', 'Budget lines'],
        ...working.transactions.map((t) => [
          t.postedDate,
          report.sources.find((s) => s.accountId === t.institutionAccountId)?.label ?? t.institutionAccountId,
          t.description,
          Number(t.amount),
          t.disposition?.kind ?? 'Unclassified',
          t.disposition?.state ?? '',
          t.disposition?.kind === 'budget'
            ? t.disposition.parts
                .map(
                  (p) =>
                    `${report.lines.find((l) => l.lineKey === p.lineKey)?.label ?? p.lineKey}: ${p.amount}`,
                )
                .join('; ')
            : '',
        ]),
      ],
      [3],
    );
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}
import { sub } from '@/domain/money';
