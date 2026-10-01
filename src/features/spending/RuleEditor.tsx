import { useState } from 'react';
import { Dialog, Field } from '@/components/ui';
import { exactAmount, type Rule, type InstitutionAccount, type PlannedLine } from '@/domain/spending';
import { cmp } from '@/domain/money';
export function RuleEditor({
  rule,
  accounts,
  lines,
  onSave,
  onClose,
}: {
  rule: Rule;
  accounts: InstitutionAccount[];
  lines: PlannedLine[];
  onSave: (rule: Rule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(rule),
    [error, setError] = useState('');
  const patch = (value: Partial<Rule>) => setDraft({ ...draft, ...value });
  return (
    <Dialog open title="Edit categorization rule" onClose={onClose}>
      <form
        className="v3-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const min = draft.min ? exactAmount(draft.min) : undefined,
              max = draft.max ? exactAmount(draft.max) : undefined;
            if ((min && cmp(min, '0') < 0) || (max && cmp(max, '0') < 0) || (min && max && cmp(min, max) > 0))
              throw new Error('Use a nonnegative amount range with minimum no greater than maximum.');
            onSave({ ...draft, min, max });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <p>Rules suggest classifications. They never accept transactions automatically.</p>
        <Field label="Description pattern">
          <input
            className="box"
            required
            value={draft.pattern}
            onChange={(e) => patch({ pattern: e.target.value })}
          />
        </Field>
        <Field label="Match">
          <select
            className="box"
            value={draft.match}
            onChange={(e) => patch({ match: e.target.value as Rule['match'] })}
          >
            {['contains', 'starts_with', 'equals'].map((m) => (
              <option key={m} value={m}>
                {m.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Institution account">
          <select
            className="box"
            value={draft.accountId ?? ''}
            onChange={(e) => patch({ accountId: e.target.value || undefined })}
          >
            <option value="">Any account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Merchant contains">
          <input
            className="box"
            value={draft.merchant ?? ''}
            onChange={(e) => patch({ merchant: e.target.value || undefined })}
          />
        </Field>
        <Field label="Direction">
          <select
            className="box"
            value={draft.direction}
            onChange={(e) => patch({ direction: e.target.value as Rule['direction'] })}
          >
            {['any', 'inflow', 'outflow'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Minimum absolute amount">
            <input
              className="box"
              value={draft.min ?? ''}
              onChange={(e) => patch({ min: e.target.value || undefined })}
            />
          </Field>
          <Field label="Maximum absolute amount">
            <input
              className="box"
              value={draft.max ?? ''}
              onChange={(e) => patch({ max: e.target.value || undefined })}
            />
          </Field>
        </div>
        <Field label="Suggested classification">
          <select
            className="box"
            value={draft.action.kind}
            onChange={(e) => {
              const kind = e.target.value as Rule['action']['kind'];
              patch({
                action:
                  kind === 'budget'
                    ? { kind, lineKey: lines[0]?.lineKey ?? '' }
                    : kind === 'income'
                      ? { kind, incomeKind: 'take_home' }
                      : kind === 'transfer'
                        ? { kind, counterparty: 'own_unconnected' }
                        : kind === 'excluded'
                          ? { kind, reason: 'other', note: '' }
                          : { kind },
              });
            }}
          >
            {['budget', 'income', 'transfer', 'unbudgeted', 'excluded'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        {draft.action.kind === 'budget' && (
          <Field label="Budget line">
            <select
              className="box"
              required
              value={draft.action.lineKey}
              onChange={(e) => patch({ action: { kind: 'budget', lineKey: e.target.value } })}
            >
              <option value="">Choose a line</option>
              {!lines.some((l) => l.lineKey === (draft.action as { lineKey: string }).lineKey) &&
                draft.action.lineKey && <option value={draft.action.lineKey}>Stale line</option>}
              {lines.map((l) => (
                <option key={l.lineKey} value={l.lineKey}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {draft.action.kind === 'income' && (
          <Field label="Income kind">
            <select
              className="box"
              value={draft.action.incomeKind}
              onChange={(e) =>
                patch({ action: { kind: 'income', incomeKind: e.target.value as 'take_home' | 'other' } })
              }
            >
              <option value="take_home">Take-home pay</option>
              <option value="other">Other income</option>
            </select>
          </Field>
        )}
        {draft.action.kind === 'excluded' && (
          <>
            <Field label="Exclusion reason">
              <select
                className="box"
                value={draft.action.reason}
                onChange={(e) =>
                  patch({
                    action: {
                      kind: 'excluded',
                      reason: e.target.value as Extract<Rule['action'], { kind: 'excluded' }>['reason'],
                      note: draft.action.kind === 'excluded' ? draft.action.note : '',
                    },
                  })
                }
              >
                {['reimbursable', 'not_household', 'duplicate_at_source', 'adjustment', 'other'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Exclusion note">
              <input
                className="box"
                required={draft.action.reason === 'other'}
                value={draft.action.note ?? ''}
                onChange={(e) =>
                  patch({
                    action: {
                      ...(draft.action as Extract<Rule['action'], { kind: 'excluded' }>),
                      note: e.target.value,
                    },
                  })
                }
              />
            </Field>
          </>
        )}
        <Field label="Priority">
          <input
            className="box"
            type="number"
            step="1"
            value={draft.position}
            onChange={(e) => patch({ position: Number(e.target.value) })}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        <button className="btn primary">Save rule</button>
      </form>
    </Dialog>
  );
}
