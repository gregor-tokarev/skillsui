/** @jsxImportSource @opentui/solid */

import { For, Show, type JSX } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import type { ScopeId, SkillRecord } from '../types.ts';
import type { SearchSkill } from '../install.ts';
import { COLORS, HintLine, fit, formatInstalls } from './common.tsx';

export interface ConfirmModal {
  type: 'confirm';
  title: string;
  lines: string[];
  offset: number;
  action: () => Promise<void>;
}

export interface ForkModal {
  type: 'fork';
  skill: SkillRecord;
  value: string;
}

export interface SearchModal {
  type: 'search';
  scope: ScopeId;
  phase: 'query' | 'results';
  query: string;
  results: SearchSkill[];
  index: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  message: string;
  preview: string;
  previewFile: string;
  previewState: 'idle' | 'loading' | 'ready' | 'error';
  previewOffset: number;
}

export type Modal = ConfirmModal | ForkModal | SearchModal;

export function modalGeometry(
  terminalWidth: number,
  terminalHeight: number
): { left: number; top: number; width: number; height: number } {
  // Integer rows and columns: fractional percentage layout rounds pane heights
  // up while flooring child offsets, which makes footers overlap pane borders.
  const width = Math.max(40, Math.floor(terminalWidth * 0.8));
  const height = Math.max(10, Math.floor(terminalHeight * 0.7));
  return {
    left: Math.max(0, Math.floor((terminalWidth - width) / 2)),
    top: Math.max(1, Math.floor((terminalHeight - height) / 2)),
    width,
    height,
  };
}

export function ModalFrame(props: { title: string; danger: boolean; children: JSX.Element }) {
  const dimensions = useTerminalDimensions();
  const geometry = () => modalGeometry(dimensions().width, dimensions().height);
  return (
    <>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        zIndex={10}
        backgroundColor={COLORS.backdrop}
      />
      <box
        position="absolute"
        left={geometry().left + 2}
        top={geometry().top + 1}
        width={geometry().width}
        height={geometry().height}
        zIndex={15}
        backgroundColor={COLORS.shadow}
      />
      <box
        position="absolute"
        left={geometry().left}
        top={geometry().top}
        width={geometry().width}
        height={geometry().height}
        zIndex={20}
        flexDirection="column"
        border={true}
        borderStyle="double"
        borderColor={props.danger ? COLORS.danger : COLORS.active}
        backgroundColor="#0c0e13"
        title={props.title}
        titleColor={props.danger ? COLORS.danger : COLORS.active}
        padding={1}
        overflow="hidden"
      >
        {props.children}
      </box>
    </>
  );
}

/** Visible search-result rows after the modal chrome and the status line. */
export function searchResultsCapacity(terminalWidth: number, terminalHeight: number): number {
  return Math.max(4, modalGeometry(terminalWidth, terminalHeight).height - 10);
}

/** Inner height of a modal after the frame's border and padding. */
function useModalBodyHeight(): () => number {
  const dimensions = useTerminalDimensions();
  return () => modalGeometry(dimensions().width, dimensions().height).height - 4;
}

export function ConfirmView(props: { modal: ConfirmModal }) {
  const bodyHeight = useModalBodyHeight();
  const capacity = () => Math.max(3, bodyHeight() - 5);
  const rows = () =>
    props.modal.lines
      .slice(props.modal.offset, props.modal.offset + capacity())
      .map((line, offset) => ({ index: props.modal.offset + offset, line }));
  const remaining = () => props.modal.lines.length - props.modal.offset - capacity();

  return (
    <>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">
        <Show when={props.modal.offset > 0}>
          <text height={1} fg={COLORS.dim}>{`↑ ${props.modal.offset} more`}</text>
        </Show>
        <For each={rows()}>
          {(row) => (
            <text height={1} fg={row.index === 0 ? COLORS.dim : COLORS.text}>
              {row.line}
            </text>
          )}
        </For>
        <Show when={remaining() > 0}>
          <text height={1} fg={COLORS.dim}>{`↓ ${remaining()} more`}</text>
        </Show>
      </box>
      <HintLine
        hints={[
          ['y', 'confirm'],
          ['n', 'cancel'],
          ['j/k', 'scroll'],
        ]}
      />
    </>
  );
}

export function ForkView(props: { modal: ForkModal }) {
  return (
    <>
      <box flexGrow={1} flexDirection="column">
        <text fg={COLORS.dim}>The source remains tracked. The new copy is local.</text>
        <box height={1} />
        <text>
          <span style={{ fg: COLORS.dim }}>{'Name: '}</span>
          <span style={{ fg: COLORS.text }}>{props.modal.value}</span>
          <span style={{ fg: COLORS.active }}>_</span>
        </text>
      </box>
      <HintLine
        hints={[
          ['Enter', 'fork'],
          ['Esc', 'cancel'],
        ]}
      />
    </>
  );
}

export function SearchQueryView(props: { modal: SearchModal }) {
  return (
    <>
      <box flexGrow={1} flexDirection="column">
        <text>
          <span style={{ fg: COLORS.dim }}>{'Search: '}</span>
          <span style={{ fg: COLORS.text }}>{props.modal.query}</span>
          <span style={{ fg: COLORS.active }}>_</span>
        </text>
        <box height={1} />
        <text fg={COLORS.dim} truncate={true}>
          {props.modal.message}
        </text>
      </box>
      <HintLine
        hints={[
          ['Enter', 'search'],
          ['Backspace', 'delete'],
          ['Esc', 'close'],
        ]}
      />
    </>
  );
}

