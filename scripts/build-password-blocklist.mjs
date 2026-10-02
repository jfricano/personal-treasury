// Input: SecLists e749176aa4e3261ff41f7d197d7a01a0a705030e
// Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (!process.argv[2]) throw new Error('Pass the downloaded pinned SecLists corpus path.');
const values = new Set();
for (const raw of (await readFile(process.argv[2], 'utf8')).split('\n')) {
  const value = raw.replace(/\r$/, '').normalize('NFKC').toLowerCase();
  if ([...value].length >= 15 && [...value].length <= 256) values.add(value);
  if (values.size === 1024) break;
}
for (const value of [
  'passwordpassword',
  '123456789012345',
  'qwertyuiopasdfgh',
  'letmeinletmeinletmein',
  'correcthorsebatterystaple',
])
  values.add(value);
const hashes = [...values].map((value) => createHash('sha256').update(value).digest('base64')).sort();
await writeFile('src/security/blockedPasswords.json', JSON.stringify(hashes, null, 2) + '\n');
console.log(`Generated ${hashes.length} common-password hashes.`);
