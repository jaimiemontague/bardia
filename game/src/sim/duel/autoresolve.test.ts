import { describe, expect, it } from 'vitest';
import type { RandomSource } from '@sim/core/rng';
import { Rng } from '@sim/core/rng';
import { autoResolveDuel, duelWinProbability } from './autoresolve';
import { rollInjury } from './outcome';
import { testDuelContent, testDuelSetup } from './testing';

const content = testDuelContent();
const b = content.balance;

/** A RandomSource whose int() returns scripted values (other draws from a seeded Rng). */
function scriptedInts(values: number[]): RandomSource {
  const rng = new Rng('scripted');
  let i = 0;
  return Object.assign(Object.create(rng) as RandomSource, { int: () => values[i++] ?? 1 });
}

describe('§14.8 auto-resolve', () => {
  it('P(A wins) = 1 / (1 + e^(−0.25 × (R_A − R_B)))', () => {
    expect(duelWinProbability(b, 20, 20)).toBe(0.5);
    expect(duelWinProbability(b, 24, 20)).toBeCloseTo(1 / (1 + Math.E ** -1), 12);
    expect(duelWinProbability(b, 10, 30)).toBeCloseTo(1 / (1 + Math.E ** 5), 12);
    expect(duelWinProbability(b, 21, 25) + duelWinProbability(b, 25, 21)).toBeCloseTo(1, 12);
  });

  it('+2 Melee (+4 rating) wins about 73%; equal fighters about 50% (empirical)', () => {
    const runs = 4000;
    let equal = 0;
    let better = 0;
    const eq = testDuelSetup({}, {});
    const plus = testDuelSetup({ stats: { melee: 5 } }, { stats: { melee: 3 } });
    expect(plus.profiles!.a.rating - plus.profiles!.b.rating).toBe(4);
    const rng = new Rng('auto-empirical');
    for (let i = 0; i < runs; i++) {
      if (autoResolveDuel(eq, b, rng).winner === 'a') equal += 1;
      if (autoResolveDuel(plus, b, rng).winner === 'a') better += 1;
    }
    expect(equal / runs).toBeGreaterThan(0.47);
    expect(equal / runs).toBeLessThan(0.53);
    expect(better / runs).toBeGreaterThan(0.7);
    expect(better / runs).toBeLessThan(0.76);
  });

  it('is deterministic for a seed and consumes a fixed number of draws', () => {
    const s = testDuelSetup({}, { stats: { might: 6 } });
    const r1 = new Rng('x');
    const r2 = new Rng('x');
    expect(autoResolveDuel(s, b, r1)).toEqual(autoResolveDuel(s, b, r2));
    expect(r1.getState()).toEqual(r2.getState());
    const r3 = new Rng('x');
    r3.float();
    r3.float();
    expect(r1.getState()).toEqual(r3.getState());
  });

  it('summarises the fight according to the stakes', () => {
    const blood = autoResolveDuel(testDuelSetup({}, {}, { stakes: 'firstBlood' }), b, new Rng('s'));
    expect(blood.summary.reason).toBe('firstBlood');
    const death = autoResolveDuel(testDuelSetup({}, {}, { stakes: 'death' }), b, new Rng('s'));
    expect(death.summary.reason).toBe('down');
    const loser = death.winner === 'a' ? 'b' : 'a';
    expect(death.summary.hpPct[loser]).toBe(0);
  });
});

describe('§22.5 injury table', () => {
  it('maps d100 onto the rows', () => {
    const cases: [number, string][] = [
      [1, 'none'],
      [30, 'none'],
      [31, 'scar'],
      [45, 'scar'],
      [46, 'brokenHand'],
      [56, 'crackedRibs'],
      [64, 'concussion'],
      [71, 'lostFingers'],
      [79, 'lameLeg'],
      [87, 'lostEye'],
      [95, 'mortalWound'],
      [100, 'mortalWound'],
    ];
    for (const [d, id] of cases) expect(rollInjury(b, scriptedInts([d])).id).toBe(id);
  });

  it('rolls each row with its share of the table (empirical)', () => {
    const rng = new Rng('injuries');
    const counts: Record<string, number> = {};
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const id = rollInjury(b, rng).id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect((counts['none'] ?? 0) / n).toBeCloseTo(0.3, 1);
    expect((counts['mortalWound'] ?? 0) / n).toBeCloseTo(0.06, 1);
  });
});
