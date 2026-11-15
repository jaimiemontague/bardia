/**
 * Wind (design §8.4, §31.2). Each sea zone has a prevailing regime per season (geography pack:
 * from-direction, strength class, spread). Every `balance.sailing.windUpdateHours` (6) a new sample
 * is drawn per zone — regime + seeded AR(1) noise (+ a boost while a storm sits in the zone) — and
 * the zone's wind is interpolated hourly between the last two samples (shortest arc for the
 * direction). Regimes blend over `seasonBlendDays` around each season boundary so the wind never
 * jumps on the first day of a season. Pure functions; no Math transcendental calls (dmath only).
 */
import type { Balance } from '@content/schemas/balance';
import type { WindStrength } from '@sim/core/state';
import type { Tunables as WeatherTunables } from '@content/schemas/tunables/weather';
import { clamp, dcos, dsin, PI } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import { DAYS_PER_YEAR, HOURS_PER_DAY, type Hour } from '@sim/core/time';
import type { WeatherZone } from './zones';

/** Wind strength classes, weakest first. */
export const WIND_CLASSES: readonly WindStrength[] = ['calm', 'light', 'fresh', 'strong', 'gale'];
const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'] as const;
const DAYS_PER_SEASON = DAYS_PER_YEAR / 4;
const NOISE_CLIP = 3;

/** A prevailing regime: direction FROM (degrees), mean speed (knots), direction spread (degrees, 1 σ). */
export interface WindRegime {
  dir: number;
  kn: number;
  spread: number;
}

/** One wind sample plus the noise state that produced it. */
export interface WindSample {
  dir: number;
  kn: number;
  nDir: number;
  nKn: number;
}

/** Normalises degrees into [0, 360). */
export function normDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r === 360 ? 0 : r;
}

/** Signed shortest angular difference b − a, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = normDeg(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Interpolates between two compass angles along the shorter arc (f in [0, 1]). */
export function lerpAngle(a: number, b: number, f: number): number {
  return normDeg(a + angleDiff(a, b) * f);
}

/** The strength class of a speed in knots. */
export function strengthOf(kn: number, t: WeatherTunables): WindStrength {
  const m = t.wind.classMinKn;
  if (kn >= m.gale) return 'gale';
  if (kn >= m.strong) return 'strong';
  if (kn >= m.fresh) return 'fresh';
  if (kn >= m.light) return 'light';
  return 'calm';
}

/** The zone's seasonal regime for one season index (0 spring … 3 winter). */
function seasonRegime(zone: WeatherZone, season: number, t: WeatherTunables): WindRegime {
  const w = zone.def.winds[SEASON_KEYS[season] as (typeof SEASON_KEYS)[number]];
  return { dir: w.fromDeg, kn: t.wind.strengthKn[w.strength], spread: w.spreadDeg };
}

function mixRegime(a: WindRegime, b: WindRegime, wb: number): WindRegime {
  return { dir: lerpAngle(a.dir, b.dir, wb), kn: a.kn + (b.kn - a.kn) * wb, spread: a.spread + (b.spread - a.spread) * wb };
}

/**
 * The prevailing regime of a zone at an hour, blending neighbouring seasons within
 * `seasonBlendDays` of a boundary (half-and-half exactly at the boundary).
 */
