// Turns `docker events` into the incidents behind the rail badge: a container
// that died on its own, ran out of memory, or turned unhealthy. A stop the
// user asked for (docker stop, Compose down, this panel) is not one.
import type { Incident, IncidentKind } from '../shared/types.ts';

export type DockerEvent = {
  action: string;
  id: string;
  name: string;
  exitCode: number | null;
};

/** `docker events --format '{{json .}}'` line → the fields we read, containers only. */
export const readEvent = (value: unknown): DockerEvent | null => {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (row.Type !== 'container') return null;
  const actor = typeof row.Actor === 'object' && row.Actor !== null ? row.Actor as Record<string, unknown> : {};
  const attributes = typeof actor.Attributes === 'object' && actor.Attributes !== null
    ? actor.Attributes as Record<string, unknown>
    : {};
  const id = String(actor.ID ?? row.id ?? '');
  const action = String(row.Action ?? row.status ?? '');
  if (!id || !action) return null;
  const exit = Number.parseInt(String(attributes.exitCode ?? ''), 10);
  return { action, id, name: String(attributes.name ?? id.slice(0, 12)), exitCode: Number.isFinite(exit) ? exit : null };
};

/** A kill within this window before a die means someone stopped the container. */
const STOP_WINDOW_MS = 30_000;
/** A restart loop reports one incident per container in this window, not one per crash. */
const REPEAT_WINDOW_MS = 60_000;
const KEEP = 200;

export class IncidentTracker {
  private seq = 0;
  private readonly incidents: Incident[] = [];
  private readonly killedAt = new Map<string, number>();
  private readonly lastIncidentAt = new Map<string, number>();

  get latest(): number {
    return this.seq;
  }

  since(after: number): Incident[] {
    return this.incidents.filter((incident) => incident.seq > after);
  }

  onEvent(event: DockerEvent, now: number): Incident | null {
    const { action, id } = event;
    if (action === 'kill' || action === 'stop') {
      this.killedAt.set(id, now);
      return null;
    }
    // A restart kills and starts again; a crash after that start is the container's own.
    if (action === 'start') {
      this.killedAt.delete(id);
      return null;
    }
    if (action === 'destroy') {
      this.killedAt.delete(id);
      this.lastIncidentAt.delete(id);
      return null;
    }
    let kind: IncidentKind | null = null;
    if (action === 'oom') kind = 'oom';
    else if (action === 'health_status: unhealthy') kind = 'unhealthy';
    else if (action === 'die') {
      const stoppedOnPurpose = now - (this.killedAt.get(id) ?? -Infinity) < STOP_WINDOW_MS;
      if (!stoppedOnPurpose && event.exitCode !== null && event.exitCode !== 0) kind = 'crashed';
    }
    if (!kind) return null;
    if (now - (this.lastIncidentAt.get(id) ?? -Infinity) < REPEAT_WINDOW_MS) return null;
    this.lastIncidentAt.set(id, now);
    this.seq += 1;
    const incident: Incident = { seq: this.seq, at: now, containerId: id, name: event.name, kind, exitCode: event.exitCode };
    this.incidents.push(incident);
    if (this.incidents.length > KEEP) this.incidents.splice(0, this.incidents.length - KEEP);
    return incident;
  }
}
