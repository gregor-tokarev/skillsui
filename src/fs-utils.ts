import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve, sep } from 'node:path';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function assertPathInside(basePath: string, targetPath: string): void {
  const base = normalize(resolve(basePath));
  const target = normalize(resolve(targetPath));
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`Path escapes its skill scope: ${targetPath}`);
  }
}

export async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.skillsui-${process.pid}-${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function temporarySibling(path: string, purpose: string): string {
  return `${path}.skillsui-${purpose}-${process.pid}-${crypto.randomUUID()}`;
}
