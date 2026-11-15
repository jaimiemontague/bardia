/**
 * Original procedural art for things that move on the chart (owner play-test 2026-11-14: "it was just a
 * triangle"): the player's longship (a clinker hull with a carved prow, a striped square sail, a row of shields along
 * the rail, oars out when the crews row), a smaller plain-sailed ship for other houses, a wake, and a banner-bearer
 * for a war-band ashore.
 *
 * The art is built as plain shape lists in screen pixels (pure, unit tested) and drawn onto a Pixi Graphics by
 * `paintShapes`. Ships are drawn side-on, the way a chart-maker would draw them: the hull faces east or west by the
 * heading (with a little hysteresis so a ship sailing due north does not flicker) and tilts up to 30° towards it.
 */
import type { Graphics } from 'pixi.js';
import { CHART } from './colors';
import type { Vec2 } from './types';

/** A drawable primitive in screen pixels. */
export type Shape =
  | { kind: 'poly'; pts: number[]; fill?: number; fillAlpha?: number; stroke?: number; width?: number; alpha?: number }
  | { kind: 'line'; pts: number[]; color: number; width: number; alpha?: number }
  | { kind: 'circle'; x: number; y: number; r: number; fill?: number; stroke?: number; width?: number; alpha?: number };

/** How a side-on ship is laid on the chart: facing (+1 east, −1 west) and tilt (radians, ±30° at most). */
export interface ShipPose {
  facing: 1 | -1;
  rotation: number;
}

const MAX_TILT = Math.PI / 6;

/**
 * The pose for a compass bearing (0 = north, 90 = east; null = keep the previous facing, level). `prevFacing` gives
 * hysteresis: a heading within ~12° of due north or south keeps the facing it had.
 */
export function shipPose(headingDeg: number | null, prevFacing: 1 | -1 = 1): ShipPose {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return { facing: prevFacing, rotation: 0 };
  const b = (headingDeg * Math.PI) / 180;
  const vx = Math.sin(b);
  const vy = -Math.cos(b);
  const facing: 1 | -1 = Math.abs(vx) > 0.2 ? (vx > 0 ? 1 : -1) : prevFacing;
  const raw = facing === 1 ? Math.atan2(vy, Math.abs(vx)) : Math.atan2(-vy, Math.abs(vx));
  return { facing, rotation: Math.max(-MAX_TILT, Math.min(MAX_TILT, raw)) };
}

/** Maps ship-local units (u along the hull towards the bow, v downwards; 1 = hull length) to screen pixels. */
function placer(x: number, y: number, length: number, pose: ShipPose): (u: number, v: number) => [number, number] {
  const c = Math.cos(pose.rotation);
  const s = Math.sin(pose.rotation);
  return (u, v) => {
    const uu = u * pose.facing * length;
    const vv = v * length;
    return [x + uu * c - vv * s, y + uu * s + vv * c];
  };
}

function path(P: (u: number, v: number) => [number, number], pts: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (const [u, v] of pts) out.push(...P(u, v));
  return out;
}

/** Sheer line (top of the rail): rises towards the ends. */
const sheer = (u: number) => -0.05 - 0.1 * (u / 0.45) ** 4;
/** Keel line. */
const keel = (u: number) => 0.1 * (1 - (u / 0.47) ** 2);

function samples(from: number, to: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}

/** The hull outline (ship-local): stern post, keel, the carved prow with its head, then back along the rail. */
function hullOutline(prow: boolean): [number, number][] {
  const pts: [number, number][] = [
    [-0.46, -0.37],
    [-0.52, -0.33],
    [-0.53, -0.25],
    [-0.5, -0.13],
    [-0.46, -0.02],
  ];
  for (const u of samples(-0.42, 0.42, 10)) pts.push([u, keel(u)]);
  pts.push([0.46, -0.02], [0.5, -0.13], [0.53, -0.25]);
  if (prow) pts.push([0.55, -0.33], [0.61, -0.37], [0.6, -0.41], [0.54, -0.42], [0.5, -0.38]);
  else pts.push([0.54, -0.33], [0.5, -0.36]);
  pts.push([0.48, -0.28], [0.45, -0.16]);
  for (const u of samples(0.42, -0.42, 10)) pts.push([u, sheer(u)]);
  pts.push([-0.45, -0.16], [-0.47, -0.28], [-0.45, -0.34]);
  return pts;
}

