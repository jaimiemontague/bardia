import { getContent } from '@content/index';
import { getGeography } from '@content/world';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import { createCharacter, createFleet, createShip, getRelation } from '@sim/core/factory';
import { createNewGameState } from '@sim/core/lifecycle';
import { advance } from '@sim/core/scheduler';
import type { ArmyId, CultureId, FactionId, FleetId, GameState, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, missingEventKeys, testEnv } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { worldData } from './data';
import { distanceDays, isChartedAt, module as world, planRoute, splitGarrison } from './index';
import { CELL_LAND, cellAt } from './map';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const content = getContent();
const geo = getGeography();
const data = worldData();
const env = testEnv([world]);
const t = content.tunables.world;

function newGame(seed: string, culture: CultureId = 'skarn', startProvinceId?: string): GameState {
  return createNewGameState({ seed, player: { culture: culture as 'skarn' }, ...(startProvinceId !== undefined ? { options: { startProvinceId } } : {}) }, env).state;
}

const base = newGame('world-test');

function eventsOf<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): Extract<SimEvent, { type: K }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** A player fleet of snekkjur with a crew, docked at a settlement. */
function withPlayerFleet(state: GameState, at: SettlementId, ships = 2, type = 'snekkja'): { state: GameState; fleetId: FleetId } {
  let fleetId = '' as FleetId;
  const r = inDraft(state, env, (draft, ctx) => {
    const s = draft.settlements[at];
    if (!s) throw new Error('no settlement');
    const owner = draft.player.factionId;
    const captain = createCharacter(draft, ctx, { culture: 'skarn', age: 30, factionId: owner, skills: { seafaring: 3 }, role: { kind: 'captain', factionId: owner } });
    const shipIds = Array.from({ length: ships }, () => createShip(draft, ctx, { type: type as 'snekkja', ownerId: owner }).id);
    const f = createFleet(draft, ctx, { ownerId: owner, leaderId: captain.id, pos: { ...s.mapPos }, shipIds, men: { bondi: 50 * ships }, rations: 3000, mode: 'docked' });
    captain.location = { kind: 'fleet', id: f.id };
    fleetId = f.id;
  });
  return { state: r.state, fleetId };
}

