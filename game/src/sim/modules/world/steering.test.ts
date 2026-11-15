/**
 * Steering (the player holds a heading) and landfall by touch, on the real map with the world module alone.
 * The expedition's homecoming and the war-band boarding again are expeditions' (see expeditions/steer.test.ts).
 */
import { getContent } from '@content/index';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import { createCharacter, createFleet, createShip } from '@sim/core/factory';
import { createNewGameState } from '@sim/core/lifecycle';
import { advance } from '@sim/core/scheduler';
import type { ArmyId, FleetId, GameState, MapPos, SettlementId } from '@sim/core/state';
import { toCalendar } from '@sim/core/time';
import { inDraft, missingEventKeys, testEnv } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { worldData } from './data';
import { module as world } from './index';
import { CELL_LAND, iceBlockedZones, NAV_SEA, RIVER_NAVIGABLE, ROAD_NONE, type StaticWorld } from './map';
import { STEER_DIRS, steerMove } from './steering';
import type { SteerDir } from './types';

const content = getContent();
const data = worldData();
const sw = data.sw;
const env = testEnv([world]);
const t = content.tunables.world.steering;
// Two months in: the northern seas have thawed (the start of the year is iced in up north).
const base = inDraft(createNewGameState({ seed: 'steer-test', player: { culture: 'skarn' } }, env).state, env, (d) => {
  d.time.hour = 60 * 24;
}).state;

const W = sw.width;
const centre = (c: number): MapPos => ({ x: (c % W) + 0.5, y: Math.floor(c / W) + 0.5 });
const cellOf = (p: MapPos) => Math.floor(p.y) * W + Math.floor(p.x);
const sea = (c: number) => c >= 0 && ((sw.nav[c] as number) & NAV_SEA) !== 0;
const VEC: Record<SteerDir, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const OPPOSITE: Record<SteerDir, SteerDir> = { n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e', nw: 'se' };

function eventsOf<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): Extract<SimEvent, { type: K }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** Open sea in every direction for `r` cells around a cell. */
function openWater(c: number, r: number): boolean {
  const x = c % W;
  const y = Math.floor(c / W);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!sea((y + dy) * W + x + dx)) return false;
  return true;
}

/** A player fleet (made the expedition when `expedition`) at a map position. */
function withFleet(state: GameState, pos: MapPos, opts: { expedition?: boolean; mode?: 'docked' | 'sailing' } = {}): { state: GameState; fleetId: FleetId } {
  let fleetId = '' as FleetId;
  const r = inDraft(state, env, (draft, ctx) => {
    const owner = draft.player.factionId;
    const captain = createCharacter(draft, ctx, { culture: 'skarn', age: 30, factionId: owner, skills: { seafaring: 3 } });
    const shipIds = [createShip(draft, ctx, { type: 'snekkja', ownerId: owner }).id, createShip(draft, ctx, { type: 'snekkja', ownerId: owner }).id];
    const f = createFleet(draft, ctx, { ownerId: owner, leaderId: captain.id, pos: { ...pos }, shipIds, men: { bondi: 100 }, rations: 3000, mode: opts.mode ?? 'sailing' });
    captain.location = { kind: 'fleet', id: f.id };
    fleetId = f.id;
    if (opts.expedition !== false) draft.player.expeditionFleetId = f.id;
  });
  return { state: r.state, fleetId };
}

function steer(state: GameState, entityId: FleetId | ArmyId, dir: SteerDir | 'stop'): { state: GameState; events: SimEvent[] } {
  return inDraft(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'steerEntity', entityId, dir }]));
}

