import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  openSandboxTerminal,
  runAccept,
  runReject,
  runDiff,
  runSync,
  runStop,
  runDelete,
  fetchConfig,
  fetchStatus,
  spawnDiffStream,
} from './cli';
import { SandboxTreeDataProvider } from './tree';
import { SandboxChangeEntry } from './cli';

function getWorkspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function ensurePatterns(arg?: unknown): Promise<string[] | undefined> {
  if (Array.isArray(arg) && arg.every((v) => typeof v === 'string')) {
    return arg as string[];
  }
  const input = await vscode.window.showInputBox({
    title: 'Sandbox pattern(s)',
    placeHolder: 'e.g. path/to/file or dir/** (comma-separated for multiple)',
  });
  if (!input) return undefined;
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
  } catch (err) {
    await handleCliError(err);
    return undefined;
  }
}

async function handleCliError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  let friendly = message;
  if (message.match(/Insufficient permissions|setuid|sudo/i)) {
    friendly = `${message}\n\nThe sandbox CLI requires setuid root. Try installing with: make install`;
  } else if (message.match(/ENOENT|not found/i)) {
    friendly = `${message}\n\nCheck the setting sandbox.binaryPath or ensure 'sandbox' is on your PATH.`;
  }
  const action = await vscode.window.showErrorMessage(friendly, 'Open Settings');
  if (action === 'Open Settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'sandbox.binaryPath');
  }
}

