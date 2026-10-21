// Pure readers for what the docker CLI prints. No process calls here, so
// every shape docker can answer with is covered by parse.test.ts.
import type {
  ComposeInfo,
  Container,
  ContainerState,
  DiskCategory,
  EngineKind,
  Health,
  LogEntry,
  MountInfo,
  NetworkAttachment,
  PortBinding,
} from '../shared/types.ts';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Every non-empty line that is a JSON object; anything else is skipped. */
export const parseJsonLines = (stdout: string): Json[] => stdout
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return isRecord(value) ? [value] : [];
    } catch {
      return [];
    }
  });

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/**
 * `1.5GB`, `69.44MiB`, `512kB`, `0B` → bytes. Docker prints decimal units
 * in `system df` and `images`, binary ones in `stats`; both appear.
 */
export const parseSize = (value: string): number | null => {
  const match = /^\s*([\d.]+)\s*([a-zA-Z]*)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? 'b').toLowerCase() || 'b';
  const factor = UNITS[unit];
  return factor === undefined ? null : Math.round(amount * factor);
};

// ----- Stats -----

// `docker stats` redraws a terminal between rounds even when its output is a pipe.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export type StatsSample = { id: string; cpu: number | null; memory: number | null; memoryLimit: number | null };

export const parseStatsLine = (line: string): StatsSample | null => {
  const clean = line.replace(ANSI, '').trim();
  if (!clean.startsWith('{')) return null;
  let row: unknown;
  try {
    row = JSON.parse(clean);
  } catch {
    return null;
  }
  if (!isRecord(row)) return null;
  const id = text(row.ID || row.Container).trim();
  if (!id) return null;
  const [used = '', limit = ''] = text(row.MemUsage).split('/');
  const cpuText = text(row.CPUPerc).replace('%', '').trim();
  return {
    id,
    cpu: cpuText && cpuText !== '--' ? num(cpuText) : null,
    memory: parseSize(used),
    memoryLimit: parseSize(limit),
  };
};

// ----- Containers -----

const STATES: readonly ContainerState[] = ['running', 'paused', 'restarting', 'exited', 'created', 'dead', 'removing'];
const HEALTH: readonly Health[] = ['healthy', 'unhealthy', 'starting'];

/** Docker writes `0001-01-01T00:00:00Z` for a time that never happened. */
const realTime = (value: unknown): string | null => {
  const raw = text(value);
  return raw && !raw.startsWith('0001-') ? raw : null;
};