function hours(state: GameState, n: number): { state: GameState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let s = state;
  for (let h = 0; h < n; h++) {
    const r = advance(s, 1, env);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** A fake grid for the pure tests: `blocked(x, y)` marks land. */
function grid(width: number, height: number, blocked: (x: number, y: number) => boolean): { sw: StaticWorld; pass: (c: number) => boolean } {
  return { sw: { width, height } as StaticWorld, pass: (c) => !blocked(c % width, Math.floor(c / width)) };
}

describe('steerMove (pure)', () => {
  it('moves along all eight headings at the given distance in open water', () => {
    const g = grid(40, 40, () => false);
    STEER_DIRS.forEach((dir, i) => {
      const r = steerMove(g.sw, { x: 20.5, y: 20.5 }, i, 3, g.pass, 0.5);
      const [vx, vy] = VEC[dir];
      const n = Math.hypot(vx, vy);
      expect(r.blocked).toBe(false);
      expect(r.moved).toBeCloseTo(3, 6);
      expect(r.pos.x).toBeCloseTo(20.5 + (3 * vx) / n, 2);
      expect(r.pos.y).toBeCloseTo(20.5 + (3 * vy) / n, 2);
    });
  });

  it('slides along a coast when a heading within 45° is open, and stops in a corner', () => {
    // A straight shore along y >= 25: steering south-east runs along it (east), steering south stops.
    const g = grid(40, 40, (_x, y) => y >= 25);
    const se = steerMove(g.sw, { x: 10.5, y: 23.5 }, STEER_DIRS.indexOf('se'), 6, g.pass, 0.5);
    expect(se.pos.y).toBeLessThan(25);
    expect(se.pos.x).toBeGreaterThan(14);
    expect(se.moved).toBeCloseTo(6, 6);
    const s = steerMove(g.sw, { x: 10.5, y: 23.5 }, STEER_DIRS.indexOf('s'), 6, g.pass, 0.5);
    // South slides south-east or south-west for a step at most, then the shore stops it.
    expect(s.pos.y).toBeLessThan(25);
    expect(s.blocked).toBe(true);
    // A corner (walls east and south): south-east is closed for good.
    const c = grid(40, 40, (x, y) => x >= 12 || y >= 12);
    const r = steerMove(c.sw, { x: 11.9, y: 11.9 }, STEER_DIRS.indexOf('se'), 4, c.pass, 0.5);
    expect(r.blocked).toBe(true);
    expect(r.moved).toBe(0);
  });

  it('never cuts a corner between two blocked cells', () => {
    // Land at (11, 10) and (10, 11): the diagonal gap from (10, 10) to (11, 11) is closed.
    const g = grid(20, 20, (x, y) => (x === 11 && y === 10) || (x === 10 && y === 11));
    const r = steerMove(g.sw, { x: 10.9, y: 10.9 }, STEER_DIRS.indexOf('se'), 1, g.pass, 0.5);
    expect(Math.floor(r.pos.x) === 11 && Math.floor(r.pos.y) === 11).toBe(false);
  });
});

describe('steering on the map', () => {
  // A stretch of open sea near the home coast.
  const home = base.settlements[base.player.capitalId] as NonNullable<GameState['settlements'][SettlementId]>;
  let openCell = -1;
  for (let r = 4; r < 80 && openCell < 0; r++) {
    for (let dy = -r; dy <= r && openCell < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = (Math.floor(home.mapPos.y) + dy) * W + Math.floor(home.mapPos.x) + dx;
        if (openWater(c, 8)) {
          openCell = c;
          break;
        }
      }
    }
  }
  const open = centre(openCell);

  it('holds each of the eight headings at sea, stops on "stop", and charts what it sees', () => {
    for (const dir of STEER_DIRS) {
      let { state, fleetId } = withFleet(base, open);
      state = steer(state, fleetId, dir).state;
      expect(state.fleets[fleetId]?.steer).toBe(dir);
      expect(state.fleets[fleetId]?.route).toHaveLength(1);
      expect(state.world?.movers[fleetId]).toBeDefined();
      state = inDraft(state, env, (d) => {
        const f = d.fleets[fleetId];
        if (f) f.sailThroughNight = true;
      }).state;
      state = hours(state, 2).state;
      const p = state.fleets[fleetId]?.pos as MapPos;
      const [vx, vy] = VEC[dir];
      expect(Math.sign(Math.round((p.x - open.x) * 100))).toBe(Math.sign(vx));
      expect(Math.sign(Math.round((p.y - open.y) * 100))).toBe(Math.sign(vy));
      expect(checkInvariants(state, env)).toEqual([]);
      state = steer(state, fleetId, 'stop').state;
      const stopped = state.fleets[fleetId]?.pos;
      expect(state.fleets[fleetId]?.steer).toBeUndefined();
      expect(state.world?.movers[fleetId]).toBeUndefined();
      state = hours(state, 3).state;
      expect(state.fleets[fleetId]?.pos).toEqual(stopped);
    }
  });

  it('never sails onto land: steering at the coast slides along it or stops', () => {
    // Steer straight at the home coast from the open water and keep going for two days.
    const toLand = STEER_DIRS.find((d) => {
      const [vx, vy] = VEC[d];
      return (home.mapPos.x - open.x) * vx + (home.mapPos.y - open.y) * vy > 0 && vx !== 0 && vy !== 0;
    }) as SteerDir;
    let { state, fleetId } = withFleet(base, open);
    state = steer(state, fleetId, toLand).state;
    for (let h = 0; h < 48; h++) {
      state = advance(state, 1, env).state;
      const f = state.fleets[fleetId];
      if (!f) break;
      expect(sea(cellOf(f.pos)), `hour ${h} at ${f.pos.x},${f.pos.y}`).toBe(true);
      if (f.steer === undefined) break; // touched a harbour
    }
  });

  it('does not beach at night under manual steering', () => {
    let { state, fleetId } = withFleet(base, open);
    state = steer(state, fleetId, 'n').state;
    let beached = false;
    for (let h = 0; h < 24; h++) {
      state = advance(state, 1, env).state;
      if (state.fleets[fleetId]?.mode === 'beached') beached = true;
    }
    expect(beached).toBe(false);
  });

  it('cannot enter waters closed by ice', () => {
    // Find a day and a sea zone closed by ice, and a cell deep inside it.
    let found: { hour: number; cell: number } | undefined;
    for (let day = 0; day < 360 && !found; day += 5) {
      const cal = toCalendar(day * 24);
      const iced = iceBlockedZones(sw, cal.monthIndex, cal.day);
      if (!iced.some(Boolean)) continue;
      for (let c = 0; c < sw.width * sw.height && !found; c += 7) {
        const z = sw.zoneOf[c] as number;
        if (z < 0 || !iced[z] || !openWater(c, 3)) continue;
        let inside = true;
        for (let dy = -3; dy <= 3 && inside; dy++) for (let dx = -3; dx <= 3; dx++) if (sw.zoneOf[c + dy * W + dx] !== z) inside = false;
        if (inside) found = { hour: day * 24, cell: c };
      }
    }
    expect(found).toBeDefined();
    if (!found) return;
    const at = found;
    let { state, fleetId } = withFleet(base, centre(at.cell));
    state = inDraft(state, env, (d) => {
      d.time.hour = at.hour;
    }).state;
    state = steer(state, fleetId, 'e').state;
    state = hours(state, 3).state;
    expect(state.fleets[fleetId]?.pos).toEqual(centre(at.cell));
  });

  it('a set course cancels the steering, and steering cancels a set course', () => {
    let { state, fleetId } = withFleet(base, open, { expedition: false });
    state = steer(state, fleetId, 'n').state;
    state = inDraft(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { settlementId: base.player.capitalId } }])).state;
    expect(state.fleets[fleetId]?.steer).toBeUndefined();
    expect(state.fleets[fleetId]?.routeTarget).toEqual({ settlementId: base.player.capitalId });
    state = steer(state, fleetId, 'e').state;
    expect(state.fleets[fleetId]?.steer).toBe('e');
    expect(state.fleets[fleetId]?.routeTarget).toBeUndefined();
    expect(state.fleets[fleetId]?.eta).toBeUndefined();
  });

  it('a docked fleet puts out from its harbour', () => {
    let { state, fleetId } = withFleet(base, home.mapPos, { mode: 'docked' });
    state = steer(state, fleetId, 'n').state;
    const f = state.fleets[fleetId];
    expect(f?.mode).toBe('sailing');
    expect(sea(cellOf(f?.pos as MapPos))).toBe(true);
    // Lying in its own harbour does not count as touching it.
    expect(state.world?.touch?.[fleetId]).toContain(base.player.capitalId);
  });
});

