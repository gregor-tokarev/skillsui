import type { Accessor, Setter } from 'solid-js';
import type { KeyEvent } from '@opentui/core';
import type { Modal } from '../ui/modals.tsx';
import type { SkillActions } from './actions.ts';
import type { LibraryState } from './library.ts';
import type { SearchController } from './search.ts';

const CONFIRM_PAGE_STEP = 8;
const PREVIEW_PAGE_STEP = 10;

export interface KeyBindingsDeps {
  library: LibraryState;
  actions: SkillActions;
  search: SearchController;
  modal: Accessor<Modal | null>;
  setModal: Setter<Modal | null>;
  quit: () => void;
}

function isEnter(key: KeyEvent): boolean {
  return key.name === 'return' || key.name === 'enter';
}

function typedCharacter(key: KeyEvent): string | null {
  if (key.ctrl || key.meta || key.option) return null;
  return key.raw.length === 1 && key.raw >= ' ' && key.raw !== '\x7f' ? key.raw : null;
}

/**
 * The single keyboard handler. A modal, when open, takes every key; otherwise
 * the keys act on the panes and are ignored while an operation runs.
 */
export function createKeyBindings({
  library,
  actions,
  search,
  modal,
  setModal,
  quit,
}: KeyBindingsDeps): (key: KeyEvent) => void {
  function closeModal(): void {
    search.cancelPendingRequests();
    setModal(null);
    library.announce('Cancelled');
  }

  /** The scope an install targets: shift, or no project scope at all, means global. */
  function installScope(key: KeyEvent) {
    return key.shift || !library.projectEnabled() ? 'global' : 'project';
  }

  function handleModalKey(key: KeyEvent, activeModal: Modal): void {
    key.preventDefault();
    if (key.name.toLowerCase() === 'q') {
      quit();
      return;
    }
    if (key.name === 'escape') {
      if (activeModal.type === 'search' && activeModal.phase === 'results') {
        search.returnToSearch(activeModal);
        return;
      }
      closeModal();
      return;
    }

    if (activeModal.type === 'confirm') {
      if (key.name.toLowerCase() === 'y') void activeModal.action();
      if (key.name.toLowerCase() === 'n') closeModal();
      if (key.name === 'j' || key.name === 'down' || key.name === 'pagedown') {
        const step = key.name === 'pagedown' ? CONFIRM_PAGE_STEP : 1;
        setModal({
          ...activeModal,
          offset: Math.min(activeModal.offset + step, Math.max(0, activeModal.lines.length - 1)),
        });
      }
      if (key.name === 'k' || key.name === 'up' || key.name === 'pageup') {
        const step = key.name === 'pageup' ? CONFIRM_PAGE_STEP : 1;
        setModal({ ...activeModal, offset: Math.max(0, activeModal.offset - step) });
      }
      return;
    }

    if (activeModal.type === 'fork') {
      if (isEnter(key)) return void actions.submitFork(activeModal);
      if (key.name === 'backspace') {
        setModal({ ...activeModal, value: activeModal.value.slice(0, -1) });
        return;
      }
      const character = typedCharacter(key);
      if (character) setModal({ ...activeModal, value: activeModal.value + character });
      return;
    }

    if (activeModal.phase === 'query') {
      if (isEnter(key)) return void search.submitSearch(activeModal);
      if (key.name === 'backspace') {
        setModal({ ...activeModal, query: activeModal.query.slice(0, -1) });
        return;
      }
      const character = typedCharacter(key);
      if (character) setModal({ ...activeModal, query: activeModal.query + character });
      return;
    }

    if (key.name === 'backspace') {
      search.returnToSearch(activeModal);
    } else if (key.name === 'j' || key.name === 'down') {
      search.moveCursor(activeModal, activeModal.index + 1);
    } else if (key.name === 'k' || key.name === 'up') {
      search.moveCursor(activeModal, activeModal.index - 1);
    } else if (key.name.toLowerCase() === 'n') {
      search.pageResults(activeModal, 1);
    } else if (key.name.toLowerCase() === 'p') {
      search.pageResults(activeModal, -1);
    } else if (key.name === 'pagedown') {
      search.scrollPreview(activeModal, PREVIEW_PAGE_STEP);
    } else if (key.name === 'pageup') {
      search.scrollPreview(activeModal, -PREVIEW_PAGE_STEP);
    } else if (isEnter(key)) {
      void search.installSelected(activeModal, activeModal.scope);
    } else if (key.name.toLowerCase() === 'i') {
      void search.installSelected(activeModal, installScope(key));
    }
  }

  return (key: KeyEvent) => {
    const activeModal = modal();
    if (activeModal) return handleModalKey(key, activeModal);
    if (library.busy()) return;
    const keyName = key.name.toLowerCase();

    if ((key.ctrl && keyName === 'c') || keyName === 'q') return quit();
    if (keyName === 'j' || keyName === 'down') return library.moveCursor(1);
    if (keyName === 'k' || keyName === 'up') return library.moveCursor(-1);
    if (keyName === 'h' || keyName === 'left') return library.focusScope('project');
    if (keyName === 'l' || keyName === 'right') return library.focusScope('global');
    if (keyName === 'x') {
      const skill = library.currentSkill();
      if (skill) library.toggleSelection(skill.id);
      return;
    }
    if (keyName === 'd') return actions.openDelete();
    if (keyName === 'm') return void actions.startMove();
    if (keyName === 'f') return actions.openFork();
    if (keyName === 'u') return actions.startUpdate();
    if (keyName === 'o') return void actions.openEditor();
    if (keyName === 'i') return search.openSearch(installScope(key));
    if (keyName === 'r') return void library.refresh(true);
  };
}
