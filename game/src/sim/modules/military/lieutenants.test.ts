import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { EN_TABLES } from '@content/locales/index';
import { dispatch } from '@sim/core/dispatch';
import { createFaction } from '@sim/core/factory';
import type { CharId, GameState } from '@sim/core/state';
import { HOURS_PER_MONTH } from '@sim/core/time';
import { advance } from '@sim/core/scheduler';
import { missingEventKeys } from '../../testing';
import { candidatesForRole, lieutenantCapacity, lieutenantLoyaltyDelta, lieutenantsOf, sellswordOffers } from './lieutenants';
import { capitalOf, edit, militaryContent, militaryEnv, militaryState, mustDispatch } from './testing';

const content = getContent();
const env = militaryEnv();
const strings = EN_TABLES.military as Record<string, string>;

/** Placeholder home with Hall II (capacity 4: two free slots) and a deep treasury. */
function hall2(): GameState {
  return edit(militaryState(), env, (d) => {
    const c = d.settlements[d.player.capitalId];
    if (c) c.buildings.hall = 2;
    const f = d.factions[d.player.factionId];
    if (f) f.treasury = 20000;
  });
}

function lieutenantIds(s: GameState): CharId[] {
  return lieutenantsOf(s, content, s.player.factionId).map((c) => c.id);
}

describe('capacity', () => {
  it('Hall tier gives 2/4/7, +1 per crown flag', () => {
    const s0 = militaryState();
    expect(lieutenantCapacity(s0, content, s0.player.factionId)).toMatchObject({ capacity: 2, used: 2, free: 0, hallTier: 1 });
    const s1 = hall2();
    expect(lieutenantCapacity(s1, content, s1.player.factionId)).toMatchObject({ capacity: 4, free: 2 });
    const s2 = edit(s1, env, (d) => {
      const c = d.settlements[d.player.capitalId];
      if (c) c.buildings.hall = 3;
      d.flags['crown:skarnheim'] = true;
      d.flags['crown:hvarnland'] = false;
    });
    expect(lieutenantCapacity(s2, content, s2.player.factionId)).toMatchObject({ capacity: 8, crowns: 1 });
  });

  it('lists candidates for a role among lieutenants and adult kin', () => {
    const s = militaryState();
    const ids = lieutenantIds(s);
    expect(candidatesForRole(s, content, s.player.factionId, 'governor').map((c) => c.id)).toEqual(ids);
  });
});

