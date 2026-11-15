import { describe, expect, it } from 'vitest';
import { Rng } from '@sim/core/rng';
import { validateSeaResult } from './apply';
import { autoResolveSea, seaFleetPower, seaWinProbability, weatherGauge, winProbability } from './autoresolve';
import { makeSeaSetup, testSeaContent } from './testing';

const content = testSeaContent();
const b = content.balance;

describe('§15.5 fleet power', () => {
  it('scales with crew, archer share, dread (capped) and the player penalty', () => {
    const base = makeSeaSetup({ attacker: { ships: ['snekkja', 'snekkja'] }, defender: { ships: ['snekkja', 'snekkja'] } });
    const p0 = seaFleetPower(content, base, 0, null);
    expect(p0.power).toBeGreaterThan(0);
    expect(p0.wind).toBe(1);
    expect(p0.archerShare).toBeCloseTo(1 + b.seaBattle.autoresolve.archerShareBonus * (base.attacker.ships.reduce((n, s) => n + s.archers, 0) / p0.crew), 9);
    expect(seaFleetPower(content, base, 0, 0).wind).toBeCloseTo(1 + b.seaBattle.autoresolve.windAdvantage, 9);
    expect(seaFleetPower(content, base, 0, 1).wind).toBeCloseTo(1 - b.seaBattle.autoresolve.windAdvantage, 9);
    const dragons = makeSeaSetup({ attacker: { ships: ['drakkar', 'drakkar', 'drakkar', 'drakkar'] }, defender: { ships: ['snekkja'] } });
    expect(seaFleetPower(content, dragons, 0, null).dread).toBeCloseTo(1 + content.tunables.autoresolve.dreadCap / 100, 9);
    const player = makeSeaSetup({ attacker: { ships: ['snekkja', 'snekkja'], isPlayer: true }, defender: { ships: ['snekkja', 'snekkja'] } });
    player.attacker.playerPenalty = 0.1;
    expect(seaFleetPower(content, player, 0, null).power).toBeCloseTo(p0.power * 0.9, 6);
  });

  it('gives the weather gauge to the clearly faster fleet', () => {
    const light = makeSeaSetup({ wind: { dir: 0, str: 'light' }, attacker: { ships: ['knarr'] }, defender: { ships: ['galley'] } });
    expect(weatherGauge(content, light)).toBe(1);
    const same = makeSeaSetup({ attacker: { ships: ['snekkja'] }, defender: { ships: ['snekkja'] } });
    expect(weatherGauge(content, same)).toBeNull();
  });

  it('win probability is r^2.2 / (r^2.2 + 1), symmetric and monotonic', () => {
    expect(winProbability(b, 1, 1)).toBeCloseTo(0.5, 12);
    expect(winProbability(b, 2, 1)).toBeCloseTo(2 ** 2.2 / (2 ** 2.2 + 1), 9);
    expect(winProbability(b, 2, 1) + winProbability(b, 1, 2)).toBeCloseTo(1, 12);
    expect(winProbability(b, 0, 1)).toBe(0);
    expect(winProbability(b, 1, 0)).toBe(1);
    const weak = makeSeaSetup({ attacker: { ships: ['karvi'] }, defender: { ships: ['snekkja', 'snekkja'] } });
    const strong = makeSeaSetup({ attacker: { ships: ['drakkar', 'snekkja', 'snekkja'] }, defender: { ships: ['snekkja', 'snekkja'] } });
    expect(seaWinProbability(content, weak).pAttacker).toBeLessThan(0.2);
    expect(seaWinProbability(content, strong).pAttacker).toBeGreaterThan(0.6);
  });
});

describe('auto-resolve outcomes (§31.11 casualty model)', () => {
  const setup = makeSeaSetup({ attacker: { ships: ['drakkar', 'snekkja', 'snekkja'], captainId: 'chr_1' }, defender: { ships: ['snekkja', 'karvi', 'knarr'], captainId: 'chr_2' } });

  it('produces consistent results with casualties inside the §31.11 bands', () => {
    const al = b.autoresolve;
    for (let i = 0; i < 60; i++) {
      const r = autoResolveSea(content, setup, new Rng(`ar-${i}`));
      expect(r.autoResolved).toBe(true);
      expect(validateSeaResult(setup, r)).toEqual([]);
      expect(r.winner === 'attacker' || r.winner === 'defender').toBe(true);
      const winner = r.crewLost.find((c) => c.side === r.winner)!;
      const loser = r.crewLost.find((c) => c.side !== r.winner)!;
      const crew = (side: 'attacker' | 'defender') => setup[side].ships.reduce((n, s) => n + s.crew, 0);
      const wShare = (winner.killed + winner.wounded + winner.captured) / crew(winner.side);
      const lCas = (loser.killed + loser.wounded) / crew(loser.side);
      expect(wShare).toBeLessThanOrEqual(al.winner.max + 0.02);
      expect(lCas + loser.captured / crew(loser.side)).toBeGreaterThanOrEqual(al.loser.min - 0.02);
      // The loser loses at least one ship; prizes are only the loser's.
      const loserIds = new Set<string>(setup[loser.side].ships.map((s) => s.shipId));
      expect([...r.shipsSunk, ...r.shipsCaptured].some((id) => loserIds.has(id))).toBe(true);
      for (const id of r.shipsCaptured) expect(loserIds.has(id)).toBe(true);
      expect(r.ships).toHaveLength(6);
      expect(r.xp.chr_1).toBeGreaterThan(0);
      expect(r.captainFates?.chr_2).toBeDefined();
    }
  });

  it('the stronger side wins about as often as the formula says', () => {
    const p = seaWinProbability(content, setup).pAttacker;
    let wins = 0;
    for (let i = 0; i < 400; i++) if (autoResolveSea(content, setup, new Rng(`odds-${i}`)).winner === 'attacker') wins++;
    expect(Math.abs(wins / 400 - p)).toBeLessThan(0.07);
  });

  it('beaten merchants strike: all their lost ships are prizes', () => {
    const m = makeSeaSetup({ attacker: { ships: ['drakkar', 'snekkja'] }, defender: { ships: ['knarr', 'knarr', 'knarr'], role: 'merchant' } });
    for (let i = 0; i < 20; i++) {
      const r = autoResolveSea(content, m, new Rng(`m-${i}`));
      if (r.winner !== 'attacker') continue;
      expect(r.shipsSunk).toEqual([]);
      expect(r.shipsCaptured.length).toBeGreaterThan(0);
      expect(r.surrendered).toBe(true);
    }
  });

  it('is deterministic for a given random stream', () => {
    expect(JSON.stringify(autoResolveSea(content, setup, new Rng('same')))).toBe(JSON.stringify(autoResolveSea(content, setup, new Rng('same'))));
  });
});
