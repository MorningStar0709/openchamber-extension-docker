// What a click starts. Each function checks its input and returns a job, or
// throws AnswerError with a sentence the panel shows as it is.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { isContainerRef } from './docker.ts';
import { AnswerError } from './inside.ts';
import { startJob } from './jobs.ts';
import type { Monitor } from './monitor.ts';
import { forgetStorage } from './storage.ts';
import type { Job, PruneKind } from '../shared/types.ts';

const MINUTE = 60_000;

export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause', 'remove'] as const;
export type ContainerAction = typeof CONTAINER_ACTIONS[number];

const PRESENT: Record<ContainerAction, string> = {
  start: 'Starting',
  stop: 'Stopping',
  restart: 'Restarting',
  pause: 'Pausing',
  unpause: 'Resuming',
  remove: 'Removing',
};

export const containerAction = (monitor: Monitor, id: string, action: ContainerAction): Job => {
  const row = monitor.container(id);
  if (!row || !isContainerRef(row.id)) throw new AnswerError(404, 'This container is gone.');
  const argv = action === 'remove' ? ['docker', 'rm', '-f', '--', row.id] : ['docker', action, '--', row.id];
  return startJob({
    kind: 'container',
    target: row.id,
    action,
    label: `${PRESENT[action]} ${row.name}`,
    steps: [{ argv }],
    timeoutMs: 3 * MINUTE,
    onDone: () => {
      void monitor.refresh();
      if (action === 'remove') forgetStorage();
    },
  });
};

export const STACK_ACTIONS = ['up', 'down', 'restart', 'stop', 'start'] as const;
export type StackAction = typeof STACK_ACTIONS[number];

export type StackRequest = {
  action: StackAction;
  project: string;
  /** Where the Compose file lives: the label on its containers, or the open project for a stack that isn't up yet. */
  workingDir: string | null;
  configFiles: string[];
};

const STACK_PRESENT: Record<StackAction, string> = {
  up: 'Starting',
  down: 'Taking down',
  restart: 'Restarting',
  stop: 'Stopping',
  start: 'Starting',
};

export const stackAction = async (monitor: Monitor, request: StackRequest): Promise<Job> => {
  const { action, project } = request;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new AnswerError(400, 'That is not a Compose project name.');
  const label = `${STACK_PRESENT[action]} ${project}`;
  const members = (await monitor.snapshot(null)).containers.filter((row) => row.compose?.project === project);
  const compose = await monitor.composeCommand();
  const done = (): void => {
    void monitor.refresh();
    forgetStorage();
  };

  if (!compose) {
    // Without Compose the containers can still be started and stopped one by one; nothing can be created or removed.
    if (action === 'up' && members.length === 0) {
      throw new AnswerError(409, 'Docker Compose is not installed, so a stack can\'t be created from its file. Install the compose plugin, then try again.');
    }
    const verb = action === 'up' ? 'start' : action === 'down' ? 'stop' : action;
    return startJob({
      kind: 'stack',
      target: project,
      action,
      label,
      steps: [{ argv: ['docker', verb, '--', ...members.map((row) => row.id)] }],
      timeoutMs: 5 * MINUTE,
      onDone: done,
    });
  }

  const workingDir = request.workingDir && isAbsolute(request.workingDir) && existsSync(request.workingDir) ? request.workingDir : null;
  const files = request.configFiles
    .map((file) => (isAbsolute(file) || !workingDir ? file : join(workingDir, file)))
    .filter((file) => isAbsolute(file) && existsSync(file));
  if (action === 'up' && files.length === 0) {
    throw new AnswerError(409, `The Compose file for ${project} is no longer where it was started from.`);
  }
  const argv = [...compose, '-p', project];
  if (workingDir) argv.push('--project-directory', workingDir);
  for (const file of files) argv.push('-f', file);
  argv.push(...(action === 'up' ? ['up', '-d'] : [action]));
  return startJob({
    kind: 'stack',
    target: project,
    action,
    label,
    steps: [{ argv, cwd: workingDir ?? undefined }],
    // `up` may pull and build.
    timeoutMs: (action === 'up' ? 20 : 5) * MINUTE,
    onDone: done,
  });
};

export const pullImage = (monitor: Monitor, ref: string): Job => {
  const clean = ref.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/.test(clean)) throw new AnswerError(400, 'That doesn\'t look like an image name, such as nginx:alpine.');
  return startJob({
    kind: 'pull',
    target: clean,
    action: 'pull',
    label: `Pulling ${clean}`,
    steps: [{ argv: ['docker', 'pull', clean] }],
    timeoutMs: 20 * MINUTE,
    onDone: () => {
      forgetStorage();
      void monitor.refresh();
    },
  });
};

const PRUNE: Record<PruneKind, { argv: string[]; label: string }> = {
  images: { argv: ['docker', 'image', 'prune', '-a', '-f'], label: 'Removing unused images' },
  'build-cache': { argv: ['docker', 'builder', 'prune', '-a', '-f'], label: 'Clearing the build cache' },
  volumes: { argv: ['docker', 'volume', 'prune', '-a', '-f'], label: 'Removing unused volumes' },
  containers: { argv: ['docker', 'container', 'prune', '-f'], label: 'Removing stopped containers' },
};

export const prune = (monitor: Monitor, kind: PruneKind): Job => startJob({
  kind: 'prune',
  target: kind,
  action: kind,
  label: PRUNE[kind].label,
  steps: [{ argv: PRUNE[kind].argv }],
  timeoutMs: 15 * MINUTE,
  onDone: () => {
    forgetStorage();
    void monitor.refresh();
  },
});

export type RemoveKind = 'image' | 'volume' | 'network';

export const removeResource = (kind: RemoveKind, ref: string, name: string): Job => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,254}$/.test(ref)) throw new AnswerError(400, 'That is not a Docker reference.');
  return startJob({
    kind: 'remove',
    target: `${kind}:${ref}`,
    action: kind,
    label: `Removing ${name}`,
    steps: [{ argv: ['docker', kind, 'rm', '--', ref] }],
    timeoutMs: 2 * MINUTE,
    onDone: forgetStorage,
  });
};

export const startEngine = (monitor: Monitor, name: string): Job => {
  const argv = monitor.startArgv;
  if (!argv) throw new AnswerError(409, `This panel can't start ${name}; start it yourself.`);
  return startJob({
    kind: 'engine',
    target: 'engine',
    action: 'start',
    label: `Starting ${name}`,
    steps: [{ argv }],
    // A VM's first boot can take minutes; stopping `colima start` halfway leaves it half up.
    timeoutMs: 10 * MINUTE,
    onDone: () => monitor.recheckEngine(),
  });
};
