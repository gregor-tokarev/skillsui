/** @jsxImportSource @opentui/solid */

import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { StatusBar } from '../src/ui/statusbar.tsx';

const BRAILLE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

describe('status bar spinner', () => {
  test('animates while busy and disappears when idle', async () => {
    const setup = await testRender(
      () => <StatusBar status="Installing thing" alert={false} busy={true} skill={null} />,
      { width: 80, height: 6 }
    );
    try {
      const first = await setup.waitForFrame((frame) => BRAILLE.test(frame));
      const firstGlyph = first.match(BRAILLE)![0];
      // The test renderer draws on demand, so wait in real time for the tick.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await setup.flush();
      const second = setup.captureCharFrame();
      expect(second.match(BRAILLE)![0]).not.toBe(firstGlyph);
      expect(second).toContain('Installing thing');
    } finally {
      setup.renderer.destroy();
    }
  });

  test('renders no spinner when idle', async () => {
    const setup = await testRender(
      () => <StatusBar status="3 project, 2 global" alert={false} busy={false} skill={null} />,
      { width: 80, height: 6 }
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes('3 project, 2 global'));
      expect(BRAILLE.test(frame)).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  });
});
