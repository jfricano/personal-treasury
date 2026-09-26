import { useEffect, useRef, useState } from 'react';
import { Treasury } from '@/api/treasury';
import { App } from '@/app/App';
import { IndexedDbStorage } from '@/db/storage';
import { CloudClient } from './client';
import { decryptSnapshot } from './crypto';
import { CloudAccessForm, type CloudCredentials } from './CloudAccessForm';
import { CloudSyncSession } from './session';
import {
  forgetPrivateSession,
  PRIVATE_IDLE_MS,
  readPrivateSession,
  rememberPrivateSession,
} from './privateSession';

/** The private web build opens its local copy only after cloud credentials work. */
export function PrivateBoot({ wasmUrl }: { wasmUrl: string }) {
  const [opened, setOpened] = useState<{
    treasury: Treasury;
    session: CloudSyncSession;
    credentials: CloudCredentials;
  } | null>(null);
  const [restoring, setRestoring] = useState(() => readPrivateSession() !== null);
  const [restoreError, setRestoreError] = useState('');
  const attempt = useRef(0);

  const open = async ({ token, passphrase, confirmation }: CloudCredentials, currentAttempt: number) => {
    if (passphrase.length < 12) throw new Error('Use a sync passphrase of at least 12 characters.');
    const client = new CloudClient({ token });
    const head = await client.getHead();
    if (head.revision === 0 && passphrase !== confirmation)
      throw new Error('Repeat the passphrase before creating the first cloud snapshot.');
    if (head.revision > 0) {
      const current = await client.getVersion(head.revision);
      await decryptSnapshot(current.envelope, passphrase);
    }
    if (currentAttempt !== attempt.current) return;
    const treasury = await Treasury.open({
      storage: new IndexedDbStorage(),
      profile: 'default',
      locateWasm: () => wasmUrl,
    });
    if (currentAttempt !== attempt.current) return;
    const session = new CloudSyncSession(treasury, client, passphrase, window.location.origin);
    await session.start();
    if (currentAttempt !== attempt.current) {
      session.close();
      return;
    }
    const status = session.getStatus();
    if (status.phase === 'error' || status.phase === 'offline') {
      session.close();
      throw new Error(status.message);
    }
    const credentials = { token, passphrase };
    rememberPrivateSession(credentials);
    setOpened({ treasury, session, credentials });
    setRestoring(false);
    setRestoreError('');
  };

  useEffect(() => {
    const saved = readPrivateSession();
    if (!saved) {
      setRestoring(false);
      return;
    }
    const currentAttempt = ++attempt.current;
    void open(saved, currentAttempt).catch((error: unknown) => {
      if (currentAttempt !== attempt.current) return;
      setRestoreError(error instanceof Error ? error.message : 'Could not resume the cloud session.');
      setRestoring(false);
    });
    const attemptRef = attempt;
    return () => {
      attemptRef.current++;
    };
    // Restore only on mount; a fresh manual connection uses the same open path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logOut = () => {
    attempt.current++;
    forgetPrivateSession();
    opened?.session.close();
    setOpened(null);
    setRestoring(false);
    setRestoreError('');
  };

  useEffect(() => {
    if (!opened) return;
    let lastActivityAt = Date.now();
    let lastWriteAt = lastActivityAt;
    const checkIdle = () => {
      if (Date.now() - lastActivityAt >= PRIVATE_IDLE_MS) logOut();
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityAt >= PRIVATE_IDLE_MS) {
        logOut();
        return;
      }
      lastActivityAt = now;
      if (now - lastWriteAt >= 15_000) {
        rememberPrivateSession(opened.credentials, now);
        lastWriteAt = now;
      }
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;
    for (const event of events) window.addEventListener(event, onActivity, true);
    document.addEventListener('visibilitychange', checkIdle);
    const interval = window.setInterval(checkIdle, 15_000);
    return () => {
      for (const event of events) window.removeEventListener(event, onActivity, true);
      document.removeEventListener('visibilitychange', checkIdle);
      window.clearInterval(interval);
    };
    // Session listeners are replaced only when a different session opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const connect = async (credentials: CloudCredentials) => {
    const currentAttempt = ++attempt.current;
    await open(credentials, currentAttempt);
  };

  const retry = () => {
    const saved = readPrivateSession();
    if (!saved) {
      setRestoreError('');
      return;
    }
    setRestoring(true);
    const currentAttempt = ++attempt.current;
    void open(saved, currentAttempt).catch((error: unknown) => {
      if (currentAttempt !== attempt.current) return;
      setRestoreError(error instanceof Error ? error.message : 'Could not resume the cloud session.');
      setRestoring(false);
    });
  };

  if (opened)
    return (
      <App
        treasury={opened.treasury}
        syncSession={opened.session}
        onLogout={logOut}
        switchProfile={() => {
          throw new Error('The private web app uses one local profile.');
        }}
      />
    );

  return (
    <div className="cloud-gate">
      <div className="panel">
        <header>Personal Treasury · Private</header>
        <div className="body">
          {restoring ? (
            <p role="status">Checking the cloud and restoring this tab…</p>
          ) : (
            <>
              {restoreError && (
                <div role="alert" className="cloud-restore-error">
                  <p>Could not resume this tab: {restoreError}</p>
                  <button className="btn" type="button" onClick={retry}>
                    Retry saved session
                  </button>{' '}
                  <button className="btn" type="button" onClick={logOut}>
                    Forget session
                  </button>
                </div>
              )}
              <p style={{ marginTop: 0 }}>
                Enter the access token and sync passphrase for your private snapshot service. Your treasury
                data is decrypted on this device.
              </p>
              <CloudAccessForm desktop={false} onConnect={connect} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
