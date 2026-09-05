import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { pathExists, temporarySibling } from './fs-utils.ts';

interface CopyTransactionOptions {
  source: string;
  destination: string;
  overwrite: boolean;
  removeSource?: boolean;
  mutateStaged?: (stagedPath: string) => Promise<void>;
  validateCopy?: boolean;
  commit: () => Promise<void>;
}

export interface TransactionResult {
  cleanupWarnings: string[];
}

export async function copyDirectoryTransaction(
  options: CopyTransactionOptions
): Promise<TransactionResult> {
  if (options.source === options.destination)
    throw new Error('Source and destination are the same');
  await mkdir(dirname(options.destination), { recursive: true });

  const staged = temporarySibling(options.destination, 'copy');
  const destinationBackup = (await pathExists(options.destination))
    ? temporarySibling(options.destination, 'replaced')
    : null;
  const sourceBackup = options.removeSource ? temporarySibling(options.source, 'moved') : null;
  let destinationInstalled = false;
  let destinationMoved = false;
  let sourceMoved = false;

  if (destinationBackup && !options.overwrite) {
    throw new Error(`Destination exists: ${options.destination}`);
  }

  try {
    await cp(options.source, staged, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
    });
    if (options.mutateStaged) await options.mutateStaged(staged);
    if (!(await pathExists(join(staged, 'SKILL.md')))) {
      throw new Error(`Copied folder has no SKILL.md: ${options.destination}`);
    }
    if (options.validateCopy !== false && !options.mutateStaged) {
      const [sourceHash, stagedHash] = await Promise.all([
        computeSkillFolderHash(options.source),
        computeSkillFolderHash(staged),
      ]);
      if (sourceHash !== stagedHash) throw new Error('Copied skill failed hash validation');
    }

    if (destinationBackup) {
      await rename(options.destination, destinationBackup);
      destinationMoved = true;
    }
    await rename(staged, options.destination);
    destinationInstalled = true;

    if (sourceBackup) {
      await rename(options.source, sourceBackup);
      sourceMoved = true;
    }

    await options.commit();
  } catch (error) {
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
    if (sourceMoved && sourceBackup) {
      await rm(options.source, { recursive: true, force: true }).catch(() => undefined);
      await rename(sourceBackup, options.source).catch(() => undefined);
    }
    if (destinationInstalled) {
      await rm(options.destination, { recursive: true, force: true }).catch(() => undefined);
    }
    if (destinationMoved && destinationBackup) {
      await rename(destinationBackup, options.destination).catch(() => undefined);
    }
    throw error;
  }

  const cleanupWarnings: string[] = [];
  for (const backup of [sourceBackup, destinationBackup]) {
    if (!backup) continue;
    try {
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      cleanupWarnings.push(
        `Could not remove temporary backup ${backup}: ${(error as Error).message}`
      );
    }
  }
  return { cleanupWarnings };
}

export async function deleteDirectoryTransaction(
  path: string,
  commit: () => Promise<void>
): Promise<TransactionResult> {
  const backup = temporarySibling(path, 'deleted');
  await rename(path, backup);
  try {
    await commit();
  } catch (error) {
    await rename(backup, path).catch(() => undefined);
    throw error;
  }

  try {
    await rm(backup, { recursive: true, force: true });
    return { cleanupWarnings: [] };
  } catch (error) {
    return {
      cleanupWarnings: [`Could not remove temporary backup ${backup}: ${(error as Error).message}`],
    };
  }
}
