import { describe, expect, it } from 'vitest';
import { getLinePools, type LinePoolContent } from '@content/lines';
import { checkInvariants } from '@sim/core/env';
import { dispatch } from '@sim/core/dispatch';
import type { Command } from '@sim/core/commands';
import type { SimEnv } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import { inDraft } from '../../testing';
import { lastLine, selectLine } from './lines';
import { narrativeWorld } from './testing';

const testPool: LinePoolContent = {
  id: 'testRole.greeting',
  role: 'testRole',
  context: 'greeting',
  scope: ['settlement'],
  lines: [
    { id: 'a', textKey: 'narrative.test.a' },
    { id: 'b', textKey: 'narrative.test.b' },
    { id: 'c', textKey: 'narrative.test.c', when: 'settlement.economy == "thriving"' },
    { id: 'd', textKey: 'narrative.test.d', when: 'house.renown > 9999' },
  ],
};

function say(state: GameState, env: SimEnv, pool: string, scope?: Record<string, string>, vars?: Record<string, string>) {
  const cmd = { type: 'sayLine', pool, ...(scope ? { scope } : {}), ...(vars ? { vars } : {}) } as Command;
  return dispatch(state, cmd, env);
}

function spoken(state: GameState, env: SimEnv, pool: string, scope?: Record<string, string>): { state: GameState; lineId: string } {
  const r = say(state, env, pool, scope);
  if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
  const ev = r.events.find((e) => e.type === 'LineSpoken');
  if (!ev || ev.type !== 'LineSpoken') throw new Error('no LineSpoken event');
  return { state: r.state, lineId: ev.lineId };
}