export function activate(context: vscode.ExtensionContext) {
  const cwd = getWorkspaceCwd();
  const treeProvider = new SandboxTreeDataProvider(vscode.workspace.workspaceFolders?.[0]);

  // Keep VS Code contexts in sync with whether the explorer root is the overlay
  async function updateSandboxContexts() {
    const current = getWorkspaceCwd();
    let inOverlayRoot = false;
    let hasOriginal = false;
    try {
      const cfg = await fetchConfig(current);
      const overlay = cfg.overlay_cwd || cfg.upper_cwd;
      inOverlayRoot = !!overlay && !!current && overlay === current;
    } catch {
      inOverlayRoot = false;
    }
    try {
      const original = current ? await recallOriginalForOverlay(context, current) : undefined;
      hasOriginal = !!original;
    } catch {
      hasOriginal = false;
    }
    await vscode.commands.executeCommand('setContext', 'sandbox.inOverlayRoot', inOverlayRoot);
    await vscode.commands.executeCommand('setContext', 'sandbox.hasOriginal', hasOriginal);
    treeProvider.setUiContext(inOverlayRoot, hasOriginal);
    treeProvider.refresh();
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sandboxExplorer', treeProvider),
    vscode.commands.registerCommand('sandbox.refresh', () => treeProvider.refresh()),
    vscode.commands.registerCommand('sandbox.diff', async (patternsArg?: unknown) => {
      const patterns = await ensurePatterns(patternsArg);
      if (!patterns) return;

      // Attempt to open VS Code diff editors based on status JSON first
      try {
        const changes = await fetchStatus(cwd);
        const matching = filterChangesByPatterns(changes, patterns);
        if (matching.length === 0) {
          await streamTextualDiff(patterns, cwd);
          return;
        }

        // If multiple matches, present a picker (multi-select)
        let selected = matching;
        if (matching.length > 1) {
          const picks = await vscode.window.showQuickPick(
            matching.map((c) => ({
              label: labelForChange(c),
              description: c.operation,
              change: c,
            })),
            { canPickMany: true, placeHolder: 'Select file(s) to open diffs' }
          );
          if (!picks || picks.length === 0) {
            // Fallback to textual stream if user cancels/no selection
            await streamTextualDiff(patterns, cwd);
            return;
          }
          selected = picks.map((p) => p.change);
        }

        let openedAny = false;
        for (const c of selected) {
          const ok = await openDiffForChange(c);
          if (ok) openedAny = true;
        }
        if (!openedAny) {
          await streamTextualDiff(patterns, cwd);
        }
      } catch (err) {
        // On any failure, keep legacy behavior
        await streamTextualDiff(patterns, cwd);
      }
    }),
    vscode.commands.registerCommand('sandbox.accept', async (patternsArg?: unknown) => {
      const patterns = await ensurePatterns(patternsArg);
      if (!patterns) return;
      await withProgress('Accepting changes…', async () => {
        await runAccept(patterns, cwd);
      });
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('sandbox.reject', async (patternsArg?: unknown) => {
      const patterns = await ensurePatterns(patternsArg);
      if (!patterns) return;
      await withProgress('Rejecting changes…', async () => {
        await runReject(patterns, cwd);
      });
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('sandbox.sync', async () => {
      await withProgress('Syncing sandboxes…', async () => {
        await runSync(cwd);
      });
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('sandbox.stop', async () => {
      await withProgress('Stopping sandbox…', async () => {
        await runStop(cwd);
      });
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('sandbox.delete', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Delete sandbox and all associated files?',
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      await withProgress('Deleting sandbox…', async () => {
        await runDelete(cwd);
      });
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand('sandbox.showConfig', async () => {
      try {
        const cfg = await fetchConfig(cwd);
        const channel = vscode.window.createOutputChannel('Sandbox Config');
        channel.clear();
        channel.appendLine(JSON.stringify(cfg, null, 2));
        channel.show(true);
      } catch (err) {
        await handleCliError(err);
      }
    }),
    vscode.commands.registerCommand('sandbox.useOverlayInExplorer', async () => {
      try {
        const cfg = await fetchConfig(cwd);
        const overlay = cfg.overlay_cwd || cfg.upper_cwd;
        if (!overlay) throw new Error('overlay_cwd/upper_cwd not available from config');
        const originalRoot = getWorkspaceCwd() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (originalRoot) {
          await rememberOverlayMapping(context, overlay, originalRoot);
        }
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(overlay), false);
      } catch (err) {
        await handleCliError(err);
      }
      // Best-effort update (window likely reloads)
      await updateSandboxContexts();
    }),
    vscode.commands.registerCommand('sandbox.restoreWorkspaceFolder', async () => {
      const current = getWorkspaceCwd();
      if (!current) return;
      const original = await recallOriginalForOverlay(context, current);
      if (original) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(original), false);
        await forgetOverlayMapping(context, current);
      } else {
        vscode.window.showWarningMessage('No recorded original workspace for this overlay. Use "Add Overlay as Folder" or open your workspace manually.');
      }
      await updateSandboxContexts();
    }),
    vscode.commands.registerCommand('sandbox.addOverlayFolder', async () => {
      try {
        const cfg = await fetchConfig(cwd);
        const overlay = cfg.overlay_cwd || cfg.upper_cwd;
        if (!overlay) throw new Error('overlay_cwd/upper_cwd not available from config');
        await vscode.workspace.updateWorkspaceFolders(
          (vscode.workspace.workspaceFolders?.length ?? 0),
          0,
          { uri: vscode.Uri.file(overlay), name: 'Sandbox Overlay' }
        );
      } catch (err) {
        await handleCliError(err);
      }
      await updateSandboxContexts();
    }),
    vscode.commands.registerCommand('sandbox.removeOverlayFolder', async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const idx = folders.findIndex((f) => f.name === 'Sandbox Overlay');
      if (idx >= 0) {
        await vscode.workspace.updateWorkspaceFolders(idx, 1);
      }
      await updateSandboxContexts();
    })
  );

  // Optional: simple debounce refresh on file saves for better UX
  const debounced = debounce(() => treeProvider.refresh(), 350);
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => debounced()),
    vscode.workspace.onDidCreateFiles(() => debounced()),
    vscode.workspace.onDidDeleteFiles(() => debounced()),
    vscode.workspace.onDidRenameFiles(() => debounced()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateSandboxContexts())
  );

  // Status bar indicator for sandbox terminal presence
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.name = 'Sandbox';
  status.text = '$(container) Sandbox';
  status.tooltip = 'Open a terminal inside the sandbox';
  status.command = 'sandbox.enter';
  const sandboxTerminals = new Set<vscode.Terminal>();
  const isSandboxTerminal = (term: vscode.Terminal | undefined) => {
    if (!term) return false;
    if (sandboxTerminals.has(term)) return true;
    // Heuristic fallback: label includes 'sandbox'
    return (term.name || '').toLowerCase().includes('sandbox');
  };
  const refreshStatusVisibility = () => {
    const active = vscode.window.activeTerminal;
    if (isSandboxTerminal(active)) status.show(); else status.hide();
  };
  refreshStatusVisibility();
  context.subscriptions.push(status);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(() => refreshStatusVisibility()),
    vscode.window.onDidOpenTerminal((t) => {
      if ((t.name || '').toLowerCase().includes('sandbox')) sandboxTerminals.add(t);
      refreshStatusVisibility();
    }),
    vscode.window.onDidCloseTerminal((t) => {
      sandboxTerminals.delete(t);
      refreshStatusVisibility();
    })
  );
  // Track when we open a sandbox terminal from the command
  context.subscriptions.push(
    vscode.commands.registerCommand('sandbox.enter', () => {
      const t = openSandboxTerminal(getWorkspaceCwd());
      sandboxTerminals.add(t);
      refreshStatusVisibility();
    })
  );

  // Initialize contexts on activation
  updateSandboxContexts();
}

export function deactivate() {}

function debounce(fn: () => void, delayMs: number) {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(), delayMs);
  };
}

