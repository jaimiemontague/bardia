/**
 * Routes and movement (design §8.3, §8.4, §8.7, §8.8, §31.2; world owns movement and `Arrived`).
 *
 * ROUTES — `planRoute` (pure; the client previews with it) and the `computeRoute` effect (expeditions'
 * setRoute applies it): A* on the sea grid (karvi fleets also on navigable rivers, lakes and portages) with
 * expected-wind costs from `state.weather`, ice-closed zones, the shoal penalty for deep-draught ships and,
 * on request, known storm cells; armies use the land grid with the §8.7 terrain speeds. The cell path is
 * string-pulled into waypoints (`fleet.route` / `army.route`), with an ETA.
 *
 * MOVEMENT — hourly, only the entities in `state.world.movers` (an index kept by computeRoute and a daily
 * scan). Fleets sail at min ship speed × wind × skill × crew × hull (§31.2), row when that is faster, drain
 * and recover crew stamina, beach at night near a coast unless told to sail through it, haul over
 * portages, chart what the player's fleets see, and emit `Arrived` at the end of the route. Armies march
 * `movement.marchHours` a day at 30 km/day × terrain × (1 + 0.04 × Wildcraft) × horses.
 */
import type { Content } from '@content/index';
import type { SimContext } from '@sim/core/module';
import type { Army, ArmyId, Fleet, FleetId, GameState, Hour, MapPos, SettlementId, SiteId } from '@sim/core/state';
import { HOURS_PER_DAY, toCalendar } from '@sim/core/time';
import { cellCentrePos, cellOfPos, worldData, zoneIdAt, type WorldData } from './data';
import { chartDisc, visitSettlement } from './knowledge';
import {
  CELL_LAND,
  RIVER_NAVIGABLE,
  ROAD_NONE,
  DIR_BEARING_DEG,
  defaultPortageCost,
  NAV_KARVI,
  NAV_SEA,
  findLandPath,
  findSeaPath,
  iceBlockedZones,
  nearestLandCell,
  nearestNavigableCell,
  type GridPath,
  type StepCost,
} from './map';
import { armySpeed, bearingDeg, bestSkill, cellsPerHour, fleetSpeed, hourlySpeed, rowSpeed, windFactor } from './sailing';
import { placesNear, steerBearing, steerIndex, steerMove, steerVector, touchIndex } from './steering';
import type { MoverState, RouteFailReason, RouteTarget, SteerEntityEffect, WorldState } from './types';
import { landSpeedGrid } from './worldIndex';

/** Current movement-bookkeeping format version. */
export const WORLD_STATE_VERSION = 2;

/** A portage on a planned route: reaching waypoint `at` (its start) hauls the ships to the next waypoint. */
export interface PlannedPortage {
  /** Waypoint (position) where the haul starts. */
  x: number;
  y: number;
  hours: number;
  id: string;
}

/** A planned route. */
export interface RoutePlan {
  kind: 'fleet' | 'army';
  /** Where the route starts: the entity's position, or its harbour/land cell when it lies off the grid it moves on. */
  start: MapPos;
  /** The start was snapped (a docked fleet sets out from its settlement's harbour). */
  snapped: boolean;
  /** Waypoints after the start (cell centres), the last one the destination. */
  waypoints: MapPos[];
  portages: PlannedPortage[];
  /** Geometric length (cells) and km. */
  cells: number;
  km: number;
  /** Estimated hours to arrival (wind as now, night beaching, portages). */
  etaHours: number;
  /** Rations the voyage needs at 1 per man per day (fleets). */
  rations: number;
  target: RouteTarget;
  settlementId?: SettlementId;
  siteId?: SiteId;
  /** The route passes within a known storm cell's reach (when not avoiding storms). */
  stormRisk: boolean;
}

export type RouteResult = { ok: true; plan: RoutePlan } | { ok: false; reason: RouteFailReason };

export interface RouteOptions {
  avoidStorms?: boolean;
  /** Geography data (tests may pass their own). */
  data?: WorldData;
}

function isFleetId(id: string): id is FleetId {
  return id.startsWith('flt_');
}

/** World-module tunables + balance from a Content (client) or a SimContext. */
function tun(content: Content) {
  return content.tunables.world;
}

/** The planning context of an entity (fleet or army) as it is now. */
interface Mover {
  kind: 'fleet' | 'army';
  pos: MapPos;
  karvi: boolean;
  deepHull: boolean;
  sailKn: number;
  rowKn: number;
  mult: number;
  men: number;
  ships: number;
  /** Armies: km per marching hour on plain. */
  kmPerHour: number;
}

function moverOf(state: GameState, content: Content, id: string): Mover | undefined {
  if (isFleetId(id)) {
    const f = Object.hasOwn(state.fleets, id) ? state.fleets[id] : undefined;
    if (!f) return undefined;
    const sp = fleetSpeed(state, f, content, tun(content).movement.shoalPenaltyShips);
    return { kind: 'fleet', pos: f.pos, karvi: sp.karvi, deepHull: sp.deepHull, sailKn: sp.sailKn, rowKn: sp.rowKn, mult: sp.mult, men: sp.men, ships: sp.ships, kmPerHour: 0 };
  }
  const a = Object.hasOwn(state.armies, id) ? state.armies[id as ArmyId] : undefined;
  if (!a) return undefined;
  const sp = armySpeed(state, a, content, tun(content).movement.marchHours);
  let men = 0;
  for (const sq of a.squads) men += Math.max(0, sq.men);
  return { kind: 'army', pos: a.pos, karvi: false, deepHull: false, sailKn: 0, rowKn: 0, mult: 1, men, ships: 0, kmPerHour: sp.kmPerHour };
}

