import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'dist');
const files = (await readdir(directory))
  .filter((name) => name.startsWith('skillsui-') && !name.endsWith('.sha256'))
  .sort();

for (const name of files) {
  const bytes = await readFile(join(directory, name));
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory, `${name}.sha256`), `${hash}  ${basename(name)}\n`, 'utf8');
}
