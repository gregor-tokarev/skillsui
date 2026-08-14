import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { discoverAll } from '../src/discovery.ts';
import { writeLock } from '../src/lockfiles.ts';
import { checkForUpdates, updateSkills } from '../src/updates.ts';
import { testPaths, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('updates', () => {
  test('checks without writing, then overwrites a selected tracked skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-updates-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const source = join(root, 'source');
    const sourceSkill = await writeSkill(source, 'local-source', { body: 'version one' });
    const installed = await writeSkill(paths.scopes.project.skillsDir, 'local-source', {
      body: 'version one',
    });
    const installedHash = await computeSkillFolderHash(installed);
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'local-source': {
          source,
          sourceType: 'local',
          skillPath: 'local-source/SKILL.md',
          computedHash: installedHash,
        },
      },
    });
    await writeFile(
      join(sourceSkill, 'SKILL.md'),
      `---\nname: local-source\ndescription: local-source description\n---\n\nversion two\n`,
      'utf8'
    );
    const skill = (await discoverAll(paths)).project.skills[0]!;
    const before = await readFile(join(installed, 'SKILL.md'), 'utf8');

    const check = await checkForUpdates([skill]);
    expect(check.states[skill.id]).toBe('available');
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toBe(before);

    const result = await updateSkills(paths, [skill]);
    expect(result.changed).toBe(1);
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('version two');
  });

  test('checks and updates well-known tracked skills through the pinned provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-well-known-updates-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const installed = await writeSkill(paths.scopes.project.skillsDir, 'published-skill', {
      body: 'version one',
    });
    const installedHash = await computeSkillFolderHash(installed);
    const baseUrl = 'https://example.test/catalog';
    const remoteContents = `---\nname: published-skill\ndescription: published skill\n---\n\nversion two\n`;
    const digest = `sha256:${createHash('sha256').update(remoteContents).digest('hex')}`;
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'published-skill': {
          source: 'wellknown/example.test',
          sourceType: 'well-known',
          sourceUrl: baseUrl,
          computedHash: installedHash,
          wellKnownDigest: `sha256:${'0'.repeat(64)}`,
        },
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${baseUrl}/.well-known/agent-skills/index.json`) {
        return Response.json({
          $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
          skills: [
            {
              name: 'published-skill',
              type: 'skill-md',
              description: 'published skill',
              url: 'published-skill.md',
              digest,
            },
          ],
        });
      }
      if (url === `${baseUrl}/.well-known/agent-skills/published-skill.md`) {
        return new Response(remoteContents);
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    try {
      const skill = (await discoverAll(paths)).project.skills[0]!;
      expect((await checkForUpdates([skill])).states[skill.id]).toBe('available');
      expect((await updateSkills(paths, [skill])).changed).toBe(1);
      expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('version two');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
