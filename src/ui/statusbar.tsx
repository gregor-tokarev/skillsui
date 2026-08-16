/** @jsxImportSource @opentui/solid */

import type { SkillRecord } from '../types.ts';
import { COLORS, HintLine, Spinner, shortenHome } from './common.tsx';

export function StatusBar(props: {
  status: string;
  alert: boolean;
  busy: boolean;
  skill: SkillRecord | null;
  projectEnabled?: boolean;
}) {
  const detail = () => {
    const skill = props.skill;
    if (!skill) return '';
    const description = skill.description ? ` — ${skill.description.replace(/\s+/g, ' ')}` : '';
    return `${shortenHome(skill.path)}${description}`;
  };

  return (
    <box height={3} flexDirection="column">
      <text height={1} truncate={true}>
        <Spinner active={props.busy} fg={COLORS.warning} />
        <span style={{ fg: props.busy || props.alert ? COLORS.warning : COLORS.text }}>
          {props.status}
        </span>
      </text>
      <text height={1} fg={COLORS.dim} truncate={true}>
        {detail()}
      </text>
      <HintLine
        separator=" "
        hints={
          props.projectEnabled === false
            ? [
                ['j/k', 'move'],
                ['x', 'select'],
                ['d', 'delete'],
                ['f', 'fork'],
                ['u', 'update'],
                ['o', 'open'],
                ['i', 'install'],
                ['r', 'reload'],
                ['q', 'quit'],
              ]
            : [
                ['j/k', 'move'],
                ['h/l', 'pane'],
                ['x', 'select'],
                ['d', 'delete'],
                ['m', 'move'],
                ['f', 'fork'],
                ['u', 'update'],
                ['o', 'open'],
                ['i/I', 'install'],
                ['r', 'reload'],
                ['q', 'quit'],
              ]
        }
      />
    </box>
  );
}
