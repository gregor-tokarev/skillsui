import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSearchResult } from '../src/install.ts';
import { readLock } from '../src/lockfiles.ts';
import { testPaths, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('skill installation', () => {
  test('installs in the canonical project folder and links the skill into Claude Code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-install-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const catalog = join(root, 'catalog');
    await writeSkill(catalog, 'linked-skill', { body: '# Installed through the skills CLI' });

    const result = await installSearchResult(
      paths,
      {
        name: 'linked-skill',
        slug: 'local/linked-skill',
        source: catalog,
        installs: 1,
      },
      'project'
    );

    const canonicalPath = join(paths.scopes.project.skillsDir, 'linked-skill');
    const claudePath = join(paths.scopes.project.rootDir, '.claude', 'skills', 'linked-skill');
    expect(result.changed).toBe(1);
    expect(result.errors).toEqual([]);
    expect((await lstat(claudePath)).isSymbolicLink()).toBe(true);
    expect(await realpath(claudePath)).toBe(await realpath(canonicalPath));
    expect(await readFile(join(claudePath, 'SKILL.md'), 'utf8')).toContain(
      'Installed through the skills CLI'
    );
    expect((await readLock(paths.scopes.project)).skills['linked-skill']).toBeDefined();
  });
});
