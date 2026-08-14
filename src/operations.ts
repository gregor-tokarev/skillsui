import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { sanitizeName } from '../vendor/skills/src/installer.ts';
import type { AppPaths } from './paths.ts';
import { otherScope } from './paths.ts';
import { assertPathInside, pathExists } from './fs-utils.ts';
import { cloneLock, readLock, toGlobalEntry, toProjectEntry, writeLock } from './lockfiles.ts';
import { copyDirectoryTransaction, deleteDirectoryTransaction } from './transactions.ts';
import type {
  Collision,
  LockFile,
  OperationResult,
  ScopeConfig,
  SkillRecord,
  TrackedEntry,
} from './types.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function removeMatchingLockEntries(lock: LockFile, folderName: string): void {
  for (const key of Object.keys(lock.skills)) {
    if (key === folderName || sanitizeName(key) === folderName) delete lock.skills[key];
  }
}

async function writeTwoLocks(
  firstScope: ScopeConfig,
  firstNext: LockFile,
  firstBefore: LockFile,
  secondScope: ScopeConfig,
  secondNext: LockFile,
  secondBefore: LockFile
): Promise<void> {
  await writeLock(firstScope, firstNext);
  try {
    await writeLock(secondScope, secondNext);
  } catch (error) {
    await writeLock(firstScope, firstBefore).catch(() => undefined);
    await writeLock(secondScope, secondBefore).catch(() => undefined);
    throw error;
  }
}

export async function findMoveCollisions(
  paths: AppPaths,
  skills: SkillRecord[]
): Promise<Collision[]> {
  const found = await Promise.all(
    skills.map(async (skill): Promise<Collision | null> => {
      const destinationScope = paths.scopes[otherScope(skill.scope)];
      const destination = join(destinationScope.skillsDir, skill.folderName);
      return (await pathExists(destination))
        ? { source: skill.path, destination, skillName: skill.folderName }
        : null;
    })
  );
  return found.filter((collision): collision is Collision => collision !== null);
}

export async function deleteSkills(
  paths: AppPaths,
  skills: SkillRecord[]
): Promise<OperationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let changed = 0;

  for (const skill of skills) {
    const scope = paths.scopes[skill.scope];
    assertPathInside(scope.skillsDir, skill.path);
    try {
      const before = await readLock(scope);
      const next = cloneLock(before);
      if (skill.lockKey) delete next.skills[skill.lockKey];
      const result = await deleteDirectoryTransaction(skill.path, () => writeLock(scope, next));
      warnings.push(...result.cleanupWarnings);
      changed++;
    } catch (error) {
      errors.push(`${skill.folderName}: ${errorMessage(error)}`);
    }
  }

  return {
    changed,
    message: `Deleted ${changed} skill${changed === 1 ? '' : 's'}`,
    errors: [...errors, ...warnings],
  };
}

export async function moveSkills(
  paths: AppPaths,
  skills: SkillRecord[],
  overwrite = false
): Promise<OperationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let changed = 0;

  for (const skill of skills) {
    const sourceScope = paths.scopes[skill.scope];
    const destinationScope = paths.scopes[otherScope(skill.scope)];
    const destination = join(destinationScope.skillsDir, skill.folderName);
    assertPathInside(sourceScope.skillsDir, skill.path);
    assertPathInside(destinationScope.skillsDir, destination);

    try {
      if (!overwrite && (await pathExists(destination))) {
        throw new Error(`Destination exists: ${destination}`);
      }
      const [sourceBefore, destinationBefore, contentHash] = await Promise.all([
        readLock(sourceScope),
        readLock(destinationScope),
        computeSkillFolderHash(skill.path),
      ]);
      const sourceNext = cloneLock(sourceBefore);
      const destinationNext = cloneLock(destinationBefore);
      if (skill.lockKey) delete sourceNext.skills[skill.lockKey];
      removeMatchingLockEntries(destinationNext, skill.folderName);

      if (skill.tracked && skill.lockEntry && skill.lockKey) {
        const nextEntry =
          destinationScope.id === 'project'
            ? toProjectEntry(skill.lockEntry, contentHash)
            : toGlobalEntry(
                skill.lockEntry,
                'skillFolderHash' in skill.lockEntry && skill.lockEntry.skillFolderHash
                  ? skill.lockEntry.skillFolderHash
                  : contentHash
              );
        destinationNext.skills[skill.lockKey] = nextEntry;
      }

      const tx = await copyDirectoryTransaction({
        source: skill.path,
        destination,
        overwrite,
        removeSource: true,
        commit: () =>
          writeTwoLocks(
            destinationScope,
            destinationNext,
            destinationBefore,
            sourceScope,
            sourceNext,
            sourceBefore
          ),
      });
      warnings.push(...tx.cleanupWarnings);
      changed++;
    } catch (error) {
      errors.push(`${skill.folderName}: ${errorMessage(error)}`);
    }
  }

  return {
    changed,
    message: `Moved ${changed} skill${changed === 1 ? '' : 's'}`,
    errors: [...errors, ...warnings],
  };
}

export function normalizeForkName(input: string): string {
  return sanitizeName(input.trim());
}

export function replaceFrontmatterName(contents: string, name: string): string {
  const frontmatter = contents.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!frontmatter) throw new Error('SKILL.md has no YAML frontmatter');
  const body = frontmatter[2] || '';
  if (!/^name\s*:/m.test(body)) throw new Error('SKILL.md frontmatter has no name field');
  const nextBody = body.replace(/^name\s*:.*$/m, `name: ${name}`);
  return `${frontmatter[1]}${nextBody}${frontmatter[3]}${contents.slice(frontmatter[0].length)}`;
}

export async function forkSkill(
  paths: AppPaths,
  skill: SkillRecord,
  requestedName: string,
  overwrite = false
): Promise<OperationResult> {
  const scope = paths.scopes[skill.scope];
  const folderName = normalizeForkName(requestedName);
  if (!folderName) throw new Error('Fork name is empty');
  const destination = join(scope.skillsDir, folderName);
  assertPathInside(scope.skillsDir, destination);
  if (destination === skill.path) throw new Error('Fork name matches the source folder');
  if (!overwrite && (await pathExists(destination))) {
    throw new Error(`Destination exists: ${destination}`);
  }

  const before = await readLock(scope);
  const next = cloneLock(before);
  removeMatchingLockEntries(next, folderName);
  const tx = await copyDirectoryTransaction({
    source: skill.path,
    destination,
    overwrite,
    validateCopy: false,
    mutateStaged: async (staged) => {
      const skillMd = join(staged, 'SKILL.md');
      const contents = await readFile(skillMd, 'utf8');
      await writeFile(skillMd, replaceFrontmatterName(contents, folderName), 'utf8');
    },
    commit: () => writeLock(scope, next),
  });

  return {
    changed: 1,
    message: `Forked ${skill.folderName} as ${folderName}`,
    errors: tx.cleanupWarnings,
  };
}

export async function findForkCollision(
  paths: AppPaths,
  skill: SkillRecord,
  requestedName: string
): Promise<Collision | null> {
  const folderName = normalizeForkName(requestedName);
  const destination = join(paths.scopes[skill.scope].skillsDir, folderName);
  return (await pathExists(destination))
    ? { source: skill.path, destination, skillName: folderName }
    : null;
}

export function trackedEntry(skill: SkillRecord): TrackedEntry {
  if (!skill.tracked || !skill.lockEntry) throw new Error(`${skill.folderName} is local`);
  return skill.lockEntry;
}
