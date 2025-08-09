# VS Code/Cursor Sandbox Explorer

A VS Code/Cursor extension that integrates with the [`sandbox` CLI](https://github.com/anoek/sandbox) to visualize and manage sandboxed file changes from your workspace. Provides a dedicated explorer, context actions, and terminal integration.

## Features
- Sandbox explorer view grouped by operation (error, remove, rename, modify, create)
- Hierarchical directory view under each group; folders run actions on entire subtrees
- Commands: Enter, Diff, Accept, Reject, Sync, Stop, Delete
- Diff output in an Output Channel; Accept/Reject/Sync/Stop/Delete with progress
- Status bar shortcut to open a sandbox terminal
- Configurable CLI path, sandbox name, network, binds, masks, and ignored

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

## Patterns
- Clicking a file node passes its absolute path to the CLI.
- Clicking a folder node passes a `folder/**` pattern to operate on its subtree.
- You can also enter multiple comma-separated patterns via the input box when invoking commands.

## Multi-root workspaces
- Current behavior targets the first workspace folder. Future enhancements will create a composite tree per root.

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
