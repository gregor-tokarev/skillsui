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

function keyEvent(name: string): KeyEvent {
  return new KeyEvent({
    name,
    ctrl: false,
    meta: false,
    shift: false,
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
});

describe('modal key bindings', () => {
  test.each([
    ['confirmation', { type: 'confirm' }],
    ['fork', { type: 'fork' }],
    ['search query', { type: 'search', phase: 'query' }],
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
});
