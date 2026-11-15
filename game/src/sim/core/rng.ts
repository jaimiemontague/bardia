/**
 * Deterministic randomness for the simulation (design §29.3).
 *
 * - Generator: xoshiro128** (Blackman & Vigna), 4×uint32 state, period 2^128 − 1.
 * - Seeding: a string is hashed to two 32-bit values; splitmix32 expands them into the 4-word state.
 * - Named streams: each stream's state lives in `GameState.rng[streamName]` and is created lazily
 *   from `(campaign seed + '|' + stream name)`, so adding a stream never perturbs any other.
 *
 * Inside handlers, systems, effects, reactions, init and migrate use **`ctx.rng(stream)`**: it returns
 * an `Rng` backed by a per-operation cache that the kernel writes back to `state.rng` once at the
 * end of the operation (an Immer draft read + write per draw costs ~40× more). The functional API
 * (`rngFloat(state, 'weather')` …) mutates `state.rng` directly and is meant for plain mutable
 * objects (tools, world-gen scripts, tests); never mix it with `ctx.rng` for the same stream in one
 * operation (the kernel detects that and throws). Sub-simulations that run outside Immer (battle,
 * duel, sea battle) use the standalone `Rng` class seeded from a string.
 *
 * This is the ONLY source of randomness allowed in src/sim.
 */
import { dcos, dlog, PI } from './dmath';
import { assertSafeRecordKey } from './keys';

/** xoshiro128** state: four unsigned 32-bit integers. Never all zero. */
export type RngState = [number, number, number, number];

/** Minimal shape the functional stream API needs (GameState satisfies it). */
export interface RngHost {
  rng: Record<string, RngState>;
  meta: { seed: string };
}

const TWO_POW_32 = 4294967296;

/**
 * Everything a consumer needs to draw random values. Implemented by the `Rng` class (sub-sims and
 * `ctx.rng(stream)`) and by `hostStream(host, stream)` (the functional API on a plain object).
 */
export interface RandomSource {
  /** Next raw uint32. */
  u32(): number;
  /** Uniform float in [0, 1). */
  float(): number;
  /** Uniform integer in [lo, hiInclusive] (the range may hold at most 2^32 values). */
  int(lo: number, hiInclusive: number): number;
  /** True with probability p (always consumes one draw). */
  chance(p: number): boolean;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Weighted pick (one draw); undefined if no positive weight. */
  weighted<T>(items: readonly T[], weight: (item: T, index: number) => number): T | undefined;
  /** Shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Gumbel(0, temperature). */
  gumbel(temperature?: number): number;
  /** Normal(mean, sd) via Box–Muller (two draws). */
  normal(mean?: number, sd?: number): number;
}

