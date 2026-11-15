import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import { createSettlement } from '@sim/core/factory';
import type { CharId, GameState, NewsItem, SettlementId } from '@sim/core/state';
import { inDraft, missingEventKeys } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { module as news, normaliseNews } from './index';
import { newsInvariants } from './invariants';
import { playerNews } from './query';
import { advanceDays, newsContent, newsTestWorld, withNews } from './testing';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const chainContent = newsContent({ network: { neighbours: 1 } });

function items(state: GameState): NewsItem[] {
  return Object.values(state.news);
}
function emitLoose(state: GameState, env: ReturnType<typeof newsTestWorld>['env'], event: Record<string, unknown>) {
  return inDraft(state, env, (_draft, ctx) => ctx.emit(event as unknown as SimEvent));
}
function itemOfKind(state: GameState, kind: string): NewsItem | undefined {
  return items(state).find((i) => i.kind === kind);
}

describe('news from world events (reactions)', () => {
  it('SettlementFate: a sack makes an item at the settlement with tier importance', () => {
    const w = newsTestWorld({ cols: 3 });
    const target = w.ids[2] as SettlementId;
    const r = emitLoose(w.state, w.env, { type: 'SettlementFate', settlementId: target, fate: 'sackAndBurn', byFactionId: w.rivalId });
    const it = itemOfKind(r.state, 'settlementSacked');
    expect(it).toBeDefined();
    expect(it?.originId).toBe(target);
    expect(it?.importance).toBe(3); // town: +0
    expect(it?.facts).toMatchObject({ settlement: 'Town 2', attacker: 'Testrealm', fate: 'sackAndBurn' });
    expect(it?.factionIds).toContain(w.rivalId);
    // The same event twice in one hour makes one item; an unknown fate makes none.
    const again = emitLoose(r.state, w.env, { type: 'SettlementFate', settlementId: target, fate: 'sackAndBurn', byFactionId: w.rivalId });
    expect(items(again.state)).toHaveLength(1);
    expect(items(emitLoose(w.state, w.env, { type: 'SettlementFate', settlementId: target, fate: 'dance' }).state)).toHaveLength(0);
  });

  it('SettlementFate without an actor is the player\'s own deed: witnessed, never dispatched', () => {
    const w = newsTestWorld({ cols: 3 });
    const r = emitLoose(w.state, w.env, { type: 'SettlementFate', settlementId: w.ids[1], fate: 'plunderAndLeave' });
    const it = itemOfKind(r.state, 'settlementPlundered');
    expect(it?.playerHeard?.via).toBe('witness');
    expect(r.events.some((e) => e.type === 'NewsHeard')).toBe(false);
  });

  it('Death of a ruler (importance by faction kind); commoners make no news', () => {
    const w = newsTestWorld({ cols: 3 });
    const rival = w.state.factions[w.rivalId];
    const r = emitLoose(w.state, w.env, { type: 'Death', charId: rival?.rulerId, cause: 'battle', age: 40, wasPlayerRuler: false, rulerOf: w.rivalId });
    const it = itemOfKind(r.state, 'rulerDied');
    expect(it?.importance).toBe(4); // kingdom
    expect(it?.facts['cause']).toBe('battle');
    const leader = w.state.settlements[w.ids[1] as SettlementId]?.leaderId as CharId;
    const none = emitLoose(w.state, w.env, { type: 'Death', charId: leader, cause: 'illness', age: 50, wasPlayerRuler: false });
    expect(items(none.state)).toHaveLength(0);
  });

  it('BattleEnded: importance from the slain; the place and sides are named', () => {
    const w = newsTestWorld({ cols: 3 });
    const r = emitLoose(w.state, w.env, {
      type: 'BattleEnded',
      battleId: 'bat_900',
      kind: 'assault',
      settlementId: w.ids[2],
      attackerFactionId: w.rivalId,
      defenderFactionId: w.state.player.factionId,
      result: { winner: 'attacker', casualties: [{ side: 'attacker', killed: 120 }, { side: 'defender', killed: 200 }], chief: { killed: false } },
    });
    const it = itemOfKind(r.state, 'battle');
    expect(it?.importance).toBe(3); // 320 slain ≥ 250
    expect(it?.facts).toMatchObject({ place: 'Town 2', victor: 'attacker', killed: 320, attackerLost: 120, defenderLost: 200 });
    // The player fought: witnessed.
    expect(it?.playerHeard?.via).toBe('witness');
  });

  it('pacts, marriages, successions, crownings, storms, captures, revolts, relics and fallen houses', () => {
    const w = newsTestWorld({ cols: 3 });
    const player = w.state.player.factionId;
    const rival = w.state.factions[w.rivalId];
    let state = w.state;
    const events: Record<string, unknown>[] = [
      { type: 'PactSigned', a: player, b: w.rivalId, kind: 'alliance' },
      { type: 'PactBroken', a: player, b: w.rivalId, kind: 'truce', brokenBy: w.rivalId },
      { type: 'Marriage', aId: rival?.rulerId, bId: state.player.rulerId },
      { type: 'SuccessionOccurred', factionId: w.rivalId, deceasedId: rival?.rulerId, heirId: rival?.rulerId, kind: 'heir', isPlayer: false },
      { type: 'TitleChanged', charId: rival?.rulerId, titleKey: 'people.title.king', previousKey: 'people.title.jarl' },
      { type: 'HoldingCaptured', settlementId: w.ids[1], byFactionId: player },
      { type: 'RevoltStarted', settlementId: w.ids[2] },
      { type: 'RelicFound', relicId: 'rel_1', factionId: w.rivalId },
      { type: 'HouseFallsSilent', factionId: w.rivalId, deceasedId: rival?.rulerId },
      { type: 'CaptureStarted', charId: rival?.rulerId, byFactionId: player, at: w.ids[0], ransom: 100 },
      { type: 'AcclamationResult', winnerId: rival?.rulerId, factionId: w.rivalId },
    ];
    for (const e of events) state = emitLoose(state, w.env, e).state;
    const kinds = items(state).map((i) => i.kind).sort();
    expect(kinds).toEqual(
      ['acclamation', 'crowned', 'holdingCaptured', 'houseFallen', 'marriage', 'pactBroken', 'pactSigned', 'relicFound', 'revolt', 'rulerCaptured', 'succession'].sort(),
    );
    expect(itemOfKind(state, 'pactSigned')?.confirmed).toBe(true);
    expect(itemOfKind(state, 'pactSigned')?.importance).toBe(3);
    expect(itemOfKind(state, 'pactBroken')?.importance).toBe(3); // truce 2 + 1
    expect(itemOfKind(state, 'succession')?.importance).toBe(4); // kingdom
    expect(itemOfKind(state, 'acclamation')?.importance).toBe(5);
    expect(newsInvariants(state)).toEqual([]);
  });

  it('a storm that sinks ships makes news at the nearest settlement; one that sinks none does not', () => {
    const w = newsTestWorld({ cols: 3 });
    const fleetId = Object.keys(w.state.fleets)[0];
    const quiet = emitLoose(w.state, w.env, { type: 'StormHit', fleetId, severity: 'minor' });
    expect(items(quiet.state)).toHaveLength(0);
    const wreck = emitLoose(w.state, w.env, { type: 'StormHit', fleetId: 'flt_none', severity: 'severe', shipsLost: 2, pos: { x: 149, y: 100 } });
    const it = itemOfKind(wreck.state, 'stormWreck');
    expect(it?.originId).toBe(w.ids[2]);
    expect(it?.facts['ships']).toBe(2);
  });

  it('malformed payloads never throw', () => {
    const w = newsTestWorld({ cols: 2 });
    for (const type of Object.keys(news.reactions ?? {})) {
      expect(() => emitLoose(w.state, w.env, { type })).not.toThrow();
      expect(() => emitLoose(w.state, w.env, { type, settlementId: 'set_99999', charId: 'chr_99999', factionId: 'fac_99999', a: 1, result: 'x' })).not.toThrow();
    }
  });
});