describe('landfall by touch', () => {
  // A foreign harbour with a clear straight run of water towards it from a few cells out.
  const approach = (() => {
    for (const s of Object.values(base.settlements)) {
      if (s.factionId === base.player.factionId) continue;
      const g = base.worldIndex?.settlements[s.id];
      if (!g || g.port < 0 || g.portKind !== 'sea') continue;
      const port = centre(g.port);
      for (const dir of STEER_DIRS) {
        const [vx, vy] = VEC[dir];
        const n = Math.hypot(vx, vy);
        const start = { x: port.x - (6 * vx) / n, y: port.y - (6 * vy) / n };
        // The run in must stay clear of every other harbour, and the start well away from this one.
        let clear = true;
        for (let k = 0; k <= 12 && clear; k++) if (!sea(cellOf({ x: start.x + (k * 0.5 * vx) / n, y: start.y + (k * 0.5 * vy) / n }))) clear = false;
        if (!clear) continue;
        const others = Object.values(base.worldIndex?.settlements ?? {}).filter((o) => o.port >= 0 && o !== g);
        if (others.some((o) => Math.hypot(centre(o.port).x - start.x, centre(o.port).y - start.y) < 10)) continue;
        return { settlementId: s.id, port, dir, start: centre(cellOf(start)) };
      }
    }
    return undefined;
  })();

  it('finds a test harbour', () => {
    expect(approach).toBeDefined();
  });

  it('steering into a harbour raises Arrived (touch) and stops the fleet at the berth; it re-arms only after leaving', () => {
    if (!approach) return;
    let { state, fleetId } = withFleet(base, approach.start);
    state = steer(state, fleetId, approach.dir).state;
    expect(state.world?.touch?.[fleetId]).toEqual([]);
    let r = hours(state, 12);
    state = r.state;
    const arrived = eventsOf(r.events, 'Arrived');
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toMatchObject({ fleetId, settlementId: approach.settlementId, touch: true, factionId: base.player.factionId });
    const f = state.fleets[fleetId];
    expect(f?.steer).toBeUndefined();
    expect(f?.route).toEqual([]);
    expect(f?.pos).toEqual(approach.port);
    expect(state.world?.movers[fleetId]).toBeUndefined();
    expect(state.world?.touch?.[fleetId]).toContain(approach.settlementId);
    expect(missingEventKeys(r.events)).toEqual([]);

    // "Sail on": moving within the harbour's reach does not trigger it again.
    state = steer(state, fleetId, OPPOSITE[approach.dir]).state;
    r = hours(state, 1);
    state = r.state;
    expect(eventsOf(r.events, 'Arrived')).toHaveLength(0);
    // Out of reach, then back in: it triggers again.
    r = hours(state, 4);
    state = r.state;
    expect(state.world?.touch?.[fleetId]).not.toContain(approach.settlementId);
    state = steer(state, fleetId, approach.dir).state;
    r = hours(state, 12);
    expect(eventsOf(r.events, 'Arrived').filter((e) => e.settlementId === approach.settlementId)).toHaveLength(1);
    expect(checkInvariants(r.state, env)).toEqual([]);
  });

  it('a fleet that is not the expedition never touches', () => {
    if (!approach) return;
    let { state, fleetId } = withFleet(base, approach.start, { expedition: false });
    state = steer(state, fleetId, approach.dir).state;
    const r = hours(state, 12);
    expect(eventsOf(r.events, 'Arrived')).toHaveLength(0);
  });

  it('the expedition on a set course stops at a foreign harbour it passes', () => {
    if (!approach) return;
    // A course to a point beyond the harbour, through its reach.
    const [vx, vy] = VEC[approach.dir];
    let { state, fleetId } = withFleet(base, approach.start);
    const r0 = inDraft(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { x: approach.port.x + vx * 0.4, y: approach.port.y + vy * 0.4 } }]));
    state = r0.state;
    expect(state.fleets[fleetId]?.route.length).toBeGreaterThan(0);
    state = inDraft(state, env, (d) => {
      const f = d.fleets[fleetId];
      if (f) f.sailThroughNight = true;
    }).state;
    const r = hours(state, 24);
    const arrived = eventsOf(r.events, 'Arrived');
    expect(arrived[0]).toMatchObject({ fleetId, settlementId: approach.settlementId, touch: true });
  });
});