/** The cell a route should end at for a target, or a failure. */
function targetCell(state: GameState, data: WorldData, m: Mover, to: RouteTarget, snap: number): { cell: number; settlementId?: SettlementId; siteId?: SiteId } | RouteFailReason {
  const { sw } = data;
  const fleet = m.kind === 'fleet';
  const ok = (c: number) => (fleet ? ((sw.nav[c] as number) & (m.karvi ? NAV_KARVI : NAV_SEA)) !== 0 : sw.kind[c] === CELL_LAND);
  const snapTo = (cell: number): number => {
    if (cell < 0) return -1;
    if (ok(cell)) return cell;
    return fleet ? nearestNavigableCell(sw, cell, m.karvi, snap) : nearestLandCell(sw, cell, snap);
  };
  if ('settlementId' in to) {
    const s = Object.hasOwn(state.settlements, to.settlementId) ? state.settlements[to.settlementId] : undefined;
    if (!s) return 'invalidTarget';
    const g = state.worldIndex?.settlements[to.settlementId];
    if (fleet) {
      if (g && g.port >= 0 && ok(g.port)) return { cell: g.port, settlementId: to.settlementId };
      if (!s.coastal) return 'unreachable';
    }
    const c = snapTo(g && g.cell >= 0 ? g.cell : cellOfPos(sw, s.mapPos.x, s.mapPos.y));
    return c >= 0 ? { cell: c, settlementId: to.settlementId } : 'unreachable';
  }
  if ('siteId' in to) {
    const site = Object.hasOwn(state.sites, to.siteId) ? state.sites[to.siteId] : undefined;
    if (!site) return 'invalidTarget';
    const c = snapTo(cellOfPos(sw, site.mapPos.x, site.mapPos.y));
    return c >= 0 ? { cell: c, siteId: to.siteId } : 'unreachable';
  }
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || to.x < 0 || to.y < 0 || to.x >= sw.width || to.y >= sw.height) return 'invalidTarget';
  const c = snapTo(cellOfPos(sw, to.x, to.y));
  return c >= 0 ? { cell: c } : 'unreachable';
}

/** Line of sight between two cell centres over passable cells (half-cell sampling). */
function lineClear(data: WorldData, a: number, b: number, pass: (c: number) => boolean): boolean {
  const W = data.sw.width;
  const ax = (a % W) + 0.5;
  const ay = Math.floor(a / W) + 0.5;
  const bx = (b % W) + 0.5;
  const by = Math.floor(b / W) + 0.5;
  const dx = bx - ax;
  const dy = by - ay;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
  for (let i = 1; i < n; i++) {
    const x = ax + (dx * i) / n;
    const y = ay + (dy * i) / n;
    if (!pass(Math.floor(y) * W + Math.floor(x))) return false;
    // Never cut a corner between two blocked cells.
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    if ((fx < 0.05 || fx > 0.95) && (fy < 0.05 || fy > 0.95)) {
      const cx = Math.floor(x + (fx < 0.5 ? -0.5 : 0.5));
      const cy = Math.floor(y + (fy < 0.5 ? -0.5 : 0.5));
      if (!pass(Math.floor(y) * W + cx) && !pass(cy * W + Math.floor(x))) return false;
    }
  }
  return true;
}

/** String-pulls a cell path into waypoint cells (portage jumps kept as their own legs). Returns cell indices. */
export function smoothPath(data: WorldData, cells: readonly number[], pass: (c: number) => boolean, lookahead: number): number[] {
  const W = data.sw.width;
  const adjacent = (a: number, b: number) => Math.abs((a % W) - (b % W)) <= 1 && Math.abs(Math.floor(a / W) - Math.floor(b / W)) <= 1;
  const out: number[] = [];
  let i = 0;
  while (i < cells.length - 1) {
    const a = cells[i] as number;
    // A portage jump: keep both ends.
    if (!adjacent(a, cells[i + 1] as number)) {
      out.push(cells[i + 1] as number);
      i++;
      continue;
    }
    let best = i + 1;
    const limit = Math.min(cells.length - 1, i + lookahead);
    for (let j = i + 2; j <= limit; j++) {
      if (!adjacent(cells[j - 1] as number, cells[j] as number)) break;
      if (!lineClear(data, a, cells[j] as number, pass)) break;
      best = j;
    }
    out.push(cells[best] as number);
    i = best;
  }
  return out;
}

/** Hours a portage takes (geography range × share, slower when undermanned; §8.8). */
function portageHours(content: Content, data: WorldData, portageIndex: number, men: number, ships: number): number {
  const def = data.geo.portages[portageIndex];
  const t = tun(content).movement;
  const days = def ? def.days[0] + (def.days[1] - def.days[0]) * t.portageRangeShare : content.balance.overland.portageDays[0];
  const under = ships > 0 && men < ships * content.balance.overland.portageMenPerShip ? t.portageUndermannedMult : 1;
  return Math.round(days * HOURS_PER_DAY * under);
}

/** The expected-wind step cost (≥ 1) for a fleet, from the zone winds in `state.weather`. */
function windCost(state: GameState, content: Content, data: WorldData, m: Mover, weight: number): StepCost | undefined {
  const zones = state.weather?.zones;
  if (weight <= 0 || !zones || m.sailKn <= 0) return undefined;
  const sailing = content.balance.sailing;
  const zoneWind: ({ dir: number; str: Parameters<typeof windFactor>[3] } | null)[] = data.zoneIds.map((id) => {
    const z = Object.hasOwn(zones, id) ? zones[id] : undefined;
    return z ? { dir: z.windDir, str: z.windStr } : null;
  });
  let best = 0;
  for (const row of Object.values(sailing.windFactor)) for (const v of Object.values(row)) best = Math.max(best, v);
  const ref = m.sailKn * best;
  const row = m.rowKn;
  return (to, _from, dir) => {
    const z = data.sw.zoneOf[to] as number;
    const w = z >= 0 ? zoneWind[z] : null;
    if (!w) return 1;
    const eff = Math.max(m.sailKn * windFactor(sailing, DIR_BEARING_DEG[dir] as number, w.dir, w.str), row, 1e-6);
    return Math.min(4, 1 + weight * Math.max(0, ref / eff - 1));
  };
}

/** Sea zones closed by ice at an hour. */
function iceNow(sw: Parameters<typeof iceBlockedZones>[0], hour: number): boolean[] {
  const cal = toCalendar(hour);
  return iceBlockedZones(sw, cal.monthIndex, cal.day);
}

/**
 * Plans a route for a fleet or army without changing anything (client previews; computeRoute applies it).
 * Fleets: sea grid (karvi: rivers, lakes, portages), wind, ice, shoals, optional storm avoidance.
 */
