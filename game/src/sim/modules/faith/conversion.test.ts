import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import { getRelation } from '@sim/core/factory';
import type { ConditionEvalContext } from '@sim/core/module';
import { advance } from '@sim/core/scheduler';
import type { FactionId, GameState, JsonValue, SettlementId } from '@sim/core/state';
import { HOURS_PER_MONTH } from '@sim/core/time';
import { inDraft, missingEventKeys, testWorld, type TestWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { lanternOpinion } from './conversion';
import { module as faith } from './index';

const content = getContent();
const t = content.tunables.faith;

interface ConvWorld extends TestWorld {
  lantern: FactionId[];
  village: SettlementId;
}

function world(): ConvWorld {
  const w = testWorld({ modules: [faith], factions: 5 });
  const lantern = w.factionIds.filter((id) => w.state.factions[id]?.faith === 'lantern');
  const state = inDraft(w.state, w.env, (d) => {
    const ruler = d.characters[d.player.rulerId];
    if (ruler) {
      ruler.traits = [];
      ruler.feats = [];
    }
  }).state;
  return { ...w, state, lantern, village: w.settlementIds[w.state.player.factionId]?.[1] as SettlementId };
}

function apply(w: TestWorld, s: GameState, fn: Parameters<typeof inDraft>[2]): GameState {
  return inDraft(s, w.env, fn).state;
}

/** Chapel at the capital (Missionary "Welcome") and Lantern opinion raised to `opinion`. */
function ready(w: ConvWorld, opinion = 25): GameState {
  return apply(w, w.state, (d, ctx) => {
    ctx.applyEffects([{ op: 'buildChapel' }, { op: 'faithDeed', deed: 'missionaryWelcomed' }]);
    for (const id of w.lantern) ctx.applyEffects([{ op: 'changeOpinion', a: d.player.factionId, b: id, amount: opinion, reason: 'test' }]);
  });
}

function cond(w: TestWorld, s: GameState, name: string, args: JsonValue[] = []): JsonValue {
  const entry = w.env.conditionFns.get(name);
  if (!entry) throw new Error(`no condition fn ${name}`);
  const ctx: ConditionEvalContext = { state: s, env: w.env, scope: {} };
  return entry.fn.evaluate(args, ctx);
}

describe('conversion requirements (§17.7)', () => {
  it('needs a chapel and Lantern opinion ≥ 20', () => {
    const w = world();
    expect(dispatch(w.state, { type: 'convertHouse' }, w.env).error?.code).toBe('noChapel');
    const chapel = apply(w, w.state, (_d, ctx) => ctx.applyEffects([{ op: 'buildChapel' }]));
    expect(chapel.player.house.chapels).toEqual([w.state.player.capitalId]);
    expect(cond(w, chapel, 'hasChapel')).toBe(true);
    expect(dispatch(chapel, { type: 'convertHouse' }, w.env).error?.code).toBe('lanternOpinionTooLow');
    const low = ready(w, 19);
    expect(lanternOpinion(low, t)).toBeCloseTo(19);
    expect(cond(w, low, 'canConvert')).toBe(false);
    const ok = ready(w, 20);
    expect(cond(w, ok, 'canConvert')).toBe(true);
    expect(dispatch(ok, { type: 'convertHouse' }, w.env).error).toBeUndefined();
  });

  it('the Missionary welcome costs the old gods 10 Favor each', () => {
    const w = world();
    const s = ready(w);
    const before: Record<string, number> = { ...w.state.player.house.favor };
    for (const [god, v] of Object.entries(s.player.house.favor)) expect(v, god).toBe((before[god] ?? 0) - 10);
  });
});

describe('convertHouse consequences', () => {
  it('adopts the Lantern: faith, diplomacy +20, wrath reset, Piety replaces Favor and omens, holdings resent it', () => {
    const w = world();
    let s = ready(w, 35);
    s = apply(w, s, (_d, ctx) => ctx.applyEffects([{ op: 'changeFaithWrath', amount: 40 }])); // sermons: −10 opinion
    s = apply(w, s, (d) => {
      d.player.house.omens = { battle: { omen: 'blessed', score: 4, readHour: 0, untilHour: 9999 } };
    });
    const loyaltyBefore = (id: SettlementId) => s.settlements[id]?.holding?.loyalty ?? 0;
    const capital = s.player.capitalId;
    const opinionBefore = getRelation(s, s.player.factionId, w.lantern[0] as FactionId)?.opinion ?? 0;
    const r = dispatch(s, { type: 'convertHouse' }, w.env);
    expect(r.error).toBeUndefined();
    const n = r.state;
    expect(n.player.house.faith).toBe('lantern');
    expect(n.factions[n.player.factionId]?.faith).toBe('lantern');
    expect(n.characters[n.player.rulerId]?.faith).toBe('lantern');
    expect(n.player.house.convertedHour).toBe(n.time.hour);
    expect(n.player.house.faithWrath).toBe(0);
    expect(n.player.house.piety).toBe(t.piety.startOnConversion);
    expect(n.player.house.omens).toEqual({});
    // +20 Lantern diplomacy, and the sermons are lifted with the reset wrath.
    expect(getRelation(n, n.player.factionId, w.lantern[0] as FactionId)?.opinion).toBe(
      opinionBefore + t.conversion.lanternDiplomacy - content.balance.standing.faithWrath.sermonsOpinion,
    );
    for (const id of [capital, w.village]) {
      expect(n.settlements[id]?.holding?.loyalty).toBe(Math.max(0, loyaltyBefore(id) + t.conversion.traditionalistLoyalty));
      expect(n.faith?.conversion?.resentment[id]).toBe(Math.abs(t.conversion.traditionalistLoyalty));
      expect(n.faith?.conversion?.shares[id]).toBe(0);
    }
    const types = r.events.map((e) => e.type);
    expect(types).toContain('HouseConverted');
    expect(types).toContain('FaithWrathFell');
    expect(missingEventKeys(r.events)).toEqual([]);
    expect(cond(w, n, 'isConverted')).toBe(true);
    expect(cond(w, n, 'piety')).toBe(t.piety.startOnConversion);
    expect(dispatch(n, { type: 'convertHouse' }, w.env).error?.code).toBe('alreadyConverted');
    expect(dispatch(n, { type: 'sacrifice', god: 'saltha', kind: 'silver', size: 'modest' }, w.env).error?.code).toBe('wrongFaith');
  });

  it('holdings convert at 5 % a year (twice as fast with a chapel) and resentment fades over 5 years', () => {
    const w = world();
    let s = dispatch(ready(w), { type: 'convertHouse' }, w.env).state;
    const capital = s.player.capitalId;
    const flipMonths = (mult: number) => Math.ceil(t.conversion.flipShare / ((t.conversion.holdingSharePerYear / 12) * mult) - 1e-9);
    const withChapel = flipMonths(t.conversion.chapelShareMult);
    const without = flipMonths(1);
    expect(withChapel).toBe(60);
    let flippedAt: Record<string, number> = {};
    for (let m = 1; m <= without; m++) {
      const r = advance(s, HOURS_PER_MONTH, w.env);
      for (const e of r.events) if (e.type === 'HoldingConverted') flippedAt[e.settlementId] = m;
      s = r.state;
      if (m === 30) expect(s.faith?.conversion?.resentment[w.village]).toBeCloseTo(10, 6);
    }
    expect(flippedAt).toEqual({ [capital]: withChapel, [w.village]: without });
    expect(s.settlements[capital]?.faith).toBe('lantern');
    expect(s.settlements[w.village]?.faith).toBe('lantern');
    expect(s.faith?.conversion?.resentment).toEqual({});
    flippedAt = {};
  });
});

describe('Piety (the converted house)', () => {
  it('alms have diminishing returns; neglect costs Piety; chapels add Piety', () => {
    const w = world();
    let s = dispatch(ready(w), { type: 'convertHouse' }, w.env).state;
    const gains: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = dispatch(s, { type: 'giveAlms', size: 'modest' }, w.env);
      expect(r.error).toBeUndefined();
      expect(missingEventKeys(r.events)).toEqual([]);
      gains.push((r.state.player.house.piety ?? 0) - (s.player.house.piety ?? 0));
      s = r.state;
    }
    expect(gains).toEqual([2, 1, 1, 0]);
    // Tended this month: no neglect next month; then −1 per untended month.
    const p0 = s.player.house.piety ?? 0;
    s = advance(s, HOURS_PER_MONTH, w.env).state;
    expect(s.player.house.piety).toBe(p0);
    s = advance(s, HOURS_PER_MONTH, w.env).state;
    expect(s.player.house.piety).toBe(p0 - t.piety.neglectPerMonth);
    const before = s.player.house.piety ?? 0;
    const chapel = dispatch(s, { type: 'foundChapel', settlementId: w.village }, w.env);
    expect(chapel.error).toBeUndefined();
    expect(chapel.state.player.house.piety).toBe(before + (t.deeds['chapelBuilt']?.piety ?? 0));
    expect(dispatch(chapel.state, { type: 'foundChapel', settlementId: w.village }, w.env).error?.code).toBe('chapelExists');
  });

  it('priests read signs from Piety at a chapel or a Lantern church', () => {
    const w = world();
    const s = dispatch(ready(w), { type: 'convertHouse' }, w.env).state;
    const r = dispatch(s, { type: 'readOmen' }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.player.house.omens?.voyage?.signs).toBe(true);
    expect(r.events.some((e) => e.type === 'NarrationLine' && e.key.startsWith('faith.omen.signs.'))).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
    const noChapel = apply(w, s, (d) => {
      d.player.house.chapels = [];
    });
    expect(dispatch(noChapel, { type: 'readOmen' }, w.env).error?.code).toBe('noPriest');
  });

  it('a Lantern house earns Piety, not Favor, from pious deeds', () => {
    const w = world();
    const s = dispatch(ready(w), { type: 'convertHouse' }, w.env).state;
    const lt = Object.values(s.characters).find((c) => c.factionId === s.player.factionId && c.id !== s.player.rulerId);
    const r = inDraft(s, w.env, (_d, ctx) => ctx.runAs('people', () => ctx.emit({ type: 'Death', charId: lt?.id, cause: 'old age' } as unknown as SimEvent)));
    expect((r.state.player.house.piety ?? 0) - (s.player.house.piety ?? 0)).toBe(t.deeds['properFuneral']?.piety);
    expect(r.state.player.house.favor).toEqual(s.player.house.favor);
  });
});

describe('Lantern contact (Missionary trigger)', () => {
  it('a player fleet arriving at a Lantern settlement or a Lantern envoy counts as contact', () => {
    const w = world();
    expect(cond(w, w.state, 'recentLanternContact')).toBe(false);
    const fleetId = w.fleetIds[w.state.player.factionId]?.[0];
    const lanternTown = w.settlementIds[w.lantern[0] as FactionId]?.[0];
    const r = inDraft(w.state, w.env, (_d, ctx) =>
      ctx.runAs('world', () => ctx.emit({ type: 'Arrived', fleetId, settlementId: lanternTown } as unknown as SimEvent)),
    );
    expect(cond(w, r.state, 'recentLanternContact')).toBe(true);
    const env2 = inDraft(w.state, w.env, (_d, ctx) =>
      ctx.runAs('diplomacy', () => ctx.emit({ type: 'EnvoyArrived', fromFactionId: w.lantern[0] } as unknown as SimEvent)),
    );
    expect(cond(w, env2.state, 'recentLanternContact')).toBe(true);
    let later = r.state;
    for (let m = 0; m < 7; m++) later = advance(later, HOURS_PER_MONTH, w.env).state;
    expect(cond(w, later, 'recentLanternContact')).toBe(false);
  });
});
