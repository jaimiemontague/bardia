import { getContent } from '@content/index';
import { missingLocaleKeys } from '@content/locales/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import type { SimEvent } from '@sim/core/events';
import { advance } from '@sim/core/scheduler';
import type { FactionId, GameState, IntelFact, SettlementId, SiteId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, missingEventKeys, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import {
  believedValue,
  confidenceLabel,
  confidenceOf,
  displayedRange,
  intelInvariants,
  intelRecord,
  intelSummary,
  module as intel,
  reportsConflict,
} from './index';

const content = getContent();
const b = content.balance.intel;
const t = content.tunables.intel;

function world(seed = 'intel') {
  const w = testWorld({ modules: [intel], factions: 3, seed });
  const player = w.factionIds[0] as FactionId;
  const rival = w.factionIds[1] as FactionId;
  const target = (w.settlementIds[rival] as SettlementId[])[0] as SettlementId;
  return { ...w, player, rival, target };
}

function check(state: GameState): string[] {
  return intelInvariants(state, t.maxReportsPerFact);
}

function emitLoose(state: GameState, env: ReturnType<typeof world>['env'], event: Record<string, unknown>) {
  return inDraft(state, env, (_d, ctx) => ctx.emit(event as unknown as SimEvent));
}

describe('formulas (§31.19)', () => {
  it('confidence = reliability × e^(−age/90)', () => {
    expect(confidenceOf(1, 0, b)).toBe(1);
    expect(confidenceOf(0.75, 41, b)).toBeCloseTo(0.75 * Math.exp(-41 / 90), 10);
    expect(confidenceOf(0.6, 90, b)).toBeCloseTo(0.6 / Math.E, 10);
    expect(confidenceOf(2, -5, b)).toBe(1);
  });

  it('labels: High ≥ 0.7, Medium ≥ 0.4, Low, Stale beyond 180 days', () => {
    expect(confidenceLabel(0.8, 1, b)).toBe('high');
    expect(confidenceLabel(0.7, 1, b)).toBe('high');
    expect(confidenceLabel(0.5, 1, b)).toBe('medium');
    expect(confidenceLabel(0.39, 1, b)).toBe('low');
    expect(confidenceLabel(0.9, 181, b)).toBe('stale');
  });

  it('ranges: value × (1 ± 0.5 × (1 − confidence)) — the design example', () => {
    // "Garrison ≈ 110–150 (Medium)": a serving-man 41 days ago, value 130.
    const c = confidenceOf(0.75, 41, b);
    const [lo, hi] = displayedRange(130, c, b);
    expect(lo).toBeGreaterThanOrEqual(85);
    expect(hi).toBeLessThanOrEqual(175);
    expect(displayedRange(100, 1, b)).toEqual([100, 100]);
    expect(displayedRange(100, 0, b)).toEqual([50, 150]);
  });

  it('conflicts: confident reports whose ranges do not overlap; non-numbers when different', () => {
    const f = (value: IntelFact['value'], reliability = 1, hour = 0): IntelFact => ({ value, source: 'x', reliability, hour });
    expect(reportsConflict(f(100), f(300), 0, b, 0.2)).toBe(true);
    expect(reportsConflict(f(100, 0.5), f(130, 0.5), 0, b, 0.2)).toBe(false);
    expect(reportsConflict(f(100, 0.1), f(300), 0, b, 0.2)).toBe(false);
    expect(reportsConflict(f('poor'), f('thriving'), 0, b, 0.2)).toBe(true);
    expect(reportsConflict(f({ total: 50, units: {} }), f({ total: 200, units: {} }), 0, b, 0.2)).toBe(true);
  });
});

describe('addIntel', () => {
  it('validates parameters', () => {
    const w = world();
    expect(validateEffects(w.env, [{ op: 'addIntel', settlementId: w.target, facts: { fortTier: 2 }, source: 'keeper' }])).toEqual([]);
    expect(validateEffects(w.env, [{ op: 'addIntel', settlementId: w.target, facts: {}, source: 'keeper' }])).not.toEqual([]);
    expect(validateEffects(w.env, [{ op: 'addIntel', settlementId: w.target, facts: { moonPhase: 2 }, source: 'keeper' }])).not.toEqual([]);
    expect(validateEffects(w.env, [{ op: 'addIntel', settlementId: w.target, facts: { fortTier: 2 }, source: 'keeper', reliability: 2 }])).not.toEqual([]);
    expect(() => inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addIntel', settlementId: 'set_99999' as SettlementId, facts: { fortTier: 1 }, source: 'keeper' }]))).toThrow();
  });

  it('stores reports newest first with the source reliability, one per source, capped', () => {
    const w = world();
    let s = w.state;
    const add = (source: string, value: number, hoursAgo = 0) => {
      const r = inDraft(s, w.env, (_d, ctx) =>
        ctx.applyEffects([{ op: 'addIntel', settlementId: w.target, facts: { garrison: { total: value, units: {} } }, source, hour: Math.max(0, ctx.hour - hoursAgo) }]),
      );
      s = r.state;
      return r.events;
    };
    s = advance(s, 30 * HOURS_PER_DAY, w.env).state;
    const ev = add('keeper', 100, 48);
    expect(ev.filter((e) => e.type === 'IntelGained')).toHaveLength(1);
    add('server', 120);
    add('keeper', 90); // replaces the keeper's older report
    add('drunk', 300, 24);
    add('envoy', 110, 72);
    add('merchant', 105, 96);
    const list = intelRecord(s, w.player, w.target)?.facts.garrison ?? [];
    expect(list).toHaveLength(t.maxReportsPerFact);
    expect(list.map((f) => f.source)).toEqual(['server', 'keeper', 'drunk', 'envoy']);
    expect(list.find((f) => f.source === 'keeper')?.value).toEqual({ total: 90, units: {} });
    expect(list.find((f) => f.source === 'server')?.reliability).toBe(0.75);
    expect(check(s)).toEqual([]);
    const view = intelSummary(s, content, w.target).find((v) => v.key === 'garrison');
    // The envoy (0.85 × e^(−3/90) ≈ 0.82) outranks today's serving-man (0.75).
    expect(view?.source).toBe('envoy');
    expect(view?.number).toBe(110);
    expect(view?.conflict).toBe(true); // the drunk's 300 vs the envoy's 110
    expect(view?.label).toBe('high');
  });

  it('an older report from a source never replaces its newer one', () => {
    const w = world();
    let s = advance(w.state, 10 * HOURS_PER_DAY, w.env).state;
    s = inDraft(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addIntel', settlementId: w.target, facts: { fortTier: 3 }, source: 'keeper' }])).state;
    s = inDraft(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addIntel', settlementId: w.target, facts: { fortTier: 1 }, source: 'keeper', hour: 0 }])).state;
    expect(intelRecord(s, w.player, w.target)?.facts.fortTier?.map((f) => f.value)).toEqual([3]);
  });
});

describe('observeSettlement', () => {
  it('a perfect source reports the truth', () => {
    const w = world();
    const r = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'observeSettlement', settlementId: w.target, source: 'scout' }]));
    const s = r.state;
    const truth = s.settlements[w.target];
    const rec = intelRecord(s, w.player, w.target);
    const total = Object.values(truth?.garrison ?? {}).reduce((a, n) => a + n, 0);
    expect(rec?.facts.garrison?.[0]?.value).toMatchObject({ total });
    expect(rec?.facts.fortTier?.[0]?.value).toBe(truth?.fortTier);
    expect(rec?.facts.silver?.[0]?.value).toBe(truth?.silver);
    expect(rec?.facts.economy?.[0]?.value).toBe(truth?.economy);
    expect(rec?.facts.leader?.[0]?.value).toMatchObject({ charId: truth?.leaderId });
    expect(rec?.facts.relicRumor).toBeUndefined();
    expect(r.events.find((e) => e.type === 'IntelGained')).toMatchObject({ observer: w.player, settlementId: w.target, source: 'scout', reliability: 1 });
  });

  it('a poor source blurs numbers within ±(1 − reliability) × scale and sees only its kinds', () => {
    const w = world();
    const truth = w.state.settlements[w.target];
    const total = Object.values(truth?.garrison ?? {}).reduce((a, n) => a + n, 0);
    const spread = (1 - 0.4) * t.noise.scale;
    let differs = false;
    for (let i = 0; i < 30; i++) {
      const s0 = advance(w.state, 1 + i, w.env).state;
      const s = inDraft(s0, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'observeSettlement', settlementId: w.target, source: 'drunk' }])).state;
      const rec = intelRecord(s, w.player, w.target);
      const got = (rec?.facts.garrison?.[0]?.value as { total: number }).total;
      expect(got).toBeGreaterThanOrEqual(Math.floor(total * (1 - spread)) - Object.keys(truth?.garrison ?? {}).length);
      expect(got).toBeLessThanOrEqual(Math.ceil(total * (1 + spread)) + Object.keys(truth?.garrison ?? {}).length);
      if (got !== total) differs = true;
      expect(rec?.facts.silver).toBeUndefined(); // drunks do not know the treasury
      expect(rec?.facts.garrison?.[0]?.reliability).toBe(0.4);
    }
    expect(differs).toBe(true);
  });

  it('AI factions keep their own beliefs (§18.6)', () => {
    const w = world();
    const playerSeat = w.state.player.capitalId;
    const s = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'observeSettlement', settlementId: playerSeat, source: 'spy', observer: w.rival, keys: ['garrison'] }])).state;
    expect(intelRecord(s, w.rival, playerSeat)?.facts.garrison).toHaveLength(1);
    expect(intelRecord(s, w.player, playerSeat)).toBeUndefined();
    const guess = believedValue(s, content, w.rival, playerSeat, 'garrison');
    const truth = Object.values(s.settlements[playerSeat]?.garrison ?? {}).reduce((a, n) => a + n, 0);
    expect(guess).toBeGreaterThan(truth * 0.9);
    expect(guess).toBeLessThan(truth * 1.1);
  });
});

