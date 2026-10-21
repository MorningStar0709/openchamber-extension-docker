// Disk space by category with one cleanup each, then the images, volumes and
// networks themselves. Read when the view opens and after a job ends.
import { getJson, messageOf, postJob } from '../shared/client.ts';
import { el, textButton } from '../shared/dom.ts';
import { formatDisk, plural } from '../shared/format.ts';
import type { DiskCategory, ImageRow, StorageAnswer } from '../shared/types.ts';
import { armButton, type App } from './app.ts';

const CATEGORY: Record<DiskCategory['kind'], { label: string; color: string }> = {
  images: { label: 'Images', color: 'var(--oc-primary)' },
  'build-cache': { label: 'Build cache', color: 'var(--oc-info, var(--oc-success))' },
  volumes: { label: 'Volumes', color: 'var(--oc-warning)' },
  containers: { label: 'Stopped containers', color: 'var(--oc-muted)' },
};

const ORDER: DiskCategory['kind'][] = ['images', 'build-cache', 'volumes', 'containers'];

/** What a cleanup removes, asked on the button before it runs. */
const cleanupQuestion = (category: DiskCategory, answer: StorageAnswer): string => {
  switch (category.kind) {
    case 'images': {
      const unused = answer.images.filter((image) => !image.used).length;
      return `Remove ${plural(unused, 'unused image')}?`;
    }
    case 'volumes': {
      const unused = answer.volumes.filter((volume) => !volume.used).length;
      return `Delete ${plural(unused, 'unused volume')} and their data?`;
    }
    case 'containers':
      return `Remove ${plural(category.total - category.active, 'stopped container')}?`;
    default:
      return 'Clear the build cache?';
  }
};

const imageName = (image: ImageRow): string => {
  if (image.dangling) return `<untagged> ${image.id.replace(/^sha256:/, '').slice(0, 12)}`;
  return image.tag === '<none>' ? `${image.repository} (untagged)` : `${image.repository}:${image.tag}`;
};

export type StorageView = { element: HTMLElement; refresh: () => void; dispose: () => void };

