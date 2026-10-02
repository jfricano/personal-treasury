import type { DatabaseStorage } from '@/db/storage';
import type { SecurityClient } from './client';
import { encryptObject, decryptObject, type Envelope } from './crypto';
import { sha256 } from '@/import/statements';
import type { ProviderVault } from '@/sources/plaid';
/** Keep an encrypted outgoing vault until the conditional write is acknowledged. */
export class VaultOutbox {
  constructor(
    private local: Pick<DatabaseStorage, 'load' | 'save' | 'remove'>,
    private client: Pick<SecurityClient, 'request'>,
    private key: CryptoKey,
    private id: string,
    private kid: string,
  ) {}
  private get name() {
    return `v3-vault-outbox:${this.id}`;
  }
  async read(): Promise<{ revision: number; vault: ProviderVault }> {
    let remote = await this.client.request<{ revision: number; envelope?: Envelope }>('/api/vault');
    const saved = await this.local.load(this.name);
    if (saved) {
      const pending = JSON.parse(new TextDecoder().decode(saved)) as Envelope;
      await decryptObject(this.key, pending, { purpose: 'vault', ref: 'credentials', rev: pending.rev });
      if (remote.revision === pending.rev - 1) {
        await this.client.request('/api/vault', 'PUT', { envelope: pending }, pending.rev - 1);
        remote = { revision: pending.rev, envelope: pending };
      } else if (
        remote.revision !== pending.rev ||
        !remote.envelope ||
        (await sha256(JSON.stringify(remote.envelope))) !== (await sha256(JSON.stringify(pending)))
      ) {
        throw new Error(
          'The provider vault changed on another device. Its encrypted pending copy is retained; resolve it before creating another connection.',
        );
      }
      await this.local.remove(this.name);
    }
    return {
      revision: remote.revision,
      vault: remote.envelope
        ? JSON.parse(
            new TextDecoder().decode(
              await decryptObject(this.key, remote.envelope, {
                purpose: 'vault',
                ref: 'credentials',
                rev: remote.revision,
              }),
            ),
          )
        : {},
    };
  }
  async write(vault: ProviderVault, revision: number) {
    if (await this.local.load(this.name))
      throw new Error(
        'A provider vault save is pending. Refresh the vault to resume it before making more changes.',
      );
    const envelope = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(vault)), {
      purpose: 'vault',
      ref: 'credentials',
      rev: revision + 1,
      kid: this.kid,
    });
    await this.local.save(this.name, new TextEncoder().encode(JSON.stringify(envelope)));
    await this.client.request('/api/vault', 'PUT', { envelope }, revision);
    await this.local.remove(this.name);
  }
}
