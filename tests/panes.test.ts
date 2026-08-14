import { describe, expect, test } from 'bun:test';
import { paneCapacity, paneTitle, paneWindow } from '../src/ui/panes.tsx';
import type { ScopeSnapshot, SkillRecord } from '../src/types.ts';

function skills(count: number): SkillRecord[] {
  return Array.from(
    { length: count },
    (_, index) => ({ folderName: `skill-${index}` }) as SkillRecord
  );
}

function snapshot(count: number, hiddenLockEntries = 0): ScopeSnapshot {
  return { skills: skills(count), hiddenLockEntries } as ScopeSnapshot;
}

describe('pane layout', () => {
  test('reserves the header and status rows and never drops below three rows', () => {
    expect(paneCapacity(30)).toBe(20);
    expect(paneCapacity(8)).toBe(3);
  });

  test('keeps the cursor centred without scrolling past either end', () => {
    const list = skills(10);
    expect(paneWindow(list, 0, 4).map((skill) => skill.folderName)).toEqual([
      'skill-0',
      'skill-1',
      'skill-2',
      'skill-3',
    ]);
    expect(paneWindow(list, 5, 4)[0]!.folderName).toBe('skill-3');
    expect(paneWindow(list, 9, 4)[0]!.folderName).toBe('skill-6');
    expect(paneWindow(skills(2), 0, 4)).toHaveLength(2);
  });

  test('adds the position only when the list overflows, and reports hidden entries', () => {
    expect(paneTitle('project', snapshot(3), 0, 20)).toBe('Project 3');
    expect(paneTitle('global', snapshot(30), 4, 20)).toBe('Global 30 · 5/30');
    expect(paneTitle('global', snapshot(3, 2), 0, 20)).toBe('Global 3 · 2 hidden');
    expect(paneTitle('project', undefined, 0, 20)).toBe('Project 0');
  });
});
