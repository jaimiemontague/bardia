/**
 * Pure weather queries for the client (map overlay, HUD wind rose, route danger) and for tools.
 * Everything reads a GameState (frozen or draft) plus content; nothing mutates.
 *
 * Zones: pass the exact sea-zone id when you have a StaticWorld (`world.geo.seaZones[world.zoneOf[cell]].id`);
 * without one, `zoneAt` (zones.ts) resolves a point approximately.
 */
import type { Content } from '@content/index';
import type { Geography } from '@content/world';
import type { CharId, FleetId, GameState, StormCell, WindStrength } from '@sim/core/state';
import { season, type Hour } from '@sim/core/time';
import { catchChance, holdsDrownedBell, partyInfo, voyageOmen, warningHorizon, type PartyInfo } from './rules';
import { canHit, stormAt, stormEta, zoneDailyRate, type StormShape } from './storms';
import { interpolateWind, lerpAngle, normDeg, strengthOf, WIND_CLASSES } from './wind';
import { weatherGeography, zoneIndexAt } from './zones';

/** The wind (and sky) somewhere. */
export interface WindReading {
  /** Direction the wind blows FROM, compass degrees [0, 360). */
  dirDeg: number;
  strength: WindStrength;
  speedKn: number;
  /** Inside a storm cell (point queries only). */
  inStorm: boolean;
  fog: boolean;
  rain: boolean;
  ice: boolean;
  zoneId: string;
}

/**
 * A zone's wind now, or at another hour inside the current 6-hour keyframe window (the client can
 * animate between ticks). Undefined for an unknown zone.
 */
export function windInZone(state: GameState, content: Content, zoneId: string, hour?: Hour): WindReading | undefined {
  if (!Object.hasOwn(state.weather.zones, zoneId)) return undefined;
  const z = state.weather.zones[zoneId];
  if (z === undefined) return undefined;
  const t = content.tunables.weather;
  let dirDeg = z.windDir;
  let speedKn = z.speed ?? t.wind.strengthKn[z.windStr];
  if (hour !== undefined && z.track !== undefined) {
    const W = Math.max(1, content.balance.sailing.windUpdateHours);
    const w = interpolateWind(z.track.fromDir, z.track.fromKn, z.track.toDir, z.track.toKn, (hour - state.weather.lastUpdateHour) / W);
    dirDeg = w.dir;
    speedKn = w.kn;
  }
  return { dirDeg, strength: strengthOf(speedKn, t), speedKn, inStorm: false, fog: z.fog, rain: z.rain === true, ice: z.ice, zoneId };
}

/** Options for point queries. */
export interface PointQueryOptions {
  /** Exact zone id at the point (from a StaticWorld); default: the approximate `zoneAt`. */
  zoneId?: string;
  /** Geography for the approximate resolver (default: the bundled pack). */
  geo?: Geography;
}

/**
 * The wind at a navigation-grid point: its zone's wind, stiffened inside a storm cell to at least
 * Strong (Gale from `wind.stormGaleIntensity`) and veered by `wind.stormVeerDeg` × intensity.
 */
export function windAt(state: GameState, content: Content, x: number, y: number, opts: PointQueryOptions = {}): WindReading | undefined {
  let zoneId = opts.zoneId;
  if (zoneId === undefined) {
    const wg = weatherGeography(opts.geo);
    const zi = zoneIndexAt(wg, x, y);
    zoneId = zi >= 0 ? wg.zones[zi]?.id : undefined;
  }
  if (zoneId === undefined) return undefined;
  const base = windInZone(state, content, zoneId);
  if (base === undefined) return undefined;
  const t = content.tunables.weather;
  let strongest: StormCell | undefined;
  for (const c of state.weather.storms) {
    const dx = c.pos.x - x;
    const dy = c.pos.y - y;
    if (dx * dx + dy * dy > c.radius * c.radius) continue;
    if (strongest === undefined || (c.intensity ?? 0) > (strongest.intensity ?? 0)) strongest = c;
  }
  if (strongest === undefined) return base;
  const intensity = strongest.intensity ?? 0;
  const floorClass: WindStrength = intensity >= t.wind.stormGaleIntensity ? 'gale' : 'strong';
  const floorKn = floorClass === 'gale' ? t.wind.classMinKn.gale : t.wind.classMinKn.strong;
  const speedKn = Math.max(base.speedKn, floorKn);
  const strength = WIND_CLASSES.indexOf(base.strength) >= WIND_CLASSES.indexOf(floorClass) ? base.strength : floorClass;
  return { ...base, dirDeg: normDeg(base.dirDeg + t.wind.stormVeerDeg * intensity), speedKn, strength, inStorm: true, rain: true };
}

/** A storm cell near a point. */
export interface StormNear {
  cell: StormCell;
  /** Distance (cells) from the point to the cell's edge (0 when inside). */
  distance: number;
  /** Hours until it covers the point, if it will within the forecast horizon. */
  etaHours: number | null;
}

