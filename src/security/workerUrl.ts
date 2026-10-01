import bundledWorkerUrl from './kdf.worker.ts?worker&url';
interface Policy {
  createScriptURL(input: string): unknown;
}
interface Factory {
  createPolicy(name: string, options: { createScriptURL: (input: string) => string }): Policy;
}
let policy: Policy | undefined;
/** This policy accepts exactly the bundled KDF worker; it never trusts user-supplied URLs or HTML. */
export function kdfWorkerUrl(): string {
  const url = new URL(bundledWorkerUrl, location.href).href;
  const factory = (globalThis as typeof globalThis & { trustedTypes?: Factory }).trustedTypes;
  if (!factory) return url;
  policy ??= factory.createPolicy('pt-worker', {
    createScriptURL(input) {
      if (input !== url || new URL(input).origin !== location.origin) throw new Error('Untrusted worker URL');
      return input;
    },
  });
  return policy.createScriptURL(url) as string;
}
