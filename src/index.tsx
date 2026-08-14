#!/usr/bin/env bun
/** @jsxImportSource @opentui/solid */

import { render } from '@opentui/solid';
import { resolve } from 'node:path';
import { App } from './app.tsx';
import { createAppPaths } from './paths.ts';

function projectArgument(args: string[]): string {
  const index = args.findIndex((arg) => arg === '--project' || arg === '-p');
  if (index === -1) return process.cwd();
  const value = args[index + 1];
  if (!value) throw new Error('--project requires a path');
  return resolve(value);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`skillsui\n\nUsage: skillsui [--project path]\n`);
  process.exit(0);
}

const paths = createAppPaths(projectArgument(process.argv.slice(2)));

await render(() => <App paths={paths} />, {
  screenMode: 'alternate-screen',
  exitOnCtrlC: false,
  clearOnShutdown: true,
  targetFps: 30,
  backgroundColor: '#111318',
});
