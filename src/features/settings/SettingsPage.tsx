import { useEffect, useState } from 'react';
import { useTreasury } from '@/app/context';
import { Field, Panel, useConfirm } from '@/components/ui';
import { CloudPanel } from '@/sync/CloudPanel';

export function SettingsPage() {
  const { t, toast, switchProfile, version, syncSession } = useTreasury();
  const [files, setFiles] = useState<string[]>([]);
  const [newProfile, setNewProfile] = useState('');
  const confirm = useConfirm();
  useEffect(() => {
    t.storage
      .list()
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [t, version]);
  const profiles = files.filter((f) => !f.includes('~'));
  const copies = files.filter((f) => f.startsWith(`${t.profile}~`));

  return (
    <>
      <div className="page-head">
        <h2>Settings</h2>
      </div>
      <CloudPanel />
      <div className="grid-2">
        {t.storage.kind === 'session' ? (
          <Panel title="Storage">
            <p className="small subtle" style={{ marginTop: 0 }}>
              This is the public demo. Its database lives in this browser tab only and is discarded when the
              tab closes. The desktop app keeps separate profiles as SQLite files on your computer.
            </p>
          </Panel>
        ) : import.meta.env.MODE === 'private' ? null : (
          <Panel title="Profiles (separate local databases)">
            <ul className="issues">
              {profiles.map((p) => (
                <li key={p}>
                  <span className="code">{p}</span>
                  {p === t.profile ? (
                    <span className="badge complete">Open</span>
                  ) : (
                    <button className="btn small" onClick={() => switchProfile(p)}>
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="btn-row"
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^[\w.-]+$/.test(newProfile))
                  return toast('Use letters, numbers, dot, dash or underscore.', 'error');
                if (profiles.includes(newProfile)) return toast('That profile already exists.', 'error');
                switchProfile(newProfile);
              }}
            >
              <Field label="New empty profile">
                <input
                  className="box"
                  value={newProfile}
                  onChange={(e) => setNewProfile(e.target.value)}
                  placeholder="e.g. test"
                />
              </Field>
              <button className="btn" disabled={!newProfile}>
                Create and open
              </button>
            </form>
            <p className="small subtle">
              Storage:{' '}
              {t.storage.kind === 'tauri'
                ? 'SQLite files in the app data folder'
                : t.storage.kind === 'indexeddb'
                  ? 'this browser’s local IndexedDB (development mode)'
                  : 'memory only'}
              .
            </p>
          </Panel>
        )}
        <Panel title="Safety copies">
          <p className="small subtle" style={{ marginTop: 0 }}>
            Saved automatically before an import replaces data or a backup is restored. They stay on this
            computer.
          </p>
          <ul className="issues">
            {copies.map((c) => (
              <li key={c}>
                <span className="loc">{c.split('~')[1]}</span>
                <button
                  className="btn small"
                  onClick={async () => {
                    if (
                      await confirm.ask(`Restore ${c}? Current data is saved as another safety copy first.`, {
                        confirmLabel: 'Restore',
                      })
                    ) {
                      try {
                        await t.restoreSafetyCopy(c);
                        toast('Safety copy restored', 'success');
                      } catch (err) {
                        toast((err as Error).message, 'error');
                      }
                    }
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
            {copies.length === 0 && <li className="subtle">None yet.</li>}
          </ul>
        </Panel>
      </div>
      <Panel title="Audit log (latest 200)">
        <table className="t">
          <thead>
            <tr>
              <th className="l">When</th>
              <th className="l">Action</th>
              <th className="l">Entity</th>
              <th className="l">Note</th>
            </tr>
          </thead>
          <tbody>
            {t.auditLog(200).map((a) => (
              <tr key={a.id}>
                <td className="loc nowrap">{a.at.slice(0, 19).replace('T', ' ')}</td>
                <td>{a.action}</td>
                <td>{a.entity}</td>
                <td className="small">{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Privacy">
        <p style={{ margin: 0 }}>
          Personal Treasury works offline and has no telemetry, analytics or remote logging.{' '}
          {syncSession
            ? 'When connected, encrypted database snapshots are sent to your private cloud service. The access token and sync passphrase stay in memory for this session.'
            : 'Your data remains on this device until you connect cloud sync or export a file.'}
        </p>
      </Panel>
      {confirm.element}
    </>
  );
}
