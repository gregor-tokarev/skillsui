import { describe, expect, test } from 'bun:test';
import { KeyEvent } from '@opentui/core';
import { createKeyBindings, type KeyBindingsDeps } from '../src/state/keybindings.ts';
import type { Modal } from '../src/ui/modals.tsx';

function qKey(): KeyEvent {
  return new KeyEvent({
    name: 'q',
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: 'q',
    number: false,
    raw: 'q',
    eventType: 'press',
    source: 'raw',
  });
}

function keyEvent(name: string, shift = false, ctrl = false): KeyEvent {
  return new KeyEvent({
    name,
    ctrl,
    meta: false,
    shift,
    option: false,
    sequence: name,
    number: false,
    raw: name,
    eventType: 'press',
    source: 'raw',
  });
}

describe('main key bindings', () => {
  test('o opens the current skill in the editor', () => {
    let openCalls = 0;
    const bindings = createKeyBindings({
      modal: () => null,
      library: { busy: () => false },
      actions: { openEditor: () => void openCalls++ },
    } as unknown as KeyBindingsDeps);

    bindings(keyEvent('o'));

    expect(openCalls).toBe(1);
  });

  test.each([
    ['d', 'openDelete'],
    ['m', 'startMove'],
    ['f', 'openFork'],
    ['u', 'startUpdate'],
  ] as const)('%s runs %s without shift, and shift does not change it', (name, action) => {
    let calls = 0;
    const bindings = createKeyBindings({
      modal: () => null,
      library: { busy: () => false },
      actions: { [action]: () => void calls++ },
    } as unknown as KeyBindingsDeps);

    bindings(keyEvent(name));
    expect(calls).toBe(1);

    bindings(keyEvent(name.toUpperCase(), true));
    expect(calls).toBe(2);
  });
});

describe('modal key bindings', () => {
  test.each(['return', 'enter'])('%s confirms a confirmation modal', (name) => {
    let confirmCalls = 0;
    const activeModal: Modal = {
      type: 'confirm',
      title: 'Delete skill?',
      lines: [],
      offset: 0,
      action: async () => void confirmCalls++,
    };
    const bindings = createKeyBindings({
      modal: () => activeModal,
    } as unknown as KeyBindingsDeps);

    bindings(keyEvent(name));

    expect(confirmCalls).toBe(1);
  });

  test('Escape cancels a confirmation modal', () => {
    let confirmCalls = 0;
    let currentModal: Modal | null = {
      type: 'confirm',
      title: 'Delete skill?',
      lines: [],
      offset: 0,
      action: async () => void confirmCalls++,
    };
    let status = '';
    const bindings = createKeyBindings({
      modal: () => currentModal,
      setModal: (next: Modal | null) => (currentModal = next),
      search: { cancelPendingRequests: () => {} },
      library: { announce: (message: string) => (status = message) },
    } as unknown as KeyBindingsDeps);

    bindings(keyEvent('escape'));

    expect(currentModal).toBeNull();
    expect(status).toBe('Cancelled');
    expect(confirmCalls).toBe(0);
  });

  test.each([
    ['confirmation', { type: 'confirm' }],
    ['search results', { type: 'search', phase: 'results' }],
  ])('q quits from the %s modal', (_name, partialModal) => {
    let quitCalls = 0;
    const key = qKey();
    const activeModal = partialModal as unknown as Modal;
    const bindings = createKeyBindings({
      modal: () => activeModal,
      quit: () => quitCalls++,
    } as unknown as KeyBindingsDeps);

    bindings(key);

    expect(quitCalls).toBe(1);
    expect(key.defaultPrevented).toBe(true);
  });

  test('q types into the fork name instead of quitting', () => {
    let quitCalls = 0;
    let currentModal: Modal | null = { type: 'fork', value: 's' } as unknown as Modal;
    const bindings = createKeyBindings({
      modal: () => currentModal,
      setModal: (next: Modal | null) => (currentModal = next),
      quit: () => quitCalls++,
    } as unknown as KeyBindingsDeps);

    bindings(qKey());

    expect(quitCalls).toBe(0);
    expect((currentModal as { value: string }).value).toBe('sq');
  });

  test('q types into the search query instead of quitting', () => {
    let quitCalls = 0;
    let currentModal: Modal | null = {
      type: 'search',
      phase: 'query',
      query: 's',
    } as unknown as Modal;
    const bindings = createKeyBindings({
      modal: () => currentModal,
      setModal: (next: Modal | null) => (currentModal = next),
      quit: () => quitCalls++,
    } as unknown as KeyBindingsDeps);

    bindings(qKey());

    expect(quitCalls).toBe(0);
    expect((currentModal as { query: string }).query).toBe('sq');
  });

  test('ctrl+c quits from a modal', () => {
    let quitCalls = 0;
    const activeModal = { type: 'confirm' } as unknown as Modal;
    const bindings = createKeyBindings({
      modal: () => activeModal,
      quit: () => quitCalls++,
    } as unknown as KeyBindingsDeps);

    bindings(keyEvent('c', false, true));

    expect(quitCalls).toBe(1);
  });
});