/** The square sail between the yard and the rail, billowing towards the bow, cut into vertical stripes. */
function sailStripes(P: (u: number, v: number) => [number, number], stripes: number, colors: readonly number[]): Shape[] {
  const top = -0.75;
  const foot = -0.22;
  const left = -0.23;
  const right = 0.23;
  const belly = 0.05;
  // Points along the top edge (straight under the yard) and the foot (bellied forward).
  const at = (t: number, v: number): [number, number] => {
    const k = (v - top) / (foot - top);
    return [left + (right - left) * t + belly * Math.sin(Math.PI * k) * (0.6 + 0.4 * t), v];
  };
  const out: Shape[] = [];
  for (let i = 0; i < stripes; i++) {
    const t0 = i / stripes;
    const t1 = (i + 1) / stripes;
    const edge: [number, number][] = [];
    for (const v of samples(top, foot, 6)) edge.push(at(t1, v));
    for (const v of samples(foot, top, 6)) edge.push(at(t0, v));
    out.push({ kind: 'poly', pts: path(P, edge), fill: colors[i % colors.length] as number });
  }
  const outline: [number, number][] = [];
  for (const v of samples(top, foot, 6)) outline.push(at(1, v));
  for (const v of samples(foot, top, 6)) outline.push(at(0, v));
  out.push({ kind: 'poly', pts: path(P, outline), stroke: CHART.ink, width: 1.1, alpha: 0.9 });
  return out;
}

export interface LongshipOptions {
  /** Hull length in screen pixels. */
  length: number;
  pose: ShipPose;
  /** House colour (shields, the sail's accent). */
  color: number;
  /** The crews row: oars out (animated by `phase`). */
  rowing: boolean;
  /** 0…1 animation phase (oar stroke). */
  phase: number;
}

/** The player's longship, centred on (x, y). */
export function longshipShapes(x: number, y: number, o: LongshipOptions): Shape[] {
  const L = o.length;
  const P = placer(x, y + L * 0.18, L, o.pose);
  const ink = CHART.ink;
  const out: Shape[] = [];
  const line = Math.max(1, L * 0.022);
  // Oars behind the hull.
  if (o.rowing) {
    const sweep = Math.sin(o.phase * Math.PI * 2) * 0.05;
    for (const u of samples(-0.3, 0.3, 6)) out.push({ kind: 'line', pts: path(P, [[u, -0.04], [u - 0.1 + sweep, 0.25]]), color: 0x6b4a2b, width: Math.max(1, L * 0.018) });
  }
  // Mast and yard.
  out.push({ kind: 'line', pts: path(P, [[0, -0.04], [0, -0.83]]), color: 0x4a3018, width: Math.max(1.4, L * 0.03) });
  out.push({ kind: 'line', pts: path(P, [[-0.26, -0.76], [0.26, -0.76]]), color: 0x4a3018, width: Math.max(1.2, L * 0.024) });
  // The striped sail: deep red and cream, the house colour at the edge.
  out.push(...sailStripes(P, 5, [0xa8261c, 0xf0e4c6]));
  // Hull, a lighter strake and the shields along the rail.
  out.push({ kind: 'poly', pts: path(P, hullOutline(true)), fill: 0x6a4424, stroke: ink, width: line });
  out.push({ kind: 'line', pts: path(P, samples(-0.4, 0.4, 8).map((u) => [u, (sheer(u) + keel(u)) / 2 + 0.01] as [number, number])), color: 0x9a6b3c, width: Math.max(1, L * 0.02) });
  const shieldColors = [o.color, 0xf0e4c6, 0xc89b3c];
  samples(-0.3, 0.3, 6).forEach((u, i) => {
    const [cx, cy] = P(u, -0.06);
    out.push({ kind: 'circle', x: cx, y: cy, r: Math.max(1.6, L * 0.042), fill: shieldColors[i % 3] as number, stroke: ink, width: Math.max(0.8, L * 0.012) });
  });
  // The prow's eye.
  const [ex, ey] = P(0.565, -0.385);
  out.push({ kind: 'circle', x: ex, y: ey, r: Math.max(0.8, L * 0.012), fill: 0xf0e4c6 });
  return out;
}

