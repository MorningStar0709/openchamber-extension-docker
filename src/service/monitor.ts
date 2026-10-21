// Keeps what the frames ask for current without polling Docker: one
// `docker events` process says when containers change, one `docker stats`
// process streams CPU and memory. Both run only while someone asks: events
// while any frame polls (a hidden panel still asks for incidents), stats
// while a visible frame does. With nobody asking, everything stops.
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { docker, streamLines } from './docker.ts';
import { detectCompose, probeEngine } from './engine.ts';
import { IncidentTracker, readEvent } from './incidents.ts';
import { listJobs } from './jobs.ts';
import { COMPOSE_FILES, composeProjectName, containerFromInspect, parseStatsLine, type StatsSample } from './parse.ts';
import type { Container, Engine, ProjectInfo, Snapshot } from '../shared/types.ts';

const IDLE_MS = 90_000;
const STATS_IDLE_MS = 20_000;
/** Events can be missed across a daemon restart; a slow full read covers that. */
const SAFETY_REFRESH_MS = 20_000;
/** While the daemon is down, ask again at most this often. */
const ENGINE_RECHECK_MS = 4_000;
const COMPOSE_RECHECK_MS = 60_000;
const INSPECT_BATCH = 50;

type Json = Record<string, unknown>;

export class Monitor {
  private engine: Omit<Engine, 'starting'> | null = null;
  private engineCheckedAt = 0;
  private engineProbe: Promise<void> | null = null;
  startArgv: string[] | null = null;

  private compose: string[] | null = null;
  private composeCheckedAt = 0;

  private containers = new Map<string, Container>();
  private stats = new Map<string, StatsSample>();
  private refreshedAt = 0;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private events: ChildProcess | null = null;
  private statsProcess: ChildProcess | null = null;
  private lastRequestAt = 0;
  private lastStatsRequestAt = 0;

  readonly incidents = new IncidentTracker();

  constructor() {
    setInterval(() => this.idleCheck(), 5_000).unref();
  }

  /**
   * Every request calls this: keeps the watchers alive and the engine state
   * fresh. A light touch (a hidden panel asking for crashes) reads nothing
   * Docker hasn't already told us.
   */
  async touch(wantStats: boolean, light = false): Promise<void> {
    const now = Date.now();
    this.lastRequestAt = now;
    if (wantStats) this.lastStatsRequestAt = now;
    const stale = !this.engine || (!this.engine.running && now - this.engineCheckedAt > ENGINE_RECHECK_MS);
    if (stale) await this.checkEngine();
    if (!this.engine?.running) return;
    if (!this.events) this.startEvents();
    if (wantStats && !this.statsProcess) this.startStats();
    if (light) return;
    if (now - this.refreshedAt > SAFETY_REFRESH_MS) await this.refresh();
    else if (this.refreshing) await this.refreshing;
  }

  /** Forget the engine state, so the next request asks Docker again (after a start or a failure). */
  recheckEngine(): void {
    this.engineCheckedAt = 0;
    if (this.engine) this.engine = { ...this.engine, running: false };
  }

  async composeCommand(): Promise<string[] | null> {
    if (Date.now() - this.composeCheckedAt > COMPOSE_RECHECK_MS) {
      this.compose = await detectCompose();
      this.composeCheckedAt = Date.now();
    }
    return this.compose;
  }

  container(id: string): Container | undefined {
    return this.containers.get(id) ?? [...this.containers.values()].find((row) => row.id.startsWith(id) || row.name === id);
  }

  async snapshot(directory: string | null): Promise<Snapshot> {
    const jobs = listJobs();
    const engine: Engine = {
      ...(this.engine ?? {
        kind: 'unknown', name: 'Docker', context: null, endpoint: null, running: false,
        version: null, cliMissing: false, start: null, problem: null,
      }),
      starting: jobs.some((job) => job.kind === 'engine' && job.state === 'running'),
    };
    const running = engine.running;
    return {
      at: Date.now(),
      engine,
      compose: (await this.composeCommand())?.join(' ') ?? null,
      containers: running ? this.withStats() : [],
      project: directory ? projectInfo(directory) : null,
      jobs,
      incidentSeq: this.incidents.latest,
      statsLive: this.statsProcess !== null,
    };
  }

