// How containers are grouped and described, the same in every frame.
import { ago, since } from './format.ts';
import type { Container, PortBinding, ProjectInfo } from './types.ts';

export type Stack = {
  project: string;
  workingDir: string | null;
  configFiles: string[];
  containers: Container[];
  running: number;
  /** The stack's files live in the open project. */
  isProject: boolean;
};

export type Groups = {
  /** Stacks of the open project; one with no containers when its Compose file isn't up yet. */
  project: Stack[];
  stacks: Stack[];
  standalone: Container[];
};

const inside = (path: string, directory: string): boolean => path === directory || path.startsWith(`${directory.replace(/\/+$/, '')}/`);

const isProjectStack = (stack: Stack, project: ProjectInfo | null): boolean => {
  if (!project) return false;
  if (stack.workingDir) return inside(stack.workingDir, project.directory);
  return stack.project === project.name;
};

const byName = (a: Container, b: Container): number => label(a).localeCompare(label(b));

export const groupContainers = (containers: Container[], project: ProjectInfo | null): Groups => {
  const stacks = new Map<string, Stack>();
  const standalone: Container[] = [];
  for (const row of containers) {
    if (!row.compose) {
      standalone.push(row);
      continue;
    }
    let stack = stacks.get(row.compose.project);
    if (!stack) {
      stack = {
        project: row.compose.project,
        workingDir: row.compose.workingDir,
        configFiles: row.compose.configFiles,
        containers: [],
        running: 0,
        isProject: false,
      };
      stacks.set(row.compose.project, stack);
    }
    stack.containers.push(row);
    if (row.state === 'running') stack.running += 1;
  }
  const all = [...stacks.values()];
  for (const stack of all) {
    stack.containers.sort(byName);
    stack.isProject = isProjectStack(stack, project);
  }
  const mine = all.filter((stack) => stack.isProject);
  if (mine.length === 0 && project?.composeFile) {
    mine.push({
      project: project.name,
      workingDir: project.directory,
      configFiles: [`${project.directory.replace(/\/+$/, '')}/${project.composeFile}`],
      containers: [],
      running: 0,
      isProject: true,
    });
  }
  return {
    project: mine,
    stacks: all.filter((stack) => !stack.isProject).sort((a, b) => b.running - a.running || a.project.localeCompare(b.project)),
    standalone: standalone.sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || byName(a, b)),
  };
};

/** A project stack with no containers: its file, not running, and how it would start. */
export const notUpLine = (stack: Stack, compose: boolean): string => {
  const file = stack.configFiles[0]?.split('/').pop() || 'compose file';
  return compose ? `${file} · not running` : `${file} · not running · install Docker Compose to start it`;
};

/** The Compose service name inside a stack, the container name elsewhere. */
export const label = (row: Container): string => row.compose?.service || row.name;

/** Exit codes a stop leaves behind: SIGINT, SIGKILL, SIGTERM. */
const STOP_CODES = new Set([0, 130, 137, 143]);

/** It ended on its own: a non-zero exit that isn't a stop signal, or out of memory. */
export const isCrashed = (row: Container): boolean => (row.state === 'exited' || row.state === 'dead')
  && (row.oomKilled || (row.exitCode !== null && !STOP_CODES.has(row.exitCode)));

export const needsAttention = (row: Container): boolean => isCrashed(row) || row.state === 'restarting' || row.health === 'unhealthy';

export type Tone = 'ok' | 'warn' | 'bad' | 'off';

export const toneOf = (row: Container): Tone => {
  if (needsAttention(row)) return 'bad';
  if (row.state === 'running') return row.health === 'starting' ? 'warn' : 'ok';
  if (row.state === 'paused') return 'warn';
  return 'off';
};

/** "up 2 h", "exited (1) 2 min ago", "restarting · 4 restarts". */
export const stateLine = (row: Container, now = Date.now()): string => {
  switch (row.state) {
    case 'running': {
      const up = since(row.startedAt, now);
      if (up === 'seconds') return 'just started';
      return up ? `up ${up}` : 'running';
    }
    case 'restarting':
      return row.restartCount > 0 ? `restarting · ${row.restartCount} restarts` : 'restarting';
    case 'paused':
      return 'paused';
    case 'created':
      return 'created, never started';
    case 'removing':
      return 'being removed';
    default: {
      const when = ago(row.finishedAt, now);
      const code = row.oomKilled ? 'out of memory' : `exited (${row.exitCode ?? '?'})`;
      return when ? `${code} ${when}` : code;
    }
  }
};

export const portUrl = (port: PortBinding): string => {
  const wildcard = port.hostIp === '0.0.0.0' || port.hostIp === '::' || port.hostIp === '';
  const hostName = wildcard ? 'localhost' : port.hostIp.includes(':') ? `[${port.hostIp}]` : port.hostIp;
  return `http://${hostName}:${port.hostPort}`;
};

export const isWebPort = (port: PortBinding): boolean => port.protocol === 'tcp';

export const isUp = (row: Container): boolean => row.state === 'running' || row.state === 'restarting' || row.state === 'paused';
