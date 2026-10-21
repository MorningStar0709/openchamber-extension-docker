// The Files, Shell and Inspect tabs of a container.
import { getJson, messageOf, postJob, postJson } from '../shared/client.ts';
import { el, textButton } from '../shared/dom.ts';
import { portUrl } from '../shared/stacks.ts';
import type { Container, ExecAnswer, FsFile, FsListing, InspectAnswer } from '../shared/types.ts';
import type { App } from './app.ts';

export type TabView = {
  element: HTMLElement;
  show: () => void;
  hide: () => void;
  dispose: () => void;
  /** The container's state changed (it stopped, it started). */
  refresh?: (row: Container) => void;
};

const notRunning = (app: App, row: Container, what: string): HTMLElement => el('div', 'message', '', [
  el('span', '', `Start the container to ${what}.`),
  textButton('Start', () => app.run(() => postJob(app.host, `/containers/${row.id}/start`)), 'primary'),
]);

// ----- Files -----

export const createFilesTab = (app: App, getContainer: () => Container): TabView => {
  let path = '/';
  let showHidden = app.prefs.get<boolean>('files-hidden', true);
  let generation = 0;
  const crumbs = el('div', 'crumbs');
  const hiddenToggle = el('button', 'toggle', 'Hidden');
  hiddenToggle.type = 'button';
  const copyPath = textButton('Copy path', () => app.copy(path, 'Path copied'));
  const toolbar = el('div', 'toolbar', '', [el('span', 'grow', '', [crumbs]), hiddenToggle, copyPath]);
  const body = el('div', 'files');
  const element = el('div', 'tab-body', '', [toolbar, body]);
  let listing: FsListing | null = null;

  const paintCrumbs = (): void => {
    const parts = path.split('/').filter(Boolean);
    const nodes: HTMLElement[] = [];
    const root = el('button', '', '/');
    root.type = 'button';
    root.addEventListener('click', () => void go('/'));
    nodes.push(root);
    parts.forEach((part, index) => {
      const target = `/${parts.slice(0, index + 1).join('/')}`;
      const button = el('button', '', part);
      button.type = 'button';
      button.addEventListener('click', () => void go(target));
      nodes.push(button);
      if (index < parts.length - 1) nodes.push(el('span', 'muted', '/'));
    });
    crumbs.replaceChildren(...nodes);
  };

  const paintListing = (): void => {
    if (!listing) return;
    const entries = listing.entries.filter((entry) => showHidden || !entry.name.startsWith('.'));
    const rows = entries.map((entry) => {
      const glyph = entry.type === 'dir' ? '▸' : entry.type === 'link' ? '↪' : '';
      const row = el('button', `file ${entry.type === 'dir' ? 'dir' : ''} ${entry.name.startsWith('.') ? 'hidden-file' : ''}`, '', [
        el('span', 'icon', glyph),
        el('span', 'fname', entry.name),
      ]);
      row.type = 'button';
      const target = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
      // A link may point at a folder or a file; the listing call tells which.
      row.addEventListener('click', () => void (entry.type === 'file' ? openFile(target) : go(target)));
      return row;
    });
    if (rows.length === 0) body.replaceChildren(el('div', 'message', listing.entries.length > 0 ? 'Only hidden files here.' : 'This folder is empty.'));
    else body.replaceChildren(...rows);
    if (listing.truncated) body.append(el('div', 'muted', 'Showing the first 1000 entries.'));
  };

  const go = async (target: string): Promise<void> => {
    const row = getContainer();
    if (row.state !== 'running') {
      body.replaceChildren(notRunning(app, row, 'browse its files'));
      return;
    }
    const mine = ++generation;
    path = target;
    paintCrumbs();
    body.replaceChildren(el('div', 'message', 'Reading…'));
    try {
      const answer = await getJson<FsListing>(app.host, `/containers/${row.id}/fs`, { path: target });
      if (mine !== generation) return;
      listing = answer;
      paintListing();
    } catch (failure) {
      if (mine !== generation) return;
      // A link to a file answers "Not a folder": open it as a file instead.
      if (/Not a folder/.test(messageOf(failure))) {
        await openFile(target);
        return;
      }
      body.replaceChildren(el('div', 'message', messageOf(failure)));
    }
  };

  const openFile = async (target: string): Promise<void> => {
    const row = getContainer();
    const mine = ++generation;
    path = target;
    paintCrumbs();
    body.replaceChildren(el('div', 'message', 'Reading…'));
    try {
      const file = await getJson<FsFile>(app.host, `/containers/${row.id}/fs/file`, { path: target });
      if (mine !== generation) return;
      if (file.binary || file.content === null) {
        body.replaceChildren(el('div', 'message', `A binary file of ${file.size} bytes${file.truncated ? ' or more' : ''}. Only text files open here.`));
        return;
      }
      const pre = el('pre', 'code wrap', file.content);
      const copy = textButton('Copy contents', () => app.copy(file.content ?? '', 'File copied'));
      const note = el('div', 'foot', '', [el('span', 'grow', file.truncated ? 'Showing the first 512 KB.' : `${file.content.split('\n').length} lines`), copy]);
      body.replaceChildren(pre, note);
    } catch (failure) {
      if (mine !== generation) return;
      body.replaceChildren(el('div', 'message', messageOf(failure)));
    }
  };

  hiddenToggle.addEventListener('click', () => {
    showHidden = !showHidden;
    app.prefs.set('files-hidden', showHidden);
    hiddenToggle.setAttribute('aria-pressed', String(showHidden));
    paintListing();
  });
  hiddenToggle.setAttribute('aria-pressed', String(showHidden));

  let started = false;
  return {
    element,
    show: () => {
      if (!started || getContainer().state !== 'running') {
        started = true;
        void go(path);
      }
    },
    hide: () => undefined,
    dispose: () => {
      generation += 1;
    },
    refresh: (row) => {
      if (row.state === 'running' && !listing) void go(path);
      if (row.state !== 'running') body.replaceChildren(notRunning(app, row, 'browse its files'));
    },
  };
};

