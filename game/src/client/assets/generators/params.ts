/**
 * Parameter readers for generators: tolerant (unknown or malformed values fall back to defaults, so
 * a typo in a manifest never crashes the client) but typed.
 */
import type { GeneratorParams } from '../types';
import { hash32 } from '../svg/rng';

/** A string param restricted to `allowed` (falls back to `fallback`). */
export function oneOf<T extends string>(p: GeneratorParams, key: string, allowed: readonly T[], fallback: T): T {
  const v = p[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** A string param. */
export function str(p: GeneratorParams, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

/** A finite number param (strings that parse are accepted), clamped to [lo, hi]. */
export function num(p: GeneratorParams, key: string, fallback: number, lo = -Infinity, hi = Infinity): number {
  const v = p[key];
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
}

/** A boolean param ("true"/"false" strings accepted). */
export function bool(p: GeneratorParams, key: string, fallback: boolean): boolean {
  const v = p[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

/** A list param: an array of strings, or a comma-separated string (manifest params are primitives). */
export function list(p: GeneratorParams, key: string): string[] {
  const v = p[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim() !== '') return v.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return [];
}

/** A numeric seed from `seed` (number or string); falls back to a hash of `fallbackKey`. */
export function seedOf(p: GeneratorParams, fallbackKey: string): number {
  const v = p.seed;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.abs(Math.floor(v)) >>> 0;
  if (typeof v === 'string' && v !== '') return hash32(v);
  return hash32(fallbackKey);
}
