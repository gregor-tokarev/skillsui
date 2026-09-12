import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { discoverAll } from '../src/discovery.ts';
import { writeLock } from '../src/lockfiles.ts';
import { checkForUpdates, updateSkills } from '../src/updates.ts';
import * as remote from '../src/remote.ts';
import type { SkillRecord, UpdateState } from '../src/types.ts';
import { testPaths, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('updates', () => {
  test('limits checks across runs, releases failed slots, and skips cancelled queued skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-update-queue-'));
    temporary.push(root);
    await writeSkill(root, 'queued-skill');
    const skills: SkillRecord[] = Array.from({ length: 8 }, (_, index) => ({
      id: `project:skill-${index}`,
      scope: 'project',
      folderName: `skill-${index}`,
      name: 'queued-skill',
      description: '',
      path: '',
      skillMdPath: '',
      previewPath: '',
      preview: '',
      tracked: true,
      lockEntry: {
        source: `source-${index}`,
        sourceType: 'local',
        skillPath: 'queued-skill/SKILL.md',
        computedHash: '',
      },
    }));
    const gates = skills.map(() => Promise.withResolvers<void>());
    const cleanup = mock(async () => {
      throw new Error('cleanup failed');
    });
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const loader = spyOn(remote, 'loadRemote').mockImplementation(async (entry) => {
      const index = Number(entry.source.split('-')[1]);
      started.push(entry.source);
      peak = Math.max(peak, ++active);
      try {
        await gates[index]!.promise;
        if (index === 0) throw new Error('source unavailable');
        return { root, sourceType: 'local', sourceUrl: entry.source, cleanup };
      } finally {
        active--;
      }
    });
    const controller = new AbortController();
    const states: Record<string, UpdateState> = {};
    const events: UpdateState[] = [];
    const first = checkForUpdates(skills.slice(0, 7), {
      signal: controller.signal,
      onStateChange: (id, state) => {
        states[id] = state;
        events.push(state);
      },
    });
    const second = checkForUpdates([skills[7]!]);
    try {
      await Bun.sleep(0);
      expect(started).toHaveLength(5);
      expect(Object.values(states).filter((state) => state === 'checking')).toHaveLength(5);
      expect(Object.values(states).filter((state) => state === 'waiting')).toHaveLength(2);

      gates[0]!.resolve();
      await Bun.sleep(0);
      expect(states[skills[0]!.id]).toBe('unavailable');
      expect(states[skills[5]!.id]).toBe('checking');
      expect(states[skills[6]!.id]).toBe('waiting');
      expect(started).toHaveLength(6);

      controller.abort();
      const eventCount = events.length;
      for (const gate of gates) gate.resolve();
      const [cancelled, completed] = await Promise.all([first, second]);
      expect(peak).toBe(5);
      expect(started).not.toContain('source-6');
      expect(started).toContain('source-7');
      expect(events).toHaveLength(eventCount);
      expect(cancelled.errors).toEqual(['skill-0: source unavailable']);
      expect(completed.states[skills[7]!.id]).toBe('available');
      expect(cleanup).toHaveBeenCalledTimes(6);
    } finally {
      for (const gate of gates) gate.resolve();
      await Promise.all([first, second]);
      loader.mockRestore();
    }
  });

  test('shares one source across queued skills and reports results before the batch finishes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-shared-update-queue-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const source = join(root, 'source');
    await writeSkill(source, 'shared-skill');
    const installed = await writeSkill(paths.scopes.project.skillsDir, 'shared-skill');
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'shared-skill': {
          source,
          sourceType: 'local',
          skillPath: 'shared-skill/SKILL.md',
          computedHash: await computeSkillFolderHash(installed),
        },
      },
    });
    const skill = (await discoverAll(paths)).project.skills[0]!;
    const skills = Array.from({ length: 12 }, (_, index) => ({ ...skill, id: `skill-${index}` }));
    const gates = skills.map(() => Promise.withResolvers<void>());
    const states: Record<string, UpdateState> = {};
    const cleanup = mock(async () => undefined);
    const loader = spyOn(remote, 'loadRemote').mockResolvedValue({
      root: source,
      sourceType: 'local',
      sourceUrl: source,
      cleanup,
    });
    const find = remote.findRemoteSkill;
    let started = 0;
    let active = 0;
    let peak = 0;
    const finder = spyOn(remote, 'findRemoteSkill').mockImplementation(async (...args) => {
      const index = started++;
      peak = Math.max(peak, ++active);
      try {
        await gates[index]!.promise;
        if (index === 1) throw new Error('skill missing');
        return await find(...args);
      } finally {
        active--;
      }
    });
    const firstResult = Promise.withResolvers<void>();
    const nextStarted = Promise.withResolvers<void>();
    const check = checkForUpdates(skills, {
      onStateChange: (id, state) => {
        states[id] = state;
        if (id === 'skill-0' && state === 'current') firstResult.resolve();
        if (id === 'skill-5' && state === 'checking') nextStarted.resolve();
      },
    });
    try {
      await Bun.sleep(0);
      expect(started).toBe(5);
      expect(Object.values(states).filter((state) => state === 'waiting')).toHaveLength(7);
      gates[0]!.resolve();
      await firstResult.promise;
      await nextStarted.promise;
      expect(states['skill-0']).toBe('current');
      expect(states['skill-5']).toBe('checking');
      expect(states['skill-6']).toBe('waiting');
      expect(cleanup).not.toHaveBeenCalled();
      for (const gate of gates) gate.resolve();
      const result = await check;
      expect(peak).toBe(5);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(result.states['skill-1']).toBe('unavailable');
      expect(Object.values(result.states).filter((state) => state === 'current')).toHaveLength(11);
      expect(result.errors).toEqual(['shared-skill: skill missing']);
    } finally {
      for (const gate of gates) gate.resolve();
      await check;
      finder.mockRestore();
      loader.mockRestore();
    }
  });

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
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
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
      expect(requested.every((url) => url.endsWith('/index.json'))).toBe(true);
      expect((await updateSkills(paths, [skill])).changed).toBe(1);
      expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('version two');
      const updated = (await discoverAll(paths)).project.skills[0]!;
      expect((await checkForUpdates([updated])).states[skill.id]).toBe('current');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('limits legacy catalog requests to five and fetches only tracked skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-legacy-update-queue-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const baseUrl = 'https://example.test';
    const names = Array.from({ length: 8 }, (_, index) => `skill-${index}`);
    for (const name of names.slice(0, 7)) await writeSkill(paths.scopes.project.skillsDir, name);
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: Object.fromEntries(
        names.slice(0, 7).map((name) => [
          name,
          {
            source: 'wellknown/example.test',
            sourceType: 'well-known',
            sourceUrl: baseUrl,
            computedHash: '',
            wellKnownDigest: `sha256:${'0'.repeat(64)}`,
          },
        ])
      ),
    });
    const skills = (await discoverAll(paths)).project.skills;
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    let active = 0;
    let peak = 0;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        requested.push(url.pathname);
        peak = Math.max(peak, ++active);
        try {
          if (url.pathname === '/.well-known/agent-skills/index.json') {
            return Response.json({
              skills: names.map((name) => ({
                name,
                description: name,
                files: ['SKILL.md', 'reference.txt', 'examples.txt'],
              })),
            });
          }
          if (url.pathname.endsWith('/index.json')) return new Response(null, { status: 404 });
          if (active === 5) started.resolve();
          await gate.promise;
          if (url.pathname.endsWith('/SKILL.md')) {
            const name = url.pathname.split('/').at(-2)!;
            return new Response(`---\nname: ${name}\ndescription: ${name}\n---\n\nUpdated`);
          }
          return new Response('Supporting file');
        } finally {
          active--;
        }
      },
      { preconnect: originalFetch.preconnect }
    );
    const states: Record<string, UpdateState> = {};
    const check = checkForUpdates(skills, {
      onStateChange: (id, state) => {
        states[id] = state;
      },
    });
    try {
      await started.promise;
      expect(Object.values(states).filter((state) => state === 'checking')).toHaveLength(5);
      expect(Object.values(states).filter((state) => state === 'waiting')).toHaveLength(2);
      gate.resolve();
      const result = await check;
      expect(peak).toBe(5);
      expect(result.errors).toEqual([]);
      expect(Object.values(result.states)).toEqual(Array.from({ length: 7 }, () => 'available'));
      expect(requested.filter((path) => !path.endsWith('/index.json'))).toHaveLength(21);
      expect(requested.some((path) => path.includes('/skill-7/'))).toBe(false);
      expect(
        requested.filter((path) => path === '/.well-known/agent-skills/index.json')
      ).toHaveLength(1);
    } finally {
      gate.resolve();
      await check;
      globalThis.fetch = originalFetch;
    }
  });
});