export const createStorage = (app: App, onSummary: (total: number, reclaimable: number) => void): StorageView => {
  const back = textButton('‹', () => app.goHome(), 'back');
  const refreshButton = textButton('Refresh', () => void load());
  const head = el('div', 'head', '', [back, el('div', 'titles', '', [el('div', 'title', 'Storage'), el('div', 'subtitle', 'Disk space Docker uses on this machine')]), refreshButton]);
  const body = el('div', 'section');
  body.append(el('div', 'message', 'Reading disk use… this can take a few seconds.'));
  const element = el('div', 'view', '', [head, body]);
  let generation = 0;
  const open = new Set<string>();

  const runJob = (path: string, payload: unknown): void => app.run(() => postJob(app.host, path, payload));

  const paint = (answer: StorageAnswer): void => {
    const total = answer.disk.reduce((sum, row) => sum + row.size, 0);
    const reclaimable = answer.disk.reduce((sum, row) => sum + row.reclaimable, 0);
    onSummary(total, reclaimable);

    const bar = el('div', 'disk');
    const rows: HTMLElement[] = [];
    for (const kind of ORDER) {
      const category = answer.disk.find((row) => row.kind === kind);
      if (!category) continue;
      const meta = CATEGORY[kind];
      const segment = el('span');
      segment.style.width = `${total > 0 ? (category.size / total) * 100 : 0}%`;
      segment.style.background = meta.color;
      bar.append(segment);
      const swatch = el('span', 'swatch');
      swatch.style.background = meta.color;
      const job = app.jobFor('prune', kind);
      const action = job
        ? el('span', 'detail busy', `${job.label}…`)
        : category.reclaimable > 0
          ? armButton('Clean up', cleanupQuestion(category, answer), () => runJob('/storage/prune', { kind }))
          : el('span');
      rows.push(el('div', 'disk-row', '', [
        swatch,
        el('span', '', `${meta.label} `, [el('span', 'muted', `${formatDisk(category.size)}`)]),
        el('span', 'muted num', category.reclaimable > 0 ? `${formatDisk(category.reclaimable)} free` : ''),
        action,
      ]));
    }
    const summary = el('div', 'card', '', [
      el('div', 'section-head', '', [el('span', 'label grow', 'Disk'), el('span', 'big num', formatDisk(total))]),
      bar,
      ...rows,
      el('div', 'muted', reclaimable > 0 ? `${formatDisk(reclaimable)} can be freed. Each cleanup asks before it runs.` : 'Nothing to clean up.'),
    ]);

    const list = (id: string, title: string, count: string, items: HTMLElement[], extra?: HTMLElement): HTMLElement => {
      const isOpen = open.has(id);
      const head = el('div', 'group-head', '', [el('span', 'gname', '', [el('b', '', title), el('span', 'muted', count)]), el('span'), el('span'), el('span'), el('span')]);
      head.tabIndex = 0;
      head.setAttribute('role', 'button');
      head.setAttribute('aria-expanded', String(isOpen));
      const toggle = (): void => {
        if (open.has(id)) open.delete(id);
        else open.add(id);
        paint(answer);
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
      const groupBody = el('div', 'group-body', '', extra ? [extra, ...items] : items);
      return el('div', isOpen ? 'group open' : 'group', '', [head, groupBody]);
    };

    const pullField = el('input', 'field mono');
    pullField.placeholder = 'Image to pull, such as postgres:17';
    const pullForm = el('form', 'pull', '', [pullField, textButton('Pull', () => pullForm.requestSubmit(), 'primary')]);
    pullForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const ref = pullField.value.trim();
      if (!ref) return;
      pullField.value = '';
      runJob('/images/pull', { ref });
    });

    const images = [...answer.images].sort((a, b) => Number(b.used) - Number(a.used) || b.size - a.size).map((image) => {
      const name = imageName(image);
      const job = app.jobFor('remove', `image:${image.id}`);
      const action = job ? el('span', 'detail busy', 'Removing…')
        : image.used ? el('span', 'badge ok', 'in use')
          : armButton('Remove', `Remove ${name}?`, () => runJob('/image/remove', { ref: image.id, name }));
      return el('div', 'item', '', [
        el('div', 'who', '', [el('span', 'name mono', name), el('span', 'detail', image.createdSince)]),
        el('span', 'muted num', formatDisk(image.size)),
        action,
      ]);
    });
    const volumes = [...answer.volumes].sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)).map((volume) => {
      const job = app.jobFor('remove', `volume:${volume.name}`);
      // Anonymous volumes are named by a 64-character hash; twelve characters tell them apart.
      const anonymous = /^[0-9a-f]{64}$/.test(volume.name);
      const short = anonymous ? volume.name.slice(0, 12) : volume.name;
      const action = job ? el('span', 'detail busy', 'Removing…')
        : volume.used ? el('span', 'badge ok', 'in use')
          : armButton('Delete', `Delete ${short} and its data?`, () => runJob('/volume/remove', { ref: volume.name, name: short }));
      const item = el('div', 'item', '', [
        el('div', 'who', '', [el('span', 'name mono', short), el('span', 'detail', [anonymous ? 'anonymous' : '', volume.driver, volume.project ? `from ${volume.project}` : ''].filter(Boolean).join(' · '))]),
        el('span'),
        action,
      ]);
      item.title = volume.name;
      return item;
    });
    const networks = answer.networks.filter((network) => !network.builtIn).map((network) => {
      const job = app.jobFor('remove', `network:${network.id}`);
      const action = job ? el('span', 'detail busy', 'Removing…')
        : network.used ? el('span', 'badge ok', 'in use')
          : armButton('Remove', `Remove ${network.name}?`, () => runJob('/network/remove', { ref: network.id, name: network.name }));
      return el('div', 'item', '', [el('div', 'who', '', [el('span', 'name', network.name), el('span', 'detail', network.driver)]), el('span'), action]);
    });

    const unusedImages = answer.images.filter((image) => !image.used).length;
    const unusedVolumes = answer.volumes.filter((volume) => !volume.used).length;
    body.replaceChildren(
      summary,
      list('images', 'Images', `${answer.images.length}${unusedImages ? ` · ${unusedImages} unused` : ''}`, images, pullForm),
      list('volumes', 'Volumes', `${answer.volumes.length}${unusedVolumes ? ` · ${unusedVolumes} unused` : ''}`, volumes.length ? volumes : [el('div', 'empty-note', 'No volumes.')]),
      list('networks', 'Networks', `${networks.length}`, networks.length ? networks : [el('div', 'empty-note', 'Only Docker\'s own bridge, host and none.')]),
    );
  };

  let last: StorageAnswer | null = null;
  const load = async (): Promise<void> => {
    const mine = ++generation;
    refreshButton.disabled = true;
    try {
      const answer = await getJson<StorageAnswer>(app.host, '/storage');
      if (mine !== generation) return;
      last = answer;
      paint(answer);
    } catch (failure) {
      if (mine !== generation) return;
      body.replaceChildren(el('div', 'banner error', messageOf(failure)));
    } finally {
      if (mine === generation) refreshButton.disabled = false;
    }
  };
  void load();

  return {
    element,
    /** A job started or ended: repaint busy states now, re-read the disk. */
    refresh: () => {
      if (last) paint(last);
      void load();
    },
    dispose: () => {
      generation += 1;
    },
  };
};
