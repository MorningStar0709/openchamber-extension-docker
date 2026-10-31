// State lines reach the reader through t(): they must stay English source
// sentences in every locale — including the sub-minute case, where `span`
// localizes and a sentinel compared against `'seconds'` alone never matches.
import { describe, expect, test } from 'bun:test';

import { setLocale } from './format.ts';
import { stateLine } from './stacks.ts';
import type { Container } from './types.ts';

const row = (over: Partial<Container>): Container => ({
  id: 'abc', name: 'web', image: 'nginx:latest', state: 'running', health: null,
  exitCode: null, oomKilled: false, createdAt: '', startedAt: '', finishedAt: null,
  restartCount: 0, ports: [], compose: null, cpu: null, memory: null, memoryLimit: null,
  ...over,
});

describe('stateLine', () => {
  test('a container under a minute old reads "just started" in both locales', () => {
    const now = Date.now();
    const started = new Date(now - 30_000).toISOString();
    for (const locale of ['en', 'zh-CN'] as const) {
      setLocale(locale);
      expect(stateLine(row({ startedAt: started }), now)).toBe('just started');
    }
  });

  test('older uptime keeps the localized span', () => {
    const now = Date.now();
    const started = new Date(now - 5 * 60_000).toISOString();
    setLocale('zh-CN');
    expect(stateLine(row({ startedAt: started }), now)).toBe('up 5 分钟');
    setLocale('en');
    expect(stateLine(row({ startedAt: started }), now)).toBe('up 5 min');
  });
});