describe('world generation', () => {
  it('is deterministic: same seed, same world; another seed, another world', () => {
    const a = JSON.stringify(newGame('det-1'));
    expect(JSON.stringify(newGame('det-1'))).toBe(a);
    expect(JSON.stringify(newGame('det-2'))).not.toBe(a);
  });

  it('builds every geography settlement and keeps every invariant, for each homeland culture', () => {
    for (const culture of ['skarn', 'hvarn', 'eyjar'] as CultureId[]) {
      const s = newGame(`inv-${culture}`, culture);
      expect(checkInvariants(s, env)).toEqual([]);
      expect(Object.keys(s.settlements)).toHaveLength(geo.settlements.length);
      const geoIds = Object.values(s.settlements).map((x) => x.geoId);
      for (const def of geo.settlements) expect(geoIds).toContain(def.id);
    }
  });

  it('re-homes the player onto a real jarldom of their culture (§5.1 step 8, ARCHITECTURE §15)', () => {
    const s = base;
    const cap = s.settlements[s.player.capitalId];
    expect(cap?.geoId).toBeDefined();
    expect(s.flags['placeholderHome']).toBeUndefined();
    expect(Object.values(s.provinces).some((p) => p.regionId === 'placeholder')).toBe(false);
    const prov = s.provinces[cap?.provinceId as never];
    const def = geo.provinces.find((p) => p.id === prov?.geoId);
    expect(def?.homeland).toBe(true);
    expect(geo.kingdoms.some((k) => k.seatProvinceId === def?.id)).toBe(false);
    expect(geo.kingdoms.find((k) => k.id === def?.kingdomId)?.culture).toBe('skarn');
    const ruler = s.characters[s.player.rulerId];
    expect(ruler?.location).toEqual({ kind: 'settlement', id: s.player.capitalId });
    expect(cap?.garrison).toEqual(content.balance.difficulty.raider.startUnits);
    expect(cap?.holding?.governorId).toBe(s.player.rulerId);
    const ships = Object.values(s.ships).filter((x) => x.ownerId === s.player.factionId);
    expect(ships.length).toBeGreaterThan(0);
    for (const ship of ships) expect(ship.dockedAt).toBe(s.player.capitalId);
    // Every settlement of the start province is the player's.
    for (const sid of prov?.settlementIds ?? []) expect(s.settlements[sid]?.factionId).toBe(s.player.factionId);
  });

  it('honours an eligible startProvinceId and falls back on an ineligible one', () => {
    const eligible = geo.provinces.filter((p) => p.homeland && p.colonized && p.kingdomId === 'hvarnland' && !geo.kingdoms.some((k) => k.seatProvinceId === p.id));
    const pick = eligible[eligible.length - 1]?.id as string;
    const s = newGame('start', 'hvarn', pick);
    expect(s.provinces[s.settlements[s.player.capitalId]?.provinceId as never]?.geoId).toBe(pick);
    const seat = geo.kingdoms.find((k) => k.id === 'hvarnland')?.seatProvinceId as string;
    const fallback = newGame('start', 'hvarn', seat);
    expect(fallback.provinces[fallback.settlements[fallback.player.capitalId]?.provinceId as never]?.geoId).not.toBe(seat);
  });

  it('gives the player the premise family: a slain parent, a surviving one, younger siblings', () => {
    const s = base;
    const ruler = s.characters[s.player.rulerId];
    const parents = [ruler?.family.fatherId, ruler?.family.motherId].map((id) => (id !== undefined ? s.characters[id] : undefined));
    expect(parents.filter((p) => p?.alive === false)).toHaveLength(1);
    expect(parents.filter((p) => p?.alive === true)).toHaveLength(1);
    const slain = parents.find((p) => p?.alive === false);
    expect(slain?.death?.hour).toBeLessThan(0);
    const mother = s.characters[ruler?.family.motherId as never];
    for (const id of mother?.family.childIds ?? []) {
      if (id === ruler?.id) continue;
      expect(s.characters[id]?.birthHour).toBeGreaterThan(ruler?.birthHour as number);
    }
    expect(s.chronicle.some((c) => c.kind === 'world.parentSlain')).toBe(true);
  });

  it('chooses a Rival next door with a temper, bad blood and a ring-fort on the border (§17.8)', () => {
    const s = base;
    const nem = s.player.nemesis;
    expect(nem?.stage).toBe(1);
    const rival = s.factions[nem?.factionId as FactionId];
    expect(rival).toBeDefined();
    expect(rival?.kind).not.toBe('kingdom');
    const ruler = s.characters[rival?.rulerId as never];
    expect(ruler?.traits.some((x) => t.rival.traits.includes(x))).toBe(true);
    const rel = getRelation(s, s.player.factionId, rival?.id as string);
    expect(rel?.opinion).toBeLessThan(-40);
    const capPos = s.settlements[s.player.capitalId]?.mapPos;
    const nearest = (rival?.holdingIds ?? []).map((id) => s.settlements[id]).sort((a, b) => ((a?.mapPos.x ?? 0) - (capPos?.x ?? 0)) ** 2 + ((a?.mapPos.y ?? 0) - (capPos?.y ?? 0)) ** 2 - (((b?.mapPos.x ?? 0) - (capPos?.x ?? 0)) ** 2 + ((b?.mapPos.y ?? 0) - (capPos?.y ?? 0)) ** 2))[0];
    expect(nearest?.fortTier).toBeGreaterThanOrEqual(t.rival.borderFortTier);
  });

  it('seeds realm politics: seats held by their kings, vassal ties, a few wars and feuds', () => {
    const s = base;
    for (const k of geo.kingdoms) {
      const seat = Object.values(s.factions).find((f) => f.kingdomId === k.id && f.homeProvinceId !== undefined && s.provinces[f.homeProvinceId]?.geoId === k.seatProvinceId);
      expect(seat, k.id).toBeDefined();
      const cap = s.settlements[s.provinces[seat?.homeProvinceId as never]?.capitalId as never];
      expect(cap?.factionId).toBe(seat?.id);
      expect(cap?.leaderId).toBe(seat?.rulerId);
    }
    // Petty kingdoms hold all their provinces; the homeland kings have jarls under them.
    const merewood = Object.values(s.factions).find((f) => f.kingdomId === 'merewood' && f.kind === 'petty');
    for (const p of geo.provinces.filter((x) => x.kingdomId === 'merewood')) {
      const pid = Object.values(s.provinces).find((x) => x.geoId === p.id)?.id;
      expect(s.settlements[s.provinces[pid as never]?.capitalId as never]?.factionId).toBe(merewood?.id);
    }
    expect(Object.values(s.factions).filter((f) => f.kind === 'jarldom').length).toBeGreaterThan(5);
    const wars = Object.values(s.relations).filter((r) => r.stance === 'war');
    expect(wars.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(s.relations).some((r) => r.modifiers.some((m) => m.reason === 'feud'))).toBe(true);
    for (const f of Object.values(s.factions)) for (const v of f.vassalIds) expect(s.factions[v]?.liegeId).toBe(f.id);
    // The player relates to everyone.
    for (const f of Object.values(s.factions)) if (f.id !== s.player.factionId) expect(getRelation(s, s.player.factionId, f.id), f.name).toBeDefined();
  });

  it('settlements follow the tier tables (§9.2–§9.3): population, garrisons, walls, leaders', () => {
    const s = base;
    for (const x of Object.values(s.settlements)) {
      const def = geo.settlements.find((d) => d.id === x.geoId);
      expect(x.tier).toBe(def?.tier);
      if (x.factionId !== s.player.factionId) {
        const row = content.balance.settlementTiers[x.tier] as { garrisonRatio?: number };
        if (row.garrisonRatio !== undefined && x.pop > 500) {
          const g = Object.values(x.garrison).reduce((a, b) => a + b, 0);
          expect(g).toBeGreaterThan(x.pop * row.garrisonRatio * 0.7);
          expect(g).toBeLessThan(x.pop * row.garrisonRatio * t.worldgen.seatGarrisonMult * 1.25);
        }
      }
      const leader = s.characters[x.leaderId];
      expect(leader?.alive, x.name).toBe(true);
      expect(leader?.location, x.name).toEqual({ kind: 'settlement', id: x.id });
      expect(x.fortTier).toBeGreaterThanOrEqual(0);
      expect(x.fortTier).toBeLessThanOrEqual(4);
    }
    const golden = Object.values(s.settlements).find((x) => x.culture === 'saraleonese' && x.tier === 'capital');
    expect(golden?.fortTier).toBe(4);
    const cloister = Object.values(s.settlements).find((x) => x.tier === 'cloister');
    expect(Object.keys(cloister?.garrison ?? {}).every((u) => u === 'cloisterGuard')).toBe(true);
  });

  it('splitGarrison distributes men by weight', () => {
    expect(splitGarrison(10, { a: 0.5, b: 0.5 }, { a: 1, b: 1 })).toEqual({ a: 5, b: 5 });
    expect(splitGarrison(7, { a: 1, b: 2, zzz: 5 }, { a: 1, b: 1 })).toEqual({ a: 2, b: 5 });
    expect(splitGarrison(0, { a: 1 }, { a: 1 })).toEqual({});
  });

  it('generates a world well within 1.5 s', () => {
    const t0 = performance.now();
    newGame('perf');
    expect(performance.now() - t0).toBeLessThan(1500 * PERF_SLACK);
  });
});