describe('a steered war-band on land', () => {
  const home = base.settlements[base.player.capitalId] as NonNullable<GameState['settlements'][SettlementId]>;

  function withArmy(state: GameState, pos: MapPos): { state: GameState; armyId: ArmyId } {
    let armyId = '' as ArmyId;
    const r = inDraft(state, env, (draft, ctx) => {
      armyId = ctx.newId('arm');
      const owner = draft.player.factionId;
      const leader = createCharacter(draft, ctx, { culture: 'skarn', age: 30, factionId: owner, skills: { wildcraft: 2 } });
      draft.armies[armyId] = { id: armyId, ownerId: owner, leaderId: leader.id, squads: [{ unit: 'bondi', men: 30, leaderId: leader.id } as never], pos: { ...pos }, route: [] };
    });
    return { state: r.state, armyId };
  }

  it('marches along a heading over land only, and touches a settlement it walks into', () => {
    // Start 4–8 cells inland of the capital on open land, heading back towards it.
    const hc = cellOf(home.mapPos);
    let start: { pos: MapPos; dir: SteerDir } | undefined;
    for (const dir of STEER_DIRS) {
      const [vx, vy] = VEC[dir];
      const n = Math.hypot(vx, vy);
      const p = { x: home.mapPos.x - (5 * vx) / n, y: home.mapPos.y - (5 * vy) / n };
      let ok = true;
      for (let k = 0; k <= 10 && ok; k++) if (sw.kind[cellOf({ x: p.x + (k * 0.5 * vx) / n, y: p.y + (k * 0.5 * vy) / n })] !== CELL_LAND) ok = false;
      const others = Object.values(base.settlements).filter((s) => s.id !== home.id && Math.hypot(s.mapPos.x - p.x, s.mapPos.y - p.y) < 6);
      if (ok && others.length === 0 && sw.kind[hc] === CELL_LAND) {
        start = { pos: centre(cellOf(p)), dir };
        break;
      }
    }
    expect(start).toBeDefined();
    if (!start) return;
    let { state, armyId } = withArmy(base, start.pos);
    state = steer(state, armyId, start.dir).state;
    expect(state.armies[armyId]?.steer).toBe(start.dir);
    let arrived: SimEvent[] = [];
    for (let h = 0; h < 72 && arrived.length === 0; h++) {
      const r = advance(state, 1, env);
      state = r.state;
      const a = state.armies[armyId];
      expect(sw.kind[cellOf(a?.pos as MapPos)]).toBe(CELL_LAND);
      arrived = eventsOf(r.events, 'Arrived');
    }
    expect(arrived[0]).toMatchObject({ armyId, settlementId: home.id, touch: true });
    expect(state.armies[armyId]?.steer).toBeUndefined();
    expect(checkInvariants(state, env)).toEqual([]);
  });

  it('is stopped by a navigable river (it slides along the bank) except where a road fords it', () => {
    expect(t.riversStopWarbands).toBe(true);
    // A river cell (no road) with open land without a river two cells to its west.
    const at = (x: number, y: number) => y * W + x;
    let river = -1;
    for (let c = 0; c < sw.size && river < 0; c++) {
      if (sw.river[c] !== RIVER_NAVIGABLE || sw.road[c] !== ROAD_NONE || sw.kind[c] !== CELL_LAND) continue;
      const x = c % W;
      const y = Math.floor(c / W);
      if (x < 3) continue;
      const west = [at(x - 1, y), at(x - 2, y), at(x - 3, y)];
      if (west.every((w) => sw.kind[w] === CELL_LAND && sw.river[w] !== RIVER_NAVIGABLE)) river = c;
    }
    expect(river).toBeGreaterThan(0);
    const start = centre(river - 3);
    let { state, armyId } = withArmy(base, start);
    state = steer(state, armyId, 'e').state;
    for (let h = 0; h < 8; h++) {
      state = advance(state, 1, env).state;
      const c = cellOf(state.armies[armyId]?.pos as MapPos);
      expect(sw.river[c] === RIVER_NAVIGABLE && sw.road[c] === ROAD_NONE).toBe(false);
      expect(sw.kind[c]).toBe(CELL_LAND);
    }
  });

  it('stands still with no heading held', () => {
    const inland = Array.from({ length: 40 }, (_, k) => cellOf(home.mapPos) + (k - 20)).find((c) => sw.kind[c] === CELL_LAND && (sw.coastDist[c] as number) > 1) ?? cellOf(home.mapPos);
    let { state, armyId } = withArmy(base, centre(inland));
    state = steer(state, armyId, 'stop').state;
    state = hours(state, 12).state;
    expect(state.armies[armyId]?.pos).toEqual(centre(inland));
    expect(state.world?.movers[armyId]).toBeUndefined();
  });
});

