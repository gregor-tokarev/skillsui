import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { getGitTreeHash } from '../vendor/skills/src/git.ts';
import type { AppPaths } from './paths.ts';
import { cloneLock, readLock, writeLock } from './lockfiles.ts';
import { findRemoteSkill, getSkillPath, loadRemote, type LoadedRemote } from './remote.ts';
import { copyDirectoryTransaction } from './transactions.ts';
import { latestWellKnownHash, loadUpdateIndex } from './well-known-updates.ts';
import type {
  GlobalLockEntry,
  OperationResult,
  ProjectLockEntry,
  SkillRecord,
  TrackedEntry,
  UpdateState,
} from './types.ts';

export interface UpdateCheckResult {
  states: Record<string, UpdateState>;
  errors: string[];
}

export interface UpdateCheckOptions {
  onStateChange?: (id: string, state: UpdateState) => void;
  signal?: AbortSignal;
}

// Share the five slots across refreshes, including checks still finishing from an older run.
let activeChecks = 0;
const waitingChecks: Array<() => void> = [];

async function acquireCheckSlot(): Promise<() => void> {
  if (activeChecks < 5) activeChecks++;
  else await new Promise<void>((resolve) => waitingChecks.push(resolve));

  return () => {
    const next = waitingChecks.shift();
    if (next) next();
    else activeChecks--;
  };
}

function groupKey(entry: TrackedEntry): string {
  return JSON.stringify([entry.sourceType, entry.sourceUrl || entry.source, entry.ref || '']);
}