/** A smaller ship of another house: a plain hull and a sail in the house colour. */
export function smallShipShapes(x: number, y: number, length: number, pose: ShipPose, color: number): Shape[] {
  const L = length;
  const P = placer(x, y + L * 0.18, L, pose);
  return [
    { kind: 'line', pts: path(P, [[0, -0.04], [0, -0.8]]), color: 0x4a3018, width: Math.max(1.2, L * 0.035) },
    ...sailStripes(P, 3, [color, 0xf0e4c6, color]),
    { kind: 'poly', pts: path(P, hullOutline(false)), fill: 0x5c3d22, stroke: CHART.ink, width: Math.max(1, L * 0.03) },
  ];
}

/** The wake: two spreading lines behind the stern along the true direction of travel (screen vector), fading. */
export function wakeShapes(x: number, y: number, length: number, dir: Vec2, strength: number): Shape[] {
  const n = Math.hypot(dir[0], dir[1]);
  if (n < 1e-6 || strength <= 0) return [];
  const bx = -dir[0] / n;
  const by = -dir[1] / n;
  const px = -by;
  const py = bx;
  const start = length * 0.35;
  const reach = length * (0.45 + 0.4 * Math.min(1, strength));
  const out: Shape[] = [];
  for (const side of [1, -1]) {
    const pts: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      const d = start + reach * k;
      // A gently curving V that opens behind the stern.
      const spread = length * (0.07 + 0.26 * Math.sqrt(k)) * side;
      pts.push(x + bx * d + px * spread, y + length * 0.12 + by * d + py * spread);
    }
    out.push({ kind: 'line', pts, color: 0xf6f8f4, width: Math.max(1.2, length * 0.03), alpha: 0.6 * Math.min(1, strength) });
  }
  const mid: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const d = start + reach * 0.7 * (i / 4);
    mid.push(x + bx * d, y + length * 0.12 + by * d);
  }
  out.push({ kind: 'line', pts: mid, color: 0xdfe9ea, width: Math.max(1, length * 0.025), alpha: 0.45 * Math.min(1, strength) });
  return out;
}

