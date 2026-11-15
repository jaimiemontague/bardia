import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { makeTestSetup, type FixtureSquad } from '../testing';
import { BattleEngine } from './engine';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const content = getContent();

/** §13.10: up to 8 player squads vs 10 enemy squads, ≤ 300 figures, burning buildings, volleys. */
const ATTACKERS: FixtureSquad[] = [
  { unit: 'huscarls', men: 80, leader: { name: 'Player', command: 10, isPlayer: true, role: 'player' } },
  { unit: 'bondi', men: 80, leader: { name: 'L1', command: 10 } },
  { unit: 'bondi', men: 80, leader: { name: 'L2', command: 10 } },
  { unit: 'archers', men: 80, leader: { name: 'L3', command: 10, archery: 5 } },
  { unit: 'archers', men: 80, leader: { name: 'L4', command: 10 } },
  { unit: 'skirmishers', men: 80, leader: { name: 'L5', command: 10 } },
  { unit: 'berserkers', men: 80, leader: { name: 'L6', command: 10 } },
  { unit: 'wolfcoats', men: 25, leader: { name: 'L7', command: 10 } },
];
const DEFENDERS: FixtureSquad[] = [
  { unit: 'thegns', men: 80, leader: { name: 'Chief', command: 5 }, chief: true },
  ...Array.from({ length: 5 }, (): FixtureSquad => ({ unit: 'fyrdSpearmen', men: 80 })),
  ...Array.from({ length: 4 }, (): FixtureSquad => ({ unit: 'albricBowmen', men: 80 })),
];

function run(seed: string): number[] {
  const setup = makeTestSetup(content, { kind: 'assault', template: 'cityQuarter', seed, attacker: ATTACKERS, defender: DEFENDERS, playerSide: null, hasPitch: true, windStr: 1 });
  const engine = BattleEngine.create(setup, content, { humanSides: [] });
  const st = engine.state;
  expect(st.squads).toHaveLength(18);
  expect(st.figures.n).toBeLessThanOrEqual(st.data.b.maxFigures);
  const times: number[] = [];
  while (engine.status !== 'ended' && engine.tick < 20 * 240) {
    if (engine.status === 'duelRequested') {
      engine.autoResolveDuel();
      continue;
    }
    // Set a quarter of the town alight early on (fire spread, smoke, collapses, re-planning).
    if (engine.tick === 40) {
      for (const b of st.buildings.slice(0, Math.ceil(st.buildings.length / 4))) b.burning = true;
      st.smokeDirty = true;
    }
    const t0 = performance.now();
    engine.step(1);
    times.push(performance.now() - t0);
  }
  return times;
}

describe('battle step performance (§13.10, §29.8)', () => {
  it('a max-size battle steps in ≤ 4 ms', () => {
    run('warm-up');
    const times = [...run('perf-1'), ...run('perf-2')].sort((a, b) => a - b);
    const mean = times.reduce((a, t) => a + t, 0) / times.length;
    const p99 = times[Math.floor(times.length * 0.99)]!;
    const max = times[times.length - 1]!;
    const secondWorst = times[times.length - 2]!;
    console.log(`battle step: ${times.length} ticks, mean ${mean.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${max.toFixed(3)} ms`);
    expect(mean).toBeLessThan(1 * PERF_SLACK);
    expect(p99).toBeLessThan(4 * PERF_SLACK);
    // Every step but one stays within the 4 ms budget (the worst, a building collapsing and both
    // sides' distance fields re-planned, measures ~2 ms warm); the single worst may meet a GC pause
    // on a loaded machine, so it only has to stay inside a frame.
    // Outliers are machine noise in the parallel suite: held only in a dedicated run.
    if (PERF_SLACK === 1) {
      expect(secondWorst).toBeLessThan(4);
      expect(max).toBeLessThan(16);
    }
  });
});
