/** @jsxImportSource @opentui/solid */

import { afterEach, describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../src/app.tsx';
import { pathExists } from '../src/fs-utils.ts';
import { testPaths, writeSkill } from './helpers.ts';

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
      const initial = await setup.waitForFrame(
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
      await setup.waitForFrame((frame) => frame.includes('Project 0'));
      setup.mockInput.pressKey('i');
      await setup.mockInput.typeText('remote');
      setup.mockInput.pressEnter();

      const results = await setup.waitForFrame(
        (frame) =>
          frame.includes('Install in project scope') &&
          frame.includes('Preview remote-one') &&
          frame.includes('# Install modal preview')
      );
      expect(results).toContain('Results');
      expect(results).toContain('README.md');
      expect(results).toContain('PageUp/PageDown preview');

      setup.mockInput.pressKey('j');
      const fallback = await setup.waitForFrame(
        (frame) =>
          frame.includes('Preview remote-two') &&
          frame.includes('SKILL.md') &&
          frame.includes('# SKILL fallback preview')
      );
      expect(fallback).not.toContain('# Install modal preview');

      setup.mockInput.pressEscape();
      const search = await setup.waitForFrame(
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

  test('shows the absolute path and waits for confirmation before delete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-delete-app-'));
    temporary.push(root);
    const paths = testPaths(join(root, 'project'), join(root, 'home'));
    const skillPath = await writeSkill(paths.scopes.project.skillsDir, 'delete-from-ui');

    const setup = await testRender(() => <App paths={paths} />, { width: 120, height: 30 });
    try {
      await setup.waitForFrame((frame) => frame.includes('delete-from-ui'));
      setup.mockInput.pressKey('d', { shift: true });
      const confirmation = await setup.waitForFrame(
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
