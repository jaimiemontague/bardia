import { getBalance } from '@content/index';
import type { NewsItem, SettlementId } from '@sim/core/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  copyDrift,
  copyHops,
  distortFacts,
  driftBounds,
  hopDrift,
  importanceFromThresholds,
  maxAgeDays,
  newsArrivalHour,
  newsDelayDays,
  newsDelayFactor,
  newsReachDays,
  toImportance,
} from './formulas';

const b = getBalance().intel.news;

describe('§31.19 news formulas', () => {
  it('delay = travelDays × (1.5 − 0.1 × importance)', () => {
    expect(newsDelayFactor(1, b)).toBeCloseTo(1.4, 12);
    expect(newsDelayFactor(5, b)).toBeCloseTo(1.0, 12);
    expect(newsDelayDays(10, 3, b)).toBeCloseTo(12, 12);
    expect(newsDelayDays(0, 3, b)).toBe(0);
  });

  it('reach = 5 + 5 × importance travel-days', () => {
    expect([1, 2, 3, 4, 5].map((i) => newsReachDays(i, b))).toEqual([10, 15, 20, 25, 30]);
  });

  it('arrival hour rounds the delayed travel time to whole hours', () => {
    // 1.3 days at importance 2 → 1.3 × 1.3 = 1.69 days = 40.56 h → 41.
    expect(newsArrivalHour(100, 1.3, 2, b)).toBe(141);
  });

  it('importance helpers', () => {
    expect(toImportance(0)).toBe(1);
    expect(toImportance(7)).toBe(5);
    expect(toImportance(2.6)).toBe(3);
    expect(toImportance(Number.NaN)).toBe(1);
    expect(importanceFromThresholds(0, [60, 250, 800, 2000])).toBe(1);
    expect(importanceFromThresholds(60, [60, 250, 800, 2000])).toBe(2);
    expect(importanceFromThresholds(5000, [60, 250, 800, 2000])).toBe(5);
    expect(maxAgeDays(1, [60, 90, 150, 240, 360])).toBe(60);
    expect(maxAgeDays(5, [60, 90, 150, 240, 360])).toBe(360);
  });
});

describe('distortion', () => {
  it('a hop drifts by at most ±distortion, deterministically', () => {
    for (let i = 0; i < 500; i++) {
      const f = hopDrift(12345, `set_${i}` as SettlementId, 0.1);
      expect(f).toBeGreaterThanOrEqual(0.9);
      expect(f).toBeLessThanOrEqual(1.1);
      expect(hopDrift(12345, `set_${i}` as SettlementId, 0.1)).toBe(f);
    }
  });

  it('drift is roughly unbiased over many places', () => {
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += hopDrift(777, `set_${i}` as SettlementId, 0.1);
    expect(Math.abs(sum / n - 1)).toBeLessThan(0.01);
  });

  it('distortFacts scales numbers, keeps integers whole and leaves exact keys and text alone', () => {
    const facts = { killed: 1000, share: 0.5, year: 812, place: 'Kolby', nested: { men: [100, 200] }, flag: true, none: null };
    const out = distortFacts(facts, 1.1, ['year']);
    expect(out).toEqual({ killed: 1100, share: 0.55, year: 812, place: 'Kolby', nested: { men: [110, 220] }, flag: true, none: null });
    expect(facts.killed).toBe(1000);
    expect(distortFacts(facts, 1)).toEqual(facts);
  });

  it('copy chains: hops and drift follow reachedFrom', () => {
    const item = {
      reachedIds: ['set_1', 'set_2', 'set_3', 'set_4'] as SettlementId[],
      reachedFrom: [-1, 0, 1, 1],
      seed: 99,
      distortion: 0.1,
    } satisfies Pick<NewsItem, 'reachedIds' | 'reachedFrom' | 'seed' | 'distortion'>;
    expect([0, 1, 2, 3].map((c) => copyHops(item, c))).toEqual([0, 1, 2, 2]);
    expect(copyDrift(item, 0)).toBe(1);
    const d1 = hopDrift(99, 'set_2' as SettlementId, 0.1);
    expect(copyDrift(item, 1)).toBeCloseTo(d1, 15);
    expect(copyDrift(item, 3)).toBeCloseTo(d1 * hopDrift(99, 'set_4' as SettlementId, 0.1), 15);
  });

  it('property: any chain stays within (1 ± d)^hops', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 0xffffffff }), fc.double({ min: 0, max: 0.5, noNaN: true }), (hops, seed, d) => {
        const reachedIds = Array.from({ length: hops + 1 }, (_, i) => `set_${i + 1}` as SettlementId);
        const reachedFrom = reachedIds.map((_, i) => i - 1);
        const drift = copyDrift({ reachedIds, reachedFrom, seed, distortion: d }, hops);
        const [lo, hi] = driftBounds(hops, d);
        return drift >= lo - 1e-12 && drift <= hi + 1e-12;
      }),
      { numRuns: 300 },
    );
  });
});
