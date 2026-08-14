/** @jsxImportSource @opentui/solid */

import { For, Show } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import type { ScopeId, SkillRecord, UpdateState } from '../types.ts';
import { COLORS, fit } from './common.tsx';

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
  const badge = () => (props.skill.tracked ? 'tracked' : 'local');
  const right = () => (marker() ? `${marker()} ${badge()}` : badge());
  const name = () => fit(props.skill.folderName, props.width - 7 - right().length);

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
        {props.updateState === 'available' ? (
          <span style={{ fg: COLORS.warning, bold: true }}>{`${marker()} `}</span>
        ) : marker() ? (
          <span style={{ fg: COLORS.dim }}>{`${marker()} `}</span>
        ) : null}
        <span style={{ fg: props.skill.tracked ? COLORS.accent : COLORS.dim }}>{badge()}</span>
      </text>
    </box>
  );
}

export function SkillPane(props: {
  scope: ScopeId;
  title: string;
  active: boolean;
  rows: SkillRecord[];
  empty: boolean;
  cursorId: string | null;
  selected: (id: string) => boolean;
  updateState: (id: string) => UpdateState | undefined;
}) {
  const dimensions = useTerminalDimensions();
  // Two panes share the row: app padding (2) and the gap (1) are reserved first.
  const rowWidth = () => Math.floor((dimensions().width - 3) / 2) - 5;

  return (
    <box
      width="50%"
      height="100%"
      flexDirection="column"
      border={true}
      borderStyle="rounded"
      borderColor={props.active ? COLORS.active : COLORS.border}
      backgroundColor={props.active ? COLORS.panelActive : COLORS.panel}
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
                {props.scope === 'project' ? 'i' : 'I'}
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
