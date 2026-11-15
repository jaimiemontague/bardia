/**
 * Small deterministic geometry helpers for the sea battle (compass angles, hull capsules).
 * Coordinates: x east, y south (metres). Compass angles: 0 = north, clockwise, in radians here.
 * Only dmath transcendental functions are used (bit-identical everywhere).
 */
import { datan2, dcos, dsin, PI, TWO_PI } from '@sim/core/dmath';

/** Radians per degree. */
export const DEG = PI / 180;

/** Wraps an angle to (−π, π]. */
export function wrapPi(a: number): number {
  let x = a % TWO_PI;
  if (x <= -PI) x += TWO_PI;
  else if (x > PI) x -= TWO_PI;
  return x;
}

/** Wraps an angle to [0, 2π). */
export function wrap2Pi(a: number): number {
  const x = a % TWO_PI;
  return x < 0 ? x + TWO_PI : x;
}

/** Unit vector x component of a compass heading (east). */
export function headingX(h: number): number {
  return dsin(h);
}

/** Unit vector y component of a compass heading (south-positive, so north is −1). */
export function headingY(h: number): number {
  return -dcos(h);
}

/** Compass bearing (radians, [0, 2π)) of the vector (dx, dy). */
export function bearingOf(dx: number, dy: number): number {
  return wrap2Pi(datan2(dx, -dy));
}

/**
 * Closest points between segments P0P1 and Q0Q1 (Ericson, Real-Time Collision Detection §5.1.9).
 * Writes [dist², px, py, qx, qy] into `out` (no allocation) and returns dist².
 */
export function segmentClosest(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  q0x: number,
  q0y: number,
  q1x: number,
  q1y: number,
  out: Float64Array,
): number {
  const d1x = p1x - p0x;
  const d1y = p1y - p0y;
  const d2x = q1x - q0x;
  const d2y = q1y - q0y;
  const rx = p0x - q0x;
  const ry = p0y - q0y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-12;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const px = p0x + d1x * s;
  const py = p0y + d1y * s;
  const qx = q0x + d2x * t;
  const qy = q0y + d2y * t;
  const dx = px - qx;
  const dy = py - qy;
  const d2 = dx * dx + dy * dy;
  out[0] = d2;
  out[1] = px;
  out[2] = py;
  out[3] = qx;
  out[4] = qy;
  return d2;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
