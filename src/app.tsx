/** @jsxImportSource @opentui/solid */

import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import type { KeyEvent } from '@opentui/core';
import type { AppPaths } from './paths.ts';
import { discoverAll } from './discovery.ts';
import {
  deleteSkills,
  findForkCollision,
  findMoveCollisions,
  forkSkill,
  moveSkills,
  normalizeForkName,
} from './operations.ts';
import {
  findInstallCollision,
  installSearchResult,
  loadInstallPreview,
  SEARCH_PAGE_SIZE,
  searchNeedsMore,
  searchSkills,
  type InstallPreview,
  type SearchSkill,
} from './install.ts';
import { checkForUpdates, updateSkills } from './updates.ts';
import type { AppSnapshot, OperationResult, ScopeId, SkillRecord, UpdateState } from './types.ts';
import { COLORS, shortenHome } from './ui/common.tsx';
import { SkillPane } from './ui/panes.tsx';
import { StatusBar } from './ui/statusbar.tsx';
import {
  ConfirmView,
  ForkView,
  ModalFrame,
  SearchQueryView,
  SearchResultsView,
  searchResultsCapacity,
  type ForkModal,
  type Modal,
  type SearchModal,
} from './ui/modals.tsx';

function allSkills(snapshot: AppSnapshot | null): SkillRecord[] {
  return snapshot ? [...snapshot.project.skills, ...snapshot.global.skills] : [];
}

function isEnter(key: KeyEvent): boolean {
  return key.name === 'return' || key.name === 'enter';
}

function typedCharacter(key: KeyEvent): string | null {
  if (key.ctrl || key.meta || key.option) return null;
  return key.raw.length === 1 && key.raw >= ' ' && key.raw !== '\x7f' ? key.raw : null;
}

function operationStatus(result: OperationResult): string {
  if (result.errors.length === 0) return result.message;
  return `${result.message}. ${result.errors[0]}`;
}

