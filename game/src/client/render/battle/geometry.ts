/**
 * Small pure helpers for drawing squads: interpolation, oriented footprints, unit silhouettes and
 * picking map structures (buildings, gates, loot) under a point.
 */
import type { Content } from '@content/index';
import { resolveUnit } from '@sim/battle/data';
import { S, type BattleMap } from '@sim/battle/map/grid';
import type { BuildingView, CacheView, GateView } from '@sim/battle/index';

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates two angles along the shorter arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** The four corners (x0, y0, …) of a footprint centred at (x, y) facing `facing` with half extents hw (across) and hd (along). */
export function footprintCorners(x: number, y: number, facing: number, hw: number, hd: number): number[] {
  const fx = Math.cos(facing);
  const fy = Math.sin(facing);
  const rx = -fy;
  const ry = fx;
  const pts: number[] = [];
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    pts.push(x + fx * hd * a + rx * hw * b, y + fy * hd * a + ry * hw * b);
  }
  return pts;
}

/** How a unit is drawn. */
export type UnitShape = 'foot' | 'shield' | 'archer' | 'horse' | 'beast' | 'civilian';

/** Silhouette class of a unit id (cavalry, single beasts, ranged, shield-wall infantry, others). */
export function unitShape(content: Content, unitId: string): UnitShape {
  let u;
  try {
    u = resolveUnit(content, unitId);
  } catch {
    return 'foot';
  }
  if (u.nonCombatant) return 'civilian';
  if (u.single) return 'beast';
  if (u.cavalry) return 'horse';
  if (u.hasRanged) return 'archer';
  if (u.abilities.includes('shieldWall')) return 'shield';
  return 'foot';
}

/** What a right click can land on, besides squads. */
export type MapPick = { kind: 'building'; id: string } | { kind: 'gate'; id: string } | { kind: 'cache'; id: string } | { kind: 'ground' };

/**
 * The structure or loot under a world point: a dropped loot pile within `slack` tiles, a gate tile,
 * a building footprint; otherwise the ground.
 */
export function pickStructure(map: BattleMap, buildings: readonly BuildingView[], gates: readonly GateView[], caches: readonly CacheView[], x: number, y: number, slack = 0.9): MapPick {
  let best: CacheView | null = null;
  let bestD = slack * slack;
  for (const c of caches) {
    if (!c.dropped) continue;
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) return { kind: 'cache', id: best.id };
  for (const g of gates) if (x >= g.x - 0.3 && x < g.x + g.w + 0.3 && y >= g.y - 0.3 && y < g.y + g.h + 0.3) return { kind: 'gate', id: g.id };
  for (const b of buildings) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { kind: 'building', id: b.id };
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.struct[ty * map.w + tx] === S.gate) {
    const g = gates[map.structId[ty * map.w + tx]!];
    if (g) return { kind: 'gate', id: g.id };
  }
  return { kind: 'ground' };
}
