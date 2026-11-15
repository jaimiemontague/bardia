import { getContent } from '@content/index';
import type { SimEvent } from '@sim/core/events';
import { getRelation } from '@sim/core/factory';
import { advance } from '@sim/core/scheduler';
import type { FactionId, GameState, SettlementId } from '@sim/core/state';
import { fromCalendar, HOURS_PER_MONTH } from '@sim/core/time';
import { inDraft, missingEventKeys, testWorld, type TestWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { module as faith } from './index';
import { withFaithWrath } from './testing';
import { SERMONS_REASON } from './wrath';

const content = getContent();
const W = content.balance.standing.faithWrath;
const t = content.tunables.faith;

/** A world with Old Ways and Lantern AI factions; returns a Lantern settlement made into a cloister or a town. */
function world(): TestWorld & { lanternFaction: FactionId; town: SettlementId; cloister: SettlementId } {
  const w = testWorld({ modules: [faith], factions: 5 });
  const lanternFaction = w.factionIds.find((id) => w.state.factions[id]?.faith === 'lantern') as FactionId;
  const [town, cloister] = w.settlementIds[lanternFaction] as [SettlementId, SettlementId];
  const state = inDraft(w.state, w.env, (d) => {
    const c = d.settlements[cloister];
    if (c) c.tier = 'cloister';
  }).state;
  return { ...w, state, lanternFaction, town, cloister };
}

function fate(state: GameState, w: TestWorld, settlementId: SettlementId, fateId: string, extra: Record<string, unknown> = {}) {
  return inDraft(state, w.env, (_d, ctx) =>
    ctx.runAs('settlements', () => ctx.emit({ type: 'SettlementFate', settlementId, fate: fateId, ...extra } as unknown as SimEvent)),
  );
}

describe('Faith Wrath from settlement fates (§16.3)', () => {
  it('sacking and burning a cloister: burnCloister + sackCloister', () => {
    const w = world();
    const r = fate(w.state, w, w.cloister, 'sackAndBurn');
    expect(r.state.player.house.faithWrath).toBe(W.burnCloister + W.sackCloister);
    expect(r.events.some((e) => e.type === 'StandingChanged' && e.stat === 'faithWrath')).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('plundering a cloister, a Lantern town, taking clergy, annexing', () => {
    const w = world();
    expect(fate(w.state, w, w.cloister, 'plunderAndLeave').state.player.house.faithWrath).toBe(t.wrath.plunderLantern + W.sackCloister);
    expect(fate(w.state, w, w.town, 'plunderAndLeave').state.player.house.faithWrath).toBe(t.wrath.plunderLantern);
    expect(fate(w.state, w, w.town, 'sackAndBurn').state.player.house.faithWrath).toBe(W.burnCloister);
    expect(fate(w.state, w, w.cloister, 'takeCaptives').state.player.house.faithWrath).toBe(t.wrath.plunderLantern + W.sackCloister + t.wrath.clergyCaptives);
    expect(fate(w.state, w, w.town, 'takeCaptives', { clergy: true }).state.player.house.faithWrath).toBe(t.wrath.plunderLantern + t.wrath.clergyCaptives);
    expect(fate(w.state, w, w.town, 'annex').state.player.house.faithWrath).toBe(t.wrath.annexLantern);
    expect(fate(w.state, w, w.town, 'spare').state.player.house.faithWrath).toBe(0);
  });

  it('raiding on a Lantern holy day adds holyDayRaid', () => {
    const w = world();
    const day = t.wrath.holyDays[0];
    expect(day).toBeDefined();
    const holy = inDraft(w.state, w.env, (d) => {
      d.time.hour = fromCalendar({ year: 812, monthIndex: day?.monthIndex ?? 0, day: day?.day ?? 1, hour: 12 });
    }).state;
    expect(fate(holy, w, w.town, 'plunderAndLeave').state.player.house.faithWrath).toBe(t.wrath.plunderLantern + W.holyDayRaid);
  });

  it('other factions’ fates and Old Ways towns raise no wrath', () => {
    const w = world();
    expect(fate(w.state, w, w.cloister, 'sackAndBurn', { byFactionId: w.lanternFaction }).state.player.house.faithWrath).toBe(0);
    const oldWays = w.settlementIds[w.factionIds[1] as FactionId]?.[0] as SettlementId;
    expect(fate(w.state, w, oldWays, 'sackAndBurn').state.player.house.faithWrath).toBe(0);
  });
});

describe('thresholds and decay (§4.4)', () => {
  it('announces sermons, the Muster and the Ban once each, in order, and applies the sermons opinion', () => {
    const w = world();
    let s = w.state;
    const rose: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = fate(s, w, w.cloister, 'sackAndBurn');
      for (const e of r.events) if (e.type === 'FaithWrathRose') rose.push(`${e.level}@${e.value}`);
      expect(missingEventKeys(r.events)).toEqual([]);
      s = r.state;
    }
    expect(s.player.house.faithWrath).toBe(W.max);
    expect(rose).toEqual(['sermons@50', 'muster@75', 'ban@100']);
    const rel = getRelation(s, s.player.factionId, w.lanternFaction);
    expect(rel?.modifiers.find((m) => m.reason === SERMONS_REASON)?.value).toBe(W.sermonsOpinion);
    const oldWaysFaction = w.factionIds[1] as FactionId;
    expect(getRelation(s, s.player.factionId, oldWaysFaction)?.modifiers.some((m) => m.reason === SERMONS_REASON)).toBe(false);
    expect(s.faith?.wrathLevel).toBe(3);
  });

  it('decays −2 per month and announces falling below a threshold, lifting the sermons', () => {
    const w = world();
    let s = fate(w.state, w, w.cloister, 'sackAndBurn').state; // 25
    s = inDraft(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'changeFaithWrath', amount: 6 }])).state; // 31
    expect(s.player.house.faithWrath).toBe(31);
    expect(s.faith?.wrathLevel).toBe(1);
    const r1 = advance(s, HOURS_PER_MONTH, w.env);
    expect(r1.state.player.house.faithWrath).toBe(31 - W.decayPerMonth);
    expect(r1.events.some((e) => e.type === 'FaithWrathFell' && e.level === 'sermons')).toBe(true);
    const rel = getRelation(r1.state, s.player.factionId, w.lanternFaction);
    expect(rel?.modifiers.filter((m) => m.reason === SERMONS_REASON).reduce((a, m) => a + m.value, 0)).toBe(0);
    let z = r1.state;
    for (let m = 0; m < 20; m++) z = advance(z, HOURS_PER_MONTH, w.env).state;
    expect(z.player.house.faithWrath).toBe(0);
  });

  it('changeFaithWrath clamps to 0–100', () => {
    const w = world();
    const low = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'changeFaithWrath', amount: -50 }])).state;
    expect(low.player.house.faithWrath).toBe(0);
    const high = withFaithWrath(w.state, w.env, 95);
    const r = inDraft(high, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'changeFaithWrath', amount: 50 }]));
    expect(r.state.player.house.faithWrath).toBe(100);
    expect(r.events.filter((e) => e.type === 'FaithWrathRose')).toHaveLength(0);
  });
});
