/**
 * Hit testing (pure): what is under a screen point. Icons (fleets, settlements, sites, storms) are tested in
 * screen space against their drawn radius, nearest first with ties broken by priority; otherwise the cell under the
 * point is a sea or land target.
 */
import { CELL_SEA, type StaticWorld } from '@sim/modules/world/map/index';
import type { MapTarget, Vec2 } from './types';

/** A clickable icon in screen space. */
export interface ScreenMarker {
  target: MapTarget;
  x: number;
  y: number;
  /** Hit radius (px). */
  r: number;
  /** Higher wins when two markers are equally near (fleets 3, settlements 2, sites 1, storms 0). */
  priority: number;
}

/** The marker under (sx, sy), or null. */
export function pickMarker(markers: readonly ScreenMarker[], sx: number, sy: number): ScreenMarker | null {
  let best: ScreenMarker | null = null;
  let bestScore = Infinity;
  for (const m of markers) {
    const d = Math.hypot(m.x - sx, m.y - sy);
    if (d > m.r) continue;
    // Normalised distance, with a priority bias worth a quarter of a radius per level.
    const score = d / m.r - m.priority * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** The sea or land target at a world point (null off the chart). */
export function cellTarget(world: StaticWorld, pos: Vec2): MapTarget | null {
  const x = Math.floor(pos[0]);
  const y = Math.floor(pos[1]);
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  const cell = y * world.width + x;
  if (world.kind[cell] === CELL_SEA) {
    const z = world.zoneOf[cell]!;
    return { kind: 'sea', pos: [pos[0], pos[1]], cell, zoneId: z >= 0 ? (world.geo.seaZones[z]?.id ?? null) : null };
  }
  const p = world.provinceOf[cell]!;
  const r = world.regionOf[cell]!;
  return { kind: 'land', pos: [pos[0], pos[1]], cell, provinceId: p >= 0 ? (world.geo.provinces[p]?.id ?? null) : null, regionId: r >= 0 ? (world.geo.regions[r]?.id ?? null) : null };
}

/** Stable key of a target (selection and hover comparisons). */
export function targetKey(t: MapTarget | null): string {
  if (!t) return '';
  switch (t.kind) {
    case 'settlement':
    case 'site':
      return `${t.kind}:${t.key}`;
    case 'fleet':
      return `fleet:${t.fleetId}`;
    case 'storm':
      return `storm:${t.stormId}`;
    default:
      return `${t.kind}:${t.cell}`;
  }
}
