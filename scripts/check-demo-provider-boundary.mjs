import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = 'dist-demo/assets';
const forbidden = [
  'plaid_request',
  'open_hosted_link',
  '/item/public_token/exchange',
  'production.plaid.com',
  'sandbox.plaid.com',
];
for (const file of await readdir(directory)) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(join(directory, file), 'utf8');
  for (const marker of forbidden)
    if (source.includes(marker)) throw new Error(`Demo contains provider adapter code: ${marker}`);
}
console.log('Demo provider boundary passed: no live adapter commands or provider endpoints.');
