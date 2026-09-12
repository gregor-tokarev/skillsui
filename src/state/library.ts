import { createMemo, createSignal, onCleanup } from 'solid-js';
import { discoverAll } from '../discovery.ts';
import type { AppPaths } from '../paths.ts';
import { checkForUpdates } from '../updates.ts';
import type { AppSnapshot, OperationResult, ScopeId, SkillRecord, UpdateState } from '../types.ts';

export function allSkills(snapshot: AppSnapshot | null): SkillRecord[] {
  return snapshot ? [...snapshot.project.skills, ...snapshot.global.skills] : [];
}

function operationStatus(result: OperationResult): string {
  if (result.errors.length === 0) return result.message;
  return `${result.message}. ${result.errors[0]}`;
}

export interface LibraryOptions {
  /** Runs before an operation starts, so the app can dismiss the open modal. */
  onOperationStart?: () => void;
}

export type LibraryState = ReturnType<typeof createLibraryState>;

/**
 * Discovered skills plus the cursor, selection, and status state that every
 * view and key binding reads. Owns the operation runner: operations clear the
 * selection, rediscover both scopes, and report their outcome in the status bar.
 */
export function createLibraryState(paths: AppPaths, options: LibraryOptions = {}) {
  const [snapshot, setSnapshot] = createSignal<AppSnapshot | null>(null);
  const [activeScope, setActiveScope] = createSignal<ScopeId>(
    paths.projectEnabled ? 'project' : 'global'
  );
  const [cursor, setCursor] = createSignal<Record<ScopeId, number>>({ project: 0, global: 0 });
  const [selected, setSelected] = createSignal(new Set<string>());
  const [updates, setUpdates] = createSignal<Record<string, UpdateState>>({});
  const [status, setStatus] = createSignal('Loading skills');
  const [statusTone, setStatusTone] = createSignal<'idle' | 'alert'>('idle');
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  let disposed = false;
  let checkGeneration = 0;
  let checkController: AbortController | undefined;

  const projectEnabled = () => paths.projectEnabled;
  const visibleScopes = (): ScopeId[] =>
    projectEnabled() ? (['project', 'global'] as ScopeId[]) : (['global'] as ScopeId[]);

  function focusScope(scope: ScopeId): void {
    if (scope === 'project' && !projectEnabled()) return;
    setActiveScope(scope);
  }

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
  const isSelected = (id: string) => selected().has(id);

  function toggleSelection(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  function clampCursors(data: AppSnapshot): void {
    setCursor((previous) => ({
      project: Math.max(0, Math.min(previous.project, data.project.skills.length - 1)),
      global: Math.max(0, Math.min(previous.global, data.global.skills.length - 1)),
    }));
  }

  async function runBackgroundCheck(data: AppSnapshot): Promise<void> {
    const generation = ++checkGeneration;
    checkController?.abort();
    checkController = new AbortController();
    const tracked = allSkills(data).filter((skill) => skill.tracked);
    const initial: Record<string, UpdateState> = {};
    for (const skill of tracked) initial[skill.id] = 'waiting';
    setUpdates(initial);
    if (tracked.length === 0) return;

    const result = await checkForUpdates(tracked, {
      signal: checkController.signal,
      onStateChange: (id, state) => {
        if (disposed || generation !== checkGeneration) return;
        setUpdates((previous) => ({ ...previous, [id]: state }));
      },
    });
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
      const data = await discoverAll(paths);
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
    options.onOperationStart?.();
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

  /** The batch an action applies to: the selection, or the cursor when nothing is selected. */
  function actionTargets(scope?: ScopeId): SkillRecord[] {
    const chosen = selectedSkills().filter((skill) => !scope || skill.scope === scope);
    if (chosen.length > 0) return chosen;
    const current = currentSkill();
    return current && (!scope || current.scope === scope) ? [current] : [];
  }

  onCleanup(() => {
    disposed = true;
    checkGeneration++;
    checkController?.abort();
  });

  return {
    projectEnabled,
    visibleScopes,
    activeScope,
    focusScope,
    snapshot,
    scopeSnapshot,
    scopeSkills,
    cursor,
    moveCursor,
    currentSkill,
    selectedSkills,
    isSelected,
    toggleSelection,
    actionTargets,
    updates,
    status,
    statusTone,
    busy,
    loading,
    setBusy,
    announce,
    refresh,
    runOperation,
  };
}
