import type { Setter } from 'solid-js';
import type { AppPaths } from '../paths.ts';
import {
  deleteSkills,
  findForkCollision,
  findMoveCollisions,
  forkSkill,
  moveSkills,
  normalizeForkName,
} from '../operations.ts';
import { updateSkills } from '../updates.ts';
import type { ForkModal, Modal } from '../ui/modals.tsx';
import type { LibraryState } from './library.ts';

export interface SkillActionsDeps {
  paths: AppPaths;
  library: LibraryState;
  setModal: Setter<Modal | null>;
}

export type SkillActions = ReturnType<typeof createSkillActions>;

/**
 * Delete, move, fork, and update flows. Each one resolves its targets, asks for
 * confirmation when files would be overwritten, and hands the work to the
 * library's operation runner.
 */
export function createSkillActions({ paths, library, setModal }: SkillActionsDeps) {
  const { announce, actionTargets, runOperation, setBusy } = library;

  function openDelete(): void {
    const targets = actionTargets();
    if (targets.length === 0) {
      announce('No skill to delete', true);
      return;
    }
    setModal({
      type: 'confirm',
      title: `Delete ${targets.length} skill${targets.length === 1 ? '' : 's'}?`,
      lines: ['These folders will be removed:', '', ...targets.map((skill) => skill.path)],
      offset: 0,
      action: () => runOperation('Deleting skills', () => deleteSkills(paths, targets)),
    });
  }

  async function startMove(): Promise<void> {
    if (!library.projectEnabled()) {
      announce('Project scope is unavailable from the home directory', true);
      return;
    }
    const targets = actionTargets(library.activeScope());
    if (targets.length === 0) {
      announce('No skill to move', true);
      return;
    }
    setBusy(true);
    try {
      const collisions = await findMoveCollisions(paths, targets);
      if (collisions.length > 0) {
        setModal({
          type: 'confirm',
          title: `Overwrite ${collisions.length} destination${collisions.length === 1 ? '' : 's'}?`,
          lines: [
            'Existing folders and their lock entries will be replaced:',
            '',
            ...collisions.flatMap((collision) => [
              collision.destination,
              `from ${collision.source}`,
            ]),
          ],
          offset: 0,
          action: () => runOperation('Moving skills', () => moveSkills(paths, targets, true)),
        });
      } else {
        await runOperation('Moving skills', () => moveSkills(paths, targets));
      }
    } finally {
      setBusy(false);
    }
  }

  function openFork(): void {
    const selectedNow = library.selectedSkills();
    if (selectedNow.length > 1) {
      announce('Fork accepts one skill', true);
      return;
    }
    const skill = selectedNow[0] || library.currentSkill();
    if (!skill) {
      announce('No skill to fork', true);
      return;
    }
    setModal({ type: 'fork', skill, value: `${skill.folderName}-fork` });
  }

  async function submitFork(forkModal: ForkModal): Promise<void> {
    const name = normalizeForkName(forkModal.value);
    if (!name) {
      announce('Fork name is empty', true);
      return;
    }
    setBusy(true);
    try {
      const collision = await findForkCollision(paths, forkModal.skill, name);
      if (collision) {
        setModal({
          type: 'confirm',
          title: `Overwrite ${name}?`,
          lines: [
            'The existing fork destination and its lock entry will be replaced:',
            '',
            collision.destination,
          ],
          offset: 0,
          action: () =>
            runOperation('Forking skill', () => forkSkill(paths, forkModal.skill, name, true)),
        });
      } else {
        await runOperation('Forking skill', () => forkSkill(paths, forkModal.skill, name));
      }
    } finally {
      setBusy(false);
    }
  }

  function startUpdate(): void {
    const targets = actionTargets();
    const tracked = targets.filter((skill) => skill.tracked);
    if (tracked.length === 0) {
      announce('No tracked skill selected', true);
      return;
    }
    void runOperation('Updating skills. Local edits may be overwritten', () =>
      updateSkills(paths, targets)
    );
  }

  return { openDelete, startMove, openFork, submitFork, startUpdate };
}
