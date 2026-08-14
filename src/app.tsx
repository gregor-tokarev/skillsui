/** @jsxImportSource @opentui/solid */

import { For, Show, createSignal, onMount } from 'solid-js';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import type { AppPaths } from './paths.ts';
import type { ScopeId } from './types.ts';
import { createLibraryState } from './state/library.ts';
import { createSkillActions } from './state/actions.ts';
import { createSearchController } from './state/search.ts';
import { createKeyBindings } from './state/keybindings.ts';
import { COLORS, shortenHome } from './ui/common.tsx';
import { SkillPane, paneCapacity, paneTitle, paneWindow } from './ui/panes.tsx';
import { StatusBar } from './ui/statusbar.tsx';
import { ModalHost, type Modal } from './ui/modals.tsx';

export function App(props: { paths: AppPaths }) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [modal, setModal] = createSignal<Modal | null>(null);

  const library = createLibraryState(props.paths, { onOperationStart: () => setModal(null) });
  const search = createSearchController({ paths: props.paths, library, modal, setModal });
  const actions = createSkillActions({ paths: props.paths, library, setModal });

  useKeyboard(
    createKeyBindings({
      library,
      actions,
      search,
      modal,
      setModal,
      quit: () => renderer.destroy(),
    })
  );

  onMount(() => void library.refresh(true));

  const capacity = () => paneCapacity(dimensions().height);
  const titleFor = (scope: ScopeId) =>
    paneTitle(scope, library.scopeSnapshot(scope), library.cursor()[scope], capacity());
  const rowsFor = (scope: ScopeId) =>
    paneWindow(library.scopeSkills(scope), library.cursor()[scope], capacity());

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
        <For each={library.visibleScopes()}>
          {(scope) => (
            <SkillPane
              scope={scope}
              title={titleFor(scope)}
              active={library.activeScope() === scope}
              solo={!library.projectEnabled()}
              rows={rowsFor(scope)}
              empty={library.scopeSkills(scope).length === 0}
              cursorId={library.currentSkill()?.id ?? null}
              selected={library.isSelected}
              updateState={(id) => library.updates()[id]}
            />
          )}
        </For>
      </box>

      <StatusBar
        status={library.status()}
        alert={library.statusTone() === 'alert'}
        busy={library.busy() || library.loading()}
        skill={library.currentSkill()}
        projectEnabled={library.projectEnabled()}
      />

      <Show when={modal()}>
        {(active) => <ModalHost modal={active()} projectEnabled={library.projectEnabled()} />}
      </Show>
    </box>
  );
}
