import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { clamp, datan, datan2, dcos, dexp, dexpm1, dhypot, dlog, dlog2, dpow, dsigmoid, dsin, dtanh, PI, twoOverPiFixedPoint } from './dmath';

const TOL = 1e-9;

function close(actual: number, expected: number, tol = TOL): void {
  if (Number.isNaN(expected)) {
    expect(actual).toBeNaN();
    return;
  }
  if (!Number.isFinite(expected)) {
    expect(actual).toBe(expected);
    return;
  }
  const err = Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  if (err > tol) throw new Error(`expected ${expected}, got ${actual} (rel err ${err})`);
}

function samples(seed: string, n: number, lo: number, hi: number): number[] {
  const r = new Rng(seed);
  return Array.from({ length: n }, () => r.range(lo, hi));
}

describe('dmath accuracy vs Math (within 1e-9)', () => {
  it('dexp', () => {
    for (const x of [...samples('exp', 3000, -700, 700), ...samples('exp-small', 2000, -5, 5), 0, 1, -1, 1e-12, -1e-12]) close(dexp(x), Math.exp(x));
    expect(dexp(710)).toBe(Infinity);
    expect(dexp(-746)).toBe(0);
    close(dexp(-740), Math.exp(-740));
    expect(dexp(NaN)).toBeNaN();
  });

  it('dexpm1', () => {
    for (const x of [...samples('expm1', 3000, -3, 3), 1e-10, -1e-10, 0.5]) close(dexpm1(x), Math.expm1(x));
  });

  it('dlog', () => {
    for (const x of [...samples('log', 3000, 1e-6, 1e6), ...samples('log1', 2000, 0.5, 2), 1, 2, 10, 1e-300, 1e300, 5e-324, 1.7976931348623157e308])
      close(dlog(x), Math.log(x));
    expect(dlog(0)).toBe(-Infinity);
    expect(dlog(-1)).toBeNaN();
    expect(dlog(Infinity)).toBe(Infinity);
    close(dlog2(8), 3);
    close(dlog2(1024), 10);
  });

  it('dpow', () => {
    const r = new Rng('pow');
    for (let i = 0; i < 3000; i++) {
      const x = r.range(0.01, 50);
      const y = r.range(-10, 10);
      close(dpow(x, y), Math.pow(x, y));
    }
    for (let k = -20; k <= 20; k++) expect(dpow(2, k)).toBe(Math.pow(2, k)); // exact for small integer exponents
    expect(dpow(-2, 3)).toBe(-8);
    close(dpow(-2, 65), Math.pow(-2, 65));
    expect(dpow(-2, 0.5)).toBeNaN();
    expect(dpow(0, 2.5)).toBe(0);
    expect(dpow(0, -1.5)).toBe(Infinity);
    expect(dpow(5, 0)).toBe(1);
    close(dpow(1.3, 2.2), Math.pow(1.3, 2.2));
  });

  it('dsin / dcos', () => {
    for (const x of [...samples('trig', 4000, -1000, 1000), ...samples('trig-small', 2000, -7, 7), 0, PI, PI / 2, -PI / 2, 1e-12, 1e5]) {
      close(dsin(x), Math.sin(x));
      close(dcos(x), Math.cos(x));
    }
    expect(dsin(Infinity)).toBeNaN();
    expect(dcos(NaN)).toBeNaN();
  });

  it('datan / datan2', () => {
    for (const x of [...samples('atan', 3000, -100, 100), ...samples('atan-s', 1000, -1, 1), 0, 1, -1, 1e10, -1e10]) close(datan(x), Math.atan(x));
    const r = new Rng('atan2');
    for (let i = 0; i < 3000; i++) {
      const y = r.range(-50, 50);
      const x = r.range(-50, 50);
      close(datan2(y, x), Math.atan2(y, x));
    }
    for (const [y, x] of [
      [0, 1],
      [0, -1],
      [-0, -1],
      [1, 0],
      [-1, 0],
      [0, 0],
      [0, -0],
      [Infinity, Infinity],
      [-Infinity, -Infinity],
      [Infinity, 1],
      [1, -Infinity],
      [-1, Infinity],
    ] as [number, number][]) {
      close(datan2(y, x), Math.atan2(y, x));
      expect(Object.is(Math.sign(datan2(y, x)), Math.sign(Math.atan2(y, x)))).toBe(true);
    }
  });

  it('dtanh', () => {
    for (const x of [...samples('tanh', 3000, -25, 25), ...samples('tanh-s', 2000, -0.6, 0.6), 0, 1e-10, -1e-10]) close(dtanh(x), Math.tanh(x));
  });

  it('helpers', () => {
    expect(dhypot(3, 4)).toBe(5);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    close(dsigmoid(0), 0.5);
    close(dsigmoid(2), 1 / (1 + Math.exp(-2)));
  });
});