describe('reactions', () => {
  it("the player's fleet arriving at a foreign harbour sees its walls, ships and prosperity", () => {
    const w = world();
    const fleetId = w.fleetIds[w.player]?.[0];
    const r = emitLoose(w.state, w.env, { type: 'Arrived', fleetId, factionId: w.player, settlementId: w.target, cell: { x: 0, y: 0 } });
    const rec = intelRecord(r.state, w.player, w.target);
    expect(Object.keys(rec?.facts ?? {}).sort()).toEqual([...t.arrivalKeys].sort());
    expect(rec?.facts.fortTier?.[0]?.source).toBe('sighting');
    // AI arrivals and the player's own holdings make no records; malformed payloads never throw.
    expect(intelRecord(emitLoose(w.state, w.env, { type: 'Arrived', factionId: w.rival, settlementId: w.target }).state, w.player, w.target)).toBeUndefined();
    expect(intelRecord(emitLoose(w.state, w.env, { type: 'Arrived', factionId: w.player, settlementId: w.state.player.capitalId }).state, w.player, w.state.player.capitalId)).toBeUndefined();
    expect(() => emitLoose(w.state, w.env, { type: 'Arrived' })).not.toThrow();
    expect(() => emitLoose(w.state, w.env, { type: 'Arrived', factionId: w.player, settlementId: 'set_99999' })).not.toThrow();
  });
});

