import { Panel } from '@/components/ui';
export function ProviderPanel() {
  return (
    <Panel title="Provider connections">
      <p>
        The desktop app can connect to institutions through Plaid. This public demo uses fictional statements
        and never connects to a provider.
      </p>
    </Panel>
  );
}
export async function plaidRequest(): Promise<never> {
  throw new Error('Provider connections are unavailable in the public demo.');
}
export async function gatherPlaid(): Promise<never> {
  throw new Error('Use fictional statements in the public demo.');
}
