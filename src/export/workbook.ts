import * as XLSX from 'xlsx';
import type { Treasury } from '@/api/treasury';
import { asSimpleTransfer, monthLabel } from '@/domain/monthly';
import { type Money, dec } from '@/domain/money';
import { DEBT_STATUS_LABEL, MONTH_STATUS_LABEL, type TransferState } from '@/domain/types';
import { isoToSerial } from '@/import/sheet';

type Cell = XLSX.CellObject;

/** Numbers are written from decimal strings; Excel stores doubles, so this is the only place precision narrows. */
const num = (m: Money, fmt = '#,##0.00;(#,##0.00)'): Cell => ({ t: 'n', v: dec(m).toNumber(), z: fmt });
const str = (s: string | null | undefined): Cell | null =>
  s === null || s === undefined || s === '' ? null : { t: 's', v: s };
const date = (iso: string | null): Cell | null =>
  iso ? { t: 'n', v: isoToSerial(iso), z: 'yyyy-mm-dd' } : null;
const fx = (f: string, cached: Money | string | number): Cell =>
  typeof cached === 'string' && !/^-?[\d.]+$/.test(cached)
    ? { t: 's', v: cached, f }
    : {
        t: 'n',
        v: typeof cached === 'number' ? cached : dec(cached).toNumber(),
        f,
        z: '#,##0.00;(#,##0.00)',
      };

class SheetWriter {
  ws: XLSX.WorkSheet = {};
  maxR = 0;
  maxC = 0;
  set(r: number, c: number, cell: Cell | null) {
    if (!cell) return;
    this.ws[XLSX.utils.encode_cell({ r, c })] = cell;
    this.maxR = Math.max(this.maxR, r);
    this.maxC = Math.max(this.maxC, c);
  }
  row(r: number, cells: (Cell | null)[], startC = 0) {
    cells.forEach((cell, i) => this.set(r, startC + i, cell));
  }
  finish(widths: number[] = []): XLSX.WorkSheet {
    this.ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } });
    if (widths.length) this.ws['!cols'] = widths.map((w) => ({ wch: w }));
    return this.ws;
  }
}

const a1 = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const col = (c: number) => XLSX.utils.encode_col(c);

const stateText = (s: TransferState) =>
  s === 'done' ? 'Done' : s === 'not_required' ? 'Not required' : 'Pending';

interface NormalizedInput {
  title: string;
  monthKey: string | null;
  expectedCash: Money;
  lines: {
    code: string;
    budget: Money;
    in: Money;
    out: Money;
    final: Money;
    state: TransferState | null;
    notes: string | null;
  }[];
  simple: {
    pos: number;
    date: string | null;
    loanId: string | null;
    description: string | null;
    from: string;
    to: string;
    amount: Money;
    notes: string | null;
    kind: string;
  }[];
  advanced: {
    pos: number;
    ref: string;
    date: string | null;
    loanId: string | null;
    description: string | null;
    notes: string | null;
    kind: string;
    draft: string | null;
    postings: { code: string; amount: Money }[];
  }[];
  controls: {
    allocation: Money;
    journal: Money;
    final: Money;
    invalid: number;
    negatives: number;
    status: string;
  } | null;
}

