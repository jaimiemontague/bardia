/**
 * Seeded randomness for procedural placeholder art. Art generation must be deterministic (same
 * params → byte-identical SVG), so generators never use Math.random. Every visual feature draws from
 * its own named fork (`rng.fork('hair')`), so adding or changing one feature never perturbs another:
 * a character keeps the same face and hair colour as they age.
 */

/** 32-bit FNV-1a with a murmur3 finaliser: a well-mixed hash of a string. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A small, fast, seedable PRNG (mulberry32) with named sub-streams. */
export class ArtRng {
  private state: number;
  private readonly key: string;

  /** @param seed a number or any string; equal seeds give equal sequences. */
  constructor(seed: number | string) {
    this.key = typeof seed === 'number' ? `n${seed >>> 0}` : seed;
    this.state = hash32(this.key);
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** An integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A uniformly chosen element (throws on an empty list). */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('ArtRng.pick: empty list');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** A weighted choice from [item, weight] pairs (weights ≥ 0, at least one positive). */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += Math.max(0, w);
    if (total <= 0) throw new Error('ArtRng.weighted: no positive weight');
    let roll = this.next() * total;
    for (const [item, w] of entries) {
      roll -= Math.max(0, w);
      if (roll < 0) return item;
    }
    return (entries[entries.length - 1] as readonly [T, number])[0];
  }

  /** Symmetric jitter in [-amount, amount). */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** An independent stream derived from this stream's seed and a name (not from its position). */
  fork(name: string): ArtRng {
    return new ArtRng(`${this.key}|${name}`);
  }
}