export function planRoute(state: GameState, content: Content, entityId: string, to: RouteTarget, opts: RouteOptions = {}): RouteResult {
  const data = opts.data ?? worldData();
  const { sw } = data;
  const t = tun(content).movement;
  const m = moverOf(state, content, entityId);
  if (!m) return { ok: false, reason: 'unknownEntity' };
  if (m.kind === 'fleet' && m.ships === 0) return { ok: false, reason: 'noShips' };
  const start0 = cellOfPos(sw, m.pos.x, m.pos.y);
  const fleet = m.kind === 'fleet';
  const bit = m.karvi ? NAV_KARVI : NAV_SEA;
  const pass = fleet ? (c: number) => ((sw.nav[c] as number) & bit) !== 0 : (c: number) => sw.kind[c] === CELL_LAND;
  const start = fleet ? (pass(start0) ? start0 : nearestNavigableCell(sw, start0, m.karvi, t.snapRadius)) : pass(start0) ? start0 : nearestLandCell(sw, start0, t.snapRadius);
  if (start < 0) return { ok: false, reason: 'noStart' };
  const tc = targetCell(state, data, m, to, t.snapRadius);
  if (typeof tc === 'string') return { ok: false, reason: tc };

  const storms = state.weather?.storms ?? [];
  let path: GridPath | null;
  let stormRisk = false;
  if (fleet) {
    const blockedZones = iceNow(sw, state.time.hour);
    const wind = windCost(state, content, data, m, t.windRouteWeight);
    const pad = t.stormPadCells;
    const avoid = opts.avoidStorms === true && storms.length > 0;
    const cost: StepCost | undefined =
      avoid || wind
        ? (c, from, dir) => {
            if (avoid) {
              const x = (c % sw.width) + 0.5;
              const y = Math.floor(c / sw.width) + 0.5;
              for (const s of storms) {
                const r = s.radius + pad;
                if ((s.pos.x - x) ** 2 + (s.pos.y - y) ** 2 <= r * r) return Infinity;
              }
            }
            return wind ? wind(c, from, dir) : 1;
          }
        : undefined;
    path = findSeaPath(sw, start, tc.cell, {
      karvi: m.karvi,
      blockedZones,
      ...(m.deepHull ? { shoalPenalty: t.shoalPenalty } : {}),
      ...(cost !== undefined ? { cost } : {}),
    });
  } else {
    path = findLandPath(sw, start, tc.cell, { speeds: content.balance.overland.terrain });
  }
  if (!path) {
    // Would the way be open without the ice? Then say so (the player can wait for the thaw).
    if (fleet && iceNow(sw, state.time.hour).some(Boolean) && findSeaPath(sw, start, tc.cell, { karvi: m.karvi })) return { ok: false, reason: 'iced' };
    return { ok: false, reason: 'unreachable' };
  }

  const wpCells = path.cells.length <= 1 ? [] : smoothPath(data, path.cells, pass, t.smoothLookahead);
  const waypoints = wpCells.map((c) => cellCentrePos(sw, c));
  // Portages: each non-adjacent step of the cell path, in order.
  const portages: PlannedPortage[] = [];
  if (fleet && path.portages.length > 0) {
    let k = 0;
    for (let i = 1; i < path.cells.length; i++) {
      const a = path.cells[i - 1] as number;
      const b = path.cells[i] as number;
      const adjacent = Math.abs((a % sw.width) - (b % sw.width)) <= 1 && Math.abs(Math.floor(a / sw.width) - Math.floor(b / sw.width)) <= 1;
      if (adjacent) continue;
      const p = path.portages[k++] ?? -1;
      const at = cellCentrePos(sw, a);
      portages.push({ x: at.x, y: at.y, hours: portageHours(content, data, p, m.men, m.ships), id: data.geo.portages[p]?.id ?? '' });
    }
    // Make sure the haul's start is a waypoint.
    for (const p of portages) {
      if (!waypoints.some((w) => w.x === p.x && w.y === p.y)) {
        const endIdx = waypoints.findIndex((w) => Math.abs(w.x - p.x) > 1.5 || Math.abs(w.y - p.y) > 1.5);
        waypoints.splice(Math.max(0, endIdx), 0, { x: p.x, y: p.y });
      }
    }
  }
  if (!fleet || opts.avoidStorms !== true) {
    for (const s of storms) {
      const r = s.radius + t.stormPadCells;
      if (path.cells.some((c) => ((c % sw.width) + 0.5 - s.pos.x) ** 2 + (Math.floor(c / sw.width) + 0.5 - s.pos.y) ** 2 <= r * r)) {
        stormRisk = fleet;
        break;
      }
    }
  }

  // ETA.
  let hours: number;
  const portageTotal = portages.reduce((n, p) => n + p.hours, 0);
  if (fleet) {
    const sailing = content.balance.sailing;
    const kn = Math.max(m.sailKn * 0.9, rowSpeed(sailing, m.rowKn, 100)) * m.mult;
    const perHour = cellsPerHour(sailing, kn, sw.cellKm);
    const movingCost = Math.max(0, path.cost - path.portages.length * defaultPortageCost(sw));
    const moving = perHour > 0 ? movingCost / perHour : Infinity;
    const daylight = sailing.beachHours / HOURS_PER_DAY;
    hours = moving / daylight + portageTotal;
  } else {
    const kmPerHour = Math.max(1e-6, m.kmPerHour);
    // Land cost is in "plain cells"; marching hours per day from tunables.
    const marching = (path.cost * sw.cellKm) / kmPerHour;
    hours = (marching * HOURS_PER_DAY) / Math.max(1, t.marchHours);
  }
  const etaHours = Number.isFinite(hours) ? Math.ceil(hours) : 0;
  const snapped = start !== start0;
  const plan: RoutePlan = {
    kind: m.kind,
    start: snapped ? cellCentrePos(sw, start) : { x: m.pos.x, y: m.pos.y },
    snapped,
    waypoints,
    portages,
    cells: Math.round(path.length * 100) / 100,
    km: Math.round(path.km),
    etaHours,
    rations: Math.ceil((m.men * etaHours) / HOURS_PER_DAY),
    target: to,
    stormRisk,
  };
  if (tc.settlementId !== undefined) plan.settlementId = tc.settlementId;
  if (tc.siteId !== undefined) plan.siteId = tc.siteId;
  return { ok: true, plan };
}

/** The movement slice (created if missing). */
export function worldSlice(draft: GameState): WorldState {
  draft.world ??= { version: WORLD_STATE_VERSION, movers: {} };
  return draft.world;
}

