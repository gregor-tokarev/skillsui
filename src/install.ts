import { join } from 'node:path';
import type { SearchSkill } from '../vendor/skills/src/find.ts';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { getGitTreeHash } from '../vendor/skills/src/git.ts';
import { parseSource, getOwnerRepo } from '../vendor/skills/src/source-parser.ts';
import { installSkillForAgent, sanitizeName } from '../vendor/skills/src/installer.ts';
import { sanitizeMetadata } from '../vendor/skills/src/sanitize.ts';
import type { AppPaths } from './paths.ts';
import { assertPathInside, pathExists } from './fs-utils.ts';
import { cloneLock, readLock, writeLock } from './lockfiles.ts';
import { throwIfAborted } from './abort.ts';
import { findRemoteSkill, getSkillPath, loadRemote } from './remote.ts';
import type {
  Collision,
  GlobalLockEntry,
  OperationResult,
  ProjectLockEntry,
  ScopeId,
  TrackedEntry,
} from './types.ts';

export { type SearchSkill };

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_LOAD_AHEAD = 5;
export const SEARCH_MAX_RESULTS = 200;

export function searchNeedsMore(index: number, count: number): boolean {
  return count > 0 && index >= count - 1 - SEARCH_LOAD_AHEAD;
}

export interface SearchPage {
  skills: SearchSkill[];
  hasMore: boolean;
}

export interface InstallPreview {
  contents: string;
  fileName: 'SKILL.md';
}

interface SkillDownload {
  files?: Array<{ path?: string; contents?: string }>;
}

function searchApiBase(): string {
  return process.env.SKILLS_API_URL || 'https://skills.sh';
}

function mapSearchSkills(
  skills: Array<{ id?: string; name?: string; installs?: number; source?: string }>
): SearchSkill[] {
  return skills.map((skill) => ({
    name: sanitizeMetadata(skill.name || ''),
    slug: sanitizeMetadata(skill.id || ''),
    source: sanitizeMetadata(skill.source || ''),
    installs: skill.installs || 0,
  }));
}

export async function searchSkills(query: string, offset = 0): Promise<SearchPage> {
  const trimmed = query.trim();
  const pageStart = Math.floor(Math.max(0, offset) / SEARCH_PAGE_SIZE) * SEARCH_PAGE_SIZE;
  if (!trimmed || pageStart >= SEARCH_MAX_RESULTS) return { skills: [], hasMore: false };

  // Each load adds 20 skills. skills.sh ignores `offset` and only honors
  // `limit` (capped at 200), so later batches request the prefix through this
  // batch and slice out the next 20.
  const requestLimit = Math.min(SEARCH_MAX_RESULTS, pageStart + SEARCH_PAGE_SIZE);
  try {
    const params = new URLSearchParams({
      q: trimmed,
      limit: String(requestLimit),
    });
    if (pageStart > 0) params.set('offset', String(pageStart));
    const response = await fetch(`${searchApiBase()}/api/search?${params.toString()}`);
    if (!response.ok) return { skills: [], hasMore: false };

    const data = (await response.json()) as {
      skills?: Array<{ id?: string; name?: string; installs?: number; source?: string }>;
    };
    const all = mapSearchSkills(data.skills || []);
    const skills = all.slice(pageStart, pageStart + SEARCH_PAGE_SIZE);
    const reachedCap = pageStart + skills.length >= SEARCH_MAX_RESULTS;
    const hasMore = !reachedCap && all.length >= requestLimit && skills.length === SEARCH_PAGE_SIZE;
    return { skills, hasMore };
  } catch {
    return { skills: [], hasMore: false };
  }
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

export async function loadInstallPreview(
  result: SearchSkill,
  signal?: AbortSignal
): Promise<InstallPreview> {
  throwIfAborted(signal);
  const segments = result.slug.split('/');
  if (
    segments.length < 2 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid skill ID: ${result.slug}`);
  }

  const id = segments.map(encodeURIComponent).join('/');
  const response = await fetch(`${searchApiBase()}/api/download/${id}`, { signal });
  if (!response.ok) {
    throw new Error(`Could not download SKILL.md (${response.status})`);
  }

  const download = (await response.json()) as SkillDownload;
  throwIfAborted(signal);
  const skillMd = download.files?.find(
    (file) => file.path?.replaceAll('\\', '/').toLowerCase() === 'skill.md'
  );
  if (typeof skillMd?.contents !== 'string') {
    throw new Error('Downloaded skill has no SKILL.md');
  }
  return { contents: skillMd.contents, fileName: 'SKILL.md' };
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
  if (scopeId === 'project' && !paths.projectEnabled) {
    throw new Error('Project scope is unavailable from the home directory');
  }
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
    const treeHash = await getGitTreeHash(remote.root, skillPath);
    const before = await readLock(scope);
    const next = cloneLock(before);
    removeMatchingEntries(next.skills, folderName);

    const installation = await installSkillForAgent(skill, 'claude-code', {
      cwd: scope.rootDir,
      global: scopeId === 'global',
      mode: 'symlink',
    });
    if (!installation.success) {
      throw new Error(installation.error || `Could not install ${folderName}`);
    }
    const contentHash = await computeSkillFolderHash(destination);

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

    await writeLock(scope, next);
    return {
      changed: 1,
      message: `Installed ${folderName} in ${scope.label.toLowerCase()} scope`,
      errors: installation.symlinkFailed
        ? ['Could not create the Claude Code symlink; copied the skill instead']
        : [],
    };
  } finally {
    await remote.cleanup().catch(() => undefined);
  }
}
