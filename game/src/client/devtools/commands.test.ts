import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/core/commands';
import { formatDate } from '@sim/core/time';
import { GameSession } from '@sim/session';
import { buildRegistry } from '../app/screenRegistry';
import { complete, dump, readPath, runDevCommand, tokenize, type DevContext, type DevLine } from './commands';

function harness(withGame = true) {
  let session: GameSession | null = withGame ? GameSession.newGame({ seed: 'dev-seed', difficulty: 'seaKing' }, { modules: [] }) : null;
  const flags = { revealMap: false, showIds: false, forceRealtime: false };
  const downloads: { name: string; text: string }[] = [];
  let speed = 1;
  let paused = true;
  const ctx: DevContext = {
    session: () => session,
    advanceHours: (h) => session?.advance(h) ?? null,
    dispatch: (c: Command) => session?.dispatch(c) ?? null,
    flags: () => flags,
    setFlags: (p) => Object.assign(flags, p),
    setSpeed: (s) => (speed = s),
    setPaused: (p) => (paused = p),
    registry: () => buildRegistry({ './screens/a/index.tsx': { screen: { id: 'a', route: 'a', component: () => null } } }),
    recentEvents: () => [],
    missingKeys: () => ['ui.nope'],
    download: (name, text) => downloads.push({ name, text }),
    formatDate,
  };
  return { ctx, flags, downloads, get speed() { return speed; }, get paused() { return paused; }, end: () => (session = null) };
}

const keyOf = (l: DevLine | undefined) => (l && 'key' in l ? l.key : undefined);
const textOf = (l: DevLine | undefined) => (l && 'text' in l ? l.text : '');

describe('dev console commands', () => {
  it('tokenizes, completes and reads dotted paths', () => {
    expect(tokenize('state "player.house" x')).toEqual(['state', 'player.house', 'x']);
    expect(complete('st')).toEqual(['state']);
    expect(readPath({ a: { b: [1, { c: 2 }] } }, 'a.b.1.c')).toEqual({ found: true, value: 2 });
    expect(readPath({ a: 1 }, 'a.toString').found).toBe(false);
    expect(dump('x'.repeat(10), 5)).toMatch(/more characters/);
  });

  it('inspects the state, seed and date', () => {
    const h = harness();
    expect(textOf(runDevCommand('state meta.seed', h.ctx)[0])).toBe('"dev-seed"');
    expect(keyOf(runDevCommand('state no.such.path', h.ctx)[0])).toBe('ui.dev.out.noPath');
    expect(textOf(runDevCommand('state', h.ctx)[0])).toContain('"characters"');
    expect(runDevCommand('seed', h.ctx)[0]).toMatchObject({ key: 'ui.dev.out.seed', vars: { seed: 'dev-seed', difficulty: 'seaKing' } });
  });

  it('advances time through the session and dispatches real commands only', () => {
    const h = harness();
    const r = runDevCommand('advance 3', h.ctx);
    expect(keyOf(r[0])).toBe('ui.dev.out.advanced');
    expect(h.ctx.session()?.getState().time.hour).toBe(72);
    expect(keyOf(runDevCommand('wait 2', h.ctx)[0])).toBe('ui.dev.out.dispatched');
    expect(h.ctx.session()?.getState().time.hour).toBe(120);
    expect(keyOf(runDevCommand('cmd {"type":"setPolicy","policy":"envoy","value":"rejectAll"}', h.ctx)[0])).toBe('ui.dev.out.dispatched');
    expect(h.ctx.session()?.getState().player.policies.envoy).toBe('rejectAll');
    expect(keyOf(runDevCommand('cmd {"type":"giveMeSilver"}', h.ctx)[0])).toBe('ui.dev.out.rejected');
    expect(keyOf(runDevCommand('cmd not json', h.ctx)[0])).toBe('ui.dev.out.badJson');
    expect(keyOf(runDevCommand('advance -1', h.ctx)[0])).toBe('ui.dev.out.badNumber');
    expect(h.ctx.session()?.commandLog.length).toBeGreaterThan(0);
  });

  it('toggles client-only dev flags (fog off reveals the map)', () => {
    const h = harness();
    expect(keyOf(runDevCommand('fog off', h.ctx)[0])).toBe('ui.dev.out.fogOff');
    expect(h.flags.revealMap).toBe(true);
    runDevCommand('fog on', h.ctx);
    expect(h.flags.revealMap).toBe(false);
    runDevCommand('clock on', h.ctx);
    expect(h.flags.forceRealtime).toBe(true);
    expect(keyOf(runDevCommand('ids maybe', h.ctx)[0])).toBe('ui.dev.out.onOff');
    runDevCommand('speed 4', h.ctx);
    runDevCommand('resume', h.ctx);
    expect(h.speed).toBe(4);
    expect(h.paused).toBe(false);
  });

  it('exports state, save and replay log', () => {
    const h = harness();
    runDevCommand('export state', h.ctx);
    runDevCommand('export save', h.ctx);
    runDevCommand('export log', h.ctx);
    expect(h.downloads.map((d) => d.name)).toEqual([expect.stringMatching(/state-dev-seed-h0\.json$/), expect.stringMatching(/\.bardia$/), expect.stringMatching(/replay/)]);
    expect(JSON.parse(h.downloads[0]?.text ?? '{}').meta.seed).toBe('dev-seed');
    expect(h.downloads[1]?.text.startsWith('BARDIA1:')).toBe(true);
  });

  it('checks invariants, lists modules/screens/missing keys, and refuses game commands without a game', () => {
    const h = harness();
    expect(keyOf(runDevCommand('check', h.ctx)[0])).toBe('ui.dev.out.invariantsOk');
    expect(textOf(runDevCommand('modules', h.ctx)[0])).toContain('core');
    expect(textOf(runDevCommand('screens', h.ctx)[0])).toContain('routes=[a]');
    expect(runDevCommand('keys', h.ctx).map(textOf)).toContain('ui.nope');
    expect(keyOf(runDevCommand('bogus', h.ctx)[0])).toBe('ui.dev.out.unknown');
    expect(runDevCommand('help', h.ctx).length).toBeGreaterThan(10);
    h.end();
    expect(keyOf(runDevCommand('advance 1', h.ctx)[0])).toBe('ui.dev.out.noGame');
    expect(keyOf(runDevCommand('fog off', h.ctx)[0])).toBe('ui.dev.out.fogOff');
  });
});
