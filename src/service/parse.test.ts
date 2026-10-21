import { describe, expect, test } from 'bun:test';

import {
  classifyEndpoint,
  composeProjectName,
  containerFromInspect,
  CWD_MARK,
  mergeLogs,
  normalizeTimestamp,
  parseDiskUsage,
  parseLogText,
  parseSize,
  parseStatsLine,
  publishedPorts,
  reclaimedBytes,
  splitExecOutput,
} from './parse.ts';

describe('parseSize', () => {
  test('reads decimal and binary units', () => {
    expect(parseSize('0B')).toBe(0);
    expect(parseSize('1.5GB')).toBe(1_500_000_000);
    expect(parseSize('512kB')).toBe(512_000);
    expect(parseSize('69.44MiB')).toBe(Math.round(69.44 * 1024 ** 2));
    expect(parseSize(' 7.75GiB ')).toBe(Math.round(7.75 * 1024 ** 3));
  });
  test('refuses what is not a size', () => {
    expect(parseSize('--')).toBeNull();
    expect(parseSize('12 parsecs')).toBeNull();
  });
});

describe('parseStatsLine', () => {
  test('reads a row and strips the terminal redraw docker prints between rounds', () => {
    const line = '\u001b[2J\u001b[H{"BlockIO":"0B / 0B","CPUPerc":"150.25%","Container":"abc","ID":"abcdef","MemPerc":"0.87%","MemUsage":"69.44MiB / 7.75GiB","Name":"web","NetIO":"1kB / 0B","PIDs":"4"}';
    expect(parseStatsLine(line)).toEqual({ id: 'abcdef', cpu: 150.25, memory: Math.round(69.44 * 1024 ** 2), memoryLimit: Math.round(7.75 * 1024 ** 3) });
  });
  test('a container that is starting has no numbers yet', () => {
    expect(parseStatsLine('{"ID":"x","CPUPerc":"--","MemUsage":"-- / --"}')).toEqual({ id: 'x', cpu: null, memory: null, memoryLimit: null });
  });
  test('skips noise', () => {
    expect(parseStatsLine('')).toBeNull();
    expect(parseStatsLine('{not json')).toBeNull();
  });
});

const inspectFixture = {
  Id: 'a'.repeat(64),
  Name: '/openchamber-web-1',
  Created: '2026-10-21T08:00:00Z',
  RestartCount: 2,
  State: { Status: 'exited', ExitCode: 1, OOMKilled: false, StartedAt: '2026-10-21T08:00:01Z', FinishedAt: '2026-10-21T09:00:00Z', Health: { Status: 'unhealthy' } },
  Config: {
    Image: 'node:22-alpine',
    Labels: {
      'com.docker.compose.project': 'openchamber',
      'com.docker.compose.service': 'web',
      'com.docker.compose.project.working_dir': '/Users/me/openchamber',
      'com.docker.compose.project.config_files': '/Users/me/openchamber/compose.yaml,/Users/me/openchamber/compose.override.yaml',
    },
  },
  NetworkSettings: {
    Ports: {
      '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '3000' }, { HostIp: '::', HostPort: '3000' }],
      '9229/tcp': null,
      '53/udp': [{ HostIp: '::', HostPort: '5353' }],
    },
  },
};

describe('containerFromInspect', () => {
  test('reads state, compose labels and ports', () => {
    const row = containerFromInspect(inspectFixture);
    expect(row).toMatchObject({
      name: 'openchamber-web-1',
      image: 'node:22-alpine',
      state: 'exited',
      exitCode: 1,
      health: 'unhealthy',
      restartCount: 2,
      compose: {
        project: 'openchamber',
        service: 'web',
        workingDir: '/Users/me/openchamber',
        configFiles: ['/Users/me/openchamber/compose.yaml', '/Users/me/openchamber/compose.override.yaml'],
      },
    });
    expect(row?.ports).toEqual([
      { hostIp: '0.0.0.0', hostPort: 3000, containerPort: 3000, protocol: 'tcp' },
      { hostIp: '::', hostPort: 5353, containerPort: 53, protocol: 'udp' },
    ]);
  });
  test('a running container has no exit code and a never-finished time is null', () => {
    const row = containerFromInspect({ ...inspectFixture, State: { Status: 'running', ExitCode: 0, StartedAt: '2026-10-21T08:00:01Z', FinishedAt: '0001-01-01T00:00:00Z' } });
    expect(row?.exitCode).toBeNull();
    expect(row?.finishedAt).toBeNull();
    expect(row?.health).toBeNull();
  });
  test('without an id there is no row', () => {
    expect(containerFromInspect({})).toBeNull();
  });
});

