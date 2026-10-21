// The chip `/docker web` and "Attach to chat" put in the composer: the
// container's state and its recent logs as context for the model. Clicking
// the chip opens the container in the panel (`data.containerId`).
import type { AttachIssueRequest, HostClient } from '@openchamber/sdk';

import { getJson } from './client.ts';
import { label, stateLine } from './stacks.ts';
import type { Container, LogsAnswer } from './types.ts';

export const PROVIDER_ID = 'docker';
const LOG_LINES = 200;
/** The composer's limit is 16 000; leave room for the header. */
const TEXT_MAX = 15_000;

export const isDockerChipData = (data: unknown): data is { containerId: string } => typeof data === 'object'
  && data !== null
  && typeof (data as { containerId?: unknown }).containerId === 'string';

/** "redis:6379 → 6380" style port list for the model. */
const portsText = (row: Container): string => row.ports.map((port) => `${port.hostPort}->${port.containerPort}/${port.protocol}`).join(', ');

export const containerChip = async (host: HostClient, row: Container): Promise<AttachIssueRequest> => {
  let logs = '';
  try {
    const answer = await getJson<LogsAnswer>(host, `/containers/${row.id}/logs`, { tail: String(LOG_LINES) });
    logs = answer.entries.map((entry) => `${entry.t.slice(11, 23)} ${entry.s === 'err' ? 'E' : ' '} ${entry.m}`).join('\n');
  } catch {
    logs = '(logs could not be read)';
  }
  const lines = [
    `Docker container "${row.name}"${row.compose ? ` (service "${row.compose.service}" of Compose project "${row.compose.project}")` : ''}`,
    `Image: ${row.image}`,
    `State: ${stateLine(row)}${row.health ? `, health: ${row.health}` : ''}${row.restartCount > 0 ? `, ${row.restartCount} restarts` : ''}`,
    row.ports.length > 0 ? `Published ports: ${portsText(row)}` : '',
    row.compose?.workingDir ? `Compose folder: ${row.compose.workingDir}` : '',
    '',
    `Last ${LOG_LINES} log lines, times in UTC, E marks stderr:`,
  ].filter((line, index) => line !== '' || index === 5);
  const header = lines.join('\n');
  const room = TEXT_MAX - header.length - 10;
  const body = logs.length > room ? `…\n${logs.slice(-room)}` : logs || '(no output)';
  return {
    providerId: PROVIDER_ID,
    id: row.id.slice(0, 12),
    title: `${label(row)} · ${stateLine(row)}`,
    url: `docker://container/${row.id.slice(0, 12)}`,
    text: `${header}\n${body}`,
    data: { containerId: row.id },
  };
};

/** The container `/docker <name>` means: exact name, Compose service in the open project, then a unique prefix. */
export const findContainer = (containers: Container[], query: string, directory: string | null): Container | null => {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  const inProject = (row: Container): boolean => Boolean(directory && row.compose?.workingDir?.startsWith(directory));
  const candidates = [
    containers.filter((row) => row.name.toLowerCase() === wanted),
    containers.filter((row) => row.compose?.service.toLowerCase() === wanted && inProject(row)),
    containers.filter((row) => row.compose?.service.toLowerCase() === wanted),
    containers.filter((row) => row.name.toLowerCase().startsWith(wanted) || row.id.startsWith(wanted)),
    containers.filter((row) => row.name.toLowerCase().includes(wanted)),
  ];
  for (const list of candidates) {
    if (list.length === 1) return list[0] ?? null;
    if (list.length > 1) return list.find((row) => row.state === 'running') ?? list[0] ?? null;
  }
  return null;
};
