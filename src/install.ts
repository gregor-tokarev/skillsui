import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchSkill } from '../vendor/skills/src/find.ts';
import { searchSkillsAPI } from '../vendor/skills/src/find.ts';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { getGitTreeHash } from '../vendor/skills/src/git.ts';
import { parseSource, getOwnerRepo } from '../vendor/skills/src/source-parser.ts';
import { sanitizeName } from '../vendor/skills/src/installer.ts';
import type { AppPaths } from './paths.ts';
import { assertPathInside, pathExists } from './fs-utils.ts';
import { cloneLock, readLock, writeLock } from './lockfiles.ts';
import { findRemoteSkill, getSkillPath, loadRemote } from './remote.ts';
import { copyDirectoryTransaction } from './transactions.ts';
import type {
  Collision,
  GlobalLockEntry,
  OperationResult,
  ProjectLockEntry,
  ScopeId,
  TrackedEntry,
} from './types.ts';

export { type SearchSkill };

export interface InstallPreview {
  contents: string;
  fileName: 'README.md' | 'SKILL.md';
}

export async function searchSkills(query: string): Promise<SearchSkill[]> {
  return searchSkillsAPI(query.trim());
}

export async function findInstallCollision(
  paths: AppPaths,
  result: SearchSkill,
  scopeId: ScopeId
): Promise<Collision | null> {
  const folderName = sanitizeName(result.name);
  const destination = join(paths.scopes[scopeId].skillsDir, folderName);
  return (await pathExists(destination)) ? { destination, skillName: folderName } : null;
}

function sourceEntry(result: SearchSkill): ProjectLockEntry {
  const parsed = parseSource(result.source);
  return {
    source: getOwnerRepo(parsed) || result.source,
    sourceType: parsed.type,
    sourceUrl: parsed.url,
    ...(parsed.ref ? { ref: parsed.ref } : {}),
    computedHash: '',
  };
}

export async function loadInstallPreview(result: SearchSkill): Promise<InstallPreview> {
  const seed = sourceEntry(result);
  const remote = await loadRemote(seed);
  try {
    const skill = await findRemoteSkill(remote, seed, result.name);
    const readmePath = join(skill.path, 'README.md');
    const hasReadme = await pathExists(readmePath);
    const previewPath = hasReadme ? readmePath : join(skill.path, 'SKILL.md');
    return {
      contents: await readFile(previewPath, 'utf8'),
      fileName: hasReadme ? 'README.md' : 'SKILL.md',
    };
  } finally {
    await remote.cleanup().catch(() => undefined);
  }
}

function removeMatchingEntries(skills: Record<string, TrackedEntry>, folderName: string): void {
  for (const key of Object.keys(skills)) {
    if (key === folderName || sanitizeName(key) === folderName) delete skills[key];
  }
}

export async function installSearchResult(
  paths: AppPaths,
  result: SearchSkill,
  scopeId: ScopeId,
  overwrite = false
): Promise<OperationResult> {
  const scope = paths.scopes[scopeId];
  const seed = sourceEntry(result);
  const remote = await loadRemote(seed);
  try {
    const skill = await findRemoteSkill(remote, seed, result.name);
    const folderName = sanitizeName(skill.name);
    const destination = join(scope.skillsDir, folderName);
    assertPathInside(scope.skillsDir, destination);
    if (!overwrite && (await pathExists(destination))) {
      throw new Error(`Destination exists: ${destination}`);
    }

    const skillPath = getSkillPath(remote.root, skill);
    const contentHash = await computeSkillFolderHash(skill.path);
    const treeHash = await getGitTreeHash(remote.root, skillPath);
    const before = await readLock(scope);
    const next = cloneLock(before);
    removeMatchingEntries(next.skills, folderName);

    const common = {
      source: seed.source,
      sourceType: seed.sourceType,
      sourceUrl: seed.sourceUrl || result.source,
      ...(seed.ref ? { ref: seed.ref } : {}),
      skillPath,
    };
    if (scopeId === 'project') {
      const entry: ProjectLockEntry = {
        ...common,
        computedHash: contentHash,
        ...(treeHash ? { skillFolderHash: treeHash } : {}),
      };
      next.skills[skill.name] = entry;
    } else {
      const now = new Date().toISOString();
      const entry: GlobalLockEntry = {
        ...common,
        skillFolderHash: treeHash || contentHash,
        computedHash: contentHash,
        installedAt: now,
        updatedAt: now,
      };
      next.skills[skill.name] = entry;
    }

    const tx = await copyDirectoryTransaction({
      source: skill.path,
      destination,
      overwrite,
      commit: () => writeLock(scope, next),
    });
    return {
      changed: 1,
      message: `Installed ${folderName} in ${scope.label.toLowerCase()} scope`,
      errors: tx.cleanupWarnings,
    };
  } finally {
    await remote.cleanup().catch(() => undefined);
  }
}
