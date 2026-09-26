import { useState } from 'react';
import { Treasury } from '@/api/treasury';
import { App } from '@/app/App';
import { IndexedDbStorage } from '@/db/storage';
import { CloudClient } from './client';
import { decryptSnapshot } from './crypto';
import { CloudAccessForm, type CloudCredentials } from './CloudAccessForm';
import { CloudSyncSession } from './session';

/** The private web build opens its local copy only after cloud credentials work. */
export function PrivateBoot({ wasmUrl }: { wasmUrl: string }) {
  const [opened, setOpened] = useState<{ treasury: Treasury; session: CloudSyncSession } | null>(null);

  const connect = async ({ token, passphrase, confirmation }: CloudCredentials) => {
    if (passphrase.length < 12) throw new Error('Use a sync passphrase of at least 12 characters.');
    const client = new CloudClient({ token });
    const head = await client.getHead();
    if (head.revision === 0 && passphrase !== confirmation)
      throw new Error('Repeat the passphrase before creating the first cloud snapshot.');
    if (head.revision > 0) {
      const current = await client.getVersion(head.revision);
      await decryptSnapshot(current.envelope, passphrase);
    }
    const treasury = await Treasury.open({
      storage: new IndexedDbStorage(),
      profile: 'default',
      locateWasm: () => wasmUrl,
    });
    const session = new CloudSyncSession(treasury, client, passphrase, window.location.origin);
    await session.start();
    const status = session.getStatus();
    if (status.phase === 'error' || status.phase === 'offline') {
      session.close();
      throw new Error(status.message);
    }
    setOpened({ treasury, session });
  };

  if (opened)
    return (
      <App
        treasury={opened.treasury}
        syncSession={opened.session}
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
          <p style={{ marginTop: 0 }}>
            Enter the access token and sync passphrase for your private snapshot service. Your treasury data
            is decrypted on this device.
          </p>
          <CloudAccessForm desktop={false} onConnect={connect} />
        </div>
      </div>
    </div>
  );
}
