/**
 * Reading a scene's circumstances from the game state, and the words scenes use instead of numbers
 * (§20 rule 5): odds as a band, a head-count rounded the way a lookout would say it, a compass point.
 */
import type { GameState, MapPos } from '@sim/core/state';
import { season } from '@sim/core/time';
import type { Ambience } from './pictures';
import type { WindWord } from './paint';

/** Time of day, season and weather where the crew is (zone weather, a storm cell over them). */
export function ambienceOf(state: GameState, opts: { zoneId?: string | null; pos?: MapPos } = {}): Ambience {
  const hour = state.time.hour;
  const zones = state.weather?.zones ?? {};
  const zone = opts.zoneId != null && Object.hasOwn(zones, opts.zoneId) ? zones[opts.zoneId] : undefined;
  let storm = false;
  if (opts.pos) {
    for (const c of state.weather?.storms ?? []) {
      if (c.untilHour < hour) continue;
      if ((c.pos.x - opts.pos.x) ** 2 + (c.pos.y - opts.pos.y) ** 2 <= c.radius * c.radius) storm = true;
    }
  }
  const wind: WindWord = zone?.windStr ?? 'fresh';
  return { hourOfDay: hour % 24, season: season(hour), weather: { fog: zone?.fog === true, wind, storm } };
}

export type OddsBand = 'certain' | 'likely' | 'even' | 'unlikely' | 'slim';

/** A chance (0..1) as a band of words. */
export function oddsBand(chance: number): OddsBand {
  if (chance >= 0.9) return 'certain';
  if (chance >= 0.62) return 'likely';
  if (chance >= 0.38) return 'even';
  if (chance >= 0.12) return 'unlikely';
  return 'slim';
}

/** A head-count as a lookout says it: exact under 10, then to 5, 10, 50 and 100. */
export function approxMen(n: number): number {
  const m = Math.max(0, Math.round(n));
  if (m < 10) return m;
  if (m < 30) return Math.round(m / 5) * 5;
  if (m < 150) return Math.round(m / 10) * 10;
  if (m < 1000) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}

/** The compass point from a to b (map y grows southward), or 'none' when they coincide. */
export function compassWord(a: MapPos | undefined, b: MapPos | undefined): 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'none' {
  if (!a || !b) return 'none';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-6) return 'none';
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return (['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const)[Math.round(deg / 45) % 8] ?? 'none';
}
