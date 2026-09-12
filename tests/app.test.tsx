/** @jsxImportSource @opentui/solid */

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../src/app.tsx';
import { pathExists } from '../src/fs-utils.ts';
import { writeLock } from '../src/lockfiles.ts';
import * as remote from '../src/remote.ts';
import { computeSkillFolderHash } from '../vendor/skills/src/local-lock.ts';
import { testPaths, waitForAppFrame, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OpenTUI app', () => {
  test('shows five checking rows across both panes, waiting rows, and incremental results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-app-update-queue-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const source = join(root, 'source');
    await writeSkill(source, 'remote-skill');
    for (let index = 0; index < 7; index++) {
      const scope = index < 3 ? paths.scopes.project : paths.scopes.global;
      await writeSkill(scope.skillsDir, `skill-${index}`);
    }
    for (const scope of Object.values(paths.scopes)) {
      const indices = scope.id === 'project' ? [0, 1, 2] : [3, 4, 5, 6];
      await writeLock(scope, {
        version: scope.lockVersion,
        skills: Object.fromEntries(
          indices.map((index) => [
            `skill-${index}`,
            {
              source: `source-${index}`,
              sourceType: 'local',
              sourceUrl: `source-${index}`,
              skillPath: 'remote-skill/SKILL.md',
              computedHash: '',
              skillFolderHash: '',
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ])
        ),
      });
    }
    const gates = Array.from({ length: 7 }, () => Promise.withResolvers<void>());
    const cleaned: string[] = [];
    const loader = spyOn(remote, 'loadRemote').mockImplementation(async (entry) => {
      const index = Number(entry.sourceUrl!.split('-')[1]);
      await gates[index]!.promise;
      return {
        root: source,
        sourceType: 'local',
        sourceUrl: source,
        cleanup: async () => {
          cleaned.push(entry.source);
        },
      };
    });
    const setup = await testRender(() => <App paths={paths} />, { width: 120, height: 30 });
    try {
      const queued = await waitForAppFrame(
        setup,
        (frame) => (frame.match(/checking…/g) || []).length === 5 && frame.includes('waiting')
      );
      expect(queued.match(/waiting/g)).toHaveLength(2);
      expect(loader).toHaveBeenCalledTimes(5);

      gates[0]!.resolve();
      const progressed = await waitForAppFrame(setup, (frame) => frame.includes('↑ update'));
      expect(progressed.match(/checking…/g)).toHaveLength(5);
      expect(progressed.match(/waiting/g)).toHaveLength(1);
      expect(loader).toHaveBeenCalledTimes(6);

      setup.mockInput.pressKey('r');
      const reloaded = await waitForAppFrame(
        setup,
        (frame) => (frame.match(/waiting/g) || []).length === 7
      );
      expect(reloaded).not.toContain('checking…');
      expect(reloaded).not.toContain('↑ update');
      expect(loader).toHaveBeenCalledTimes(6);

      for (const gate of gates) gate.resolve();
      const finished = await waitForAppFrame(setup, (frame) =>
        frame.includes('7 updates available')
      );
      expect(finished.match(/↑ update/g)).toHaveLength(7);
      expect(finished).not.toContain('waiting');
      expect(finished).not.toContain('checking…');
      expect(loader).toHaveBeenCalledTimes(13);
    } finally {
      setup.renderer.destroy();
      for (const gate of gates) gate.resolve();
      // Let cancelled downloads clean up before removing their source fixture.
      for (let attempt = 0; attempt < 100 && cleaned.length < loader.mock.calls.length; attempt++) {
        await Bun.sleep(10);
      }
      loader.mockRestore();
    }
  });

  test('renders both scopes without a main-window preview and supports selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-app-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    await writeSkill(paths.scopes.project.skillsDir, 'project-one', {
      readme: '# Readme preview',
    });
    await writeSkill(paths.scopes.global.skillsDir, 'global-one');

    const setup = await testRender(() => <App paths={paths} />, { width: 120, height: 30 });
    try {
      const initial = await waitForAppFrame(
        setup,
        (frame) => frame.includes('project-one') && frame.includes('global-one')
      );
      expect(initial).toContain('Project 1');
      expect(initial).toContain('Global 1');
      expect(initial).not.toContain('# Readme preview');
      expect(initial).not.toContain('Preview project-one');

      setup.mockInput.pressKey('x');
      await setup.flush();
      expect(setup.captureCharFrame()).toContain('[x] project-one');
    } finally {
      setup.renderer.destroy();
    }
  });

  test('keeps long names visible at narrow widths and badges only local skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-narrow-app-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const source = join(root, 'source');
    const sourceSkill = await writeSkill(source, 'alpha-skill', { body: 'version one' });
    const installed = await writeSkill(paths.scopes.project.skillsDir, 'alpha-skill', {
      body: 'version one',
    });
    await writeLock(paths.scopes.project, {
      version: 1,
      skills: {
        'alpha-skill': {
          source,
          sourceType: 'local',
          skillPath: 'alpha-skill/SKILL.md',
          computedHash: await computeSkillFolderHash(installed),
        },
      },
    });
    await writeSkill(paths.scopes.global.skillsDir, 'beta-skill');
    await writeFile(
      join(sourceSkill, 'SKILL.md'),
      `---\nname: alpha-skill\ndescription: alpha-skill description\n---\n\nversion two\n`,
      'utf8'
    );

    const setup = await testRender(() => <App paths={paths} />, { width: 60, height: 20 });
    try {
      const frame = await waitForAppFrame(setup, (text) => text.includes('↑ update'));
      // The tracked row keeps a name stub next to the marker instead of
      // surrendering the whole row to badges.
      expect(frame).toContain('alpha-s…');
      expect(frame).not.toContain('tracked');
      expect(frame).toContain('beta-skill');
      expect(frame).toContain('local');
    } finally {
      setup.renderer.destroy();
    }
  });

  test('hides the project pane when opened from the home directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-home-app-'));
    temporary.push(root);
    const paths = testPaths(root, root);
    await writeSkill(paths.scopes.global.skillsDir, 'home-skill');

    const setup = await testRender(() => <App paths={paths} />, { width: 120, height: 30 });
    try {
      const frame = await waitForAppFrame(setup, (text) => text.includes('home-skill'));
      expect(frame).toContain('Global 1');
      expect(frame).not.toContain('Project');
      expect(frame).toContain('i install');
      expect(frame).not.toContain('h/l pane');
      expect(frame).not.toContain('M move');
    } finally {
      setup.renderer.destroy();
    }
  });

  test('previews the selected search result inside the install modal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-install-preview-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const catalog = join(root, 'catalog');
    await writeSkill(catalog, 'remote-one', {
      body: '# Install modal preview',
      readme: '# README should not be previewed',
    });
    await writeSkill(catalog, 'remote-two', {
      body: '# Second SKILL preview',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.startsWith('/api/download/')) {
          const name = url.pathname.split('/').at(-1);
          return Response.json({
            files: [
              { path: 'README.md', contents: '# README should not be previewed' },
              {
                path: 'SKILL.md',
                contents:
                  name === 'remote-one' ? '# Install modal preview' : '# Second SKILL preview',
              },
            ],
          });
        }
        return Response.json({
          skills: [
            {
              id: 'local/remote-one',
              name: 'remote-one',
              source: catalog,
              installs: 42,
            },
            {
              id: 'local/remote-two',
              name: 'remote-two',
              source: catalog,
              installs: 21,
            },
          ],
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const setup = await testRender(() => <App paths={paths} />, {
      width: 120,
      height: 30,
      kittyKeyboard: true,
    });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('Project 0'));
      setup.mockInput.pressKey('i');
      await setup.mockInput.typeText('remote');
      setup.mockInput.pressEnter();

      const results = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('Install in project scope') &&
          frame.includes('Preview remote-one') &&
          frame.includes('# Install modal preview')
      );
      expect(results).toContain('Results');
      expect(results).toContain('SKILL.md');
      expect(results).not.toContain('# README should not be previewed');
      expect(results).toContain('PageUp/PageDown preview');

      setup.mockInput.pressKey('j');
      const second = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('Preview remote-two') &&
          frame.includes('SKILL.md') &&
          frame.includes('# Second SKILL preview')
      );
      expect(second).not.toContain('# Install modal preview');

      setup.mockInput.pressEscape();
      const search = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('Install in project scope') &&
          frame.includes('Search: remote_') &&
          !frame.includes('Results') &&
          !frame.includes('Preview remote-two')
      );
      expect(search).toContain('Esc close');

      setup.mockInput.pressEscape();
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain('Install in project scope');
    } finally {
      globalThis.fetch = originalFetch;
      setup.renderer.destroy();
    }
  });

  test('skips the previous preview fetch when moving off a search row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-preview-cancel-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const catalog = join(root, 'catalog');
    await writeSkill(catalog, 'remote-one', { body: '# Cancelled preview' });
    await writeSkill(catalog, 'remote-two', { body: '# Kept preview' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.startsWith('/api/download/')) {
          const name = url.pathname.split('/').at(-1);
          return Response.json({
            files: [
              {
                path: 'SKILL.md',
                contents: name === 'remote-one' ? '# Cancelled preview' : '# Kept preview',
              },
            ],
          });
        }
        return Response.json({
          skills: [
            {
              id: 'local/remote-one',
              name: 'remote-one',
              source: catalog,
              installs: 42,
            },
            {
              id: 'local/remote-two',
              name: 'remote-two',
              source: catalog,
              installs: 21,
            },
          ],
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const setup = await testRender(() => <App paths={paths} />, {
      width: 120,
      height: 30,
      kittyKeyboard: true,
    });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('Project 0'));
      setup.mockInput.pressKey('i');
      await setup.mockInput.typeText('remote');
      setup.mockInput.pressEnter();

      await waitForAppFrame(
        setup,
        (frame) => frame.includes('Results') && frame.includes('remote-two')
      );
      setup.mockInput.pressKey('j');

      const kept = await waitForAppFrame(
        setup,
        (frame) => frame.includes('Preview remote-two') && frame.includes('# Kept preview')
      );
      expect(kept).not.toContain('# Cancelled preview');
    } finally {
      globalThis.fetch = originalFetch;
      setup.renderer.destroy();
    }
  });

  test('pages past the first 20 search results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-search-page-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const catalog = join(root, 'catalog');
    await writeSkill(catalog, 'remote-one', { readme: '# Paged preview' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const limit = Number(url.searchParams.get('limit') || '20');
        return Response.json({
          skills: Array.from({ length: limit }, (_, index) => {
            const name = `hit-${String(index + 1).padStart(2, '0')}`;
            return {
              id: `local/${name}`,
              name,
              source: catalog,
              installs: limit - index,
            };
          }),
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const setup = await testRender(() => <App paths={paths} />, {
      width: 120,
      height: 30,
      kittyKeyboard: true,
    });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('Project 0'));
      setup.mockInput.pressKey('i');
      await setup.mockInput.typeText('page');
      setup.mockInput.pressEnter();

      const first = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('20 results · more available') &&
          frame.includes('Results 1/20') &&
          frame.includes('hit-01')
      );
      expect(first).toContain('n/p page');
      expect(first).not.toContain('hit-21');

      setup.mockInput.pressKey('n');
      const second = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('40 results · more available') &&
          frame.includes('hit-21') &&
          frame.includes('Results 21/40')
      );
      expect(second).not.toContain('hit-01');

      setup.mockInput.pressKey('p');
      const back = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('hit-01') &&
          frame.includes('Results 1/40') &&
          frame.includes('40 results · more available')
      );
      expect(back).not.toContain('hit-21');
    } finally {
      globalThis.fetch = originalFetch;
      setup.renderer.destroy();
    }
  });

  test('prefetches the next 20 results five items before the last loaded row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-search-ahead-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const catalog = join(root, 'catalog');
    await writeSkill(catalog, 'remote-one', { readme: '# Ahead preview' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const limit = Number(url.searchParams.get('limit') || '20');
        return Response.json({
          skills: Array.from({ length: limit }, (_, index) => {
            const name = `hit-${String(index + 1).padStart(2, '0')}`;
            return {
              id: `local/${name}`,
              name,
              source: catalog,
              installs: limit - index,
            };
          }),
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const setup = await testRender(() => <App paths={paths} />, {
      width: 120,
      height: 30,
      kittyKeyboard: true,
    });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('Project 0'));
      setup.mockInput.pressKey('i');
      await setup.mockInput.typeText('page');
      setup.mockInput.pressEnter();
      await waitForAppFrame(
        setup,
        (frame) => frame.includes('20 results · more available') && frame.includes('Results 1/20')
      );

      for (let step = 0; step < 14; step++) {
        setup.mockInput.pressKey('j');
        await waitForAppFrame(setup, (frame) => frame.includes(`Results ${step + 2}/`));
      }
      const prefetched = await waitForAppFrame(
        setup,
        (frame) => frame.includes('40 results · more available') && frame.includes('Results 15/40')
      );
      expect(prefetched).toContain('hit-15');
    } finally {
      globalThis.fetch = originalFetch;
      setup.renderer.destroy();
    }
  });

  test('keeps the result list scrollable and fills a tall screen 20 at a time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-search-scroll-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const catalog = join(root, 'catalog');
    await writeSkill(catalog, 'remote-one', { readme: '# Scroll preview' });

    const originalFetch = globalThis.fetch;
    const limits: number[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const limit = Number(url.searchParams.get('limit') || '20');
        limits.push(limit);
        return Response.json({
          skills: Array.from({ length: limit }, (_, index) => {
            const name = `hit-${String(index + 1).padStart(2, '0')}`;
            return {
              id: `local/${name}`,
              name,
              source: catalog,
              installs: limit - index,
            };
          }),
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const setup = await testRender(() => <App paths={paths} />, {
      width: 120,
      height: 60,
      kittyKeyboard: true,
    });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('Project 0'));
      setup.mockInput.pressKey('i');
      await setup.mockInput.typeText('page');
      setup.mockInput.pressEnter();

      const filled = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('40 results · more available') &&
          frame.includes('hit-01') &&
          frame.includes('hit-21')
      );
      expect(limits.every((limit) => limit % 20 === 0)).toBe(true);
      expect(filled).toContain('Results');
    } finally {
      globalThis.fetch = originalFetch;
      setup.renderer.destroy();
    }
  });

  test('edits the fork name and cancels without touching the skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-fork-app-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    await writeSkill(paths.scopes.project.skillsDir, 'fork-source');

    const setup = await testRender(() => <App paths={paths} />, {
      width: 120,
      height: 30,
      kittyKeyboard: true,
    });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('fork-source'));
      setup.mockInput.pressKey('f');
      const opened = await waitForAppFrame(
        setup,
        (frame) => frame.includes('Fork fork-source') && frame.includes('Name: fork-source-fork_')
      );
      expect(opened).toContain('Enter fork');

      setup.mockInput.pressBackspace();
      await setup.mockInput.typeText('2');
      await waitForAppFrame(setup, (frame) => frame.includes('Name: fork-source-for2_'));

      setup.mockInput.pressEscape();
      const cancelled = await waitForAppFrame(setup, (frame) => frame.includes('Cancelled'));
      expect(cancelled).not.toContain('Fork fork-source');
      expect(await pathExists(join(paths.scopes.project.skillsDir, 'fork-source-for2'))).toBe(
        false
      );
    } finally {
      setup.renderer.destroy();
    }
  });

  test('shows the absolute path, cancels with Escape, and confirms with Enter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-delete-app-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const skillPath = await writeSkill(paths.scopes.project.skillsDir, 'delete-from-ui');

    const setup = await testRender(() => <App paths={paths} />, { width: 120, height: 30 });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('delete-from-ui'));
      setup.mockInput.pressKey('d');
      const confirmation = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('Delete 1 skill?') &&
          frame.includes(`${paths.projectRoot}/.agents/`) &&
          frame.includes('skills/delete-from-ui')
      );
      expect(confirmation).toContain('Enter/y confirm');
      expect(confirmation).toContain('Esc/n cancel');
      expect(await pathExists(skillPath)).toBe(true);

      setup.mockInput.pressEscape();
      await waitForAppFrame(setup, (frame) => frame.includes('Cancelled'));
      expect(await pathExists(skillPath)).toBe(true);

      setup.mockInput.pressKey('d');
      await waitForAppFrame(setup, (frame) => frame.includes('Delete 1 skill?'));
      setup.mockInput.pressEnter();
      await waitForAppFrame(setup, (frame) => frame.includes('Deleted 1 skill'));
      expect(await pathExists(skillPath)).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  });
});
