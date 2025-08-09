# VS Code/Cursor Sandbox Explorer - Planning & Architecture

Goal: Provide a left-nav Explorer view that visualizes the current directory's sandbox status and allows “Enter Sandbox”, Accept/Reject/Diff actions, and quick terminal attach inside the sandbox.

## Summary
- Extension contributes a new Activity Bar/Explorer view: "Sandbox"
- Reads data via the `sandbox` CLI (`--json` where supported)
- Shows the sandbox tree for the current workspace folder
- Provides context actions: Enter, Status, Diff, Accept, Reject, Stop, Delete
- Opens terminals and tasks inside the sandbox
- Works in both VS Code and Cursor (Cursor is VS Code-compatible API)

## UX
- Explorer view: nodes grouped by operation
  - Rename: source -> destination
  - Modify/Create: path
  - Remove: path
- Toolbar: Refresh, Enter Sandbox (shell), Sync, Stop, Delete
- Context Menu: Diff, Accept, Reject (with pattern prefilled from node)
- Status bar item when in a sandboxed terminal

## Data model & commands
- Workspace root: determine with VS Code `workspaceFolders[0]`
- Invoke `sandbox` with the computed config for current cwd
  - `sandbox status --json` (indirect via `set_json_output("changes", [...])`)
  - `sandbox config --json name storage_dir upper_cwd overlay_cwd` (to find paths)
  - `sandbox diff <pattern...>` (stdout stream)
  - `sandbox accept <pattern...>` / `sandbox reject <pattern...>`
  - `sandbox stop` / `sandbox delete -y`

### Parsing
- `status` JSON key: `changes: [{ destination, operation, source, staged }]`
- Group changes into: create, modify, remove, rename, error
- Build a tree under the workspace folder; child nodes by directory

### Entering a sandbox
- Open an integrated terminal with command: `sandbox <user shell>`
- Optionally pre-create a named sandbox if not running: `sandbox --name <name>`
- For multiple folders, pick per-folder sandbox name (configurable)

## Patterns from tree selections
- Node selection yields a file path or folder path relative to workspace
- Pass that as a pattern to `accept/reject/diff`:
  - Single file: `path/to/file`
  - Folder: `path/to/dir/` (plugin will append `/**` for matching)

## Extension outline
- `package.json` contributions:
  - views: `sandboxExplorer`
  - commands: `sandbox.refresh`, `sandbox.enter`, `sandbox.accept`, `sandbox.reject`, `sandbox.diff`, `sandbox.sync`, `sandbox.stop`, `sandbox.delete`
  - menus/context for tree items
- `TreeDataProvider` for sandbox changes
  - fetch via `status --json`
  - refresh on commands or file change
- Terminal manager: open/track terminals launched via `sandbox`
- Settings:
  - `sandbox.name`: default name or `new/last` behavior
  - `sandbox.net`: `host|none`
  - `sandbox.bind`: array of binds
  - `sandbox.noDefaultBinds`: boolean
  - `sandbox.binaryPath`: path to `sandbox` binary

## Implementation details
- Binary detection: resolve from PATH; allow override
- JSON mode: use `--json` for status/config, parse stderr/stdout buffering
- Long-running ops:
  - Diff: spawn process, stream output into panel
  - Accept/Reject: show progress notification; refresh tree afterward
- Error handling: surface CLI errors with output shown
- Multi-root workspaces: each root gets a separate tree root and config

## Security/privileges
- `sandbox` must run with setuid root; the extension should:
  - Detect permission error messages and guide installation (`make install`)
  - Avoid attempting privileged operations when unavailable; degrade gracefully

## Performance
- Status calls lazy; debounce refresh
- Use file watcher to suggest refresh when working files change

## Test plan
- Mock CLI layer for CI
- E2E manual tests on Linux host: list, diff, accept/reject, terminal attach
- Coverage not required here (extension), but keep unit tests for parsing

## Future enhancements
- In-place diff view using VS Code diff panes by materializing staged file into temp and comparing with host
- Live indicator of running sandboxes in status bar
- Quick pick to switch sandboxes (`--name`, `--last`)

## Minimal CLI surfaces required (available today)
- `sandbox status --json` (changes array)
- `sandbox accept <patterns...>`
- `sandbox reject <patterns...>`
- `sandbox diff <patterns...>`
- `sandbox config --json name storage_dir upper_cwd overlay_cwd`
- `sandbox stop` / `sandbox delete -y`

## Open questions
- Should we auto-create sandbox names per workspace, or default to `sandbox`?
- Diff experience: terminal output vs integrated VS Code diff panes?
- Masking/binds via settings: apply from extension or instruct user via config?
