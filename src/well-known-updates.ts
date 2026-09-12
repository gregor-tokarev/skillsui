import {
  computeWellKnownSkillDigest,
  wellKnownProvider,
} from '../vendor/skills/src/providers/index.ts';
import type { SkillRecord, TrackedEntry } from './types.ts';

export async function loadUpdateIndex(entry: TrackedEntry) {
  const url = ('sourceBaseUrl' in entry && entry.sourceBaseUrl) || entry.sourceUrl || entry.source;
  const index = await wellKnownProvider.fetchIndex(url, { updateCheck: true });
  if (!index) throw new Error(`No skills index found at ${url}`);
  return index;
}

export async function latestWellKnownHash(
  skill: SkillRecord,
  index: Awaited<ReturnType<typeof loadUpdateIndex>>
): Promise<string> {
  const entry = index.entries.find((candidate) => candidate.name === skill.folderName);
  if (!entry) throw new Error(`No update digest found for ${skill.folderName}`);
  if (entry.version === '0.2.0') return entry.digest;

  // Legacy catalogs need a content hash. Fetch each file in sequence within the skill's slot;
  // the provider's bulk loader would start every skill and its extra files in parallel.
  const remoteSkill = await wellKnownProvider.fetchSkillByEntry({ ...entry, files: ['SKILL.md'] });
  if (!remoteSkill) throw new Error(`Could not fetch ${skill.folderName}`);
  const baseUrl = `${entry.baseUrl.replace(/\/$/, '')}/${entry.wellKnownPath}/${entry.name}`;
  for (const path of entry.files) {
    if (path.toLowerCase() === 'skill.md') continue;
    try {
      const response = await fetch(`${baseUrl}/${path}`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        remoteSkill.files.set(path, new Uint8Array(await response.arrayBuffer()));
      }
    } catch {
      // Match the provider's treatment of unavailable optional files.
    }
  }
  return computeWellKnownSkillDigest(remoteSkill);
}
