import { useState } from 'react';
import { Dialog, Field } from '@/components/ui';
import {
  dispositionErrors,
  exactAmount,
  type Disposition,
  type ReviewBudget,
  type Transaction,
} from '@/domain/spending';
import { formatUSD } from '@/domain/money';
export function ClassificationDialog({
  transaction,
  budget,
  transactions,
  onClose,
  onSave,
}: {
  transaction: Transaction;
  budget: ReviewBudget;
  transactions: Transaction[];
  onClose: () => void;
  onSave: (d: Disposition) => void;
}) {
  const [kind, setKind] = useState(transaction.disposition?.kind ?? 'budget'),
    [parts, setParts] = useState(
      transaction.disposition?.kind === 'budget'
        ? transaction.disposition.parts
        : [{ lineKey: budget.lines[0]?.lineKey ?? '', amount: transaction.amount }],
    ),
    [note, setNote] = useState(''),
    [reason, setReason] = useState<
      'reimbursable' | 'not_household' | 'duplicate_at_source' | 'adjustment' | 'other'
    >('other'),
    [income, setIncome] = useState<'take_home' | 'other'>('take_home'),
    [error, setError] = useState('');
  return (
    <Dialog open title="Classify transaction" onClose={onClose}>
      <p>
        {transaction.postedDate} · {transaction.description} · {formatUSD(transaction.amount)}
      </p>
      <form
        className="v3-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const d: Disposition =
              kind === 'budget'
                ? {
                    kind,
                    state: 'accepted',
                    parts: parts.map((p) => ({ ...p, amount: exactAmount(p.amount) })),
                  }
                : kind === 'income'
                  ? { kind, state: 'accepted', incomeKind: income }
                  : kind === 'excluded'
                    ? { kind, state: 'accepted', reason, note }
                    : kind === 'transfer'
                      ? { kind, state: 'accepted', counterparty: 'own_unconnected' }
                      : { kind: 'unbudgeted', state: 'accepted' };
            const errors = dispositionErrors(
              transaction,
              d,
              new Set(budget.lines.map((l) => l.lineKey)),
              transactions,
            );
            if (errors.length) throw new Error(errors.join('; '));
            onSave(d);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <Field label="Classification">
          <select
            className="box"
            value={kind}
            onChange={(e) => setKind(e.target.value as Disposition['kind'])}
          >
            {['budget', 'income', 'transfer', 'unbudgeted', 'excluded'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        {kind === 'budget' && (
          <>
            {parts.map((p, i) => (
              <div className="grid-2" key={i}>
                <Field label={`Budget line ${i + 1}`}>
                  <select
                    className="box"
                    value={p.lineKey}
                    onChange={(e) =>
                      setParts(parts.map((x, j) => (i === j ? { ...x, lineKey: e.target.value } : x)))
                    }
                  >
                    {budget.lines.map((l) => (
                      <option value={l.lineKey} key={l.lineKey}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Signed amount ${i + 1}`}>
                  <input
                    className="box"
                    value={p.amount}
                    onChange={(e) =>
                      setParts(parts.map((x, j) => (i === j ? { ...x, amount: e.target.value } : x)))
                    }
                  />
                </Field>
                {parts.length > 1 && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setParts(parts.filter((_, j) => j !== i))}
                  >
                    Remove part {i + 1}
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() => setParts([...parts, { lineKey: budget.lines[0]?.lineKey ?? '', amount: '' }])}
            >
              Add split part
            </button>
          </>
        )}
        {kind === 'income' && (
          <Field label="Income kind">
            <select
              className="box"
              value={income}
              onChange={(e) => setIncome(e.target.value as typeof income)}
            >
              <option value="take_home">Take-home pay</option>
              <option value="other">Other income</option>
            </select>
          </Field>
        )}
        {kind === 'transfer' && (
          <p>
            Use this for a transfer to another account you own that is outside this review. Use Pair on the
            transaction list when both sides are present.
          </p>
        )}
        {kind === 'excluded' && (
          <>
            <Field label="Exclusion reason">
              <select
                className="box"
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
              >
                {['reimbursable', 'not_household', 'duplicate_at_source', 'adjustment', 'other'].map((r) => (
                  <option key={r} value={r}>
                    {r.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Exclusion note">
              <input className="box" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary">Accept classification</button>
      </form>
    </Dialog>
  );
}
