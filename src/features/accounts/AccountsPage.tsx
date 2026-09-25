import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { CommitInput, Dialog, Field, Panel, useConfirm } from '@/components/ui';

export function AccountsPage() {
  const { t, run, toast, navigate } = useTreasury();
  const accounts = t.accounts();
  const aliases = t.aliases();
  const [newCode, setNewCode] = useState('');
  const [aliasFor, setAliasFor] = useState<{ id: string; text: string } | null>(null);
  const confirm = useConfirm();
  const warnings = t.importWarnings();

  const del = async (id: string, code: string) => {
    const refs = t.repos.accountReferenceCount(id);
    if (refs > 0) {
      toast(`${code} is used by ${refs} record(s) and cannot be deleted. Archive it instead.`, 'error');
      return;
    }
    if (await confirm.ask(`Delete unused account ${code}?`, { danger: true, confirmLabel: 'Delete' }))
      run(() => t.deleteAccount(id), `${code} deleted`);
  };

  return (
    <>
      <div className="page-head">
        <h2>Accounts</h2>
        <span className="subtle">
          Account codes are your own buckets. The app never renames, merges or reinterprets them.
        </span>
      </div>
      <Panel
        title="Account buckets"
        actions={
          <form
            className="btn-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (run(() => t.createAccount({ code: newCode }), `Account ${newCode.toUpperCase()} created`))
                setNewCode('');
            }}
          >
            <input
              className="box"
              aria-label="New account code"
              placeholder="New code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              style={{ width: 110, textTransform: 'uppercase' }}
            />
            <button className="btn small primary" disabled={!newCode.trim()}>
              Add account
            </button>
          </form>
        }
      >
        <table className="t" aria-label="Accounts">
          <thead>
            <tr>
              <th className="l">Order</th>
              <th className="l">Code</th>
              <th className="l">Display name</th>
              <th className="l">Description</th>
              <th className="l">Aliases</th>
              <th className="l">Color</th>
              <th className="l">Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => {
              const mine = aliases.filter((x) => x.accountId === a.id);
              const warn = a.needsReview;
              return (
                <tr key={a.id} className={a.active ? '' : 'muted'}>
                  <td className="nowrap">
                    <button
                      className="btn small"
                      aria-label={`Move ${a.code} up`}
                      disabled={i === 0}
                      onClick={() => run(() => t.moveAccount(a.id, -1))}
                    >
                      ↑
                    </button>{' '}
                    <button
                      className="btn small"
                      aria-label={`Move ${a.code} down`}
                      disabled={i === accounts.length - 1}
                      onClick={() => run(() => t.moveAccount(a.id, 1))}
                    >
                      ↓
                    </button>
                  </td>
                  <td className="nowrap">
                    <span
                      className="code"
                      style={a.color ? { borderLeft: `4px solid ${a.color}`, paddingLeft: 6 } : undefined}
                    >
                      {a.code}
                    </span>
                    {warn && (
                      <>
                        {' '}
                        <span className="badge review" title="Imported code that needs your review">
                          Imported unknown
                        </span>{' '}
                        <button
                          className="btn link small"
                          onClick={() =>
                            run(
                              () => t.updateAccount(a.id, { needsReview: false }),
                              `${a.code} marked reviewed`,
                            )
                          }
                        >
                          Mark reviewed
                        </button>
                      </>
                    )}
                  </td>
                  <td style={{ width: 150 }}>
                    <CommitInput
                      ariaLabel={`${a.code} display name`}
                      value={a.displayName ?? ''}
                      onCommit={(v) => run(() => t.updateAccount(a.id, { displayName: v || null }))}
                    />
                  </td>
                  <td style={{ minWidth: 260 }}>
                    <CommitInput
                      multiline
                      ariaLabel={`${a.code} description`}
                      value={a.description ?? ''}
                      onCommit={(v) => run(() => t.updateAccount(a.id, { description: v || null }))}
                    />
                  </td>
                  <td>
                    {mine.map((al) => (
                      <span className="pill" key={al.alias}>
                        {al.originalText}
                        <button
                          aria-label={`Remove alias ${al.originalText}`}
                          onClick={async () => {
                            if (
                              await confirm.ask(
                                `Remove alias “${al.originalText}” → ${a.code}? Future imports will treat it as a separate account.`,
                              )
                            )
                              run(() => t.removeAlias(al.alias));
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button className="btn link small" onClick={() => setAliasFor({ id: a.id, text: '' })}>
                      + alias
                    </button>
                  </td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${a.code} color`}
                      value={a.color ?? '#1f3864'}
                      onChange={(e) => run(() => t.updateAccount(a.id, { color: e.target.value }))}
                      style={{ width: 32, height: 22, border: 0, background: 'none' }}
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
                            e.target.checked ? `${a.code} restored` : `${a.code} archived`,
                          )
                        }
                      />{' '}
                      {a.active ? 'Active' : 'Archived'}
                    </label>
                  </td>
                  <td>
                    <button
                      className="btn small danger"
                      aria-label={`Delete ${a.code}`}
                      onClick={() => del(a.id, a.code)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={8} className="subtle">
                  No accounts yet. Add one above or import your workbook.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="small subtle" style={{ marginBottom: 0 }}>
          Accounts used by any record cannot be deleted; archive them instead. Aliases map alternate spellings
          found in imports (for example “Splurge” → SPLG).
        </p>
        {warnings.filter((w) => w.code === 'conflicting_party' || w.code === 'unknown_code').length > 0 && (
          <details className="sec" style={{ marginTop: 10 }}>
            <summary>
              Account questions from import (
              {warnings.filter((w) => w.code === 'conflicting_party' || w.code === 'unknown_code').length})
            </summary>
            <div className="body">
              <ul className="warn-list">
                {warnings
                  .filter((w) => w.code === 'conflicting_party' || w.code === 'unknown_code')
                  .map((w) => (
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
          Monthly allocations now come from the budget: each budget line names the account that funds it, and
          new treasury months take the active version's totals. Edit them in{' '}
          <button className="btn link" onClick={() => navigate({ page: 'budget' })}>
            Budget and tax
          </button>
          .
        </p>
      </Panel>

      <Dialog
        open={!!aliasFor}
        title="Add alias"
        onClose={() => setAliasFor(null)}
        footer={
          <>
            <button className="btn" onClick={() => setAliasFor(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (
                  aliasFor &&
                  run(() => t.addAlias(aliasFor.text, aliasFor.id), 'Alias added') !== undefined
                )
                  setAliasFor(null);
              }}
            >
              Add alias
            </button>
          </>
        }
      >
        <Field label={`Alternate spelling for ${aliasFor ? t.codeOf(aliasFor.id) : ''}`}>
          <input
            className="box"
            autoFocus
            value={aliasFor?.text ?? ''}
            onChange={(e) => aliasFor && setAliasFor({ ...aliasFor, text: e.target.value })}
          />
        </Field>
        <p className="small subtle" style={{ margin: 0 }}>
          Matching trims whitespace and ignores case.
        </p>
      </Dialog>
      {confirm.element}
    </>
  );
}
