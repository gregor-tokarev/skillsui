import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { discoverAll } from '../src/discovery.ts';
import { pathExists } from '../src/fs-utils.ts';
import { readLock, writeLock } from '../src/lockfiles.ts';
import { deleteSkills, forkSkill, moveSkills } from '../src/operations.ts';
import { testPaths, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'skillsui-operations-'));
  temporary.push(root);
  const paths = testPaths(join(root, 'project'), join(root, 'home'));
  return { root, paths };
}

describe('skill operations', () => {
  test('delete removes the folder and matching lock entry', async () => {
    const { paths } = await setup();
    const dir = await writeSkill(paths.scopes.project.skillsDir, 'delete-me');
    const hash = await computeSkillFolderHash(dir);
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'delete-me': { source: 'owner/repo', sourceType: 'github', computedHash: hash },
      },
    });
    const skill = (await discoverAll(paths)).project.skills[0]!;

    const result = await deleteSkills(paths, [skill]);
    expect(result.changed).toBe(1);
    expect(await pathExists(dir)).toBe(false);
    expect((await readLock(paths.scopes.project)).skills).toEqual({});
  });

  test('move copies, validates, preserves metadata, then removes the source', async () => {
    const { paths } = await setup();
    const dir = await writeSkill(paths.scopes.project.skillsDir, 'move-me');
    const hash = await computeSkillFolderHash(dir);
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'move-me': {
          source: 'owner/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repo.git',
          ref: 'main',
          skillPath: 'skills/move-me/SKILL.md',
          computedHash: hash,
          pluginName: 'example-plugin',
        },
      },
    });
    const skill = (await discoverAll(paths)).project.skills[0]!;

    const result = await moveSkills(paths, [skill]);
    const destination = join(paths.scopes.global.skillsDir, 'move-me');
    expect(result.changed).toBe(1);
    expect(await pathExists(dir)).toBe(false);
    expect(await pathExists(join(destination, 'SKILL.md'))).toBe(true);
    expect((await readLock(paths.scopes.project)).skills).toEqual({});
    const moved = (await readLock(paths.scopes.global)).skills['move-me'];
    expect(moved?.source).toBe('owner/repo');
    expect(moved?.ref).toBe('main');
    expect(moved?.skillPath).toBe('skills/move-me/SKILL.md');
    expect(moved && 'pluginName' in moved ? moved.pluginName : undefined).toBe('example-plugin');
  });

  test('move refuses a collision until overwrite is explicit', async () => {
    const { paths } = await setup();
    await writeSkill(paths.scopes.project.skillsDir, 'same', { body: 'project copy' });
    await writeSkill(paths.scopes.global.skillsDir, 'same', { body: 'global copy' });
    const skill = (await discoverAll(paths)).project.skills[0]!;

    const refused = await moveSkills(paths, [skill]);
    expect(refused.changed).toBe(0);
    expect(refused.errors[0]).toContain('Destination exists');
    expect(await pathExists(skill.path)).toBe(true);

    const moved = await moveSkills(paths, [skill], true);
    expect(moved.changed).toBe(1);
    const contents = await readFile(
      join(paths.scopes.global.skillsDir, 'same', 'SKILL.md'),
      'utf8'
    );
    expect(contents).toContain('project copy');
  });

  test('fork creates an untracked copy with a renamed frontmatter name', async () => {
    const { paths } = await setup();
    const dir = await writeSkill(paths.scopes.project.skillsDir, 'original');
    const hash = await computeSkillFolderHash(dir);
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        original: { source: 'owner/repo', sourceType: 'github', computedHash: hash },
      },
    });
    const original = (await discoverAll(paths)).project.skills[0]!;

    const result = await forkSkill(paths, original, 'My Fork');
    expect(result.changed).toBe(1);
    const forkPath = join(paths.scopes.project.skillsDir, 'my-fork', 'SKILL.md');
    expect(await readFile(forkPath, 'utf8')).toContain('name: my-fork');
    expect(await pathExists(original.path)).toBe(true);
    const snapshot = await discoverAll(paths);
    expect(snapshot.project.skills.find((skill) => skill.folderName === 'original')?.tracked).toBe(
      true
    );
    expect(snapshot.project.skills.find((skill) => skill.folderName === 'my-fork')?.tracked).toBe(
      false
    );
  });
});