export function regimeAt(zone: WeatherZone, hour: Hour, t: WeatherTunables): WindRegime {
  const dayOfYear = (((hour / HOURS_PER_DAY) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const season = Math.min(3, Math.floor(dayOfYear / DAYS_PER_SEASON));
  const into = dayOfYear - season * DAYS_PER_SEASON;
  const here = seasonRegime(zone, season, t);
  const blend = t.wind.seasonBlendDays;
  if (blend <= 0) return here;
  if (into < blend) {
    const prev = seasonRegime(zone, (season + 3) % 4, t);
    return mixRegime(prev, here, 0.5 + (0.5 * into) / blend);
  }
  if (DAYS_PER_SEASON - into < blend) {
    const next = seasonRegime(zone, (season + 1) % 4, t);
    return mixRegime(here, next, 0.5 - (0.5 * (DAYS_PER_SEASON - into)) / blend);
  }
  return here;
}

/** One AR(1) step of a ~N(0, 1) noise value (clipped to ±3 σ). */
export function stepNoise(prev: number, rho: number, rng: RandomSource): number {
  const n = rho * prev + Math.sqrt(1 - rho * rho) * rng.normal();
  return clamp(n, -NOISE_CLIP, NOISE_CLIP);
}

/** Wind from a regime and noise values (+ extra knots, e.g. a storm in the zone). */
export function windFromNoise(regime: WindRegime, nDir: number, nKn: number, boostKn: number, t: WeatherTunables): { dir: number; kn: number } {
  const dir = normDeg(regime.dir + regime.spread * nDir);
  const kn = clamp(regime.kn * Math.max(0, 1 + t.wind.speedCv * nKn) + boostKn, 0, t.wind.maxKn);
  return { dir, kn };
}

/**
 * Draws the next 6-hourly sample: the noise follows AR(1) from `prev` (pass null for a fresh,
 * stationary draw). Consumes exactly two normal draws.
 */
export function sampleWind(regime: WindRegime, prev: { nDir: number; nKn: number } | null, boostKn: number, rng: RandomSource, t: WeatherTunables): WindSample {
  const rho = prev === null ? 0 : t.wind.persistence;
  const nDir = stepNoise(prev?.nDir ?? 0, rho, rng);
  const nKn = stepNoise(prev?.nKn ?? 0, rho, rng);
  const w = windFromNoise(regime, nDir, nKn, boostKn, t);
  return { dir: w.dir, kn: w.kn, nDir, nKn };
}

/** Rounds to one decimal (keeps the state compact and the hourly writes stable). */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Interpolated wind between two keyframes at fraction f ∈ [0, 1]. */
export function interpolateWind(fromDir: number, fromKn: number, toDir: number, toKn: number, f: number): { dir: number; kn: number } {
  const g = clamp(f, 0, 1);
  return { dir: normDeg(round1(lerpAngle(fromDir, toDir, g))), kn: round1(fromKn + (toKn - fromKn) * g) };
}

/** Points of sail of the §31.2 wind-factor table. */
export type PointOfSail = 'running' | 'broadReach' | 'beamReach' | 'closeHauled' | 'inIrons';

/** Degrees between the heading and the direction the wind comes FROM (0 = straight into it, 180 = dead downwind). */
export function angleOffWindDeg(windFromDeg: number, headingDeg: number): number {
  return Math.abs(angleDiff(windFromDeg, headingDeg));
}

/**
 * The point of sail of a heading (degrees, compass) in a wind blowing FROM `windFromDeg`, by the
 * `balance.sailing.pointOfSailDeg` bands (in irons ≤ 40°, close-hauled ≤ 60°, beam ≤ 110°, broad ≤
 * 150°, running beyond: within 30° of downwind).
 */
export function pointOfSail(balance: Balance, windFromDeg: number, headingDeg: number): PointOfSail {
  const off = angleOffWindDeg(windFromDeg, headingDeg);
  const b = balance.sailing.pointOfSailDeg;
  if (off <= b.inIronsMax) return 'inIrons';
  if (off <= b.closeHauledMax) return 'closeHauled';
  if (off <= b.beamReachMax) return 'beamReach';
  if (off <= b.broadReachMax) return 'broadReach';
  return 'running';
}

/** The §31.2 sail wind factor for a heading. */
export function windFactor(balance: Balance, windFromDeg: number, strength: WindStrength, headingDeg: number): number {
  return balance.sailing.windFactor[pointOfSail(balance, windFromDeg, headingDeg)][strength];
}

/** Unit vector (x east, y south) of a compass bearing in degrees. */
export function bearingVector(bearingDeg: number): { x: number; y: number } {
  const r = (normDeg(bearingDeg) * PI) / 180;
  return { x: dsin(r), y: -dcos(r) };
}