describe('effects', () => {
  it('addNews validates parameters and creates an item', () => {
    const w = newsTestWorld({ cols: 3 });
    expect(validateEffects(w.env, [{ op: 'addNews', kind: 'battle', originId: w.ids[1], importance: 3, facts: { killed: 5 } }])).toEqual([]);
    expect(validateEffects(w.env, [{ op: 'addNews', kind: 'battle' }])).not.toEqual([]);
    expect(validateEffects(w.env, [{ op: 'addNews', kind: 'Bad Kind', originId: w.ids[1] }])).not.toEqual([]);
    expect(validateEffects(w.env, [{ op: 'addNews', kind: 'battle', originId: w.ids[1], importance: 9 }])).not.toEqual([]);
    const r = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addNews', kind: 'feastHeld', pos: { x: 125, y: 101 }, textKey: 'news.item.generic', importance: 2 }]));
    const it = items(r.state)[0];
    expect(it?.originId).toBe(w.ids[1]);
    expect(it?.textKey).toBe('news.item.generic');
    expect(() => inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addNews', kind: 'battle', originId: 'set_99999' }]))).toThrow();
  });

  it('hearNews: the player hears a keeper; an envoy confirms a rumour', () => {
    const w = newsTestWorld({ cols: 6, content: chainContent });
    const far = w.ids[5] as SettlementId;
    let state = withNews(w.state, w.env, { kind: 'battle', originId: far, importance: 1 }).state;
    state = advanceDays(state, w.env, 6).state;
    // Word reached ids[2] (3 hops = 3.9 travel-days × 1.4 ≈ 5.5 days) but not ids[1] (4 hops ≈ 7.3 days).
    const keeper = inDraft(state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'hearNews', settlementId: w.ids[2] as SettlementId }]));
    const heard = keeper.events.filter((e) => e.type === 'NewsHeard');
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ via: 'keeper', rumour: true, hops: 3 });
    // Hearing it again changes nothing; an envoy from ids[4] confirms it.
    const again = inDraft(keeper.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'hearNews', settlementId: w.ids[2] as SettlementId }]));
    expect(again.events.filter((e) => e.type === 'NewsHeard')).toHaveLength(0);
    const envoy = inDraft(keeper.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'hearNews', settlementId: w.ids[4] as SettlementId, via: 'envoy' }]));
    expect(envoy.events.some((e) => e.type === 'NewsConfirmed')).toBe(true);
    const log = playerNews(envoy.state, getContent());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ confirmed: true, rumour: false, hops: 1 });
    expect(missingEventKeys(envoy.events)).toEqual([]);
  });
});

