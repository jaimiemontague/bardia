import { describe, expect, it } from 'vitest';
import { SeaBattleEngine } from './engine';
import { makeSeaSetup, testSeaContent } from './testing';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const content = testSeaContent();

describe('performance (ADR-003 budget: ≤ 4 ms per 20 Hz step)', () => {
  it('a 12-ship-a-side battle steps far inside the budget', () => {
    const setup = makeSeaSetup(
      {
        seed: 'perf',
        arena: 'skerries',
        attacker: { ships: Array.from({ length: 12 }, (_, i) => (i === 0 ? 'drakkar' : i % 3 === 0 ? 'karvi' : 'snekkja')), pitchT: 5 },
        defender: { ships: Array.from({ length: 12 }, (_, i) => (i < 2 ? 'galley' : 'snekkja')), culture: 'saraleonese' },
      },
      content,
    );
    const e = new SeaBattleEngine(setup, content, { aiControlsPlayer: true });
    // Warm up the JIT, then measure.
    for (let i = 0; i < 200; i++) e.step();
    let worst = 0;
    let total = 0;
    let n = 0;
    for (let i = 0; i < 3000 && e.status === 'running'; i++) {
      const t0 = performance.now();
      e.step();
      const dt = performance.now() - t0;
      total += dt;
      worst = Math.max(worst, dt);
      n++;
      e.drainEvents();
      e.snapshot();
    }
    const mean = total / Math.max(1, n);
    expect(mean).toBeLessThan(0.5 * PERF_SLACK);
    if (PERF_SLACK === 1) expect(worst).toBeLessThan(25); // outliers: dedicated runs only
  });

  it('auto-resolve and arena generation are cheap', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const setup = makeSeaSetup({ seed: `gen-${i}`, arena: 'skerries', attacker: { ships: ['snekkja'] }, defender: { ships: ['snekkja'] } }, content);
      new SeaBattleEngine(setup, content);
    }
    expect((performance.now() - t0) / 20).toBeLessThan(40);
  });
});
