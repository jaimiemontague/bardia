import { getContent } from '@content/index';
import { missingLocaleKeys } from '@content/locales/index';
import { coreInvariants } from '@sim/core/builtins';
import type { Command } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import { advance } from '@sim/core/scheduler';
import type { GameState, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY, HOURS_PER_MONTH } from '@sim/core/time';
import { inDraft, missingEventKeys, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import {
  buildingOption,
  buildSlots,
  garrisonMen,
  garrisonPreview,
  holdingsInvariants,
  loyaltyForecast,
  loyaltyReasons,
  menAtHome,
  neededGarrison,
  module as holdings,
  playerHoldingIds,
  queueProgress,
  recommendedGarrison,
  tierInfo,
} from './index';

const content = getContent();
const L = content.balance.loyalty;

function eventsOf<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): Extract<SimEvent, { type: K }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** A small world: the player's capital and two more holdings, a rich treasury. */
function realm(seed = 'holdings') {
  const w = testWorld({ modules: [holdings], factions: 2, settlementsPerFaction: 3, seed });
  const ids = playerHoldingIds(w.state);
  const capital = w.state.player.capitalId;
  const state = inDraft(w.state, w.env, (d) => {
    const f = d.factions[d.player.factionId];
    if (f) f.treasury = 50000;
  }).state;
  return { ...w, state, capital, ids };
}

function edit(state: GameState, env: ReturnType<typeof realm>['env'], fn: (d: GameState) => void): GameState {
  return inDraft(state, env, (d) => fn(d)).state;
}

function run(state: GameState, env: ReturnType<typeof realm>['env'], cmd: Command) {
  return dispatch(state, cmd, env);
}

describe('holdings: setup', () => {
  it('a new game has the slice, the capital first among the holdings, and no invariant violations', () => {
    const w = realm();
    expect(w.state.holdingsState?.version).toBe(1);
    expect(w.ids[0]).toBe(w.capital);
    expect(w.ids.length).toBeGreaterThan(1);
    expect(holdingsInvariants(w.state)).toEqual([]);
  });

  it('init and migrate work on a campaign already under way (a save made with the stub)', () => {
    const w = realm('holdings-migrate');
    const old = edit(w.state, w.env, (d) => {
      delete d.holdingsState;
      d.meta.moduleVersions['holdings'] = 0;
      const h = d.settlements[w.capital]?.holding;
      if (h) h.buildQueue.push({ buildingId: 'walls', tier: (d.settlements[w.capital]?.buildings['walls'] ?? 0) + 1, doneHour: d.time.hour + 48 });
    });
    const migrated = inDraft(old, w.env, (d, ctx) => holdings.migrate?.(d, 0, ctx)).state;
    expect(migrated.holdingsState?.nextDueHour).toBe(old.time.hour + 48);
    const inited = inDraft(old, w.env, (d, ctx) => holdings.init?.(d, ctx)).state;
    expect(inited.holdingsState?.reports).toEqual({});
    expect(holdingsInvariants(inited)).toEqual([]);
  });
});

describe('setTax (§10.3, §31.1)', () => {
  it('sets the level the ledger reads and the loyalty term follows it', () => {
    const w = realm();
    const r = run(w.state, w.env, { type: 'setTax', holdingId: w.capital, tax: 'light' });
    expect(r.error).toBeUndefined();
    expect(r.state.settlements[w.capital]?.holding?.tax).toBe('light');
    const tax = loyaltyReasons(r.state, content, w.capital).find((x) => x.id === 'tax');
    expect(tax?.amount).toBe(L.tax.light);
    const crushing = loyaltyForecast(r.state, content, w.capital, { tax: 'crushing' });
    expect(crushing.reasons.find((x) => x.id === 'tax')?.amount).toBe(L.tax.crushing);
  });

  it('rejects foreign settlements and unknown levels with clear codes', () => {
    const w = realm();
    const foreign = (w.settlementIds[w.factionIds[1] as keyof typeof w.settlementIds] as SettlementId[])[0] as SettlementId;
    expect(run(w.state, w.env, { type: 'setTax', holdingId: foreign, tax: 'heavy' }).error?.code).toBe('notYourHolding');
    const bad = run(w.state, w.env, { type: 'setTax', holdingId: w.capital, tax: 'ruinous' } as unknown as Command);
    expect(bad.error).toBeDefined();
    expect(bad.state).toBe(w.state);
  });
});

