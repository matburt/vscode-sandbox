import * as vscode from 'vscode';
import { fetchStatus, SandboxChangeEntry } from './cli';

export class SandboxTreeDataProvider implements vscode.TreeDataProvider<SandboxNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SandboxNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // UI context flags set from extension based on overlay state
  private inOverlayRoot: boolean = false;
  private hasOriginalWorkspace: boolean = false;

  constructor(private readonly workspaceFolder?: vscode.WorkspaceFolder) {}

  setUiContext(inOverlayRoot: boolean, hasOriginalWorkspace: boolean): void {
    this.inOverlayRoot = inOverlayRoot;
    this.hasOriginalWorkspace = hasOriginalWorkspace;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SandboxNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SandboxNode): Promise<SandboxNode[]> {
    // Root: either single-folder mode or multi-root workspace
    if (!element) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length <= 1) {
        const cwd = (this.workspaceFolder ?? folders[0])?.uri.fsPath;
        if (!cwd) return [];
        let changes: SandboxChangeEntry[] = [];
        try {
          changes = await fetchStatus(cwd);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errorNode = new SandboxNode(
            message,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            'error'
          );
          errorNode.iconPath = new vscode.ThemeIcon('error');
          return [errorNode];
        }
        const groups = groupByOperation(changes);
        const order = ['error', 'remove', 'rename', 'modify', 'create'];
        const nodes: SandboxNode[] = [];
        if (this.inOverlayRoot) {
          nodes.push(buildOverlayIndicatorNode());
        }
        nodes.push(buildActionsGroupNode(cwd, this.inOverlayRoot, this.hasOriginalWorkspace));
        for (const op of order) {
          const list = groups.get(op);
          if (!list || list.length === 0) continue;
          const label = `${op} (${list.length})`;
          const node = new SandboxNode(label, vscode.TreeItemCollapsibleState.Collapsed, undefined, op);
          node.children = buildDirectoryHierarchy(list, cwd);
          nodes.push(node);
        }
        for (const [op, list] of groups) {
          if (order.includes(op)) continue;
          const label = `${op} (${list.length})`;
          const node = new SandboxNode(label, vscode.TreeItemCollapsibleState.Collapsed, undefined, op);
          node.children = buildDirectoryHierarchy(list, cwd);
          nodes.push(node);
        }
        return nodes;
      }

      // Multi-root: create a node per workspace folder
      return folders.map((f) => {
        const n = new SandboxNode(
          f.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          f.uri.fsPath,
          'workspace'
        );
        n.iconPath = new vscode.ThemeIcon('root-folder');
        return n;
      });
    }

    // Child expansion
    if (element.op === 'workspace' && element.targetPath) {
      const cwd = element.targetPath;
      let changes: SandboxChangeEntry[] = [];
      try {
        changes = await fetchStatus(cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorNode = new SandboxNode(
          message,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'error'
        );
        errorNode.iconPath = new vscode.ThemeIcon('error');
        return [errorNode];
      }
      const groups = groupByOperation(changes);
      const order = ['error', 'remove', 'rename', 'modify', 'create'];
      const nodes: SandboxNode[] = [];
      if (this.inOverlayRoot) {
        nodes.push(buildOverlayIndicatorNode());
      }
      nodes.push(buildActionsGroupNode(cwd, this.inOverlayRoot, this.hasOriginalWorkspace));
      for (const op of order) {
        const list = groups.get(op);
        if (!list || list.length === 0) continue;
        const label = `${op} (${list.length})`;
        const node = new SandboxNode(label, vscode.TreeItemCollapsibleState.Collapsed, undefined, op);
        node.children = buildDirectoryHierarchy(list, cwd);
        nodes.push(node);
      }
      for (const [op, list] of groups) {
        if (order.includes(op)) continue;
        const label = `${op} (${list.length})`;
        const node = new SandboxNode(label, vscode.TreeItemCollapsibleState.Collapsed, undefined, op);
        node.children = buildDirectoryHierarchy(list, cwd);
        nodes.push(node);
      }
      return nodes;
    }

    return element.children ?? [];
  }
}

function nodeFromChange(c: SandboxChangeEntry): SandboxNode {
  const label = c.operation === 'rename' && c.source ? `${c.source} -> ${c.destination}` : c.destination;
  const n = new SandboxNode(label, vscode.TreeItemCollapsibleState.None, c.destination, c.operation);
  n.contextValue = 'change';
  n.resourceUri = vscode.Uri.file(c.destination);
  switch (c.operation) {
    case 'create':
      n.iconPath = new vscode.ThemeIcon('diff-added');
      break;
    case 'modify':
      n.iconPath = new vscode.ThemeIcon('diff-modified');
      break;
    case 'remove':
      n.iconPath = new vscode.ThemeIcon('diff-removed');
      break;
    case 'rename':
      n.iconPath = new vscode.ThemeIcon('diff-renamed');
      break;
    case 'error':
      n.iconPath = new vscode.ThemeIcon('error');
      break;
    default:
      n.iconPath = new vscode.ThemeIcon('question');
  }
  return n;
}

