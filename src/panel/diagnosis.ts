// One line under a crashed or unhealthy container saying why, read from its
// last log lines by the user's Small Model. Each crash is read once and the
// answer is kept, so reopening the panel doesn't ask again.
import { HostRequestError, type HostClient, type LateGenerateResult } from '@openchamber/sdk';

import { getJson } from '../shared/client.ts';
import { isCrashed, stateLine } from '../shared/stacks.ts';
import type { Container, LogsAnswer } from '../shared/types.ts';

export type Diagnosis = { state: 'pending' } | { state: 'done'; text: string };

const STORAGE_KEY = 'diagnoses';
const KEEP = 40;
/** Enough to look at what's on screen; a crash loop elsewhere shouldn't spend the user's model. */
const PER_SESSION = 8;
const LOG_LINES = 120;

const SYSTEM = `You read the end of a Docker container's logs and say why the container stopped or is unhealthy.
Answer in one or two short sentences, naming the concrete cause: a missing environment variable, a port already in use, a host it can't reach, a file that isn't there, a crash at file:line. Name the thing to fix when the logs show it.
No preamble, no lists, no markdown. If the logs don't show a cause, say what the last error was.`;

const KEY_LINE = 'Key: ';

/** One crash: the container and when it ended (or started being unhealthy). */
const keyOf = (row: Container): string => `${row.id.slice(0, 12)}:${row.finishedAt ?? row.startedAt ?? row.createdAt}`;

export const wantsDiagnosis = (row: Container): boolean => isCrashed(row) || (row.state === 'running' && row.health === 'unhealthy');

type Stored = Record<string, { text: string; at: number }>;

export class Diagnoses {
  private done: Stored = {};
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private queue: Container[] = [];
  private busy = false;
  private asked = 0;
  /** No Small Model, or the user didn't allow it: stay quiet. */
  private off = false;
  private loaded = false;

  constructor(private readonly host: HostClient, private readonly onChange: () => void) {}

  async load(): Promise<void> {
    try {
      const stored = await this.host.storage.get(STORAGE_KEY);
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) this.done = stored as Stored;
    } catch {
      // Unreadable: diagnoses start over.
    }
    this.loaded = true;
    this.onChange();
  }

  /** Answers that came after the panel that asked was closed. */
  acceptLate(late: LateGenerateResult): void {
    const key = late.request.prompt.split('\n', 1)[0]?.startsWith(KEY_LINE) ? late.request.prompt.split('\n', 1)[0]!.slice(KEY_LINE.length) : null;
    if (!key || !late.ok) return;
    this.store(key, late.result.text);
  }

  get(row: Container): Diagnosis | null {
    const key = keyOf(row);
    const entry = this.done[key];
    if (entry) return { state: 'done', text: entry.text };
    return this.pending.has(key) ? { state: 'pending' } : null;
  }

  /** Queues the containers on screen that need one. */
  consider(rows: Container[]): void {
    if (this.off || !this.loaded) return;
    let added = false;
    for (const row of rows) {
      const key = keyOf(row);
      if (!wantsDiagnosis(row) || this.done[key] || this.pending.has(key) || this.failed.has(key)) continue;
      if (this.asked + this.queue.length >= PER_SESSION) break;
      this.pending.add(key);
      this.queue.push(row);
      added = true;
    }
    if (!added) return;
    // Show "Reading the logs…" under the rows that just queued.
    this.onChange();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let row = this.queue.shift();
      while (row && !this.off) {
        await this.ask(row);
        row = this.queue.shift();
      }
    } finally {
      this.busy = false;
    }
  }

  private async ask(row: Container): Promise<void> {
    const key = keyOf(row);
    this.asked += 1;
    try {
      const logs = await getJson<LogsAnswer>(this.host, `/containers/${row.id}/logs`, { tail: String(LOG_LINES) });
      const text = logs.entries.map((entry) => entry.m).join('\n').slice(-12_000);
      if (!text.trim()) {
        this.failed.add(key);
        return;
      }
      const prompt = [
        `${KEY_LINE}${key}`,
        `Container: ${row.name}`,
        `Image: ${row.image}`,
        `State: ${stateLine(row)}${row.oomKilled ? ', killed for running out of memory' : ''}${row.health === 'unhealthy' ? ', health check failing' : ''}`,
        '',
        'Last log lines:',
        text,
      ].join('\n');
      const answer = await this.host.generate({ system: SYSTEM, prompt, maxOutputTokens: 160 });
      this.store(key, answer.text);
    } catch (error) {
      if (error instanceof HostRequestError && ['NO_MODEL', 'NOT_GRANTED', 'UNSUPPORTED', 'DISABLED'].includes(error.code)) this.off = true;
      this.failed.add(key);
    } finally {
      this.pending.delete(key);
      this.onChange();
    }
  }

  private store(key: string, raw: string): void {
    const text = raw.trim().replace(/^["']|["']$/g, '');
    if (!text) return;
    this.done[key] = { text, at: Date.now() };
    const entries = Object.entries(this.done).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP);
    this.done = Object.fromEntries(entries);
    void this.host.storage.set(STORAGE_KEY, this.done).catch(() => undefined);
    this.onChange();
  }
}
