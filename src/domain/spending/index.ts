import { abs, cmp, neg, normalize, sub, sum } from '@/domain/money';
import type {
  Balance,
  Disposition,
  Evidence,
  InstitutionAccount,
  Period,
  Report,
  Review,
  ReviewBudget,
  Rule,
  Snapshot,
  Transaction,
} from './types';
export * from './types';

export function safeText(value: string): string {
  // Strip control characters from untrusted financial descriptions.
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
      .slice(0, 512)
  );
}
export const normalizedDescription = (s: string) =>
  safeText(s)
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d{4,}/g, '#');
export function exactAmount(value: string): string {
  if (!/^[+-]?\d+(?:\.\d{1,4})?$/.test(value) || value.length > 50)
    throw new Error('Amount must be a decimal with at most four fractional digits.');
  return normalize(value);
}
export function calendarDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('Use a valid YYYY-MM-DD date.');
  return value;
}
export function postedDate(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDate(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid posted date');
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0)
    return date.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)!.value).join('-');
}
export const dayAfter = (date: string, days = 1) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
export function monthPeriod(month: string): Period {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Use YYYY-MM');
  const start = `${month}-01`;
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: dayAfter(next.toISOString().slice(0, 10), -1) };
}
export function gatherWindow(month: string, today: string): Period {
  const p = monthPeriod(month);
  return { start: dayAfter(p.start, -7), end: [today, dayAfter(p.end, 60)].sort()[0] };
}
export function firstGap(periods: Period[], range: Period): string | null {
  let next = range.start;
  for (const p of [...periods].sort((a, b) => a.start.localeCompare(b.start))) {
    if (p.end < next) continue;
    if (p.start > next) return next;
    next = dayAfter(p.end);
    if (next > range.end) return null;
  }
  return next <= range.end ? next : null;
}
export function coverage(
  month: string,
  evidence: Evidence | undefined,
  transactions: Transaction[],
  settleDays: number,
  timeZone = 'UTC',
) {
  const period = monthPeriod(month);
  if (!evidence) return { status: 'missing', reason: 'Nothing gathered' };
  if (evidence.waiver) {
    if (transactions.some((t) => !t.pending && t.postedDate.startsWith(month)))
      return { status: 'partial', reason: 'An account with posted activity cannot be waived' };
    if (!evidence.waiver.reason || !evidence.waiver.note.trim())
      return { status: 'partial', reason: 'Waiver needs a reason and note' };
    return { status: 'waived', reason: evidence.waiver.reason };
  }
  if (evidence.reconnect) return { status: 'reconnect', reason: 'Needs reconnect' };
  if (evidence.error) return { status: 'error', reason: evidence.error };
  const gap = firstGap(evidence.periods, period);
  if (gap) return { status: 'partial', reason: `Gap on ${gap}` };
  if (evidence.source !== 'file' && evidence.source !== 'manual') {
    const freshness = evidence.freshness ?? evidence.gatheredAt;
    let freshDate: string;
    try {
      const date = new Date(freshness);
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid freshness');
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      freshDate = ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)!.value).join('-');
    } catch {
      return { status: 'error', reason: 'Source freshness or household time zone is invalid' };
    }
    if (freshDate < dayAfter(period.end, settleDays))
      return { status: 'partial', reason: 'Not fresh enough' };
    if (
      !evidence.historyConfirmed &&
      !(evidence.historyStart && evidence.historyStart <= period.start) &&
      !(evidence.linkedAt && evidence.linkedAt.slice(0, 10) < period.start)
    )
      return { status: 'partial', reason: 'Confirm history' };
  }
  return { status: 'complete', reason: 'Whole month covered' };
}
export function inMonth(t: Transaction, review: Review, accounts: InstitutionAccount[]) {
  return (
    !t.pending &&
    t.postedDate.startsWith(review.month) &&
    accounts.some((a) => a.id === t.institutionAccountId && a.active && a.inReview)
  );
}
export function dispositionErrors(
  t: Transaction,
  d: Disposition | undefined,
  lineKeys: Set<string>,
  transactions: Transaction[],
): string[] {
  if (!d || d.state !== 'accepted') return ['Accept a classification'];
  if (t.pending) return ['Pending transactions cannot be classified'];
  if (d.kind === 'budget') {
    const errors: string[] = [];
    if (!d.parts.length) errors.push('Choose at least one budget line');
    if (d.parts.some((p) => !lineKeys.has(p.lineKey))) errors.push('Budget line no longer exists');
    if (
      d.parts.some(
        (p) => cmp(p.amount, '0') === 0 || Math.sign(cmp(p.amount, '0')) !== Math.sign(cmp(t.amount, '0')),
      )
    )
      errors.push('Split parts must have the transaction sign');
    if (cmp(sum(d.parts.map((p) => p.amount)), t.amount) !== 0)
      errors.push(`Split differs by ${abs(sub(sum(d.parts.map((p) => p.amount)), t.amount))}`);
    return errors;
  }
  if (d.kind === 'income' && cmp(t.amount, '0') <= 0) return ['Income requires an inflow'];
  if (d.kind === 'excluded' && d.reason === 'other' && !d.note?.trim())
    return ['Other exclusion requires a note'];
  if (d.kind === 'transfer') {
    if (d.pairedId) {
      const other = transactions.find((x) => x.id === d.pairedId);
      if (
        !other ||
        other.pending ||
        other.institutionAccountId === t.institutionAccountId ||
        cmp(other.amount, neg(t.amount)) !== 0 ||
        other.disposition?.state !== 'accepted' ||
        other.disposition.kind !== 'transfer' ||
        other.disposition.pairedId !== t.id
      )
        return ['Unmatched transfer pair'];
    } else if (!d.counterparty || d.counterparty === t.institutionAccountId)
      return ['Choose the other owned account'];
  }
  return [];
}
export function possibleDuplicates(transactions: Transaction[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < transactions.length; i++)
    for (let j = i + 1; j < transactions.length; j++) {
      const a = transactions[i],
        b = transactions[j];
      if (
        a.pending ||
        b.pending ||
        a.institutionAccountId !== b.institutionAccountId ||
        a.postedDate !== b.postedDate ||
        cmp(a.amount, b.amount) !== 0
      )
        continue;
      const sameSource =
        a.source.kind === b.source.kind &&
        (a.source.hash ?? a.source.name) === (b.source.hash ?? b.source.name);
      if (
        !sameSource ||
        (a.source.kind !== 'file' &&
          a.source.kind !== 'manual' &&
          normalizedDescription(a.description) === normalizedDescription(b.description))
      )
        pairs.push([a.id, b.id]);
    }
  return pairs;
}
export function mergeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const result = new Map(existing.map((t) => [t.id, t]));
  for (const next of incoming) {
    const old = result.get(next.id);
    if (next.removedAtSource && !old?.disposition) {
      result.delete(next.id);
      continue;
    }
    const changed = !!old && cmp(old.amount, next.amount) !== 0;
    result.set(next.id, {
      ...old,
      ...next,
      disposition: old?.disposition
        ? { ...old.disposition, state: changed ? 'suggested' : old.disposition.state }
        : next.disposition,
      changed,
      removalConfirmed: next.removedAtSource ? old?.removalConfirmed : undefined,
    });
  }
  return [...result.values()];
}
export function pairCandidates(
  t: Transaction,
  transactions: Transaction[],
  accounts: InstitutionAccount[],
  days: number,
): Transaction[] {
  if (t.pending || (t.disposition?.kind === 'transfer' && t.disposition.pairedId)) return [];
  return transactions.filter(
    (b) =>
      b.id !== t.id &&
      !b.pending &&
      b.institutionAccountId !== t.institutionAccountId &&
      accounts.some((a) => a.id === b.institutionAccountId && a.inReview && a.active) &&
      accounts.some((a) => a.id === t.institutionAccountId && a.inReview && a.active) &&
      !(b.disposition?.kind === 'transfer' && b.disposition.pairedId) &&
      cmp(t.amount, '0') !== 0 &&
      cmp(t.amount, neg(b.amount)) === 0 &&
      Math.abs(Date.parse(t.postedDate) - Date.parse(b.postedDate)) / 86400000 <= days,
  );
}
export function suggestRule(t: Transaction, rules: Rule[], lineKeys: Set<string>): Disposition | undefined {
  for (const r of [...rules].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
  )) {
    if (!r.enabled || t.pending || (r.action.kind === 'budget' && !lineKeys.has(r.action.lineKey))) continue;
    if (
      (r.accountId && r.accountId !== t.institutionAccountId) ||
      (r.merchant && normalizedDescription(r.merchant) !== normalizedDescription(t.merchantName ?? '')) ||
      (r.direction === 'inflow' && cmp(t.amount, '0') <= 0) ||
      (r.direction === 'outflow' && cmp(t.amount, '0') >= 0) ||
      (r.min && cmp(abs(t.amount), r.min) < 0) ||
      (r.max && cmp(abs(t.amount), r.max) > 0)
    )
      continue;
    const text = normalizedDescription(t.description),
      pattern = normalizedDescription(r.pattern);
    if (
      !pattern ||
      !(r.match === 'contains'
        ? text.includes(pattern)
        : r.match === 'starts_with'
          ? text.startsWith(pattern)
          : text === pattern)
    )
      continue;
    const action =
      r.action.kind === 'budget'
        ? { kind: 'budget' as const, parts: [{ lineKey: r.action.lineKey, amount: t.amount }] }
        : r.action;
    const d = { ...action, state: 'suggested' as const, ruleId: r.id };
    if (dispositionErrors(t, { ...d, state: 'accepted' }, lineKeys, [t]).length === 0) return d;
  }
}
export function balanceSnapshot(
  account: InstitutionAccount,
  balance: Balance | undefined,
  review: Review,
): Snapshot {
  const base = {
    accountId: account.id,
    label: account.displayName,
    kind: account.kind,
    asOf: balance?.asOf ?? '',
    capturedAt: balance?.capturedAt,
    source: balance?.source,
    unavailable: balance?.unavailable ?? false,
    estimate: false,
    value: balance?.value ?? null,
    details: balance?.details,
  };
  if (!balance || balance.unavailable || balance.value === null) return base;
  const end = monthPeriod(review.month).end,
    date = balance.asOf.slice(0, 10);
  if (
    ['checking', 'savings', 'credit_card'].includes(account.kind) &&
    date > end &&
    !firstGap(balance.periods, { start: dayAfter(end), end: date })
  ) {
    return {
      ...base,
      estimate: true,
      value: sub(
        balance.value,
        sum(
          review.transactions
            .filter(
              (t) =>
                t.institutionAccountId === account.id &&
                !t.pending &&
                t.postedDate > end &&
                t.postedDate <= date,
            )
            .map((t) => t.amount),
        ),
      ),
    };
  }
  return base;
}
export function clearBlockers(
  review: Review,
  accounts: InstitutionAccount[],
  budget: ReviewBudget | null,
): { message: string; target: string }[] {
  const blockers: { message: string; target: string }[] = [];
  const add = (message: string, target: string) => blockers.push({ message, target });
  if (!budget || !budget.lines.length) add('Choose a full-detail budget version', 'budget');
  const keys = new Set(budget?.lines.map((l) => l.lineKey));
  const rows = review.transactions.filter((t) => inMonth(t, review, accounts));
  for (const a of accounts.filter((a) => a.active)) {
    if (!a.confirmed && (a.inReview || a.inSnapshot)) add(`Confirm kind and scope: ${a.displayName}`, a.id);
    if (a.inReview) {
      const c = coverage(
        review.month,
        review.evidence[a.id],
        rows.filter((t) => t.institutionAccountId === a.id),
        review.settleDays,
        review.timeZone,
      );
      if (!['complete', 'waived'].includes(c.status)) add(`${a.displayName}: ${c.reason}`, a.id);
    }
    if (a.inSnapshot && !review.balances[a.id]?.unavailable && review.balances[a.id]?.value == null)
      add(`Balance missing: ${a.displayName}`, a.id);
  }
  for (const t of rows) {
    for (const e of dispositionErrors(t, t.disposition, keys, review.transactions)) add(e, t.id);
    if (t.removedAtSource && !t.removalConfirmed) add('Confirm transaction removed at source', t.id);
  }
  for (const [a, b] of possibleDuplicates(review.transactions))
    if (
      rows.some((t) => t.id === a || t.id === b) &&
      ![a, b].every((id) => review.transactions.find((t) => t.id === id)?.duplicateConfirmed) &&
      ![a, b].some((id) => {
        const d = review.transactions.find((t) => t.id === id)?.disposition;
        return d?.state === 'accepted' && d.kind === 'excluded' && d.reason === 'duplicate_at_source';
      })
    )
      add('Resolve possible duplicate', a);
  const assigned = sum(
    rows.map((t) =>
      t.disposition?.state !== 'accepted'
        ? '0'
        : t.disposition.kind === 'budget'
          ? sum(t.disposition.parts.map((p) => p.amount))
          : t.amount,
    ),
  );
  if (cmp(sum(rows.map((t) => t.amount)), assigned) !== 0)
    add('Identity check failed: amounts do not reconcile', 'summary');
  return blockers;
}
export function buildReport(
  review: Review,
  accounts: InstitutionAccount[],
  budget: ReviewBudget,
  clearedAt = new Date().toISOString(),
  preview = false,
): Report {
  const blockers = clearBlockers(review, accounts, budget);
  if (blockers.length && !preview) throw new Error(blockers.map((b) => b.message).join('; '));
  const rows = review.transactions.filter(
    (t) => inMonth(t, review, accounts) && t.disposition?.state === 'accepted',
  );
  const amount = (f: (t: Transaction) => boolean) => sum(rows.filter(f).map((t) => t.amount));
  const flows = new Map<string, { kind: string; total: string; count: number }>();
  for (const t of rows) {
    const d = t.disposition;
    if (!d || d.state !== 'accepted') continue;
    const kind =
      d.kind === 'transfer'
        ? d.pairedId
          ? 'paired transfer'
          : 'unpaired transfer'
        : d.kind === 'excluded'
          ? `excluded: ${d.reason}`
          : null;
    if (kind) {
      const old = flows.get(kind);
      flows.set(kind, { kind, total: sum([old?.total ?? '0', t.amount]), count: (old?.count ?? 0) + 1 });
    }
  }
  const tail = dayAfter(monthPeriod(review.month).end, -6);
  return {
    month: review.month,
    clearedAt,
    budgetVersionId: budget.id,
    budgetLabel: budget.label,
    timeZone: review.timeZone,
    settleDays: review.settleDays,
    pairingDays: review.pairingDays,
    appVersion: '0.3.0-preview.1',
    count: rows.length,
    inflows: amount((t) => cmp(t.amount, '0') > 0),
    outflows: amount((t) => cmp(t.amount, '0') < 0),
    note: safeText(review.note),
    lines: budget.lines.map((l) => {
      const parts = rows.flatMap((t) =>
        t.disposition?.kind === 'budget' ? t.disposition.parts.filter((p) => p.lineKey === l.lineKey) : [],
      );
      return {
        ...l,
        actual: neg(sum(parts.map((p) => p.amount))),
        count: rows.filter(
          (t) => t.disposition?.kind === 'budget' && t.disposition.parts.some((p) => p.lineKey === l.lineKey),
        ).length,
        note: '',
      };
    }),
    unbudgeted: {
      actual: neg(amount((t) => t.disposition?.kind === 'unbudgeted')),
      count: rows.filter((t) => t.disposition?.kind === 'unbudgeted').length,
    },
    income: {
      planned: budget.takeHome,
      takeHome: amount((t) => t.disposition?.kind === 'income' && t.disposition.incomeKind === 'take_home'),
      other: amount((t) => t.disposition?.kind === 'income' && t.disposition.incomeKind === 'other'),
      count: rows.filter((t) => t.disposition?.kind === 'income').length,
    },
    flows: [...flows.values()],
    sources: accounts
      .filter((a) => a.active && a.inReview)
      .map((a) => {
        const ts = rows.filter((t) => t.institutionAccountId === a.id),
          e = review.evidence[a.id] ?? { source: 'file', periods: [], gatheredAt: '' },
          tt = ts.filter((t) => t.postedDate >= tail);
        return {
          accountId: a.id,
          label: a.displayName,
          kind: a.kind,
          source: e.source,
          status: coverage(review.month, e, ts, review.settleDays, review.timeZone).status,
          waiver: e.waiver ? `${e.waiver.reason}: ${e.waiver.note}` : '',
          historyConfirmed: !!e.historyConfirmed,
          count: ts.length,
          inflows: sum(ts.filter((t) => cmp(t.amount, '0') > 0).map((t) => t.amount)),
          outflows: sum(ts.filter((t) => cmp(t.amount, '0') < 0).map((t) => t.amount)),
          tailCount: tt.length,
          tailSum: sum(tt.map((t) => t.amount)),
          periods: e.periods,
        };
      }),
    balances: accounts
      .filter((a) => a.active && a.inSnapshot)
      .map((a) => balanceSnapshot(a, review.balances[a.id], review)),
  };
}
export function reportTotals(report: Report) {
  const lines = report.lines.filter((l) => l.role === 'spending');
  const values = report.balances.filter((b) => !b.unavailable && b.value !== null).map((b) => b.value!);
  const assets = sum(values.filter((v) => cmp(v, '0') >= 0)),
    liabilities = neg(sum(values.filter((v) => cmp(v, '0') < 0)));
  return {
    planned: sum(lines.map((l) => l.planned)),
    actual: sum([...lines.map((l) => l.actual), report.unbudgeted.actual]),
    assets,
    liabilities,
    netWorth: sub(assets, liabilities),
  };
}
export function variance(actual: string, planned: string) {
  const over = sub(actual, planned);
  return { over, status: cmp(over, '0.01') >= 0 ? 'Over' : cmp(over, '-0.01') <= 0 ? 'Under' : 'On plan' };
}
export function yearToDate(reports: Report[], through: string) {
  const months = Array.from(
    { length: Number(through.slice(5)) },
    (_, i) => `${through.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
  );
  const selected = reports.filter((r) => months.includes(r.month));
  return {
    missing: months.filter((m) => !selected.some((r) => r.month === m)),
    planned: sum(selected.map((r) => reportTotals(r).planned)),
    actual: sum(selected.map((r) => reportTotals(r).actual)),
  };
}

/** Compare only the prior month's final week when this gather actually covers it. No transaction details persist. */
export function latePostingChanges(review: Review, reports: Report[]) {
  const previousMonth = dayAfter(monthPeriod(review.month).start, -1).slice(0, 7);
  const report = reports.find((r) => r.month === previousMonth);
  if (!report) return [];
  const end = monthPeriod(previousMonth).end,
    start = dayAfter(end, -6);
  return report.sources.flatMap((source) => {
    const evidence = review.evidence[source.accountId];
    if (!evidence || evidence.error || evidence.reconnect || firstGap(evidence.periods, { start, end }))
      return [];
    const rows = review.transactions.filter(
      (t) =>
        t.institutionAccountId === source.accountId &&
        !t.pending &&
        !t.removedAtSource &&
        t.postedDate >= start &&
        t.postedDate <= end,
    );
    const total = sum(rows.map((t) => t.amount));
    return rows.length === source.tailCount && cmp(total, source.tailSum) === 0
      ? []
      : [
          {
            month: previousMonth,
            account: source.label,
            countChange: rows.length - source.tailCount,
            amountChange: sub(total, source.tailSum),
          },
        ];
  });
}
export function reportGroups(report: Report, field: 'category' | 'fundingAccount') {
  const groups = new Map<string, { label: string; role: string; planned: string[]; actual: string[] }>();
  for (const line of report.lines) {
    const label = line[field] || 'No funding account',
      key = `${line.role}|${label}`;
    const group = groups.get(key) ?? { label, role: line.role, planned: [], actual: [] };
    group.planned.push(line.planned);
    group.actual.push(line.actual);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    label: g.label,
    role: g.role,
    planned: sum(g.planned),
    actual: sum(g.actual),
  }));
}
export function lineYearToDate(reports: Report[], through: string, lineKey: string) {
  const lines = reports
    .filter((r) => r.month <= through && r.month.slice(0, 4) === through.slice(0, 4))
    .flatMap((r) => r.lines.filter((l) => l.lineKey === lineKey));
  return { planned: sum(lines.map((l) => l.planned)), actual: sum(lines.map((l) => l.actual)) };
}

export const liabilityKinds = [
  'credit_card',
  'loan',
  'student_loan',
  'auto_loan',
  'mortgage',
  'other_liability',
];
/** Previous complete calendar month, walking past reports already cleared. */
export function latestUnclearedMonth(reports: Pick<Report, 'month'>[], today = new Date()) {
  const date = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
  const cleared = new Set(reports.map((r) => r.month));
  for (let attempt = 0; attempt <= cleared.size; attempt++) {
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!cleared.has(month)) return month;
    date.setMonth(date.getMonth() - 1);
  }
  throw new Error('Could not determine the next review month.');
}
