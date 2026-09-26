import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { CommitInput, Panel, useConfirm } from '@/components/ui';

export function AccountsPage() {
  const { t, run, navigate } = useTreasury();
  const accounts = t.accounts();
  const [newName, setNewName] = useState('');
  const confirm = useConfirm();
  const warnings = t
    .importWarnings()
    .filter((w) => w.code === 'conflicting_party' || w.code === 'unknown_code');

  const remove = async (id: string) => {
    const name = t.nameOf(id);
    if (await confirm.ask(`Delete unused account ${name}?`, { danger: true, confirmLabel: 'Delete' }))
      run(() => t.deleteAccount(id), `${name} deleted`);
  };

  return (
    <>
      <div className="page-head">
        <h2>Accounts</h2>
        <span className="subtle">Name your money buckets and archive any you no longer use.</span>
      </div>
      <Panel
        title="Account buckets"
        actions={
          <form
            className="btn-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (run(() => t.createNamedAccount(newName), `${newName.trim()} created`)) setNewName('');
            }}
          >
            <input
              className="box"
              aria-label="New account name"
              placeholder="New account name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ width: 190 }}
            />
            <button className="btn small primary" disabled={!newName.trim()}>
              Add account
            </button>
          </form>
        }
      >
        <table className="t" aria-label="Accounts">
          <thead>
            <tr>
              <th className="l">Order</th>
              <th className="l">Name</th>
              <th className="l">Description</th>
              <th className="l">Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => {
              const name = t.nameOf(a.id);
              const canDelete = t.repos.accountReferenceCount(a.id) === 0;
              return (
                <tr key={a.id} className={a.active ? '' : 'muted'}>
                  <td className="nowrap">
                    <button
                      className="btn small"
                      aria-label={`Move ${name} up`}
                      disabled={i === 0}
                      onClick={() => run(() => t.moveAccount(a.id, -1))}
                    >
                      ↑
                    </button>{' '}
                    <button
                      className="btn small"
                      aria-label={`Move ${name} down`}
                      disabled={i === accounts.length - 1}
                      onClick={() => run(() => t.moveAccount(a.id, 1))}
                    >
                      ↓
                    </button>
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <CommitInput
                      ariaLabel={`${name} name`}
                      value={name}
                      onCommit={(value) => run(() => t.updateAccount(a.id, { displayName: value }))}
                    />
                    {a.needsReview && (
                      <div className="small" style={{ marginTop: 4 }}>
                        <span className="badge review">Imported unknown</span>{' '}
                        <button
                          className="btn link small"
                          onClick={() =>
                            run(
                              () => t.updateAccount(a.id, { needsReview: false }),
                              `${name} marked reviewed`,
                            )
                          }
                        >
                          Mark reviewed
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 260 }}>
                    <CommitInput
                      multiline
                      ariaLabel={`${name} description`}
                      value={a.description ?? ''}
                      onCommit={(value) => run(() => t.updateAccount(a.id, { description: value || null }))}
                    />
                  </td>
                  <td>
                    <label className="small">
                      <input
                        type="checkbox"
                        checked={a.active}
                        onChange={(e) =>
                          run(
                            () => t.updateAccount(a.id, { active: e.target.checked }),
                            e.target.checked ? `${name} restored` : `${name} archived`,
                          )
                        }
                      />{' '}
                      {a.active ? 'Active' : 'Archived'}
                    </label>
                  </td>
                  <td>
                    {canDelete && (
                      <button
                        className="btn small danger"
                        aria-label={`Delete ${name}`}
                        onClick={() => remove(a.id)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="subtle">
                  No accounts yet. Add one above or import a workbook.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="small subtle" style={{ marginBottom: 0 }}>
          Archived accounts stay in this list so you can restore them. Accounts used by budgets, months,
          transfers or debts cannot be deleted.
        </p>
        {warnings.length > 0 && (
          <details className="sec" style={{ marginTop: 10 }}>
            <summary>Account questions from import ({warnings.length})</summary>
            <div className="body">
              <ul className="warn-list">
                {warnings.map((w) => (
                  <li key={w.id} className="small">
                    {w.message}{' '}
                    <span className="loc">
                      {w.sheet}
                      {w.cell ? `!${w.cell}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </Panel>
      <Panel title="Monthly allocations">
        <p style={{ margin: 0 }}>
          Monthly allocations come from the budget. Edit each line and its funding account in{' '}
          <button className="btn link" onClick={() => navigate({ page: 'budget' })}>
            Budget and tax
          </button>
          .
        </p>
      </Panel>
      {confirm.element}
    </>
  );
}
