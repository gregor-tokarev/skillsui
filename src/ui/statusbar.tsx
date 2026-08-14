/** @jsxImportSource @opentui/solid */

import type { SkillRecord } from '../types.ts';
import { COLORS, HintLine, shortenHome } from './common.tsx';

export function StatusBar(props: {
  status: string;
  alert: boolean;
  busy: boolean;
  skill: SkillRecord | null;
}) {
  const detail = () => {
    const skill = props.skill;
    if (!skill) return '';
    const description = skill.description ? ` — ${skill.description.replace(/\s+/g, ' ')}` : '';
    return `${shortenHome(skill.path)}${description}`;
  };

  return (
    <box height={3} flexDirection="column">
      <text
        height={1}
        truncate={true}
        fg={props.busy || props.alert ? COLORS.warning : COLORS.text}
      >
        {props.status}
      </text>
      <text height={1} fg={COLORS.dim} truncate={true}>
        {detail()}
      </text>
      <HintLine
        separator=" "
        hints={[
          ['j/k', 'move'],
          ['h/l', 'pane'],
          ['x', 'select'],
          ['D', 'delete'],
          ['M', 'move'],
          ['F', 'fork'],
          ['U', 'update'],
          ['i/I', 'install'],
          ['r', 'reload'],
          ['q', 'quit'],
        ]}
      />
    </box>
  );
}