describe('publishedPorts', () => {
  test('prefers IPv4 when both families publish the same port', () => {
    const ports = publishedPorts({ NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '::', HostPort: '8080' }, { HostIp: '127.0.0.1', HostPort: '8080' }] } } });
    expect(ports).toEqual([{ hostIp: '127.0.0.1', hostPort: 8080, containerPort: 80, protocol: 'tcp' }]);
  });
});

describe('classifyEndpoint', () => {
  test('names the product from the socket path', () => {
    expect(classifyEndpoint('unix:///Users/me/.colima/default/docker.sock', 'darwin', false)).toEqual({ kind: 'colima', name: 'Colima', profile: 'default' });
    expect(classifyEndpoint('unix:///Users/me/.colima/work/docker.sock', 'darwin', false).profile).toBe('work');
    expect(classifyEndpoint('unix:///Users/me/.orbstack/run/docker.sock', 'darwin', false).kind).toBe('orbstack');
    expect(classifyEndpoint('unix:///Users/me/.docker/run/docker.sock', 'darwin', true).kind).toBe('docker-desktop');
    expect(classifyEndpoint('npipe:////./pipe/docker_engine', 'win32', false).kind).toBe('docker-desktop');
    expect(classifyEndpoint('unix:///var/run/docker.sock', 'linux', false).kind).toBe('docker-engine');
    expect(classifyEndpoint('unix:///var/run/docker.sock', 'darwin', true).kind).toBe('docker-desktop');
    expect(classifyEndpoint('ssh://me@box', 'darwin', false).kind).toBe('remote');
    expect(classifyEndpoint(null, 'darwin', false).kind).toBe('unknown');
  });
});

describe('composeProjectName', () => {
  test('matches what compose derives from a folder', () => {
    expect(composeProjectName('/Users/me/My.App')).toBe('myapp');
    expect(composeProjectName('/srv/openchamber/')).toBe('openchamber');
    expect(composeProjectName('/tmp/_hidden-Thing')).toBe('hidden-thing');
  });
});

describe('logs', () => {
  test('timestamps sort as strings once padded', () => {
    expect(normalizeTimestamp('2026-10-21T08:00:00.93Z')).toBe('2026-10-21T08:00:00.930000000Z');
    expect(normalizeTimestamp('2026-10-21T08:00:00Z')).toBe('2026-10-21T08:00:00.000000000Z');
    expect(normalizeTimestamp('yesterday')).toBeNull();
  });
  test('a line without a timestamp continues the entry before it', () => {
    const entries = parseLogText('2026-10-21T08:00:00.1Z first\ncontinued\n2026-10-21T08:00:01Z second\r\n', 'out');
    expect(entries).toEqual([
      { t: '2026-10-21T08:00:00.100000000Z', s: 'out', m: 'first\ncontinued' },
      { t: '2026-10-21T08:00:01.000000000Z', s: 'out', m: 'second' },
    ]);
  });
  test('stdout and stderr merge in time order', () => {
    const out = parseLogText('2026-10-21T08:00:00Z a\n2026-10-21T08:00:02Z c\n', 'out');
    const err = parseLogText('2026-10-21T08:00:01Z b\n', 'err');
    expect(mergeLogs(out, err).map((entry) => entry.m)).toEqual(['a', 'b', 'c']);
  });
});

describe('disk usage', () => {
  test('reads system df rows', () => {
    const disk = parseDiskUsage([
      { Type: 'Images', TotalCount: '12', Active: '3', Size: '4.2GB', Reclaimable: '3.1GB (73%)' },
      { Type: 'Local Volumes', TotalCount: '5', Active: '2', Size: '120MB', Reclaimable: '20MB (16%)' },
      { Type: 'Build Cache', TotalCount: '40', Active: '0', Size: '1.2GB', Reclaimable: '1.2GB' },
      { Type: 'Something new', TotalCount: '1' },
    ]);
    expect(disk.map((row) => row.kind)).toEqual(['images', 'volumes', 'build-cache']);
    expect(disk[0]).toEqual({ kind: 'images', total: 12, active: 3, size: 4_200_000_000, reclaimable: 3_100_000_000 });
  });
  test('reads what a prune freed', () => {
    expect(reclaimedBytes('Deleted Images:\n...\nTotal reclaimed space: 1.2GB\n')).toBe(1_200_000_000);
    expect(reclaimedBytes('nothing')).toBeNull();
  });
});

describe('splitExecOutput', () => {
  test('takes the working directory off the end', () => {
    expect(splitExecOutput(`hello\n\n${CWD_MARK}/app\n`)).toEqual({ output: 'hello\n', cwd: '/app' });
    expect(splitExecOutput('no marker')).toEqual({ output: 'no marker', cwd: null });
  });
});
