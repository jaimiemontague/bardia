import { getContent } from '@content/index';
import { Rng } from '@sim/core/rng';
import type { FactionId, SettlementId } from '@sim/core/state';
import { inDraft, missingEventKeys, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { autoResolveBattle, predictBattle } from '../autoresolve';
import { BattleEngine } from '../engine/engine';
import { winProbability } from '../formulas';
import { module as battle } from '../index';
import { battleDigest } from '../testing';
import { createBattleAi, PLAN_KINDS } from './index';
import { matchupSetup, PARITY_MATCHUPS, runMatchup, runParity, type ParityMatchup } from './parity';

const content = getContent();
const maxTicks = Math.ceil(content.tunables.battle.maxDurationS * content.balance.battle.tickHz) + 1;
const matchup = (id: string): ParityMatchup => {
  const m = PARITY_MATCHUPS.find((x) => x.id === id);
  if (!m) throw new Error(`no matchup ${id}`);
  return m;
};
const lead = (name: string) => ({ name, command: 3, melee: 3, role: 'lieutenant' as const });
const P = (unit: string, men: number) => ({ unit, men, leader: lead(`${unit} leader`) });
const MIRROR: ParityMatchup = { id: 'mirror', kind: 'field', template: 'field', attacker: [P('bondi', 50), P('bondi', 50), P('bondi', 50)], defender: [P('bondi', 50), P('bondi', 50), P('bondi', 50)] };

describe('auto-resolve (§31.11)', () => {
  it('P(win) = r^2.2 / (r^2.2 + 1)', () => {
    const pow = (x: number, y: number) => x ** y;
    expect(winProbability(2.2, 1, pow)).toBeCloseTo(0.5);
    expect(winProbability(2.2, 2, pow)).toBeCloseTo(2 ** 2.2 / (2 ** 2.2 + 1));
    expect(winProbability(2.2, 0.5, pow)).toBeCloseTo(1 - 2 ** 2.2 / (2 ** 2.2 + 1));
  });

  it('predictions order the matchups sensibly and stay in the band vocabulary', () => {
    const even = predictBattle(matchupSetup(content, MIRROR, 'p1'), content);
    const hopeless = predictBattle(matchupSetup(content, matchup('field-hopeless'), 'p1'), content);
    expect(even.winProbability).toBeCloseTo(0.5, 1);
    expect(hopeless.winProbability).toBeLessThan(0.2);
    expect(['decisive', 'likely', 'even', 'risky', 'hopeless']).toContain(even.band);
    expect(hopeless.band === 'hopeless' || hopeless.band === 'risky').toBe(true);
  });

  it('is deterministic for a setup and a seed, and its casualties stay within the §31.11 bands', () => {
    for (const m of PARITY_MATCHUPS.slice(0, 6)) {
      const setup = matchupSetup(content, m, 'auto');
      const a = autoResolveBattle(setup, content, Rng.derive(setup.seed, 'autoresolve'));
      const b = autoResolveBattle(setup, content, Rng.derive(setup.seed, 'autoresolve'));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const men = (side: 'attacker' | 'defender') => (side === 'attacker' ? setup.attacker : setup.defender).squads.reduce((x, s) => x + s.men, 0);
      const lost = (side: 'attacker' | 'defender') => a.casualties.filter((c) => c.side === side).reduce((x, c) => x + c.killed + c.wounded + c.captured, 0);
      if (a.winner === 'attacker' || a.winner === 'defender') {
        const loser = a.winner === 'attacker' ? 'defender' : 'attacker';
        expect(lost(loser) / men(loser), m.id).toBeGreaterThanOrEqual(0.44);
        expect(lost(loser) / men(loser), m.id).toBeLessThanOrEqual(0.81);
        expect(lost(a.winner) / men(a.winner), m.id).toBeLessThanOrEqual(0.41);
      }
    }
  });

  it('never leaves a leader of the winning side as a captive (§12.5)', () => {
    for (const m of PARITY_MATCHUPS) {
      const setup = matchupSetup(content, m, 'auto');
      for (let i = 0; i < 40; i++) {
        const r = autoResolveBattle(setup, content, Rng.derive(setup.seed, `capture-${i}`));
        if (r.winner !== 'attacker' && r.winner !== 'defender') continue;
        const winners = new Set((r.winner === 'attacker' ? setup.attacker : setup.defender).squads.map((s) => s.leaderId));
        for (const [id, fate] of Object.entries(r.leaderFates ?? {})) if (winners.has(id as never)) expect(fate, `${m.id} ${id}`).not.toBe('captured');
      }
    }
  });
});

describe('the battle AI (§13.7, §18.10)', () => {
  it('fights deterministically: same setup, same battle', () => {
    const setup = matchupSetup(content, matchup('field-mixed'), 'det');
    const run = () => {
      const e = BattleEngine.create(setup, content, { humanSides: [] });
      const r = e.runToEnd(maxTicks);
      return JSON.stringify(r) + battleDigest(e.state);
    };
    expect(run()).toBe(run());
  });

  it('every matchup ends within the time limit', () => {
    for (const m of PARITY_MATCHUPS) {
      const setup = matchupSetup(content, m, 'end');
      const e = BattleEngine.create(setup, content, { humanSides: [] });
      const r = e.runToEnd(maxTicks);
      expect(['attacker', 'defender', 'none']).toContain(r.winner);
      expect(r.durationS, m.id).toBeLessThanOrEqual(content.tunables.battle.maxDurationS + 1);
    }
  });

  it('plays a mirror match evenly and loses a hopeless one', () => {
    const mirror = runMatchup(content, MIRROR, { runs: 16, seed: 'mirror' });
    expect(mirror.simulated).toBeGreaterThan(0.25);
    expect(mirror.simulated).toBeLessThan(0.75);
    const hopeless = runMatchup(content, matchup('field-hopeless'), { runs: 10, seed: 'hopeless' });
    expect(hopeless.simulated).toBeLessThan(0.35);
  });

  it('raiders gather loot and get away with it', () => {
    let looted = 0;
    for (let i = 0; i < 8; i++) {
      const setup = matchupSetup(content, matchup('raid-village'), `raid${i}`);
      const r = BattleEngine.create(setup, content, { humanSides: [] }).runToEnd(maxTicks);
      if (r.lootValue > 0) looted++;
    }
    // Raids are close fights (≈ 50 % in the parity harness): some get away with loot.
    expect(looted).toBeGreaterThanOrEqual(2);
  });

  it('commanders choose plans from the vocabulary and re-plan as battles turn', () => {
    const setup = matchupSetup(content, matchup('field-outnumbered'), 'plans');
    const ais: { brain: { history: { plan: string }[] } }[] = [];
    const factory = createBattleAi();
    const e = BattleEngine.create(setup, content, {
      humanSides: [],
      ai: (state, side) => {
        const ai = factory(state, side) as unknown as { brain: { history: { plan: string }[] } };
        ais.push(ai);
        return ai as never;
      },
    });
    e.runToEnd(maxTicks);
    expect(ais).toHaveLength(2);
    for (const ai of ais) {
      expect(ai.brain.history.length).toBeGreaterThan(0);
      for (const h of ai.brain.history) expect(PLAN_KINDS).toContain(h.plan);
    }
  });

  it('the parity harness runs and reports every matchup (the ±10% bound is the tool’s, see tools/battle-parity)', () => {
    const report = runParity(content, { runs: 2, seed: 'smoke', only: ['field-even', 'assault-ringfort', 'raid-village'] });
    expect(report.rows.map((r) => r.id)).toEqual(['field-even', 'assault-ringfort', 'raid-village']);
    for (const r of report.rows) {
      expect(r.predicted).toBeGreaterThan(0);
      expect(r.predicted).toBeLessThan(1);
      expect(r.simulated).toBeGreaterThanOrEqual(0);
      expect(r.simulated).toBeLessThanOrEqual(1);
    }
  });
});

describe('autoResolveBattle effect', () => {
  it('resolves a battle the player is in at once, without the pre-battle decision', () => {
    const w = testWorld({ modules: [battle], factions: 2, seed: 'auto-effect' });
    const player = w.factionIds[0] as FactionId;
    const enemy = w.factionIds[1] as FactionId;
    const target = w.state.player.capitalId as SettlementId;
    const enemyFleet = w.fleetIds[enemy]?.[0];
    const r = inDraft(w.state, w.env, (_d, ctx) =>
      ctx.applyEffects([{ op: 'autoResolveBattle', kind: 'raid', attacker: { factionId: enemy, fleetId: enemyFleet }, defender: { factionId: player, settlementId: target }, settlementId: target, origin: 'test' } as never]),
    );
    expect(r.state.pending).toBeNull();
    const ended = r.events.find((e) => e.type === 'BattleEnded');
    expect(ended).toBeDefined();
    expect((ended as { origin?: string }).origin).toBe('test');
    expect(missingEventKeys(r.events)).toEqual([]);
  });
});