export function App(props: { paths: AppPaths }) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [snapshot, setSnapshot] = createSignal<AppSnapshot | null>(null);
  const projectEnabled = () => props.paths.projectEnabled;
  const visibleScopes = (): ScopeId[] =>
    projectEnabled() ? (['project', 'global'] as ScopeId[]) : (['global'] as ScopeId[]);
  const [activeScope, setActiveScope] = createSignal<ScopeId>(
    props.paths.projectEnabled ? 'project' : 'global'
  );
  const [cursor, setCursor] = createSignal<Record<ScopeId, number>>({ project: 0, global: 0 });
  const [selected, setSelected] = createSignal(new Set<string>());
  const [updates, setUpdates] = createSignal<Record<string, UpdateState>>({});
  const [status, setStatus] = createSignal('Loading skills');
  const [statusTone, setStatusTone] = createSignal<'idle' | 'alert'>('idle');
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [modal, setModal] = createSignal<Modal | null>(null);
  const installPreviewCache = new Map<string, InstallPreview>();
  let disposed = false;
  let checkGeneration = 0;
  let previewGeneration = 0;
  let searchGeneration = 0;

  function announce(message: string, alert = false): void {
    setStatus(message);
    setStatusTone(alert ? 'alert' : 'idle');
  }

  const scopeSnapshot = (scope: ScopeId) => snapshot()?.[scope];
  const scopeSkills = (scope: ScopeId) => scopeSnapshot(scope)?.skills || [];
  const currentSkill = createMemo(() => {
    const list = scopeSkills(activeScope());
    return list[cursor()[activeScope()]] || null;
  });
  const selectedSkills = createMemo(() => {
    const ids = selected();
    return allSkills(snapshot()).filter((skill) => ids.has(skill.id));
  });

  function clampCursors(data: AppSnapshot): void {
    setCursor((previous) => ({
      project: Math.max(0, Math.min(previous.project, data.project.skills.length - 1)),
      global: Math.max(0, Math.min(previous.global, data.global.skills.length - 1)),
    }));
  }

  async function runBackgroundCheck(data: AppSnapshot): Promise<void> {
    const generation = ++checkGeneration;
    const tracked = allSkills(data).filter((skill) => skill.tracked);
    const initial: Record<string, UpdateState> = {};
    for (const skill of tracked) initial[skill.id] = 'checking';
    setUpdates(initial);
    if (tracked.length === 0) return;

    const result = await checkForUpdates(tracked);
    if (disposed || generation !== checkGeneration) return;
    setUpdates(result.states);
    const available = Object.values(result.states).filter((state) => state === 'available').length;
    if (available > 0) {
      announce(`${available} update${available === 1 ? '' : 's'} available`, true);
    } else if (result.errors.length > 0) {
      announce('Local skills ready. Some updates could not be checked', true);
    }
  }

  async function refresh(check = true): Promise<void> {
    setLoading(true);
    try {
      const data = await discoverAll(props.paths);
      if (disposed) return;
      setSnapshot(data);
      clampCursors(data);
      const existing = new Set(allSkills(data).map((skill) => skill.id));
      setSelected((previous) => new Set([...previous].filter((id) => existing.has(id))));
      announce(
        projectEnabled()
          ? `${data.project.skills.length} project, ${data.global.skills.length} global`
          : `${data.global.skills.length} global`
      );
      if (check) void runBackgroundCheck(data);
    } catch (error) {
      announce((error as Error).message, true);
    } finally {
      setLoading(false);
    }
  }

  async function runOperation(
    label: string,
    action: () => Promise<OperationResult>
  ): Promise<void> {
    setModal(null);
    setBusy(true);
    announce(label);
    try {
      const result = await action();
      setSelected(new Set<string>());
      await refresh(true);
      announce(operationStatus(result), result.errors.length > 0);
    } catch (error) {
      announce((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  function actionTargets(scope?: ScopeId): SkillRecord[] {
    const chosen = selectedSkills().filter((skill) => !scope || skill.scope === scope);
    if (chosen.length > 0) return chosen;
    const current = currentSkill();
    return current && (!scope || current.scope === scope) ? [current] : [];
  }

  function openDelete(): void {
    const targets = actionTargets();
    if (targets.length === 0) {
      announce('No skill to delete', true);
      return;
    }
    setModal({
      type: 'confirm',
      title: `Delete ${targets.length} skill${targets.length === 1 ? '' : 's'}?`,
      lines: ['These folders will be removed:', '', ...targets.map((skill) => skill.path)],
      offset: 0,
      action: () => runOperation('Deleting skills', () => deleteSkills(props.paths, targets)),
    });
  }

  async function startMove(): Promise<void> {
    if (!projectEnabled()) {
      announce('Project scope is unavailable from the home directory', true);
      return;
    }
    const scope = activeScope();
    const targets = actionTargets(scope);
    if (targets.length === 0) {
      announce('No skill to move', true);
      return;
    }
    setBusy(true);
    try {
      const collisions = await findMoveCollisions(props.paths, targets);
      if (collisions.length > 0) {
        setModal({
          type: 'confirm',
          title: `Overwrite ${collisions.length} destination${collisions.length === 1 ? '' : 's'}?`,
          lines: [
            'Existing folders and their lock entries will be replaced:',
            '',
            ...collisions.flatMap((collision) => [
              collision.destination,
              `from ${collision.source}`,
            ]),
          ],
          offset: 0,
          action: () => runOperation('Moving skills', () => moveSkills(props.paths, targets, true)),
        });
      } else {
        await runOperation('Moving skills', () => moveSkills(props.paths, targets));
      }
    } finally {
      setBusy(false);
    }
  }

  function openFork(): void {
    const selectedNow = selectedSkills();
    if (selectedNow.length > 1) {
      announce('Fork accepts one skill', true);
      return;
    }
    const skill = selectedNow[0] || currentSkill();
    if (!skill) {
      announce('No skill to fork', true);
      return;
    }
    setModal({ type: 'fork', skill, value: `${skill.folderName}-fork` });
  }

  async function submitFork(forkModal: ForkModal): Promise<void> {
    const name = normalizeForkName(forkModal.value);
    if (!name) {
      announce('Fork name is empty', true);
      return;
    }
    setBusy(true);
    try {
      const collision = await findForkCollision(props.paths, forkModal.skill, name);
      if (collision) {
        setModal({
          type: 'confirm',
          title: `Overwrite ${name}?`,
          lines: [
            'The existing fork destination and its lock entry will be replaced:',
            '',
            collision.destination,
          ],
          offset: 0,
          action: () =>
            runOperation('Forking skill', () =>
              forkSkill(props.paths, forkModal.skill, name, true)
            ),
        });
      } else {
        await runOperation('Forking skill', () => forkSkill(props.paths, forkModal.skill, name));
      }
    } finally {
      setBusy(false);
    }
  }

  function searchStatus(count: number, hasMore: boolean, loadingMore = false): string {
    if (count === 0) return 'No results, or skills.sh could not be reached';
    const noun = `${count} result${count === 1 ? '' : 's'}`;
    if (loadingMore) return `${noun} · loading more`;
    return hasMore ? `${noun} · more available` : noun;
  }

  function openSearch(scope: ScopeId): void {
    previewGeneration++;
    searchGeneration++;
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

  function previewKey(result: SearchSkill): string {
    return `${result.source}\0${result.name}`;
  }

  async function selectSearchResult(searchModal: SearchModal, index: number): Promise<void> {
    const result = searchModal.results[index];
    if (!result) return;
    if (index === searchModal.index && searchModal.previewState !== 'idle') return;

    const generation = ++previewGeneration;
    const key = previewKey(result);
    const cached = installPreviewCache.get(key);
    const next: SearchModal = {
      ...searchModal,
      index,
      preview: cached?.contents || '',
      previewFile: cached?.fileName || '',
      previewState: cached ? 'ready' : 'loading',
      previewOffset: 0,
    };
    setModal(next);
    if (cached) return;

    try {
      const preview = await loadInstallPreview(result);
      installPreviewCache.set(key, preview);
      const current = modal();
      if (
        disposed ||
        generation !== previewGeneration ||
        !current ||
        current.type !== 'search' ||
        current.phase !== 'results' ||
        previewKey(current.results[current.index]!) !== key
      ) {
        return;
      }
      setModal({
        ...current,
        preview: preview.contents,
        previewFile: preview.fileName,
        previewState: 'ready',
        previewOffset: 0,
      });
    } catch (error) {
      const current = modal();
      if (
        disposed ||
        generation !== previewGeneration ||
        !current ||
        current.type !== 'search' ||
        current.phase !== 'results' ||
        previewKey(current.results[current.index]!) !== key
      ) {
        return;
      }
      setModal({
        ...current,
        preview: (error as Error).message,
        previewFile: '',
        previewState: 'error',
        previewOffset: 0,
      });
    }
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
    if (page.hasMore && shouldPrefetchSearch(next, 0)) {
      void loadMoreResults(next, 0);
    } else if (page.skills.length > 0) {
      void selectSearchResult(next, 0);
    }
  }

  async function loadMoreResults(searchModal: SearchModal, selectIndex?: number): Promise<void> {
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
    const seen = new Set(
      current.results.map((result) => result.slug || `${result.source}\0${result.name}`)
    );
    const extra = page.skills.filter(
      (result) => !seen.has(result.slug || `${result.source}\0${result.name}`)
    );
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
    if (hasMore && shouldPrefetchSearch(next, nextIndex)) {
      void loadMoreResults(next, nextIndex);
    } else if (results[nextIndex]) {
      void selectSearchResult(next, nextIndex);
    }
  }

  function visibleSearchRows(): number {
    return searchResultsCapacity(dimensions().width, dimensions().height);
  }

  function shouldPrefetchSearch(searchModal: SearchModal, index: number): boolean {
    if (!searchModal.hasMore || searchModal.loading || searchModal.loadingMore) return false;
    return (
      searchNeedsMore(index, searchModal.results.length) ||
      searchModal.results.length < visibleSearchRows()
    );
  }

  function moveSearchCursor(searchModal: SearchModal, index: number): void {
    const next = Math.max(0, Math.min(index, searchModal.results.length - 1));
    void selectSearchResult(searchModal, next);
    if (shouldPrefetchSearch(searchModal, next)) void loadMoreResults(searchModal);
  }

  function pageSearchResults(searchModal: SearchModal, direction: 1 | -1): void {
    const target = searchModal.index + direction * SEARCH_PAGE_SIZE;
    if (direction > 0 && target >= searchModal.results.length) {
      if (searchModal.hasMore) {
        void loadMoreResults(searchModal, target);
        return;
      }
      moveSearchCursor(searchModal, searchModal.results.length - 1);
      return;
    }
    moveSearchCursor(searchModal, target);
  }

  async function installSelected(searchModal: SearchModal, scope: ScopeId): Promise<void> {
    const result = searchModal.results[searchModal.index];
    if (!result) {
      announce('No search result selected', true);
      return;
    }
    setBusy(true);
    try {
      const collision = await findInstallCollision(props.paths, result, scope);
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
            runOperation(`Installing ${result.name}`, () =>
              installSearchResult(props.paths, result, scope, true)
            ),
        });
      } else {
        await runOperation(`Installing ${result.name}`, () =>
          installSearchResult(props.paths, result, scope)
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function startUpdate(): void {
    const targets = actionTargets();
    const tracked = targets.filter((skill) => skill.tracked);
    if (tracked.length === 0) {
      announce('No tracked skill selected', true);
      return;
    }
    void runOperation('Updating skills. Local edits may be overwritten', () =>
      updateSkills(props.paths, targets)
    );
  }

  function moveCursor(delta: number): void {
    const scope = activeScope();
    const length = scopeSkills(scope).length;
    if (length === 0) return;
    setCursor((current) => ({
      ...current,
      [scope]: Math.max(0, Math.min(current[scope] + delta, length - 1)),
    }));
  }

  function returnToSearch(searchModal: SearchModal): void {
    previewGeneration++;
    searchGeneration++;
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

  function handleModalKey(key: KeyEvent, activeModal: Modal): void {
    key.preventDefault();
    if (key.name === 'escape') {
      if (activeModal.type === 'search' && activeModal.phase === 'results') {
        returnToSearch(activeModal);
        return;
      }
      previewGeneration++;
      searchGeneration++;
      setModal(null);
      announce('Cancelled');
      return;
    }

    if (activeModal.type === 'confirm') {
      if (key.name.toLowerCase() === 'y') void activeModal.action();
      if (key.name.toLowerCase() === 'n') {
        setModal(null);
        announce('Cancelled');
      }
      if (key.name === 'j' || key.name === 'down' || key.name === 'pagedown') {
        const step = key.name === 'pagedown' ? 8 : 1;
        setModal({
          ...activeModal,
          offset: Math.min(activeModal.offset + step, Math.max(0, activeModal.lines.length - 1)),
        });
      }
      if (key.name === 'k' || key.name === 'up' || key.name === 'pageup') {
        const step = key.name === 'pageup' ? 8 : 1;
        setModal({ ...activeModal, offset: Math.max(0, activeModal.offset - step) });
      }
      return;
    }

    if (activeModal.type === 'fork') {
      if (isEnter(key)) return void submitFork(activeModal);
      if (key.name === 'backspace') {
        setModal({ ...activeModal, value: activeModal.value.slice(0, -1) });
        return;
      }
      const character = typedCharacter(key);
      if (character) setModal({ ...activeModal, value: activeModal.value + character });
      return;
    }

    if (activeModal.phase === 'query') {
      if (isEnter(key)) return void submitSearch(activeModal);
      if (key.name === 'backspace') {
        setModal({ ...activeModal, query: activeModal.query.slice(0, -1) });
        return;
      }
      const character = typedCharacter(key);
      if (character) setModal({ ...activeModal, query: activeModal.query + character });
      return;
    }

    if (key.name === 'backspace') {
      returnToSearch(activeModal);
    } else if (key.name === 'j' || key.name === 'down') {
      moveSearchCursor(activeModal, activeModal.index + 1);
    } else if (key.name === 'k' || key.name === 'up') {
      moveSearchCursor(activeModal, activeModal.index - 1);
    } else if (key.name.toLowerCase() === 'n') {
      pageSearchResults(activeModal, 1);
    } else if (key.name.toLowerCase() === 'p') {
      pageSearchResults(activeModal, -1);
    } else if (key.name === 'pagedown') {
      const max = Math.max(0, activeModal.preview.split(/\r?\n/).length - 1);
      setModal({
        ...activeModal,
        previewOffset: Math.min(max, activeModal.previewOffset + 10),
      });
    } else if (key.name === 'pageup') {
      setModal({ ...activeModal, previewOffset: Math.max(0, activeModal.previewOffset - 10) });
    } else if (isEnter(key)) {
      void installSelected(activeModal, activeModal.scope);
    } else if (key.name.toLowerCase() === 'i') {
      const scope = key.shift || !projectEnabled() ? 'global' : 'project';
      void installSelected(activeModal, scope);
    }
  }

  useKeyboard((key) => {
    const activeModal = modal();
    if (activeModal) return handleModalKey(key, activeModal);
    if (busy()) return;
    const keyName = key.name.toLowerCase();

    if ((key.ctrl && keyName === 'c') || keyName === 'q') return renderer.destroy();
    if (keyName === 'j' || keyName === 'down') return moveCursor(1);
    if (keyName === 'k' || keyName === 'up') return moveCursor(-1);
    if (keyName === 'h' || keyName === 'left') {
      if (projectEnabled()) setActiveScope('project');
      return;
    }
    if (keyName === 'l' || keyName === 'right') {
      setActiveScope('global');
      return;
    }
    if (keyName === 'x') {
      const skill = currentSkill();
      if (!skill) return;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(skill.id)) next.delete(skill.id);
        else next.add(skill.id);
        return next;
      });
      return;
    }
    if (keyName === 'd' && key.shift) return openDelete();
    if (keyName === 'm' && key.shift) return void startMove();
    if (keyName === 'f' && key.shift) return openFork();
    if (keyName === 'u' && key.shift) return startUpdate();
    if (keyName === 'i') {
      return openSearch(key.shift || !projectEnabled() ? 'global' : 'project');
    }
    if (keyName === 'r') return void refresh(true);
  });

  onMount(() => void refresh(true));
  onCleanup(() => {
    disposed = true;
    checkGeneration++;
    previewGeneration++;
    searchGeneration++;
  });

  const paneBudget = () => Math.max(3, dimensions().height - 10);

  function paneRows(scope: ScopeId): SkillRecord[] {
    const list = scopeSkills(scope);
    const budget = paneBudget();
    const center = cursor()[scope];
    const start = Math.max(0, Math.min(center - Math.floor(budget / 2), list.length - budget));
    return list.slice(start, start + budget);
  }

  function paneTitle(scope: ScopeId): string {
    const data = scopeSnapshot(scope);
    const count = data?.skills.length || 0;
    const hidden = data?.hiddenLockEntries || 0;
    const parts = [`${scope === 'project' ? 'Project' : 'Global'} ${count}`];
    if (count > paneBudget()) parts.push(`${cursor()[scope] + 1}/${count}`);
    if (hidden) parts.push(`${hidden} hidden`);
    return parts.join(' · ');
  }

  const modalTitle = createMemo(() => {
    const active = modal();
    if (!active) return '';
    if (active.type === 'search') {
      return `Install in ${active.scope} scope`;
    }
    if (active.type === 'fork') return `Fork ${active.skill.folderName}`;
    return active.title;
  });

  const modalContent = () => {
    const active = modal();
    if (!active) return null;
    if (active.type === 'confirm') return <ConfirmView modal={active} />;
    if (active.type === 'fork') return <ForkView modal={active} />;
    return active.phase === 'query' ? (
      <SearchQueryView modal={active} />
    ) : (
      <SearchResultsView modal={active} projectEnabled={projectEnabled()} />
    );
  };

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={COLORS.bg} padding={1}>
      <box height={2} flexDirection="row" justifyContent="space-between">
        <text>
          <span style={{ fg: COLORS.active, bold: true }}>skillsui</span>
        </text>
        <text fg={COLORS.dim} truncate={true}>
          {shortenHome(props.paths.projectRoot)}
        </text>
      </box>

      <box flexGrow={1} flexDirection="row" gap={1}>
        <For each={visibleScopes()}>
          {(scope) => (
            <SkillPane
              scope={scope}
              title={paneTitle(scope)}
              active={activeScope() === scope}
              solo={!projectEnabled()}
              rows={paneRows(scope)}
              empty={scopeSkills(scope).length === 0}
              cursorId={currentSkill()?.id ?? null}
              selected={(id) => selected().has(id)}
              updateState={(id) => updates()[id]}
            />
          )}
        </For>
      </box>

      <StatusBar
        status={status()}
        alert={statusTone() === 'alert'}
        busy={busy() || loading()}
        skill={currentSkill()}
        projectEnabled={projectEnabled()}
      />

      <Show when={modal()}>
        <ModalFrame title={modalTitle()} danger={modal()?.type === 'confirm'}>
          {modalContent()}
        </ModalFrame>
      </Show>
    </box>
  );
}
