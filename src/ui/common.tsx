/** @jsxImportSource @opentui/solid */

import { homedir } from 'node:os';
import { For, createEffect, createSignal, onCleanup } from 'solid-js';

export const COLORS = {
  bg: '#111318',
  border: '#3a4353',
  active: '#7aa2f7',
  accent: '#9ece6a',
  warning: '#e0af68',
  danger: '#f7768e',
  text: '#c8d3f5',
  dim: '#737aa2',
  cursor: '#2f3e5c',
  selected: '#26354a',
  backdrop: '#00000059',
};

export function shortenHome(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${count}`;
}

export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 90;

/** Ticks only while `active` is true, so idle screens stay static. */
export function useSpinnerFrame(
  active: () => boolean,
  options: { frames?: readonly string[]; intervalMs?: number } = {}
): () => string {
  const frames = options.frames ?? SPINNER_FRAMES;
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    if (!active()) return;
    const timer = setInterval(
      () => setTick((current) => current + 1),
      options.intervalMs ?? SPINNER_INTERVAL_MS
    );
    onCleanup(() => clearInterval(timer));
  });
  return () => frames[tick() % frames.length]!;
}

/** Inline spinner for `text` children; renders nothing when inactive. */
export function Spinner(props: { active: boolean; fg?: string }) {
  const frame = useSpinnerFrame(() => props.active);
  return <span style={{ fg: props.fg ?? COLORS.active }}>{props.active ? `${frame()} ` : ''}</span>;
}

export function HintLine(props: { hints: Array<readonly [string, string]>; separator?: string }) {
  return (
    <text height={1} truncate={true}>
      <For each={props.hints}>
        {([keyName, label], index) => (
          <>
            {index() > 0 ? (
              <span style={{ fg: COLORS.border }}>{props.separator ?? ' · '}</span>
            ) : null}
            <span style={{ fg: COLORS.text, bold: true }}>{keyName}</span>
            <span style={{ fg: COLORS.dim }}>{` ${label}`}</span>
          </>
        )}
      </For>
    </text>
  );
}