describe('determinism and saves', () => {
  it('same seed and the same steering give identical states', () => {
    const run = (): string => {
      const home = base.settlements[base.player.capitalId] as NonNullable<GameState['settlements'][SettlementId]>;
      let { state, fleetId } = withFleet(base, home.mapPos, { mode: 'docked' });
      for (const dir of ['n', 'ne', 'e', 'stop', 'sw'] as const) {
        state = steer(state, fleetId, dir).state;
        state = hours(state, 6).state;
      }
      return JSON.stringify(state);
    };
    expect(run()).toBe(run());
  });

  it('migrate (v1 → v2) primes the expedition already at sea', () => {
    const home = base.settlements[base.player.capitalId] as NonNullable<GameState['settlements'][SettlementId]>;
    const { state, fleetId } = withFleet(base, home.mapPos, { mode: 'docked' });
    const old = inDraft(state, env, (d) => {
      if (d.world) {
        d.world.version = 1;
        delete d.world.touch;
      }
      d.meta.moduleVersions['world'] = 1;
    }).state;
    const migrated = inDraft(old, env, (d, ctx) => world.migrate?.(d, 1, ctx)).state;
    expect(migrated.world?.version).toBe(2);
    expect(migrated.world?.touch?.[fleetId]).toBeDefined();
    expect(checkInvariants(migrated, env)).toEqual([]);
  });
});