// ----- Shell -----

const PRESETS = ['ls -la', 'env | sort', 'ps aux', 'df -h', 'cat /etc/os-release'];

export const createShellTab = (app: App, getContainer: () => Container): TabView => {
  let cwd = '';
  let running = false;
  const history: string[] = [];
  let historyAt = -1;
  const transcript = el('div', 'shell');
  // How the shell works, until the first command shows it.
  const intro = el('div', 'muted', 'Each command runs on its own with sh -c, in the folder the last one left. Nothing interactive: no editors, no prompts, 18 seconds at most.');
  transcript.append(intro);
  const presets = el('div', 'presets');
  const cwdLabel = el('span', 'cwd');
  const input = el('input', 'field mono');
  input.placeholder = 'Command';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  const prompt = el('form', 'prompt', '', [cwdLabel, input]);
  const element = el('div', 'tab-body', '', [transcript, presets, prompt]);

  const runCommand = async (command: string): Promise<void> => {
    const row = getContainer();
    if (running || !command.trim()) return;
    running = true;
    input.disabled = true;
    intro.remove();
    history.push(command);
    historyAt = -1;
    const entry = el('div', '', '', [el('div', 'cmd', '', [el('span', 'cwd', `${cwd || '/'} `), document.createTextNode(`$ ${command}`)])]);
    const out = el('div', 'out muted', '…');
    entry.append(out);
    transcript.append(entry);
    transcript.scrollTop = transcript.scrollHeight;
    try {
      const answer = await postJson<ExecAnswer>(app.host, `/containers/${row.id}/exec`, { command, cwd: cwd || undefined });
      out.className = 'out';
      out.textContent = (answer.truncated ? '…\n' : '') + (answer.output || '');
      if (!answer.output) out.remove();
      if (answer.exitCode !== 0) entry.append(el('div', 'exit', `exit ${answer.exitCode}`));
      cwd = answer.cwd;
      cwdLabel.textContent = cwd;
    } catch (failure) {
      out.className = 'out exit';
      out.textContent = messageOf(failure);
    } finally {
      running = false;
      input.disabled = false;
      input.focus();
      transcript.scrollTop = transcript.scrollHeight;
    }
  };

  for (const preset of PRESETS) {
    const button = el('button', 'preset', preset);
    button.type = 'button';
    button.addEventListener('click', () => void runCommand(preset));
    presets.append(button);
  }
  prompt.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = input.value;
    input.value = '';
    void runCommand(command);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (history.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') historyAt = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1);
    else historyAt = historyAt < 0 ? -1 : historyAt + 1;
    if (historyAt >= history.length) historyAt = -1;
    input.value = historyAt < 0 ? '' : history[historyAt] ?? '';
  });

  const gate = (row: Container): void => {
    const up = row.state === 'running';
    prompt.hidden = !up;
    presets.hidden = !up;
    const blocker = transcript.querySelector('.message');
    if (!up && !blocker) transcript.append(notRunning(app, row, 'run commands in it'));
    if (up && blocker) blocker.remove();
  };

  return {
    element,
    show: () => {
      const row = getContainer();
      gate(row);
      if (!cwd) {
        // Start where the image says to work.
        void getJson<InspectAnswer>(app.host, `/containers/${row.id}/inspect`).then((info) => {
          if (!cwd) {
            cwd = info.workingDir || '/';
            cwdLabel.textContent = cwd;
          }
        }).catch(() => undefined);
      }
      if (row.state === 'running') setTimeout(() => input.focus(), 0);
    },
    hide: () => undefined,
    dispose: () => undefined,
    refresh: gate,
  };
};