/** Normalized monthly layout, matching the workbook's Monthly Template. */
function normalizedSheet(n: NormalizedInput): XLSX.WorkSheet {
  const w = new SheetWriter();
  w.set(1, 0, str(n.title));
  w.row(2, [str('Month'), str(n.monthKey)]);
  w.row(3, [str('Expected cash'), num(n.expectedCash, '#,##0.00')]);
  w.set(5, 0, str('Enter each transfer once using a positive amount. From decreases; To increases.'));
  w.set(6, 0, str('Account transfer summary'));
  w.row(
    7,
    [
      'Account',
      'Budget allocation',
      'Transfers in',
      'Transfers out',
      'Final transfer',
      'Transferred?',
      'Notes',
    ].map(str),
  );

  const firstLine = 8;
  const lastLine = firstLine + Math.max(n.lines.length, 1) - 1;
  const totalRow = lastLine + 1;
  const journalTitle = totalRow + 2;
  const jHeader = journalTitle + 1;
  const jFirst = jHeader + 1;
  const jLast = jFirst + Math.max(n.simple.length + 10, 30) - 1;
  const advTitle = jLast + 2;
  const aHeader = advTitle + 1;
  const aFirst = aHeader + 1;
  const advRows = n.advanced.reduce((k, e) => k + e.postings.length, 0);
  const aLast = aFirst + Math.max(advRows, 1) - 1;

  const J = (c: number) => `$${col(c)}$${jFirst + 1}:$${col(c)}$${jLast + 1}`;
  const A = (c: number) => `$${col(c)}$${aFirst + 1}:$${col(c)}$${aLast + 1}`;

  n.lines.forEach((l, i) => {
    const r = firstLine + i;
    const acc = a1(r, 0);
    w.row(r, [
      str(l.code),
      num(l.budget),
      fx(`SUMIF(${J(4)},${acc},${J(5)})+SUMIFS(${A(5)},${A(4)},${acc},${A(5)},">0")`, l.in),
      fx(`SUMIF(${J(3)},${acc},${J(5)})-SUMIFS(${A(5)},${A(4)},${acc},${A(5)},"<0")`, l.out),
      fx(`${a1(r, 1)}+${a1(r, 2)}-${a1(r, 3)}`, l.final),
      str(l.state ? stateText(l.state) : null),
      str(l.notes),
    ]);
  });
  const sumCol = (c: number) =>
    fx(
      `SUM(${a1(firstLine, c)}:${a1(lastLine, c)})`,
      n.lines.reduce((s, l) => s.plus(dec([l.budget, l.in, l.out, l.final][c - 1])), dec('0')).toFixed(),
    );
  w.row(totalRow, [str('Total'), sumCol(1), sumCol(2), sumCol(3), sumCol(4)]);

  if (n.controls) {
    const B = (c: number) => `${a1(firstLine, c)}:${a1(lastLine, c)}`;
    w.row(2, [str('Allocation difference'), fx(`SUM(${B(1)})-$B$4`, n.controls.allocation)], 3);
    w.row(3, [str('Journal difference'), fx(`SUM(${B(2)})-SUM(${B(3)})`, n.controls.journal)], 3);
    w.row(4, [str('Final transfer difference'), fx(`SUM(${B(4)})-$B$4`, n.controls.final)], 3);
    w.row(2, [str('Journal rows to fix'), { t: 'n', v: n.controls.invalid }], 6);
    w.row(3, [str('Negative transfers'), fx(`COUNTIF(${B(4)},"<=-0.01")`, n.controls.negatives)], 6);
    w.row(4, [str('Status'), str(n.controls.status)], 6);
  }

  w.set(journalTitle, 0, str('Transfer journal'));
  w.row(
    jHeader,
    [
      'Date',
      'LID',
      'Description',
      'From account',
      'To account',
      'Amount',
      'Notes',
      'Row check',
      'Source kind',
      'Position',
    ].map(str),
  );
  for (let i = 0; i < jLast - jFirst + 1; i++) {
    const r = jFirst + i;
    const e = n.simple[i];
    const R = r + 1;
    const check = `IF(COUNTA(C${R}:F${R})=0,"",IF(OR(C${R}="",D${R}="",E${R}="",F${R}=""),"Incomplete",IF(D${R}=E${R},"Same account",IF(F${R}<=0,"Amount must be > 0","OK"))))`;
    if (e) {
      w.row(r, [
        date(e.date),
        str(e.loanId),
        str(e.description),
        str(e.from),
        str(e.to),
        num(e.amount),
        str(e.notes),
        { t: 's', v: 'OK', f: check },
        str(e.kind),
        { t: 'n', v: e.pos },
      ]);
    } else {
      w.set(r, 7, { t: 's', v: '', f: check });
    }
  }

  w.set(advTitle, 0, str('Advanced postings'));
  w.row(
    aHeader,
    [
      'Entry',
      'Date',
      'LID',
      'Description',
      'Account',
      'Amount',
      'Notes',
      'Kind',
      'Draft reason',
      'Position',
    ].map(str),
  );
  let r = aFirst;
  for (const e of n.advanced) {
    for (const p of e.postings) {
      w.row(r++, [
        str(e.ref),
        date(e.date),
        str(e.loanId),
        str(e.description),
        str(p.code),
        num(p.amount),
        str(e.notes),
        str(e.kind),
        str(e.draft),
        { t: 'n', v: e.pos },
      ]);
    }
  }
  return w.finish([12, 16, 28, 14, 14, 14, 24, 14, 20, 9]);
}

