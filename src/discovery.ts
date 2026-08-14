import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseFrontmatter } from '../vendor/skills/src/frontmatter.ts';
import { sanitizeName } from '../vendor/skills/src/installer.ts';
import type { AppPaths } from './paths.ts';
import type { AppSnapshot, LockFile, ScopeConfig, ScopeSnapshot, SkillRecord } from './types.ts';
import { pathExists } from './fs-utils.ts';
import { readLock } from './lockfiles.ts';

async function isDirectoryOrLink(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function findLockKey(lock: LockFile, folderName: string, skillName: string): string | undefined {
  if (lock.skills[folderName]) return folderName;
  if (lock.skills[skillName]) return skillName;
  const matches = Object.keys(lock.skills).filter((key) => sanitizeName(key) === folderName);
  return matches.length === 1 ? matches[0] : undefined;
}

async function readSkill(
  scope: ScopeConfig,
  folderName: string,
  lock: LockFile
): Promise<SkillRecord | null> {
  const path = join(scope.skillsDir, folderName);
  if (!(await isDirectoryOrLink(path))) return null;

  const skillMdPath = join(path, 'SKILL.md');
  if (!(await pathExists(skillMdPath))) return null;

  const raw = await readFile(skillMdPath, 'utf8');
  let name = folderName;
  let description = 'Invalid or incomplete SKILL.md frontmatter';
  try {
    const { data } = parseFrontmatter(raw);
    if (typeof data.name === 'string' && data.name.trim()) name = data.name.trim();
    if (typeof data.description === 'string' && data.description.trim()) {
      description = data.description.trim();
    }
  } catch (error) {
    description = `Cannot parse SKILL.md: ${(error as Error).message}`;
  }

  const readmePath = join(path, 'README.md');
  const previewPath = (await pathExists(readmePath)) ? readmePath : skillMdPath;
  const preview = previewPath === skillMdPath ? raw : await readFile(previewPath, 'utf8');
  const lockKey = findLockKey(lock, folderName, name);

  return {
    id: `${scope.id}:${folderName}`,
    scope: scope.id,
    folderName,
    name,
    description,
    path,
    skillMdPath,
    previewPath,
    preview,
    tracked: Boolean(lockKey),
    ...(lockKey ? { lockKey, lockEntry: lock.skills[lockKey] } : {}),
  };
}

export async function discoverScope(scope: ScopeConfig): Promise<ScopeSnapshot> {
  const lock = await readLock(scope);
  let entries: string[] = [];
  try {
    entries = (await readdir(scope.skillsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => !basename(name).startsWith('.skillsui-'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const skills = (await Promise.all(entries.map((name) => readSkill(scope, name, lock))))
    .filter((skill): skill is SkillRecord => skill !== null)
    .sort((a, b) => a.folderName.localeCompare(b.folderName));
  const visibleKeys = new Set(skills.flatMap((skill) => (skill.lockKey ? [skill.lockKey] : [])));

  return {
    config: scope,
    skills,
    hiddenLockEntries: Object.keys(lock.skills).filter((key) => !visibleKeys.has(key)).length,
  };
}

export async function discoverAll(paths: AppPaths): Promise<AppSnapshot> {
  const [project, global] = await Promise.all([
    discoverScope(paths.scopes.project),
    discoverScope(paths.scopes.global),
  ]);
  return { project, global };
}
