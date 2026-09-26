import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '@/app/context';
import { Panel, useConfirm } from '@/components/ui';
import type { CloudVersionMeta } from './client';
import { CloudAccessForm } from './CloudAccessForm';
import type { CloudSyncSession } from './session';

function ConnectedCloud({ session }: { session: CloudSyncSession }) {
  const { toast } = useApp();
  const confirm = useConfirm();
  const status = useSyncExternalStore(session.subscribe, session.getStatus);
  const [versions, setVersions] = useState<CloudVersionMeta[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    session.client
      .getVersions()
      .then(setVersions)
      .catch(() => undefined);
  }, [session, status.revision]);

  const perform = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      const current = session.getStatus();
      if (current.phase === 'conflict' || current.phase === 'error' || current.phase === 'offline')
        throw new Error(current.message);
      setVersions(await session.client.getVersions());
      toast(success, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Cloud action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Cloud sync">
      <p style={{ marginTop: 0 }} role="status">
        <b>
          {status.phase === 'synced'
            ? 'Up to date'
            : status.phase === 'conflict'
              ? 'Needs a choice'
              : status.phase}
        </b>
        {' · '}cloud version {status.revision}
        {' · '}
        {status.message}
      </p>
      <div className="btn-row">
        <button
          className="btn"
          disabled={busy}
          onClick={() => void perform(() => session.syncNow(), 'Cloud checked')}
        >
          Sync now
        </button>
      </div>
      {status.phase === 'conflict' && (
        <div className="cloud-conflict" role="alert">
          <p>
            This device and the cloud both changed. Both copies can be preserved; choose which one should
            become current.
          </p>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm.ask(
                    'Use the cloud copy on this device? The current device copy will be saved as a local safety copy first.',
                    { confirmLabel: 'Use cloud copy' },
                  )
                )
                  await perform(() => session.useCloud(), 'Cloud copy opened');
              }}
            >
              Use cloud copy
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm.ask(
                    'Make this device’s copy the newest cloud version? The current cloud copy will remain in version history.',
                    { confirmLabel: 'Keep device copy' },
                  )
                )
                  await perform(() => session.keepLocal(), 'Device copy uploaded');
              }}
            >
              Keep this device’s copy
            </button>
          </div>
        </div>
      )}
      <h3>Cloud versions</h3>
      <p className="small subtle">
        Every successful upload creates a recoverable version. Restoring an older one creates a new version;
        it does not erase history.
      </p>
      <ul className="issues">
        {versions.map((version) => (
          <li key={version.revision}>
            <span>
              <b>v{version.revision}</b> · {new Date(version.createdAt).toLocaleString()}
              {version.label ? ` · ${version.label}` : ''}
            </span>
            <button
              className="btn small"
              disabled={busy || version.revision === status.revision || status.phase === 'conflict'}
              onClick={async () => {
                if (
                  await confirm.ask(
                    `Restore cloud version ${version.revision} as the newest version? A local safety copy will be saved.`,
                    { confirmLabel: 'Restore version' },
                  )
                )
                  await perform(
                    () => session.restoreVersion(version.revision),
                    `Version ${version.revision} restored`,
                  );
              }}
            >
              Restore
            </button>
          </li>
        ))}
        {versions.length === 0 && <li className="subtle">No cloud versions yet.</li>}
      </ul>
      {confirm.element}
    </Panel>
  );
}

export function CloudPanel() {
  const { syncSession, connectCloud } = useApp();
  if (syncSession) return <ConnectedCloud session={syncSession} />;
  if (import.meta.env.MODE === 'demo') return null;
  return (
    <Panel title="Cloud sync">
      <p style={{ marginTop: 0 }}>
        Connect this device to your private snapshot service. Local changes continue to save when the service
        is unavailable and will be checked before upload.
      </p>
      <CloudAccessForm
        desktop={true}
        onConnect={async (credentials) => {
          await connectCloud(credentials);
        }}
      />
    </Panel>
  );
}