// ----- Inspect -----

const SECRET = /(pass(word)?|secret|token|key|credential|auth|private)/i;

const kv = (pairs: [string, string | HTMLElement][], mono = false): HTMLElement => el('div', 'kv', '', pairs.flatMap(([key, value]) => [
  el('span', 'k', key),
  typeof value === 'string' ? el('span', mono ? 'v mono' : 'v', value || '–') : value,
]));

const section = (title: string, body: HTMLElement): HTMLElement => el('section', 'section', '', [el('div', 'section-head', '', [el('span', 'label', title)]), body]);

export const createInspectTab = (app: App, getContainer: () => Container): TabView => {
  const body = el('div', 'inspect');
  const element = el('div', 'tab-body', '', [body]);
  let generation = 0;

  const paint = (info: InspectAnswer): void => {
    const overview = kv([
      ['Image', info.image],
      ['Id', info.id.slice(0, 12)],
      ['Created', new Date(info.createdAt).toLocaleString()],
      ['Command', info.command],
      ['Entrypoint', info.entrypoint],
      ['Working dir', info.workingDir],
      ['User', info.user || 'root'],
      ['Restart', `${info.restartPolicy}${info.restartCount > 0 ? ` · ${info.restartCount} restarts` : ''}`],
    ]);
    const copyJson = textButton('Copy JSON', () => app.copy(JSON.stringify(info.raw, null, 2), 'Inspect JSON copied'));
    const parts: HTMLElement[] = [el('div', 'toolbar', '', [el('span', 'grow'), copyJson]), section('Overview', overview)];
    if (info.ports.length > 0) {
      parts.push(section('Ports', kv(info.ports.map((port) => {
        const value = el('span', 'v mono');
        const chip = el('button', port.protocol === 'tcp' ? 'port' : 'port plain', port.protocol === 'tcp' ? portUrl(port).replace(/^http:\/\//, '') : `${port.hostIp}:${port.hostPort}`);
        chip.type = 'button';
        if (port.protocol === 'tcp') chip.addEventListener('click', () => app.openUrl(portUrl(port)));
        value.append(chip);
        return [`${port.containerPort}/${port.protocol}`, value];
      }))));
    }
    if (info.networks.length > 0) {
      parts.push(section('Networks', kv(info.networks.map((network) => [network.name, [network.ip, ...network.aliases.slice(0, 3)].filter(Boolean).join(' · ')]), true)));
    }
    if (info.mounts.length > 0) {
      parts.push(section('Mounts', kv(info.mounts.map((mount) => [mount.destination, `${mount.type === 'volume' ? `volume ${mount.name}` : mount.source}${mount.rw ? '' : ' (read-only)'}`]), true)));
    }
    if (info.env.length > 0) {
      parts.push(section('Environment', kv(info.env.map((line) => {
        const at = line.indexOf('=');
        const key = at < 0 ? line : line.slice(0, at);
        const value = at < 0 ? '' : line.slice(at + 1);
        if (!SECRET.test(key) || !value) return [key, value];
        // Looks like a secret: hidden until clicked.
        const masked = el('span', 'v mono secret', '•••••• show');
        masked.addEventListener('click', () => {
          masked.textContent = value;
          masked.classList.remove('secret');
        }, { once: true });
        return [key, masked];
      }), true)));
    }
    const labels = Object.entries(info.labels).filter(([key]) => !key.startsWith('com.docker.compose.') && !key.startsWith('org.opencontainers.'));
    if (labels.length > 0) parts.push(section('Labels', kv(labels, true)));
    body.replaceChildren(...parts);
  };

  const load = async (): Promise<void> => {
    const mine = ++generation;
    if (!body.firstChild) body.append(el('div', 'message', 'Reading…'));
    try {
      const info = await getJson<InspectAnswer>(app.host, `/containers/${getContainer().id}/inspect`);
      if (mine === generation) paint(info);
    } catch (failure) {
      if (mine === generation) body.replaceChildren(el('div', 'message', messageOf(failure)));
    }
  };

  return {
    element,
    show: () => void load(),
    hide: () => undefined,
    dispose: () => {
      generation += 1;
    },
  };
};