/** Validates a stream name (non-empty, not an Object.prototype key such as '__proto__'). */
export function assertStreamName(stream: string): void {
  assertSafeRecordKey(stream, 'rng stream');
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * splitmix32 (the 32-bit SplitMix variant with Hash-Prospector constants 0x21f0aaad / 0x735a2d97).
 * Returns a generator of uint32 values. Used only to expand seeds.
 */
export function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** 32-bit string hash over UTF-16 code units (murmur-style mixing). Deterministic everywhere. */
export function hashString32(str: string, seed = 0): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  h ^= str.length;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Builds a xoshiro128** state from a seed string (two independent hashes → splitmix32). */
export function seedState(seed: string): RngState {
  const a = splitmix32(hashString32(seed, 0x2545f491));
  const b = splitmix32(hashString32(seed, 0x6c8e9cf5));
  const s: RngState = [a(), a(), a() ^ b(), a() ^ b()];
  for (let i = 0; i < 4; i++) s[i] = (s[i] as number) >>> 0;
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return s;
}

/**
 * Advances a xoshiro128** state in place and returns the next uint32.
 * Works on plain arrays and Immer draft arrays alike.
 */
export function xoshiroNext(s: number[]): number {
  const s0 = s[0] as number;
  const s1 = s[1] as number;
  const s2 = s[2] as number;
  const s3 = s[3] as number;
  const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  let n2 = s2 ^ s0;
  let n3 = s3 ^ s1;
  const n1 = s1 ^ n2;
  const n0 = s0 ^ n3;
  n2 ^= t;
  n3 = rotl(n3, 11);
  s[0] = n0 >>> 0;
  s[1] = n1 >>> 0;
  s[2] = n2 >>> 0;
  s[3] = n3 >>> 0;
  return result;
}

// ---------------------------------------------------------------------------------------------
// Distribution helpers shared by the stream API and the Rng class (all driven by a uint32 source).

type U32Source = () => number;

function toFloat(u: number): number {
  return u / TWO_POW_32;
}

/** Uniform in the open interval (0, 1). */
function toOpenFloat(u: number): number {
  return (u + 0.5) / TWO_POW_32;
}

function intFrom(src: U32Source, lo: number, hiInclusive: number): number {
  if (!Number.isInteger(lo) || !Number.isInteger(hiInclusive)) throw new RangeError(`rngInt: non-integer bounds ${lo}..${hiInclusive}`);
  if (hiInclusive < lo) throw new RangeError(`rngInt: hi ${hiInclusive} < lo ${lo}`);
  const n = hiInclusive - lo + 1;
  // One 32-bit draw reaches at most 2^32 distinct values; a wider range would silently be sparse.
  if (n > TWO_POW_32) throw new RangeError(`rngInt: range ${lo}..${hiInclusive} holds more than 2^32 values`);
  return lo + Math.floor(toFloat(src()) * n);
}

function pickFrom<T>(src: U32Source, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('rngPick: empty array');
  return items[Math.floor(toFloat(src()) * items.length)] as T;
}

function weightedFrom<T>(src: U32Source, items: readonly T[], weight: (item: T, index: number) => number): T | undefined {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const w = weight(items[i] as T, i);
    if (w > 0 && Number.isFinite(w)) total += w;
  }
  const roll = toFloat(src()) * total; // always consume exactly one draw
  if (total <= 0) return undefined;
  let acc = 0;
  let last: T | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const w = weight(item, i);
    if (!(w > 0 && Number.isFinite(w))) continue;
    acc += w;
    last = item;
    if (roll < acc) return item;
  }
  return last;
}

