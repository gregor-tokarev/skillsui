import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAll } from '../src/discovery.ts';
import { writeLock } from '../src/lockfiles.ts';
import { testPaths, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('skill discovery', () => {
  test('separates scopes, tracking, hidden locks, and preview fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-discovery-'));
    temporary.push(root);
    const project = join(root, 'project');
    const home = join(root, 'home');
    const paths = testPaths(project, home);

    await writeSkill(paths.scopes.project.skillsDir, 'tracked-skill', {
      name: 'Tracked Skill',
      readme: '# Local readme',
    });
    await writeSkill(paths.scopes.project.skillsDir, 'local-skill');
    await writeSkill(paths.scopes.global.skillsDir, 'global-skill');
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'Tracked Skill': {
          source: 'owner/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repo.git',
          skillPath: 'skills/tracked-skill/SKILL.md',
          computedHash: 'abc',
        },
        hidden: {
          source: 'owner/repo',
          sourceType: 'github',
          computedHash: 'def',
        },
      },
    });

    const snapshot = await discoverAll(paths);
    expect(snapshot.project.skills.map((skill) => skill.folderName)).toEqual([
      'local-skill',
      'tracked-skill',
    ]);
    const tracked = snapshot.project.skills.find((skill) => skill.folderName === 'tracked-skill');
    expect(tracked?.tracked).toBe(true);
    expect(tracked?.lockKey).toBe('Tracked Skill');
    expect(tracked?.preview).toBe('# Local readme');
    expect(snapshot.project.hiddenLockEntries).toBe(1);
    expect(snapshot.global.skills[0]?.scope).toBe('global');
    expect(snapshot.global.skills[0]?.previewPath.endsWith('SKILL.md')).toBe(true);
  });
});