describe('sellswords', () => {
  it('offers are deterministic per settlement and month, within the design ranges', () => {
    const s = hall2();
    const cap = capitalOf(s);
    const a = sellswordOffers(s, content, cap);
    const b = sellswordOffers(s, content, cap);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(3);
    for (const o of a) {
      expect(o.price).toBeGreaterThanOrEqual(300);
      expect(o.price).toBeLessThanOrEqual(1500);
      expect(o.price % 10).toBe(0);
      expect(o.level).toBeGreaterThanOrEqual(1);
      expect(o.level).toBeLessThanOrEqual(5);
      expect(strings[o.backstoryKey]).toBeTypeOf('string');
      for (const t of o.traits) expect(o.traits).not.toContain(content.traits[t]?.opposite);
      expect(o.name.length).toBeGreaterThan(0);
    }
    const nextMonth = edit(s, env, (d) => {
      d.time.hour += HOURS_PER_MONTH;
    });
    expect(sellswordOffers(nextMonth, content, cap)).not.toEqual(a);
  });

  it('every configured backstory has a string', () => {
    for (const id of content.tunables.military.sellswords.backstories) expect(strings[`military.backstory.${id}`]).toBeTypeOf('string');
  });

  it('hiring creates a lieutenant with loyalty 40, a backstory and the offer price', () => {
    const s0 = hall2();
    const cap = capitalOf(s0);
    const offer = sellswordOffers(s0, content, cap)[0];
    if (!offer) throw new Error('no offer');
    const r = mustDispatch(s0, env, { type: 'hireSellsword', settlementId: cap, offer: offer.index });
    const joined = r.events.find((e) => e.type === 'LieutenantJoined');
    expect(joined).toMatchObject({ source: 'sellsword', cost: offer.price });
    const c = r.state.characters[(joined as { charId: CharId }).charId];
    expect(c).toMatchObject({
      name: offer.name,
      culture: offer.culture,
      loyalty: 40,
      backstory: offer.backstory,
      level: offer.level,
      factionId: s0.player.factionId,
      role: { kind: 'lieutenant', factionId: s0.player.factionId },
      portrait: { seed: offer.portraitSeed },
    });
    expect(c?.traits).toEqual(offer.traits);
    expect(r.state.factions[s0.player.factionId]?.treasury).toBe(20000 - offer.price);
    expect(sellswordOffers(r.state, content, cap)[0]?.hired).toBe(true);
    expect(dispatch(r.state, { type: 'hireSellsword', settlementId: cap, offer: offer.index }, env).error?.code).toBe('alreadyHired');
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('needs the ruler present, a free slot and an existing offer', () => {
    const s0 = militaryState();
    const cap = capitalOf(s0);
    expect(dispatch(s0, { type: 'hireSellsword', settlementId: cap, offer: 0 }, env).error?.code).toBe('capacity');
    const away = edit(hall2(), env, (d) => {
      const r = d.characters[d.player.rulerId];
      if (r) r.location = { kind: 'none' };
    });
    expect(dispatch(away, { type: 'hireSellsword', settlementId: cap, offer: 0 }, env).error?.code).toBe('notPresent');
    expect(dispatch(hall2(), { type: 'hireSellsword', settlementId: cap, offer: 99 }, env).error?.code).toBe('unknownOffer');
  });
});

describe('promoting veterans', () => {
  it('needs a squad with ≥3 battles; one man becomes a level 1–3 lieutenant for 300 s', () => {
    const green = edit(hall2(), env, (d) => {
      const c = d.settlements[d.player.capitalId];
      if (c) c.vetBattles = { bondi: 2 };
    });
    const cap = capitalOf(green);
    expect(dispatch(green, { type: 'promoteLieutenant', unit: 'bondi', settlementId: cap }, env).error?.code).toBe('tooGreen');
    const vets = edit(green, env, (d) => {
      const c = d.settlements[d.player.capitalId];
      if (c) c.vetBattles = { bondi: 3 };
    });
    const r = mustDispatch(vets, env, { type: 'promoteLieutenant', unit: 'bondi', settlementId: cap });
    const joined = r.events.find((e) => e.type === 'LieutenantJoined') as { charId: CharId } | undefined;
    const c = joined ? r.state.characters[joined.charId] : undefined;
    expect(c?.level).toBeGreaterThanOrEqual(1);
    expect(c?.level).toBeLessThanOrEqual(3);
    expect(c?.loyalty).toBe(content.balance.defaults.lieutenantLoyalty);
    expect(c?.location).toEqual({ kind: 'settlement', id: cap });
    expect(r.state.settlements[cap]?.garrison.bondi).toBe(39);
    expect(r.state.factions[r.state.player.factionId]?.treasury).toBe(20000 - 300);
    expect(dispatch(vets, { type: 'promoteLieutenant', unit: 'bondi' }, env).error?.code).toBe('badSource');
  });

  it('from an army, the veteran comes from the most experienced squad', () => {
    const s0 = edit(hall2(), env, (_d, ctx) =>
      ctx.applyEffects([
        {
          op: 'spawnArmy',
          squads: [
            { unit: 'bondi', men: 20, vetStars: 0 },
            { unit: 'bondi', men: 10, vetStars: 3 },
          ],
        },
      ]),
    );
    const armyId = s0.military?.lastSpawnedArmyId;
    if (!armyId) throw new Error('no army');
    const r = mustDispatch(s0, env, { type: 'promoteLieutenant', unit: 'bondi', armyId });
    expect(r.state.armies[armyId]?.squads.map((q) => q.men)).toEqual([20, 9]);
    const joined = r.events.find((e) => e.type === 'LieutenantJoined') as { charId: CharId } | undefined;
    expect(r.state.characters[joined?.charId as CharId]?.location).toEqual({ kind: 'army', id: armyId });
  });
});

describe('monthly loyalty and desertion', () => {
  it('drifts toward 50 shifted by the ruler’s loyalty.lieutenants modifiers', () => {
    const s0 = militaryState();
    const [first] = lieutenantIds(s0);
    const s1 = advance(s0, HOURS_PER_MONTH, env).state;
    expect(s1.characters[first as CharId]?.loyalty).toBe(59);
    const greedy = edit(s0, env, (d) => {
      const r = d.characters[d.player.rulerId];
      if (r) r.traits.push('greedy');
      const c = d.characters[first as CharId];
      if (c) c.loyalty = 40;
    });
    // Target 50 − 10 = 40: no change.
    expect(lieutenantLoyaltyDelta(greedy, content, greedy.characters[first as CharId]!)).toBe(0);
  });

  it('governorships, victories, defeats, honest lieutenants and idle ambition all count', () => {
    const s0 = edit(militaryState(), env, (d) => {
      const m = d.military;
      if (m) m.monthBattles = { won: 5, lost: 1 };
      d.player.house.honor = 60;
    });
    const [a, b] = lieutenantIds(s0) as [CharId, CharId];
    const s1 = edit(s0, env, (d) => {
      const ca = d.characters[a];
      if (ca) {
        ca.loyalty = 50;
        ca.role = { kind: 'governor', factionId: d.player.factionId };
        ca.traits = ['honest'];
      }
      const cb = d.characters[b];
      if (cb) {
        cb.loyalty = 50;
        cb.traits = ['ambitious'];
      }
    });
    // a: drift 0 + victories min(6, 10) + defeats −2 + governor 1 + honest 1 = 6
    expect(lieutenantLoyaltyDelta(s1, content, s1.characters[a]!)).toBe(6);
    // b: 0 + 6 − 2 − 1 (ambitious, not governing) = 3
    expect(lieutenantLoyaltyDelta(s1, content, s1.characters[b]!)).toBe(3);
    const s2 = advance(s1, HOURS_PER_MONTH, env).state;
    expect(s2.characters[a]?.loyalty).toBe(56);
    expect(s2.characters[b]?.loyalty).toBe(53);
    expect(s2.military?.monthBattles).toEqual({ won: 0, lost: 0 });
  });

  it('below 20 a lieutenant may desert (governorships revert to the ruler) or defect to the Rival', () => {
    const cnt = militaryContent({ lieutenants: { desertBase: 1, defectChance: 0 } });
    const denv = militaryEnv([], cnt);
    const s0 = edit(militaryState(), denv, (d) => {
      const [first] = lieutenantsOf(d, cnt, d.player.factionId);
      if (!first) return;
      first.loyalty = 5;
      first.role = { kind: 'governor', holdingId: d.player.capitalId, factionId: d.player.factionId };
      const h = d.settlements[d.player.capitalId]?.holding;
      if (h) h.governorId = first.id;
    });
    const [deserter] = lieutenantIds(s0) as [CharId];
    const r = advance(s0, HOURS_PER_MONTH, denv);
    const c = r.state.characters[deserter];
    expect(c?.factionId).toBeUndefined();
    expect(c?.role).toEqual({ kind: 'npc' });
    expect(r.state.settlements[capitalOf(s0)]?.holding?.governorId).toBe(s0.player.rulerId);
    expect(r.events.find((e) => e.type === 'LieutenantDeserted')).toMatchObject({ charId: deserter });
    expect(missingEventKeys(r.events)).toEqual([]);

    const defectEnv = militaryEnv([], militaryContent({ lieutenants: { desertBase: 1, defectChance: 1 } }));
    const withRival = edit(s0, defectEnv, (d, ctx) => {
      const rival = createFaction(d, ctx, { culture: 'skarn', kind: 'nemesis' });
      d.player.nemesis = { factionId: rival.id, stage: 1, ended: false };
    });
    const r2 = advance(withRival, HOURS_PER_MONTH, defectEnv);
    const rivalId = r2.state.player.nemesis?.factionId;
    expect(r2.state.characters[deserter]).toMatchObject({ factionId: rivalId, role: { kind: 'lieutenant', factionId: rivalId }, loyalty: 45 });
    expect(r2.events.find((e) => e.type === 'LieutenantDeserted')).toMatchObject({ toFactionId: rivalId });
  });
});
