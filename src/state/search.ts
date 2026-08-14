import { onCleanup, type Accessor, type Setter } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { delay, isAbortError } from '../abort.ts';
import type { AppPaths } from '../paths.ts';
import {
  findInstallCollision,
  installSearchResult,
  loadInstallPreview,
  SEARCH_PAGE_SIZE,
  searchNeedsMore,
  searchSkills,
  type InstallPreview,
  type SearchSkill,
} from '../install.ts';
import type { ScopeId } from '../types.ts';
import { searchResultsCapacity, type Modal, type SearchModal } from '../ui/modals.tsx';
import type { LibraryState } from './library.ts';

export const PREVIEW_DEBOUNCE_MS = 100;

export interface SearchControllerDeps {
  paths: AppPaths;
  library: LibraryState;
  modal: Accessor<Modal | null>;
  setModal: Setter<Modal | null>;
}

export type SearchController = ReturnType<typeof createSearchController>;

function resultKey(result: SearchSkill): string {
  return `${result.source}\0${result.name}`;
}

function searchStatus(count: number, hasMore: boolean, loadingMore = false): string {
  if (count === 0) return 'No results, or skills.sh could not be reached';
  const noun = `${count} result${count === 1 ? '' : 's'}`;
  if (loadingMore) return `${noun} · loading more`;
  return hasMore ? `${noun} · more available` : noun;
}

/**
 * The skills.sh install modal: query entry, paged results, preview loading, and
 * the install itself. Preview fetches wait 100ms, and leaving a row aborts the
 * clone or fetch. Late responses are also dropped by generation counters.
 */