export function SearchResultsView(props: { modal: SearchModal }) {
  const dimensions = useTerminalDimensions();
  const bodyHeight = useModalBodyHeight();
  const capacity = () => Math.max(4, bodyHeight() - 6);
  const previewCapacity = () => Math.max(3, bodyHeight() - 6);

  // Integer copy of the flex layout so names and sources ellipsize cleanly
  // instead of colliding with each other mid-row.
  const resultsPaneWidth = () => {
    const inner = modalGeometry(dimensions().width, dimensions().height).width - 4;
    return Math.floor(inner * 0.45) - 5;
  };

  const rows = () => {
    const size = capacity();
    const start = Math.max(
      0,
      Math.min(props.modal.index - Math.floor(size / 2), props.modal.results.length - size)
    );
    return props.modal.results
      .slice(start, start + size)
      .map((result, offset) => ({ index: start + offset, result }));
  };

  const selectedResult = () => props.modal.results[props.modal.index];

  const visiblePreview = () =>
    props.modal.preview
      .split(/\r?\n/)
      .slice(props.modal.previewOffset, props.modal.previewOffset + previewCapacity())
      .join('\n');

  const resultsTitle = () => {
    if (props.modal.results.length <= capacity()) return 'Results';
    return `Results ${props.modal.index + 1}/${props.modal.results.length}`;
  };

  const previewTitle = () => {
    const result = selectedResult();
    if (!result) return 'Preview';
    const label = `Preview ${result.name}`;
    const total = props.modal.preview ? props.modal.preview.split(/\r?\n/).length : 0;
    if (total <= previewCapacity()) return label;
    const end = Math.min(props.modal.previewOffset + previewCapacity(), total);
    return `${label} · ${props.modal.previewOffset + 1}-${end}/${total}`;
  };

  return (
    <>
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1} overflow="hidden">
        <box
          width="45%"
          flexDirection="column"
          border={true}
          borderStyle="rounded"
          borderColor={COLORS.border}
          title={resultsTitle()}
          titleColor={COLORS.dim}
          paddingX={1}
          overflow="hidden"
        >
          <text fg={COLORS.dim} height={1} truncate={true}>
            {props.modal.message}
          </text>
          <For each={rows()}>
            {(row) => {
              const current = () => row.index === props.modal.index;
              // Names get priority; the source stays only when it leaves at
              // least a readable stub, otherwise just the install count shows.
              const segments = () => {
                const width = resultsPaneWidth();
                const installs = formatInstalls(row.result.installs);
                let nameWidth = Math.min(row.result.name.length, Math.ceil(width * 0.55));
                let sourceWidth = width - nameWidth - installs.length - 6;
                if (sourceWidth < 8) {
                  sourceWidth = 0;
                  nameWidth = Math.min(row.result.name.length, width - installs.length - 4);
                }
                return {
                  name: fit(row.result.name, nameWidth),
                  source: sourceWidth ? fit(row.result.source, sourceWidth) : '',
                  installs,
                };
              };
              return (
                <box
                  height={1}
                  width="100%"
                  flexDirection="row"
                  backgroundColor={current() ? COLORS.cursor : undefined}
                >
                  <text flexGrow={1} truncate={true}>
                    <span style={{ fg: current() ? COLORS.accent : COLORS.dim }}>
                      {current() ? '❯ ' : '  '}
                    </span>
                    {current() ? (
                      <b style={{ fg: COLORS.text }}>{segments().name}</b>
                    ) : (
                      <span style={{ fg: COLORS.text }}>{segments().name}</span>
                    )}
                  </text>
                  <text flexShrink={0}>
                    {segments().source ? (
                      <span style={{ fg: COLORS.dim }}>{`${segments().source} · `}</span>
                    ) : null}
                    <span style={{ fg: COLORS.text }}>{segments().installs}</span>
                  </text>
                </box>
              );
            }}
          </For>
        </box>

        <box
          width="55%"
          flexDirection="column"
          border={true}
          borderStyle="rounded"
          borderColor={COLORS.border}
          title={previewTitle()}
          titleColor={COLORS.accent}
          paddingX={1}
          overflow="hidden"
        >
          <Show when={selectedResult()} fallback={<text fg={COLORS.dim}>No skill selected</text>}>
            <text height={1} truncate={true}>
              {props.modal.previewFile ? (
                <>
                  <span style={{ fg: COLORS.accent }}>{props.modal.previewFile}</span>
                  <span style={{ fg: COLORS.dim }}>{` · ${selectedResult()!.source}`}</span>
                </>
              ) : (
                <span style={{ fg: COLORS.dim }}>{selectedResult()!.source}</span>
              )}
            </text>
            <Show
              when={props.modal.previewState !== 'loading'}
              fallback={<text fg={COLORS.dim}>Loading preview…</text>}
            >
              <text
                fg={props.modal.previewState === 'error' ? COLORS.warning : COLORS.text}
                wrapMode="word"
                flexGrow={1}
              >
                {visiblePreview()}
              </text>
            </Show>
          </Show>
        </box>
      </box>
      <HintLine
        hints={[
          ['j/k', 'move'],
          ['n/p', 'page'],
          ['Enter', 'install'],
          ['i', 'project'],
          ['I', 'global'],
          ['PageUp/PageDown', 'preview'],
          ['Esc', 'search'],
        ]}
      />
    </>
  );
}
