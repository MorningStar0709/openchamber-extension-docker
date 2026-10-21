// The one place that starts processes. Everything goes through execFile or
// spawn with an argument list: no shell, so a container name can't become a
// command.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

// The app copies its own PATH to the service. A desktop app started from the
// Dock may have only the system folders on it, so add where Docker, Colima
// and OrbStack install their binaries.
const EXTRA_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.orbstack', 'bin'),
  join(homedir(), '.rd', 'bin'),
  '/Applications/Docker.app/Contents/Resources/bin',
];
const currentPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
process.env.PATH = [...currentPath, ...EXTRA_PATH.filter((dir) => !currentPath.includes(dir) && existsSync(dir))].join(delimiter);

export const hasBinary = (name: string): boolean => (process.env.PATH ?? '')
  .split(delimiter)
  .some((dir) => existsSync(join(dir, name)) || existsSync(join(dir, `${name}.exe`)));

export class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
    readonly missing: boolean,
  ) {
    super(message);
  }
}

type RunOptions = { timeout?: number; maxBuffer?: number; cwd?: string };

export type RunResult = { stdout: string; stderr: string };

/** First meaningful line of what docker said, without its "Error response from daemon:" preface. */
export const errorLine = (stderr: string, fallback: string): string => {
  const line = stderr.split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  return line.replace(/^Error( response from daemon)?:\s*/i, '') || fallback;
};

export const run = (command: string, args: string[], options: RunOptions = {}): Promise<RunResult> => new Promise((resolve, reject) => {
  execFile(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 15_000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    cwd: options.cwd,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (!error) {
      resolve({ stdout, stderr });
      return;
    }
    const code = (error as NodeJS.ErrnoException).code;
    const missing = code === 'ENOENT';
    const exitCode = typeof code === 'number' ? code : null;
    const message = missing
      ? `${command} is not installed`
      : error.killed
        ? `${command} ${args[0] ?? ''} took too long`
        : errorLine(stderr, error.message);
    reject(new CommandError(message, stdout ?? '', stderr ?? '', exitCode, missing));
  });
});

export const docker = (args: string[], options?: RunOptions): Promise<RunResult> => run('docker', args, options);

/** Same as `docker`, with stdout as bytes: file contents may be binary. */
export const dockerBytes = (args: string[], options: RunOptions = {}): Promise<Buffer> => new Promise((resolve, reject) => {
  execFile('docker', args, {
    encoding: 'buffer',
    timeout: options.timeout ?? 15_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error) reject(new CommandError(errorLine(stderr.toString('utf8'), error.message), '', stderr.toString('utf8'), null, false));
    else resolve(stdout);
  });
});

/** A long-running command whose output arrives line by line (`docker events`, `docker stats`). */
export const streamLines = (
  args: string[],
  onLine: (line: string) => void,
  onExit: (code: number | null) => void,
): ChildProcess => {
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
    // A redraw without a newline would grow forever.
    if (buffer.length > 1024 * 1024) buffer = '';
  });
  child.on('error', () => onExit(null));
  child.on('exit', (code) => onExit(code));
  return child;
};

/** Container ids and names only: hex ids, or names docker itself would accept. Keeps flags out of argument lists. */
export const isContainerRef = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(value);
