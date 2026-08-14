export interface EditorSessionOptions {
  editor?: string;
  suspend?: () => void;
  resume?: () => void;
}

/** Opens a folder with the command in $EDITOR and waits for it to exit. */
export async function openSkillFolderInEditor(
  folder: string,
  options: EditorSessionOptions = {}
): Promise<void> {
  const editor = (options.editor ?? process.env.EDITOR)?.trim();
  if (!editor) throw new Error('$EDITOR is not set');

  options.suspend?.();
  try {
    const child = Bun.spawn(['/bin/sh', '-c', 'exec $EDITOR "$1"', 'skillsui-editor', folder], {
      env: { ...process.env, EDITOR: editor },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`$EDITOR exited with code ${exitCode}`);
  } finally {
    options.resume?.();
  }
}
