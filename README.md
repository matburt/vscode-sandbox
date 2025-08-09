# VS Code/Cursor Sandbox Explorer

A VS Code/Cursor extension that integrates with the [`sandbox` CLI](https://github.com/anoek/sandbox) to visualize and manage sandboxed file changes from your workspace. Provides a dedicated explorer, context actions, and terminal integration.

## Features
- Sandbox explorer view grouped by operation (error, remove, rename, modify, create)
- Hierarchical directory view under each group; folders run actions on entire subtrees
- Commands: Enter, Diff, Accept, Reject, Sync, Stop, Delete
- Diff output in an Output Channel; Accept/Reject/Sync/Stop/Delete with progress
- Status bar shortcut to open a sandbox terminal
- Configurable CLI path, sandbox name, network, binds, masks, and ignored

### Overlay indicator
- When the Explorer is showing the overlay, the Sandbox view shows an indicator and limits actions to only:
  - Enter Sandbox
  - Restore Workspace Folder (if an original was recorded)

Screenshots:
- Normal workspace — full actions
  - ![Normal workspace actions](docs/images/normal-workspace-actions.png)
- Overlay active — indicator visible, actions filtered
  - ![Overlay active](docs/images/overlay-active.png)
- Overlay without mapping — indicator visible, restore hidden
  - ![Overlay no mapping](docs/images/overlay-no-mapping.png)

## Requirements
- Linux host with `sandbox` CLI installed and setuid root (or run as root). If you see an insufficient permissions error, install via `make install` in the CLI repo.
- The CLI supports JSON output for status and config; this extension uses those endpoints.

## Quick start
1. Install the `sandbox` CLI and ensure it is accessible in your PATH (or set `sandbox.binaryPath`).
2. Open a workspace folder you want to work with.
3. Open the Sandbox explorer in the Explorer sidebar.
4. Use the toolbar to Enter, Sync, Stop, or Delete; use context menu on files/folders to Diff/Accept/Reject.

## Settings
Under `Sandbox` in settings:
- `sandbox.binaryPath`: Path to the `sandbox` binary. Default: `sandbox`.
- `sandbox.name`: Sandbox name (empty uses default behavior).
- `sandbox.net`: `none` or `host`.
- `sandbox.noDefaultBinds`: Disable default bind mounts.
- `sandbox.bind`: Array of bind mount entries (e.g., `/src:/work:ro`).
- `sandbox.mask`: Array of mask entries to hide inside the sandbox.
- `sandbox.ignored`: Include files normally filtered by ignore rules.

## Commands
- `Sandbox: Refresh` — Reload the explorer tree
- `Sandbox: Enter` — Open an integrated terminal inside the sandbox
- `Sandbox: Diff` — Show textual diff for selected file/folder patterns
- `Sandbox: Accept` — Accept changes for selected patterns
- `Sandbox: Reject` — Reject changes for selected patterns
- `Sandbox: Sync` — Synchronize changes from host to sandbox
- `Sandbox: Stop` — Stop the sandbox
- `Sandbox: Delete` — Delete sandbox and all associated files
- `Sandbox: Show Config` — Shows parsed `sandbox config --json`
- `Sandbox: Use Overlay in Explorer` — Reopens VS Code on the overlay/upper directory (window reload; terminals reset)
- `Sandbox: Restore Workspace Folder` — Reopens the original workspace folder, if previously recorded (window reload)
- `Sandbox: Add Overlay as Workspace Folder` — Adds the overlay as a second folder in a multi-root workspace (no reload; terminals preserved)
- `Sandbox: Remove Overlay Workspace Folder` — Removes the added overlay folder from a multi-root workspace

## Patterns
- Clicking a file node passes its absolute path to the CLI.
- Clicking a folder node passes a `folder/**` pattern to operate on its subtree.
- You can also enter multiple comma-separated patterns via the input box when invoking commands.

## Actions reference (behavior and side-effects)

- Enter Sandbox
  - Opens an integrated terminal running `sandbox <your shell>` with current settings (`--name`, `--net`, `--bind`, `--mask`, `--no-default-binds`, `--ignored`).
  - Terminals are tracked so the status bar item appears only when a sandbox terminal is active.

- Refresh
  - Reloads the Sandbox explorer (debounced file events also trigger refresh). No side-effects.

- Diff
  - Streams `sandbox diff <patterns...>` into the "Sandbox Diff" Output Channel in real time.
  - Available from file/folder nodes or the command palette (prompts for patterns).

- Accept / Reject
  - Runs `sandbox accept|reject <patterns...>` with a progress notification.
  - Refreshes the explorer after completion.

- Sync
  - Runs `sandbox sync` to synchronize host changes into running sandboxes. Refreshes afterward.

- Stop
  - Runs `sandbox stop` for the current sandbox name. Does not reject changes.

- Delete
  - Runs `sandbox delete -y` for the current sandbox name. Permanently deletes overlay/upper/work.
  - Confirms before proceeding.

- Show Config
  - Runs `sandbox config --json name storage_dir upper_cwd overlay_cwd` and shows parsed values.

- Use Overlay in Explorer
  - Reopens VS Code with the overlay (or upper) directory as the workspace root.
  - Side-effect: this triggers a full window reload; integrated terminals are reset by VS Code.
  - The extension records the mapping from overlay path back to the original workspace so you can restore later.

- Restore Workspace Folder
  - Reopens VS Code with the original workspace folder that was recorded when you last used "Use Overlay in Explorer".
  - Side-effect: full window reload; integrated terminals are reset by VS Code.
  - If there is no recorded mapping (e.g., you opened overlay manually), a warning will be shown.

- Add Overlay as Workspace Folder
  - Adds the overlay directory as an additional folder in a multi-root workspace alongside your original folder.
  - No window reload; existing terminals are preserved.

- Remove Overlay Workspace Folder
  - Removes the previously added overlay folder from the workspace.

Context menu availability
- File and folder nodes have context actions (Diff, Accept, Reject).
- Workspace and Actions nodes do not show file-specific context actions.

## Multi-root workspaces
- Current behavior targets the first workspace folder. Future enhancements will create a composite tree per root.

Tip: Use "Add Overlay as Workspace Folder" to keep your original root and the overlay visible simultaneously.

## Recommended workflow

1) Installation
- Install the [`sandbox` CLI](https://github.com/anoek/sandbox) and run `make install` to set setuid root as required by the CLI.
- Build and install this extension locally (see Install section below). Set `Sandbox: Binary Path` if the binary is not on your PATH.

2) Open your project workspace
- Open the project’s source tree as your primary workspace folder.
- Configure optional settings as needed: `sandbox.name`, `sandbox.net`, `sandbox.bind`, `sandbox.mask`, `sandbox.noDefaultBinds`, `sandbox.ignored`.

