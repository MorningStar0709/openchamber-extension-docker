// Disk use, images, volumes and networks. Read only when the Storage view is
// open; `docker system df` walks every layer, so it is cached briefly.
import { docker } from './docker.ts';
import { parseDiskUsage, parseJsonLines, parseSize } from './parse.ts';
import type { Container, ImageRow, NetworkRow, StorageAnswer, VolumeRow } from '../shared/types.ts';

const CACHE_MS = 15_000;
const BUILT_IN_NETWORKS = new Set(['bridge', 'host', 'none']);

let cached: { at: number; answer: StorageAnswer } | null = null;

export const forgetStorage = (): void => {
  cached = null;
};

type Json = Record<string, unknown>;

/** What containers use, read straight from inspect: image ids, volume names, network ids and names. */
const usage = async (containers: Container[]): Promise<{ images: Set<string>; volumes: Set<string>; networks: Set<string> }> => {
  const images = new Set<string>();
  const volumes = new Set<string>();
  const networks = new Set<string>();
  const ids = containers.map((row) => row.id);
  for (let i = 0; i < ids.length; i += 50) {
    const { stdout } = await docker(['inspect', '--type', 'container', '--', ...ids.slice(i, i + 50)]).catch(() => ({ stdout: '[]' }));
    for (const info of JSON.parse(stdout) as Json[]) {
      if (typeof info.Image === 'string') images.add(info.Image);
      for (const mount of Array.isArray(info.Mounts) ? info.Mounts as Json[] : []) {
        if (mount.Type === 'volume' && typeof mount.Name === 'string') volumes.add(mount.Name);
      }
      const settings = (info.NetworkSettings ?? {}) as Json;
      for (const [name, value] of Object.entries((settings.Networks ?? {}) as Record<string, Json>)) {
        networks.add(name);
        if (typeof value?.NetworkID === 'string') networks.add(value.NetworkID);
      }
    }
  }
  return { images, volumes, networks };
};

export const readStorage = async (containers: Container[]): Promise<StorageAnswer> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.answer;
  const [df, imageLines, volumeLines, networkLines, used] = await Promise.all([
    docker(['system', 'df', '--format', '{{json .}}'], { timeout: 30_000 }),
    docker(['image', 'ls', '--no-trunc', '--format', '{{json .}}']),
    docker(['volume', 'ls', '--format', '{{json .}}']),
    docker(['network', 'ls', '--no-trunc', '--format', '{{json .}}']),
    usage(containers),
  ]);
  const images: ImageRow[] = parseJsonLines(imageLines.stdout).map((row) => {
    const id = String(row.ID ?? '');
    const repository = String(row.Repository ?? '<none>');
    return {
      id,
      repository,
      tag: String(row.Tag ?? '<none>'),
      size: parseSize(String(row.Size ?? '')) ?? 0,
      createdSince: String(row.CreatedSince ?? ''),
      used: used.images.has(id),
      dangling: repository === '<none>',
    };
  });
  const volumes: VolumeRow[] = parseJsonLines(volumeLines.stdout).map((row) => {
    const name = String(row.Name ?? '');
    const project = /com\.docker\.compose\.project=([^,]+)/.exec(String(row.Labels ?? ''))?.[1] ?? null;
    return { name, driver: String(row.Driver ?? ''), used: used.volumes.has(name), project };
  });
  const networks: NetworkRow[] = parseJsonLines(networkLines.stdout).map((row) => {
    const id = String(row.ID ?? '');
    const name = String(row.Name ?? '');
    return {
      id,
      name,
      driver: String(row.Driver ?? ''),
      used: used.networks.has(name) || used.networks.has(id),
      builtIn: BUILT_IN_NETWORKS.has(name),
    };
  });
  const answer: StorageAnswer = { disk: parseDiskUsage(parseJsonLines(df.stdout)), images, volumes, networks };
  cached = { at: Date.now(), answer };
  return answer;
};