describe('line pools (bundled smith and keeper)', () => {
  const w = narrativeWorld({ settlementsPerFaction: 1 });
  const scope = { settlement: w.state.player.capitalId };

  it('sayLine speaks the line selectLine previews, and selectLine is pure', () => {
    const preview = selectLine(w.state, w.env, { pool: 'smith.greeting', scope });
    expect(preview).not.toBeNull();
    const again = selectLine(w.state, w.env, { pool: 'smith.greeting', scope });
    expect(again).toEqual(preview);
    const r = say(w.state, w.env, 'smith.greeting', scope);
    const ev = r.events.find((e) => e.type === 'LineSpoken');
    expect(ev).toMatchObject({ pool: 'smith.greeting', lineId: preview?.lineId, textKey: preview?.textKey, voice: 'narrator' });
    expect(lastLine(r.state, 'smith.greeting')).toBe(preview?.lineId);
    expect(r.state.storylets.lines?.draws).toBe(1);
  });

  it('no greeting repeats within a session until every eligible line has been used', () => {
    // At the capital in spring with a 16-year-old ruler: 3 base lines + youngJarl + yourForge are eligible.
    const eligible = ['sparks', 'axeHeads', 'hands', 'youngJarl', 'yourForge'];
    let s = w.state;
    const order: string[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const r = spoken(s, w.env, 'smith.greeting', scope);
      s = r.state;
      order.push(r.lineId);
    }
    expect([...order].sort()).toEqual([...eligible].sort());
    // Exhausted: the least recently spoken line comes round first, then the next.
    const sixth = spoken(s, w.env, 'smith.greeting', scope);
    expect(sixth.lineId).toBe(order[0]);
    const seventh = spoken(sixth.state, w.env, 'smith.greeting', scope);
    expect(seventh.lineId).toBe(order[1]);
    expect(seventh.state.storylets.lines?.recent['smith.greeting']).toHaveLength(eligible.length);
    expect(checkInvariants(seventh.state, w.env)).toEqual([]);
  });

  it('a new session forgets recency but keeps lifetime use counts', () => {
    let s = w.state;
    for (let i = 0; i < 3; i++) s = spoken(s, w.env, 'keeper.greeting', scope).state;
    const r = dispatch(s, { type: 'narrativeSession', reason: 'load' }, w.env);
    expect(r.error).toBeUndefined();
    const mem = r.state.storylets.lines;
    expect(mem?.session).toBe(2);
    expect(mem?.recent).toEqual({});
    expect(mem?.draws).toBe(3);
    expect(Object.values(mem?.uses ?? {}).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('conditions see the scope: a thriving market unlocks its line', () => {
    const thriving = inDraft(w.state, w.env, (d) => {
      const s = d.settlements[d.player.capitalId];
      if (s) s.economy = 'thriving';
    }).state;
    const seen: string[] = [];
    let s = thriving;
    for (let i = 0; i < 6; i++) {
      const r = spoken(s, w.env, 'smith.greeting', scope);
      seen.push(r.lineId);
      s = r.state;
    }
    expect(seen).toContain('cheapIron');
    expect(seen).not.toContain('pots');
  });

  it('rejects unknown pools and scope roots the pool does not take', () => {
    expect(say(w.state, w.env, 'nobody.greeting').error?.code).toBe('unknownPool');
    expect(say(w.state, w.env, 'smith.greeting', { fleet: 'flt_1' }).error?.code).toBe('badScope');
    expect(say(w.state, w.env, 'not a pool').error?.code).toBe('invalidCommand');
  });
});

describe('line selection rules (test pool)', () => {
  const w = narrativeWorld({ settlementsPerFaction: 1, pools: [testPool, ...getLinePools()] });
  const scope = { settlement: w.state.player.capitalId };

  it('only lines whose condition holds are eligible; no eligible line → null / noLine', () => {
    let s = w.state;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = spoken(s, w.env, 'testRole.greeting', scope);
      ids.push(r.lineId);
      s = r.state;
    }
    expect(ids.filter((x) => x === 'c' || x === 'd')).toEqual([]);
    const noScope = selectLine(w.state, w.env, { pool: 'testRole.greeting' }, w.module.library(w.env));
    expect(noScope).not.toBeNull();
    const empty: LinePoolContent = { ...testPool, id: 'testEmpty.greeting', role: 'testEmpty', lines: [{ id: 'z', textKey: 'narrative.test.z', when: 'false' }] };
    const w2 = narrativeWorld({ settlementsPerFaction: 1, pools: [empty] });
    expect(selectLine(w2.state, w2.env, { pool: 'testEmpty.greeting' }, w2.module.library(w2.env))).toBeNull();
    expect(say(w2.state, w2.env, 'testEmpty.greeting').error?.code).toBe('noLine');
  });

  it('merges standard vars, scope vars and caller vars', () => {
    const pick = selectLine(w.state, w.env, { pool: 'testRole.greeting', scope, vars: { price: 12 } }, w.module.library(w.env));
    expect(pick?.vars).toMatchObject({ rulerName: w.state.characters[w.state.player.rulerId]?.name, settlementName: w.state.settlements[w.state.player.capitalId]?.name, price: 12 });
  });

  it('weights decay with use', () => {
    const lib = w.module.library(w.env);
    let picksA = 0;
    for (let draws = 0; draws < 200; draws++) {
      const s = inDraft(w.state, w.env, (d) => {
        d.storylets.lines = { session: 1, draws, recent: {}, uses: { 'testRole.greeting:a': 1000 }, last: {} };
      }).state;
      if (selectLine(s, w.env, { pool: 'testRole.greeting', scope }, lib)?.lineId === 'a') picksA++;
    }
    expect(picksA).toBeLessThan(5);
  });

  it('is deterministic: the same commands give the same lines and state', () => {
    const run = () => {
      let s = w.state;
      const out: string[] = [];
      for (let i = 0; i < 8; i++) {
        const r = spoken(s, w.env, i % 3 === 2 ? 'smith.greeting' : 'testRole.greeting', scope);
        out.push(r.lineId);
        s = r.state;
      }
      return { out, json: JSON.stringify(s) };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });
});