3) Add the overlay as a second folder (recommended)
- In the Sandbox view, run "Add Overlay as Workspace Folder". This keeps terminals alive and shows both views side-by-side.
- You can now browse/edit in either the original folder or the overlay folder.

4) Inspect and curate changes
- Use the Sandbox explorer to view grouped changes (Error, Remove, Rename, Modify, Create) with a directory hierarchy.
- Click files/folders to run Diff; use the Output Channel to review changes.
- Use Accept/Reject on specific files or entire folders (applies to `folder/**`).

5) Sync and manage lifecycle
- Run Sync to bring host-side changes into running sandboxes when needed.
- Stop to terminate processes and unmount sandbox without discarding changes.
- Delete when you want to discard a sandbox and all associated files.

6) Switching Explorer roots (optional)
- If desired, use "Use Overlay in Explorer" to make the overlay the sole workspace root (window reload; terminals reset).
- Later, use "Restore Workspace Folder" to return to the original workspace (also reloads).

7) Troubleshooting
- Permission error (setuid): Follow the prompt; run `make install` for the CLI to set the proper bits.
- Binary not found: Use the quick-fix to open settings and set `sandbox.binaryPath`.

## Development
- Build: `npm run build`
- Watch: `npm run watch`

## Install for testing and usage
- From this folder, build the extension: `npm run build`.
- Launch VS Code/Cursor and use the command palette: `Developer: Install Extension from Location...`, pick this folder (or use `code --install-extension .`).
- Reload the window and open a workspace with your source tree.
- Configure settings under `Sandbox` as needed (e.g., `sandbox.binaryPath`).

## License
Apache-2.0 (same as the `sandbox` CLI project)