describe('dmath edge cases', () => {
  it('dsin / dcos stay accurate and bounded for huge arguments (Payne–Hanek reduction)', () => {
    expect(twoOverPiFixedPoint().toString(16).slice(0, 48)).toBe('a2f9836e4e441529fc2757d1f534ddc0db6295993c439041');
    const xs: number[] = [524288, 1e7, 1e16, 1e22, 1.7976931348623157e308, 6381956970095103 * 2 ** 797];
    const r = new Rng('huge');
    for (let i = 0; i < 2000; i++) xs.push((r.float() * 2 - 1) * 10 ** r.range(5.5, 300));
    for (const x of xs) {
      for (const [f, g] of [
        [dsin, Math.sin],
        [dcos, Math.cos],
      ] as const) {
        const v = f(x);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
        if (Math.abs(v - g(x)) > 1e-12) throw new Error(`${f.name}(${x}) = ${v}, Math gives ${g(x)}`);
      }
    }
  });

  it('dpow follows the Math.pow special-value rules exactly', () => {
    const specials = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 65, -65, 2.5, -2.5, Infinity, -Infinity, NaN];
    for (const x of specials) {
      for (const y of specials) {
        const a = dpow(x, y);
        const b = Math.pow(x, y);
        const ok = Object.is(a, b) || (Number.isFinite(b) && b !== 0 && Math.abs(a - b) <= 1e-12 * Math.abs(b));
        if (!ok) throw new Error(`dpow(${x}, ${y}) = ${a}, Math.pow gives ${b}`);
      }
    }
  });

  it('dhypot neither overflows nor underflows', () => {
    close(dhypot(1e200, 1e200), Math.hypot(1e200, 1e200));
    close(dhypot(1.7e308, 1e300), Math.hypot(1.7e308, 1e300));
    expect(dhypot(1e-200, 1e-200) / 1e-200).toBeCloseTo(Math.SQRT2, 12);
    expect(dhypot(5e-324, 0)).toBe(5e-324);
    expect(dhypot(Infinity, NaN)).toBe(Infinity);
    expect(dhypot(NaN, 1)).toBeNaN();
    expect(dhypot(-3, 4)).toBe(5);
  });
});

describe('dmath determinism', () => {
  it('pinned bit-exact outputs (guards against accidental algorithm changes)', () => {
    // These values are produced by this implementation; they must never change silently.
    const probe = [dexp(1), dlog(10), dsin(1), dcos(1), datan2(1, 2), dtanh(0.3), dpow(1.5, 2.2)];
    const again = [dexp(1), dlog(10), dsin(1), dcos(1), datan2(1, 2), dtanh(0.3), dpow(1.5, 2.2)];
    expect(probe).toEqual(again);
    expect(probe).toEqual([
      2.7182818284590455, 2.302585092994046, 0.8414709848078965, 0.5403023058681398, 0.4636476090008061, 0.2913126124515909,
      2.440061485194822,
    ]);
  });
});