describe('world index', () => {
  it('indexes every settlement with its province, harbour and lanes', () => {
    const idx = base.worldIndex;
    expect(idx).toBeDefined();
    for (const id of Object.keys(base.settlements) as SettlementId[]) {
      const g = idx?.settlements[id];
      expect(g, id).toBeDefined();
      expect(g?.provinceId).toBe(base.settlements[id]?.provinceId);
      if (base.settlements[id]?.coastal) expect(g?.port, id).toBeGreaterThanOrEqual(0);
      expect(g?.lanes.length).toBeGreaterThan(0);
      for (const l of g?.lanes ?? []) expect(Object.hasOwn(base.settlements, l.to)).toBe(true);
    }
    expect(idx?.homelandProvinceIds.length).toBe(geo.provinces.filter((p) => p.homeland).length);
  });

  it('distanceDays: lane days between neighbours, a straight-line estimate otherwise', () => {
    const cap = base.player.capitalId;
    const lane = base.worldIndex?.settlements[cap]?.lanes[0];
    expect(distanceDays(base, cap, lane?.to as SettlementId, 1.3, 120)).toBe(Math.min(lane?.seaDays ?? Infinity, lane?.landDays ?? Infinity));
    const far = Object.values(base.settlements).find((x) => x.culture === 'saraleonese');
    expect(distanceDays(base, cap, far?.id as SettlementId, 1.3, 120)).toBeGreaterThan(10);
    expect(distanceDays(base, cap, cap, 1.3, 120)).toBe(0);
  });
});