export const publishedPorts = (info: Json): PortBinding[] => {
  const settings = isRecord(info.NetworkSettings) ? info.NetworkSettings : {};
  const map = isRecord(settings.Ports) ? settings.Ports : {};
  const byKey = new Map<string, PortBinding>();
  for (const [key, bindings] of Object.entries(map)) {
    const [containerPortText, protocol = 'tcp'] = key.split('/');
    const containerPort = num(containerPortText);
    if (containerPort === null || !Array.isArray(bindings)) continue;
    for (const binding of bindings) {
      if (!isRecord(binding)) continue;
      const hostPort = num(binding.HostPort);
      if (hostPort === null || hostPort <= 0) continue;
      const hostIp = text(binding.HostIp) || '0.0.0.0';
      // Docker publishes the same port on 0.0.0.0 and ::; one is enough, and IPv4 opens more reliably.
      const dedupe = `${hostPort}/${protocol}`;
      const previous = byKey.get(dedupe);
      if (!previous || (previous.hostIp.includes(':') && !hostIp.includes(':'))) {
        byKey.set(dedupe, { hostIp, hostPort, containerPort, protocol });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.hostPort - b.hostPort);
};

export const composeFromLabels = (labels: Json): ComposeInfo | null => {
  const project = text(labels['com.docker.compose.project']).trim();
  if (!project) return null;
  const files = text(labels['com.docker.compose.project.config_files']).trim();
  return {
    project,
    service: text(labels['com.docker.compose.service']).trim(),
    workingDir: text(labels['com.docker.compose.project.working_dir']).trim() || null,
    configFiles: files ? files.split(',').map((file) => file.trim()).filter(Boolean) : [],
  };
};

/** One `docker inspect` object → the row the panel draws, without live stats. */
export const containerFromInspect = (info: Json): Container | null => {
  const id = text(info.Id);
  if (!id) return null;
  const state = isRecord(info.State) ? info.State : {};
  const config = isRecord(info.Config) ? info.Config : {};
  const labels = isRecord(config.Labels) ? config.Labels : {};
  const status = text(state.Status) as ContainerState;
  const health = isRecord(state.Health) ? text(state.Health.Status) as Health : null;
  const exitCode = num(state.ExitCode);
  return {
    id,
    name: text(info.Name).replace(/^\//, '') || id.slice(0, 12),
    image: text(config.Image),
    state: STATES.includes(status) ? status : 'created',
    health: health && HEALTH.includes(health) ? health : null,
    exitCode: status === 'exited' || status === 'dead' ? exitCode : null,
    oomKilled: state.OOMKilled === true,
    createdAt: text(info.Created),
    startedAt: realTime(state.StartedAt),
    finishedAt: realTime(state.FinishedAt),
    restartCount: num(info.RestartCount) ?? 0,
    ports: publishedPorts(info),
    compose: composeFromLabels(labels),
    cpu: null,
    memory: null,
    memoryLimit: null,
  };
};

const joinCommand = (value: unknown): string => (Array.isArray(value) ? value.map(text).join(' ') : text(value));

export const inspectDetails = (info: Json) => {
  const config = isRecord(info.Config) ? info.Config : {};
  const host = isRecord(info.HostConfig) ? info.HostConfig : {};
  const restart = isRecord(host.RestartPolicy) ? host.RestartPolicy : {};
  const settings = isRecord(info.NetworkSettings) ? info.NetworkSettings : {};
  const networks = isRecord(settings.Networks) ? settings.Networks : {};
  const labels = isRecord(config.Labels) ? config.Labels : {};
  const mounts: MountInfo[] = Array.isArray(info.Mounts)
    ? info.Mounts.filter(isRecord).map((mount) => ({
      type: text(mount.Type),
      name: text(mount.Name),
      source: text(mount.Source),
      destination: text(mount.Destination),
      rw: mount.RW !== false,
    }))
    : [];
  const attachments: NetworkAttachment[] = Object.entries(networks).map(([name, value]) => {
    const network = isRecord(value) ? value : {};
    return {
      name,
      ip: text(network.IPAddress),
      aliases: Array.isArray(network.Aliases) ? network.Aliases.map(text).filter(Boolean) : [],
    };
  });
  return {
    id: text(info.Id),
    name: text(info.Name).replace(/^\//, ''),
    image: text(config.Image),
    imageId: text(info.Image),
    createdAt: text(info.Created),
    command: joinCommand(config.Cmd),
    entrypoint: joinCommand(config.Entrypoint),
    workingDir: text(config.WorkingDir),
    user: text(config.User),
    restartPolicy: text(restart.Name) || 'no',
    restartCount: num(info.RestartCount) ?? 0,
    env: Array.isArray(config.Env) ? config.Env.map(text) : [],
    labels: Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, text(value)])),
    mounts,
    networks: attachments,
    ports: publishedPorts(info),
  };
};

// ----- Engine -----

export type EndpointClass = { kind: EngineKind; name: string; profile: string | null };

/** Which product answers on this docker endpoint. Decided from the path alone, so it works while the daemon is down. */
export const classifyEndpoint = (endpoint: string | null, platform: string, dockerDesktopInstalled: boolean): EndpointClass => {
  const value = endpoint ?? '';
  const colima = /\/\.colima\/([^/]+)\/docker\.sock$/.exec(value);
  if (colima) return { kind: 'colima', name: 'Colima', profile: colima[1] ?? 'default' };
  if (value.includes('/.orbstack/')) return { kind: 'orbstack', name: 'OrbStack', profile: null };
  if (value.includes('/.rd/')) return { kind: 'rancher-desktop', name: 'Rancher Desktop', profile: null };
  if (value.includes('podman')) return { kind: 'podman', name: 'Podman', profile: null };
  if (value.startsWith('tcp://') || value.startsWith('ssh://')) return { kind: 'remote', name: 'Remote Docker', profile: null };
  if (value.startsWith('npipe:')) return { kind: 'docker-desktop', name: 'Docker Desktop', profile: null };
  if (value.includes('/.docker/run/docker.sock') || value.includes('/.docker/desktop/')) {
    return { kind: 'docker-desktop', name: 'Docker Desktop', profile: null };
  }
  if (value.endsWith('/var/run/docker.sock') || value === '') {
    if (platform === 'linux') return { kind: 'docker-engine', name: 'Docker Engine', profile: null };
    if (dockerDesktopInstalled) return { kind: 'docker-desktop', name: 'Docker Desktop', profile: null };
  }
  return { kind: 'unknown', name: 'Docker', profile: null };
};

// ----- Compose -----

/** The project name `docker compose` derives from a folder: lower case, letters, digits, `-` and `_`. */
export const composeProjectName = (directory: string): string => {
  const base = directory.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[^a-z0-9]+/, '');
};

