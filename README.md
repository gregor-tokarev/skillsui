# skillsui

`skillsui` is a keyboard-first terminal interface for project and global skills in the
[skills.sh](https://skills.sh) ecosystem. It reads the skill folders and CLI lockfiles directly.
There is no separate database.

## Install

Release binaries support macOS and glibc Linux on ARM64 and x64.

```sh
curl -fsSL https://raw.githubusercontent.com/gregor-tokarev/skillsui/main/install.sh | sh
```

The installer verifies the SHA-256 checksum and writes `skillsui` to `~/.local/bin`. Override the
release repository with `SKILLSUI_REPOSITORY=owner/repo` or the destination with
`SKILLSUI_INSTALL_DIR=/path`.

## Use

Run `skillsui` from a project root. Pass another root with `skillsui --project path`.

| Key                   | Action                                                  |
| --------------------- | ------------------------------------------------------- |
| `j` / `k`             | Move within a pane                                      |
| `h` / `l`             | Switch between project and global panes                 |
| `x`                   | Toggle batch selection                                  |
| `D`                   | Delete after confirming absolute paths                  |
| `M`                   | Move selected skills to the other scope                 |
| `F`                   | Fork one skill under a new local name                   |
| `U`                   | Update selected tracked skills                          |
| `i` / `I`             | Search skills.sh and install in project or global scope |
| `n` / `p`             | Next / previous page of search results                  |
| `PageUp` / `PageDown` | Scroll the selected search result's install preview     |
| `r`                   | Reload folders, lockfiles, and update state             |
| `q`                   | Quit                                                    |

A selected batch applies across both panes for delete and update. Move acts on the active pane
because every moved skill has the same destination scope. If nothing is selected, an action uses
the skill under the cursor.

Folders with lock entries appear as tracked. Folders without entries appear as local. Lock entries
without folders are counted as hidden in the pane title. Updates replace tracked skill contents, so
the status line warns before an update starts.

Search results open in a split install modal. Selecting a result previews its `README.md`, falling
back to `SKILL.md`, before installation.

## Development

The `vercel-labs/skills` repository is pinned as a Git submodule. Clone it with the project:

```sh
git clone --recurse-submodules https://github.com/gregor-tokarev/skillsui.git
cd skillsui
bun install
bun run dev
```

Useful checks:

```sh
bun run typecheck
bun run test
bun run format:check
bun run build
```

`bun run build` compiles the current host target. Pass `all`, `darwin-arm64`, `darwin-x64`,
`linux-arm64`, or `linux-x64` to choose release targets. Linux builds define OpenTUI's libc as
glibc so Bun embeds the matching native package. The x64 executables use Bun's baseline target for
pre-2013 CPUs.