describe('knowledge (§8.2)', () => {
  it('charts the homeland and the Albrenn east coast; the player has visited their own lands', () => {
    const k = base.knowledge;
    expect(k).toBeDefined();
    if (!k) return;
    for (const s of Object.values(base.settlements)) {
      const prov = base.provinces[s.provinceId];
      if (prov?.homeland) expect(isChartedAt(k, s.mapPos.x, s.mapPos.y), s.name).toBe(true);
    }
    const eastfen = Object.values(base.settlements).find((s) => base.provinces[s.provinceId]?.geoId === 'eastfen' && s.coastal);
    if (eastfen) expect(isChartedAt(k, eastfen.mapPos.x, eastfen.mapPos.y)).toBe(true);
    const saraleon = Object.values(base.settlements).find((s) => s.culture === 'saraleonese');
    expect(isChartedAt(k, saraleon?.mapPos.x ?? 0, saraleon?.mapPos.y ?? 0)).toBe(false);
    for (const sid of base.factions[base.player.factionId]?.holdingIds ?? []) expect(Object.hasOwn(k.visited, sid)).toBe(true);
  });

  it('Hvarn players know the Velkar river mouths', () => {
    const skarn = newGame('rivers', 'skarn');
    const hvarn = newGame('rivers', 'hvarn');
    const sum = (s: GameState) => Object.values(s.knowledge?.zoneCharted ?? {}).reduce((a, b) => a + b, 0);
    const mouths = geo.rivers.filter((r) => r.navigable).map((r) => r.points[0]);
    const known = (s: GameState) => mouths.filter((m) => m && s.knowledge && isChartedAt(s.knowledge, m[0], m[1])).length;
    expect(known(hvarn)).toBeGreaterThan(known(skarn));
    expect(sum(hvarn)).toBeGreaterThanOrEqual(sum(skarn));
  });

  it('revealArea / revealSettlement chart cells and record visits', () => {
    const far = Object.values(base.settlements).find((s) => s.culture === 'saraleonese') as NonNullable<GameState['settlements'][SettlementId]>;
    const r1 = inDraft(base, env, (_d, ctx) => ctx.applyEffects([{ op: 'revealArea', x: far.mapPos.x, y: far.mapPos.y, radius: 6 }]));
    expect(isChartedAt(r1.state.knowledge as never, far.mapPos.x, far.mapPos.y)).toBe(true);
    expect(Object.hasOwn(r1.state.knowledge?.visited ?? {}, far.id)).toBe(false);
    const r2 = inDraft(base, env, (_d, ctx) => ctx.applyEffects([{ op: 'revealSettlement', settlementId: far.id, visit: true }]));
    expect(Object.hasOwn(r2.state.knowledge?.visited ?? {}, far.id)).toBe(true);
    expect(checkInvariants(r2.state, env)).toEqual([]);
  });
});

