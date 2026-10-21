import { describe, expect, test } from 'bun:test';

import { IncidentTracker, readEvent, type DockerEvent } from './incidents.ts';

const event = (action: string, exitCode: number | null = null, id = 'c1'): DockerEvent => ({ action, id, name: 'web', exitCode });

describe('readEvent', () => {
  test('reads a container event line', () => {
    expect(readEvent({ Type: 'container', Action: 'die', Actor: { ID: 'abc', Attributes: { name: 'web', exitCode: '137' } } }))
      .toEqual({ action: 'die', id: 'abc', name: 'web', exitCode: 137 });
  });
  test('ignores other event types', () => {
    expect(readEvent({ Type: 'network', Action: 'connect', Actor: { ID: 'n' } })).toBeNull();
  });
});

describe('IncidentTracker', () => {
  test('a die with a non-zero code is a crash', () => {
    const tracker = new IncidentTracker();
    expect(tracker.onEvent(event('die', 1), 1_000)).toMatchObject({ seq: 1, kind: 'crashed', exitCode: 1 });
    expect(tracker.latest).toBe(1);
  });
  test('a clean exit is not', () => {
    expect(new IncidentTracker().onEvent(event('die', 0), 1_000)).toBeNull();
  });
  test('a die right after a kill was a stop', () => {
    const tracker = new IncidentTracker();
    tracker.onEvent(event('kill'), 1_000);
    expect(tracker.onEvent(event('die', 143), 11_000)).toBeNull();
    // Long after, the same container crashing on its own counts again.
    expect(tracker.onEvent(event('die', 1), 100_000)?.kind).toBe('crashed');
  });
  test('a crash right after a restart is still a crash', () => {
    const tracker = new IncidentTracker();
    tracker.onEvent(event('kill'), 1_000);
    tracker.onEvent(event('die', 143), 1_100);
    tracker.onEvent(event('start'), 1_500);
    expect(tracker.onEvent(event('die', 1), 3_500)?.kind).toBe('crashed');
  });
  test('oom and unhealthy are incidents', () => {
    const tracker = new IncidentTracker();
    expect(tracker.onEvent(event('oom', null, 'a'), 0)?.kind).toBe('oom');
    expect(tracker.onEvent(event('health_status: unhealthy', null, 'b'), 0)?.kind).toBe('unhealthy');
    expect(tracker.onEvent(event('health_status: healthy', null, 'c'), 0)).toBeNull();
  });
  test('a restart loop counts once a minute', () => {
    const tracker = new IncidentTracker();
    expect(tracker.onEvent(event('die', 1), 0)).not.toBeNull();
    expect(tracker.onEvent(event('die', 1), 5_000)).toBeNull();
    expect(tracker.onEvent(event('die', 1), 61_000)).not.toBeNull();
    expect(tracker.since(1).map((incident) => incident.seq)).toEqual([2]);
  });
});
