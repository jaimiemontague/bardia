/**
 * The march (a land expedition, owner play-test 2026-11-14), against the full module registry: planning by land
 * (no ships, what the men carry, ice does not matter, the small-island warning), launching a war-band from the hall
 * in the iced-in first days of the year, steering it (the baggage follows), eating, land encounters, reaching a
 * settlement by touch or by road, plunder within the carrying limit, standing down when it walks back into the
 * hall (and by "March home"), every dead end ending at the hall, determinism, an old save, and a sea expedition
 * left as it was.
 */
import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import type { ArmyId, CharId, FleetId, GameState, MapPos, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { deserialize, serialize } from '@sim/index';
import { inDraft, missingEventKeys } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { worldData } from '../world/data';
import { CELL_LAND } from '../world/map';
import type { SteerDir } from '../world/types';
import { armyMenTotal, warBandOf } from './homecoming';
import { expeditionBlock } from './lost';
import { marchCarry, suggestPlan, validateExpedition } from './plan';

type Session = ReturnType<typeof GameSession.newGame>;
const content = getContent();
const march = content.tunables.expeditions.march;
const sw = worldData().sw;
const W = sw.width;
const VEC: Record<SteerDir, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const OPPOSITE: Record<SteerDir, SteerDir> = { n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e', nw: 'se' };
const DIRS = Object.keys(VEC) as SteerDir[];
const cellOf = (p: MapPos) => Math.floor(p.y) * W + Math.floor(p.x);
const sumMen = (men: Readonly<Record<string, number>> | undefined): number => Object.values(men ?? {}).reduce((a, b) => a + Math.max(0, b), 0);
const codes = (state: GameState, plan: Parameters<typeof validateExpedition>[2]) => validateExpedition(state, content, plan).issues.map((i) => i.code);

function ok(s: Session, command: Command): ReturnType<Session['dispatch']> {
  const r = s.dispatch(command);
  if (r.error) throw new Error(`${command.type}: ${r.error.code} ${r.error.message}`);
  return r;
}

/** Answers whatever decision is up with the headless default (never the arrival unless `arrivals`). */
function answer(s: Session, arrivals = true): void {
  for (let i = 0; i < 30 && s.getState().pending; i++) {
    if (!arrivals && s.getState().pending?.kind === 'arrival') return;
    const h = headlessCommand(s.getState());
    if (!('command' in h)) throw new Error(h.error);
    s.dispatch(h.command);
  }
}

/** Advances hour by hour (answering decisions); stops early when `until` holds. Returns the events. */
function hours(s: Session, n: number, until: (st: GameState) => boolean = () => false, arrivals = true): SimEvent[] {
  const events: SimEvent[] = [];
  for (let h = 0; h < n && !until(s.getState()); h++) {
    if (s.getState().pending) {
      answer(s, arrivals);
      if (s.getState().pending) return events;
      continue;
    }
    events.push(...s.advance(1).events);
  }
  return events;
}

/** A new saga at its first hour (the northern seas iced in) with the march launched from the capital. */
function marched(seed = 'slice-1'): { s: Session; fleetId: FleetId; armyId: ArmyId; launch: SimEvent[] } {
  const s = GameSession.newGame({ seed });
  const r = ok(s, { type: 'launchExpedition', ...suggestPlan(s.getState(), content, 30, { travel: 'land' }) });
  const fleetId = s.getState().player.expeditionFleetId as FleetId;
  return { s, fleetId, armyId: warBandOf(s.getState(), fleetId) as ArmyId, launch: r.events };
}

/** A heading with open land (no river in the way) for `cells` cells from a point. */
function landHeading(from: MapPos, cells: number): SteerDir | undefined {
  return DIRS.find((d) => {
    const [vx, vy] = VEC[d];
    const n = Math.hypot(vx, vy);
    for (let k = 1; k <= cells * 2; k++) {
      const c = cellOf({ x: from.x + (k * 0.5 * vx) / n, y: from.y + (k * 0.5 * vy) / n });
      if (sw.kind[c] !== CELL_LAND || sw.river[c] === 2) return false;
    }
    return true;
  });
}

/** The nearest foreign settlement the war-band can take the road to (setRoute succeeds). */
function roadTo(s: Session): SettlementId {
  const st = s.getState();
  const cap = st.settlements[st.player.capitalId] as NonNullable<GameState['settlements'][SettlementId]>;
  const comp = sw.landComponent[cellOf(cap.mapPos)];
  const others = Object.values(st.settlements)
    .filter((x) => x.factionId !== st.player.factionId && sw.landComponent[cellOf(x.mapPos)] === comp)
    .sort((a, b) => Math.hypot(a.mapPos.x - cap.mapPos.x, a.mapPos.y - cap.mapPos.y) - Math.hypot(b.mapPos.x - cap.mapPos.x, b.mapPos.y - cap.mapPos.y));
  for (const o of others.slice(0, 6)) if (!s.dispatch({ type: 'setRoute', to: { settlementId: o.id } }).error) return o.id;
  throw new Error('no road to a neighbour');
}

function expectHome(s: Session, fleetId: FleetId, armyId: ArmyId): void {
  const st = s.getState();
  expect(st.player.expeditionFleetId).toBeUndefined();
  expect(st.fleets[fleetId]).toBeUndefined();
  expect(st.armies[armyId]).toBeUndefined();
  expect(st.meta.mode).toBe('hub');
  expect(st.expeditions?.landParties).toEqual({});
  for (const c of Object.values(st.characters)) {
    expect(c.location.kind === 'army' && c.location.id === armyId).toBe(false);
    expect(c.location.kind === 'fleet' && c.location.id === fleetId).toBe(false);
  }
  expect(checkInvariants(st, s.env)).toEqual([]);
}

describe('planning a march', () => {
  const state = GameSession.newGame({ seed: 'slice-1' }).getState();

  it('takes no ships, needs men, and limits food and load to what the men carry', () => {
    const plan = suggestPlan(state, content, 30, { travel: 'land' });
    expect(plan.travel).toBe('land');
    expect(plan.shipIds).toEqual([]);
    const preview = validateExpedition(state, content, plan);
    expect(preview.ok).toBe(true);
    expect(preview.travel).toBe('land');
    expect(preview.crewMin).toBe(0);
    expect(preview.cargoCapacity).toBeCloseTo((preview.men + plan.leaderIds.length) * march.carryTonsPerMan, 6);
    // Food for at most foodDaysPerMan days.
    expect(preview.rationDays).toBe(march.foodDaysPerMan);
    expect(preview.rationsCapacity).toBe(marchCarry(content, preview.men + plan.leaderIds.length).rations);
    const sea = suggestPlan(state, content, 30);
    expect(codes(state, { ...plan, shipIds: sea.shipIds })).toContain('marchNoShips');
    expect(codes(state, { ...plan, men: {} })).toContain('noMarchers');
    expect(codes(state, { ...plan, rations: plan.rations + 1 })).toContain('tooMuchFood');
    const unit = Object.keys(plan.men)[0] as string;
    expect(codes(state, { ...plan, men: { [unit]: 1 }, rations: 10 })).not.toContain('tooHeavy');
    expect(codes(state, { ...plan, men: { [unit]: 1 }, rations: 14, cargo: { salt: 1 } })).toContain('tooHeavy');
    // The crew rules of the ships do not apply.
    expect(codes(state, { ...plan, men: { [unit]: 1 }, rations: 5 })).not.toContain('undermanned');
  });

  it('warns when no road leads anywhere from the hall (a small island)', () => {
    const island = structuredClone(state);
    const entry = island.worldIndex?.settlements[island.player.capitalId];
    if (entry) for (const l of entry.lanes) l.landDays = null;
    const plan = suggestPlan(island, content, 30, { travel: 'land' });
    const preview = validateExpedition(island, content, plan);
    expect(preview.issues.find((i) => i.code === 'noLandRoute')?.severity).toBe('warning');
    expect(codes(state, plan)).not.toContain('noLandRoute');
  });

  it('a sea plan is unchanged: no travel field, ships needed, the holds limit the food', () => {
    const plan = suggestPlan(state, content, 30);
    expect(plan.travel).toBeUndefined();
    const preview = validateExpedition(state, content, plan);
    expect(preview.travel).toBe('sea');
    expect(codes(state, { ...plan, shipIds: [] })).toContain('noShips');
  });
});

describe('the march', () => {
  it('launches while the harbour is iced in: one war-band of every man, no ships, the scene on the map', () => {
    const { s, fleetId, armyId, launch } = marched();
    const st = s.getState();
    const f = st.fleets[fleetId];
    expect(f?.overland).toBeDefined();
    expect(f?.shipIds).toEqual([]);
    expect(sumMen(f?.men)).toBe(0);
    expect(armyMenTotal(st, armyId)).toBeGreaterThan(0);
    expect(f?.overland?.carryT).toBeCloseTo((armyMenTotal(st, armyId) + 1 + (f?.lieutenantIds.length ?? 0)) * march.carryTonsPerMan, 6);
    expect(st.meta.mode).toBe('map');
    expect(st.characters[st.player.rulerId]?.location).toEqual({ kind: 'army', id: armyId });
    expect(launch.find((e) => e.type === 'ExpeditionLaunched')).toMatchObject({ travel: 'land', armyId, ships: 0 });
    // The ships stay in harbour.
    expect(Object.values(st.ships).filter((x) => x.ownerId === st.player.factionId).every((x) => x.locationFleetId === undefined)).toBe(true);
    // Ashore orders do not apply.
    expect(s.dispatch({ type: 'makeLandfall' }).error?.code).toBe('onTheMarch');
    expect(s.dispatch({ type: 'returnToShips' }).error?.code).toBe('onTheMarch');
    expect(checkInvariants(st, s.env)).toEqual([]);
    expect(missingEventKeys(launch)).toEqual([]);
  });

  it('steers the war-band (the baggage follows), eats daily, and stands down when it walks back into the hall', () => {
    const { s, fleetId, armyId } = marched();
    const st0 = s.getState();
    const g0 = sumMen(st0.settlements[st0.player.capitalId]?.garrison);
    const men = armyMenTotal(st0, armyId);
    const start = { ...(st0.armies[armyId]?.pos as MapPos) };
    const dir = landHeading(start, 6);
    expect(dir).toBeDefined();
    if (!dir) return;
    ok(s, { type: 'steer', dir });
    expect(s.getState().armies[armyId]?.steer).toBe(dir);
    const rations0 = s.getState().fleets[fleetId]?.rations ?? 0;
    const events = hours(s, 48, (st) => {
      const p = st.armies[armyId]?.pos;
      return p !== undefined && Math.hypot(p.x - start.x, p.y - start.y) > 4;
    });
    const mid = s.getState();
    expect(mid.player.expeditionFleetId).toBe(fleetId);
    expect(mid.fleets[fleetId]?.pos).toEqual(mid.armies[armyId]?.pos);
    expect(sw.kind[cellOf(mid.armies[armyId]?.pos as MapPos)]).toBe(CELL_LAND);
    if (events.some((e) => e.type === 'DayStarted')) expect(mid.fleets[fleetId]?.rations).toBeLessThan(rations0);
    // A day of food for the men (less what they forage on the way).
    hours(s, 24 - (mid.time.hour % 24) + 1);
    expect(s.getState().fleets[fleetId]?.rations ?? 0).toBeLessThanOrEqual(rations0 - Math.floor(men * (1 - content.balance.food.forageCap)));
    ok(s, { type: 'steer', dir: OPPOSITE[dir] });
    const back = hours(s, 96, (st) => st.player.expeditionFleetId === undefined);
    expect(back.some((e) => e.type === 'ExpeditionReturned')).toBe(true);
    expectHome(s, fleetId, armyId);
    const st = s.getState();
    expect(sumMen(st.settlements[st.player.capitalId]?.garrison)).toBe(g0 + armyMenTotal(st0, armyId));
    expect(st.characters[st.player.rulerId]?.location).toEqual({ kind: 'settlement', id: st.player.capitalId });
  });

  it('takes the road to a neighbour, raises the arrival there, carries plunder within its limit, and marches home', () => {
    const { s, fleetId, armyId } = marched('slice-1');
    const to = roadTo(s);
    hours(s, 40 * HOURS_PER_DAY, (st) => st.pending?.kind === 'arrival', false);
    const p = s.getState().pending;
    expect(p?.kind).toBe('arrival');
    expect(p?.payload).toMatchObject({ settlementId: to, armyId });
    const st = s.getState();
    const raid = (p?.payload as { options: { id: string; available: boolean }[] }).options.find((o) => o.id === 'raid');
    expect(raid?.available).toBe(true);
    const silver0 = st.fleets[fleetId]?.silver ?? 0;
    const treasury0 = st.factions[st.player.factionId]?.treasury ?? 0;
    // Raid it; the headless runner fights the battle (this seed's war-band wins).
    ok(s, { type: 'resolveArrival', choice: 'raid' });
    answer(s);
    const after = s.getState();
    expect(after.settlements[to]?.lastFate?.fate).toBe('raid');
    // The plunder rides in the baggage, not straight to the treasury.
    expect(after.fleets[fleetId]?.silver ?? 0).toBeGreaterThan(silver0);
    expect(after.factions[after.player.factionId]?.treasury ?? 0).toBe(treasury0);
    const loot = after.settlementsState?.loot;
    expect(loot?.fleetId).toBe(fleetId);
    const f = after.fleets[fleetId];
    const perTon = content.balance.economy.rationsPerTon;
    // The Cargo window takes no more than the men can carry.
    const market = after.markets[to]?.stock ?? {};
    const good = Object.keys(market).find((g) => g !== 'rations' && (market[g as never] ?? 0) > 2);
    if (good) expect(s.dispatch({ type: 'loadCargo', take: { [good]: (f?.overland?.carryT ?? 0) + 1 } }).error?.code).toBe('holdFull');
    ok(s, { type: 'leaveSettlement' });
    // By the next day what the men cannot carry is left by the road.
    const day = hours(s, HOURS_PER_DAY + 1);
    const g = s.getState().fleets[fleetId];
    let load = (g?.rations ?? 0) / perTon;
    for (const [k, v] of Object.entries(g?.cargo ?? {})) if (k !== 'rations') load += v ?? 0;
    expect(load).toBeLessThanOrEqual((g?.overland?.carryT ?? 0) + 1e-6);
    expect(day.some((e) => e.type === 'Notification' && (e as { key?: string }).key === 'expeditions.notify.leftBehind')).toBe(true);
    // March home: the road home, then the stand-down with the plunder.
    ok(s, { type: 'returnHome' });
    expect((s.getState().fleets[fleetId] as { homeward?: boolean } | undefined)?.homeward).toBe(true);
    const silverHome = s.getState().fleets[fleetId]?.silver ?? 0;
    const home = hours(s, 60 * HOURS_PER_DAY, (x) => x.player.expeditionFleetId === undefined);
    expectHome(s, fleetId, armyId);
    expect(home.find((e) => e.type === 'ExpeditionReturned')).toMatchObject({ silver: silverHome });
  });

  it('meets land encounters on the way', () => {
    let seen = false;
    for (const seed of ['march-enc-1', 'march-enc-2', 'march-enc-3']) {
      const { s } = marched(seed);
      const st = s.getState();
      const start = st.armies[warBandOf(st, st.player.expeditionFleetId as FleetId) as ArmyId]?.pos as MapPos;
      const dir = landHeading(start, 3) ?? 'n';
      s.dispatch({ type: 'steer', dir });
      for (let d = 0; d < 30 && !seen && s.getState().player.expeditionFleetId !== undefined; d++) {
        const ev = hours(s, HOURS_PER_DAY);
        if (ev.some((e) => e.type === ('EncounterSighted' as never) && (e as unknown as { domain: string }).domain === 'land')) seen = true;
        // Keep it moving: back and forth over open land.
        if (d % 3 === 2) s.dispatch({ type: 'steer', dir: d % 6 === 2 ? OPPOSITE[dir] : dir });
      }
      if (seen) break;
    }
    expect(seen).toBe(true);
  });
});

describe('every dead end of a march ends at the hall', () => {
  it('no man left standing: lost, the leaders come home', () => {
    const { s, fleetId, armyId } = marched();
    const res = inDraft(s.getState(), s.env, (d, ctx) => {
      for (const sq of [...(d.armies[armyId]?.squads ?? [])]) ctx.applyEffects([{ op: 'killMen', armyId, unit: sq.unit, count: sq.men } as never]);
    });
    const s2 = GameSession.load(serialize(res.state));
    expect(expeditionBlock(s2.getState())).toBe('noMen');
    const ev = hours(s2, 2);
    expect(ev.find((e) => e.type === 'ExpeditionLost')).toMatchObject({ cause: 'noMen' });
    expectHome(s2, fleetId, armyId);
    expect(missingEventKeys(ev)).toEqual([]);
  });

  it('every leader dead: a march with no one to lead walks home on its own', () => {
    const { s, fleetId, armyId } = marched();
    const dir = landHeading(s.getState().armies[armyId]?.pos as MapPos, 6) ?? 'n';
    ok(s, { type: 'steer', dir });
    hours(s, 30);
    const f0 = s.getState().fleets[fleetId];
    const leaders = [f0?.leaderId, ...(f0?.lieutenantIds ?? [])] as CharId[];
    const killed = inDraft(s.getState(), s.env, (d, ctx) => {
      for (const charId of leaders) ctx.applyEffects([{ op: 'kill', charId, cause: 'test' } as never]);
    });
    const s2 = GameSession.load(serialize(killed.state));
    answer(s2);
    const ev = hours(s2, 2 * HOURS_PER_DAY);
    if (s2.getState().player.expeditionFleetId !== undefined) {
      expect(expeditionBlock(s2.getState())).toBe('noLeader');
      expect(s2.dispatch({ type: 'steer', dir }).error?.code).toBe('noLeader');
      expect(ev.some((e) => e.type === 'ExpeditionLeaderless')).toBe(true);
    }
    hours(s2, 60 * HOURS_PER_DAY, (st) => st.player.expeditionFleetId === undefined);
    expectHome(s2, fleetId, armyId);
  });

  it('starving: the men die day by day and the last death ends the march at the hall', () => {
    const { s, fleetId, armyId } = marched();
    const starved = inDraft(s.getState(), s.env, (d) => {
      const f = d.fleets[fleetId];
      if (f) f.rations = 0;
      // A small war-band, so the starving is quick.
      const a = d.armies[armyId];
      if (a) for (const sq of a.squads) sq.men = Math.min(sq.men, 2);
    });
    const s2 = GameSession.load(serialize(starved.state));
    const ev = hours(s2, 400 * HOURS_PER_DAY, (st) => st.player.expeditionFleetId === undefined);
    expect(ev.some((e) => e.type === 'FleetStarving' && (e as { deaths: number }).deaths > 0)).toBe(true);
    expectHome(s2, fleetId, armyId);
  });

  it('no road home (the war-band on another landmass): the survivors find their own way, lost', () => {
    const { s, fleetId, armyId } = marched();
    const st = s.getState();
    const comp = sw.landComponent[cellOf(st.settlements[st.player.capitalId]?.mapPos as MapPos)];
    const away = Object.values(st.settlements).find((x) => sw.landComponent[cellOf(x.mapPos)] !== comp && (sw.landComponent[cellOf(x.mapPos)] ?? -1) >= 0 && !Object.values(st.settlements).some((o) => o.factionId === st.player.factionId && sw.landComponent[cellOf(o.mapPos)] === sw.landComponent[cellOf(x.mapPos)]));
    expect(away).toBeDefined();
    const moved = inDraft(st, s.env, (d) => {
      const a = d.armies[armyId];
      if (a && away) a.pos = { x: Math.floor(away.mapPos.x) + 0.5, y: Math.floor(away.mapPos.y) + 0.5 };
    });
    const s2 = GameSession.load(serialize(moved.state));
    const r = ok(s2, { type: 'returnHome' });
    expect(r.events.find((e) => e.type === 'ExpeditionLost')).toMatchObject({ cause: 'noWayHome' });
    expectHome(s2, fleetId, armyId);
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('March home from the gates stands down at once', () => {
    const { s, fleetId, armyId } = marched();
    const r = ok(s, { type: 'returnHome' });
    expect(r.events.some((e) => e.type === 'ExpeditionReturned')).toBe(true);
    expectHome(s, fleetId, armyId);
  });
});

describe('determinism and saves', () => {
  it('the same seed and commands give identical JSON (and a replay agrees)', () => {
    const run = (): Session => {
      const { s, armyId } = marched('march-det');
      const dir = landHeading(s.getState().armies[armyId]?.pos as MapPos, 4) ?? 'n';
      for (const d of [dir, 'stop', OPPOSITE[dir], dir, 'stop'] as const) {
        s.dispatch({ type: 'steer', dir: d });
        hours(s, 10);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(b.getState())).toBe(JSON.stringify(a.getState()));
    const replayed = GameSession.replay(a.newGameOptions!, a.commandLog);
    expect(JSON.stringify(replayed.getState())).toBe(JSON.stringify(a.getState()));
  });

  it('a save from before the march (expeditions v1) loads, and a march survives save and load', () => {
    const s = GameSession.newGame({ seed: 'slice-1' });
    const old = structuredClone(deserialize(s.save()).state);
    old.meta.moduleVersions['expeditions'] = 1;
    if (old.expeditions) old.expeditions.version = 1;
    const loaded = GameSession.load(serialize(old));
    expect(loaded.getState().meta.moduleVersions['expeditions']).toBe(2);
    expect(loaded.getState().expeditions?.version).toBe(2);
    ok(loaded, { type: 'launchExpedition', ...suggestPlan(loaded.getState(), content, 30, { travel: 'land' }) });
    const again = GameSession.load(loaded.save());
    expect(again.save()).toBe(loaded.save());
    expect(checkInvariants(again.getState(), again.env)).toEqual([]);
  });
});

describe('a war-band at a market and in a conquered town (economy and settlements)', () => {
  /** A march standing at the gates of a foreign settlement with a market, with `silver` in the baggage. */
  function atMarket(silver: number): { s: Session; fleetId: FleetId; armyId: ArmyId; to: SettlementId } {
    const { s, fleetId, armyId } = marched('slice-1');
    const st = s.getState();
    const cap = st.settlements[st.player.capitalId] as NonNullable<GameState['settlements'][SettlementId]>;
    const candidates = Object.values(st.settlements)
      .filter((x) => x.factionId !== st.player.factionId && st.markets[x.id] !== undefined)
      .sort((a, b) => Math.hypot(a.mapPos.x - cap.mapPos.x, a.mapPos.y - cap.mapPos.y) - Math.hypot(b.mapPos.x - cap.mapPos.x, b.mapPos.y - cap.mapPos.y));
    for (const x of candidates) {
      const moved = inDraft(st, s.env, (d) => {
        const a = d.armies[armyId];
        const f = d.fleets[fleetId];
        if (a) a.pos = { ...x.mapPos };
        if (f) {
          f.pos = { ...x.mapPos };
          f.silver = silver;
        }
      });
      const s2 = GameSession.load(serialize(moved.state));
      const probe = s2.dispatch({ type: 'trade', settlementId: x.id, buy: { rations: 0.001 } });
      if (!probe.error || probe.error.code === 'notEnoughSilver') return { s: GameSession.load(serialize(moved.state)), fleetId, armyId, to: x.id };
    }
    throw new Error('no market to trade at');
  }

  const load = (st: GameState, fleetId: FleetId): number => {
    const f = st.fleets[fleetId];
    let t = (f?.rations ?? 0) / content.balance.economy.rationsPerTon;
    for (const [g, v] of Object.entries(f?.cargo ?? {})) if (g !== 'rations') t += v ?? 0;
    return t;
  };

  it('buys within what the men can carry, paid from the baggage, and sells back into it', () => {
    const { s, fleetId, to } = atMarket(100_000);
    const st = s.getState();
    const room = Math.floor(((st.fleets[fleetId]?.overland?.carryT ?? 0) - load(st, fleetId)) * 1000) / 1000;
    expect(room).toBeGreaterThan(0.1);
    const market = st.markets[to]?.stock ?? {};
    const good = (Object.keys(market) as (keyof typeof market)[]).find((g) => g !== 'rations' && (market[g] ?? 0) > room + 1) as string;
    expect(good).toBeDefined();
    // More than the men can carry: refused.
    expect(s.dispatch({ type: 'trade', settlementId: to, buy: { [good]: room + 0.5 } }).error?.code).toBe('holdFull');
    const treasury0 = st.factions[st.player.factionId]?.treasury ?? 0;
    ok(s, { type: 'trade', settlementId: to, buy: { [good]: room } });
    const after = s.getState();
    expect(after.fleets[fleetId]?.cargo[good as never]).toBeCloseTo(room, 3);
    expect(after.fleets[fleetId]?.silver ?? 0).toBeLessThan(100_000);
    expect(after.factions[after.player.factionId]?.treasury).toBe(treasury0);
    expect(load(after, fleetId)).toBeLessThanOrEqual((after.fleets[fleetId]?.overland?.carryT ?? 0) + 1e-6);
    // Sold again: the silver comes back to the baggage.
    const silver = after.fleets[fleetId]?.silver ?? 0;
    ok(s, { type: 'trade', settlementId: to, sell: { [good]: room } });
    expect(s.getState().fleets[fleetId]?.silver ?? 0).toBeGreaterThan(silver);
    expect(s.getState().fleets[fleetId]?.cargo[good as never] ?? 0).toBeCloseTo(0, 3);
    expect(checkInvariants(s.getState(), s.env)).toEqual([]);
  });

  it('cannot spend more than the silver in the baggage, and cannot trade from afar', () => {
    const { s, fleetId, armyId, to } = atMarket(0);
    expect(s.dispatch({ type: 'trade', settlementId: to, buy: { rations: 0.01 } }).error?.code).toBe('notEnoughSilver');
    const far = inDraft(s.getState(), s.env, (d) => {
      const a = d.armies[armyId];
      if (a) a.pos = { x: a.pos.x + 20, y: a.pos.y };
      const f = d.fleets[fleetId];
      if (f) f.silver = 1000;
    });
    const s2 = GameSession.load(serialize(far.state));
    expect(s2.dispatch({ type: 'trade', settlementId: to, buy: { rations: 0.01 } }).error?.code).toBe('notInHarbour');
  });

  it('assaults a town on the march and annexes it: the garrison comes from the war-band', () => {
    // A strong muster, so the assault is won and enough men are left to hold the town.
    const s0 = GameSession.newGame({ seed: 'slice-1' });
    const strong = inDraft(s0.getState(), s0.env, (d) => {
      const cap = d.settlements[d.player.capitalId];
      if (cap) cap.garrison['huscarls'] = (cap.garrison['huscarls'] ?? 0) + 200;
    });
    const s = GameSession.load(serialize(strong.state));
    ok(s, { type: 'launchExpedition', ...suggestPlan(s.getState(), content, 30, { travel: 'land' }) });
    const fleetId = s.getState().player.expeditionFleetId as FleetId;
    const armyId = warBandOf(s.getState(), fleetId) as ArmyId;
    const to = roadTo(s);
    hours(s, 40 * HOURS_PER_DAY, (st) => st.pending?.kind === 'arrival', false);
    expect(s.getState().pending?.kind).toBe('arrival');
    ok(s, { type: 'resolveArrival', choice: 'assault' });
    for (let i = 0; i < 20 && s.getState().pending && s.getState().pending?.kind !== 'aftermath'; i++) {
      const h = headlessCommand(s.getState());
      if ('command' in h) s.dispatch(h.command);
    }
    expect(s.getState().pending?.kind).toBe('aftermath');
    const options = (s.getState().pending?.payload as { options: { id: string; available: boolean; reasonKey?: string }[] }).options;
    expect(options.find((o) => o.id === 'annex')).toMatchObject({ available: true });
    const band0 = armyMenTotal(s.getState(), armyId);
    ok(s, { type: 'chooseAftermath', fate: 'annex' });
    const st = s.getState();
    const town = st.settlements[to];
    expect(town?.factionId).toBe(st.player.factionId);
    const held = sumMen(town?.garrison);
    expect(held).toBeGreaterThanOrEqual(content.tunables.settlements.annex.minGarrison);
    expect(armyMenTotal(st, armyId)).toBe(band0 - held);
    expect(checkInvariants(st, s.env)).toEqual([]);
  });
});