export function exportWorkbook(t: Treasury): Uint8Array {
  const wb = XLSX.utils.book_new();
  const accounts = t.accounts();
  const code = new Map(accounts.map((a) => [a.id, a.displayName || a.code]));
  const c = (id: string) => code.get(id) ?? id;
  const exportedAt = new Date().toISOString();
  const profile = t.activeProfile();
  const board = t.debtBoard();
  const summaries = t.monthSummaries();
  const currentId = t.currentMonthId();
  const current = summaries.find((m) => m.id === currentId);

  // Overview
  {
    const w = new SheetWriter();
    w.set(1, 0, str('Cash Flow and Account Transfers'));
    w.set(3, 0, str('Current status'));
    w.row(4, [
      str('Expected monthly cash'),
      profile
        ? { t: 'n', v: dec(profile.expectedCash).toNumber(), f: "'Monthly Template'!B4", z: '#,##0.00' }
        : null,
    ]);
    w.row(5, [
      str('Non-zero debts'),
      { t: 'n', v: board.summary.nonZeroCount, f: "'Interco Debt Summary'!B5" },
    ]);
    w.row(6, [
      str('Total outstanding'),
      {
        t: 'n',
        v: dec(board.summary.totalOutstanding).toNumber(),
        f: "'Interco Debt Summary'!D5",
        z: '#,##0.00',
      },
    ]);
    w.row(7, [str('Latest reconciliation'), str(current ? MONTH_STATUS_LABEL[current.status] : null)]);
    w.row(8, [str('Latest month'), str(current?.month)]);
    w.set(10, 0, str('Current account allocations'));
    w.row(11, [str('Account'), str('Budget allocation')]);
    let r = 12;
    for (const l of profile?.lines ?? []) {
      if (dec(l.amount).isZero()) continue;
      w.row(r++, [str(c(l.accountId)), num(l.amount, '#,##0.00')]);
    }
    w.row(r + 2, [str('Exported by'), str(`Personal Treasury at ${exportedAt}`)]);
    XLSX.utils.book_append_sheet(wb, w.finish([26, 20]), 'Overview');
  }

  // Monthly Template (active allocation profile)
  if (profile) {
    const lines = profile.lines.map((l) => ({
      code: c(l.accountId),
      budget: l.amount,
      in: '0',
      out: '0',
      final: l.amount,
      state: null,
      notes: null,
    }));
    XLSX.utils.book_append_sheet(
      wb,
      normalizedSheet({
        title: 'Monthly Cash Flow Reconciliation',
        monthKey: null,
        expectedCash: profile.expectedCash,
        lines,
        simple: [],
        advanced: [],
        controls: null,
      }),
      'Monthly Template',
    );
  }

  // Account Ledger (source order = sequence)
  {
    const w = new SheetWriter();
    w.set(1, 0, str('Account and Loan Ledger'));
    w.row(2, [
      str('Non-zero debts'),
      { t: 'n', v: board.summary.nonZeroCount },
      str('Total outstanding'),
      num(board.summary.totalOutstanding),
    ]);
    w.row(
      3,
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
      ].map(str),
    );
    const resolver = t.resolver();
    const rows = board.positions.flatMap((p) => p.events.map((e) => ({ p, e })));
    rows.sort((x, y) => x.e.sequence - y.e.sequence);
    let r = 4;
    for (const { p, e } of rows) {
      const debtor = e.sourceDebtor
        ? resolver.resolve(e.sourceDebtor).accountId
          ? c(resolver.resolve(e.sourceDebtor).accountId!)
          : e.sourceDebtor.trim()
        : c(p.debt.originDebtorAccountId);
      const creditor = e.sourceCreditor
        ? resolver.resolve(e.sourceCreditor).accountId
          ? c(resolver.resolve(e.sourceCreditor).accountId!)
          : e.sourceCreditor.trim()
        : c(p.debt.originCreditorAccountId);
      w.row(r++, [
        { t: 's', v: p.debt.loanId },
        date(e.eventDate),
        str(e.description),
        str(debtor),
        str(creditor),
        num(e.priorBalance),
        num(e.changeAmount),
        num(e.remainingBalance),
        str(e.notes),
        str(DEBT_STATUS_LABEL[e.status]),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, w.finish([10, 12, 28, 14, 14, 14, 12, 16, 30, 10]), 'Account Ledger');
  }

  // Monthly sheets
  for (const s of summaries) {
    const v = t.monthView(s.id);
    const res = v.result;
    const lines = res.lines.map((l) => ({
      code: c(l.accountId),
      budget: l.budgetAmount,
      in: l.transfersIn,
      out: l.transfersOut,
      final: l.finalTransfer,
      state: l.storedState,
      notes: l.notes,
    }));
    const simple: NormalizedInput['simple'] = [];
    const advanced: NormalizedInput['advanced'] = [];
    for (const ev of v.entries) {
      const e = ev.entry;
      const sim = asSimpleTransfer(e);
      if (sim && !e.draftReason && e.description) {
        simple.push({
          pos: e.position,
          date: e.entryDate,
          loanId: e.loanId,
          description: e.description,
          from: c(sim.fromAccountId),
          to: c(sim.toAccountId),
          amount: sim.amount,
          notes: e.notes,
          kind: e.sourceKind,
        });
      } else {
        advanced.push({
          pos: e.position,
          ref: `E${advanced.length + 1}`,
          date: e.entryDate,
          loanId: e.loanId,
          description: e.description,
          notes: e.notes,
          kind: e.sourceKind,
          draft: e.draftReason,
          postings: e.postings.map((p) => ({ code: c(p.accountId), amount: p.amount })),
        });
      }
    }
    XLSX.utils.book_append_sheet(
      wb,
      normalizedSheet({
        title: `${monthLabel(s.month)} Cash Flow Reconciliation`,
        monthKey: s.month,
        expectedCash: v.cycle.expectedCash,
        lines,
        simple,
        advanced,
        controls: {
          allocation: res.allocationDifference,
          journal: res.journalDifference,
          final: res.finalTransferDifference,
          invalid: res.invalidEntryCount,
          negatives: res.negativeTransferCount,
          status: MONTH_STATUS_LABEL[res.status],
        },
      }),
      s.month,
    );
  }

  // Interco Debt Summary (derived, values from the domain engine)
  {
    const w = new SheetWriter();
    const sm = board.summary;
    w.set(1, 0, str('Interaccount Debt Summary'));
    w.set(
      2,
      0,
      str(
        'Latest non-zero balance for each Loan ID. Negative balances are shown in the direction currently owed.',
      ),
    );
    const netFirst = 9;
    const netLast = netFirst + Math.max(sm.byAccount.length, 1) - 1;
    const detailTitle = netLast + 3;
    const dFirst = detailTitle + 2;
    const dLast = dFirst + Math.max(sm.included.length, 1) - 1;
    const G = `$G$${dFirst + 1}:$G$${dLast + 1}`;
    w.row(4, [
      str('Non-zero debts'),
      { t: 'n', v: sm.nonZeroCount, f: `COUNTA($A$${dFirst + 1}:$A$${dLast + 1})` },
      str('Total outstanding'),
      fx(`SUM(${G})`, sm.totalOutstanding),
      str('Largest debt'),
      fx(`MAX(${G})`, sm.largestDebt),
    ]);
    w.set(7, 0, str('Net by account'));
    w.row(8, ['Account', 'Owed to account', 'Owed by account', 'Net position'].map(str));
    sm.byAccount.forEach((a, i) => {
      const r = netFirst + i;
      const acc = a1(r, 0);
      w.row(r, [
        str(c(a.accountId)),
        fx(`SUMIF($F$${dFirst + 1}:$F$${dLast + 1},${acc},${G})`, a.owedTo),
        fx(`SUMIF($E$${dFirst + 1}:$E$${dLast + 1},${acc},${G})`, a.owedBy),
        fx(`${a1(r, 1)}-${a1(r, 2)}`, a.net),
      ]);
    });
    w.set(detailTitle, 0, str('Debt detail'));
    w.row(
      detailTitle + 1,
      [
        'Loan ID',
        'Description',
        'Opened',
        'Last activity',
        'Owed by',
        'Owed to',
        'Remaining',
        'Terms / notes',
      ].map(str),
    );
    const ordered = [...sm.included].sort(
      (x, y) => (x.events[0]?.sequence ?? 0) - (y.events[0]?.sequence ?? 0),
    );
    ordered.forEach((p, i) => {
      w.row(dFirst + i, [
        { t: 's', v: p.debt.loanId },
        str(p.debt.description),
        date(p.debt.openedDate),
        date(p.lastActivity),
        str(c(p.owedByAccountId)),
        str(c(p.owedToAccountId)),
        num(p.displayBalance),
        str(p.displayNotes),
      ]);
    });
    XLSX.utils.book_append_sheet(wb, w.finish([12, 28, 12, 14, 12, 12, 14, 30]), 'Interco Debt Summary');
  }

  // Normalized metadata tables so a re-import is lossless.
  {
    const w = new SheetWriter();
    const aliases = t.aliases();
    w.row(0, ['Order', 'Code', 'Display name', 'Description', 'Aliases', 'Active', 'Needs review'].map(str));
    accounts.forEach((a, i) =>
      w.row(i + 1, [
        { t: 'n', v: i + 1 },
        str(a.code),
        str(a.displayName),
        str(a.description),
        str(
          aliases
            .filter((x) => x.accountId === a.id)
            .map((x) => x.originalText)
            .join(', '),
        ),
        str(a.active ? 'Yes' : 'No'),
        str(a.needsReview ? 'Yes' : 'No'),
      ]),
    );
    const sheet = w.finish([8, 24, 24, 60, 20, 8, 12]);
    // These columns are for lossless re-import of old workbooks, not day-to-day account naming.
    sheet['!cols']![1].hidden = true;
    sheet['!cols']![4].hidden = true;
    XLSX.utils.book_append_sheet(wb, sheet, 'Accounts');
  }
  {
    const w = new SheetWriter();
    w.row(0, ['Loan ID', 'Opened', 'Description', 'Origin debtor', 'Origin creditor', 'Terms'].map(str));
    board.positions.forEach((p, i) =>
      w.row(i + 1, [
        { t: 's', v: p.debt.loanId },
        date(p.debt.openedDate),
        str(p.debt.description),
        str(c(p.debt.originDebtorAccountId)),
        str(c(p.debt.originCreditorAccountId)),
        str(p.debt.terms),
      ]),
    );
    XLSX.utils.book_append_sheet(wb, w.finish([10, 12, 28, 14, 14, 30]), 'Debts');
  }
  {
    const w = new SheetWriter();
    // Expected cash is also written as exact decimal text: sums can exceed double precision.
    w.row(
      0,
      [
        'Month',
        'Expected cash',
        'Status',
        'Closed',
        'Close override note',
        'Notes',
        'Expected cash (exact)',
      ].map(str),
    );
    summaries.forEach((s, i) => {
      const m = t.repos.getMonth(s.id)!;
      w.row(i + 1, [
        str(s.month),
        num(s.expectedCash),
        str(MONTH_STATUS_LABEL[s.status]),
        str(m.closedAt ? 'Yes' : 'No'),
        str(m.closeOverrideNote),
        str(m.notes),
        { t: 's', v: s.expectedCash },
      ]);
    });
    XLSX.utils.book_append_sheet(wb, w.finish([10, 16, 18, 8, 40, 60]), 'Months');
  }

  wb.Props = {
    Title: 'Personal Treasury export',
    Author: 'Personal Treasury',
    Comments: `Exported by Personal Treasury at ${exportedAt}`,
    CreatedDate: new Date(exportedAt),
  };
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}
