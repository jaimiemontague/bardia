/**
 * Squad geometry: formation footprints (oriented rectangles), gaps between squads, facing updates
 * and figure slot layouts. Angles use dmath (deterministic across engines).
 */
import { datan2, dcos, dsin, PI, TWO_PI } from '@sim/core/dmath';
import type { BattleData } from '../data';
import { frontage } from '../formulas';
import type { BSquad, BattleState } from './types';

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a % TWO_PI;
  if (x <= -PI) x += TWO_PI;
  else if (x > PI) x -= TWO_PI;
  return x;
}

/** Angle of the vector (dx, dy) (0 = +x, π/2 = +y). */
export function angleOf(dx: number, dy: number): number {
  return datan2(dy, dx);
}

/** Sets the facing and its cached unit vector. */
export function setFacing(s: BSquad, a: number): void {
  s.facing = wrapAngle(a);
  s.fx = dcos(s.facing);
  s.fy = dsin(s.facing);
}

/** Turns toward `target` by at most `maxStep` radians; returns true when aligned. */
export function turnToward(s: BSquad, target: number, maxStep: number): boolean {
  const d = wrapAngle(target - s.facing);
  if (Math.abs(d) <= maxStep) {
    if (d !== 0) setFacing(s, target);
    return true;
  }
  setFacing(s, s.facing + (d > 0 ? maxStep : -maxStep));
  return false;
}

/** Files (men per rank) of a formation for `men` men. */
export function filesOf(data: BattleData, s: BSquad, men: number): number {
  if (s.unit.single) return 1;
  return Math.max(1, Math.min(men, frontage(data.b, s.formation)));
}

/** Recomputes the footprint half extents from men and formation. */
export function updateFootprint(data: BattleData, s: BSquad): void {
  const t = data.t;
  const men = Math.max(1, s.men);
  if (s.unit.single) {
    s.hw = Math.max(t.minSquadHalfTiles, 1);
    s.hd = Math.max(t.minSquadHalfTiles, 1);
    return;
  }
  const spacing = s.formation === 'loose' ? t.looseSpacingMult : s.formation === 'shieldWall' ? 0.85 : 1;
  const files = filesOf(data, s, men);
  const ranks = Math.ceil(men / files);
  let width = files * t.manWidthTiles * spacing;
  const depth = ranks * t.rankDepthTiles * spacing;
  if (s.formation === 'wedge') width *= 0.8;
  s.hw = Math.max(t.minSquadHalfTiles, width / 2);
  s.hd = Math.max(t.minSquadHalfTiles, depth / 2);
}

/** Extent of a squad's footprint along the unit direction (ux, uy) (support function of its rectangle). */
export function extentAlong(s: BSquad, ux: number, uy: number): number {
  // Right axis = (−fy, fx).
  return s.hw * Math.abs(-s.fy * ux + s.fx * uy) + s.hd * Math.abs(s.fx * ux + s.fy * uy);
}

/** Separation of two footprints along the unit axis (ux, uy) (negative = their projections overlap). */
function axisGap(a: BSquad, b: BSquad, dx: number, dy: number, ux: number, uy: number): number {
  return Math.abs(dx * ux + dy * uy) - extentAlong(a, ux, uy) - extentAlong(b, ux, uy);
}

/**
 * Gap between two footprints (negative = overlap): the largest separation over the separating axes
 * of the two oriented rectangles (the centre line and each rectangle's facing and right axes). It
 * never exceeds the true distance, and unlike the centre line alone it does not let two long lines
 * meeting at an angle "touch" corner to corner while they are tiles apart.
 */
export function gapBetween(a: BSquad, b: BSquad): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) return -(Math.max(a.hw, a.hd) + Math.max(b.hw, b.hd));
  const ux = dx / d;
  const uy = dy / d;
  let gap = d - extentAlong(a, ux, uy) - extentAlong(b, ux, uy);
  gap = Math.max(gap, axisGap(a, b, dx, dy, a.fx, a.fy), axisGap(a, b, dx, dy, -a.fy, a.fx), axisGap(a, b, dx, dy, b.fx, b.fy), axisGap(a, b, dx, dy, -b.fy, b.fx));
  return gap;
}

/** Gap from a squad's footprint to a point. */
export function gapToPoint(s: BSquad, x: number, y: number): number {
  const dx = x - s.x;
  const dy = y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) return -Math.max(s.hw, s.hd);
  return d - extentAlong(s, dx / d, dy / d);
}

/** Distance from a point to an axis-aligned rectangle (tile units). */
export function distToRect(px: number, py: number, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Local slot offsets (right, forward) of `count` figures in the squad's formation, written into
 * `out` as pairs. Lines/shield walls are rectangles, wedges triangles, loose formations spread.
 */
export function figureSlots(data: BattleData, s: BSquad, count: number, out: number[]): void {
  out.length = 0;
  if (count <= 0) return;
  if (count === 1 || s.unit.single) {
    out.push(0, 0);
    return;
  }
  const w = s.hw * 2;
  const d = s.hd * 2;
  if (s.formation === 'wedge') {
    // Rows of 1, 3, 5 … figures, apex forward.
    let placed = 0;
    let row = 0;
    const rows: number[] = [];
    while (placed < count) {
      const n = Math.min(count - placed, 1 + 2 * row);
      rows.push(n);
      placed += n;
      row++;
    }
    const rowGap = d / Math.max(1, rows.length);
    rows.forEach((n, r) => {
      const fwd = s.hd - rowGap * (r + 0.5);
      const span = (w * (r + 1)) / rows.length;
      for (let k = 0; k < n; k++) out.push(n === 1 ? 0 : -span / 2 + (span * k) / (n - 1), fwd);
    });
    return;
  }
  const aspect = Math.max(0.2, w / Math.max(0.2, d));
  const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * aspect))));
  const rows = Math.ceil(count / cols);
  const cw = w / cols;
  const rh = d / rows;
  for (let k = 0; k < count; k++) {
    const r = Math.floor(k / cols);
    const c = k % cols;
    const inRow = r === rows - 1 ? count - r * cols : cols;
    const offset = (cols - inRow) * cw * 0.5;
    out.push(-w / 2 + cw * (c + 0.5) + offset, s.hd - rh * (r + 0.5));
  }
}

/** World position of a local slot (right, forward) for a squad. */
export function slotWorld(s: BSquad, right: number, fwd: number): [number, number] {
  return [s.x + -s.fy * right + s.fx * fwd, s.y + s.fx * right + s.fy * fwd];
}

/** Indices of squads still on the field (not reserve, escaped, destroyed or surrendered). */
export function onField(s: BSquad): boolean {
  return s.status === 'active' || s.status === 'routing' || s.status === 'asleep';
}

/** Can fight back / be targeted in melee. */
export function canFight(s: BSquad): boolean {
  return s.status === 'active' || s.status === 'asleep' || s.status === 'routing';
}

/** Squads of a side (helper for loops in tests and tools). */
export function squadsOf(state: BattleState, side: 0 | 1): BSquad[] {
  return state.squads.filter((s) => s.side === side);
}
