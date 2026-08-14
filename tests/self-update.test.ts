import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathExists } from '../src/fs-utils.ts';
import {
  defaultInstallPath,
  normalizeVersion,
  releaseAssetName,
  updateSelf,
} from '../src/self-update.ts';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function releaseFetch(options: {
  tag: string;
  bytes: Buffer;
  checksum?: string;
  asset?: string;
  fail?: string;
}): typeof fetch {
  const asset = options.asset ?? 'skillsui-darwin-arm64';
  const checksum = options.checksum ?? `${sha256(options.bytes)}  ${asset}\n`;
  return Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (options.fail && url.includes(options.fail)) {
        return new Response('missing', { status: 404 });
      }
      if (url.endsWith('/releases/latest')) {
        return Response.json({ tag_name: options.tag });
      }
      if (url.endsWith(`/${asset}.sha256`)) {
        return new Response(checksum);
      }
      if (url.endsWith(`/${asset}`)) {
        return new Response(Uint8Array.from(options.bytes));
      }
      return new Response('not found', { status: 404 });
    },
    { preconnect: globalThis.fetch.preconnect }
  );
}

describe('release asset names', () => {
  test('maps unix platforms and architectures the installer understands', () => {
    expect(releaseAssetName('darwin', 'arm64')).toBe('skillsui-darwin-arm64');
    expect(releaseAssetName('linux', 'x64')).toBe('skillsui-linux-x64');
    expect(releaseAssetName('linux', 'aarch64')).toBe('skillsui-linux-arm64');
    expect(releaseAssetName('darwin', 'amd64')).toBe('skillsui-darwin-x64');
    expect(() => releaseAssetName('win32', 'x64')).toThrow('win32');
    expect(() => releaseAssetName('darwin', 'ia32')).toThrow('ia32');
  });

  test('strips a leading v from release tags', () => {
    expect(normalizeVersion('v0.1.2')).toBe('0.1.2');
    expect(normalizeVersion('0.1.2')).toBe('0.1.2');
  });

  test('replaces a compiled binary and falls back to ~/.local/bin', () => {
    expect(defaultInstallPath({ execPath: '/opt/skillsui' })).toBe('/opt/skillsui');
    expect(defaultInstallPath({ execPath: '/usr/local/bin/skillsui-darwin-arm64' })).toBe(
      '/usr/local/bin/skillsui-darwin-arm64'
    );
    expect(defaultInstallPath({ execPath: '/opt/homebrew/bin/bun', homeDir: '/Users/me' })).toBe(
      '/Users/me/.local/bin/skillsui'
    );
    expect(
      defaultInstallPath({
        execPath: '/opt/homebrew/bin/bun',
        installDir: '/usr/local/bin',
      })
    ).toBe('/usr/local/bin/skillsui');
  });
});

describe('updateSelf', () => {
  test('downloads the latest release, verifies the checksum, and replaces the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-self-update-'));
    temporary.push(root);
    const destination = join(root, 'bin', 'skillsui');
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(destination, 'old');
    const bytes = Buffer.from('new-skillsui-binary');

    const result = await updateSelf({
      destination,
      currentVersion: '0.1.1',
      platform: 'darwin',
      architecture: 'arm64',
      fetch: releaseFetch({ tag: 'v0.1.2', bytes }),
    });

    expect(result.status).toBe('updated');
    expect(result.version).toBe('0.1.2');
    expect(result.destination).toBe(destination);
    expect(result.message).toContain('v0.1.2');
    expect(await readFile(destination)).toEqual(bytes);
    expect((await Bun.file(destination).stat()).mode & 0o111).toBeGreaterThan(0);
  });

  test('skips the download when the running binary is already the latest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-self-current-'));
    temporary.push(root);
    const destination = join(root, 'skillsui');
    await writeFile(destination, 'current-binary');
    let downloads = 0;

    const result = await updateSelf({
      destination,
      execPath: destination,
      currentVersion: '0.1.2',
      platform: 'linux',
      architecture: 'x64',
      fetch: Object.assign(
        async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith('/releases/latest')) return Response.json({ tag_name: 'v0.1.2' });
          downloads += 1;
          return new Response('should-not-download', { status: 500 });
        },
        { preconnect: globalThis.fetch.preconnect }
      ),
    });

    expect(result.status).toBe('current');
    expect(result.message).toBe('skillsui is already up to date (v0.1.2)');
    expect(downloads).toBe(0);
    expect(await readFile(destination, 'utf8')).toBe('current-binary');
  });

  test('installs a pinned tag even when it matches the current version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-self-pin-'));
    temporary.push(root);
    const destination = join(root, 'skillsui');
    const bytes = Buffer.from('reinstalled');

    const result = await updateSelf({
      version: 'v0.1.2',
      destination,
      execPath: destination,
      currentVersion: '0.1.2',
      platform: 'darwin',
      architecture: 'x64',
      fetch: releaseFetch({ tag: 'v0.1.2', bytes, asset: 'skillsui-darwin-x64' }),
    });

    expect(result.status).toBe('updated');
    expect(await readFile(destination)).toEqual(bytes);
  });

  test('refuses a checksum mismatch and leaves the existing binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-self-checksum-'));
    temporary.push(root);
    const destination = join(root, 'skillsui');
    await writeFile(destination, 'keep-me');
    const bytes = Buffer.from('tampered');

    await expect(
      updateSelf({
        destination,
        currentVersion: '0.1.0',
        platform: 'linux',
        architecture: 'arm64',
        fetch: releaseFetch({
          tag: 'v0.1.2',
          bytes,
          asset: 'skillsui-linux-arm64',
          checksum: `${'0'.repeat(64)}  skillsui-linux-arm64\n`,
        }),
      })
    ).rejects.toThrow('Checksum mismatch');
    expect(await readFile(destination, 'utf8')).toBe('keep-me');
  });

  test('surfaces a missing release asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-self-missing-'));
    temporary.push(root);
    const destination = join(root, 'skillsui');

    await expect(
      updateSelf({
        destination,
        platform: 'darwin',
        architecture: 'arm64',
        fetch: releaseFetch({
          tag: 'v0.1.2',
          bytes: Buffer.from('unused'),
          fail: 'skillsui-darwin-arm64',
        }),
      })
    ).rejects.toThrow('Download failed (404)');
    expect(await pathExists(destination)).toBe(false);
  });
});
