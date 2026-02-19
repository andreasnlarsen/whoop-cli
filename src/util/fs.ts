import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ensureDir = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true });
};

export const readJsonFile = async <T>(path: string): Promise<T | null> => {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
};

export const writeJsonFileSecure = async (path: string, value: unknown): Promise<void> => {
  await ensureDir(dirname(path));
  const tmpPath = `${path}.tmp-${Date.now()}`;
  const body = JSON.stringify(value, null, 2);
  await writeFile(tmpPath, body, { mode: 0o600 });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, path);
};
