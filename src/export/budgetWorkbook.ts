import * as XLSX from 'xlsx';
import type { Treasury } from '@/api/treasury';
import { dec } from '@/domain/money';
import { WITHHOLDING_COMPONENTS } from '@/domain/payroll';

/** The current, editable plan only. Summary links each category to its own sheet. */
export function exportBudgetWorkbook(t: Treasury): Uint8Array {
  const current = t.budget.activeVersion();
  if (!current) throw new Error('There is no active budget to export.');
  const view = t.budget.versionView(current.id);
  if (!view.payroll || !view.budget) throw new Error('The active budget has no detailed plan.');
  const budget = view.budget;
  const wb = XLSX.utils.book_new();
  const number = (value: string | null | undefined) => (value == null ? null : dec(value).toNumber());
  const add = (name: string, rows: unknown[][], widths: number[], moneyCols: number[] = []) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = widths.map((wch) => ({ wch }));
    for (const c of moneyCols)
      for (let r = 1; r < rows.length; r++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === 'n') cell.z = '#,##0.00;(#,##0.00)';
      }
    XLSX.utils.book_append_sheet(wb, sheet, name);
  };
  const categories = t.budget.categories();
  const used = new Set(['summary', 'payroll and tax']);
  const sheetName = (name: string) => {
    const base =
      name
        .replace(/[\\/?*:]/g, ' ')
        .replaceAll('[', ' ')
        .replaceAll(']', ' ')
        .trim()
        .slice(0, 31) || 'Category';
    let next = base;
    for (let n = 2; used.has(next.toLowerCase()); n++)
      next = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(next.toLowerCase());
    return next;
  };
  const tabs = categories.map((category) => ({ category, tab: sheetName(category.name) }));
  add(
    'Summary',
    [
      ['Personal Treasury Budget v1'],
      ['Budget', current.label],
      ['Effective from', current.effectiveFrom ?? ''],
      ['Tax year', current.taxYear ?? ''],
      ['Gross monthly', number(current.grossMonthly)],
      ['Take-home monthly', number(view.payroll.takeHome)],
      ['Total allocated', number(view.budget.totalAllocated)],
      ['Unallocated', number(view.budget.unallocated)],
      [],
      ['Category', 'Worksheet', 'Monthly total', 'Description'],
      ...tabs.map(({ category, tab }) => [
        category.name,
        tab,
        number(budget.byCategory.find((x) => x.categoryId === category.id)?.amount ?? '0'),
        category.description ?? '',
      ]),
    ],
    [30, 31, 18, 52],
    [1, 2],
  );
  const accounts = t.accountMap();
  for (const { category, tab } of tabs) {
    const lines = view.lines.filter((line) => line.categoryId === category.id);
    const rows: unknown[][] = [
      ['Budget category', category.name],
      ['Description', category.description ?? ''],
      [],
      [
        'Position',
        'Item',
        'Type',
        'Monthly amount',
        'Funding account',
        'Gross amount',
        'Notes',
        'Account key',
      ],
      ...lines.map((line) => {
        const account = line.fundingAccountId ? accounts.get(line.fundingAccountId) : null;
        return [
          line.position,
          line.label,
          line.kind,
          number(line.monthlyAmount),
          account?.displayName || account?.code || '',
          number(line.grossAmount),
          line.notes ?? '',
          account?.code ?? '',
        ];
      }),
    ];
    add(tab, rows, [10, 35, 12, 18, 28, 18, 50, 24], [3, 5]);
    // Legacy account keys make a re-import into an existing profile unambiguous.
    const sheet = wb.Sheets[tab];
    if (sheet['!cols']) sheet['!cols'][7].hidden = true;
  }
  const payrollRows: unknown[][] = [
    ['Personal Treasury Payroll and tax v1'],
    ['Gross monthly', number(current.grossMonthly)],
    ['Tax year', current.taxYear ?? ''],
    ['Filing status', current.filingStatus],
    ['Take-home monthly', number(view.payroll.takeHome)],
    [],
    ['Withholding component', 'Monthly amount'],
    ...WITHHOLDING_COMPONENTS.map((component) => [component, number(view.withholdings[component] ?? '0')]),
    [],
    ['Deductions'],
    [
      'Position',
      'Label',
      'Timing',
      'Method',
      'Monthly amount',
      'Rate',
      'Monthly exclusion',
      'Federal',
      'California',
      'FICA',
      'Notes',
    ],
    ...view.deductions.map((d) => [
      d.position,
      d.label,
      d.timing,
      d.method,
      number(d.monthlyAmount),
      number(d.rate),
      number(d.monthlyExclusion),
      d.reducesFederalIncome,
      d.reducesCaIncome,
      d.reducesFicaWages,
      d.notes ?? '',
    ]),
  ];
  payrollRows.push(
    [],
    ['Tax rules'],
    [
      'Jurisdiction',
      'Tax year',
      'Filing status',
      'Rates from year',
      'Provisional',
      'Source note',
      'Rules JSON',
    ],
  );
  for (const rule of t.budget
    .ruleSets()
    .filter((r) => r.taxYear === current.taxYear && r.filingStatus === current.filingStatus))
    payrollRows.push([
      rule.jurisdiction,
      rule.taxYear,
      rule.filingStatus,
      rule.ratesFromYear,
      rule.provisional,
      rule.sourceNote ?? '',
      JSON.stringify(rule.rules),
    ]);
  add('Payroll and tax', payrollRows, [24, 32, 18, 28, 19, 22, 24, 12, 12, 12, 54], [1, 4, 5, 6]);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
