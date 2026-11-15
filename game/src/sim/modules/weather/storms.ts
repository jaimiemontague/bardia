/**
 * Storm cells (design §8.4, §31.3): moving discs born in a sea zone by season and drifting
 * downwind across zones. A cell grows to its peak radius and intensity, holds, and decays before
 * it dies (`untilHour`). Motion is linear, so where a cell will be is exactly predictable
 * (`stormAt`), which is what the forecast (StormWarning) and the map overlay use.
 *
 * Spawn rate. The design's daily storm chance at sea (§31.3) is
 *   p = seasonBase × zoneMod × (1 − 0.04 × Seafaring) × omen × relic.
 * The world-level part, `seasonBase × zoneMod` (× harsh winters), is realised as the rate at which a
 * point at sea meets NEW cells: each zone spawns `λ × areaCells / sweptArea` cells per day, where
 * `sweptArea` is the mean area one cell sweeps over its life. The fleet-level part (Seafaring, omen,
 * relic, night) is the chance that a cell reaching the fleet actually catches it (rules.ts), so a
 * fleet's expected storms per day at sea equal the §31.3 p.
 *
 * Pure functions over plain objects (the systems hand in drafts or snapshots).
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as WeatherTunables } from '@content/schemas/tunables/weather';
import { clamp, dcos, dsin, PI, TWO_PI } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { StormCell } from '@sim/core/state';
import { HOURS_PER_DAY, type Hour } from '@sim/core/time';
import type { StormSeverity } from './types';
import { bearingVector } from './wind';
import type { WeatherGeography, WeatherZone } from './zones';

/** A cell's shape at some hour. */
export interface StormShape {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}

/** Life envelope 0 → 1 → 0 at `age` hours into a life of `ttl` hours. */
export function envelope(age: number, ttl: number, t: WeatherTunables): number {
  if (ttl <= 0) return 0;
  const grow = t.storms.growFrac * ttl;
  const decay = t.storms.decayFrac * ttl;
  const up = grow > 0 ? age / grow : 1;
  const down = decay > 0 ? (ttl - age) / decay : 1;
  return clamp(Math.min(up, down, 1), 0, 1);
}

/** Lifetime of a cell (hours). */
export function ttlOf(cell: StormCell): number {
  return cell.untilHour - (cell.bornHour ?? cell.untilHour);
}

/** Radius and intensity of a cell at `hour` (position not included). */
export function sizeAt(cell: StormCell, hour: Hour, t: WeatherTunables): { radius: number; intensity: number } {
  const born = cell.bornHour ?? hour;
  const env = envelope(hour - born, cell.untilHour - born, t);
  const peakR = cell.peakRadius ?? cell.radius;
  const minF = t.storms.minRadiusFactor;
  return { radius: peakR * (minF + (1 - minF) * env), intensity: (cell.peakIntensity ?? cell.intensity ?? 0) * env };
}

/** Where the cell will be (or was) at `hour`, given its state at `nowHour`. */
export function stormAt(cell: StormCell, nowHour: Hour, hour: Hour, t: WeatherTunables): StormShape {
  const dt = hour - nowHour;
  const s = sizeAt(cell, hour, t);
  return { x: cell.pos.x + cell.velocity.x * dt, y: cell.pos.y + cell.velocity.y * dt, radius: s.radius, intensity: s.intensity };
}

/** The drawn severity class of an intensity. */
export function severityClassOf(intensity: number, t: WeatherTunables): StormSeverity {
  const c = t.storms.severityClass;
  if (intensity >= c.severe) return 'severe';
  if (intensity >= c.moderate) return 'moderate';
  return 'minor';
}

/** Mean of a `[lo, hi]` range. */
function mid(r: readonly [number, number]): number {
  return (r[0] + r[1]) / 2;
}

/**
 * Mean area (cells²) one cell sweeps over its life: a disc of the mean effective radius dragged
 * along its track (2·r·v·T) plus its own area.
 */
export function meanSweptArea(t: WeatherTunables): number {
  const s = t.storms;
  const meanEnv = 1 - s.growFrac / 2 - s.decayFrac / 2;
  const r = mid(s.radiusCells) * (s.minRadiusFactor + (1 - s.minRadiusFactor) * meanEnv);
  return 2 * r * mid(s.speedCellsPerHour) * mid(s.ttlHours) + PI * r * r;
}

/** The §31.3 world-level daily storm rate at a point in a zone (season base × zone modifier × harsh winters). */
export function zoneDailyRate(balance: Balance, zone: WeatherZone, season: 'spring' | 'summer' | 'autumn' | 'winter', harshWinters: boolean): number {
  const harsh = harshWinters && season === 'winter' ? balance.storms.harshWintersMult : 1;
  return balance.storms.season[season] * zone.stormMod * harsh;
}

/** Expected number of cells a zone spawns in `hours` hours. */
export function expectedSpawns(balance: Balance, t: WeatherTunables, zone: WeatherZone, season: 'spring' | 'summer' | 'autumn' | 'winter', harshWinters: boolean, hours: number): number {
  const z = t.zones[zone.id];
  const area = z?.areaCells ?? t.defaultZoneAreaCells;
  const mult = z?.spawnMult ?? 1;
  const perDay = (zoneDailyRate(balance, zone, season, harshWinters) * area * t.storms.coverageCalibration * mult) / meanSweptArea(t);
  return (perDay * hours) / HOURS_PER_DAY;
}

