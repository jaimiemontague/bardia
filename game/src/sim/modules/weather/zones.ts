/**
 * Sea zones as the weather sees them, derived from the geography pack (src/content/world.ts; a
 * content import — the world module's runtime map engine is never imported here).
 *
 * `zoneAt(x, y)` resolves a navigation-grid point to a sea zone WITHOUT the rasterised map: zone
 * polygons first (in pack order), then the nearest seed point. On the bundled map it agrees with
 * the map engine's geodesic `zoneOf` on ~96 % of sea cells (the misses lie along zone borders,
 * where the winds of both zones are alike). Callers holding a StaticWorld (the client, the world
 * module) should pass exact zone ids instead.
 */
import { getGeography, icePeriodCovers, type Geography, type SeaZoneDef } from '@content/world';

/** One sea zone, pre-digested for the weather systems. */
export interface WeatherZone {
  /** Index in `geo.seaZones` (stable order: every per-zone loop runs in this order). */
  readonly index: number;
  readonly id: string;
  /** Proper noun from the pack ("the Gray Firth"); data, not UI text. */
  readonly name: string;
  readonly def: SeaZoneDef;
  /** §31.3 zone storm modifier (open ocean 1.5, coastal 0.8). */
  readonly stormMod: number;
  readonly seeds: readonly (readonly [number, number])[];
  readonly polygons: readonly (readonly (readonly [number, number])[])[];
}

/** The digested zones of one geography plus its grid size. */
export interface WeatherGeography {
  readonly geo: Geography;
  readonly zones: readonly WeatherZone[];
  /** Zone id → index into `zones`. */
  readonly byId: Readonly<Record<string, number>>;
  readonly width: number;
  readonly height: number;
}

let cached: WeatherGeography | undefined;

/** Builds (unmemoized) the weather view of a geography. */
export function buildWeatherGeography(geo: Geography): WeatherGeography {
  const byId: Record<string, number> = {};
  const zones = geo.seaZones.map((def, index): WeatherZone => {
    byId[def.id] = index;
    return {
      index,
      id: def.id,
      name: def.name,
      def,
      stormMod: def.stormMod,
      seeds: def.seeds.map(([x, y]) => [x, y] as const),
      polygons: (def.polygons ?? []).map((poly) => poly.map(([x, y]) => [x, y] as const)),
    };
  });
  return { geo, zones, byId, width: geo.grid.width, height: geo.grid.height };
}

/**
 * The weather view of `geo` (default: the bundled geography), memoized by object identity. The
 * data is derived from immutable content only, so the cache never affects determinism.
 */
export function weatherGeography(geo?: Geography): WeatherGeography {
  const g = geo ?? getGeography();
  if (cached === undefined || cached.geo !== g) cached = buildWeatherGeography(g);
  return cached;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i] as readonly [number, number];
    const pj = poly[j] as readonly [number, number];
    const yi = pi[1];
    const yj = pj[1];
    if (yi > y !== yj > y && x < ((pj[0] - pi[0]) * (y - yi)) / (yj - yi) + pi[0]) inside = !inside;
  }
  return inside;
}

/** Index of the sea zone at a point (polygons, then nearest seed); −1 only for a geography without zones. */
export function zoneIndexAt(wg: WeatherGeography, x: number, y: number): number {
  for (const z of wg.zones) for (const poly of z.polygons) if (pointInPolygon(poly, x, y)) return z.index;
  let best = -1;
  let bestD = Infinity;
  for (const z of wg.zones) {
    for (const s of z.seeds) {
      const dx = s[0] - x;
      const dy = s[1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = z.index;
      }
    }
  }
  return best;
}

/** Id of the sea zone at a navigation-grid point (approximate near zone borders; see the file header). */
export function zoneAt(x: number, y: number, geo?: Geography): string | undefined {
  const wg = weatherGeography(geo);
  const i = zoneIndexAt(wg, x, y);
  return i >= 0 ? wg.zones[i]?.id : undefined;
}

/** True when any of the zone's ice periods covers the calendar day (`monthIndex` 0–11, `day` 1–30). */
export function zoneIcedOn(zone: WeatherZone, monthIndex: number, day: number): boolean {
  for (const p of zone.def.ice) if (icePeriodCovers(p, monthIndex, day)) return true;
  return false;
}
