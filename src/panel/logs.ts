// The Logs tab: the last lines, then new ones every two seconds while Live is
// on, fetched with `--since` so only what's new crosses the wire.
import { containerChip } from '../shared/chip.ts';
import { getJson, messageOf } from '../shared/client.ts';
import { el } from '../shared/dom.ts';
import type { Container, LogEntry, LogsAnswer } from '../shared/types.ts';
import type { App } from './app.ts';

const POLL_MS = 2_000;
const TAILS = [500, 2_000, 5_000];
const KEEP = 5_000;

// Upper-case level words anywhere, and `Error:` / `Warning:` the way stack traces and Node print them.
const LEVEL = /\b(?:FATAL|PANIC|CRIT(?:ICAL)?|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b|\b(?:Fatal|Error|Exception|Panic|Warning)\b(?=:)/;
const levelClass = (word: string): string => {
  const upper = word.toUpperCase();
  if (upper.startsWith('WARN')) return 'lvl-warn';
  if (upper === 'INFO') return 'lvl-info';
  if (upper === 'DEBUG' || upper === 'TRACE') return 'lvl-debug';
  return 'lvl-error';
};

const time = (stamp: string): string => {
  const at = new Date(stamp);
  return Number.isFinite(at.getTime()) ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
};

/** Message text with the level word coloured and filter matches marked. */
const messageNode = (text: string, filter: string): HTMLElement => {
  const node = el('span', 'msg');
  const level = LEVEL.exec(text);
  const parts: { text: string; className?: string }[] = level
    ? [{ text: text.slice(0, level.index) }, { text: level[0], className: levelClass(level[0]) }, { text: text.slice(level.index + level[0].length) }]
    : [{ text }];
  for (const part of parts) {
    if (!part.text) continue;
    const target = part.className ? el('span', part.className) : node;
    if (filter) {
      const lower = part.text.toLowerCase();
      let at = 0;
      let hit = lower.indexOf(filter, at);
      while (hit >= 0) {
        target.append(document.createTextNode(part.text.slice(at, hit)), el('mark', '', part.text.slice(hit, hit + filter.length)));
        at = hit + filter.length;
        hit = lower.indexOf(filter, at);
      }
      target.append(document.createTextNode(part.text.slice(at)));
    } else {
      target.append(document.createTextNode(part.text));
    }
    if (target !== node) node.append(target);
  }
  return node;
};

export const createLogsTab = (app: App, getContainer: () => Container) => {
  let entries: LogEntry[] = [];
  let tail = TAILS[0] ?? 500;
  let live = true;
  let wrap = app.prefs.get<boolean>('logs-wrap', true);
  let filter = '';
  let loading = false;
  let error = '';
  let truncatedFront = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let generation = 0;

  const field = el('input', 'field');
  field.placeholder = 'Filter lines';
  field.type = 'search';
  const liveToggle = el('button', 'toggle', 'Live');
  const wrapToggle = el('button', 'toggle', 'Wrap');
  const copy = el('button', 'tb', 'Copy');
  const attach = el('button', 'tb primary', 'Attach to chat');
  for (const button of [liveToggle, wrapToggle, copy, attach]) button.type = 'button';
  const toolbar = el('div', 'toolbar', '', [el('span', 'grow', '', [field]), liveToggle, wrapToggle, copy, attach]);
  const code = el('div', 'code');
  const status = el('span', 'grow');
  const older = el('button', 'linkish', 'Load older');
  older.type = 'button';
  const foot = el('div', 'foot', '', [status, older]);
  const element = el('div', 'tab-body', '', [toolbar, code, foot]);

  const atBottom = (): boolean => code.scrollHeight - code.scrollTop - code.clientHeight < 30;
  const lineNode = (entry: LogEntry): HTMLElement => el('div', 'log-line', '', [el('span', 'ts', time(entry.t)), messageNode(entry.m, filter)]);
  const matches = (entry: LogEntry): boolean => !filter || entry.m.toLowerCase().includes(filter);

  const paintStatus = (): void => {
    liveToggle.setAttribute('aria-pressed', String(live));
    wrapToggle.setAttribute('aria-pressed', String(wrap));
    code.classList.toggle('wrap', wrap);
    const shown = filter ? entries.filter(matches).length : entries.length;
    status.textContent = error
      || (loading && entries.length === 0 ? 'Reading logs…'
        : `${filter ? `${shown} of ` : ''}${entries.length} lines${live ? ' · following live' : ''}${truncatedFront ? ' · older lines cut' : ''}`);
    older.hidden = tail >= (TAILS[TAILS.length - 1] ?? 5_000) || entries.length < tail;
  };

  const repaint = (): void => {
    const stick = atBottom();
    const nodes = entries.filter(matches).map(lineNode);
    if (nodes.length === 0) nodes.push(el('div', 'muted', loading ? 'Reading logs…' : filter ? 'No lines match.' : 'Nothing logged yet.'));
    code.replaceChildren(...nodes);
    if (stick) code.scrollTop = code.scrollHeight;
    paintStatus();
  };

  const append = (fresh: LogEntry[]): void => {
    if (fresh.length === 0) return;
    const stick = atBottom();
    if (entries.length === 0) {
      entries = fresh;
      repaint();
      return;
    }
    entries.push(...fresh);
    const overflow = entries.length - KEEP;
    if (overflow > 0) {
      entries.splice(0, overflow);
      truncatedFront = true;
      repaint();
      return;
    }
    const nodes = fresh.filter(matches).map(lineNode);
    if (code.firstElementChild?.classList.contains('muted')) code.replaceChildren();
    code.append(...nodes);
    if (stick) code.scrollTop = code.scrollHeight;
    paintStatus();
  };

  const fetchLogs = async (sinceLast: boolean): Promise<void> => {
    const row = getContainer();
    const mine = generation;
    const query: Record<string, string> = { tail: String(tail) };
    const last = entries[entries.length - 1];
    if (sinceLast && last) query.since = last.t;
    try {
      const answer = await getJson<LogsAnswer>(app.host, `/containers/${row.id}/logs`, query);
      if (mine !== generation) return;
      error = '';
      if (sinceLast && last) append(answer.entries);
      else {
        entries = answer.entries;
        truncatedFront = answer.truncated;
        repaint();
        code.scrollTop = code.scrollHeight;
      }
    } catch (failure) {
      if (mine !== generation) return;
      error = messageOf(failure);
      paintStatus();
    }
  };

  const schedule = (): void => {
    clearTimeout(timer);
    if (!active || !live) return;
    timer = setTimeout(() => {
      void (async () => {
        if (!document.hidden && element.getBoundingClientRect().width > 0) await fetchLogs(true);
        schedule();
      })();
    }, POLL_MS);
  };

  const reload = async (): Promise<void> => {
    generation += 1;
    loading = true;
    paintStatus();
    await fetchLogs(false);
    loading = false;
    paintStatus();
    schedule();
  };

  field.addEventListener('input', () => {
    filter = field.value.trim().toLowerCase();
    repaint();
  });
  liveToggle.addEventListener('click', () => {
    live = !live;
    paintStatus();
    if (live) void fetchLogs(true).then(schedule);
    else clearTimeout(timer);
  });
  wrapToggle.addEventListener('click', () => {
    wrap = !wrap;
    app.prefs.set('logs-wrap', wrap);
    paintStatus();
  });
  copy.addEventListener('click', () => {
    const lines = entries.filter(matches).map((entry) => `${entry.t} ${entry.m}`).join('\n');
    if (lines) app.copy(lines.slice(-32_000), filter ? 'Matching lines copied' : 'Logs copied');
  });
  attach.addEventListener('click', () => {
    attach.disabled = true;
    void containerChip(app.host, getContainer())
      .then((chip) => app.host.attach(chip))
      .catch((failure) => app.host.toast({ kind: 'error', message: messageOf(failure) }))
      .finally(() => {
        attach.disabled = false;
      });
  });
  older.addEventListener('click', () => {
    tail = TAILS.find((value) => value > tail) ?? tail;
    void reload();
  });

  return {
    element,
    show: () => {
      active = true;
      if (entries.length === 0) void reload();
      else void fetchLogs(true).then(schedule);
    },
    hide: () => {
      active = false;
      clearTimeout(timer);
    },
    dispose: () => {
      active = false;
      generation += 1;
      clearTimeout(timer);
    },
  };
};
