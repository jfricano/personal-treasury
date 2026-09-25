import * as XLSX from 'xlsx';

type Row = (string | number | null)[];

function sheet(rows: Row[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (v === null ? undefined : v))) as unknown[][]);
}

const serial = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
};

/**
 * Small synthetic workbook in the same shapes as the user's workbook:
 * Monthly Template (normalized), Account Ledger, one legacy matrix month and
 * one normalized month. No personal data.
 */
export function syntheticWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      [],
      ['Monthly Cash Flow Reconciliation'],
      ['Month', null, null, 'Allocation difference', 0],
      ['Expected cash', 1300.125],
      [],
      [],
      ['Account transfer summary'],
      [
        'Account',
        'Budget allocation',
        'Transfers in',
        'Transfers out',
        'Final transfer',
        'Transferred?',
        'Notes',
      ],
      ['HH', 1000.125],
      ['PETC', 200],
      ['LTS', 100],
      ['SPLG', 0],
      ['Total', 1300.125],
      [],
      ['Transfer journal'],
      ['Date', 'LID', 'Description', 'From account', 'To account', 'Amount', 'Notes', 'Row check'],
    ]),
    'Monthly Template',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      [],
      ['Account and Loan Ledger'],
      [],
      [
        'Loan ID',
        'Date',
        'Description',
        'Debtor account',
        'Creditor account',
        'Prior balance',
        'Change',
        'Remaining balance',
        'Terms / notes',
        'Status',
      ],
      ['A-1', serial('2026-01-05'), 'Vet bill', 'HH', 'PETC', 0, 300, 300, '3 months', 'Open'],
      ['A-1', serial('2026-02-05'), null, null, null, 300, -100, 200, null, 'Open'],
      ['A-1', serial('2026-03-05'), null, null, null, 200, null, 200, 'canceled', 'Canceled'],
      ['7', serial('2026-01-10'), 'Laptop', 'ENT', 'Splurge', 0, 50, 50, null, 'Open'],
      ['7', serial('2026-02-10'), 'pmt', 'ent', ' SPLURGE ', 50, -80, -30, null, 'Credit'],
      ['B-2', serial('2026-01-11'), 'Mystery', '???', 'LTS', 0, 20, 20, null, 'Open'],
      ['B-2', serial('2026-01-12'), 'pmt', 'Petc.', 'LTS', 20, -20, 0, null, 'Paid'],
    ]),
    'Account Ledger',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      [],
      ['January 2026 Cash Flow Reconciliation'],
      ['Journal difference', -10, null, 'Status', 'Review'],
      [],
      ['Description', 'LID', 'HH', 'PETC', 'LTS', 'Total'],
      ['Budget Allocation', null, 1000, 200, 100, 1300],
      ['split', 'A-1', -100, 60, 40, 0],
      ['short', null, -100, 90, null, -10],
      ['label only', 'Z-9', null, null, null, 0],
      ["X'fer Amount", null, 800, 350, 140, 1290],
      ['Transfer confirmation 1', null, 'x', 'X', '-'],
    ]),
    '2026-01',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      [],
      ['February 2026 Cash Flow Reconciliation'],
      ['Month', '2026-02', null, 'Allocation difference', 0],
      ['Expected cash', 1300],
      [],
      [],
      ['Account transfer summary'],
      [
        'Account',
        'Budget allocation',
        'Transfers in',
        'Transfers out',
        'Final transfer',
        'Transferred?',
        'Notes',
      ],
      ['HH', 1000, null, null, null, 'Done'],
      ['PETC', 200, null, null, null, 'maybe'],
      ['LTS', 100],
      ['Total', 1300],
      [],
      ['Transfer journal'],
      ['Date', 'LID', 'Description', 'From account', 'To account', 'Amount', 'Notes', 'Row check'],
      [serial('2026-02-03'), 'A-1', 'pay vet', 'HH', 'PETC', 75, null, 'OK'],
      [serial('2026-02-04'), null, 'missing to', 'HH', null, 10, null, 'Incomplete'],
    ]),
    '2026-02',
  );
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