/** A banner-bearer for a war-band ashore, standing on (x, y) (feet), `height` pixels tall. */
export function bannerBearerShapes(x: number, y: number, height: number, color: number, facing: 1 | -1, step: number): Shape[] {
  const H = height;
  const f = facing;
  const bob = Math.sin(step * Math.PI * 2) * H * 0.03;
  const P = (u: number, v: number): [number, number] => [x + u * H * f, y - v * H + bob];
  const ink = CHART.ink;
  const out: Shape[] = [];
  // Two warriors behind (darker silhouettes with spear points).
  for (const [du, s] of [[-0.42, 0.78], [-0.24, 0.86]] as const) {
    const Q = (u: number, v: number): [number, number] => P(du + u * s, v * s);
    out.push({ kind: 'poly', pts: [...Q(-0.1, 0.0), ...Q(0.1, 0.0), ...Q(0.08, 0.5), ...Q(-0.08, 0.5)], fill: 0x4a3a2a, stroke: ink, width: 1 });
    const [hx, hy] = Q(0, 0.6);
    out.push({ kind: 'circle', x: hx, y: hy, r: H * 0.08 * s, fill: 0x4a3a2a, stroke: ink, width: 1 });
    out.push({ kind: 'line', pts: [...Q(0.12, 0.1), ...Q(0.18, 1.0)], color: 0x3a2a1a, width: Math.max(1, H * 0.03) });
    out.push({ kind: 'poly', pts: [...Q(0.15, 0.98), ...Q(0.21, 0.98), ...Q(0.18, 1.1)], fill: 0xb8b8b0, stroke: ink, width: 0.8 });
  }
  // The bearer: legs, tunic in the house colour, belt, head, round shield, banner pole and flag.
  out.push({ kind: 'line', pts: [...P(-0.05, 0.0), ...P(-0.03, 0.22)], color: ink, width: Math.max(1.4, H * 0.05) });
  out.push({ kind: 'line', pts: [...P(0.07, 0.0), ...P(0.04, 0.22)], color: ink, width: Math.max(1.4, H * 0.05) });
  out.push({ kind: 'poly', pts: [...P(-0.13, 0.2), ...P(0.13, 0.2), ...P(0.09, 0.58), ...P(-0.09, 0.58)], fill: color, stroke: ink, width: 1.2 });
  out.push({ kind: 'line', pts: [...P(-0.11, 0.33), ...P(0.11, 0.33)], color: 0x3a2a1a, width: Math.max(1, H * 0.035) });
  const [hx, hy] = P(0, 0.68);
  out.push({ kind: 'circle', x: hx, y: hy, r: H * 0.1, fill: 0xe2c7a3, stroke: ink, width: 1.1 });
  out.push({ kind: 'poly', pts: [...P(-0.1, 0.71), ...P(0.1, 0.71), ...P(0.0, 0.84)], fill: 0x8a8a84, stroke: ink, width: 1 });
  const [sx, sy] = P(-0.15, 0.4);
  out.push({ kind: 'circle', x: sx, y: sy, r: H * 0.14, fill: 0xc89b3c, stroke: ink, width: 1.2 });
  out.push({ kind: 'circle', x: sx, y: sy, r: H * 0.04, fill: 0x6b6b66 });
  out.push({ kind: 'line', pts: [...P(0.16, 0.05), ...P(0.18, 1.18)], color: 0x4a3018, width: Math.max(1.4, H * 0.045) });
  out.push({
    kind: 'poly',
    pts: [...P(0.19, 1.16), ...P(0.58, 1.12), ...P(0.5, 0.98), ...P(0.58, 0.84), ...P(0.19, 0.86)],
    fill: color,
    stroke: ink,
    width: 1.2,
  });
  out.push({ kind: 'circle', x: P(0.36, 1.0)[0], y: P(0.36, 1.0)[1], r: H * 0.05, fill: 0xf0e4c6 });
  return out;
}

/** Draws shapes onto a Pixi Graphics. */
export function paintShapes(g: Graphics, shapes: readonly Shape[]): void {
  for (const s of shapes) {
    if (s.kind === 'circle') {
      g.circle(s.x, s.y, s.r);
      if (s.fill !== undefined) g.fill({ color: s.fill, alpha: s.alpha ?? 1 });
      if (s.stroke !== undefined) g.stroke({ width: s.width ?? 1, color: s.stroke, alpha: s.alpha ?? 1 });
      continue;
    }
    if (s.pts.length < 4) continue;
    g.moveTo(s.pts[0] as number, s.pts[1] as number);
    for (let i = 2; i < s.pts.length; i += 2) g.lineTo(s.pts[i] as number, s.pts[i + 1] as number);
    if (s.kind === 'line') {
      g.stroke({ width: s.width, color: s.color, alpha: s.alpha ?? 1, cap: 'round', join: 'round' });
      continue;
    }
    g.closePath();
    if (s.fill !== undefined) g.fill({ color: s.fill, alpha: s.fillAlpha ?? s.alpha ?? 1 });
    if (s.stroke !== undefined) g.stroke({ width: s.width ?? 1, color: s.stroke, alpha: s.alpha ?? 1, join: 'round' });
  }
}

/** On-screen hull length of the player's ship at a camera scale (pixels per cell): ≥ 34 px, larger zoomed in. */
export function shipLength(scale: number): number {
  return Math.max(34, Math.min(96, 3.6 * scale + 22));
}