export function createSearchController({ paths, library, modal, setModal }: SearchControllerDeps) {
  const dimensions = useTerminalDimensions();
  const previewCache = new Map<string, InstallPreview>();

  let disposed = false;
  let previewGeneration = 0;
  let searchGeneration = 0;
  let previewAbort: AbortController | null = null;

  function abortPreviewRequest(): void {
    previewAbort?.abort();
    previewAbort = null;
  }

  /** Discards in-flight preview and search responses. */
  function cancelPendingRequests(): void {
    abortPreviewRequest();
    previewGeneration++;
    searchGeneration++;
  }

  function openSearch(scope: ScopeId): void {
    cancelPendingRequests();
    setModal({
      type: 'search',
      scope,
      phase: 'query',
      query: '',
      results: [],
      index: 0,
      loading: false,
      loadingMore: false,
      hasMore: false,
      message: 'Type at least two characters, then press Enter',
      preview: '',
      previewFile: '',
      previewState: 'idle',
      previewOffset: 0,
    });
  }

  function returnToSearch(searchModal: SearchModal): void {
    cancelPendingRequests();
    setModal({
      ...searchModal,
      phase: 'query',
      results: [],
      index: 0,
      loadingMore: false,
      hasMore: false,
      preview: '',
      previewFile: '',
      previewState: 'idle',
      previewOffset: 0,
    });
  }

  /** The results modal still showing `key` at `generation`, or null if it moved on. */
  function currentResultsModal(generation: number, key: string): SearchModal | null {
    const current = modal();
    if (
      disposed ||
      generation !== previewGeneration ||
      !current ||
      current.type !== 'search' ||
      current.phase !== 'results' ||
      resultKey(current.results[current.index]!) !== key
    ) {
      return null;
    }
    return current;
  }

  async function selectResult(searchModal: SearchModal, index: number): Promise<void> {
    const result = searchModal.results[index];
    if (!result) return;
    if (index === searchModal.index && searchModal.previewState !== 'idle') return;

    abortPreviewRequest();
    const generation = ++previewGeneration;
    const key = resultKey(result);
    const cached = previewCache.get(key);
    setModal({
      ...searchModal,
      index,
      preview: cached?.contents || '',
      previewFile: cached?.fileName || '',
      previewState: cached ? 'ready' : 'loading',
      previewOffset: 0,
    });
    if (cached) return;

    const controller = new AbortController();
    previewAbort = controller;
    try {
      await delay(PREVIEW_DEBOUNCE_MS, controller.signal);
      const preview = await loadInstallPreview(result, controller.signal);
      previewCache.set(key, preview);
      const current = currentResultsModal(generation, key);
      if (!current) return;
      setModal({
        ...current,
        preview: preview.contents,
        previewFile: preview.fileName,
        previewState: 'ready',
        previewOffset: 0,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      const current = currentResultsModal(generation, key);
      if (!current) return;
      setModal({
        ...current,
        preview: (error as Error).message,
        previewFile: '',
        previewState: 'error',
        previewOffset: 0,
      });
    }
  }

  function visibleRows(): number {
    return searchResultsCapacity(dimensions().width, dimensions().height);
  }

  /** True when the cursor nears the loaded tail, or the page cannot fill the pane. */
  function shouldPrefetch(searchModal: SearchModal, index: number): boolean {
    if (!searchModal.hasMore || searchModal.loading || searchModal.loadingMore) return false;
    return (
      searchNeedsMore(index, searchModal.results.length) ||
      searchModal.results.length < visibleRows()
    );
  }

  async function submitSearch(searchModal: SearchModal): Promise<void> {
    if (searchModal.query.trim().length < 2) {
      setModal({ ...searchModal, message: 'Search needs at least two characters' });
      return;
    }
    const generation = ++searchGeneration;
    setModal({
      ...searchModal,
      loading: true,
      loadingMore: false,
      hasMore: false,
      message: 'Searching skills.sh',
    });
    const page = await searchSkills(searchModal.query);
    const current = modal();
    if (disposed || generation !== searchGeneration || !current || current.type !== 'search') {
      return;
    }
    const next: SearchModal = {
      ...current,
      phase: 'results',
      results: page.skills,
      index: 0,
      loading: false,
      loadingMore: false,
      hasMore: page.hasMore,
      message: searchStatus(page.skills.length, page.hasMore),
      preview: '',
      previewFile: '',
      previewState: 'idle',
      previewOffset: 0,
    };
    setModal(next);
    if (page.hasMore && shouldPrefetch(next, 0)) {
      void loadMore(next, 0);
    } else if (page.skills.length > 0) {
      void selectResult(next, 0);
    }
  }

  async function loadMore(searchModal: SearchModal, selectIndex?: number): Promise<void> {
    if (!searchModal.hasMore || searchModal.loading || searchModal.loadingMore) return;
    const generation = searchGeneration;
    const offset = searchModal.results.length;
    const latest = modal();
    const base = latest && latest.type === 'search' ? latest : searchModal;
    setModal({
      ...base,
      loadingMore: true,
      message: searchStatus(base.results.length, true, true),
    });
    const page = await searchSkills(searchModal.query, offset);
    const current = modal();
    if (
      disposed ||
      generation !== searchGeneration ||
      !current ||
      current.type !== 'search' ||
      current.phase !== 'results'
    ) {
      return;
    }
    const seen = new Set(current.results.map((result) => result.slug || resultKey(result)));
    const extra = page.skills.filter((result) => !seen.has(result.slug || resultKey(result)));
    const results = [...current.results, ...extra];
    const hasMore = extra.length > 0 && page.hasMore;
    const nextIndex =
      selectIndex === undefined
        ? Math.min(current.index, Math.max(0, results.length - 1))
        : Math.min(Math.max(selectIndex, 0), Math.max(0, results.length - 1));
    const next: SearchModal = {
      ...current,
      results,
      loadingMore: false,
      hasMore,
      message: searchStatus(results.length, hasMore),
    };
    setModal(next);
    if (hasMore && shouldPrefetch(next, nextIndex)) {
      void loadMore(next, nextIndex);
    } else if (results[nextIndex]) {
      void selectResult(next, nextIndex);
    }
  }

  function moveCursor(searchModal: SearchModal, index: number): void {
    const next = Math.max(0, Math.min(index, searchModal.results.length - 1));
    void selectResult(searchModal, next);
    if (shouldPrefetch(searchModal, next)) void loadMore(searchModal);
  }

  function pageResults(searchModal: SearchModal, direction: 1 | -1): void {
    const target = searchModal.index + direction * SEARCH_PAGE_SIZE;
    if (direction > 0 && target >= searchModal.results.length) {
      if (searchModal.hasMore) {
        void loadMore(searchModal, target);
        return;
      }
      moveCursor(searchModal, searchModal.results.length - 1);
      return;
    }
    moveCursor(searchModal, target);
  }

  function scrollPreview(searchModal: SearchModal, delta: number): void {
    const max = Math.max(0, searchModal.preview.split(/\r?\n/).length - 1);
    setModal({
      ...searchModal,
      previewOffset: Math.max(0, Math.min(max, searchModal.previewOffset + delta)),
    });
  }

  async function installSelected(searchModal: SearchModal, scope: ScopeId): Promise<void> {
    const result = searchModal.results[searchModal.index];
    if (!result) {
      library.announce('No search result selected', true);
      return;
    }
    library.setBusy(true);
    try {
      const collision = await findInstallCollision(paths, result, scope);
      if (collision) {
        setModal({
          type: 'confirm',
          title: `Overwrite ${collision.skillName}?`,
          lines: [
            'This installed folder and its lock entry will be replaced:',
            '',
            collision.destination,
          ],
          offset: 0,
          action: () =>
            library.runOperation(`Installing ${result.name}`, () =>
              installSearchResult(paths, result, scope, true)
            ),
        });
      } else {
        await library.runOperation(`Installing ${result.name}`, () =>
          installSearchResult(paths, result, scope)
        );
      }
    } finally {
      library.setBusy(false);
    }
  }

  onCleanup(() => {
    disposed = true;
    cancelPendingRequests();
  });

  return {
    openSearch,
    returnToSearch,
    cancelPendingRequests,
    submitSearch,
    moveCursor,
    pageResults,
    scrollPreview,
    installSelected,
  };
}