describe('queueBuilding (§10.4)', () => {
  it('pays the silver, builds over the tier’s days, then raises the tier with an event, a notice and a Chronicle line', () => {
    const w = realm();
    const s0 = w.state.settlements[w.capital];
    const walls = s0?.buildings['walls'] ?? 0;
    const next = tierInfo(content, 'walls', walls + 1);
    expect(next).toBeDefined();
    const treasury = w.state.factions[w.state.player.factionId]?.treasury ?? 0;
    const r = run(w.state, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'walls' });
    expect(r.error).toBeUndefined();
    expect(r.state.factions[w.state.player.factionId]?.treasury).toBe(treasury - (next?.cost ?? 0));
    const entry = r.state.settlements[w.capital]?.holding?.buildQueue[0];
    expect(entry).toMatchObject({ buildingId: 'walls', tier: walls + 1 });
    expect(queueProgress(content, entry!, r.state.time.hour).progress).toBe(0);

    const half = advance(r.state, ((next?.days ?? 0) * HOURS_PER_DAY) / 2, w.env);
    expect(half.state.settlements[w.capital]?.buildings['walls']).toBe(walls);
    expect(queueProgress(content, entry!, half.state.time.hour).progress).toBeCloseTo(0.5, 2);

    const done = advance(half.state, ((next?.days ?? 0) * HOURS_PER_DAY) / 2, w.env);
    const s = done.state.settlements[w.capital];
    expect(s?.buildings['walls']).toBe(walls + 1);
    expect(s?.fortTier).toBe(walls + 1);
    expect(s?.holding?.buildQueue).toEqual([]);
    expect(done.state.holdingsState?.nextDueHour).toBeUndefined();
    const ev = eventsOf(done.events, 'BuildingCompleted');
    expect(ev).toEqual([{ type: 'BuildingCompleted', settlementId: w.capital, factionId: w.state.player.factionId, buildingId: 'walls', tier: walls + 1 }]);
    expect(done.state.chronicle.some((c) => c.textKey === 'holdings.chronicle.built')).toBe(true);
    expect(missingEventKeys(done.events)).toEqual([]);
    expect(holdingsInvariants(done.state)).toEqual([]);
  });

  it('one slot per holding (two with a Stewardship-8 governor); one tier at a time; the top tier ends it', () => {
    const w = realm();
    const a = run(w.state, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'walls' });
    expect(run(a.state, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'market' }).error?.code).toBe('queueFull');
    expect(run(a.state, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'walls' }).error?.code).toBe('alreadyBuilding');
    const steward = edit(a.state, w.env, (d) => {
      const gov = d.settlements[w.capital]?.holding?.governorId;
      const c = gov ? d.characters[gov] : undefined;
      if (c) c.skills.stewardship = content.balance.holdings.highStewardshipLevel;
    });
    expect(buildSlots(steward, content, steward.settlements[w.capital]!)).toBe(content.balance.holdings.buildSlotsHighStewardship);
    expect(run(steward, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'market' }).error).toBeUndefined();
    const top = edit(w.state, w.env, (d) => {
      const s = d.settlements[w.capital];
      if (s) s.buildings['hall'] = 3;
    });
    expect(run(top, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'hall' }).error?.code).toBe('maxTier');
  });

  it('refuses without silver, without a harbour for a shipyard, and unknown buildings', () => {
    const w = realm();
    const poor = edit(w.state, w.env, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) f.treasury = 10;
    });
    expect(run(poor, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'walls' }).error?.code).toBe('treasury');
    const inland = edit(w.state, w.env, (d) => {
      const s = d.settlements[w.capital];
      if (s) {
        s.coastal = false;
        s.buildings['shipyard'] = 0;
      }
    });
    expect(buildingOption(inland, content, w.capital, 'shipyard').issues).toContain('needsHarbour');
    expect(run(inland, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'shipyard' }).error?.code).toBe('needsHarbour');
    expect(run(w.state, w.env, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'catapultWorks' }).error?.code).toBe('unknownBuilding');
  });

  it('a first tier the design prices "—" is founded at the tunables price', () => {
    const info = tierInfo(content, 'hall', 1);
    expect(info?.founding).toBe(true);
    expect(info?.cost).toBe(content.tunables.holdings.founding['hall']?.cost);
    expect(tierInfo(content, 'walls', 1)?.founding).toBe(false);
    expect(tierInfo(content, 'walls', 1)?.cost).toBe(content.balance.buildings.walls.tiers[0]?.cost);
  });
});