  private withStats(): Container[] {
    return [...this.containers.values()].map((row) => {
      const sample = row.state === 'running' ? this.stats.get(row.id) : undefined;
      return sample ? { ...row, cpu: sample.cpu, memory: sample.memory, memoryLimit: sample.memoryLimit } : row;
    });
  }

  private async checkEngine(): Promise<void> {
    if (!this.engineProbe) {
      this.engineProbe = (async () => {
        const probe = await probeEngine();
        const wasRunning = this.engine?.running === true;
        this.engine = probe.engine;
        this.startArgv = probe.startArgv;
        this.engineCheckedAt = Date.now();
        if (!probe.engine.running && wasRunning) this.stopWatchers();
        if (probe.engine.running && !wasRunning) this.refreshedAt = 0;
      })().finally(() => {
        this.engineProbe = null;
      });
    }
    await this.engineProbe;
  }

  /** Re-reads every container: `ps` for the ids, then `inspect` in batches. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        do {
          this.refreshAgain = false;
          const { stdout } = await docker(['ps', '-aq', '--no-trunc']);
          const ids = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
          const next = new Map<string, Container>();
          for (let i = 0; i < ids.length; i += INSPECT_BATCH) {
            const batch = ids.slice(i, i + INSPECT_BATCH);
            try {
              const { stdout: inspected } = await docker(['inspect', '--type', 'container', '--', ...batch]);
              for (const info of JSON.parse(inspected) as Json[]) {
                const row = containerFromInspect(info);
                if (row) next.set(row.id, row);
              }
            } catch {
              // A container removed between ps and inspect fails the batch; read them one by one.
              for (const id of batch) {
                try {
                  const { stdout: single } = await docker(['inspect', '--type', 'container', '--', id]);
                  const row = containerFromInspect((JSON.parse(single) as Json[])[0] ?? {});
                  if (row) next.set(row.id, row);
                } catch {
                  // Gone.
                }
              }
            }
          }
          this.containers = next;
          this.refreshedAt = Date.now();
        } while (this.refreshAgain);
      } catch {
        // The daemon went away mid-read: let the next request look at the engine again.
        this.recheckEngine();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 150);
  }

  private startEvents(): void {
    this.events = streamLines(
      ['events', '--format', '{{json .}}', '--filter', 'type=container'],
      (line) => {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          return;
        }
        const event = readEvent(value);
        if (!event || event.action.startsWith('exec_')) return;
        this.incidents.onEvent(event, Date.now());
        this.scheduleRefresh();
      },
      () => {
        this.events = null;
        // `docker events` only ends when the daemon goes away or we stop it.
        if (Date.now() - this.lastRequestAt < IDLE_MS) this.recheckEngine();
      },
    );
  }

  private startStats(): void {
    this.statsProcess = streamLines(
      ['stats', '--no-trunc', '--format', '{{json .}}'],
      (line) => {
        const sample = parseStatsLine(line);
        if (sample) this.stats.set(sample.id, sample);
      },
      () => {
        this.statsProcess = null;
        this.stats.clear();
      },
    );
  }

  private stopWatchers(): void {
    this.events?.kill();
    this.statsProcess?.kill();
    this.events = null;
    this.statsProcess = null;
    this.stats.clear();
  }

  private idleCheck(): void {
    const now = Date.now();
    if (this.statsProcess && now - this.lastStatsRequestAt > STATS_IDLE_MS) {
      this.statsProcess.kill();
      this.statsProcess = null;
      this.stats.clear();
    }
    if (now - this.lastRequestAt > IDLE_MS && (this.events || this.containers.size > 0)) {
      this.stopWatchers();
      this.containers.clear();
      this.refreshedAt = 0;
      this.engine = null;
    }
  }

  shutdown(): void {
    this.stopWatchers();
  }
}

const projectCache = new Map<string, { at: number; info: ProjectInfo }>();

/** The open project's Compose file and the project name Compose would give it. */
export const projectInfo = (directory: string): ProjectInfo => {
  const cached = projectCache.get(directory);
  if (cached && Date.now() - cached.at < 10_000) return cached.info;
  const composeFile = COMPOSE_FILES.find((name) => existsSync(join(directory, name))) ?? null;
  const info: ProjectInfo = { directory, composeFile, name: composeProjectName(directory) };
  projectCache.set(directory, { at: Date.now(), info });
  return info;
};
