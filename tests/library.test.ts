import { describe, expect, spyOn, test } from 'bun:test';
import { createRoot } from 'solid-js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibraryState } from '../src/state/library.ts';
import { writeLock } from '../src/lockfiles.ts';
import * as remote from '../src/remote.ts';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { testPaths, writeSkill } from './helpers.ts';

describe('library update checks', () => {
  test.each(['replace', 'remove'] as const)(
    'ignores an old check after an operation changes its skill: %s',
    async (operation) => {
      const root = await mkdtemp(join(tmpdir(), 'skillsui-library-check-'));
      const paths = testPaths(join(root, 'project'), join(root, 'home'));
      const source = join(root, 'source');
      const sourceSkill = await writeSkill(source, 'skill');
      await writeSkill(paths.scopes.project.skillsDir, 'skill');
      const entry = { source, sourceType: 'local', skillPath: 'skill/SKILL.md', computedHash: '' };
      await writeLock(paths.scopes.project, { version: 1, skills: { skill: entry } });
      const gate = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      const cleaned = Promise.withResolvers<void>();
      const loader = spyOn(remote, 'loadRemote').mockImplementationOnce(async () => {
        started.resolve();
        await gate.promise;
        return {
          root: source,
          sourceType: 'local',
          sourceUrl: source,
          cleanup: async () => {
            cleaned.resolve();
          },
        };
      });
      const { library, dispose } = createRoot((dispose) => ({
        library: createLibraryState(paths),
        dispose,
      }));
      try {
        await library.refresh();
        await started.promise;
        expect(library.updates()['project:skill']).toBe('checking');

        await library.runOperation(operation, async () => {
          await writeLock(paths.scopes.project, {
            version: 1,
            skills:
              operation === 'replace'
                ? { skill: { ...entry, computedHash: await computeSkillFolderHash(sourceSkill) } }
                : {},
          });
          return { changed: 1, message: operation, errors: [] };
        });
        if (operation === 'replace') {
          for (
            let attempt = 0;
            attempt < 100 && library.updates()['project:skill'] !== 'current';
            attempt++
          ) {
            await Bun.sleep(10);
          }
          expect(library.updates()['project:skill']).toBe('current');
        } else {
          expect(library.updates()).toEqual({});
        }

        gate.resolve();
        await cleaned.promise;
        await Bun.sleep(0);
        expect(library.updates()).toEqual(
          operation === 'replace' ? { 'project:skill': 'current' } : {}
        );
        expect(library.status()).not.toContain('update available');
        expect(loader).toHaveBeenCalledTimes(operation === 'replace' ? 2 : 1);
      } finally {
        dispose();
        gate.resolve();
        await cleaned.promise;
        loader.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
