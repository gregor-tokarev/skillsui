import { afterEach, describe, expect, test } from 'bun:test';
import {
  SEARCH_LOAD_AHEAD,
  SEARCH_MAX_RESULTS,
  SEARCH_PAGE_SIZE,
  searchNeedsMore,
  searchSkills,
} from '../src/install.ts';

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
