import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Rng,
  hashString32,
  rngChance,
  rngFloat,
  rngGumbel,
  rngInt,
  rngNormal,
  rngPick,
  rngSeedString,
  rngShuffle,
  rngU32,
  rngWeighted,
  hostStream,
  seedStringFrom,
  seedState,
  splitmix32,
  xoshiroNext,
  type RngHost,
} from './rng';

function host(seed = 'seed'): RngHost {
  return { rng: {}, meta: { seed } };
}

/** Independent BigInt implementation of xoshiro128** used as a cross-check. */
function xoshiroBig(state: number[], n: number): number[] {
  const M = (1n << 32n) - 1n;
  const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & M;
  let s = state.map(BigInt);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [s0, s1, s2, s3] = s as [bigint, bigint, bigint, bigint];
    out.push(Number((rotl((s1 * 5n) & M, 7n) * 9n) & M));
    const t = (s1 << 9n) & M;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    s = [s0 ^ n3, s1 ^ n2, n2 ^ t, rotl(n3, 11n)];
  }
  return out;
}

/** Independent BigInt implementation of splitmix32. */
function splitmixBig(seed: number, n: number): number[] {
  const M = (1n << 32n) - 1n;
  let a = BigInt(seed >>> 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    a = (a + 0x9e3779b9n) & M;
    let t = a ^ (a >> 16n);
    t = (t * 0x21f0aaadn) & M;
    t ^= t >> 15n;
    t = (t * 0x735a2d97n) & M;
    t ^= t >> 15n;
    out.push(Number(t));
  }
  return out;
}

describe('xoshiro128** reference vectors', () => {
  it('matches the reference implementation output for state [1,2,3,4]', () => {
    // Published values produced with Vigna's xoshiro128starstar.c (also used by rand_xoshiro's test).
    const expected = [11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804];
    const s = [1, 2, 3, 4];
    expect(Array.from({ length: 10 }, () => xoshiroNext(s))).toEqual(expected);
  });

  it('agrees with an independent BigInt implementation on random states', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 0xffffffff }), { minLength: 4, maxLength: 4 }), (state) => {
        const s = [...state];
        const ours = Array.from({ length: 16 }, () => xoshiroNext(s));
        expect(ours).toEqual(xoshiroBig(state, 16));
      }),
      { numRuns: 50 },
    );
  });

  it('splitmix32 agrees with an independent BigInt implementation and pinned outputs', () => {
    const sm = splitmix32(0);
    expect([sm(), sm(), sm()]).toEqual([1684164658, 3653269916, 2939563536]);
    for (const seed of [1, 42, 0xdeadbeef, 0x7fffffff]) {
      const g = splitmix32(seed);
      expect(Array.from({ length: 8 }, () => g())).toEqual(splitmixBig(seed, 8));
    }
  });
});

describe('seeding', () => {
  it('is deterministic and produces uint32 non-zero states', () => {
    expect(seedState('bardia|weather')).toEqual(seedState('bardia|weather'));
    expect(seedState('bardia|weather')).toEqual([3535913559, 1445035660, 163813754, 870973198]);
    const s = seedState('');
    expect(s.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffffffff)).toBe(true);
    expect(s.some((w) => w !== 0)).toBe(true);
  });

  it('different strings give different states', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(seedState(`seed|stream${i}`).join(','));
    expect(seen.size).toBe(2000);
    expect(hashString32('a')).not.toBe(hashString32('b'));
  });
});

describe('named streams', () => {
  it('same seed + same draws → same values', () => {
    const a = host('campaign');
    const b = host('campaign');
    const va = Array.from({ length: 50 }, () => rngU32(a, 'weather'));
    const vb = Array.from({ length: 50 }, () => rngU32(b, 'weather'));
    expect(va).toEqual(vb);
    expect(a.rng).toEqual(b.rng);
  });

  it('streams are isolated: drawing from one never perturbs another', () => {
    const a = host('campaign');
    const b = host('campaign');
    for (let i = 0; i < 100; i++) rngFloat(a, 'ai:fac_3');
    rngFloat(a, 'newStream');
    const va = Array.from({ length: 20 }, () => rngU32(a, 'weather'));
    const vb = Array.from({ length: 20 }, () => rngU32(b, 'weather'));
    expect(va).toEqual(vb);
  });

  it('streams are created lazily from seed + name', () => {
    const h = host('x');
    expect(Object.keys(h.rng)).toEqual([]);
    rngU32(h, 'names');
    expect(Object.keys(h.rng)).toEqual(['names']);
    const fresh = seedState('x|names');
    expect(rngU32(host('x'), 'names')).toBe(xoshiroNext([...fresh]));
  });

  it('different campaign seeds give different sequences', () => {
    expect(rngU32(host('a'), 'w')).not.toBe(rngU32(host('b'), 'w'));
  });
});

