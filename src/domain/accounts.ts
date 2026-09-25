import type { Account, AccountAlias } from './types';

/** Comparison key for codes and aliases: trimmed, case-insensitive. */
export function codeKey(text: string): string {
  return text.trim().toUpperCase();
}

/** Canonical spelling for a newly discovered code: trimmed and uppercased. */
export function canonicalCode(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * Codes that are not plain identifiers (such as `???`) are preserved but need
 * the user's review before they are trusted.
 */
export function codeNeedsReview(code: string): boolean {
  return !/^[A-Z0-9][A-Z0-9_-]*$/.test(code);
}

export interface Resolution {
  accountId: string | null;
  /** The canonical code the text resolves to (existing or proposed). */
  code: string;
  original: string;
  aliasApplied: AccountAlias | null;
  /** Differences such as case or whitespace that were normalized away. */
  normalized: boolean;
}

export class AccountResolver {
  private byKey = new Map<string, Account>();
  private aliasByKey = new Map<string, AccountAlias>();
  private byId = new Map<string, Account>();

  constructor(accounts: Account[], aliases: AccountAlias[]) {
    for (const a of accounts) {
      this.byKey.set(codeKey(a.code), a);
      this.byId.set(a.id, a);
    }
    for (const al of aliases) this.aliasByKey.set(codeKey(al.alias), al);
  }

  addAccount(a: Account) {
    this.byKey.set(codeKey(a.code), a);
    this.byId.set(a.id, a);
  }

  addAlias(al: AccountAlias) {
    this.aliasByKey.set(codeKey(al.alias), al);
  }

  resolve(text: string): Resolution {
    const key = codeKey(text);
    const direct = this.byKey.get(key);
    if (direct) {
      return {
        accountId: direct.id,
        code: direct.code,
        original: text,
        aliasApplied: null,
        normalized: text !== direct.code,
      };
    }
    const alias = this.aliasByKey.get(key);
    if (alias) {
      const target = this.byId.get(alias.accountId);
      if (target)
        return {
          accountId: target.id,
          code: target.code,
          original: text,
          aliasApplied: alias,
          normalized: true,
        };
    }
    const code = canonicalCode(text);
    return { accountId: null, code, original: text, aliasApplied: null, normalized: text !== code };
  }
}

export interface SeedAlias {
  alias: string;
  target: string;
  note: string;
}

/**
 * Aliases seeded on import. Aliases that only apply to one person's workbook
 * live outside source control in `reference/seed-aliases.json` (see import/analyze.ts).
 */
export const SEED_ALIASES: SeedAlias[] = [
  { alias: 'Splurge', target: 'SPLG', note: 'Observed in Account Ledger' },
  { alias: 'Petc.', target: 'PETC', note: 'Observed in 2025-03 header; confirmed by user' },
];

/** "Pets etc.": recurring but non-regular charges (user definition, 2026-09-24). */
export const PETC_DESCRIPTION =
  'Pets etc.: flexible, as-needed actual savings account for recurring but non-regular charges, such as pets, medical, dental, auto maintenance, and similar expenses.';