/** Cached speed inputs for an entity. */
export function moverState(state: GameState, ctx: SimContext, id: string): MoverState | undefined {
  const content = ctx.content;
  const t = ctx.tunables.world;
  const enc = ctx.balance.encounters;
  if (isFleetId(id)) {
    const f = state.fleets[id];
    if (!f) return undefined;
    const sp = fleetSpeed(state, f, content, t.movement.shoalPenaltyShips);
    const player = f.ownerId === state.player.factionId;
    let sight = 0;
    if (player) {
      sight = enc.sightBase + enc.sightPerSeafaring * sp.seafaring;
      const aboard = [f.leaderId, ...f.lieutenantIds];
      if (aboard.some((c) => state.characters[c]?.traits.includes('lookout'))) sight += enc.lookoutTrait;
      sight = Math.max(t.knowledge.minSightCells, sight);
    }
    return { kind: 'fleet', sailKn: sp.sailKn, rowKn: sp.rowKn, mult: sp.mult, karvi: sp.karvi, player, sight, sightNight: enc.fogNightMult, refreshedHour: ctx.hour, revealCell: -1 };
  }
  const a = state.armies[id as ArmyId];
  if (!a) return undefined;
  const sp = armySpeed(state, a, content, t.movement.marchHours);
  const player = a.ownerId === state.player.factionId;
  const sight = player ? Math.max(t.knowledge.minSightCells, ctx.balance.overland.sightBase + ctx.balance.overland.sightPerWildcraft * sp.wildcraft) : 0;
  return { kind: 'army', sailKn: 0, rowKn: 0, mult: sp.kmPerHour, karvi: false, player, sight, sightNight: enc.fogNightMult, refreshedHour: ctx.hour, revealCell: -1 };
}

/** Applies a plan to an entity (route, ETA, target, mover index). */
export function applyPlan(draft: GameState, ctx: SimContext, id: string, plan: RoutePlan, depart: boolean): void {
  const ms = moverState(draft, ctx, id);
  const was = isFleetId(id) ? draft.fleets[id]?.pos : draft.armies[id as ArmyId]?.pos;
  const from = was ? { x: was.x, y: was.y } : undefined;
  const w = worldSlice(draft);
  const eta = ctx.hour + plan.etaHours;
  if (isFleetId(id)) {
    const f = draft.fleets[id];
    if (!f) return;
    if (plan.snapped && plan.waypoints.length > 0) f.pos = { x: plan.start.x, y: plan.start.y };
    f.route = plan.waypoints.map((p) => ({ x: p.x, y: p.y }));
    f.eta = eta;
    f.routeTarget = plan.target;
    if (f.steer !== undefined) delete f.steer;
    if (depart && f.mode !== 'sailing' && f.route.length > 0) f.mode = 'sailing';
    if (f.portageUntil !== undefined) delete f.portageUntil;
  } else {
    const a = draft.armies[id as ArmyId];
    if (!a) return;
    if (plan.snapped && plan.waypoints.length > 0) a.pos = { x: plan.start.x, y: plan.start.y };
    a.route = plan.waypoints.map((p) => ({ x: p.x, y: p.y }));
    a.eta = eta;
    a.routeTarget = plan.target;
    if (a.steer !== undefined) delete a.steer;
  }
  // Landfall by touch: the places the mover lies within reach of as it sets out do not trigger (re-arm rule).
  if (plan.waypoints.length > 0) primeTouch(draft, ctx, worldData(), id, isFleetId(id) ? 'fleet' : 'army', from);
  if (ms && plan.waypoints.length > 0) {
    if (plan.portages.length > 0) ms.portages = plan.portages.map((p) => ({ ...p }));
    w.movers[id] = ms;
  } else delete w.movers[id];
}

