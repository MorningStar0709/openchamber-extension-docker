// What the panel shows while Docker itself isn't there: which engine this
// machine uses, how to start it, and a button that does when it can.
import { mountButton } from '@openchamber/sdk/ui';

import { postJob } from '../shared/client.ts';
import { el, setText, textButton } from '../shared/dom.ts';
import type { Snapshot } from '../shared/types.ts';
import type { App } from './app.ts';

/** After `open -a Docker` returns, the daemon still needs a while; keep saying "starting" this long. */
const STARTING_GRACE_MS = 90_000;

/** Colima and Lima log as `time="…" level=info msg="…"`; the message is what people read. */
const readableOutput = (output: string): string => output
  .split('\n')
  .map((line) => /\bmsg="((?:[^"\\]|\\.)*)"/.exec(line)?.[1]?.replace(/\\"/g, '"') ?? line)
  .filter((line) => line.trim())
  .slice(-6)
  .join('\n');

export type EngineView = { element: HTMLElement; update: (snapshot: Snapshot) => void };

export const createEngineView = (app: App, banner: HTMLElement, refresh: () => void): EngineView => {
  const title = el('div', 'title');
  const subtitle = el('div', 'subtitle');
  const live = el('div', 'live stale', 'Paused');
  const head = el('div', 'head', '', [el('div', 'titles', '', [title, subtitle]), live]);

  const big = el('div', 'big');
  const text = el('div', 'muted');
  const commandText = el('span');
  const command = el('div', 'command', '', [commandText, textButton('Copy', () => app.copy(commandText.textContent ?? '', 'Command copied'))]);
  const buttons = el('div', 'buttons');
  const problem = el('div', 'problem');
  const output = el('div', 'output');
  const footnote = el('div', 'muted', 'The panel checks again every few seconds.');
  const card = el('div', 'engine-card', '', [big, text, command, buttons, output, problem, footnote]);
  const element = el('div', 'view', '', [head, banner, card]);

  let startedAt = 0;
  let buttonsKey = '';

  return {
    element,
    update: (snapshot) => {
      const { engine } = snapshot;
      setText(title, engine.name);
      setText(subtitle, [engine.context ? `context ${engine.context}` : '', engine.endpoint ?? ''].filter(Boolean).join(' · '));
      const job = snapshot.jobs.filter((row) => row.kind === 'engine').pop();
      const starting = engine.starting || (job?.state === 'done' && Date.now() - startedAt < STARTING_GRACE_MS);
      if (engine.starting) startedAt = startedAt || Date.now();

      if (engine.cliMissing) {
        setText(big, 'Docker isn\'t installed');
        setText(text, 'There is no docker command on this machine, or it isn\'t on the PATH OpenChamber runs with.');
        command.hidden = true;
      } else if (starting) {
        setText(big, `Starting ${engine.name}…`);
        setText(text, 'This can take a minute. The containers show up here as soon as Docker answers.');
        command.hidden = true;
      } else {
        setText(big, `${engine.name} isn't running`);
        setText(text, engine.kind === 'unknown' || engine.kind === 'remote'
          ? 'The docker command can\'t reach its daemon.'
          : `Start it and the containers show up here.`);
        command.hidden = !engine.start;
        setText(commandText, engine.start?.display ?? '');
      }
      const failed = job?.state === 'failed';
      output.hidden = !(starting || failed) || !job?.output;
      setText(output, readableOutput(job?.output ?? ''));
      output.scrollTop = output.scrollHeight;
      // The daemon's own error only helps when we can't tell which engine this is.
      problem.hidden = starting || !engine.problem || (engine.kind !== 'unknown' && engine.kind !== 'remote');
      setText(problem, engine.problem ?? '');

      const key = `${engine.cliMissing}/${starting}/${engine.start?.canRun ?? ''}`;
      if (key !== buttonsKey) {
        buttonsKey = key;
        buttons.replaceChildren();
        if (engine.cliMissing) {
          buttons.append(textButton('How to install Docker', () => app.openUrl('https://docs.docker.com/get-started/get-docker/'), 'primary'));
        } else if (!starting) {
          if (engine.start?.canRun) {
            mountButton(buttons, {
              label: `Start ${engine.name}`,
              size: 'sm',
              onClick: () => {
                startedAt = Date.now();
                app.run(() => postJob(app.host, '/engine/start'));
              },
            });
          }
          buttons.append(textButton('Check again', refresh));
        }
      }
    },
  };
};