function groupTracked(skills: SkillRecord[]): SkillRecord[][] {
  const groups = new Map<string, SkillRecord[]>();
  for (const skill of skills) {
    if (!skill.tracked || !skill.lockEntry) continue;
    const key = groupKey(skill.lockEntry);
    const group = groups.get(key) || [];
    group.push(skill);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function latestHash(
  skill: SkillRecord,
  remote: LoadedRemote
): Promise<{
  trackingHash: string;
  contentHash: string;
  skillPath: string;
  path: string;
}> {
  const entry = skill.lockEntry!;
  const remoteSkill = await findRemoteSkill(remote, entry, skill.name);
  const skillPath = getSkillPath(remote.root, remoteSkill);
  const contentHash = await computeSkillFolderHash(remoteSkill.path);
  if (entry.sourceType === 'well-known') {
    const digest = remote.wellKnownDigests?.get(skill.folderName);
    if (!digest) throw new Error(`No update digest found for ${skill.folderName}`);
    return { trackingHash: digest, contentHash, skillPath, path: remoteSkill.path };
  }
  if (skill.scope === 'project') {
    return { trackingHash: contentHash, contentHash, skillPath, path: remoteSkill.path };
  }
  const treeHash = await getGitTreeHash(remote.root, skillPath);
  return {
    trackingHash: treeHash || contentHash,
    contentHash,
    skillPath,
    path: remoteSkill.path,
  };
}

function installedHash(skill: SkillRecord): string {
  if (!skill.lockEntry) return '';
  if (skill.lockEntry.sourceType === 'well-known') {
    return skill.lockEntry.wellKnownDigest || '';
  }
  if (skill.scope === 'project') {
    return (skill.lockEntry as ProjectLockEntry).computedHash || '';
  }
  return (skill.lockEntry as GlobalLockEntry).skillFolderHash || '';
}

export async function checkForUpdates(
  skills: SkillRecord[],
  options: UpdateCheckOptions = {}
): Promise<UpdateCheckResult> {
  const states: Record<string, UpdateState> = {};
  const errors: string[] = [];
  const groups = groupTracked(skills);
  function setState(skill: SkillRecord, state: UpdateState): void {
    states[skill.id] = state;
    if (!options.signal?.aborted) options.onStateChange?.(skill.id, state);
  }
  for (const group of groups) {
    for (const skill of group) setState(skill, 'waiting');
  }

  await Promise.all(
    groups.map(async (group) => {
      // Load a source only when a skill gets a slot, then reuse it for the whole group.
      let remotePromise: Promise<LoadedRemote> | undefined;
      let indexPromise: ReturnType<typeof loadUpdateIndex> | undefined;
      let remaining = group.length;
      await Promise.all(
        group.map(async (skill) => {
          const release = await acquireCheckSlot();
          try {
            if (options.signal?.aborted) return;
            setState(skill, 'checking');
            // Let in-flight downloads settle before releasing their slots on cancellation.
            let hash: string;
            if (skill.lockEntry!.sourceType === 'well-known') {
              indexPromise ??= loadUpdateIndex(skill.lockEntry!);
              const index = await indexPromise;
              if (options.signal?.aborted) return;
              hash = await latestWellKnownHash(skill, index);
            } else {
              remotePromise ??= loadRemote(skill.lockEntry!);
              const remote = await remotePromise;
              if (options.signal?.aborted) return;
              hash = (await latestHash(skill, remote)).trackingHash;
            }
            setState(skill, hash === installedHash(skill) ? 'current' : 'available');
          } catch (error) {
            setState(skill, 'unavailable');
            errors.push(`${skill.folderName}: ${(error as Error).message}`);
          } finally {
            remaining--;
            try {
              if (remaining === 0) {
                await remotePromise?.then((remote) => remote.cleanup()).catch(() => undefined);
              }
            } finally {
              release();
            }
          }
        })
      );
    })
  );

  return { states, errors };
}

export async function updateSkills(
  paths: AppPaths,
  skills: SkillRecord[]
): Promise<OperationResult> {
  const tracked = skills.filter((skill) => skill.tracked && skill.lockEntry);
  const errors: string[] = [];
  const warnings: string[] = [];
  let changed = 0;

  for (const group of groupTracked(tracked)) {
    const first = group[0];
    if (!first?.lockEntry) continue;
    let remote: LoadedRemote | null = null;
    try {
      remote = await loadRemote(first.lockEntry);
      for (const skill of group) {
        try {
          const latest = await latestHash(skill, remote);
          const scope = paths.scopes[skill.scope];
          const before = await readLock(scope);
          const next = cloneLock(before);
          if (!skill.lockKey || !next.skills[skill.lockKey]) {
            throw new Error('Lock entry disappeared during update');
          }

          const oldEntry = next.skills[skill.lockKey]!;
          if (skill.scope === 'project') {
            next.skills[skill.lockKey] = {
              ...oldEntry,
              computedHash: latest.contentHash,
              skillPath: latest.skillPath,
              ...(oldEntry.sourceType === 'well-known'
                ? { wellKnownDigest: latest.trackingHash }
                : { skillFolderHash: latest.trackingHash }),
            } as ProjectLockEntry;
          } else {
            next.skills[skill.lockKey] = {
              ...oldEntry,
              ...(oldEntry.sourceType === 'well-known'
                ? { wellKnownDigest: latest.trackingHash, skillFolderHash: '' }
                : { skillFolderHash: latest.trackingHash }),
              computedHash: latest.contentHash,
              skillPath: latest.skillPath,
              updatedAt: new Date().toISOString(),
            } as GlobalLockEntry;
          }

          const tx = await copyDirectoryTransaction({
            source: latest.path,
            destination: skill.path,
            overwrite: true,
            commit: () => writeLock(scope, next),
          });
          warnings.push(...tx.cleanupWarnings);
          changed++;
        } catch (error) {
          errors.push(`${skill.folderName}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      errors.push(`${first.lockEntry.source}: ${(error as Error).message}`);
    } finally {
      await remote?.cleanup().catch(() => undefined);
    }
  }

  const skipped = skills.length - tracked.length;
  return {
    changed,
    message: `Updated ${changed} skill${changed === 1 ? '' : 's'}${
      skipped ? `, skipped ${skipped} local` : ''
    }`,
    errors: [...errors, ...warnings],
  };
}