/** Clears an entity's route (and the mover entry). */
export function clearRoute(draft: GameState, id: string): void {
  const w = worldSlice(draft);
  delete w.movers[id];
  if (isFleetId(id)) {
    const f = draft.fleets[id];
    if (f) {
      if (f.route.length > 0) f.route = [];
      delete f.eta;
      if (f.steer !== undefined) delete f.steer;
    }
  } else {
    const a = draft.armies[id as ArmyId];
    if (a) {
      if (a.route.length > 0) a.route = [];
      delete a.eta;
      if (a.steer !== undefined) delete a.steer;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Hourly movement.

function hourOfDay(hour: Hour): number {
  return ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

function inWindow(hod: number, start: number, length: number): boolean {
  const end = start + length;
  return end <= HOURS_PER_DAY ? hod >= start && hod < end : hod >= start || hod < end - HOURS_PER_DAY;
}

/** Moves a position along waypoints by `dist` cells; returns how many waypoints were reached and the new position. */
function advanceAlong(pos: MapPos, route: readonly MapPos[], dist: number, stopAt: (p: MapPos) => boolean): { pos: MapPos; consumed: number; stopped: boolean } {
  let x = pos.x;
  let y = pos.y;
  let left = dist;
  let consumed = 0;
  while (consumed < route.length) {
    const next = route[consumed] as MapPos;
    if (stopAt(next) && x === next.x && y === next.y) return { pos: { x, y }, consumed, stopped: true };
    const dx = next.x - x;
    const dy = next.y - y;
    const seg = Math.sqrt(dx * dx + dy * dy);
    if (seg <= left + 1e-9) {
      x = next.x;
      y = next.y;
      left -= seg;
      consumed++;
      if (stopAt(next)) return { pos: { x, y }, consumed, stopped: true };
      continue;
    }
    if (left <= 0) break;
    x += (dx / seg) * left;
    y += (dy / seg) * left;
    left = 0;
    break;
  }
  return { pos: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }, consumed, stopped: false };
}

function arrive(draft: GameState, ctx: SimContext, data: WorldData, id: string, entity: Fleet | Army, kind: 'fleet' | 'army', touched?: { settlementId?: SettlementId }): void {
  const w = worldSlice(draft);
  delete w.movers[id];
  if (entity.route.length > 0) entity.route = [];
  delete entity.eta;
  if (entity.steer !== undefined) delete entity.steer;
  const target = touched ? undefined : entity.routeTarget;
  const owner = entity.ownerId;
  const cell = { x: entity.pos.x, y: entity.pos.y };
  const settlementId = touched ? touched.settlementId : target && 'settlementId' in target && Object.hasOwn(draft.settlements, target.settlementId) ? target.settlementId : undefined;
  const siteId = target && 'siteId' in target && Object.hasOwn(draft.sites, target.siteId) ? target.siteId : undefined;
  if (kind === 'fleet') {
    const f = entity as Fleet;
    const c = cellOfPos(data.sw, f.pos.x, f.pos.y);
    if (settlementId !== undefined && draft.settlements[settlementId]?.factionId === owner) f.mode = 'docked';
    else if ((data.sw.coastDist[c] as number) <= ctx.tunables.world.movement.beachMaxCoastCells) f.mode = 'beached';
    if (f.rowing) f.rowing = false;
  }
  ctx.emit({
    type: 'Arrived',
    ...(kind === 'fleet' ? { fleetId: id as FleetId } : { armyId: id as ArmyId }),
    factionId: owner,
    ...(settlementId !== undefined ? { settlementId } : {}),
    ...(siteId !== undefined ? { siteId } : {}),
    cell,
    ...(touched ? { touch: true as const } : {}),
  });
  if (owner === draft.player.factionId) {
    if (settlementId !== undefined) visitSettlement(draft, ctx, data, settlementId);
    const where = settlementId !== undefined ? (draft.settlements[settlementId]?.name ?? '') : siteId !== undefined ? (draft.sites[siteId]?.name ?? '') : '';
    ctx.notify('world.notify.arrived', { priority: 'normal', vars: { kind, where, named: where !== '' }, link: { kind, id } });
  }
}

function stepFleet(draft: GameState, ctx: SimContext, data: WorldData, id: FleetId, ms: MoverState): void {
  const f = draft.fleets[id];
  if (!f || (f.route.length === 0 && f.portageUntil === undefined) || f.shipIds.length === 0) {
    delete worldSlice(draft).movers[id];
    return;
  }
  if (f.steer !== undefined) {
    stepSteeredFleet(draft, ctx, data, id, ms, f);
    checkTouch(draft, ctx, data, id, f, 'fleet');
    return;
  }
  const t = ctx.tunables.world.movement;
  const sailing = ctx.balance.sailing;
  const hour = ctx.hour;
  const { sw } = data;
  // Hauling over a portage.
  if (f.portageUntil !== undefined) {
    if (hour < f.portageUntil) return;
    delete f.portageUntil;
    const next = f.route[0] as MapPos;
    f.pos = { x: next.x, y: next.y };
    f.route = f.route.slice(1);
    if (f.route.length === 0) {
      arrive(draft, ctx, data, id, f, 'fleet');
      return;
    }
  }
  const cell = cellOfPos(sw, f.pos.x, f.pos.y);
  const day = inWindow(hourOfDay(hour), t.dayStartHour, sailing.beachHours);
  const nearCoast = (sw.coastDist[cell] as number) <= t.beachMaxCoastCells;
  if (!day && f.sailThroughNight !== true && nearCoast) {
    if (f.mode !== 'beached') f.mode = 'beached';
    if (f.crewStamina < 100) f.crewStamina = Math.min(100, f.crewStamina + sailing.staminaRest);
    if (f.rowing) f.rowing = false;
    return;
  }
  if (f.mode !== 'sailing') f.mode = 'sailing';
  const next = f.route[0] as MapPos;
  const heading = bearingDeg(next.x - f.pos.x, next.y - f.pos.y);
  const zone = zoneIdAt(data, cell);
  const zw = zone !== null && draft.weather?.zones && Object.hasOwn(draft.weather.zones, zone) ? draft.weather.zones[zone] : undefined;
  const wf = zw ? windFactor(sailing, heading, zw.windDir, zw.windStr) : 1;
  const sp = hourlySpeed(sailing, ms, wf, f.crewStamina);
  const stamina = sp.rowing ? Math.max(0, f.crewStamina - sailing.staminaRowDrain) : Math.min(100, f.crewStamina + sailing.staminaRest);
  if (stamina !== f.crewStamina) f.crewStamina = stamina;
  if ((f.rowing === true) !== sp.rowing) f.rowing = sp.rowing;
  const portages = ms.portages ?? [];
  const isPortageStart = (p: MapPos) => portages.length > 0 && (portages[0] as PlannedPortage).x === p.x && (portages[0] as PlannedPortage).y === p.y;
  const res = advanceAlong(f.pos, f.route, cellsPerHour(sailing, sp.kn, sw.cellKm), isPortageStart);
  f.pos = res.pos;
  if (res.consumed > 0) f.route = f.route.slice(res.consumed);
  const newCell = cellOfPos(sw, f.pos.x, f.pos.y);
  const z = zoneIdAt(data, newCell);
  if (f.seaZoneId !== z) f.seaZoneId = z;
  if (res.stopped && portages.length > 0) {
    const p = portages[0] as PlannedPortage;
    const until = hour + p.hours;
    f.portageUntil = until;
    const mover = worldSlice(draft).movers[id];
    if (mover) mover.portages = portages.slice(1);
    ctx.emit({ type: 'PortageStarted', fleetId: id, portageId: p.id, untilHour: until });
  }
  if (ms.player) reveal(draft, ctx, data, id, newCell, f.pos, ms, !day || zw?.fog === true);
  if (f.portageUntil === undefined && checkTouch(draft, ctx, data, id, f, 'fleet')) return;
  if (f.route.length === 0 && f.portageUntil === undefined) arrive(draft, ctx, data, id, f, 'fleet');
}

function stepArmy(draft: GameState, ctx: SimContext, data: WorldData, id: ArmyId, ms: MoverState): void {
  const a = draft.armies[id];
  if (!a || a.route.length === 0) {
    delete worldSlice(draft).movers[id];
    return;
  }
  if (a.steer !== undefined) {
    stepSteeredArmy(draft, ctx, data, id, ms, a);
    checkTouch(draft, ctx, data, id, a, 'army');
    return;
  }
  const t = ctx.tunables.world.movement;
  if (!inWindow(hourOfDay(ctx.hour), t.marchStartHour, t.marchHours)) return;
  const { sw } = data;
  const cell = cellOfPos(sw, a.pos.x, a.pos.y);
  const speed = landSpeedAt(data, ctx, cell);
  const cells = (ms.mult * Math.max(0.1, speed)) / sw.cellKm;
  const res = advanceAlong(a.pos, a.route, cells, () => false);
  a.pos = res.pos;
  if (res.consumed > 0) a.route = a.route.slice(res.consumed);
  const newCell = cellOfPos(sw, a.pos.x, a.pos.y);
  if (ms.player) reveal(draft, ctx, data, id, newCell, a.pos, ms, false);
  if (checkTouch(draft, ctx, data, id, a, 'army')) return;
  if (a.route.length === 0) arrive(draft, ctx, data, id, a, 'army');
}

let speedCache: { data: WorldData; balance: unknown; grid: Float32Array } | undefined;

function landSpeedAt(data: WorldData, ctx: SimContext, cell: number): number {
  if (!speedCache || speedCache.data !== data || speedCache.balance !== ctx.balance) speedCache = { data, balance: ctx.balance, grid: landSpeedGrid(data.sw, ctx.balance) };
  return speedCache.grid[cell] ?? 1;
}

function reveal(draft: GameState, ctx: SimContext, data: WorldData, id: string, cell: number, pos: MapPos, ms: MoverState, dim: boolean): void {
  const mover = worldSlice(draft).movers[id];
  if (!mover || mover.revealCell === cell) return;
  mover.revealCell = cell;
  const r = ms.sight * (dim ? ms.sightNight : 1);
  if (r > 0) chartDisc(draft, ctx, data, pos.x, pos.y, r);
}

/** The hourly movement system: every entity in the mover index takes one step. */
export function moveEntities(draft: GameState, ctx: SimContext, data: WorldData): void {
  const w = draft.world;
  if (!w) return;
  const ids = Object.keys(w.movers);
  if (ids.length === 0) return;
  for (const id of ids) {
    const ms = w.movers[id];
    if (!ms) continue;
    if (ms.kind === 'fleet') stepFleet(draft, ctx, data, id as FleetId, ms);
    else stepArmy(draft, ctx, data, id as ArmyId, ms);
  }
}

/** Daily: index entities that were given routes by other means and refresh cached speed inputs. */
export function refreshMovers(draft: GameState, ctx: SimContext): void {
  const w = worldSlice(draft);
  for (const id of Reflect.ownKeys(draft.fleets) as FleetId[]) {
    // Cheap read of the route length through the draft (no copy); most fleets lie still.
    const f = draft.fleets[id];
    if (!f || f.route.length === 0) continue;
    const old = w.movers[f.id];
    const fresh = moverState(draft, ctx, f.id);
    if (!fresh) continue;
    fresh.revealCell = old?.revealCell ?? -1;
    if (old?.portages) fresh.portages = old.portages;
    w.movers[f.id] = fresh;
  }
  for (const aid of Reflect.ownKeys(draft.armies) as ArmyId[]) {
    const a = draft.armies[aid];
    if (!a || a.route.length === 0) continue;
    const old = w.movers[a.id];
    const fresh = moverState(draft, ctx, a.id);
    if (!fresh) continue;
    fresh.revealCell = old?.revealCell ?? -1;
    w.movers[a.id] = fresh;
  }
  for (const id of Object.keys(w.movers)) {
    const f = isFleetId(id) ? draft.fleets[id] : undefined;
    const a = isFleetId(id) ? undefined : draft.armies[id as ArmyId];
    if ((f === undefined && a === undefined) || (f !== undefined && f.route.length === 0 && f.portageUntil === undefined) || (a !== undefined && a.route.length === 0)) delete w.movers[id];
  }
  if (w.touch) {
    for (const id of Object.keys(w.touch)) {
      const gone = isFleetId(id) ? !Object.hasOwn(draft.fleets, id) : !Object.hasOwn(draft.armies, id as ArmyId);
      if (gone) delete w.touch[id];
    }
  }
}

/** Party Seafaring of a fleet (for the client's HUD). */
export function partySeafaring(state: GameState, content: Content, fleet: Fleet): number {
  return bestSkill(state, [fleet.leaderId, ...fleet.lieutenantIds], 'seafaring', content);
}

// ---------------------------------------------------------------------------------------------
// Steering (the player holds a heading) and landfall by touch.

/** Cells a fleet may sail on now: its navigation layer, minus sea zones closed by ice. */
function fleetPass(data: WorldData, karvi: boolean, hour: Hour): (c: number) => boolean {
  const { sw } = data;
  const bit = karvi ? NAV_KARVI : NAV_SEA;
  const iced = iceNow(sw, hour);
  const any = iced.some(Boolean);
  return (c) => {
    if (((sw.nav[c] as number) & bit) === 0) return false;
    if (!any) return true;
    const z = sw.zoneOf[c] as number;
    return !(z >= 0 && iced[z] === true);
  };
}

/**
 * Cells a steered war-band may walk onto: land (never the sea or a lake, so never onto another landmass) and, with
 * `steering.riversStopWarbands`, not a navigable river except where a road crosses it (a ford or a bridge). A set
 * march (computeRoute) knows the fords and crosses rivers anywhere.
 */
function landPass(data: WorldData, ctx: SimContext): (c: number) => boolean {
  const { sw } = data;
  if (ctx.tunables.world.steering.riversStopWarbands !== true) return (c) => sw.kind[c] === CELL_LAND;
  return (c) => sw.kind[c] === CELL_LAND && (sw.river[c] !== RIVER_NAVIGABLE || sw.road[c] !== ROAD_NONE);
}

/** The one-point route a steered mover keeps ahead of it (other modules read "a route ahead" as "under way"). */
function aheadOf(ctx: SimContext, pos: MapPos, dir: NonNullable<Fleet['steer']>): MapPos[] {
  const [vx, vy] = steerVector(dir);
  const a = ctx.tunables.world.steering.aheadCells;
  return [{ x: Math.round((pos.x + vx * a) * 1000) / 1000, y: Math.round((pos.y + vy * a) * 1000) / 1000 }];
}

/** A touchable place near a mover: a settlement (its harbour or its gates) or, for a war-band, its ships. */
interface TouchNear {
  key: string;
  settlementId?: SettlementId;
  /** Where a fleet comes to rest when it touches (the harbour cell's centre), when not port-less. */
  berth?: MapPos;
  d2: number;
}

function touchNear(draft: GameState, ctx: SimContext, data: WorldData, kind: 'fleet' | 'army', pos: MapPos): TouchNear[] {
  const t = ctx.tunables.world.steering;
  const radius = kind === 'fleet' ? t.touchRadius : t.armyTouchRadius;
  const index = touchIndex(draft, data.sw);
  const out: TouchNear[] = index
    ? placesNear(index, pos, radius, kind).map((p) => ({
        key: p.place.settlementId,
        settlementId: p.place.settlementId,
        ...(kind === 'fleet' && p.place.sea && !p.place.portless ? { berth: p.place.sea } : {}),
        d2: p.d2,
      }))
    : [];
  if (kind === 'army') {
    const fid = draft.player.expeditionFleetId;
    const f = fid !== undefined && Object.hasOwn(draft.fleets, fid) ? draft.fleets[fid] : undefined;
    // A march's baggage (expeditions' shipless `fleet.overland`) walks with the war-band: nothing to board.
    if (f && fid !== undefined && (f as { overland?: unknown }).overland === undefined) {
      const d2 = (f.pos.x - pos.x) ** 2 + (f.pos.y - pos.y) ** 2;
      if (d2 <= radius * radius) out.push({ key: fid, d2 });
    }
    out.sort((a, b) => a.d2 - b.d2 || (a.key < b.key ? -1 : 1));
  }
  return out;
}

/**
 * Which touches stop a mover: 'all' for the steered expedition and steered player war-bands; 'routed' for the
 * expedition on a set course (foreign harbours and its own destination; a homeward course only its destination);
 * null for everything else (other fleets never touch).
 */
function touchMode(draft: GameState, id: string, entity: Fleet | Army, kind: 'fleet' | 'army'): 'all' | 'routed' | null {
  if (kind === 'fleet') {
    if (draft.player.expeditionFleetId !== id) return null;
    return entity.steer !== undefined ? 'all' : 'routed';
  }
  return entity.ownerId === draft.player.factionId && entity.steer !== undefined ? 'all' : null;
}

/**
 * Records the places a mover lies within reach of as it sets out, so they do not trigger until it has left them.
 * `from` adds the places within reach of an earlier position (a docked fleet snapped from its settlement to water).
 */
export function primeTouch(draft: GameState, ctx: SimContext, data: WorldData, id: string, kind: 'fleet' | 'army', from?: MapPos): void {
  const entity = kind === 'fleet' ? draft.fleets[id as FleetId] : draft.armies[id as ArmyId];
  if (!entity) return;
  if (kind === 'fleet' ? draft.player.expeditionFleetId !== id : entity.ownerId !== draft.player.factionId) return;
  const keys = touchNear(draft, ctx, data, kind, entity.pos).map((k) => k.key);
  if (from) {
    for (const k of touchNear(draft, ctx, data, kind, from)) if (!keys.includes(k.key)) keys.push(k.key);
    // The settlement a docked fleet lay at (its gates), even when its harbour is farther off.
    const index = kind === 'fleet' ? touchIndex(draft, data.sw) : undefined;
    if (index) for (const p of placesNear(index, from, 1, 'army')) if (!keys.includes(p.place.settlementId)) keys.push(p.place.settlementId);
  }
  const w = worldSlice(draft);
  w.touch ??= {};
  w.touch[id] = keys;
}

/**
 * Landfall by touch, after a mover's hourly step: the nearest place newly within reach (and allowed by the touch
 * mode) stops the mover there and raises Arrived as the end of a route would (with `touch: true`). Places left
 * behind are re-armed. Returns true when the mover stopped.
 */
function checkTouch(draft: GameState, ctx: SimContext, data: WorldData, id: string, entity: Fleet | Army, kind: 'fleet' | 'army'): boolean {
  const mode = touchMode(draft, id, entity, kind);
  if (mode === null) return false;
  const w = worldSlice(draft);
  const near = touchNear(draft, ctx, data, kind, entity.pos);
  const keys = near.map((k) => k.key);
  w.touch ??= {};
  const prev = Object.hasOwn(w.touch, id) ? w.touch[id] : undefined;
  if (prev === undefined) {
    w.touch[id] = keys;
    return false;
  }
  const changed = prev.length !== keys.length || prev.some((k, i) => keys[i] !== k);
  if (changed) w.touch[id] = keys;
  const homeward = (entity as { homeward?: boolean }).homeward === true;
  const target = entity.routeTarget;
  const targetId = target && 'settlementId' in target ? target.settlementId : undefined;
  for (const k of near) {
    if (prev.includes(k.key)) continue;
    if (mode === 'routed') {
      if (k.settlementId === undefined) continue;
      const s = draft.settlements[k.settlementId];
      const foreign = s !== undefined && s.factionId !== entity.ownerId;
      if (k.settlementId !== targetId && (homeward || !foreign)) continue;
    }
    if (kind === 'fleet' && k.berth) entity.pos = { x: k.berth.x, y: k.berth.y };
    arrive(draft, ctx, data, id, entity, kind, k.settlementId !== undefined ? { settlementId: k.settlementId } : {});
    return true;
  }
  return false;
}

/** One hour of a steered fleet: the §31.2 speed along the held heading, sliding along coasts, never onto land or ice. */
function stepSteeredFleet(draft: GameState, ctx: SimContext, data: WorldData, id: FleetId, ms: MoverState, f: Fleet): void {
  const dir = f.steer;
  if (dir === undefined) return;
  const sailing = ctx.balance.sailing;
  const t = ctx.tunables.world;
  const { sw } = data;
  if (f.mode !== 'sailing') f.mode = 'sailing';
  const cell = cellOfPos(sw, f.pos.x, f.pos.y);
  const zone = zoneIdAt(data, cell);
  const zw = zone !== null && draft.weather?.zones && Object.hasOwn(draft.weather.zones, zone) ? draft.weather.zones[zone] : undefined;
  const wf = zw ? windFactor(sailing, steerBearing(dir), zw.windDir, zw.windStr) : 1;
  const sp = hourlySpeed(sailing, ms, wf, f.crewStamina);
  const res = steerMove(sw, f.pos, steerIndex(dir), cellsPerHour(sailing, sp.kn, sw.cellKm), fleetPass(data, ms.karvi, ctx.hour), t.steering.subStepCells);
  const working = res.moved > 0 && sp.rowing;
  const stamina = working ? Math.max(0, f.crewStamina - sailing.staminaRowDrain) : Math.min(100, f.crewStamina + sailing.staminaRest);
  if (stamina !== f.crewStamina) f.crewStamina = stamina;
  if ((f.rowing === true) !== working) f.rowing = working;
  if (res.pos.x !== f.pos.x || res.pos.y !== f.pos.y) f.pos = res.pos;
  f.route = aheadOf(ctx, f.pos, dir);
  const newCell = cellOfPos(sw, f.pos.x, f.pos.y);
  const z = zoneIdAt(data, newCell);
  if (f.seaZoneId !== z) f.seaZoneId = z;
  const day = inWindow(hourOfDay(ctx.hour), t.movement.dayStartHour, sailing.beachHours);
  if (ms.player) reveal(draft, ctx, data, id, newCell, f.pos, ms, !day || zw?.fog === true);
}

/** One hour of a steered war-band: §8.7 march speed over land (any hour unless the tunable says otherwise). */
function stepSteeredArmy(draft: GameState, ctx: SimContext, data: WorldData, id: ArmyId, ms: MoverState, a: Army): void {
  const dir = a.steer;
  if (dir === undefined) return;
  const t = ctx.tunables.world;
  if (!t.steering.armyMarchesAnyHour && !inWindow(hourOfDay(ctx.hour), t.movement.marchStartHour, t.movement.marchHours)) return;
  const { sw } = data;
  const cell = cellOfPos(sw, a.pos.x, a.pos.y);
  const cells = (ms.mult * Math.max(0.1, landSpeedAt(data, ctx, cell))) / sw.cellKm;
  const res = steerMove(sw, a.pos, steerIndex(dir), cells, landPass(data, ctx), t.steering.subStepCells);
  if (res.pos.x !== a.pos.x || res.pos.y !== a.pos.y) a.pos = res.pos;
  a.route = aheadOf(ctx, a.pos, dir);
  if (ms.player) reveal(draft, ctx, data, id, cellOfPos(sw, a.pos.x, a.pos.y), a.pos, ms, false);
}

/**
 * The steerEntity effect: hold a heading (the entity moves hourly along it) or stop. Cancels any route; a later
 * computeRoute cancels the steering. A docked fleet sets out from its settlement's harbour; an entity off the grid
 * it moves on is snapped to the nearest open cell. Failures emit RouteFailed (unknownEntity, noShips, noStart).
 */
export function applySteer(draft: GameState, ctx: SimContext, e: SteerEntityEffect): void {
  const id = e.entityId;
  const kind: 'fleet' | 'army' = isFleetId(id) ? 'fleet' : 'army';
  const entity = kind === 'fleet' ? (Object.hasOwn(draft.fleets, id) ? draft.fleets[id as FleetId] : undefined) : Object.hasOwn(draft.armies, id) ? draft.armies[id as ArmyId] : undefined;
  if (!entity) {
    ctx.emit({ type: 'RouteFailed', entityId: id, reason: 'unknownEntity' });
    return;
  }
  const w = worldSlice(draft);
  const data = worldData();
  const { sw } = data;
  if (e.dir === 'stop') {
    if (entity.steer !== undefined) delete entity.steer;
    if (entity.route.length > 0) entity.route = [];
    delete entity.eta;
    if (entity.routeTarget !== undefined) delete entity.routeTarget;
    if (kind === 'fleet' && (entity as Fleet).rowing) (entity as Fleet).rowing = false;
    if ((entity as Fleet).portageUntil === undefined) delete w.movers[id];
    return;
  }
  if (kind === 'fleet') {
    const f = entity as Fleet;
    if (f.portageUntil !== undefined) {
      ctx.emit({ type: 'RouteFailed', entityId: id, reason: 'noStart' });
      return;
    }
    const ms = moverState(draft, ctx, id);
    if (!ms || f.shipIds.length === 0 || ms.sailKn <= 0) {
      ctx.emit({ type: 'RouteFailed', entityId: id, reason: 'noShips' });
      return;
    }
    const bit = ms.karvi ? NAV_KARVI : NAV_SEA;
    const pass = (c: number) => c >= 0 && ((sw.nav[c] as number) & bit) !== 0;
    const from = { x: f.pos.x, y: f.pos.y };
    const here = cellOfPos(sw, f.pos.x, f.pos.y);
    if (f.mode === 'docked' || !pass(here)) {
      // A docked fleet puts out from its settlement's harbour (the settlement whose gates it lies at).
      const index = touchIndex(draft, sw);
      const at = index ? placesNear(index, f.pos, 1, 'army').find((p) => p.place.sea && !p.place.portless) : undefined;
      const berth = at?.place.sea ? cellOfPos(sw, at.place.sea.x, at.place.sea.y) : -1;
      let start = here;
      if (berth >= 0 && pass(berth)) start = berth;
      else if (!pass(here)) start = nearestNavigableCell(sw, here, ms.karvi, ctx.tunables.world.movement.snapRadius);
      if (start < 0) {
        ctx.emit({ type: 'RouteFailed', entityId: id, reason: 'noStart' });
        return;
      }
      if (start !== here) f.pos = cellCentrePos(sw, start);
    }
    const old = w.movers[id];
    if (old?.revealCell !== undefined) ms.revealCell = old.revealCell;
    if (f.mode !== 'sailing') f.mode = 'sailing';
    f.steer = e.dir;
    f.route = aheadOf(ctx, f.pos, e.dir);
    delete f.eta;
    if (f.routeTarget !== undefined) delete f.routeTarget;
    w.movers[id] = ms;
    primeTouch(draft, ctx, data, id, 'fleet', from);
    return;
  }
  const a = entity as Army;
  const ms = moverState(draft, ctx, id);
  if (!ms) {
    ctx.emit({ type: 'RouteFailed', entityId: id, reason: 'unknownEntity' });
    return;
  }
  const c0 = cellOfPos(sw, a.pos.x, a.pos.y);
  if (sw.kind[c0] !== CELL_LAND) {
    const c = nearestLandCell(sw, c0, ctx.tunables.world.movement.snapRadius);
    if (c < 0) {
      ctx.emit({ type: 'RouteFailed', entityId: id, reason: 'noStart' });
      return;
    }
    a.pos = cellCentrePos(sw, c);
  }
  const old = w.movers[id];
  if (old?.revealCell !== undefined) ms.revealCell = old.revealCell;
  a.steer = e.dir;
  a.route = aheadOf(ctx, a.pos, e.dir);
  delete a.eta;
  if (a.routeTarget !== undefined) delete a.routeTarget;
  w.movers[id] = ms;
  primeTouch(draft, ctx, data, id, 'army');
}
