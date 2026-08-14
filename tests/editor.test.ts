import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSkillFolderInEditor } from '../src/editor.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('editor launcher', () => {
  test('requires $EDITOR', () => {
    expect(openSkillFolderInEditor('/tmp/example', { editor: '' })).rejects.toThrow(
      '$EDITOR is not set'
    );
  });

  test('opens the folder after editor arguments and restores the terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-editor-'));
    temporary.push(root);
    const script = join(root, 'editor');
    const output = `${script}.out`;
    const folder = join(root, 'skill folder');
    await writeFile(
      script,
      '#!/bin/sh\nfor last do :; done\nprintf "%s" "$last" > "$0.out"\n',
      'utf8'
    );
    await chmod(script, 0o755);
    const lifecycle: string[] = [];

    await openSkillFolderInEditor(folder, {
      editor: `${script} --wait`,
      suspend: () => lifecycle.push('suspend'),
      resume: () => lifecycle.push('resume'),
    });

    expect(await readFile(output, 'utf8')).toBe(folder);
    expect(lifecycle).toEqual(['suspend', 'resume']);
  });
});