describe('routes and movement (§8.3, §31.2)', () => {
  const home = base.player.capitalId;
  const homePos = base.settlements[home]?.mapPos ?? { x: 0, y: 0 };
  // A harbour some days away in the homelands.
  const dest = Object.values(base.settlements)
    .filter((s) => s.coastal && base.provinces[s.provinceId]?.homeland && s.factionId !== base.player.factionId)
    .map((s) => ({ s, d: (s.mapPos.x - homePos.x) ** 2 + (s.mapPos.y - homePos.y) ** 2 }))
    .filter((x) => x.d > 40 * 40)
    .sort((a, b) => a.d - b.d)[0]?.s.id as SettlementId;

  it('plans a sea route with waypoints and an ETA, without changing the state', () => {
    const { state, fleetId } = withPlayerFleet(base, home);
    const r = planRoute(state, content, fleetId, { settlementId: dest });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.waypoints.length).toBeGreaterThan(0);
    expect(r.plan.waypoints.length).toBeLessThan(r.plan.cells);
    expect(r.plan.etaHours).toBeGreaterThan(12);
    expect(r.plan.rations).toBeGreaterThan(0);
    expect(r.plan.settlementId).toBe(dest);
    expect(state.fleets[fleetId]?.route).toEqual([]);
  });

  it('computeRoute sets the route; the fleet sails, beaches at night near the coast and arrives', () => {
    let { state, fleetId } = withPlayerFleet(base, home);
    state = inDraft(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { settlementId: dest } }])).state;
    const f0 = state.fleets[fleetId];
    expect(f0?.route.length).toBeGreaterThan(0);
    expect(f0?.mode).toBe('sailing');
    expect(state.world?.movers[fleetId]).toBeDefined();
    const events: SimEvent[] = [];
    let beached = false;
    let moved = false;
    for (let h = 0; h < 30 * HOURS_PER_DAY; h++) {
      const before = state.fleets[fleetId]?.pos;
      const r = advance(state, 1, env);
      state = r.state;
      events.push(...r.events);
      const f = state.fleets[fleetId];
      if (f?.mode === 'beached' && (f.route.length ?? 0) > 0) beached = true;
      if (before && f && (before.x !== f.pos.x || before.y !== f.pos.y)) moved = true;
      if (eventsOf(r.events, 'Arrived').length > 0) break;
    }
    const arrived = eventsOf(events, 'Arrived');
    expect(moved).toBe(true);
    expect(beached).toBe(true);
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toMatchObject({ fleetId, settlementId: dest, factionId: state.player.factionId });
    expect(state.fleets[fleetId]?.route).toEqual([]);
    expect(state.world?.movers[fleetId]).toBeUndefined();
    expect(Object.hasOwn(state.knowledge?.visited ?? {}, dest)).toBe(true);
    expect(checkInvariants(state, env)).toEqual([]);
    expect(missingEventKeys(events)).toEqual([]);
  });

  it('rows in a calm, draining crew stamina (§8.3)', () => {
    let { state, fleetId } = withPlayerFleet(base, home);
    state = inDraft(state, env, (d, ctx) => {
      for (const z of data.zoneIds) d.weather.zones[z] = { windDir: 0, windStr: 'calm', fog: false, ice: false };
      const f = d.fleets[fleetId];
      if (f) f.sailThroughNight = true;
      ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { settlementId: dest } }]);
    }).state;
    state = advance(state, 3, env).state;
    expect(state.fleets[fleetId]?.rowing).toBe(true);
    expect(state.fleets[fleetId]?.crewStamina).toBe(100 - 3 * content.balance.sailing.staminaRowDrain);
  });

  it('a fleet told to sail through the night keeps going', () => {
    let { state, fleetId } = withPlayerFleet(base, home);
    state = inDraft(state, env, (d, ctx) => {
      const f = d.fleets[fleetId];
      if (f) f.sailThroughNight = true;
      ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { settlementId: dest } }]);
    }).state;
    let beached = false;
    for (let h = 0; h < 48 && (state.fleets[fleetId]?.route.length ?? 0) > 0; h++) {
      state = advance(state, 1, env).state;
      if (state.fleets[fleetId]?.mode === 'beached' && (state.fleets[fleetId]?.route.length ?? 0) > 0) beached = true;
    }
    expect(beached).toBe(false);
  });

  it('refuses impossible routes with RouteFailed and no route', () => {
    const { state, fleetId } = withPlayerFleet(base, home);
    const inland = Object.values(state.settlements).find((s) => !s.coastal && state.worldIndex?.settlements[s.id]?.port === -1);
    const r = inDraft(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { settlementId: inland?.id as SettlementId } }]));
    expect(eventsOf(r.events, 'RouteFailed')[0]).toMatchObject({ entityId: fleetId, reason: 'unreachable' });
    expect(r.state.fleets[fleetId]?.route).toEqual([]);
    expect(planRoute(state, content, 'flt_404', { x: 1, y: 1 })).toEqual({ ok: false, reason: 'unknownEntity' });
    expect(planRoute(state, content, fleetId, { x: -5, y: 1 })).toEqual({ ok: false, reason: 'invalidTarget' });
  });

  it('armies march overland and arrive', () => {
    const r0 = inDraft(base, env, (draft, ctx) => {
      const owner = draft.player.factionId;
      const leader = createCharacter(draft, ctx, { culture: 'skarn', age: 30, factionId: owner, skills: { wildcraft: 2 } });
      const pos = draft.settlements[home]?.mapPos ?? { x: 0, y: 0 };
      draft.armies['arm_1' as ArmyId] = { id: 'arm_1' as ArmyId, ownerId: owner, leaderId: leader.id, squads: [{ unit: 'bondi', men: 30, leaderId: leader.id } as never], pos: { ...pos }, route: [] };
      const c = cellAt(data.sw, [pos.x, pos.y]);
      // A land cell a few leagues inland.
      let target = { x: pos.x, y: pos.y };
      for (let dx = -12; dx <= 12; dx++) {
        for (let dy = -12; dy <= 12; dy++) {
          const cc = c + dy * data.sw.width + dx;
          if (data.sw.kind[cc] === CELL_LAND && dx * dx + dy * dy > 49 && (data.sw.coastDist[cc] as number) > 2) target = { x: (cc % data.sw.width) + 0.5, y: Math.floor(cc / data.sw.width) + 0.5 };
        }
      }
      ctx.applyEffects([{ op: 'computeRoute', entityId: 'arm_1' as ArmyId, to: target }]);
    });
    let state = r0.state;
    expect(state.armies['arm_1' as ArmyId]?.route.length).toBeGreaterThan(0);
    let arrived = false;
    for (let d = 0; d < 20 && !arrived; d++) {
      const r = advance(state, HOURS_PER_DAY, env);
      state = r.state;
      arrived = eventsOf(r.events, 'Arrived').some((e) => e.armyId === 'arm_1');
    }
    expect(arrived).toBe(true);
  });

  it('moves 150 fleets within the per-day budget (ARCHITECTURE §7)', () => {
    let state = base;
    const ids: FleetId[] = [];
    const harbours = Object.values(base.settlements).filter((s) => s.coastal && base.provinces[s.provinceId]?.homeland);
    for (let i = 0; i < 150; i++) {
      const from = harbours[i % harbours.length]?.id as SettlementId;
      const r = withPlayerFleet(state, from, 1);
      state = r.state;
      ids.push(r.fleetId);
    }
    state = inDraft(state, env, (_d, ctx) => {
      ids.forEach((id, i) => {
        const to = harbours[(i * 7 + 3) % harbours.length]?.id as SettlementId;
        ctx.applyEffects([{ op: 'computeRoute', entityId: id, to: { settlementId: to } }]);
      });
    }).state;
    state = advance(state, HOURS_PER_DAY, env).state; // warm-up
    const t0 = performance.now();
    const days = 3;
    state = advance(state, days * HOURS_PER_DAY, env).state;
    const perDay = (performance.now() - t0) / days;
    expect(checkInvariants(state, env)).toEqual([]);
    expect(perDay).toBeLessThan(12 * PERF_SLACK);
  });
});

describe('conditions', () => {
  it('read the geography digest and the knowledge', () => {
    const fns = world.conditionFns ?? {};
    const cap = base.player.capitalId;
    const ctx = { state: base, env, scope: { settlement: cap } };
    expect(fns['provinceOf']?.evaluate([], ctx)).toBe(base.settlements[cap]?.provinceId);
    expect(fns['regionOf']?.evaluate([], ctx)).toBe('skarnheim');
    expect(fns['isCoastal']?.evaluate([], ctx)).toBe(true);
    expect(fns['homeland']?.evaluate([], ctx)).toBe(true);
    expect(fns['charted']?.evaluate([], ctx)).toBe(true);
    expect(fns['visited']?.evaluate([], ctx)).toBe(true);
    const far = Object.values(base.settlements).find((s) => s.culture === 'saraleonese')?.id as string;
    expect(fns['charted']?.evaluate([far], ctx)).toBe(false);
    expect(fns['distanceDays']?.evaluate([far], ctx) as number).toBeGreaterThan(10);
    expect(fns['kingdomOf']?.evaluate([], ctx)).toBe('skarnheim');
  });
});