describe('men at home (the garrison term)', () => {
  it('counts the garrison, the men of docked fleets and the wounded there; not men at sea or in another harbour', () => {
    const w = realm();
    const player = w.state.player.factionId;
    const fleetId = (w.fleetIds[player] as string[])[0] as keyof GameState['fleets'];
    const setFleet = (mode: 'docked' | 'sailing', far: boolean) =>
      edit(w.state, w.env, (d) => {
        const f = d.fleets[fleetId];
        const c = d.settlements[w.capital];
        if (!f || !c) return;
        f.men = { bondi: 30 };
        f.mode = mode;
        f.pos = far ? { x: c.mapPos.x + 50, y: c.mapPos.y + 50 } : { ...c.mapPos };
        (c as unknown as { woundedMen?: unknown[] }).woundedMen = [{ unit: 'bondi', count: 4, progress: 0, battles: 0, sinceHour: 0 }];
      });
    const home = setFleet('docked', false);
    const cap = home.settlements[w.capital]!;
    expect(menAtHome(home, content, cap)).toEqual({ garrison: garrisonMen(cap), hird: 30, wounded: 4, total: garrisonMen(cap) + 34 });
    expect(menAtHome(setFleet('sailing', false), content, cap).hird).toBe(0);
    expect(menAtHome(setFleet('docked', true), content, cap).hird).toBe(0);
  });

  it('the loyalty term applies below the needed share of the recommended garrison, and lifts when the fleet is home', () => {
    const w = realm();
    const player = w.state.player.factionId;
    const fleetId = (w.fleetIds[player] as string[])[0] as keyof GameState['fleets'];
    const thin = edit(w.state, w.env, (d) => {
      const c = d.settlements[w.capital];
      const f = d.fleets[fleetId];
      if (!c || !f) return;
      c.pop = 2000;
      c.garrison = { bondi: 10 };
      f.men = { bondi: 60 };
      f.mode = 'sailing';
      f.pos = { x: c.mapPos.x + 50, y: c.mapPos.y + 50 };
    });
    const cap = thin.settlements[w.capital]!;
    expect(neededGarrison(content, cap)).toBe(Math.ceil(2000 * content.balance.holdings.garrisonMinPopShare * content.tunables.holdings.garrison.penaltyShareOfRecommended));
    expect(loyaltyReasons(thin, content, w.capital).find((r) => r.id === 'lowGarrison')?.amount).toBe(L.lowGarrison);
    const back = edit(thin, w.env, (d) => {
      const f = d.fleets[fleetId];
      const c = d.settlements[w.capital];
      if (!f || !c) return;
      f.mode = 'docked';
      f.pos = { ...c.mapPos };
    });
    expect(loyaltyReasons(back, content, w.capital).find((r) => r.id === 'lowGarrison')).toBeUndefined();
  });
});

