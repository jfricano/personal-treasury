import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const files = ['README.md'];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith('.md')) files.push(file);
  }
}
await walk('docs');
const failures = [];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim(),
      target = (raw.startsWith('<') ? raw.slice(1, raw.indexOf('>')) : raw.split(/\s/)[0]).split('#')[0];
    if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    try {
      await stat(resolved);
    } catch {
      failures.push(`${file}: ${target}`);
    }
  }
}
if (failures.length) throw new Error(`Broken documentation file links:\n${failures.join('\n')}`);
console.log(`Documentation file links passed: ${files.length} Markdown files.`);