describe('buyMap (§20.5)', () => {
  function withSite(state: GameState, env: ReturnType<typeof world>['env']): { state: GameState; siteId: SiteId } {
    const siteId = 'site_77' as SiteId;
    const r = inDraft(state, env, (draft) => {
      draft.sites[siteId] = { id: siteId, name: 'Barrow of the Nine', kind: 'barrow' as never, mapPos: { x: 5, y: 5 }, revealed: false, delveId: 'testDelve', cleared: false };
    });
    return { state: r.state, siteId };
  }

  it('pays from the treasury, records the map and reports it', () => {
    const w = world();
    const { state, siteId } = withSite(w.state, w.env);
    const here = state.player.capitalId;
    const before = state.factions[w.player]?.treasury ?? 0;
    const r = dispatch(state, { type: 'buyMap', siteId, settlementId: here, price: 40 }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.factions[w.player]?.treasury).toBe(before - 40);
    expect(r.state.player.house.maps?.[siteId]).toMatchObject({ siteId, price: 40, fromSettlementId: here });
    expect(r.events.find((e) => e.type === 'MapAcquired')).toMatchObject({ siteId, price: 40 });
    expect(missingEventKeys(r.events)).toEqual([]);
    const ctx = { state: r.state, env: w.env, scope: {} };
    expect(intel.conditionFns?.['holdsMap']?.evaluate([siteId], ctx)).toBe(true);
    expect(dispatch(r.state, { type: 'buyMap', siteId, settlementId: here, price: 40 }, w.env).error?.code).toBe('alreadyHeld');
  });

  it('refuses unknown sites, bad prices, empty treasuries and deals struck from afar', () => {
    const w = world();
    const { state, siteId } = withSite(w.state, w.env);
    const here = state.player.capitalId;
    expect(dispatch(state, { type: 'buyMap', siteId: 'site_404' as SiteId, settlementId: here, price: 40 }, w.env).error?.code).toBe('unknownSite');
    expect(dispatch(state, { type: 'buyMap', siteId, settlementId: here, price: 500 }, w.env).error?.code).toBe('badPrice');
    expect(dispatch(state, { type: 'buyMap', siteId, settlementId: w.target, price: 40 }, w.env).error?.code).toBe('notThere');
    const poor = inDraft(state, w.env, (d) => {
      (d.factions[w.player] as { treasury: number }).treasury = 10;
    }).state;
    expect(dispatch(poor, { type: 'buyMap', siteId, settlementId: here, price: 40 }, w.env).error?.code).toBe('notEnoughSilver');
    const codes = ['unknownSite', 'badPrice', 'notThere', 'notEnoughSilver', 'alreadyHeld', 'unknownSettlement'];
    expect(missingLocaleKeys(codes.map((c) => `intel.error.${c}`))).toEqual([]);
  });
});