/** Live storm cells whose edge lies within `radius` cells of the point, nearest first. */
export function stormCellsNear(state: GameState, content: Content, x: number, y: number, radius: number): StormNear[] {
  const t = content.tunables.weather;
  const out: StormNear[] = [];
  for (const c of state.weather.storms) {
    const d = Math.max(0, Math.sqrt((c.pos.x - x) * (c.pos.x - x) + (c.pos.y - y) * (c.pos.y - y)) - c.radius);
    if (d > radius) continue;
    out.push({ cell: c, distance: d, etaHours: stormEta(c, state.time.hour, x, y, t.storms.forecastMaxHours, t) });
  }
  out.sort((a, b) => a.distance - b.distance || (a.cell.id < b.cell.id ? -1 : 1));
  return out;
}

/** Forecast positions of a cell every `stepHours` for `hours` hours (stops when it dies); for drawing tracks. */
export function stormTrack(state: GameState, content: Content, cell: StormCell, hours: number, stepHours = 3): StormShape[] {
  const t = content.tunables.weather;
  const now = state.time.hour;
  const out: StormShape[] = [];
  const step = Math.max(1, Math.floor(stepHours));
  for (let k = 0; k <= hours && now + k < cell.untilHour; k += step) out.push(stormAt(cell, now, now + k, t));
  return out;
}

/** The storm numbers of one fleet, for the fleet HUD and route-danger display. */
export interface FleetStormOutlook {
  party: PartyInfo;
  /** How far ahead this fleet sees storms (§8.4). */
  horizonHours: number;
  /** Chance that a cell reaching the fleet catches it. */
  catchChance: number;
  /** §31.3 expected storms per day at sea in `zoneId` (world rate × catch chance), when a zone is known. */
  dailyChance: number | null;
}

/** The storm outlook of a fleet (in `zoneId` when given); undefined for an unknown fleet. */
export function fleetStormOutlook(state: GameState, content: Content, fleetId: FleetId, zoneId?: string): FleetStormOutlook | undefined {
  if (!Object.hasOwn(state.fleets, fleetId)) return undefined;
  const f = state.fleets[fleetId];
  if (f === undefined) return undefined;
  const t = content.tunables.weather;
  const party = partyInfo(content, f, (id: CharId) => state.characters[id], state.player.rulerId);
  const p = catchChance(content.balance, {
    seafaring: party.seafaring,
    chancePct: party.chancePct,
    omen: voyageOmen(state, f.ownerId, state.time.hour),
    drownedBell: holdsDrownedBell(state, f.ownerId, t),
    nightSailing: false,
  });
  let dailyChance: number | null = null;
  if (zoneId !== undefined) {
    const wg = weatherGeography();
    const zi = Object.hasOwn(wg.byId, zoneId) ? wg.byId[zoneId] : undefined;
    const zone = zi !== undefined ? wg.zones[zi] : undefined;
    if (zone !== undefined) dailyChance = Math.min(1, zoneDailyRate(content.balance, zone, season(state.time.hour), state.meta.options.harshWinters === true) * p);
  }
  return { party, horizonHours: Math.min(t.storms.forecastMaxHours, warningHorizon(content.balance, party)), catchChance: p, dailyChance };
}

/**
 * Storm cells the player can see (§8.4): those that could reach one of the player's fleets within
 * that fleet's horizon (24–48 h at party Seafaring ≥ 4, else 12 h), plus any cell already warned of.
 */
export function visibleStormCells(state: GameState, content: Content): StormCell[] {
  const t = content.tunables.weather;
  const watchers: { x: number; y: number; horizon: number; id: FleetId }[] = [];
  for (const f of Object.values(state.fleets)) {
    if (f.ownerId !== state.player.factionId || f.shipIds.length === 0) continue;
    const party = partyInfo(content, f, (id: CharId) => state.characters[id], state.player.rulerId);
    watchers.push({ x: f.pos.x, y: f.pos.y, horizon: Math.min(t.storms.forecastMaxHours, warningHorizon(content.balance, party)), id: f.id });
  }
  const out: StormCell[] = [];
  for (const c of state.weather.storms) {
    const speed = Math.sqrt(c.velocity.x * c.velocity.x + c.velocity.y * c.velocity.y);
    const reachR = c.peakRadius ?? c.radius;
    const seen = watchers.some((w) => {
      if (c.warned?.includes(w.id) === true) return true;
      const reach = reachR + speed * Math.min(w.horizon, c.untilHour - state.time.hour);
      return (c.pos.x - w.x) * (c.pos.x - w.x) + (c.pos.y - w.y) * (c.pos.y - w.y) <= reach * reach;
    });
    if (seen) out.push(c);
  }
  return out;
}

/** True when the cell can currently catch a fleet (strong enough). */
export function stormIsDangerous(content: Content, cell: StormCell): boolean {
  return canHit(cell, content.tunables.weather);
}

/** Interpolates two compass angles along the shorter arc (re-exported for HUD animation). */
export { lerpAngle };