function shuffleFrom<T>(src: U32Source, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(toFloat(src()) * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function gumbelFrom(src: U32Source, temperature: number): number {
  return -temperature * dlog(-dlog(toOpenFloat(src())));
}

function normalFrom(src: U32Source, mean: number, sd: number): number {
  const u1 = toOpenFloat(src());
  const u2 = toFloat(src());
  return mean + sd * Math.sqrt(-2 * dlog(u1)) * dcos(2 * PI * u2);
}

// ---------------------------------------------------------------------------------------------
// Named-stream API operating on GameState (mutable / Immer draft).

/** The initial state of a named stream for a campaign seed (hash of `seed + '|' + stream`). */
export function streamSeedState(campaignSeed: string, stream: string): RngState {
  return seedState(`${campaignSeed}|${stream}`);
}

/**
 * Returns (creating lazily) the state array of a named stream. Existence is an own-property check,
 * so names such as 'toString' get their own stream; '__proto__', 'constructor' and 'prototype'
 * are rejected.
 */
export function streamState(host: RngHost, stream: string): number[] {
  assertStreamName(stream);
  if (!Object.hasOwn(host.rng, stream)) host.rng[stream] = streamSeedState(host.meta.seed, stream);
  return host.rng[stream] as RngState;
}

/**
 * A RandomSource view of one named stream of a plain mutable host (the functional API underneath).
 * Inside kernel operations (handlers, systems, …) use `ctx.rng(stream)` instead.
 */
export function hostStream(host: RngHost, stream: string): RandomSource {
  assertStreamName(stream);
  const src: U32Source = () => xoshiroNext(streamState(host, stream));
  return {
    u32: src,
    float: () => toFloat(src()),
    int: (lo, hi) => intFrom(src, lo, hi),
    chance: (p) => toFloat(src()) < p,
    range: (lo, hi) => lo + (hi - lo) * toFloat(src()),
    pick: (items) => pickFrom(src, items),
    weighted: (items, weight) => weightedFrom(src, items, weight),
    shuffle: (items) => shuffleFrom(src, items),
    gumbel: (temperature = 1) => gumbelFrom(src, temperature),
    normal: (mean = 0, sd = 1) => normalFrom(src, mean, sd),
  };
}

/** Next raw uint32 from a stream. */
export function rngU32(host: RngHost, stream: string): number {
  return xoshiroNext(streamState(host, stream));
}

/** Uniform float in [0, 1). */
export function rngFloat(host: RngHost, stream: string): number {
  return toFloat(rngU32(host, stream));
}

/** Uniform integer in [lo, hiInclusive]. */
export function rngInt(host: RngHost, stream: string, lo: number, hiInclusive: number): number {
  return intFrom(() => rngU32(host, stream), lo, hiInclusive);
}

/** True with probability p (always consumes one draw). */
export function rngChance(host: RngHost, stream: string, p: number): boolean {
  return rngFloat(host, stream) < p;
}

/** Uniform pick from a non-empty array. */
export function rngPick<T>(host: RngHost, stream: string, items: readonly T[]): T {
  return pickFrom(() => rngU32(host, stream), items);
}

/** Weighted pick; non-positive weights are skipped; undefined if no positive weight. One draw. */
export function rngWeighted<T>(
  host: RngHost,
  stream: string,
  items: readonly T[],
  weight: (item: T, index: number) => number,
): T | undefined {
  return weightedFrom(() => rngU32(host, stream), items, weight);
}

/** Returns a shuffled copy (Fisher–Yates). */
export function rngShuffle<T>(host: RngHost, stream: string, items: readonly T[]): T[] {
  return shuffleFrom(() => rngU32(host, stream), items);
}

/** Gumbel(0, temperature) noise — used for AI utility noise (§31.18). */
export function rngGumbel(host: RngHost, stream: string, temperature = 1): number {
  return gumbelFrom(() => rngU32(host, stream), temperature);
}

/** Normal(mean, sd) via Box–Muller (two draws). */
export function rngNormal(host: RngHost, stream: string, mean = 0, sd = 1): number {
  return normalFrom(() => rngU32(host, stream), mean, sd);
}

/** An 16-hex-char seed string drawn from a stream, for seeding a sub-simulation `Rng`. */
export function rngSeedString(host: RngHost, stream: string): string {
  return seedStringFrom(hostStream(host, stream));
}

/** A 16-hex-char seed string drawn from any RandomSource (e.g. `seedStringFrom(ctx.rng('battle'))`). */
export function seedStringFrom(source: RandomSource): string {
  const a = source.u32().toString(16).padStart(8, '0');
  const b = source.u32().toString(16).padStart(8, '0');
  return a + b;
}

// ---------------------------------------------------------------------------------------------
// Standalone generator for sub-simulations (battle 20 Hz, duel 60 Hz, sea battle) outside Immer.

/** Seedable, serializable xoshiro128** generator. */
export class Rng implements RandomSource {
  private readonly s: RngState;

  /** `seed` is a string (hashed) or a saved state. */
  constructor(seed: string | RngState) {
    this.s = typeof seed === 'string' ? seedState(seed) : ([...seed] as RngState);
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  /** A child generator for a named sub-stream (does not consume from this generator). */
  static derive(seed: string, name: string): Rng {
    return new Rng(`${seed}|${name}`);
  }

  /** Copy of the internal state (JSON-serializable). */
  getState(): RngState {
    return [...this.s] as RngState;
  }

  /** Restores a state previously returned by getState(). */
  setState(state: RngState): void {
    for (let i = 0; i < 4; i++) this.s[i] = (state[i] as number) >>> 0;
  }

  private readonly src: U32Source = () => xoshiroNext(this.s);

  u32(): number {
    return this.src();
  }
  float(): number {
    return toFloat(this.src());
  }
  int(lo: number, hiInclusive: number): number {
    return intFrom(this.src, lo, hiInclusive);
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }
  pick<T>(items: readonly T[]): T {
    return pickFrom(this.src, items);
  }
  weighted<T>(items: readonly T[], weight: (item: T, index: number) => number): T | undefined {
    return weightedFrom(this.src, items, weight);
  }
  shuffle<T>(items: readonly T[]): T[] {
    return shuffleFrom(this.src, items);
  }
  gumbel(temperature = 1): number {
    return gumbelFrom(this.src, temperature);
  }
  normal(mean = 0, sd = 1): number {
    return normalFrom(this.src, mean, sd);
  }
}
