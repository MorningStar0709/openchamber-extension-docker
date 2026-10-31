import { describe, expect, test } from 'bun:test';

import { PRUNE, PULL_LABEL, PRESENT, STACK_PRESENT } from '../service/actions.ts';
import { plural } from './format.ts';
import { setLocale, t } from './i18n.ts';

const hasChinese = /[\u4e00-\u9fff]/;

describe('t', () => {
  test('returns the English source for English and unknown text', () => {
    setLocale('en');
    expect(t('Start')).toBe('Start');
    setLocale('zh-CN');
    expect(t('a string the dictionary does not know')).toBe('a string the dictionary does not know');
  });

  test('translates exact strings and dynamic sentences', () => {
    setLocale('zh-CN');
    expect(t('Start')).toBe('启动');
    expect(t('Starting Docker…')).toBe('正在启动 Docker…');
    expect(t('Docker isn\'t running.')).toBe('Docker 未运行。');
    expect(t('web failed: exit 1')).toBe('web 失败：exit 1');
    expect(t('+3 more in the Docker panel')).toBe('另有 3 项，见 Docker 面板');
    expect(t('up 2 分钟')).toBe('运行 2 分钟');
  });

  test('follows the host locale, including zh-TW', () => {
    setLocale('zh-TW');
    expect(t('Logs')).toBe('日志');
    setLocale('en');
    expect(t('Logs')).toBe('Logs');
  });
});

// The service hands job labels to the UI as English sentences built from
// these tables. A verb added there without a pattern here leaks English, so
// the tables themselves are pinned by the tests below.
describe('job labels from the service', () => {
  test('every running verb translates with the name kept', () => {
    setLocale('zh-CN');
    const verbs = [...Object.values(PRESENT), ...Object.values(STACK_PRESENT), PULL_LABEL];
    for (const verb of [...new Set(verbs)]) {
      // not.toContain('undefined'): RUNNING is keyed by hand, a verb with a
      // pattern but no map entry would otherwise pass on the 正在 prefix.
      // not.toContain(verb): a half-translation keeps the English verb.
      expect(t(`${verb} web…`), verb).toMatch(hasChinese);
      expect(t(`${verb} web…`), verb).not.toContain('undefined');
      expect(t(`${verb} web…`), verb).not.toContain(verb);
      expect(t(`${verb} web failed: exit 1`), verb).toMatch(hasChinese);
      expect(t(`${verb} web failed: exit 1`), verb).not.toContain('undefined');
      expect(t(`${verb} web failed: exit 1`), verb).not.toContain(verb);
    }
    // Exact answers, not just "has Chinese": a renamed prune label that
    // starts with a RUNNING verb would pass a loose sweep via the generic
    // verb pattern while still leaking English (`正在移除 dangling images…`).
    const PRUNE_ZH: Record<string, [running: string, failed: string]> = {
      'Removing unused images': ['正在移除未使用的镜像…', '移除未使用的镜像 失败：exit 1'],
      'Removing unused volumes': ['正在移除未使用的卷…', '移除未使用的卷 失败：exit 1'],
      'Removing stopped containers': ['正在移除已停止的容器…', '移除已停止的容器 失败：exit 1'],
      'Clearing the build cache': ['正在清空构建缓存…', '清空构建缓存 失败：exit 1'],
    };
    for (const { label } of Object.values(PRUNE)) {
      const expected = PRUNE_ZH[label];
      if (!expected) throw new Error(`prune label "${label}" needs an exact pin in i18n.test.ts`);
      expect(t(`${label}…`), label).toBe(expected[0]);
      expect(t(`${label} failed: exit 1`), label).toBe(expected[1]);
    }
    // Composed row details translate their parts before joining; a pattern
    // must never rewrite one from the outside.
    expect(t('nginx:latest · just started')).toBe('nginx:latest · just started');
  });

  test('finished-job and toast sentences translate', () => {
    setLocale('zh-CN');
    expect(t('Pulled nginx:latest')).toMatch(hasChinese);
    expect(t('web is up')).toMatch(hasChinese);
    expect(t('ninfer is down')).toMatch(hasChinese);
    expect(t('Stopped web')).toMatch(hasChinese);
    expect(t('Restarted web')).toMatch(hasChinese);
    expect(t('Freed 1.2 GB')).toMatch(hasChinese);
    expect(t('colima started')).toMatch(hasChinese);
    expect(t('Nothing needed cleaning')).toMatch(hasChinese);
    expect(t('Remove…')).toBe('移除…');
    expect(t('Start colima')).toBe('启动 colima');
    expect(t('It failed.')).toBe('执行失败。');
    setLocale('en');
    expect(t('Pulled nginx:latest')).toBe('Pulled nginx:latest');
  });
});

// The dictionary itself: Chinese answers carry no parenthesized English,
// the convention the earlier revisions dropped.
describe('dictionary hygiene', () => {
  test('no Chinese answer keeps an English word in parentheses', async () => {
    const source = await Bun.file(new URL('./i18n.ts', import.meta.url)).text();
    expect(source).not.toMatch(/（[A-Za-z]/);
  });
});

describe('plural', () => {
  test('uses Chinese measure words for known nouns', () => {
    setLocale('zh-CN');
    expect(plural(2, 'container')).toBe('2 个容器');
    expect(plural(1, 'unused image')).toBe('1 个未使用的镜像');
    setLocale('en');
    expect(plural(2, 'container')).toBe('2 containers');
  });
});
