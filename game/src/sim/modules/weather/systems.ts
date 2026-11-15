/**
 * The weather systems (design §7.1 schedule: wind interpolation and storm-cell movement hourly, the
 * wind state update every 6 hours, storm rolls as cells reach fleets).
 *
 * Hot-path notes (ARCHITECTURE.md §7): the hourly work is a handful of zone writes (only when a
 * value changes) and one write pass over the live storm cells. Fleets are scanned only while cells
 * exist; AI fleets every `storms.checkHours` hours with a capsule test over the cells' swept paths,
 * after a cheap pre-filter on their positions at the start of the operation (`baseState`), widened by
 * how far any fleet can have moved since. The player's fleets are checked every hour (warnings).
 */
import type { Tunables as WeatherTunables } from '@content/schemas/tunables/weather';
import { baseState } from '@sim/core/context';
import { clamp } from '@sim/core/dmath';
import type { SimEventOf } from '@sim/core/events';
import type { SimContext } from '@sim/core/module';
import type { Character, CharId, Fleet, FleetId, GameState, SeaZoneWeather, StormCell } from '@sim/core/state';
import { HOURS_PER_DAY, season, toCalendar, type Hour } from '@sim/core/time';
import {
  catchChance,
  holdsDrownedBell,
  isNightHour,
  isUndermanned,
  menTotal,
  partyInfo,
  planStormHit,
  rollSeverity,
  severityShift,
  shiftSeverity,
  voyageOmen,
  warningHorizon,
  type CharLookup,
  type PartyInfo,
  type ShipSnapshot,
} from './rules';
import { canHit, cellGone, expectedSpawns, roundPos, roundVel, severityClassOf, sizeAt, spawnCell, spawnCount, stormEta, sweptOver } from './storms';
import type { StormHitEvent } from './types';
import { interpolateWind, regimeAt, round1, sampleWind, strengthOf } from './wind';
import { zoneIcedOn, zoneIndexAt, type WeatherGeography, type WeatherZone } from './zones';

/** Stream names (ARCHITECTURE.md §7): wind/fog/rain samples, storm births, storm rolls at fleets. */
export const WIND_STREAM = 'weather:wind';
export const STORM_STREAM = 'weather:storms';
export const HIT_STREAM = 'weather:hits';

/** If the keyframes fall this many windows behind (never in normal play), they are re-seeded. */
const MAX_CATCH_UP_WINDOWS = 4;

