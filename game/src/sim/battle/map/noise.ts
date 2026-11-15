/**
 * Deterministic value noise for map generation (integer hashing only; no engine-dependent math).
 */
import { hashString32 } from '@sim/core/rng';

/** 32-bit integer hash of a lattice point. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function lattice(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0, 1) at (x, y) with lattice spacing `cell`. */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const a = lattice(x0, y0, seed);
  const b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed);
  const d = lattice(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** Fractal value noise: `octaves` layers halving the cell and the amplitude, normalised to [0, 1). */
export function fbm(x: number, y: number, cell: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let c = cell;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, c, (seed + Math.imul(o, 0x9e3779b9)) | 0);
    norm += amp;
    amp *= 0.5;
    c = Math.max(1, c / 2);
  }
  return sum / norm;
}

/** A noise field over a w×h grid. */
export function noiseField(w: number, h: number, cell: number, octaves: number, seed: string): Float32Array {
  const s = hashString32(seed) | 0;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = fbm(x, y, cell, octaves, s);
  return out;
}

/** The value below which `share` of the (masked) entries lie (exact quantile by sorting a copy). */
export function quantile(values: Float32Array, share: number, mask?: (i: number) => boolean): number {
  const picked: number[] = [];
  for (let i = 0; i < values.length; i++) if (!mask || mask(i)) picked.push(values[i]!);
  if (picked.length === 0) return 0;
  picked.sort((a, b) => a - b);
  const k = Math.min(picked.length - 1, Math.max(0, Math.floor(share * picked.length)));
  return picked[k]!;
}