/**
 * A new cell born at `hour` for `zone`: drifting downwind of `windFromDeg` on a track that passes
 * near one of the zone's seeds (born `upwindStartFrac` of its track length upwind of that point,
 * kept inside the map). Consumes a fixed number of draws.
 */
export function spawnCell(
  zone: WeatherZone,
  windFromDeg: number,
  hour: Hour,
  seq: number,
  rng: RandomSource,
  t: WeatherTunables,
  bounds: Pick<WeatherGeography, 'width' | 'height'>,
): StormCell {
  const s = t.storms;
  const seed = rng.pick(zone.seeds);
  const jitter = s.spawnJitterCells * Math.sqrt(rng.float());
  const theta = TWO_PI * rng.float();
  const bearing = windFromDeg + 180 + s.dirSpreadDeg * clamp(rng.normal(), -2.5, 2.5);
  const speed = rng.range(s.speedCellsPerHour[0], s.speedCellsPerHour[1]);
  const v = bearingVector(bearing);
  const ttl = Math.max(2, Math.round(rng.range(s.ttlHours[0], s.ttlHours[1])));
  const peakRadius = rng.range(s.radiusCells[0], s.radiusCells[1]);
  const peakIntensity = rng.range(s.intensity[0], s.intensity[1]);
  // Born upwind, so that the stretch of track around the seed point lies in the zone.
  const back = speed * ttl * s.upwindStartFrac;
  const x = clamp(seed[0] + jitter * dcos(theta) - v.x * back, 0, bounds.width);
  const y = clamp(seed[1] + jitter * dsin(theta) - v.y * back, 0, bounds.height);
  const cell: StormCell = {
    id: `storm_${seq}`,
    pos: { x: roundPos(x), y: roundPos(y) },
    radius: 0,
    severity: 'minor',
    velocity: { x: roundVel(v.x * speed), y: roundVel(v.y * speed) },
    untilHour: hour + ttl,
    intensity: 0,
    peakIntensity: roundVel(peakIntensity),
    peakRadius: roundPos(peakRadius),
    bornHour: hour,
    zoneId: zone.id,
    met: [],
    warned: [],
  };
  const size = sizeAt(cell, hour, t);
  cell.radius = roundPos(size.radius);
  cell.intensity = roundVel(size.intensity);
  cell.severity = severityClassOf(cell.intensity ?? 0, t);
  return cell;
}

/** Positions are kept to 1/100 cell (compact, stable JSON). */
export function roundPos(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Velocities and intensities are kept to 1/1000. */
export function roundVel(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** True when the cell has died or drifted off the map (by more than the margin). */
export function cellGone(cell: StormCell, hour: Hour, wg: Pick<WeatherGeography, 'width' | 'height'>, t: WeatherTunables): boolean {
  if (hour >= cell.untilHour) return true;
  const m = t.storms.mapMarginCells + cell.radius;
  return cell.pos.x < -m || cell.pos.y < -m || cell.pos.x > wg.width + m || cell.pos.y > wg.height + m;
}

/** Squared distance from point (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = clamp(u, 0, 1);
  const qx = ax + u * dx - px;
  const qy = ay + u * dy - py;
  return qx * qx + qy * qy;
}

/**
 * True when the cell's disc swept over (px, py) during the last `back` hours up to `nowHour`
 * (a capsule test; back = 0 tests the disc now). Uses the larger of the two radii.
 */
export function sweptOver(cell: StormCell, nowHour: Hour, back: number, px: number, py: number, t: WeatherTunables): boolean {
  const r = back > 0 ? Math.max(cell.radius, sizeAt(cell, nowHour - back, t).radius) : cell.radius;
  const ax = cell.pos.x - cell.velocity.x * back;
  const ay = cell.pos.y - cell.velocity.y * back;
  return segmentDistance2(px, py, ax, ay, cell.pos.x, cell.pos.y) <= r * r;
}

/**
 * Hours until the cell first covers (px, py) with at least `minHitIntensity`, looking at most
 * `maxHours` ahead and never past the cell's death; null when it will not. 0 = covering it now.
 */
export function stormEta(cell: StormCell, nowHour: Hour, px: number, py: number, maxHours: number, t: WeatherTunables): number | null {
  const last = Math.min(maxHours, cell.untilHour - 1 - nowHour);
  if (last < 0) return null;
  const peakR = cell.peakRadius ?? cell.radius;
  const speed = Math.sqrt(cell.velocity.x * cell.velocity.x + cell.velocity.y * cell.velocity.y);
  const dx0 = cell.pos.x - px;
  const dy0 = cell.pos.y - py;
  const reach = peakR + speed * last;
  if (dx0 * dx0 + dy0 * dy0 > reach * reach) return null;
  const minI = t.storms.minHitIntensity;
  for (let k = 0; k <= last; k++) {
    const s = stormAt(cell, nowHour, nowHour + k, t);
    if (s.intensity < minI) continue;
    const dx = s.x - px;
    const dy = s.y - py;
    if (dx * dx + dy * dy <= s.radius * s.radius) return k;
  }
  return null;
}

/** Whether a cell can currently catch a fleet. */
export function canHit(cell: StormCell, t: WeatherTunables): boolean {
  return (cell.intensity ?? 0) >= t.storms.minHitIntensity;
}

/** Splits an expected count into a whole number of spawns (integer part + one Bernoulli draw). */
export function spawnCount(expected: number, rng: RandomSource): number {
  const whole = Math.floor(expected);
  return whole + (rng.chance(expected - whole) ? 1 : 0);
}
