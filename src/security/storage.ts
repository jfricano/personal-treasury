import type { DatabaseStorage } from '@/db/storage';
import { encryptObject, decryptObject, type Envelope } from './crypto';
/** Includes safety copies: no plaintext is handed to the underlying persistent store. */
export class EncryptedStorage implements DatabaseStorage {
  readonly kind: DatabaseStorage['kind'];
  constructor(
    private backing: DatabaseStorage,
    private key: CryptoKey,
    private namespace: string,
  ) {
    this.kind = backing.kind;
  }
  async load(name: string) {
    const value = await this.backing.load(`${this.namespace}:${name}`);
    if (!value) return null;
    const e = JSON.parse(new TextDecoder().decode(value)) as Envelope;
    return decryptObject(this.key, e, { purpose: 'local', ref: name, rev: e.rev });
  }
  async save(name: string, value: Uint8Array) {
    const e = await encryptObject(this.key, value, { purpose: 'local', ref: name, rev: 1 });
    await this.backing.save(`${this.namespace}:${name}`, new TextEncoder().encode(JSON.stringify(e)));
  }
  async list() {
    return (await this.backing.list())
      .filter((n) => n.startsWith(`${this.namespace}:`))
      .map((n) => n.slice(this.namespace.length + 1));
  }
  async remove(name: string) {
    await this.backing.remove(`${this.namespace}:${name}`);
  }
}
