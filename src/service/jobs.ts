// Every change runs as a job. The host gives a service request 20 seconds,
// and `compose up`, a pull, a prune or starting Colima take longer, so the
// request only starts the job and the panel watches it in the snapshot.
import { spawn } from 'node:child_process';

import type { Job, JobKind } from '../shared/types.ts';

const OUTPUT_KEEP = 16_000;
/** Finished jobs stay in the snapshot this long, so every open frame sees how they ended. */
const FINISHED_KEEP_MS = 120_000;

export type JobSpec = {
  kind: JobKind;
  target: string;
  action: string;
  label: string;
  /** One or more commands, run in order; the first failure ends the job. */
  steps: { argv: string[]; cwd?: string }[];
  timeoutMs: number;
  onDone?: (job: Job) => void;
};

let counter = 0;
const jobs: Job[] = [];

const prune = (now: number): void => {
  for (let i = jobs.length - 1; i >= 0; i -= 1) {
    const job = jobs[i];
    if (job && job.endedAt !== null && now - job.endedAt > FINISHED_KEEP_MS) jobs.splice(i, 1);
  }
};

export const listJobs = (): Job[] => {
  prune(Date.now());
  return jobs.map((job) => ({ ...job }));
};

/** The running job on that target, so a second click doesn't start the same thing twice. */
export const runningJob = (kind: JobKind, target: string): Job | undefined => jobs.find((job) => job.kind === kind && job.target === target && job.state === 'running');

const runStep = (argv: string[], cwd: string | undefined, timeoutMs: number, append: (text: string) => void): Promise<number | null> => new Promise((resolve) => {
  const [command, ...args] = argv;
  if (!command) {
    resolve(1);
    return;
  }
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const timer = setTimeout(() => {
    append(`\n${command} took longer than ${Math.round(timeoutMs / 60_000)} min and was stopped.`);
    child.kill('SIGTERM');
  }, timeoutMs);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (error: NodeJS.ErrnoException) => {
    append(error.code === 'ENOENT' ? `${command} is not installed.` : error.message);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});

export const startJob = (spec: JobSpec): Job => {
  const existing = runningJob(spec.kind, spec.target);
  if (existing) return existing;
  counter += 1;
  const job: Job = {
    id: `job-${counter}`,
    kind: spec.kind,
    target: spec.target,
    action: spec.action,
    label: spec.label,
    state: 'running',
    startedAt: Date.now(),
    endedAt: null,
    output: '',
  };
  jobs.push(job);
  const append = (text: string): void => {
    // Progress bars redraw with carriage returns; keep only the last state of each line.
    job.output = (job.output + text.replace(/\r(?!\n)/g, '\n')).slice(-OUTPUT_KEEP);
  };
  void (async () => {
    let ok = true;
    for (const step of spec.steps) {
      const code = await runStep(step.argv, step.cwd, spec.timeoutMs, append);
      if (code !== 0) {
        ok = false;
        break;
      }
    }
    job.state = ok ? 'done' : 'failed';
    job.endedAt = Date.now();
    job.output = job.output.trim();
    spec.onDone?.(job);
  })();
  return job;
};
