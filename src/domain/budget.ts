import {
  type Money,
  ZERO,
  cmp,
  formatUSD,
  isEffectivelyZero,
  isNegative,
  normalize,
  sub,
  sum,
} from './money';
import type { AllocationOrigin, TransferState } from './types';

/**
 * A planned amount for a purpose (category) funded by one treasury account.
 * Budget lines are plans only: they never create journal entries or postings.
 */
export interface BudgetLine {
  id: string;
  categoryId: string;
  label: string;
  position: number;
  /** `residual` = take-home minus every other line (the workbook's Discretionary). */
  kind: 'amount' | 'residual';
  monthlyAmount: Money | null;
  /** Explicit funding source; never inferred from the category name. */
  fundingAccountId: string | null;
  /** Gross cost before part of it was assigned to another line (informational). */
  grossAmount?: Money | null;
  notes?: string | null;
}

export interface ResolvedBudgetLine extends BudgetLine {
  amount: Money;
}

export interface BudgetResult {
  takeHome: Money;
  lines: ResolvedBudgetLine[];
  byCategory: { categoryId: string; amount: Money; lineIds: string[] }[];
  byFundingAccount: { accountId: string; amount: Money; lineIds: string[] }[];
  totalAllocated: Money;
  /** take-home − total allocated; zero whenever a residual line exists. */
  unallocated: Money;
  issues: string[];
}

export function computeBudget(takeHome: Money, lines: BudgetLine[]): BudgetResult {
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  const residuals = sorted.filter((l) => l.kind === 'residual');
  const fixedTotal = sum(sorted.filter((l) => l.kind === 'amount').map((l) => l.monthlyAmount ?? ZERO));
  const residualAmount = sub(takeHome, fixedTotal);
  const resolved: ResolvedBudgetLine[] = sorted.map((l) => ({
    ...l,
    amount:
      l.kind === 'residual'
        ? l === residuals[0]
          ? residualAmount
          : ZERO
        : normalize(l.monthlyAmount ?? ZERO),
  }));

  const group = <K extends 'categoryId' | 'fundingAccountId'>(key: K) => {
    const m = new Map<string, { amount: Money[]; ids: string[] }>();
    for (const l of resolved) {
      const k = l[key];
      if (!k) continue;
      const g = m.get(k) ?? { amount: [], ids: [] };
      g.amount.push(l.amount);
      g.ids.push(l.id);
      m.set(k, g);
    }
    return [...m.entries()].map(([id, g]) => ({ id, amount: sum(g.amount), lineIds: g.ids }));
  };

  const totalAllocated = sum(resolved.map((l) => l.amount));
  const issues: string[] = [];
  if (residuals.length > 1) issues.push('Only one remainder (residual) line is allowed.');
  if (residuals.length && isNegative(residualAmount)) {
    issues.push(`Planned lines exceed take-home pay; the remainder is ${formatUSD(residualAmount)}.`);
  }
  for (const l of resolved) if (!l.fundingAccountId) issues.push(`“${l.label}” has no funding account.`);
  const unallocated = sub(takeHome, totalAllocated);
  if (!isEffectivelyZero(unallocated)) {
    issues.push(`${formatUSD(unallocated)} of take-home pay is not allocated to any line.`);
  }

  return {
    takeHome: normalize(takeHome),
    lines: resolved,
    byCategory: group('categoryId').map((g) => ({ categoryId: g.id, amount: g.amount, lineIds: g.lineIds })),
    byFundingAccount: group('fundingAccountId').map((g) => ({
      accountId: g.id,
      amount: g.amount,
      lineIds: g.lineIds,
    })),
    totalAllocated,
    unallocated,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Budget → treasury month comparison
// ---------------------------------------------------------------------------

export interface MonthAllocationState {
  accountId: string;
  budgetAmount: Money;
  plannedAmount: Money | null;
  origin: AllocationOrigin | null;
  transferState: TransferState;
}

export interface AllocationDiffRow {
  accountId: string;
  current: Money;
  proposed: Money;
  changed: boolean;
  overridden: boolean;
  /** What refresh would store (overrides are kept unless reset). */
  after: Money;
  /** A line marked Done whose amount would change returns to Pending. */
  resetsDone: boolean;
}

export interface BudgetDiff {
  expectedCash: { current: Money; proposed: Money; changed: boolean };
  rows: AllocationDiffRow[];
  hasChanges: boolean;
}

export function diffMonthAgainstBudget(
  expectedCash: Money,
  allocations: MonthAllocationState[],
  budget: BudgetResult,
  opts: { resetOverrides?: boolean } = {},
): BudgetDiff {
  const proposedByAccount = new Map(budget.byFundingAccount.map((f) => [f.accountId, f.amount]));
  const accountIds = new Set([...allocations.map((a) => a.accountId), ...proposedByAccount.keys()]);
  const rows: AllocationDiffRow[] = [...accountIds].map((accountId) => {
    const a = allocations.find((x) => x.accountId === accountId);
    const current = a?.budgetAmount ?? ZERO;
    const proposed = proposedByAccount.get(accountId) ?? ZERO;
    const overridden = a?.origin === 'manual_override';
    const after = overridden && !opts.resetOverrides ? current : proposed;
    const changed = cmp(current, proposed) !== 0;
    return {
      accountId,
      current,
      proposed,
      changed,
      overridden,
      after,
      resetsDone: a?.transferState === 'done' && cmp(current, after) !== 0,
    };
  });
  const cashChanged = cmp(expectedCash, budget.takeHome) !== 0;
  return {
    expectedCash: { current: normalize(expectedCash), proposed: budget.takeHome, changed: cashChanged },
    rows,
    hasChanges: cashChanged || rows.some((r) => r.changed),
  };
}
