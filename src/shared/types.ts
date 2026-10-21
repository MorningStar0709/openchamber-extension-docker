// What the service answers and the frames draw. The panel, the Work Status
// section, the slash command and the service ship in one package, so these
// types are the whole contract between them.

export type EngineKind =
  | 'colima'
  | 'docker-desktop'
  | 'orbstack'
  | 'rancher-desktop'
  | 'podman'
  | 'docker-engine'
  | 'remote'
  | 'unknown';

export type EngineStart = {
  /** What the user would type, shown with a Copy button. */
  display: string;
  /** True when the service can run it itself (the binary is on PATH and declared). */
  canRun: boolean;
};

export type Engine = {
  kind: EngineKind;
  /** "Colima", "Docker Desktop", … */
  name: string;
  context: string | null;
  endpoint: string | null;
  /** The docker CLI answered with a server version. */
  running: boolean;
  version: string | null;
  /** No `docker` binary on PATH or in the usual install folders. */
  cliMissing: boolean;
  start: EngineStart | null;
  /** A start job for the engine is running. */
  starting: boolean;
  /** First line of what docker said when it could not reach the daemon. */
  problem: string | null;
};

export type PortBinding = {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
};

export type ComposeInfo = {
  project: string;
  service: string;
  workingDir: string | null;
  configFiles: string[];
};

export type ContainerState = 'running' | 'paused' | 'restarting' | 'exited' | 'created' | 'dead' | 'removing';

export type Health = 'healthy' | 'unhealthy' | 'starting';

export type Container = {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  health: Health | null;
  exitCode: number | null;
  oomKilled: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  restartCount: number;
  ports: PortBinding[];
  compose: ComposeInfo | null;
  /** Percent of one core, summed over cores (200% is two busy cores), as `docker stats` reports it. */
  cpu: number | null;
  memory: number | null;
  memoryLimit: number | null;
};

/** The open project, as far as Docker is concerned. */
export type ProjectInfo = {
  directory: string;
  /** Compose file name in the project root, when there is one. */
  composeFile: string | null;
  /** The project name Compose would pick for that folder. */
  name: string;
};

export type JobKind =
  | 'container'
  | 'stack'
  | 'pull'
  | 'prune'
  | 'remove'
  | 'engine';

export type JobState = 'running' | 'done' | 'failed';

export type Job = {
  id: string;
  kind: JobKind;
  /** Container id, stack name, image ref, prune kind: what the job acts on. */
  target: string;
  /** The verb: stop, up, pull, images, … */
  action: string;
  /** A sentence for a toast: "Stopping web". */
  label: string;
  state: JobState;
  startedAt: number;
  endedAt: number | null;
  /** Last part of what the command printed. */
  output: string;
};

export type Snapshot = {
  at: number;
  engine: Engine;
  /** How Compose is called on this machine, or null when it is not installed. */
  compose: string | null;
  containers: Container[];
  project: ProjectInfo | null;
  jobs: Job[];
  /** Sequence number of the newest incident; see `/incidents`. */
  incidentSeq: number;
  /** Seconds-old stats are still stats; this says they are switched on. */
  statsLive: boolean;
};

export type IncidentKind = 'crashed' | 'oom' | 'unhealthy';

export type Incident = {
  seq: number;
  at: number;
  containerId: string;
  name: string;
  kind: IncidentKind;
  exitCode: number | null;
};

export type LogEntry = {
  /** RFC 3339 with nine fraction digits, so entries sort and compare as strings. */
  t: string;
  /** stdout or stderr. */
  s: 'out' | 'err';
  m: string;
};

export type LogsAnswer = {
  entries: LogEntry[];
  truncated: boolean;
};

export type FsEntry = {
  name: string;
  type: 'dir' | 'file' | 'link' | 'other';
};

export type FsListing = {
  path: string;
  entries: FsEntry[];
  truncated: boolean;
};

export type FsFile = {
  path: string;
  binary: boolean;
  truncated: boolean;
  size: number;
  content: string | null;
};

export type ExecAnswer = {
  output: string;
  exitCode: number;
  cwd: string;
  /** The output was cut to its last part. */
  truncated: boolean;
};

export type MountInfo = {
  type: string;
  name: string;
  source: string;
  destination: string;
  rw: boolean;
};

export type NetworkAttachment = {
  name: string;
  ip: string;
  aliases: string[];
};

export type InspectAnswer = {
  id: string;
  name: string;
  image: string;
  imageId: string;
  createdAt: string;
  command: string;
  entrypoint: string;
  workingDir: string;
  user: string;
  restartPolicy: string;
  restartCount: number;
  env: string[];
  labels: Record<string, string>;
  mounts: MountInfo[];
  networks: NetworkAttachment[];
  ports: PortBinding[];
  /** The whole `docker inspect` object, for Copy JSON. */
  raw: unknown;
};

export type DiskCategory = {
  kind: 'images' | 'containers' | 'volumes' | 'build-cache';
  total: number;
  active: number;
  size: number;
  reclaimable: number;
};

export type ImageRow = {
  id: string;
  repository: string;
  tag: string;
  size: number;
  createdSince: string;
  used: boolean;
  dangling: boolean;
};

export type VolumeRow = {
  name: string;
  driver: string;
  used: boolean;
  /** Compose project that created it, when it says so. */
  project: string | null;
};

export type NetworkRow = {
  id: string;
  name: string;
  driver: string;
  used: boolean;
  builtIn: boolean;
};

export type StorageAnswer = {
  disk: DiskCategory[];
  images: ImageRow[];
  volumes: VolumeRow[];
  networks: NetworkRow[];
};

export type PruneKind = DiskCategory['kind'];
