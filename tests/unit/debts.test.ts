import { describe, expect, it } from 'vitest';
import {
  debtPosition,
  paymentToChange,
  previewChange,
  rollForward,
  summarizeDebts,
  suggestChangeForTransfer,
} from '@/domain/debts';
import type { Debt, DebtEvent } from '@/domain/types';

const debt: Debt = {
  id: 'd1',
  loanId: 'X',
  openedDate: '2026-01-01',
  description: 'Loan X',
  originDebtorAccountId: 'HH',
  originCreditorAccountId: 'LTS',
  terms: '3 months',
};
let seq = 0;
const ev = (changeAmount: string, eventDate = '2026-01-01', notes: string | null = null): DebtEvent => ({
  id: `e${++seq}`,
  debtId: 'd1',
  eventDate,
  sequence: seq,
  changeAmount,
  description: null,
  notes,
  journalEntryId: null,
});

describe('AT5 debt roll-forward', () => {
  const events = [ev('300')];
  it('opens at 300', () => {
    const r = rollForward(events);
    expect(r[0]).toMatchObject({ priorBalance: '0', remainingBalance: '300', status: 'OPEN' });
  });
  it('payment -125 leaves HH owing LTS 175', () => {
    events.push(ev('-125', '2026-02-01'));
    const r = rollForward(events);
    expect(r[1]).toMatchObject({ priorBalance: '300', remainingBalance: '175' });
    const s = summarizeDebts([debtPosition(debt, events)]);
    expect(s.included[0]).toMatchObject({
      owedByAccountId: 'HH',
      owedToAccountId: 'LTS',
      displayBalance: '175',
    });
  });
  it('payment -175 pays it off and removes it from the summary', () => {
    events.push(ev('-175', '2026-03-01'));
    const p = debtPosition(debt, events);
    expect(p.currentBalance).toBe('0');
    expect(p.status).toBe('PAID');
    expect(summarizeDebts([p]).nonZeroCount).toBe(0);
  });
  it('adjustment -25 reverses direction: LTS owes HH 25', () => {
    events.push(ev('-25', '2026-04-01'));
    const p = debtPosition(debt, events);
    expect(p.currentBalance).toBe('-25');
    expect(p.status).toBe('CREDIT');
    const s = summarizeDebts([p]);
    expect(s.included[0]).toMatchObject({
      owedByAccountId: 'LTS',
      owedToAccountId: 'HH',
      displayBalance: '25',
    });
    expect(s.netSum).toBe('0');
  });
  it('orders by date then sequence', () => {
    const r = rollForward([ev('10', '2026-05-02'), ev('5', '2026-05-01'), ev('1', '2026-05-01')]);
    expect(r.map((e) => e.changeAmount)).toEqual(['5', '1', '10']);
  });
  it('converts positive payments to signed changes relative to current direction', () => {
    expect(paymentToChange('175', '25')).toBe('-25');
    expect(paymentToChange('-25', '10')).toBe('10');
  });
  it('previews an overpayment that crosses zero', () => {
    const pv = previewChange(debt, [ev('100')], '-150', '2026-06-01');
    expect(pv.after.currentBalance).toBe('-50');
    expect(pv.after.owedByAccountId).toBe('LTS');
    expect(pv.directionChanges).toBe(true);
  });
  it('suggests changes for transfers between origin parties', () => {
    expect(suggestChangeForTransfer(debt, { fromAccountId: 'HH', toAccountId: 'LTS', amount: '50' })).toBe(
      '-50',
    );
    expect(suggestChangeForTransfer(debt, { fromAccountId: 'LTS', toAccountId: 'HH', amount: '50' })).toBe(
      '50',
    );
    expect(
      suggestChangeForTransfer(debt, { fromAccountId: 'ENT', toAccountId: 'HH', amount: '50' }),
    ).toBeNull();
  });
});

describe('AT7 canceled-note behavior', () => {
  it('keeps a non-zero canceled debt in the summary and flags it', () => {
    const events = [
      ev('190', '2025-02-01', '3 mos'),
      ev('-127', '2025-03-01'),
      ev('0', '2025-05-01', 'canceled'),
    ];
    const p = debtPosition({ ...debt, terms: '3 mos' }, events);
    expect(p.currentBalance).toBe('63');
    expect(p.reviewNote).toBe(true);
    expect(p.displayNotes).toBe('canceled');
    expect(p.status).toBe('OPEN');
    expect(summarizeDebts([p]).nonZeroCount).toBe(1);
    expect(p.events).toHaveLength(3);
  });
  it('shows origin terms when the latest event has no note', () => {
    const p = debtPosition({ ...debt, terms: 'New' }, [
      ev('500', '2026-01-01', 'New'),
      ev('-200', '2026-02-01'),
    ]);
    expect(p.displayNotes).toBe('New');
  });
});
