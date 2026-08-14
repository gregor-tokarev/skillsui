import { spawn } from 'node:child_process';
import { basename, dirname, join, relative, sep } from 'node:path';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { cloneRepo, cleanupTempDir } from '../vendor/skills/src/git.ts';
import { discoverSkills, parseSkillMd } from '../vendor/skills/src/skills.ts';
import { parseSource } from '../vendor/skills/src/source-parser.ts';
import { sanitizeName } from '../vendor/skills/src/installer.ts';
import {
  computeWellKnownSkillDigest,
  wellKnownProvider,
} from '../vendor/skills/src/providers/index.ts';
import type { Skill } from '../vendor/skills/src/types.ts';
import { abortError, throwIfAborted, withAbort } from './abort.ts';
import type { TrackedEntry } from './types.ts';
import { assertPathInside } from './fs-utils.ts';

export interface LoadedRemote {
  root: string;
  sourceType: string;
  sourceUrl: string;
  ref?: string;
  subpath?: string;
  wellKnownDigests?: Map<string, string>;
  cleanup: () => Promise<void>;
}

function sourceInput(entry: TrackedEntry): string {
  if (entry.sourceType === 'well-known') {
    return ('sourceBaseUrl' in entry && entry.sourceBaseUrl) || entry.sourceUrl || entry.source;
  }
  if (entry.sourceType === 'local') return entry.source;
  return entry.sourceUrl || entry.source;
}

export async function loadRemote(entry: TrackedEntry, signal?: AbortSignal): Promise<LoadedRemote> {
  throwIfAborted(signal);
  const input = sourceInput(entry);

  if (entry.sourceType === 'well-known') {
    const skills = await withAbort(wellKnownProvider.fetchAllSkills(input), signal);
    if (skills.length === 0) throw new Error(`No skills found at ${input}`);
    const root = await mkdtemp(join(tmpdir(), 'skillsui-well-known-'));
    const digests = new Map<string, string>();
    try {
      for (const skill of skills) {
        throwIfAborted(signal);
        const folder = join(root, sanitizeName(skill.installName));
        await mkdir(folder, { recursive: true });
        for (const [filePath, contents] of skill.files) {
          throwIfAborted(signal);
          const destination = join(folder, filePath);
          assertPathInside(folder, destination);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, contents);
        }
        digests.set(sanitizeName(skill.installName), computeWellKnownSkillDigest(skill));
      }
      return {
        root,
        sourceType: 'well-known',
        sourceUrl: input,
        wellKnownDigests: digests,
        cleanup: () => cleanupTempDir(root),
      };
    } catch (error) {
      await cleanupTempDir(root).catch(() => undefined);
      throw error;
    }
  }

  const parsed = parseSource(input);
  const ref = entry.ref || parsed.ref;

  if (parsed.type === 'local') {
    throwIfAborted(signal);
    const root = parsed.localPath || parsed.url;
    if (!(await stat(root)).isDirectory()) throw new Error(`Local source is not a folder: ${root}`);
    return {
      root,
      sourceType: 'local',
      sourceUrl: parsed.url,
      ...(ref ? { ref } : {}),
      ...(parsed.subpath ? { subpath: parsed.subpath } : {}),
      cleanup: async () => undefined,
    };
  }

  if (!['github', 'gitlab', 'git'].includes(parsed.type)) {
    throw new Error(`Updates for ${entry.sourceType} sources are not supported yet`);
  }

  const root = await cloneRepoAbortable(parsed.url, ref, signal);
  return {
    root,
    sourceType: parsed.type,
    sourceUrl: parsed.url,
    ...(ref ? { ref } : {}),
    ...(parsed.subpath ? { subpath: parsed.subpath } : {}),
    cleanup: () => cleanupTempDir(root),
  };
}

export async function findRemoteSkill(
  remote: LoadedRemote,
  entry: Pick<TrackedEntry, 'skillPath'>,
  name: string
): Promise<Skill> {
  if (entry.skillPath) {
    const normalized = entry.skillPath.split('/').join(sep);
    const skillMdPath = join(remote.root, normalized);
    assertPathInside(remote.root, skillMdPath);
    const parsed = await parseSkillMd(skillMdPath, { includeInternal: true });
    if (parsed) return parsed;
  }

  const skills = await discoverSkills(remote.root, remote.subpath, {
    includeInternal: true,
    fullDepth: true,
  });
  const sanitized = sanitizeName(name);
  const skill = skills.find(
    (candidate) =>
      sanitizeName(candidate.name) === sanitized ||
      sanitizeName(basename(candidate.path)) === sanitized
  );
  if (!skill) throw new Error(`Skill ${name} no longer exists in ${remote.sourceUrl}`);
  return skill;
}

export function getSkillPath(root: string, skill: Skill): string {
  const directory = relative(root, skill.path).split(sep).join('/');
  return directory ? `${directory}/SKILL.md` : 'SKILL.md';
}

export function skillDirectoryFromPath(root: string, skillPath: string): string {
  return join(root, dirname(skillPath.split('/').join(sep)));
}

/** Preview loads pass a signal so we can kill git; install still uses the vendor clone. */
async function cloneRepoAbortable(
  url: string,
  ref: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  if (!signal) return cloneRepo(url, ref);
  throwIfAborted(signal);

  const tempDir = await mkdtemp(join(tmpdir(), 'skillsui-clone-'));
  try {
    await spawnGitClone(url, tempDir, ref, signal);
    return tempDir;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function spawnGitClone(
  url: string,
  dest: string,
  ref: string | undefined,
  signal: AbortSignal
): Promise<void> {
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push('--', url, dest);

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
    });
    const stderr: Buffer[] = [];
    child.stderr?.on('data', (chunk) => stderr.push(chunk as Buffer));

    const onAbort = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // Fall through to killing the git process itself.
        }
      }
      child.kill('SIGKILL');
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    child.once('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(detail || `git clone exited ${code}`));
    });
  });
}