async function rememberOverlayMapping(context: vscode.ExtensionContext, overlayPath: string, originalPath: string) {
  const key = `overlayMap:${overlayPath}`;
  await context.globalState.update(key, originalPath);
}

async function recallOriginalForOverlay(context: vscode.ExtensionContext, overlayPath: string): Promise<string | undefined> {
  const key = `overlayMap:${overlayPath}`;
  return context.globalState.get<string>(key);
}

async function forgetOverlayMapping(context: vscode.ExtensionContext, overlayPath: string) {
  const key = `overlayMap:${overlayPath}`;
  await context.globalState.update(key, undefined);
}

// ---------- Diff helpers ----------

function globToRegex(glob: string): RegExp {
  // Very lightweight glob -> regex for ** and * patterns
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function filterChangesByPatterns(changes: SandboxChangeEntry[], patterns: string[]): SandboxChangeEntry[] {
  const regexes = patterns.map((p) => globToRegex(p));
  return changes.filter((c) => regexes.some((r) => r.test(c.destination)));
}

function labelForChange(c: SandboxChangeEntry): string {
  if (c.operation === 'rename' && c.source) return `${c.source} → ${c.destination}`;
  return c.destination;
}

async function streamTextualDiff(patterns: string[], cwd?: string): Promise<void> {
  const channel = vscode.window.createOutputChannel('Sandbox Diff');
  channel.clear();
  channel.show(true);
  await spawnDiffStream(
    patterns,
    {
      onStdout: (chunk) => channel.append(chunk),
      onStderr: (chunk) => channel.append(`[stderr] ${chunk}`),
      onClose: (code) => {
        if (code !== 0) channel.appendLine(`\nExited with code ${code}`);
      },
    },
    cwd
  );
}

function fileExists(p?: string | null): boolean {
  if (!p) return false;
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function createTempEmptyFile(prefix: string): vscode.Uri {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-empty-'));
  const tmpPath = path.join(tmpDir, prefix.replace(/[^a-zA-Z0-9._-]/g, '_') || 'empty');
  fs.writeFileSync(tmpPath, '');
  return vscode.Uri.file(tmpPath);
}

async function openDiffForChange(c: SandboxChangeEntry): Promise<boolean> {
  try {
    const operation = c.operation;
    let left: vscode.Uri;
    let right: vscode.Uri;

    const overlayPath = c.staged || c.tmp_path || c.destination;
    const overlayUri = vscode.Uri.file(overlayPath);
    const destExists = fileExists(c.destination);
    const srcExists = fileExists(c.source);

    if (operation === 'create') {
      // Compare empty -> overlay
      left = createTempEmptyFile(path.basename(c.destination));
      right = overlayUri;
    } else if (operation === 'remove') {
      // Compare original -> empty
      left = fileExists(c.destination) ? vscode.Uri.file(c.destination) : (srcExists ? vscode.Uri.file(c.source!) : createTempEmptyFile('empty'));
      right = createTempEmptyFile(path.basename(c.destination));
    } else if (operation === 'rename') {
      // Compare source -> overlay/destination
      left = srcExists ? vscode.Uri.file(c.source!) : (destExists ? vscode.Uri.file(c.destination) : createTempEmptyFile('empty'));
      right = overlayUri;
    } else {
      // modify or other: destination (original) -> overlay
      left = destExists ? vscode.Uri.file(c.destination) : (srcExists ? vscode.Uri.file(c.source!) : createTempEmptyFile('empty'));
      right = overlayUri;
    }

    const title = labelForChange(c);
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
    return true;
  } catch {
    return false;
  }
}