function windHours(ctx: SimContext): number {
  return Math.max(1, ctx.balance.sailing.windUpdateHours);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Two-state Markov step with long-run share `target` and extra persistence `rho` (one draw). */
function markov(prev: boolean, target: number, rho: number, ctx: SimContext): boolean {
  const p = prev ? rho + (1 - rho) * target : (1 - rho) * target;
  return ctx.rng(WIND_STREAM).chance(p);
}

function fogTarget(t: WeatherTunables, zone: WeatherZone, hour: Hour, kn: number): number {
  const fogMult = t.zones[zone.id]?.fogMult ?? 1;
  return clamp(t.fog.season[season(hour)] * t.fog.strengthMult[strengthOf(kn, t)] * fogMult, 0, 0.95);
}

/** A fresh zone entry with keyframes for the window starting at `t0` (current values at `hour`). */
function freshZone(ctx: SimContext, zone: WeatherZone, t0: Hour, hour: Hour, iced: boolean): SeaZoneWeather {
  const t = ctx.tunables.weather;
  const W = windHours(ctx);
  const rng = ctx.rng(WIND_STREAM);
  const from = sampleWind(regimeAt(zone, t0, t), null, 0, rng, t);
  const to = sampleWind(regimeAt(zone, t0 + W, t), from, 0, rng, t);
  const now = interpolateWind(from.dir, from.kn, to.dir, to.kn, (hour - t0) / W);
  const fog = rng.chance(fogTarget(t, zone, t0, from.kn));
  const rain = rng.chance(clamp(t.rain.season[season(t0)], 0, 0.95));
  return {
    windDir: now.dir,
    windStr: strengthOf(now.kn, t),
    speed: now.kn,
    fog,
    ice: iced,
    rain,
    track: { fromDir: round1(from.dir), fromKn: round1(from.kn), toDir: round1(to.dir), toKn: round1(to.kn), nDir: round3(to.nDir), nKn: round3(to.nKn) },
  };
}

function icedToday(zone: WeatherZone, hour: Hour): boolean {
  const c = toCalendar(hour);
  return zoneIcedOn(zone, c.monthIndex, c.day);
}

/**
 * New game, or a save made before this module existed: wind, fog, rain and ice for every sea zone
 * of the geography, keyframed on the current 6-hour window. Live storms are kept if present.
 */
export function initWeather(draft: GameState, ctx: SimContext, wg: WeatherGeography): void {
  const w = draft.weather;
  if (!Array.isArray(w.storms)) w.storms = [];
  w.seq ??= 1;
  const hour = draft.time.hour;
  const W = windHours(ctx);
  const t0 = Math.floor(hour / W) * W;
  for (const zone of wg.zones) w.zones[zone.id] = freshZone(ctx, zone, t0, hour, icedToday(zone, hour));
  w.lastUpdateHour = t0;
}

/** Old saves: version 1 is the first data version; just make sure every zone has keyframes. */
export function migrateWeather(draft: GameState, _fromVersion: number, ctx: SimContext, wg: WeatherGeography): void {
  const w = draft.weather;
  w.seq ??= 1;
  if (!Array.isArray(w.storms)) w.storms = [];
  ensureZones(draft, ctx, wg);
}

/** Creates entries for geography zones missing from the state (a mod's new zone, an old save). */
export function ensureZones(draft: GameState, ctx: SimContext, wg: WeatherGeography): void {
  const w = draft.weather;
  const hour = draft.time.hour;
  for (const zone of wg.zones) {
    const z = Object.hasOwn(w.zones, zone.id) ? w.zones[zone.id] : undefined;
    if (z === undefined || z.track === undefined) w.zones[zone.id] = freshZone(ctx, zone, w.lastUpdateHour, hour, icedToday(zone, hour));
  }
}

// ---------------------------------------------------------------------------------------------
// Every 6 hours: new wind keyframes, fog and rain, storm births.

function advanceKeyframes(draft: GameState, ctx: SimContext, wg: WeatherGeography, T: Hour): void {
  const t = ctx.tunables.weather;
  const w = draft.weather;
  const W = windHours(ctx);
  ensureZones(draft, ctx, wg);
  // Storm cells sitting in a zone stiffen its wind and bring rain.
  const boost: number[] = wg.zones.map(() => 0);
  const stormy: boolean[] = wg.zones.map(() => false);
  for (const c of w.storms) {
    const zi = zoneIndexAt(wg, c.pos.x, c.pos.y);
    if (zi < 0) continue;
    boost[zi] = Math.max(boost[zi] ?? 0, (c.intensity ?? 0) * t.wind.stormBoostKn);
    stormy[zi] = true;
  }
  const rng = ctx.rng(WIND_STREAM);
  for (const zone of wg.zones) {
    const z = w.zones[zone.id] as SeaZoneWeather;
    const tr = z.track as NonNullable<SeaZoneWeather['track']>;
    const next = sampleWind(regimeAt(zone, T + W, t), { nDir: tr.nDir, nKn: tr.nKn }, boost[zone.index] ?? 0, rng, t);
    const fromDir = tr.toDir;
    const fromKn = tr.toKn;
    z.track = { fromDir, fromKn, toDir: round1(next.dir), toKn: round1(next.kn), nDir: round3(next.nDir), nKn: round3(next.nKn) };
    const fog = markov(z.fog, fogTarget(t, zone, T, fromKn), t.fog.persistence, ctx);
    const rain = markov(z.rain === true, clamp(t.rain.season[season(T)], 0, 0.95), t.rain.persistence, ctx) || stormy[zone.index] === true;
    if (z.fog !== fog) z.fog = fog;
    if (z.rain !== rain) z.rain = rain;
  }
  w.lastUpdateHour = T;
  spawnStorms(draft, ctx, wg, W);
}

function spawnStorms(draft: GameState, ctx: SimContext, wg: WeatherGeography, windowHours: number): void {
  const t = ctx.tunables.weather;
  const w = draft.weather;
  const hour = draft.time.hour;
  const rng = ctx.rng(STORM_STREAM);
  const seasonId = season(hour);
  const harsh = draft.meta.options.harshWinters === true;
  for (const zone of wg.zones) {
    if (zone.seeds.length === 0) continue;
    const n = spawnCount(expectedSpawns(ctx.balance, t, zone, seasonId, harsh, windowHours), rng);
    for (let k = 0; k < n; k++) {
      if (w.storms.length >= t.storms.maxCells) return;
      const z = w.zones[zone.id];
      const seq = w.seq ?? 1;
      w.seq = seq + 1;
      w.storms.push(spawnCell(zone, z?.track?.fromDir ?? z?.windDir ?? 270, hour, seq, rng, t, wg));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Hourly.

function interpolateZones(draft: GameState, ctx: SimContext, wg: WeatherGeography): void {
  const t = ctx.tunables.weather;
  const w = draft.weather;
  const f = (draft.time.hour - w.lastUpdateHour) / windHours(ctx);
  const zones = w.zones;
  for (const zone of wg.zones) {
    const z = zones[zone.id];
    const tr = z?.track;
    if (z === undefined || tr === undefined) continue;
    const now = interpolateWind(tr.fromDir, tr.fromKn, tr.toDir, tr.toKn, f);
    if (z.windDir !== now.dir) z.windDir = now.dir;
    if (z.speed !== now.kn) z.speed = now.kn;
    const cls = strengthOf(now.kn, t);
    if (z.windStr !== cls) z.windStr = cls;
  }
}

function stepStorms(draft: GameState, ctx: SimContext, wg: WeatherGeography): void {
  const t = ctx.tunables.weather;
  const storms = draft.weather.storms;
  if (storms.length === 0) return;
  const hour = draft.time.hour;
  for (let i = storms.length - 1; i >= 0; i--) {
    const c = storms[i] as StormCell;
    if (c.bornHour !== hour) {
      c.pos.x = roundPos(c.pos.x + c.velocity.x);
      c.pos.y = roundPos(c.pos.y + c.velocity.y);
      const size = sizeAt(c, hour, t);
      const radius = roundPos(size.radius);
      const intensity = roundVel(size.intensity);
      if (c.radius !== radius) c.radius = radius;
      if (c.intensity !== intensity) c.intensity = intensity;
      const sev = severityClassOf(intensity, t);
      if (c.severity !== sev) c.severity = sev;
    }
    if (cellGone(c, hour, wg, t)) storms.splice(i, 1);
  }
}

/** What the fleet scan needs from one live cell (the draft cell; its met/warned lists are read only for candidates). */
interface CellView {
  index: number;
  cell: StormCell;
  x: number;
  y: number;
  /** Largest distance (cells) from the cell's current centre at which a fleet can be touched this check. */
  touch: number;
  /** Largest distance at which the cell can reach a fleet within the longest forecast horizon. */
  reachMax: number;
  hit: boolean;
}

/** True if a (possibly drafted) fleet-id list holds `id` (no copy of the list). */
function listHas(list: readonly FleetId[] | undefined, id: FleetId): boolean {
  if (list === undefined) return false;
  for (let i = 0; i < list.length; i++) if (list[i] === id) return true;
  return false;
}

function scanFleets(draft: GameState, ctx: SimContext, wg: WeatherGeography): void {
  const t = ctx.tunables.weather;
  const storms = draft.weather.storms;
  if (storms.length === 0) return;
  const hour = draft.time.hour;
  const checkHours = t.storms.checkHours;
  const aiTurn = hour % checkHours === 0;
  const cells: CellView[] = [];
  for (let i = 0; i < storms.length; i++) {
    const c = storms[i] as StormCell;
    const speed = Math.sqrt(c.velocity.x * c.velocity.x + c.velocity.y * c.velocity.y);
    cells.push({
      index: i,
      cell: c,
      x: c.pos.x,
      y: c.pos.y,
      touch: (c.peakRadius ?? c.radius) + speed * checkHours,
      reachMax: (c.peakRadius ?? c.radius) + speed * t.storms.forecastMaxHours,
      hit: canHit(c, t),
    });
  }
  const playerFaction = draft.player.factionId;
  const baseFleets = baseState(draft.fleets);
  const opStart = baseState(draft.time).hour;
  const margin = Math.max(0, hour - opStart) * t.storms.maxFleetCellsPerHour;
  const baseChars = baseState(draft.characters);
  const lookup: CharLookup = (id: CharId) => (Object.hasOwn(baseChars, id) ? baseChars[id] : draft.characters[id]) as Character | undefined;

  // Reflect.ownKeys: one proxy trap (Object.keys also traps every key's descriptor).
  for (const id of Reflect.ownKeys(draft.fleets) as FleetId[]) {
    const b = Object.hasOwn(baseFleets, id) ? baseFleets[id] : undefined;
    const owner = b !== undefined ? b.ownerId : draft.fleets[id]?.ownerId;
    const isPlayer = owner === playerFaction;
    if (!isPlayer && !aiTurn) continue;
    if (!isPlayer && b !== undefined && !nearAnyCell(cells, b.pos.x, b.pos.y, margin)) continue;
    const f = draft.fleets[id];
    if (f === undefined || f.shipIds.length === 0) continue;
    const back = isPlayer ? 1 : checkHours;
    const px = f.pos.x;
    const py = f.pos.y;
    let party: PartyInfo | undefined;
    for (const v of cells) {
      // Geometry first (cheap); the cell's met/warned lists are scanned only for candidates.
      const ddx = v.x - px;
      const ddy = v.y - py;
      if (v.hit && ddx * ddx + ddy * ddy <= v.touch * v.touch && sweptOver(v.cell, hour, back, px, py, t)) {
        if (listHas(v.cell.met, id)) continue;
        meetStorm(draft, ctx, wg, v.index, id); // records the fleet in cell.met
        if ((draft.fleets[id]?.shipIds.length ?? 0) === 0) break;
        continue;
      }
      if (isPlayer && !t.storms.noWarningModes.includes(f.mode)) {
        // Cheap reach test with the longest horizon before the party's skills are looked at.
        const dx = v.x - px;
        const dy = v.y - py;
        const reach = v.reachMax;
        if (dx * dx + dy * dy > reach * reach || listHas(v.cell.warned, id) || listHas(v.cell.met, id)) continue;
        party ??= partyInfo(ctx.content, f, lookup, draft.player.rulerId);
        const horizon = Math.min(t.storms.forecastMaxHours, warningHorizon(ctx.balance, party));
        const eta = stormEta(v.cell, hour, px, py, horizon, t);
        if (eta !== null) warn(draft, ctx, wg, v.index, f, eta, horizon); // records it in cell.warned
      }
    }
  }
}

function nearAnyCell(cells: readonly CellView[], x: number, y: number, margin: number): boolean {
  for (const v of cells) {
    const reach = v.touch + margin;
    const dx = v.x - x;
    const dy = v.y - y;
    if (dx * dx + dy * dy <= reach * reach) return true;
  }
  return false;
}

function zoneNameAt(wg: WeatherGeography, x: number, y: number): { id?: string; name: string } {
  const zi = zoneIndexAt(wg, x, y);
  const z = zi >= 0 ? wg.zones[zi] : undefined;
  return z !== undefined ? { id: z.id, name: z.name } : { name: '' };
}

function warn(draft: GameState, ctx: SimContext, wg: WeatherGeography, cellIndex: number, f: Fleet, eta: number, horizon: number): void {
  const cell = draft.weather.storms[cellIndex] as StormCell;
  (cell.warned ??= []).push(f.id);
  const zone = zoneNameAt(wg, f.pos.x, f.pos.y);
  const event: SimEventOf<'StormWarning'> = {
    type: 'StormWarning',
    fleetId: f.id,
    stormId: cell.id,
    etaHours: eta,
    horizonHours: horizon,
    severity: cell.severity,
    pos: { x: cell.pos.x, y: cell.pos.y },
  };
  if (zone.id !== undefined) event.zoneId = zone.id;
  ctx.emit(event);
  ctx.notify('weather.storm.warning', { priority: 'high', vars: { zone: zone.name, hours: eta, severity: cell.severity }, link: { kind: 'fleet', id: f.id } });
}

/** A cell has reached a fleet for the first time: roll whether it catches it, then resolve (§31.3). */
function meetStorm(draft: GameState, ctx: SimContext, wg: WeatherGeography, cellIndex: number, fleetId: FleetId): void {
  const t = ctx.tunables.weather;
  const balance = ctx.balance;
  const hour = draft.time.hour;
  const cell = draft.weather.storms[cellIndex] as StormCell;
  (cell.met ??= []).push(fleetId);
  const f = draft.fleets[fleetId] as Fleet;
  const exposure = Object.hasOwn(t.storms.modes, f.mode) ? t.storms.modes[f.mode] : 'exposed';
  if (exposure === 'immune') return;
  const sheltered = exposure === 'sheltered';
  const isPlayer = f.ownerId === draft.player.factionId;
  const lookup: CharLookup = (id) => draft.characters[id];
  const party = partyInfo(ctx.content, f, lookup, draft.player.rulerId);
  const p = catchChance(balance, {
    seafaring: party.seafaring,
    chancePct: party.chancePct,
    omen: voyageOmen(draft, f.ownerId, hour),
    drownedBell: holdsDrownedBell(draft, f.ownerId, t),
    nightSailing: f.mode === 'sailing' && isNightHour(((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY, t),
  });
  const rng = ctx.rng(HIT_STREAM);
  const zone = zoneNameAt(wg, f.pos.x, f.pos.y);
  if (!rng.chance(p)) {
    ctx.emit({ type: 'StormWeathered', fleetId, ownerId: f.ownerId, stormId: cell.id, sheltered });
    if (isPlayer) ctx.notify('weather.storm.weathered', { priority: 'low', vars: { zone: zone.name, sheltered }, link: { kind: 'fleet', id: fleetId } });
    return;
  }
  const ships: ShipSnapshot[] = [];
  for (const sid of f.shipIds) {
    const s = draft.ships[sid];
    if (s !== undefined) ships.push({ id: s.id, type: s.type, hullHp: s.hullHp, sailHp: s.sailHp });
  }
  if (ships.length === 0) return;
  const men = menTotal(f.men);
  const weights = shiftSeverity(balance.storms.severity, severityShift(balance, t, season(hour) === 'winter', isUndermanned(balance, men, ships), cell.intensity ?? 0));
  const severity = rollSeverity(weights, rng);
  const plan = planStormHit(
    {
      fleet: { id: f.id, men: { ...f.men }, cargo: { ...f.cargo }, rations: f.rations, silver: f.silver },
      ships,
      severity,
      sheltered,
      damagePct: party.damagePct,
      balance,
      t,
    },
    rng,
  );
  const has = (op: string) => ctx.env.effects.has(op);
  ctx.applyEffects(plan.effects.filter((e) => has(e.op)));
  const after = draft.fleets[fleetId];
  const lost = after === undefined || after.shipIds.length === 0;
  const pos = { x: f.pos.x, y: f.pos.y };
  const hit: StormHitEvent = {
    fleetId,
    ownerId: f.ownerId,
    stormId: cell.id,
    severity,
    sheltered,
    menLost: has('killMen') ? plan.menLost : 0,
    shipsLost: has('sinkShip') ? plan.shipsLost : [],
    shipsDamaged: has('damageShip') ? plan.shipsDamaged : 0,
    cargoLostPct: plan.cargoLostPct,
    rationsLost: plan.rationsLost,
    silverLost: plan.silverLost,
    delayHours: lost ? 0 : plan.delayHours,
    lost,
    pos,
  };
  if (zone.id !== undefined) hit.zoneId = zone.id;
  ctx.emit({ type: 'StormHit', ...hit });
  if (isPlayer) announceHit(ctx, hit, zone.name);
}

function announceHit(ctx: SimContext, hit: StormHitEvent, zoneName: string): void {
  const vars = {
    zone: zoneName,
    menLost: hit.menLost,
    shipsLost: hit.shipsLost.length,
    shipsDamaged: hit.shipsDamaged,
    sheltered: hit.sheltered,
    delayDays: Math.round((hit.delayHours / HOURS_PER_DAY) * 10) / 10,
  };
  const link = { kind: 'fleet' as const, id: hit.fleetId };
  if (hit.lost) {
    ctx.notify('weather.storm.hit.lost', { priority: 'critical', vars, link, illustration: 'narrative.vignette.wreck' });
    ctx.narrate('weather.narration.fleetLost', { zone: zoneName }, 'skald');
    ctx.chronicle({ kind: 'weather.fleetLost', textKey: 'weather.chronicle.fleetLost', importance: 3, vars, refs: [hit.fleetId, hit.stormId] });
    return;
  }
  ctx.notify(`weather.storm.hit.${hit.severity}`, { priority: hit.severity === 'minor' ? 'normal' : 'high', vars, link, illustration: 'narrative.vignette.storm' });
  if (hit.severity === 'severe') {
    ctx.narrate(hit.sheltered ? 'weather.narration.severeSheltered' : 'weather.narration.severe', { zone: zoneName }, 'skald');
    ctx.chronicle({ kind: 'weather.storm', textKey: 'weather.chronicle.storm', importance: 2, vars, refs: [hit.fleetId, hit.stormId] });
  }
}

/** Hourly: keyframes when due, interpolated wind, storm drift, then fleets against the cells. */
export function hourlyWeather(draft: GameState, ctx: SimContext, wg: WeatherGeography): void {
  const w = draft.weather;
  const hour = draft.time.hour;
  const W = windHours(ctx);
  if (hour >= w.lastUpdateHour + W) {
    if (hour - w.lastUpdateHour >= MAX_CATCH_UP_WINDOWS * W || hour < w.lastUpdateHour) {
      // Far behind (a module re-enabled after a pause): re-seed the keyframes on this window.
      const t0 = Math.floor(hour / W) * W;
      for (const zone of wg.zones) w.zones[zone.id] = freshZone(ctx, zone, t0, hour, icedToday(zone, hour));
      w.lastUpdateHour = t0;
    } else {
      while (hour >= w.lastUpdateHour + W) advanceKeyframes(draft, ctx, wg, w.lastUpdateHour + W);
    }
  }
  interpolateZones(draft, ctx, wg);
  stepStorms(draft, ctx, wg);
  scanFleets(draft, ctx, wg);
}

/** Daily: seasonal ice per zone (geography ice months; §8.4). */
export function dailyWeather(draft: GameState, _ctx: SimContext, wg: WeatherGeography): void {
  const zones = draft.weather.zones;
  const c = toCalendar(draft.time.hour);
  for (const zone of wg.zones) {
    const z = Object.hasOwn(zones, zone.id) ? zones[zone.id] : undefined;
    if (z === undefined) continue;
    const iced = zoneIcedOn(zone, c.monthIndex, c.day);
    if (z.ice !== iced) z.ice = iced;
  }
}
