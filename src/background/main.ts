// The hidden frame behind `/docker <name>`: finds the container and returns a
// chip with its state and recent logs for the model to read.
import { connectHost } from '@openchamber/sdk';

import { containerChip, findContainer } from '../shared/chip.ts';
import { fetchSnapshot, messageOf } from '../shared/client.ts';
import { groupContainers, label, needsAttention } from '../shared/stacks.ts';

const host = connectHost();
let directory: string | null = null;

host.onReady((context) => {
  directory = context.directory;
});

host.onResolve(async ({ args }) => {
  let snapshot;
  try {
    snapshot = await fetchSnapshot(host, directory, false);
  } catch (error) {
    throw new Error(messageOf(error));
  }
  if (!snapshot.engine.running) throw new Error(`${snapshot.engine.name} isn't running.`);
  const query = args.trim();
  let row = query ? findContainer(snapshot.containers, query, directory) : null;
  if (!query) {
    // No name: the open project's container that needs a look, or its only one.
    const mine = groupContainers(snapshot.containers, snapshot.project).project.flatMap((stack) => stack.containers);
    row = mine.find(needsAttention) ?? (mine.length === 1 ? mine[0] ?? null : null);
  }
  if (!row) {
    const names = groupContainers(snapshot.containers, snapshot.project);
    const suggestions = [...names.project.flatMap((stack) => stack.containers), ...names.standalone, ...names.stacks.flatMap((stack) => stack.containers)]
      .slice(0, 6)
      .map(label);
    const hint = suggestions.length > 0 ? ` Try ${suggestions.map((name) => `/docker ${name}`).join(', ')}.` : ' There are no containers.';
    throw new Error(query ? `No container matches "${query}".${hint}` : `Name a container.${hint}`);
  }
  return containerChip(host, row);
});
