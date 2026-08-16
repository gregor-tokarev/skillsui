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
a tag with `skillsui update v0.1.5`. Builds older than this command need the curl installer one
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
| `d`       | Delete after confirming absolute paths                  |
| `m`       | Move selected skills to the other scope                 |
| `f`       | Fork one skill under a new local name                   |
| `u`       | Update selected tracked skills                          |
| `o`       | Open the skill folder with `$EDITOR`                    |
| `i` / `I` | Search skills.sh and install in project or global scope |
| `r`       | Reload folders, lockfiles, and update state             |
| `q`       | Quit                                                    |

Arrow keys work anywhere `hjkl` does. Shortcuts are case-insensitive, so holding Shift is never
required — the one exception is `I`, where Shift picks the global scope for an install.

A selected batch applies across both panes for delete and update. Move acts on the active pane
because every moved skill then has the same destination scope. With nothing selected, an action
uses the skill under the cursor.

Folders with a lock entry are tracked. Folders without one are local. Lock entries with no folder
on disk are counted as hidden in the pane title. An update replaces the contents of a tracked
skill, so the status line warns you before one starts.

### Search and install

`i` and `I` open a split modal. Type a query, press `Enter`, then move through the results with
`j` / `k`. Selecting a result downloads its `SKILL.md` and shows it in the right half before you
commit. Installation keeps the canonical skill in `.agents/skills` and links it into
`.claude/skills` for Claude Code.

| Key                   | Action                                     |
| --------------------- | ------------------------------------------ |
| `Enter`               | Install into the scope the modal opened in |
| `i` / `I`             | Install into the project or global scope   |
| `n` / `p`             | Next / previous page of results            |
| `PageUp` / `PageDown` | Scroll the preview                         |
| `Backspace`           | Back to the query                          |
| `Esc`                 | Close the modal                            |