describe('upkeep, conditions, determinism', () => {
  it('prunes reports past pruneDays monthly and keeps the slice valid', () => {
    const w = world();
    let s = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'observeSettlement', settlementId: w.target, source: 'scout' }])).state;
    s = advance(s, 200 * HOURS_PER_DAY, w.env).state;
    s = inDraft(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addIntel', settlementId: w.target, facts: { fortTier: 2 }, source: 'keeper' }])).state;
    expect(intelRecord(s, w.player, w.target)?.facts.garrison).toHaveLength(1);
    s = advance(s, (t.pruneDays - 150) * HOURS_PER_DAY, w.env).state;
    const rec = intelRecord(s, w.player, w.target);
    expect(rec?.facts.garrison).toBeUndefined();
    expect(rec?.facts.fortTier).toHaveLength(1);
    expect(check(s)).toEqual([]);
  });

  it('conditions read the player\'s knowledge', () => {
    const w = world();
    const s = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'addIntel', settlementId: w.target, facts: { fortTier: 2 }, source: 'keeper' }])).state;
    const fns = intel.conditionFns ?? {};
    const ctx = { state: s, env: w.env, scope: { settlement: w.target } };
    expect(fns['hasIntel']?.evaluate([], ctx)).toBe(true);
    expect(fns['hasIntel']?.evaluate(['fortTier'], ctx)).toBe(true);
    expect(fns['hasIntel']?.evaluate(['garrison'], ctx)).toBe(false);
    expect(fns['intelConfidence']?.evaluate(['fortTier'], ctx)).toBeCloseTo(0.6);
    expect(fns['intelLabel']?.evaluate(['fortTier'], ctx)).toBe('medium');
    expect(fns['intelLabel']?.evaluate(['garrison'], ctx)).toBe('none');
    expect(fns['hasIntel']?.evaluate(['fortTier', w.state.player.capitalId], { ...ctx, scope: {} })).toBe(false);
  });

  it('is deterministic', () => {
    const run = () => {
      const w = world('det');
      let s = w.state;
      for (let i = 0; i < 5; i++) {
        s = advance(s, 7 * HOURS_PER_DAY, w.env).state;
        s = inDraft(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'observeSettlement', settlementId: w.target, source: i % 2 === 0 ? 'drunk' : 'server' }])).state;
      }
      return JSON.stringify(s.intel);
    };
    expect(run()).toBe(run());
  });
});
