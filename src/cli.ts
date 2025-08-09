import * as cp from 'child_process';
import * as vscode from 'vscode';

export interface SandboxConfigInfo {
  name?: string;
  storage_dir?: string;
  upper_cwd?: string;
  overlay_cwd?: string;
}

export interface SandboxChangeEntry {
  destination: string;
  operation: 'create' | 'modify' | 'remove' | 'rename' | 'error' | string;
  source?: string | null;
  staged?: string | null;
  tmp_path?: string | null;
  error?: string;
}

export interface SandboxStatusJson {
  status?: string;
  changes?: SandboxChangeEntry[];
  [k: string]: unknown;
}

function buildBaseArgs(): string[] {
  const cfg = vscode.workspace.getConfiguration('sandbox');
  const args: string[] = [];
  const name = cfg.get<string>('name');
  const net = cfg.get<string>('net');
  const noDefaultBinds = cfg.get<boolean>('noDefaultBinds');
  const binds = cfg.get<string[]>('bind') ?? [];
  const masks = cfg.get<string[]>('mask') ?? [];
  const ignored = cfg.get<boolean>('ignored');
  if (name && name.trim().length > 0) {
    args.push('--name', name);
  }
  if (net === 'host') {
    args.push('--net=host');
  }
  if (noDefaultBinds) {
    args.push('--no-default-binds');
  }
  for (const b of binds) {
    if (b && b.trim()) {
      args.push('--bind', b);
    }
  }
  for (const m of masks) {
    if (m && m.trim()) {
      args.push('--mask', m);
    }
  }
  if (ignored) {
    args.push('--ignored');
  }
  return args;
}

async function execFile(bin: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }>{
  return new Promise((resolve) => {
    const child = cp.spawn(bin, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export async function getBinaryPath(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('sandbox');
  const bin = cfg.get<string>('binaryPath') || 'sandbox';
  return bin;
}

export async function fetchConfig(cwd?: string): Promise<SandboxConfigInfo> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'config', '--json', 'name', 'storage_dir', 'upper_cwd', 'overlay_cwd'];
  const res = await execFile(bin, args, cwd);
  try {
    const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
    return {
      name: parsed['name'] as string | undefined,
      storage_dir: parsed['storage_dir'] as string | undefined,
      upper_cwd: parsed['upper_cwd'] as string | undefined,
      overlay_cwd: parsed['overlay_cwd'] as string | undefined,
    };
  } catch (e) {
    throw new Error(`Failed to parse sandbox config JSON: ${res.stderr || res.stdout}`);
  }
}

export async function fetchStatus(cwd?: string): Promise<SandboxChangeEntry[]> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'status', '--json'];
  const res = await execFile(bin, args, cwd);
  try {
    const parsed = JSON.parse(res.stdout) as SandboxStatusJson;
    return parsed.changes ?? [];
  } catch (e) {
    throw new Error(`Failed to parse sandbox status JSON: ${res.stderr || res.stdout}`);
  }
}

export async function runAccept(patterns: string[], cwd?: string): Promise<void> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'accept', ...patterns];
  const res = await execFile(bin, args, cwd);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
}

export async function runReject(patterns: string[], cwd?: string): Promise<void> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'reject', ...patterns];
  const res = await execFile(bin, args, cwd);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
}

export async function runDiff(patterns: string[], cwd?: string): Promise<string> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'diff', ...patterns];
  const res = await execFile(bin, args, cwd);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
  return res.stdout;
}

export async function spawnDiffStream(
  patterns: string[],
  handlers: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    onClose?: (code: number) => void;
  },
  cwd?: string
): Promise<void> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'diff', ...patterns];
  const child = cp.spawn(bin, args, { cwd, env: process.env });
  child.stdout.on('data', (d) => handlers.onStdout?.(d.toString()));
  child.stderr.on('data', (d) => handlers.onStderr?.(d.toString()));
  child.on('close', (code) => handlers.onClose?.(code ?? 0));
}

export async function runSync(cwd?: string): Promise<void> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'sync'];
  const res = await execFile(bin, args, cwd);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
}

export async function runStop(cwd?: string): Promise<void> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'stop'];
  const res = await execFile(bin, args, cwd);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
}

export async function runDelete(cwd?: string): Promise<void> {
  const bin = await getBinaryPath();
  const args = [...buildBaseArgs(), 'delete', '-y'];
  const res = await execFile(bin, args, cwd);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
}

export function openSandboxTerminal(cwd?: string): vscode.Terminal {
  const cfg = vscode.workspace.getConfiguration('sandbox');
  const bin = cfg.get<string>('binaryPath') || 'sandbox';
  const args = buildBaseArgs();
  const shell = process.env.SHELL || 'sh';
  const fullCmd = [bin, ...args, shell].join(' ');
  const term = vscode.window.createTerminal({ name: 'Sandbox', cwd });
  term.show();
  term.sendText(fullCmd, true);
  return term;
}
