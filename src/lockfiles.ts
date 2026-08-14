import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  GlobalLockEntry,
  LockFile,
  ProjectLockEntry,
  ScopeConfig,
  TrackedEntry,
} from './types.ts';
import { atomicWriteFile } from './fs-utils.ts';

function emptyLock(scope: ScopeConfig): LockFile {
  return scope.id === 'global'
    ? { version: scope.lockVersion, skills: {}, dismissed: {} }
    : { version: scope.lockVersion, skills: {} };
}

export async function readLock(scope: ScopeConfig): Promise<LockFile> {
  let contents: string;
  try {
    contents = await readFile(scope.lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLock(scope);
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Cannot parse lockfile: ${scope.lockPath}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid lockfile: ${scope.lockPath}`);
  }

  const lock = parsed as LockFile;
  if (typeof lock.version !== 'number' || !lock.skills || typeof lock.skills !== 'object') {
    throw new Error(`Invalid lockfile: ${scope.lockPath}`);
  }

  if (lock.version < scope.lockVersion) return emptyLock(scope);
  if (scope.id === 'project') {
    for (const entry of Object.values(lock.skills)) {
      if (entry.sourceType === 'local' && !isAbsolute(entry.source)) {
        entry.source = resolve(scope.rootDir, entry.source);
      }
    }
  }
  return lock;
}

function portableProjectSource(source: string, rootDir: string): string {
  const absolute = isAbsolute(source) ? source : resolve(rootDir, source);
  const local = relative(rootDir, absolute);
  if (isAbsolute(local)) return absolute.split(sep).join('/');
  const portable = local.split(sep).join('/');
  if (!portable) return '.';
  if (portable === '..' || portable.startsWith('../')) return portable;
  return `./${portable}`;
}

export async function writeLock(scope: ScopeConfig, lock: LockFile): Promise<void> {
  const sortedSkills: Record<string, TrackedEntry> = {};
  for (const key of Object.keys(lock.skills).sort()) {
    const entry = lock.skills[key];
    if (entry) {
      sortedSkills[key] =
        scope.id === 'project' && entry.sourceType === 'local'
          ? { ...entry, source: portableProjectSource(entry.source, scope.rootDir) }
          : entry;
    }
  }
  const next = { ...lock, version: scope.lockVersion, skills: sortedSkills };
  await atomicWriteFile(scope.lockPath, `${JSON.stringify(next, null, 2)}\n`);
}

export function cloneLock(lock: LockFile): LockFile {
  return structuredClone(lock);
}

export function toProjectEntry(entry: TrackedEntry, computedHash: string): ProjectLockEntry {
  const globalEntry = entry as Partial<GlobalLockEntry>;
  const projectEntry = entry as Partial<ProjectLockEntry>;
  return {
    source: entry.source,
    sourceType: entry.sourceType,
    computedHash,
    ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    ...(entry.ref ? { ref: entry.ref } : {}),
    ...(entry.skillPath ? { skillPath: entry.skillPath } : {}),
    ...(projectEntry.subagents ? { subagents: projectEntry.subagents } : {}),
    ...(entry.wellKnownDigest ? { wellKnownDigest: entry.wellKnownDigest } : {}),
    ...(globalEntry.installedAt ? { installedAt: globalEntry.installedAt } : {}),
    ...(globalEntry.updatedAt ? { updatedAt: globalEntry.updatedAt } : {}),
    ...(globalEntry.pluginName ? { pluginName: globalEntry.pluginName } : {}),
    ...(globalEntry.skillFolderHash ? { skillFolderHash: globalEntry.skillFolderHash } : {}),
    ...(globalEntry.sourceBaseUrl ? { sourceBaseUrl: globalEntry.sourceBaseUrl } : {}),
  };
}

export function toGlobalEntry(entry: TrackedEntry, folderHash: string): GlobalLockEntry {
  const projectEntry = entry as Partial<ProjectLockEntry>;
  const globalEntry = entry as Partial<GlobalLockEntry>;
  const now = new Date().toISOString();
  return {
    source: entry.source,
    sourceType: entry.sourceType,
    sourceUrl: entry.sourceUrl || entry.source,
    skillFolderHash: folderHash,
    installedAt: globalEntry.installedAt || now,
    updatedAt: globalEntry.updatedAt || now,
    ...(entry.ref ? { ref: entry.ref } : {}),
    ...(entry.skillPath ? { skillPath: entry.skillPath } : {}),
    ...(entry.wellKnownDigest ? { wellKnownDigest: entry.wellKnownDigest } : {}),
    ...(globalEntry.pluginName ? { pluginName: globalEntry.pluginName } : {}),
    ...(globalEntry.sourceBaseUrl ? { sourceBaseUrl: globalEntry.sourceBaseUrl } : {}),
    ...(projectEntry.computedHash ? { computedHash: projectEntry.computedHash } : {}),
  };
}