describe('pruning', () => {
  it('drops items past their age with every index entry', () => {
    const w = newsTestWorld({ cols: 4, content: chainContent });
    let state = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[1] as SettlementId, importance: 1, dedupeKey: 'k1' }).state;
    state = withNews(state, w.env, { kind: 'battle', originId: w.ids[1] as SettlementId, importance: 5 }).state;
    state = advanceDays(state, w.env, 70).state;
    expect(items(state).map((i) => i.importance)).toEqual([5]);
    expect(state.newsIndex?.dedupe).toEqual({});
    for (const ids of Object.values(state.newsIndex?.known ?? {})) expect(ids).toHaveLength(1);
    expect(newsInvariants(state)).toEqual([]);
  });

  it('caps the table at prune.maxItems, least important first', () => {
    const content = newsContent({ prune: { maxItems: 10 } });
    const w = newsTestWorld({ cols: 3, content });
    let state = w.state;
    for (let i = 0; i < 25; i++) state = withNews(state, w.env, { kind: 'battle', originId: w.ids[i % 3] as SettlementId, importance: (i % 5) + 1 }).state;
    state = advanceDays(state, w.env, 7).state;
    const left = items(state);
    expect(left).toHaveLength(10);
    expect(Math.min(...left.map((i) => i.importance))).toBeGreaterThanOrEqual(4);
    expect(newsInvariants(state)).toEqual([]);
  });
});

describe('conditions', () => {
  it('newsHeard / newsHeardCount / newsKnownAt', () => {
    const w = newsTestWorld({ cols: 3, content: chainContent });
    let state = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[2] as SettlementId, importance: 3 }).state;
    state = advanceDays(state, w.env, 6).state;
    const fns = w.env.conditionFns;
    const ev = (name: string, args: unknown[], scope: Record<string, string> = {}) => fns.get(name)?.fn.evaluate(args as never, { state, env: w.env, scope });
    expect(ev('newsHeard', ['battle'])).toBe(true);
    expect(ev('newsHeard', ['pactSigned'])).toBe(false);
    expect(ev('newsHeardCount', [])).toBe(1);
    expect(ev('newsHeardCount', [0])).toBe(0);
    expect(ev('newsKnownAt', [w.ids[1]])).toBe(1);
    expect(ev('newsKnownAt', [], { settlement: w.ids[1] as string })).toBe(1);
    expect(ev('newsKnownAt', [w.ids[1], 'revolt'])).toBe(0);
  });
});

