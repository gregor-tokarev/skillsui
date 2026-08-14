import solidPlugin from '@opentui/solid/bun-plugin';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const targets = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64-baseline',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64-baseline',
} as const;

type TargetName = keyof typeof targets;

function parseTargets(): TargetName[] {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (requested.length === 0) {
    const current = `${process.platform}-${process.arch}` as TargetName;
    if (!(current in targets)) throw new Error(`Unsupported build host: ${current}`);
    return [current];
  }
  if (requested.includes('all')) return Object.keys(targets) as TargetName[];
  for (const target of requested) {
    if (!(target in targets)) throw new Error(`Unknown target: ${target}`);
  }
  return requested as TargetName[];
}

const outDir = resolve('dist');
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const targetName of parseTargets()) {
  const target = targets[targetName];
  const outfile = join(outDir, `skillsui-${targetName}`);
  const result = await Bun.build({
    entrypoints: [resolve('src/index.tsx')],
    plugins: [solidPlugin],
    minify: true,
    sourcemap: 'none',
    compile: {
      target,
      outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
    ...(targetName.startsWith('linux-')
      ? { define: { 'process.env.OPENTUI_LIBC': JSON.stringify('glibc') } }
      : {}),
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exitCode = 1;
    break;
  }
  console.log(outfile);
}
