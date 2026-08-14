import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppPaths } from '../src/paths.ts';
import { createAppPaths } from '../src/paths.ts';

export function testPaths(project: string, home: string): AppPaths {
  const paths = createAppPaths(project, home);
  paths.scopes.global.lockPath = join(home, '.agents', '.skill-lock.json');
  return paths;
}

// waitForFrame stops as soon as the test renderer is idle. Discovery and
// search finish after that, so tests have to keep polling on their own.
export async function waitForAppFrame(
  setup: { flush: () => Promise<void>; captureCharFrame: () => string },
  predicate: (frame: string) => boolean,
  timeoutMs = 3000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = setup.captureCharFrame();
  while (Date.now() < deadline) {
    await setup.flush();
    frame = setup.captureCharFrame();
    if (predicate(frame)) return frame;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for frame:\n${frame}`);
}

export async function writeSkill(
  skillsDir: string,
  folder: string,
  options: { name?: string; description?: string; body?: string; readme?: string } = {}
): Promise<string> {
  const dir = join(skillsDir, folder);
  await mkdir(dir, { recursive: true });
  const name = options.name || folder;
  const description = options.description || `${name} description`;
  const contents = `---\nname: ${name}\ndescription: ${description}\n---\n\n${
    options.body || `# ${name}\n\nInstructions.`
  }\n`;
  await writeFile(join(dir, 'SKILL.md'), contents, 'utf8');
  if (options.readme) await writeFile(join(dir, 'README.md'), options.readme, 'utf8');
  return dir;
}
