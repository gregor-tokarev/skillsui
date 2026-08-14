#!/usr/bin/env bun
/** @jsxImportSource @opentui/solid */

import { render } from '@opentui/solid';
import { resolve } from 'node:path';
import { App } from './app.tsx';
import { createAppPaths } from './paths.ts';
import { updateSelf } from './self-update.ts';
import { CLI_VERSION } from './version.ts';

const HELP = `skillsui ${CLI_VERSION}

Usage:
  skillsui [--project path]
  skillsui update [version]
  skillsui --version
`;

function projectArgument(args: string[]): string {
  const index = args.findIndex((arg) => arg === '--project' || arg === '-p');
  if (index === -1) return process.cwd();
  const value = args[index + 1];
  if (!value) throw new Error('--project requires a path');
  return resolve(value);
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v') || args[0] === 'version') {
  process.stdout.write(`${CLI_VERSION}\n`);
  process.exit(0);
}

if (args[0] === 'update') {
  const version = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
  try {
    const result = await updateSelf(version ? { version } : {});
    process.stdout.write(`${result.message}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

const paths = createAppPaths(projectArgument(args));

await render(() => <App paths={paths} />, {
  screenMode: 'alternate-screen',
  exitOnCtrlC: false,
  clearOnShutdown: true,
  targetFps: 30,
  backgroundColor: '#111318',
});
