// Reading a container: logs, inspect, its files, and one-off shell commands.
import { CommandError, docker, dockerBytes } from './docker.ts';
import { CWD_MARK, inspectDetails, mergeLogs, parseLogText, splitExecOutput } from './parse.ts';
import type { ExecAnswer, FsEntry, FsFile, FsListing, InspectAnswer, LogsAnswer } from '../shared/types.ts';

export class AnswerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const LOG_TAIL_MAX = 5_000;
const LOG_BYTES_MAX = 6 * 1024 * 1024;
const FS_LIST_MAX = 1_000;
const FS_FILE_MAX = 512 * 1024;
const EXEC_OUTPUT_MAX = 256 * 1024;

const noShell = (error: unknown): boolean => error instanceof CommandError
  && /executable file not found|no such file or directory.*sh|OCI runtime exec failed/i.test(error.stderr);

const NO_SHELL = 'This image has no shell (sh), so its files and commands can\'t be reached from here.';

export const readLogs = async (id: string, tail: number, since: string | null): Promise<LogsAnswer> => {
  const lines = Math.min(Math.max(Math.trunc(tail) || 500, 1), LOG_TAIL_MAX);
  const args = ['logs', '--timestamps', '--tail', String(lines)];
  if (since) args.push('--since', since);
  args.push('--', id);
  try {
    const { stdout, stderr } = await docker(args, { timeout: 15_000, maxBuffer: LOG_BYTES_MAX * 2 });
    let entries = mergeLogs(parseLogText(stdout, 'out'), parseLogText(stderr, 'err'));
    // `--since` includes its own second's boundary; the panel already has those lines.
    if (since) entries = entries.filter((entry) => entry.t > since);
    let truncated = false;
    let size = entries.reduce((sum, entry) => sum + entry.m.length + 40, 0);
    while (size > LOG_BYTES_MAX && entries.length > 0) {
      size -= (entries.shift()?.m.length ?? 0) + 40;
      truncated = true;
    }
    return { entries, truncated };
  } catch (error) {
    if (error instanceof CommandError && /No such container/i.test(error.stderr)) throw new AnswerError(404, 'This container is gone.');
    // Some log drivers (none, syslog) keep nothing to read.
    if (error instanceof CommandError && /does not support reading|configured logging driver/i.test(error.stderr)) {
      throw new AnswerError(409, 'This container\'s logging driver keeps no logs Docker can read back.');
    }
    throw error;
  }
};

export const inspect = async (id: string): Promise<InspectAnswer> => {
  try {
    const { stdout } = await docker(['inspect', '--type', 'container', '--', id]);
    const raw = (JSON.parse(stdout) as Record<string, unknown>[])[0];
    if (!raw) throw new AnswerError(404, 'This container is gone.');
    return { ...inspectDetails(raw), raw };
  } catch (error) {
    if (error instanceof CommandError && /No such/i.test(error.stderr)) throw new AnswerError(404, 'This container is gone.');
    throw error;
  }
};

/** Absolute container paths only, without `..`. */
export const normalizeContainerPath = (raw: string): string | null => {
  const value = raw.trim() || '/';
  if (!value.startsWith('/') || value.includes('\0')) return null;
  const parts: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    parts.push(segment);
  }
  return `/${parts.join('/')}`;
};

// `find` shows dotfiles on every image; plain `ls -A` is the fallback for images without it.
const LIST_SCRIPT = `
p="$1"; max="$2"
if [ ! -e "$p" ]; then echo "__OC_MISSING__"; exit 0; fi
if [ ! -d "$p" ]; then echo "__OC_NOT_DIR__"; exit 0; fi
entries() {
  if command -v find >/dev/null 2>&1; then find "$p" -mindepth 1 -maxdepth 1 2>/dev/null
  else ls -A "$p" 2>/dev/null | while IFS= read -r n; do if [ "$p" = "/" ]; then echo "/$n"; else echo "$p/$n"; fi; done; fi
}
n=0
entries | while IFS= read -r c; do
  n=$((n + 1)); if [ "$n" -gt "$max" ]; then echo "__OC_TRUNC__"; break; fi
  name="\${c##*/}"
  if [ -L "$c" ]; then printf 'link\\t%s\\n' "$name"
  elif [ -d "$c" ]; then printf 'dir\\t%s\\n' "$name"
  elif [ -f "$c" ]; then printf 'file\\t%s\\n' "$name"
  else printf 'other\\t%s\\n' "$name"; fi
done`;

