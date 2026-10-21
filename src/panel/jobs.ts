// What a toast says when a slow job of this panel ends well. Quick container
// actions say nothing: the row already shows the new state.
import { reclaimedBytes } from '../service/parse.ts';
import { formatDisk } from '../shared/format.ts';
import type { Job } from '../shared/types.ts';

const STACK_DONE: Record<string, (name: string) => string> = {
  up: (name) => `${name} is up`,
  start: (name) => `${name} is up`,
  down: (name) => `${name} is down`,
  stop: (name) => `Stopped ${name}`,
  restart: (name) => `Restarted ${name}`,
};

export const doneMessage = (job: Job): string | null => {
  switch (job.kind) {
    case 'pull':
      return `Pulled ${job.target}`;
    case 'prune': {
      const freed = reclaimedBytes(job.output);
      return freed && freed > 0 ? `Freed ${formatDisk(freed)}` : 'Nothing needed cleaning';
    }
    case 'stack':
      return STACK_DONE[job.action]?.(job.target) ?? null;
    case 'engine':
      return `${job.label.replace(/^Starting /, '')} started`;
    default:
      return null;
  }
};
