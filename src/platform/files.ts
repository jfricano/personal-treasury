import { isTauri } from '@/db/storage';

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** Ask the user for a file. Only ever reads; the source file is never modified. */
export async function pickFile(accept: string[]): Promise<PickedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    // Some macOS Open panels leave valid Excel files unselectable when the
    // plugin passes a multi-extension workbook filter. Check the extension
    // ourselves after selection, before reading any bytes.
    const workbook = accept.includes('.xlsx');
    const path = await open({
      multiple: false,
      directory: false,
      ...(workbook
        ? {}
        : { filters: [{ name: 'Files', extensions: accept.map((a) => a.replace(/^\./, '')) }] }),
    });
    if (!path || Array.isArray(path)) return null;
    if (!accept.some((ext) => path.toLowerCase().endsWith(ext.toLowerCase())))
      throw new Error(`Choose a ${accept.join(', ')} file.`);
    return { name: path.split(/[\\/]/).pop() ?? path, bytes: await readFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Save generated content to a user-chosen location. Always an explicit user action. */
export async function saveFile(
  suggestedName: string,
  data: Uint8Array | string,
  mime: string,
): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const ext = suggestedName.split('.').pop() ?? '';
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
