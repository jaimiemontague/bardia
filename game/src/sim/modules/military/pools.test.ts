import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { SettlementId } from '@sim/core/state';
import { HOURS_PER_MONTH } from '@sim/core/time';
import { advance } from '@sim/core/scheduler';
import { poolForecast, poolMax, poolRegen } from './pools';
import { capitalOf, edit, militaryEnv, militaryState } from './testing';

const balance = getContent().balance;

describe('§31.5 pool formulas', () => {
  it('poolMax = floor(pop × 0.12 × (0.5 + 0.7 × loyalty/100)), ×1.2 at loyalty ≥ 75', () => {
    expect(poolMax(balance, 2000, 60)).toBe(220); // floor(2000 × 0.12 × 0.92)
    expect(poolMax(balance, 2000, 0)).toBe(120);
    expect(poolMax(balance, 2000, 74)).toBe(Math.floor(2000 * 0.12 * (0.5 + 0.7 * 0.74)));
    expect(poolMax(balance, 2000, 75)).toBe(Math.floor(Math.floor(2000 * 0.12 * (0.5 + 0.7 * 0.75)) * 1.2));
    expect(poolMax(balance, 2000, 100)).toBe(Math.floor(288 * 1.2));
    expect(poolMax(balance, 0, 100)).toBe(0);
    expect(poolMax(balance, -50, 50)).toBe(0);
  });

  it('regen = ceil(max × 0.08 × (1 + 0.05 × Stewardship))', () => {
    expect(poolRegen(balance, 220, 0)).toBe(18); // ceil(17.6)
    expect(poolRegen(balance, 220, 2)).toBe(20); // ceil(19.36)
    expect(poolRegen(balance, 220, 10)).toBe(27); // ceil(26.4)
    expect(poolRegen(balance, 0, 5)).toBe(0);
  });

  it('is never negative and grows with population and loyalty', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50000 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (pop, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(poolMax(balance, pop, lo)).toBeGreaterThanOrEqual(0);
        expect(poolMax(balance, pop, lo)).toBeLessThanOrEqual(poolMax(balance, pop, hi));
        expect(poolMax(balance, pop, lo)).toBeLessThanOrEqual(poolMax(balance, pop + 100, lo));
      }),
    );
  });
});

describe('pools in the simulation', () => {
  const env = militaryEnv();

  it('a new game starts with a full pool at every holding', () => {
    const s = militaryState();
    const cap = s.settlements[capitalOf(s)];
    expect(cap?.holding?.pool.max).toBe(poolMax(balance, cap?.pop ?? 0, cap?.holding?.loyalty ?? 0));
    expect(cap?.holding?.pool.current).toBe(cap?.holding?.pool.max);
    expect(cap?.holding?.pool.max).toBe(220);
  });

  it('regenerates monthly by the governor-Stewardship rate, capped at the maximum', () => {
    let s = militaryState();
    const id = capitalOf(s);
    s = edit(s, env, (d) => {
      const h = d.settlements[id]?.holding;
      if (h) h.pool.current = 0;
      const ruler = d.characters[d.player.rulerId];
      if (ruler) ruler.skills.stewardship = 4;
    });
    const forecast = poolForecast(s, getContent(), id);
    expect(forecast?.regen).toBe(Math.ceil(220 * 0.08 * 1.2));
    const r = advance(s, HOURS_PER_MONTH, env);
    expect(r.state.settlements[id]?.holding?.pool.current).toBe(Math.ceil(220 * 0.08 * 1.2));
    // Twelve more months: never above the maximum.
    const later = advance(r.state, HOURS_PER_MONTH * 12, env).state;
    expect(later.settlements[id]?.holding?.pool.current).toBe(later.settlements[id]?.holding?.pool.max);
  });

  it('a loyalty collapse shrinks the maximum and the pool, keeping veterans a subset', () => {
    let s = militaryState();
    const id: SettlementId = capitalOf(s);
    s = edit(s, env, (d) => {
      const h = d.settlements[id]?.holding;
      if (!h) return;
      h.loyalty = 0;
      h.pool.current = 220;
      h.pool.veterans = { bondi: 150, archers: 60 };
      h.veteranBattles = { bondi: 2, archers: 4 };
    });
    const r = advance(s, HOURS_PER_MONTH, env).state;
    const h = r.settlements[id]?.holding;
    expect(h?.pool.max).toBe(120);
    expect(h?.pool.current).toBe(120);
    const vets = Object.values(h?.pool.veterans ?? {}).reduce((a, b) => a + b, 0);
    expect(vets).toBeLessThanOrEqual(120);
  });
});
