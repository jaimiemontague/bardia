/**
 * Deterministic hashing and value noise for the map build (no transcendental functions, no Math.random):
 * integer lattice hashes mixed with Math.imul, smoothstep interpolation and fractal Brownian motion (fBm).
 */
import type { NoiseSpec } from '@content/world';

/** FNV-1a 32-bit hash of a string (stable seeds from ids). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A well-mixed uint32 hash of an integer lattice point and a seed. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const INV_U32 = 1 / 4294967296;

/** Value noise in [0, 1): bilinear interpolation (smoothstep weights) of lattice hashes. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed) * INV_U32;
  const b = hash2(xi + 1, yi, seed) * INV_U32;
  const c = hash2(xi, yi + 1, seed) * INV_U32;
  const d = hash2(xi + 1, yi + 1, seed) * INV_U32;
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/**
 * Fractal Brownian motion in [0, 1): `octaves` layers of value noise, each at double the frequency and
 * `persistence` times the amplitude of the previous one, normalised by the total amplitude. `wavelength` is the
 * base feature size in cells.
 */
export function fbm(x: number, y: number, seed: number, wavelength: number, octaves: number, persistence: number): number {
  let freq = 1 / wavelength;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, (seed + Math.imul(o, 0x9e3779b1)) | 0);
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return sum / norm;
}

/** Signed fBm in [-1, 1) (centred), used for warp vectors. */
export function fbmSigned(x: number, y: number, seed: number, spec: NoiseSpec): number {
  return fbm(x, y, seed, spec.wavelength, spec.octaves, spec.persistence) * 2 - 1;
}

/** Derives a sub-seed from a seed and a label. */
export function subSeed(seed: number, label: string): number {
  return hash2(hashString(label), 0x5bd1e995, seed);
}
