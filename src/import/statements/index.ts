import {
  exactAmount,
  calendarDate,
  safeText,
  type Balance,
  type CsvProfile,
  type Period,
  type Transaction,
} from '@/domain/spending';
import { neg, sub, cmp } from '@/domain/money';
export interface Statement {
  transactions: Transaction[];
  period: Period;
  balance?: Balance;
  hash: string;
  warnings: string[];
}
export async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function parseCsv(text: string): string[][] {
  if (text.length > 8 * 1024 * 1024) throw new Error('Statement exceeds 8 MiB');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
      } else if (!cell) {
        quoted = true;
      } else throw new Error(`Unexpected quote near row ${rows.length + 1}`);
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Truncated CSV: unclosed quoted cell');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
const validPeriod = (p: Period) => {
  calendarDate(p.start);
  calendarDate(p.end);
  if (p.start > p.end) throw new Error('Statement end precedes start');
  return p;
};
export async function parseCsvStatement(
  text: string,
  name: string,
  accountId: string,
  profile: CsvProfile,
  period: Period,
): Promise<Statement> {
  validPeriod(period);
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 1) throw new Error('CSV has no header');
  const headers = rows[0].map((s) => s.trim());
  if (new Set(headers).size !== headers.length) throw new Error('CSV has duplicate column names');
  const col = (name: string | undefined) => (name === undefined ? -1 : headers.indexOf(name));
  for (const required of [
    profile.date,
    profile.description,
    ...(profile.amount ? [profile.amount] : [profile.debit, profile.credit]),
  ])
    if (!required || col(required) < 0) throw new Error(`Missing mapped column: ${required ?? 'amount'}`);
  const hash = await sha256(text),
    occurrences = new Map<string, number>();
  const transactions: Transaction[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length !== headers.length)
      throw new Error(`${name}, row ${i + 1}: column count differs from header`);
    try {
      const date = calendarDate(row[col(profile.date)].trim());
      const description = safeText(row[col(profile.description)]);
      const parse = (v: string) => exactAmount(v.trim().replace(/^\$/, '').replace(/,/g, ''));
      const sourceAmount = profile.amount
        ? row[col(profile.amount)]
        : `${row[col(profile.credit)]} credit / ${row[col(profile.debit)]} debit`;
      let amount: string;
      if (profile.amount) {
        amount = parse(sourceAmount);
        if (profile.outflowPositive) amount = neg(amount);
      } else {
        const debit = parse(row[col(profile.debit)] || '0'),
          credit = parse(row[col(profile.credit)] || '0');
        if (cmp(debit, '0') < 0 || cmp(credit, '0') < 0)
          throw new Error('Debit and credit columns must be nonnegative');
        amount = sub(credit, debit);
      }
      const identity = JSON.stringify([
          accountId,
          date,
          amount,
          description.toUpperCase().trim().replace(/\s+/g, ' '),
        ]),
        occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      transactions.push({
        id: await sha256(`${identity}|${occurrence}`),
        institutionAccountId: accountId,
        postedDate: date,
        amount,
        sourceAmount,
        description,
        pending: false,
        removedAtSource: false,
        source: { kind: 'file', name: safeText(name), hash, row: String(i + 1) },
      });
    } catch (error) {
      throw new Error(`${name}, row ${i + 1}: ${(error as Error).message}`, { cause: error });
    }
  }
  const dates = transactions.map((t) => t.postedDate).sort(),
    warnings: string[] = [];
  if (
    dates.length &&
    (Date.parse(dates[0]) - Date.parse(period.start) > 5 * 86400000 ||
      Date.parse(period.end) - Date.parse(dates.at(-1)!) > 5 * 86400000)
  )
    warnings.push(
      'The rows stop more than five days from the statement boundary. Check for a truncated download.',
    );
  return { transactions, period, hash, warnings };
}
function tag(text: string, name: string): string | undefined {
  return new RegExp(`<${name}\\s*>\\s*([^<\\r\\n]+)`, 'i').exec(text)?.[1].trim();
}
function ofxDate(value: string | undefined): string {
  if (!value || !/^\d{8}/.test(value)) throw new Error('Missing or invalid OFX date');
  return calendarDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
}
function decode(value: string) {
  return safeText(
    value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
}
export async function parseOfx(text: string, name: string, accountId: string): Promise<Statement> {
  if (text.length > 8 * 1024 * 1024) throw new Error('Statement exceeds 8 MiB');
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('External entities are not permitted in statement files');
  if (!/<OFX>/i.test(text) || !/<\/OFX>/i.test(text)) throw new Error('Truncated or invalid OFX statement');
  const statementCount = (text.match(/<(?:STMTRS|CCSTMTRS|INVSTMTRS)>/gi) ?? []).length;
  if (statementCount > 1) throw new Error('Choose a statement containing one account');
  const investment = /<INVSTMTRS>/i.test(text);
  const period = validPeriod({
    start: ofxDate(tag(text, 'DTSTART') ?? tag(text, 'DTASOF')),
    end: ofxDate(tag(text, 'DTEND') ?? tag(text, 'DTASOF')),
  });
  const hash = await sha256(text),
    transactions: Transaction[] = [],
    ids = new Set<string>();
  if (!investment)
    for (const [i, match] of [
      ...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<\/STMTTRN>)/gi),
    ].entries()) {
      try {
        const block = match[1],
          fitid = tag(block, 'FITID');
        if (!fitid) throw new Error('FITID is missing');
        if (ids.has(fitid)) throw new Error('Duplicate FITID in statement');
        ids.add(fitid);
        const sourceAmount = tag(block, 'TRNAMT');
        if (sourceAmount === undefined) throw new Error('TRNAMT is missing');
        transactions.push({
          id: await sha256(`${accountId}|ofx|${fitid}`),
          institutionAccountId: accountId,
          postedDate: ofxDate(tag(block, 'DTPOSTED')),
          amount: exactAmount(sourceAmount),
          sourceAmount,
          description: decode([tag(block, 'NAME'), tag(block, 'MEMO')].filter(Boolean).join(' — ')),
          pending: false,
          removedAtSource: false,
          source: { kind: 'file', name: safeText(name), hash, row: fitid },
        });
      } catch (error) {
        throw new Error(`${name}, transaction ${i + 1}: ${(error as Error).message}`, { cause: error });
      }
    }
  const ledger = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i.exec(text)?.[1];
  const bal = investment ? tag(text, 'TOTAL') : ledger ? tag(ledger, 'BALAMT') : undefined;
  return {
    transactions,
    period,
    hash,
    warnings: investment ? ['Investment OFX imports the account total only.'] : [],
    balance:
      bal !== undefined
        ? {
            value: exactAmount(bal),
            asOf: ofxDate(tag(ledger ?? text, 'DTASOF')),
            unavailable: false,
            periods: [period],
          }
        : undefined,
  };
}