export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'] as const;

// ----- Logs -----

/** Pads the fraction to nine digits: docker trims trailing zeros, which breaks string order. */
export const normalizeTimestamp = (value: string): string | null => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const fraction = (match[2] ?? '').slice(0, 9).padEnd(9, '0');
  return `${match[1]}.${fraction}${match[3]}`;
};

/** `docker logs --timestamps` output → entries. A line without a timestamp continues the one before it. */
export const parseLogText = (output: string, stream: LogEntry['s']): LogEntry[] => {
  const entries: LogEntry[] = [];
  for (const line of output.split('\n')) {
    if (line === '') continue;
    const space = line.indexOf(' ');
    const stamp = space > 0 ? normalizeTimestamp(line.slice(0, space)) : null;
    if (stamp) {
      entries.push({ t: stamp, s: stream, m: line.slice(space + 1).replace(/\r$/, '') });
    } else {
      const last = entries[entries.length - 1];
      if (last) last.m += `\n${line}`;
    }
  }
  return entries;
};

/** stdout and stderr arrive apart; put them back in time order, keeping each stream's own order. */
export const mergeLogs = (out: LogEntry[], err: LogEntry[]): LogEntry[] => {
  const merged: LogEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < out.length || j < err.length) {
    const a = out[i];
    const b = err[j];
    if (a && (!b || a.t <= b.t)) {
      merged.push(a);
      i += 1;
    } else if (b) {
      merged.push(b);
      j += 1;
    }
  }
  return merged;
};

// ----- Disk -----

const DISK_KINDS: Record<string, DiskCategory['kind']> = {
  images: 'images',
  containers: 'containers',
  'local volumes': 'volumes',
  'build cache': 'build-cache',
};

/** `docker system df --format json` rows → categories. Reclaimable reads `1.2GB (40%)`. */
export const parseDiskUsage = (rows: Json[]): DiskCategory[] => rows.flatMap((row) => {
  const kind = DISK_KINDS[text(row.Type).trim().toLowerCase()];
  if (!kind) return [];
  return [{
    kind,
    total: num(row.TotalCount) ?? 0,
    active: num(row.Active) ?? 0,
    size: parseSize(text(row.Size)) ?? 0,
    reclaimable: parseSize(text(row.Reclaimable).split('(')[0] ?? '') ?? 0,
  }];
});

/** The last "Total reclaimed space: 1.2GB" line of a prune, in bytes. */
export const reclaimedBytes = (output: string): number | null => {
  const match = /Total reclaimed space:\s*(\S+)/i.exec(output);
  return match ? parseSize(match[1] ?? '') : null;
};

// ----- Exec -----

export const CWD_MARK = '\u001eOC_CWD ';

/** Splits the working directory the exec script appends off the command's output. */
export const splitExecOutput = (stdout: string): { output: string; cwd: string | null } => {
  const at = stdout.lastIndexOf(CWD_MARK);
  if (at < 0) return { output: stdout, cwd: null };
  const cwd = stdout.slice(at + CWD_MARK.length).split('\n')[0]?.trim() || null;
  return { output: stdout.slice(0, at).replace(/\n$/, ''), cwd };
};
