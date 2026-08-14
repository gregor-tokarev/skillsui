import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathExists, temporarySibling } from './fs-utils.ts';
import { CLI_VERSION } from './version.ts';

const DEFAULT_REPOSITORY = 'gregor-tokarev/skillsui';

export interface SelfUpdateOptions {
  version?: string;
  destination?: string;
  currentVersion?: string;
  repository?: string;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform | string;
  architecture?: string;
  execPath?: string;
  homeDir?: string;
}

export interface SelfUpdateResult {
  status: 'updated' | 'current';
  version: string;
  destination: string;
  message: string;
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function releaseAssetName(
  platform: NodeJS.Platform | string = process.platform,
  architecture: string = process.arch
): string {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  if (!os) throw new Error(`skillsui does not support ${platform}`);

  const arch =
    architecture === 'arm64' || architecture === 'aarch64'
      ? 'arm64'
      : architecture === 'x64' || architecture === 'amd64' || architecture === 'x86_64'
        ? 'x64'
        : null;
  if (!arch) throw new Error(`skillsui does not support ${architecture}`);

  return `skillsui-${os}-${arch}`;
}

export function defaultInstallPath(
  options: {
    execPath?: string;
    homeDir?: string;
    installDir?: string;
  } = {}
): string {
  if (options.installDir) return join(options.installDir, 'skillsui');
  const execPath = options.execPath ?? process.execPath;
  const name = basename(execPath);
  if (name === 'skillsui' || name.startsWith('skillsui-')) return execPath;
  return join(options.homeDir ?? homedir(), '.local', 'bin', 'skillsui');
}

async function fetchOk(
  fetchImpl: typeof fetch,
  url: string,
  headers?: Record<string, string>
): Promise<Response> {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': `skillsui/${CLI_VERSION}`,
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}

async function resolveReleaseTag(
  fetchImpl: typeof fetch,
  repository: string,
  requested: string
): Promise<string> {
  if (requested !== 'latest') return requested.startsWith('v') ? requested : `v${requested}`;

  const response = await fetchOk(
    fetchImpl,
    `https://api.github.com/repos/${repository}/releases/latest`,
    { Accept: 'application/vnd.github+json' }
  );
  const data = (await response.json()) as { tag_name?: string };
  if (!data.tag_name) throw new Error(`No release tag found for ${repository}`);
  return data.tag_name;
}

function checksumFromFile(contents: string): string {
  const hash = contents.trim().split(/\s+/)[0];
  if (!hash) throw new Error('Checksum file is empty');
  return hash.toLowerCase();
}

async function replaceBinary(destination: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const staged = temporarySibling(destination, 'download');
  try {
    await writeFile(staged, bytes);
    await chmod(staged, 0o755);
    try {
      await rename(staged, destination);
    } catch {
      await rm(destination, { force: true });
      await rename(staged, destination);
    }
  } catch (error) {
    await rm(staged, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function updateSelf(options: SelfUpdateOptions = {}): Promise<SelfUpdateResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const repository = options.repository ?? process.env.SKILLSUI_REPOSITORY ?? DEFAULT_REPOSITORY;
  const requested = options.version ?? process.env.SKILLSUI_VERSION ?? 'latest';
  const destination =
    options.destination ??
    defaultInstallPath({
      execPath: options.execPath,
      homeDir: options.homeDir,
      installDir: process.env.SKILLSUI_INSTALL_DIR,
    });
  const currentVersion = options.currentVersion ?? CLI_VERSION;
  const asset = releaseAssetName(options.platform, options.architecture);
  const tag = await resolveReleaseTag(fetchImpl, repository, requested);
  const version = normalizeVersion(tag);

  if (
    requested === 'latest' &&
    (options.execPath ?? process.execPath) === destination &&
    normalizeVersion(currentVersion) === version &&
    (await pathExists(destination))
  ) {
    return {
      status: 'current',
      version,
      destination,
      message: `skillsui is already up to date (v${version})`,
    };
  }

  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`;
  const [binaryResponse, checksumResponse] = await Promise.all([
    fetchOk(fetchImpl, `${baseUrl}/${asset}`),
    fetchOk(fetchImpl, `${baseUrl}/${asset}.sha256`),
  ]);
  const bytes = new Uint8Array(await binaryResponse.arrayBuffer());
  const expected = checksumFromFile(await checksumResponse.text());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (expected !== actual) throw new Error(`Checksum mismatch for ${asset}`);

  await replaceBinary(destination, bytes);
  return {
    status: 'updated',
    version,
    destination,
    message: `Installed v${version} to ${destination}`,
  };
}
