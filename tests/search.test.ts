import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { delay, isAbortError } from '../src/abort.ts';
import {
  loadInstallPreview,
  SEARCH_LOAD_AHEAD,
  SEARCH_MAX_RESULTS,
  SEARCH_PAGE_SIZE,
  searchNeedsMore,
  searchSkills,
} from '../src/install.ts';
import { loadRemote } from '../src/remote.ts';
import { PREVIEW_DEBOUNCE_MS } from '../src/state/search.ts';
import { writeSkill } from './helpers.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function catalog(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `owner/repo/skill-${index + 1}`,
    name: `skill-${index + 1}`,
    source: 'owner/repo',
    installs: count - index,
  }));
}

describe('searchNeedsMore', () => {
  test('loads when the cursor is five items before the last result', () => {
    expect(searchNeedsMore(0, 0)).toBe(false);
    expect(searchNeedsMore(13, SEARCH_PAGE_SIZE)).toBe(false);
    expect(searchNeedsMore(SEARCH_PAGE_SIZE - 1 - SEARCH_LOAD_AHEAD, SEARCH_PAGE_SIZE)).toBe(true);
    expect(searchNeedsMore(SEARCH_PAGE_SIZE - 1, SEARCH_PAGE_SIZE)).toBe(true);
  });
});

describe('searchSkills', () => {
  test('requests the first page of 20 results and reports when more exist', async () => {
    const calls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const href = String(input);
        calls.push(href);
        return Response.json({ skills: catalog(SEARCH_PAGE_SIZE) });
      },
      { preconnect: originalFetch.preconnect }
    );

    const page = await searchSkills('react');
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('react');
    expect(url.searchParams.get('limit')).toBe(String(SEARCH_PAGE_SIZE));
    expect(url.searchParams.get('offset')).toBeNull();
    expect(page.skills).toHaveLength(SEARCH_PAGE_SIZE);
    expect(page.skills[0]?.name).toBe('skill-1');
    expect(page.hasMore).toBe(true);
  });

  test('fetches a longer prefix and slices later pages because the API ignores offset', async () => {
    const calls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const href = String(input);
        calls.push(href);
        const url = new URL(href);
        return Response.json({
          skills: catalog(Number(url.searchParams.get('limit'))),
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const page = await searchSkills('react', SEARCH_PAGE_SIZE);
    const url = new URL(calls[0]!);
    expect(url.searchParams.get('limit')).toBe(String(SEARCH_PAGE_SIZE * 2));
    expect(url.searchParams.get('offset')).toBe(String(SEARCH_PAGE_SIZE));
    expect(page.skills.map((skill) => skill.name)).toEqual(
      Array.from({ length: SEARCH_PAGE_SIZE }, (_, index) => `skill-${index + 21}`)
    );
    expect(page.hasMore).toBe(true);
  });

  test('always returns a 20-skill page even if the offset is not aligned', async () => {
    const calls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return Response.json({ skills: catalog(SEARCH_PAGE_SIZE) });
      },
      { preconnect: originalFetch.preconnect }
    );

    const page = await searchSkills('react', 6);
    const url = new URL(calls[0]!);
    expect(url.searchParams.get('limit')).toBe(String(SEARCH_PAGE_SIZE));
    expect(url.searchParams.get('offset')).toBeNull();
    expect(page.skills).toHaveLength(SEARCH_PAGE_SIZE);
    expect(page.skills[0]?.name).toBe('skill-1');
    expect(page.hasMore).toBe(true);
  });

  test('stops after the API maximum even when a full last page is returned', async () => {
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        return Response.json({
          skills: catalog(Number(url.searchParams.get('limit'))),
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    const page = await searchSkills('react', SEARCH_MAX_RESULTS - SEARCH_PAGE_SIZE);
    expect(page.skills).toHaveLength(SEARCH_PAGE_SIZE);
    expect(page.skills[0]?.name).toBe(`skill-${SEARCH_MAX_RESULTS - SEARCH_PAGE_SIZE + 1}`);
    expect(page.hasMore).toBe(false);
  });
});

describe('preview debounce and abort', () => {
  test('preview waits 100ms before fetching', () => {
    expect(PREVIEW_DEBOUNCE_MS).toBe(100);
  });

  test('delay rejects as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = delay(1000, controller.signal);
    controller.abort();
    let thrown: unknown;
    try {
      await pending;
    } catch (error) {
      thrown = error;
    }
    expect(isAbortError(thrown)).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });

  test('loadInstallPreview does not start when the signal is already aborted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillsui-preview-abort-'));
    try {
      await writeSkill(root, 'remote-one', { readme: '# Should not load' });
      const controller = new AbortController();
      controller.abort();
      let thrown: unknown;
      try {
        await loadInstallPreview(
          { name: 'remote-one', slug: 'local/remote-one', source: root, installs: 1 },
          controller.signal
        );
      } catch (error) {
        thrown = error;
      }
      expect(isAbortError(thrown)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('aborts an in-flight git clone when the signal fires', async () => {
    const server = createServer((socket) => {
      socket.pause();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');
    const controller = new AbortController();
    const started = Date.now();
    const pending = loadRemote(
      {
        source: `https://127.0.0.1:${address.port}/owner/repo.git`,
        sourceType: 'git',
        sourceUrl: `https://127.0.0.1:${address.port}/owner/repo.git`,
        computedHash: '',
      },
      controller.signal
    );
    await delay(50);
    controller.abort();
    let thrown: unknown;
    try {
      await pending;
    } catch (error) {
      thrown = error;
    }
    server.close();
    expect(isAbortError(thrown)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
