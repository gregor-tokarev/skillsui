# skillsui

A terminal UI for managing [skills.sh](https://skills.sh) skills. Two panes, project on the left
and global on the right, driven entirely by the keyboard.

There is no database and no config file. skillsui reads the skill folders and the CLI lockfiles on
disk, and every action writes back to those same files.

| Scope   | Skill folders       | Lockfile                                                                   |
| ------- | ------------------- | -------------------------------------------------------------------------- |
| Project | `.agents/skills/`   | `skills-lock.json`                                                         |
| Global  | `~/.agents/skills/` | `~/.agents/.skill-lock.json`, or `$XDG_STATE_HOME/skills/.skill-lock.json` |

## Install

Release binaries cover macOS and glibc Linux on ARM64 and x64.

```sh
curl -fsSL https://raw.githubusercontent.com/gregor-tokarev/skillsui/main/install.sh | sh
```

The installer verifies the SHA-256 checksum and writes `skillsui` to `~/.local/bin`. Three
environment variables override its defaults: `SKILLSUI_INSTALL_DIR` for the destination,
`SKILLSUI_VERSION` for a specific tag, and `SKILLSUI_REPOSITORY` for a fork.

Update an existing install:

```sh
skillsui update
```

That downloads the latest GitHub release, checks the SHA-256, and replaces the running binary. Pin
a tag with `skillsui update v0.1.4`. Builds older than this command need the curl installer one
more time.

## Use

Run `skillsui` from a project root. `skillsui --project path` (or `-p`) points it somewhere else.
Running from your home directory shows only the global pane, since the two would otherwise list the
same folder twice.

| Key       | Action                                                  |
| --------- | ------------------------------------------------------- |
| `j` / `k` | Move within a pane                                      |
| `h` / `l` | Switch between the project and global panes             |
| `x`       | Toggle batch selection                                  |
| `D`       | Delete after confirming absolute paths                  |
| `M`       | Move selected skills to the other scope                 |
| `F`       | Fork one skill under a new local name                   |
| `U`       | Update selected tracked skills                          |
| `o`       | Open the skill folder with `$EDITOR`                    |
| `i` / `I` | Search skills.sh and install in project or global scope |
| `r`       | Reload folders, lockfiles, and update state             |
| `q`       | Quit                                                    |

Arrow keys work anywhere `hjkl` does.

A selected batch applies across both panes for delete and update. Move acts on the active pane
because every moved skill then has the same destination scope. With nothing selected, an action
uses the skill under the cursor.

Folders with a lock entry are tracked. Folders without one are local. Lock entries with no folder
on disk are counted as hidden in the pane title. An update replaces the contents of a tracked
skill, so the status line warns you before one starts.

### Search and install

`i` and `I` open a split modal. Type a query, press `Enter`, then move through the results with
`j` / `k`. Selecting a result downloads its `SKILL.md` and shows it in the right half before you
commit.

| Key                   | Action                                     |
| --------------------- | ------------------------------------------ |
| `Enter`               | Install into the scope the modal opened in |
| `i` / `I`             | Install into the project or global scope   |
| `n` / `p`             | Next / previous page of results            |
| `PageUp` / `PageDown` | Scroll the preview                         |
| `Backspace`           | Back to the query                          |
| `Esc`                 | Close the modal                            |

Confirmation dialogs answer to `y` and `n`, and scroll with `j` / `k` when the list of paths runs
past the screen.

## Development

skillsui pins `vercel-labs/skills` as a Git submodule and imports its frontmatter parser, so clone
with submodules:

```sh
git clone --recurse-submodules https://github.com/gregor-tokarev/skillsui.git
cd skillsui
bun install
bun run dev
```

Checks:

```sh
bun run typecheck
bun run test
bun run format:check
bun run lint
bun run build
```

`bun run build` compiles for the current host. Pass `all`, `darwin-arm64`, `darwin-x64`,
`linux-arm64`, or `linux-x64` to pick release targets. Linux builds declare OpenTUI's libc as glibc
so Bun embeds the matching native package, and the x64 executables use Bun's baseline target for
pre-2013 CPUs.

Issues and pull requests are welcome. Run `bun run check` before you open one.

## License

MIT. See [LICENSE](LICENSE).
