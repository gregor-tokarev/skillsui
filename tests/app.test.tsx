/** @jsxImportSource @opentui/solid */

import { afterEach, describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../src/app.tsx';
import { pathExists } from '../src/fs-utils.ts';
import { testPaths, waitForAppFrame, writeSkill } from './helpers.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OpenTUI app', () => {
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
      readme: '# Install modal preview',
    });
    await writeSkill(catalog, 'remote-two', {
      body: '# SKILL fallback preview',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>) =>
        Response.json({
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
        }),
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
      expect(results).toContain('README.md');
      expect(results).toContain('PageUp/PageDown preview');

      setup.mockInput.pressKey('j');
      const fallback = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('Preview remote-two') &&
          frame.includes('SKILL.md') &&
          frame.includes('# SKILL fallback preview')
      );
      expect(fallback).not.toContain('# Install modal preview');

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

  test('shows the absolute path and waits for confirmation before delete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-delete-app-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const skillPath = await writeSkill(paths.scopes.project.skillsDir, 'delete-from-ui');

    const setup = await testRender(() => <App paths={paths} />, { width: 120, height: 30 });
    try {
      await waitForAppFrame(setup, (frame) => frame.includes('delete-from-ui'));
      setup.mockInput.pressKey('d', { shift: true });
      const confirmation = await waitForAppFrame(
        setup,
        (frame) =>
          frame.includes('Delete 1 skill?') &&
          frame.includes(`${paths.projectRoot}/.agents/`) &&
          frame.includes('skills/delete-from-ui')
      );
      expect(confirmation).toContain('y confirm');
      expect(await pathExists(skillPath)).toBe(true);

      setup.mockInput.pressKey('n');
      await setup.flush();
      expect(await pathExists(skillPath)).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  });
});