describe('distributions', () => {
  it('rngFloat is in [0,1) with mean ~0.5', () => {
    const h = host();
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = rngFloat(h, 's');
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.01);
  });

  it('rngInt covers [lo, hi] roughly uniformly (chi-square sanity)', () => {
    const h = host();
    const counts = new Array(6).fill(0) as number[];
    const N = 60000;
    for (let i = 0; i < N; i++) {
      const v = rngInt(h, 'dice', 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      counts[v - 1]!++;
    }
    const expected = N / 6;
    const chi2 = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(20.5); // p ≈ 0.001 for 5 dof
    expect(() => rngInt(h, 'dice', 3, 2)).toThrow();
    expect(() => rngInt(h, 'dice', 0.5, 2)).toThrow();
    expect(rngInt(h, 'dice', 7, 7)).toBe(7);
  });

  it('rngChance matches p', () => {
    const h = host();
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rngChance(h, 'c', 0.3)) hits++;
    expect(Math.abs(hits / 20000 - 0.3)).toBeLessThan(0.015);
    expect(rngChance(h, 'c', 0)).toBe(false);
    expect(rngChance(h, 'c', 1)).toBe(true);
  });

  it('rngWeighted follows weights and skips non-positive ones', () => {
    const h = host();
    const items = ['a', 'b', 'c', 'never'];
    const w: Record<string, number> = { a: 1, b: 3, c: 0, never: -5 };
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, never: 0 };
    for (let i = 0; i < 20000; i++) counts[rngWeighted(h, 'w', items, (x) => w[x] ?? 0)!]!++;
    expect(counts.c).toBe(0);
    expect(counts.never).toBe(0);
    expect(Math.abs((counts.b ?? 0) / 20000 - 0.75)).toBeLessThan(0.02);
    expect(rngWeighted(h, 'w', items, () => 0)).toBeUndefined();
  });

  it('rngPick / rngShuffle', () => {
    const h = host();
    expect(['x', 'y']).toContain(rngPick(h, 'p', ['x', 'y']));
    expect(() => rngPick(h, 'p', [])).toThrow();
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const shuffled = rngShuffle(h, 'p', arr);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
    expect(shuffled).not.toEqual(arr);
    expect(arr[0]).toBe(0); // input untouched
  });

  it('rngNormal has mean ~0 and sd ~1; rngGumbel has mean ~γ·T', () => {
    const h = host();
    const N = 20000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      const v = rngNormal(h, 'n');
      s += v;
      s2 += v * v;
    }
    const mean = s / N;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(Math.sqrt(s2 / N - mean * mean) - 1)).toBeLessThan(0.03);
    let g = 0;
    for (let i = 0; i < N; i++) g += rngGumbel(h, 'g', 0.4);
    expect(Math.abs(g / N - 0.5772156649 * 0.4)).toBeLessThan(0.02);
    expect(rngNormal(h, 'n', 10, 0)).toBe(10);
  });

  it('rngSeedString is 16 hex chars and deterministic', () => {
    expect(rngSeedString(host('q'), 'battle')).toMatch(/^[0-9a-f]{16}$/);
    expect(rngSeedString(host('q'), 'battle')).toBe(rngSeedString(host('q'), 'battle'));
  });
});

describe('stream names and ranges', () => {
  it('Object.prototype member names get their own, saved streams', () => {
    const h = host('x');
    const a = rngU32(h, 'toString');
    const b = rngU32(h, 'toString');
    expect(a).not.toBe(b);
    expect(Object.keys(h.rng)).toEqual(['toString']);
    expect(rngU32(host('x'), 'hasOwnProperty')).not.toBe(0);
  });

  it('reserved names are rejected without touching Object.prototype', () => {
    for (const name of ['__proto__', 'constructor', 'prototype', '']) expect(() => rngU32(host(), name)).toThrow(RangeError);
    expect(({} as Record<number, unknown>)[0]).toBeUndefined();
    expect(([] as unknown[])[2]).toBeUndefined();
  });

  it('rngInt refuses ranges with more than 2^32 values instead of returning a sparse subset', () => {
    const h = host();
    expect(() => rngInt(h, 'wide', 0, 2 ** 32)).toThrow('more than 2^32 values');
    expect(rngInt(h, 'wide', 0, 2 ** 32 - 1)).toBeGreaterThanOrEqual(0);
    expect(() => new Rng('w').int(-(2 ** 40), 2 ** 40)).toThrow(RangeError);
  });

  it('hostStream and Rng implement the same RandomSource sequence', () => {
    const src = hostStream(host('camp'), 'weather');
    const r = new Rng('camp|weather');
    expect([src.u32(), src.float(), src.int(1, 6), src.pick(['a', 'b', 'c'])]).toEqual([r.u32(), r.float(), r.int(1, 6), r.pick(['a', 'b', 'c'])]);
    expect(seedStringFrom(new Rng('q|battle'))).toBe(rngSeedString(host('q'), 'battle'));
  });
});

describe('Rng class (sub-simulations)', () => {
  it('is deterministic from a string seed and serializable', () => {
    const a = new Rng('battle-1');
    const b = new Rng('battle-1');
    expect(Array.from({ length: 10 }, () => a.u32())).toEqual(Array.from({ length: 10 }, () => b.u32()));
    const saved = a.getState();
    const next = [a.float(), a.int(1, 100), a.chance(0.5), a.normal(), a.gumbel()];
    const c = new Rng(saved);
    expect([c.float(), c.int(1, 100), c.chance(0.5), c.normal(), c.gumbel()]).toEqual(next);
    const d = new Rng('other');
    d.setState(saved);
    expect(d.float()).toBe(new Rng(saved).float());
  });

  it('matches the stream API for the same seed string', () => {
    const h = host('camp');
    const r = new Rng('camp|weather');
    expect(Array.from({ length: 5 }, () => rngU32(h, 'weather'))).toEqual(Array.from({ length: 5 }, () => r.u32()));
  });

  it('derive() creates independent child generators', () => {
    expect(Rng.derive('s', 'a').u32()).toBe(new Rng('s|a').u32());
    expect(Rng.derive('s', 'a').u32()).not.toBe(Rng.derive('s', 'b').u32());
    const r = new Rng('x');
    expect(r.pick([1, 2, 3])).toBeGreaterThan(0);
    expect(r.shuffle([1, 2, 3]).length).toBe(3);
    expect(r.weighted([1, 2], (v) => v)).toBeGreaterThan(0);
    const v = r.range(5, 6);
    expect(v >= 5 && v < 6).toBe(true);
  });
});