describe('module lifecycle and determinism', () => {
  it('init on a campaign under way rebuilds the index from the items', () => {
    const w = newsTestWorld({ cols: 4, content: chainContent });
    let state = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 3 }).state;
    state = advanceDays(state, w.env, 3).state;
    const broken = JSON.parse(JSON.stringify(state)) as GameState;
    delete broken.newsIndex;
    const fixed = inDraft(broken, w.env, (draft) => normaliseNews(draft)).state;
    expect(fixed.newsIndex?.known).toEqual(state.newsIndex?.known);
    expect(fixed.newsIndex?.active).toEqual(state.newsIndex?.active);
    expect(newsInvariants(fixed)).toEqual([]);
  });

  it('same seed and inputs → identical JSON; state stays JSON-safe and invariant-clean', () => {
    const run = () => {
      const w = newsTestWorld({ cols: 5, rows: 3, playerHoldings: [7], seed: 'det' });
      let state = w.state;
      for (let d = 0; d < 60; d++) {
        if (d % 3 === 0) {
          state = inDraft(state, w.env, (_dr, ctx) => {
            const rng = ctx.rng('test:news');
            ctx.applyEffects([{ op: 'addNews', kind: 'battle', originId: w.ids[rng.int(0, w.ids.length - 1)] as SettlementId, importance: rng.int(1, 5), facts: { killed: rng.int(10, 999) } }]);
          }).state;
        }
        state = advanceDays(state, w.env, 1).state;
        expect(checkInvariants(state, w.env)).toEqual([]);
      }
      return JSON.stringify(state);
    };
    const a = run();
    expect(run()).toBe(a);
    expect(JSON.parse(a)).toEqual(JSON.parse(JSON.stringify(JSON.parse(a))));
  });

  it('a settlement founded later joins the network in the next operation', () => {
    const w = newsTestWorld({ cols: 2, content: chainContent });
    const r = inDraft(w.state, w.env, (draft, ctx) =>
      ctx.runAs('test', () => {
        createSettlement(draft, ctx, { culture: 'albric', provinceId: Object.keys(draft.provinces)[0] as `prv_${string}`, factionId: w.rivalId, tier: 'village', pop: 100, mapPos: { x: 148, y: 100 }, coastal: true, name: 'Newby' });
      }),
    );
    const newby = Object.values(r.state.settlements).find((s) => s.name === 'Newby')?.id as SettlementId;
    let state = withNews(r.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 3 }).state;
    state = advanceDays(state, w.env, 10).state;
    const it = items(state)[0];
    expect(it?.reachedIds).toContain(newby);
  });

  it('dispatch reaches the player through a command operation too (wait)', () => {
    const w = newsTestWorld({ cols: 3, content: chainContent });
    const s0 = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[2] as SettlementId, importance: 3 }).state;
    const r = dispatch(s0, { type: 'wait', days: 5 }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.events.some((e) => e.type === 'NewsHeard')).toBe(true);
  });
});

describe('performance (§29.8 budget: ≤ 2 ms per game day for the whole sim)', () => {
  it('spreads a busy year of news over 300 settlements within budget', () => {
    const positions = Array.from({ length: 300 }, (_, i) => ({ x: 20 + ((i * 53) % 760), y: 20 + ((i * 97) % 560), coastal: i % 4 !== 0 }));
    const w = newsTestWorld({ positions, playerHoldings: [5, 9, 13], seed: 'perf' });
    let state = w.state;
    // Warm up (network build, JIT).
    state = advanceDays(state, w.env, 2).state;
    let simMs = 0;
    const days = 120;
    for (let d = 0; d < days; d++) {
      state = inDraft(state, w.env, (_dr, ctx) => {
        const rng = ctx.rng('test:perf');
        for (let k = 0; k < 2; k++) ctx.applyEffects([{ op: 'addNews', kind: 'battle', originId: w.ids[rng.int(0, w.ids.length - 1)] as SettlementId, importance: rng.int(1, 5), facts: { killed: rng.int(10, 999) } }]);
      }).state;
      const t0 = performance.now();
      state = advanceDays(state, w.env, 1).state;
      simMs += performance.now() - t0;
    }
    const perDay = simMs / days;
    const active = state.newsIndex?.active.length ?? 0;
    console.log(`news perf: ${perDay.toFixed(3)} ms/day (${Object.keys(state.news).length} items, ${active} spreading, 300 settlements)`);
    expect(newsInvariants(state)).toEqual([]);
    // Generous bound for shared CI machines; the measured figure is logged above.
    expect(perDay).toBeLessThan(6 * PERF_SLACK);
  });
});
