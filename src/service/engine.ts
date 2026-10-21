// Which Docker this machine talks to, whether it is up, and how to start it.
import { existsSync } from 'node:fs';

import { CommandError, docker, errorLine, hasBinary, run } from './docker.ts';
import { classifyEndpoint, type EndpointClass } from './parse.ts';
import type { Engine, EngineStart } from '../shared/types.ts';

type Context = { name: string | null; endpoint: string | null };

const readContext = async (): Promise<Context> => {
  try {
    const { stdout } = await docker(['context', 'inspect', '--format', '{{json .}}'], { timeout: 5_000 });
    const value = JSON.parse(stdout.trim().split('\n')[0] ?? '{}') as { Name?: string; Endpoints?: { docker?: { Host?: string } } };
    return { name: value.Name ?? null, endpoint: value.Endpoints?.docker?.Host ?? null };
  } catch {
    return { name: null, endpoint: null };
  }
};

/** The start command for that engine, and whether the service may run it. */
export const startFor = (engine: EndpointClass, platform: string): { start: EngineStart; argv: string[] | null } | null => {
  const darwin = platform === 'darwin';
  switch (engine.kind) {
    case 'colima': {
      const argv = engine.profile && engine.profile !== 'default' ? ['colima', 'start', engine.profile] : ['colima', 'start'];
      const canRun = hasBinary('colima');
      return { start: { display: argv.join(' '), canRun }, argv: canRun ? argv : null };
    }
    case 'docker-desktop':
      return darwin
        ? { start: { display: 'open -a Docker', canRun: true }, argv: ['open', '-a', 'Docker'] }
        : { start: { display: 'Start Docker Desktop', canRun: false }, argv: null };
    case 'orbstack':
      if (hasBinary('orb')) return { start: { display: 'orb start', canRun: true }, argv: ['orb', 'start'] };
      return darwin ? { start: { display: 'open -a OrbStack', canRun: true }, argv: ['open', '-a', 'OrbStack'] } : null;
    case 'rancher-desktop':
      return darwin
        ? { start: { display: 'open -a "Rancher Desktop"', canRun: true }, argv: ['open', '-a', 'Rancher Desktop'] }
        : { start: { display: 'Start Rancher Desktop', canRun: false }, argv: null };
    case 'podman':
      return { start: { display: 'podman machine start', canRun: false }, argv: null };
    case 'docker-engine':
      return { start: { display: 'sudo systemctl start docker', canRun: false }, argv: null };
    default:
      return null;
  }
};

export type EngineProbe = { engine: Omit<Engine, 'starting'>; startArgv: string[] | null };

export const probeEngine = async (): Promise<EngineProbe> => {
  const context = await readContext();
  let kind = classifyEndpoint(context.endpoint, process.platform, existsSync('/Applications/Docker.app'));
  // `colima stop` switches the CLI back to the default context, whose socket
  // nothing serves on a Mac: the engine that's installed is the one to start.
  if (kind.kind === 'unknown' && process.platform === 'darwin') {
    if (hasBinary('colima')) kind = { kind: 'colima', name: 'Colima', profile: 'default' };
    else if (hasBinary('orb')) kind = { kind: 'orbstack', name: 'OrbStack', profile: null };
  }
  const start = startFor(kind, process.platform);
  const base = {
    kind: kind.kind,
    name: kind.name,
    context: context.name,
    endpoint: context.endpoint,
    start: start?.start ?? null,
  };
  try {
    const { stdout } = await docker(['version', '--format', '{{.Server.Version}}'], { timeout: 8_000 });
    return {
      engine: { ...base, running: true, version: stdout.trim() || null, cliMissing: false, problem: null },
      startArgv: start?.argv ?? null,
    };
  } catch (error) {
    const missing = error instanceof CommandError && error.missing;
    const problem = error instanceof CommandError ? errorLine(error.stderr, error.message) : 'Docker did not answer.';
    return {
      engine: { ...base, running: false, version: null, cliMissing: missing, problem: missing ? null : problem },
      startArgv: start?.argv ?? null,
    };
  }
};

/** `docker compose` (the plugin) or `docker-compose` (the old binary), or null when neither is installed. */
export const detectCompose = async (): Promise<string[] | null> => {
  try {
    await docker(['compose', 'version', '--short'], { timeout: 5_000 });
    return ['docker', 'compose'];
  } catch {
    // Not the plugin; try the standalone binary.
  }
  try {
    await run('docker-compose', ['version', '--short'], { timeout: 5_000 });
    return ['docker-compose'];
  } catch {
    return null;
  }
};