function groupByOperation(changes: SandboxChangeEntry[]): Map<string, SandboxChangeEntry[]> {
  const m = new Map<string, SandboxChangeEntry[]>();
  for (const c of changes) {
    const key = c.operation;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(c);
  }
  return m;
}

export class SandboxNode extends vscode.TreeItem {
  children?: SandboxNode[];
  targetPath?: string;
  op?: string;

  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, targetPath?: string, op?: string) {
    super(label, collapsibleState);
    this.targetPath = targetPath;
    this.op = op;
    // Mark context values to drive when-clauses for context menu
    if (op === 'folder') {
      this.contextValue = 'folder';
    } else if (op === 'actions' || op === 'action' || op === 'workspace') {
      this.contextValue = op;
    } else {
      this.contextValue = 'change';
    }
    if (!collapsibleState || collapsibleState === vscode.TreeItemCollapsibleState.None) {
      this.command = {
        title: 'Diff',
        command: 'sandbox.diff',
        arguments: [targetPath ? [targetPath] : []]
      };
    }
  }
}

function buildDirectoryHierarchy(changes: SandboxChangeEntry[], cwd?: string): SandboxNode[] {
  const root: Map<string, any> = new Map();
  for (const c of changes) {
    // Strip workspace root prefix if provided for a cleaner tree
    const path = cwd && c.destination.startsWith(cwd + '/')
      ? c.destination.substring(cwd.length + 1)
      : c.destination;
    const parts = path.split('/').filter((p) => p.length > 0);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!cursor.has(part)) {
        cursor.set(part, new Map());
      }
      if (i === parts.length - 1) {
        cursor.set(part, c);
      } else {
        const next = cursor.get(part);
        if (next instanceof Map) {
          cursor = next;
        } else {
          const m = new Map();
          cursor.set(part, m);
          cursor = m;
        }
      }
    }
  }

  const toNodes = (tree: Map<string, any>, prefix: string = ''): SandboxNode[] => {
    const entries = Array.from(tree.entries());
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const nodes: SandboxNode[] = [];
    for (const [name, value] of entries) {
      if (value instanceof Map) {
        const folderPath = prefix ? `${prefix}/${name}` : name;
        const node = new SandboxNode(name, vscode.TreeItemCollapsibleState.Collapsed, folderPath, 'folder');
        node.iconPath = new vscode.ThemeIcon('folder');
        node.command = {
          title: 'Diff',
          command: 'sandbox.diff',
          arguments: [[`${folderPath}/**`]],
        };
        node.children = toNodes(value, folderPath);
        nodes.push(node);
      } else {
        nodes.push(nodeFromChange(value as SandboxChangeEntry));
      }
    }
    return nodes;
  };

  return toNodes(root);
}

function buildActionsGroupNode(cwd: string, inOverlayRoot: boolean, hasOriginalWorkspace: boolean): SandboxNode {
  const group = new SandboxNode('Actions', vscode.TreeItemCollapsibleState.Expanded, undefined, 'actions');
  group.iconPath = new vscode.ThemeIcon('tools');

  const makeAction = (label: string, command: string, icon: string, args: any[] = []) => {
    const n = new SandboxNode(label, vscode.TreeItemCollapsibleState.None, undefined, 'action');
    n.iconPath = new vscode.ThemeIcon(icon);
    n.command = { title: label, command, arguments: args };
    return n;
  };

  if (inOverlayRoot) {
    const children: SandboxNode[] = [
      makeAction('Enter Sandbox', 'sandbox.enter', 'terminal', []),
    ];
    if (hasOriginalWorkspace) {
      children.push(makeAction('Restore Workspace Folder', 'sandbox.restoreWorkspaceFolder', 'folder', []));
    }
    group.children = children;
    return group;
  }

  group.children = [
    makeAction('Enter Sandbox', 'sandbox.enter', 'terminal', []),
    makeAction('Refresh', 'sandbox.refresh', 'refresh', []),
    makeAction('Sync', 'sandbox.sync', 'sync', []),
    makeAction('Stop', 'sandbox.stop', 'debug-stop', []),
    makeAction('Delete', 'sandbox.delete', 'trash', []),
    makeAction('Add Overlay as Folder', 'sandbox.addOverlayFolder', 'new-folder', []),
    makeAction('Remove Overlay Folder', 'sandbox.removeOverlayFolder', 'folder', []),
    makeAction('Use Overlay in Explorer', 'sandbox.useOverlayInExplorer', 'folder-opened', []),
    makeAction('Restore Workspace Folder', 'sandbox.restoreWorkspaceFolder', 'folder', []),
    makeAction('Show Config', 'sandbox.showConfig', 'gear', []),
  ];
  return group;
}

function buildOverlayIndicatorNode(): SandboxNode {
  const indicator = new SandboxNode('Overlay active', vscode.TreeItemCollapsibleState.None, undefined, 'info');
  indicator.iconPath = new vscode.ThemeIcon('layers-active');
  indicator.tooltip = 'You are viewing the sandbox overlay. Use "Restore Workspace Folder" to return to your original workspace.';
  indicator.accessibilityInformation = { label: 'Overlay active', role: 'text' };
  return indicator;
}
