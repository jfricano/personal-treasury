import { z } from 'zod';
import { isMoney, isStrictlyPositive } from '@/domain/money';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const money = z.string().refine(isMoney, 'Enter a decimal amount');
const positiveMoney = money.refine(isStrictlyPositive, 'Amount must be greater than zero');
const optText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() !== '' ? v : null));

export const AccountInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(24)
    .transform((s) => s.toUpperCase()),
  displayName: optText,
  description: optText,
  color: optText,
});

export const TransferInputSchema = z
  .object({
    entryDate: isoDate.nullish().transform((v) => v ?? null),
    loanId: optText,
    description: optText,
    fromAccountId: z.string().min(1, 'From account is required'),
    toAccountId: z.string().min(1, 'To account is required'),
    amount: positiveMoney,
    notes: optText,
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'From and To accounts must differ',
    path: ['toAccountId'],
  });

export const PostingInput = z.object({ accountId: z.string().min(1), amount: money });

export const AdvancedEntryInput = z.object({
  entryDate: isoDate.nullish().transform((v) => v ?? null),
  loanId: optText,
  description: optText,
  notes: optText,
  postings: z.array(PostingInput).min(2, 'An entry needs at least two postings'),
});

export const NewMonthInput = z.object({
  month: monthKey,
  source: z.enum(['budget', 'template', 'duplicate', 'blank']),
  budgetVersionId: z.string().nullish(),
  duplicateFromMonthId: z.string().nullish(),
  expectedCash: money.nullish(),
});

export const NewDebtInput = z
  .object({
    loanId: z.string().trim().min(1, 'Loan ID is required'),
    openedDate: isoDate,
    description: optText,
    debtorAccountId: z.string().min(1, 'Debtor account is required'),
    creditorAccountId: z.string().min(1, 'Creditor account is required'),
    openingChange: positiveMoney,
    terms: optText,
    notes: optText,
  })
  .refine((d) => d.debtorAccountId !== d.creditorAccountId, {
    message: 'Debtor and creditor must differ',
    path: ['creditorAccountId'],
  });

export const PaymentInput = z.object({
  eventDate: isoDate,
  payment: positiveMoney,
  description: optText,
  notes: optText,
  journalEntryId: z.string().nullish(),
});

export const AdjustmentInput = z.object({
  eventDate: isoDate,
  change: money,
  description: optText,
  notes: optText,
  journalEntryId: z.string().nullish(),
});

export const EventEditInput = z.object({
  eventDate: isoDate,
  changeAmount: money,
  description: optText,
  notes: optText,
});

export const ProfileInput = z.object({
  expectedCash: money,
  lines: z.array(z.object({ accountId: z.string(), amount: money })),
  confirmOutOfBalance: z.boolean().default(false),
});

/** First validation message, for concise UI errors. */
export function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input';
}
