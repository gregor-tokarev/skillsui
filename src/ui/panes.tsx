/** @jsxImportSource @opentui/solid */

import { For, Show } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import type { ScopeId, ScopeSnapshot, SkillRecord, UpdateState } from '../types.ts';
import { COLORS, fit } from './common.tsx';

/** Skill rows a pane fits after the header, status bar, borders, and padding. */
export function paneCapacity(terminalHeight: number): number {
  return Math.max(3, terminalHeight - 10);
}

/** The slice of a scope's skills that keeps the cursor centred. */
export function paneWindow(skills: SkillRecord[], cursor: number, capacity: number): SkillRecord[] {
  const start = Math.max(0, Math.min(cursor - Math.floor(capacity / 2), skills.length - capacity));
  return skills.slice(start, start + capacity);
}

export function paneTitle(
  scope: ScopeId,
  snapshot: ScopeSnapshot | undefined,
  cursor: number,
  capacity: number
): string {
  const count = snapshot?.skills.length || 0;
  const hidden = snapshot?.hiddenLockEntries || 0;
  const parts = [`${scope === 'project' ? 'Project' : 'Global'} ${count}`];
  if (count > capacity) parts.push(`${cursor + 1}/${count}`);
  if (hidden) parts.push(`${hidden} hidden`);
  return parts.join(' · ');
}

/** The narrowest a skill name gets before the right-side annotation drops. */
const MIN_NAME_WIDTH = 8;

function SkillRow(props: {
  skill: SkillRecord;
  focused: boolean;
  checked: boolean;
  updateState: UpdateState | undefined;
  width: number;
}) {
  const nameColor = () => (props.skill.tracked ? COLORS.text : COLORS.dim);
  const marker = () =>
    props.updateState === 'available'
      ? '↑ update'
      : props.updateState === 'checking'
        ? 'checking…'
        : props.updateState === 'unavailable'
          ? 'unchecked'
          : '';
  // Tracked is the default state, so only local skills carry a badge.
  const badge = () => (props.skill.tracked ? '' : 'local');
  const annotation = () => marker() || badge();
  const showAnnotation = () =>
    Boolean(annotation()) && props.width - 7 - annotation().length >= MIN_NAME_WIDTH;
  const name = () =>
    fit(props.skill.folderName, props.width - 7 - (showAnnotation() ? annotation().length : 0));

  return (
    <box
      height={1}
      width="100%"
      flexDirection="row"
      backgroundColor={props.focused ? COLORS.cursor : props.checked ? COLORS.selected : undefined}
    >
      <text flexGrow={1} truncate={true}>
        <span style={{ fg: props.focused ? COLORS.active : COLORS.dim }}>
          {props.focused ? '❯ ' : '  '}
        </span>
        <span style={{ fg: props.checked ? COLORS.accent : COLORS.dim }}>
          {props.checked ? '[x] ' : '[ ] '}
        </span>
        {props.focused ? (
          <b style={{ fg: nameColor() }}>{name()}</b>
        ) : (
          <span style={{ fg: nameColor() }}>{name()}</span>
        )}
      </text>
      <text flexShrink={0}>
        {showAnnotation() ? (
          props.updateState === 'available' ? (
            <span style={{ fg: COLORS.warning, bold: true }}>{annotation()}</span>
          ) : (
            <span style={{ fg: COLORS.dim }}>{annotation()}</span>
          )
        ) : null}
      </text>
    </box>
  );
}

export function SkillPane(props: {
  scope: ScopeId;
  title: string;
  active: boolean;
  solo?: boolean;
  rows: SkillRecord[];
  empty: boolean;
  cursorId: string | null;
  selected: (id: string) => boolean;
  updateState: (id: string) => UpdateState | undefined;
}) {
  const dimensions = useTerminalDimensions();
  // Two panes share the row: app padding (2) and the gap (1) are reserved first.
  const rowWidth = () =>
    props.solo ? dimensions().width - 8 : Math.floor((dimensions().width - 3) / 2) - 5;

  return (
    <box
      width={props.solo ? '100%' : '50%'}
      height="100%"
      flexDirection="column"
      border={true}
      borderStyle="rounded"
      borderColor={props.active ? COLORS.active : COLORS.border}
      title={props.title}
      titleColor={props.active ? COLORS.active : COLORS.dim}
      paddingX={1}
      overflow="hidden"
    >
      <Show
        when={!props.empty}
        fallback={
          <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
            <text fg={COLORS.dim}>No skills in this scope</text>
            <text>
              <span style={{ fg: COLORS.text, bold: true }}>
                {props.scope === 'project' || props.solo ? 'i' : 'I'}
              </span>
              <span style={{ fg: COLORS.dim }}>{' install from skills.sh'}</span>
            </text>
          </box>
        }
      >
        <For each={props.rows}>
          {(skill) => (
            <SkillRow
              skill={skill}
              focused={props.active && props.cursorId === skill.id}
              checked={props.selected(skill.id)}
              updateState={props.updateState(skill.id)}
              width={rowWidth()}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