describe('setGarrison', () => {
  it('sends men home to the pool (raw counts without the military module) and refuses raises', () => {
    const w = realm();
    const s = w.state.settlements[w.capital]!;
    const [unit, have] = Object.entries(s.garrison).find(([, n]) => n > 1) as [string, number];
    const pool = s.holding!.pool.current;
    const p = garrisonPreview(w.state, content, { holdingId: w.capital, units: { [unit]: have - 1 } });
    expect(p).toMatchObject({ released: 1, ok: true });
    const r = run(w.state, w.env, { type: 'setGarrison', holdingId: w.capital, units: { [unit]: have - 1 } });
    expect(r.error).toBeUndefined();
    expect(r.state.settlements[w.capital]?.garrison[unit]).toBe(have - 1);
    expect(r.state.settlements[w.capital]?.holding?.pool.current).toBe(pool + 1);
    expect(run(w.state, w.env, { type: 'setGarrison', holdingId: w.capital, units: { [unit]: have + 5 } }).error?.code).toBe('raiseThroughMuster');
    expect(run(w.state, w.env, { type: 'setGarrison', holdingId: w.capital, units: { [unit]: have } }).error?.code).toBe('nothingToChange');
  });
});

describe('monthly loyalty (§31.7)', () => {
  it('applies the reasons through changeLoyalty and keeps them for the screen', () => {
    const w = realm();
    const start = edit(w.state, w.env, (d) => {
      const h = d.settlements[w.capital]?.holding;
      if (h) {
        h.tax = 'light';
        h.loyalty = 40;
      }
    });
    const forecast = loyaltyForecast(start, content, w.capital);
    const r = advance(start, HOURS_PER_MONTH, w.env);
    const report = r.state.holdingsState?.reports[w.capital];
    expect(report?.before).toBe(40);
    expect(report?.reasons).toEqual(forecast.reasons);
    expect(report?.after).toBe(forecast.to);
    expect(report?.reasons.find((x) => x.id === 'tax')?.amount).toBe(L.tax.light);
    expect(report?.reasons.find((x) => x.id === 'drift')?.amount).toBe(L.drift);
    expect(eventsOf(r.events, 'LoyaltyChanged').some((e) => e.targetId === w.capital)).toBe(true);
    expect(holdingsInvariants(r.state)).toEqual([]);
  });

  it('each §31.7 term: famine, low garrison, absence, renown, victories, a raid, a feast, the ruler’s culture', () => {
    const w = realm();
    const s = edit(w.state, w.env, (d) => {
      const c = d.settlements[w.capital];
      if (!c?.holding) return;
      c.holding.foodMonths = 0;
      c.garrison = {};
      for (const f of Object.values(d.fleets)) if (f.ownerId === d.player.factionId) f.mode = 'sailing';
      c.culture = c.culture === 'skarn' ? 'eyjar' : 'skarn';
      d.player.house.renown = 600;
      (d as GameState & { military?: { monthBattles: { won: number; lost: number } } }).military = { monthBattles: { won: 5, lost: 0 } } as never;
      (c as typeof c & { raidedHour?: number }).raidedHour = d.time.hour + 1;
      const slice = d.holdingsState!;
      slice.awaySinceHour = d.time.hour - (content.balance.holdings.absenceDays + 1) * HOURS_PER_DAY;
      slice.feastHour = d.time.hour + 1;
      slice.lastMonthlyHour = d.time.hour;
    });
    const later = { ...s, time: { ...s.time, hour: s.time.hour + 2 } };
    const by = Object.fromEntries(loyaltyReasons(later, content, w.capital).map((r) => [r.id, r.amount]));
    expect(by['famine']).toBe(L.famine);
    expect(by['lowGarrison']).toBe(L.lowGarrison);
    expect(by['rulerCulture']).toBe(L.rulerCultureMismatch);
    expect(by['absence']).toBe(L.absence);
    expect(by['victories']).toBe(L.victoryMaxPerMonth);
    expect(by['raided']).toBe(L.raided);
    expect(by['feast']).toBe(L.feast);
    expect(by['renown']).toBe(L.renownTierBonus[4]);
    expect(garrisonMen(later.settlements[w.capital]!)).toBeLessThan(recommendedGarrison(content, later.settlements[w.capital]!));
  });

  it('the ruler away from home starts the absence clock; home again stops it', () => {
    const w = realm();
    const away = edit(w.state, w.env, (d) => {
      const r = d.characters[d.player.rulerId];
      if (r) r.location = { kind: 'none' };
    });
    const a = advance(away, HOURS_PER_DAY, w.env);
    expect(a.state.holdingsState?.awaySinceHour).toBeDefined();
    const back = edit(a.state, w.env, (d) => {
      const r = d.characters[d.player.rulerId];
      if (r) r.location = { kind: 'settlement', id: w.capital };
    });
    expect(advance(back, HOURS_PER_DAY, w.env).state.holdingsState?.awaySinceHour).toBeUndefined();
  });
});