export const listDir = async (id: string, path: string): Promise<FsListing> => {
  let stdout: string;
  try {
    ({ stdout } = await docker(['exec', '--', id, 'sh', '-c', LIST_SCRIPT, 'sh', path, String(FS_LIST_MAX)], { timeout: 12_000 }));
  } catch (error) {
    if (noShell(error)) throw new AnswerError(409, NO_SHELL);
    throw error;
  }
  const lines = stdout.replace(/\r/g, '').split('\n').filter(Boolean);
  if (lines[0] === '__OC_MISSING__') throw new AnswerError(404, 'Nothing at this path.');
  if (lines[0] === '__OC_NOT_DIR__') throw new AnswerError(409, 'Not a folder.');
  const entries: FsEntry[] = lines.flatMap((line) => {
    const tab = line.indexOf('\t');
    if (tab <= 0) return [];
    const kind = line.slice(0, tab);
    const name = line.slice(tab + 1);
    if (!name || name === '.' || name === '..') return [];
    const type: FsEntry['type'] = kind === 'dir' || kind === 'file' || kind === 'link' ? kind : 'other';
    return [{ name, type }];
  });
  entries.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
  return { path, entries, truncated: lines.includes('__OC_TRUNC__') };
};

const READ_SCRIPT = `
p="$1"
if [ -d "$p" ]; then printf '%s' "__OC_DIR__"; exit 0; fi
if [ ! -f "$p" ]; then printf '%s' "__OC_MISSING__"; exit 0; fi
head -c "$2" "$p" 2>/dev/null`;

export const readFile = async (id: string, path: string): Promise<FsFile> => {
  let buffer: Buffer;
  try {
    buffer = await dockerBytes(['exec', '--', id, 'sh', '-c', READ_SCRIPT, 'sh', path, String(FS_FILE_MAX + 1)], {
      timeout: 12_000,
      maxBuffer: FS_FILE_MAX + 64 * 1024,
    });
  } catch (error) {
    if (noShell(error)) throw new AnswerError(409, NO_SHELL);
    throw error;
  }
  const head = buffer.subarray(0, 16).toString('utf8');
  if (head === '__OC_MISSING__') throw new AnswerError(404, 'Nothing at this path.');
  if (head === '__OC_DIR__') throw new AnswerError(409, 'This is a folder.');
  const truncated = buffer.length > FS_FILE_MAX;
  const body = buffer.subarray(0, FS_FILE_MAX);
  const binary = body.includes(0);
  return { path, binary, truncated, size: body.length, content: binary ? null : body.toString('utf8') };
};

// The command runs through eval in the folder the previous one left, and the
// folder it ends in comes back after a marker, so `cd` carries over.
const EXEC_SCRIPT = `cd -- "$1" 2>/dev/null || cd /
eval "$2" 2>&1
s=$?
printf '\\n${CWD_MARK}%s\\n' "$(pwd)"
exit $s`;

export const execCommand = async (id: string, command: string, cwd: string): Promise<ExecAnswer> => {
  const args = ['exec', '--', id, 'sh', '-c', EXEC_SCRIPT, 'sh', cwd, command];
  let stdout = '';
  let exitCode = 0;
  try {
    ({ stdout } = await docker(args, { timeout: 18_000, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    if (/is not running|is paused/i.test(error.stderr)) throw new AnswerError(409, 'Start the container to run commands in it.');
    if (noShell(error) && !error.stdout.includes(CWD_MARK)) throw new AnswerError(409, NO_SHELL);
    if (/took too long/.test(error.message)) throw new AnswerError(408, 'The command ran longer than 18 seconds and was stopped. Long-running commands belong in a terminal.');
    stdout = error.stdout;
    exitCode = error.exitCode ?? 1;
    if (!stdout) return { output: error.message, exitCode, cwd, truncated: false };
  }
  const split = splitExecOutput(stdout);
  const truncated = split.output.length > EXEC_OUTPUT_MAX;
  return {
    output: truncated ? split.output.slice(-EXEC_OUTPUT_MAX) : split.output,
    exitCode,
    cwd: split.cwd ?? cwd,
    truncated,
  };
};
