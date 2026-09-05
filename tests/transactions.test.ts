import { rejects } from 'node:assert/strict';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDirectoryTransaction } from '../src/transactions.ts';
import { writeSkill } from './helpers.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillsui-transactions-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('staging validation failure leaves an existing destination intact', async () => {
  const source = join(root, 'source');
  await mkdir(source);
  const destination = await writeSkill(root, 'destination', { body: 'Keep this skill.' });
  const original = await readFile(join(destination, 'SKILL.md'), 'utf8');
  let committed = false;

  await rejects(
    copyDirectoryTransaction({
      source,
      destination,
      overwrite: true,
      commit: async () => {
        committed = true;
      },
    }),
    /Copied folder has no SKILL.md/
  );

  expect(committed).toBe(false);
  expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(original);
  expect((await readdir(root)).sort()).toEqual(['destination', 'source']);
});

test('staging mutation failure leaves an existing destination intact', async () => {
  const source = await writeSkill(root, 'source');
  const destination = await writeSkill(root, 'destination');
  const original = await readFile(join(destination, 'SKILL.md'), 'utf8');

  await rejects(
    copyDirectoryTransaction({
      source,
      destination,
      overwrite: true,
      mutateStaged: async () => {
        throw new Error('Cannot rewrite skill');
      },
      commit: async () => {},
    }),
    /Cannot rewrite skill/
  );

  expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(original);
  expect((await readdir(root)).sort()).toEqual(['destination', 'source']);
});

test('failed move commit restores both source and overwritten destination', async () => {
  const source = await writeSkill(root, 'source');
  const destination = await writeSkill(root, 'destination');
  const sourceContents = await readFile(join(source, 'SKILL.md'), 'utf8');
  const destinationContents = await readFile(join(destination, 'SKILL.md'), 'utf8');

  await rejects(
    copyDirectoryTransaction({
      source,
      destination,
      overwrite: true,
      removeSource: true,
      commit: async () => {
        throw new Error('Cannot write lockfile');
      },
    }),
    /Cannot write lockfile/
  );

  expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(sourceContents);
  expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(destinationContents);
  expect((await readdir(root)).sort()).toEqual(['destination', 'source']);
});

test('failed copy commit removes a newly installed destination', async () => {
  const source = await writeSkill(root, 'source');

  await rejects(
    copyDirectoryTransaction({
      source,
      destination: join(root, 'destination'),
      overwrite: false,
      commit: async () => {
        throw new Error('Cannot write lockfile');
      },
    }),
    /Cannot write lockfile/
  );

  expect(await readdir(root)).toEqual(['source']);
});