describe('holdings: a year, determinism and text', () => {
  const script = (state: GameState, env: ReturnType<typeof realm>['env'], capital: SettlementId) => {
    let s = dispatch(state, { type: 'setTax', holdingId: capital, tax: 'heavy' }, env).state;
    s = dispatch(s, { type: 'queueBuilding', holdingId: capital, buildingId: 'walls' }, env).state;
    const events: SimEvent[] = [];
    for (let m = 0; m < 12; m++) {
      const r = advance(s, HOURS_PER_MONTH, env);
      s = r.state;
      events.push(...r.events);
      expect(holdingsInvariants(s)).toEqual([]);
      expect(coreInvariants(s)).toEqual([]);
    }
    return { state: s, events };
  };

  it('a year runs clean; the same seed and inputs give identical JSON', () => {
    const a = realm('holdings-det');
    const b = realm('holdings-det');
    const ra = script(a.state, a.env, a.capital);
    const rb = script(b.state, b.env, b.capital);
    expect(JSON.stringify(ra.state)).toBe(JSON.stringify(rb.state));
    expect(missingEventKeys(ra.events)).toEqual([]);
    expect(ra.state.settlements[a.capital]?.holding?.loyalty).toBeLessThan(a.state.settlements[a.capital]?.holding?.loyalty ?? 0);
  });

  it('every reason, tax level, building and issue has a string', () => {
    const keys: string[] = [];
    for (const id of ['tax', 'victories', 'feast', 'absence', 'famine', 'raided', 'rulerCulture', 'rulerFaith', 'renown', 'lowGarrison', 'residence', 'drift']) keys.push(`holdings.reason.${id}`);
    for (const id of ['notYourHolding', 'unknownBuilding', 'maxTier', 'alreadyBuilding', 'queueFull', 'needsHarbour', 'treasury']) keys.push(`holdings.issue.${id}`);
    for (const id of ['notYourHolding', 'badCount', 'raiseThroughMuster', 'nothingToChange']) keys.push(`holdings.garrisonIssue.${id}`);
    for (const id of Object.keys(content.balance.buildings)) keys.push(`holdings.building.${id}`, `holdings.buildingBlurb.${id}`);
    for (const id of ['light', 'fair', 'heavy', 'crushing']) keys.push(`holdings.tax.${id}`);
    const effectKeys: string[] = [];
    for (const def of Object.values(content.balance.buildings)) for (const row of def.tiers) for (const k of Object.keys(row.effects)) if (!effectKeys.includes(`holdings.effect.${k}`)) effectKeys.push(`holdings.effect.${k}`);
    keys.push(...effectKeys);
    expect(missingLocaleKeys(keys)).toEqual([]);
  });
});
