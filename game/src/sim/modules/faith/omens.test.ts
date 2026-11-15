import { getContent } from '@content/index';
import type { OmenId } from '@content/schemas/ids';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import { Rng } from '@sim/core/rng';
import { advance } from '@sim/core/scheduler';
import type { GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, missingEventKeys, testEnv, testState } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { module as faith } from './index';
import { classifyOmen, favorBase, omenEffects, playerReadingBasis, rollOmen, shiftOmen, type OmenRollInput } from './omens';
import { withPlayerOmen } from './testing';

const content = getContent();
const omens = content.balance.omens;
const env = testEnv([faith]);

function distribution(input: OmenRollInput, n: number, seed: string): Record<OmenId, number> {
  const rng = new Rng(seed);
  const counts: Record<OmenId, number> = { ill: 0, uncertain: 0, fair: 0, blessed: 0 };
  for (let i = 0; i < n; i++) counts[rollOmen(omens, input, rng).omen]++;
  return { ill: counts.ill / n, uncertain: counts.uncertain / n, fair: counts.fair / n, blessed: counts.blessed / n };
}

function expectClose(actual: Record<OmenId, number>, expected: Record<OmenId, number>, tol = 0.01): void {
  for (const k of Object.keys(expected) as OmenId[]) expect(Math.abs(actual[k] - expected[k]), `${k}: ${actual[k]} vs ${expected[k]}`).toBeLessThan(tol);
}

const plain: OmenRollInput = { base: 0, extraDice: 0, shiftChance: 0, ignoreIll: false };

describe('omen formula (§22.6)', () => {
  it('classifies scores into the four bands', () => {
    const th = omens.thresholds;
    expect(classifyOmen(-2.01, th)).toBe('ill');
    expect(classifyOmen(-2, th)).toBe('uncertain');
    expect(classifyOmen(-0.01, th)).toBe('uncertain');
    expect(classifyOmen(0, th)).toBe('fair');
    expect(classifyOmen(3, th)).toBe('fair');
    expect(classifyOmen(3.01, th)).toBe('blessed');
  });

  it('shifts one step and clamps at the ends', () => {
    expect(shiftOmen('fair', 1)).toBe('blessed');
    expect(shiftOmen('blessed', 1)).toBe('blessed');
    expect(shiftOmen('uncertain', -1)).toBe('ill');
    expect(shiftOmen('ill', -1)).toBe('ill');
  });

  it('sums the relevant gods for each activity', () => {
    const favor = { valgrim: 10, dunnar: 20, saltha: 20, fjorna: -10, eidr: 0, skell: 50, grayQueen: 50 };
    expect(favorBase(content.balance, 'voyage', favor)).toBeCloseTo(3);
    expect(favorBase(content.balance, 'battle', favor)).toBeCloseTo(3);
    expect(favorBase(content.balance, 'duel', favor)).toBeCloseTo(2);
    expect(favorBase(content.balance, 'harvest', favor)).toBeCloseTo(-1);
  });

  it('a neutral house reads Ill 1/6, Uncertain 2/6, Fair 3/6 and never Blessed', () => {
    expectClose(distribution(plain, 60000, 'dist-0'), { ill: 1 / 6, uncertain: 2 / 6, fair: 3 / 6, blessed: 0 });
  });

  it('Favor shifts the distribution: +1 base gives Blessed on a six and never Ill', () => {
    expectClose(distribution({ ...plain, base: 1 }, 60000, 'dist-1'), { ill: 0, uncertain: 2 / 6, fair: 3 / 6, blessed: 1 / 6 });
  });

  it('Lucky moves the result one step better 25 % of the time', () => {
    const p = 0.25;
    expectClose(distribution({ ...plain, shiftChance: p }, 80000, 'dist-lucky'), {
      ill: (1 / 6) * (1 - p),
      uncertain: (2 / 6) * (1 - p) + (1 / 6) * p,
      fair: (3 / 6) * (1 - p) + (2 / 6) * p,
      blessed: (3 / 6) * p,
    });
  });

  it('Ill-Omened moves the result one step worse 25 % of the time', () => {
    const p = 0.25;
    expectClose(distribution({ ...plain, shiftChance: -p }, 80000, 'dist-illomened'), {
      ill: 1 / 6 + (2 / 6) * p,
      uncertain: (2 / 6) * (1 - p) + (3 / 6) * p,
      fair: (3 / 6) * (1 - p),
      blessed: 0,
    });
  });

  it('a Skeptic never takes an Ill reading', () => {
    const d = distribution({ ...plain, base: -3, ignoreIll: true }, 20000, 'dist-skeptic');
    expect(d.ill).toBe(0);
    expect(d.uncertain).toBeGreaterThan(0.5);
  });

  it('extra dice ("more accurate omens") keep the die nearest the mean: less variance, same mean', () => {
    const rng = new Rng('dice');
    let sum1 = 0;
    let sum3 = 0;
    let var1 = 0;
    let var3 = 0;
    let middle3 = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const a = rollOmen(omens, plain, rng);
      const b = rollOmen(omens, { ...plain, extraDice: 2 }, rng);
      expect(a.dice).toHaveLength(1);
      expect(b.dice).toHaveLength(3);
      sum1 += a.score;
      sum3 += b.score;
      var1 += a.score * a.score;
      var3 += b.score * b.score;
      if (b.die === 3 || b.die === 4) middle3++;
    }
    expect(Math.abs(sum1 / n)).toBeLessThan(0.03);
    expect(Math.abs(sum3 / n)).toBeLessThan(0.03);
    expect(var3 / n).toBeLessThan((var1 / n) * 0.6);
    expect(middle3 / n).toBeCloseTo(1 - (4 / 6) ** 3, 1);
  });

  it('is deterministic for a seed and draws a fixed number of values', () => {
    const a = new Rng('same');
    const b = new Rng('same');
    const input = { base: 0.7, extraDice: 1, shiftChance: 0.25, ignoreIll: false };
    for (let i = 0; i < 200; i++) expect(rollOmen(omens, input, a)).toEqual(rollOmen(omens, input, b));
    expect(a.getState()).toEqual(b.getState());
  });

  it('exports the modifier table with activity extras', () => {
    const t = content.tunables.faith;
    const blessedDuel = omenEffects(content.balance, t, 'duel', 'blessed');
    expect(blessedDuel['moralePct']).toBe(omens.modifiers.blessed.moralePct);
    expect(blessedDuel['stormMult']).toBe(omens.modifiers.blessed.stormMult);
    expect(blessedDuel['duel.nervePct']).toBe(t.omens.extraModifiers.duel.blessed['duel.nervePct']);
    expect(omenEffects(content.balance, t, 'voyage', 'ill')['stormMult']).toBe(1.3);
  });
});

function playerAt(state: GameState, mutate: (draft: GameState) => void): GameState {
  return inDraft(state, env, (draft) => mutate(draft)).state;
}

describe('readOmen command', () => {
  const base = testState({ modules: [faith] });

  it('reads every activity at the capital seer, charges the seer and stores expiries', () => {
    const treasury = base.factions[base.player.factionId]?.treasury ?? 0;
    const r = dispatch(base, { type: 'readOmen' }, env);
    expect(r.error).toBeUndefined();
    const t = content.tunables.faith;
    const omensNow = r.state.player.house.omens ?? {};
    for (const a of ['voyage', 'battle', 'duel', 'harvest'] as const) {
      const reading = omensNow[a];
      expect(reading, a).toBeDefined();
      expect(reading?.untilHour).toBe(r.state.time.hour + t.omens.durationDays[a] * HOURS_PER_DAY);
      expect(reading?.settlementId).toBe(base.player.capitalId);
    }
    expect(r.state.factions[base.player.factionId]?.treasury).toBe(treasury - t.omens.readCost);
    expect(r.events.some((e) => e.type === 'OmenRead')).toBe(true);
    expect(r.events.filter((e) => e.type === 'NarrationLine')).toHaveLength(4);
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('a seer reads once per month', () => {
    const first = dispatch(base, { type: 'readOmen' }, env);
    const again = dispatch(first.state, { type: 'readOmen' }, env);
    expect(again.error?.code).toBe('seerCooldown');
    const later = advance(first.state, 30 * HOURS_PER_DAY, env).state;
    expect(dispatch(later, { type: 'readOmen' }, env).error).toBeUndefined();
  });

  it('needs the ruler at a settlement with a seer, and the silver', () => {
    const away = playerAt(base, (d) => {
      const ruler = d.characters[d.player.rulerId];
      if (ruler) ruler.location = { kind: 'none' };
    });
    expect(dispatch(away, { type: 'readOmen' }, env).error?.code).toBe('notAtSettlement');
    const noHut = playerAt(base, (d) => {
      const cap = d.settlements[d.player.capitalId];
      if (cap) {
        cap.buildings['seersHut'] = 0;
        cap.tier = 'village';
      }
    });
    expect(dispatch(noHut, { type: 'readOmen' }, env).error?.code).toBe('noSeer');
    const poor = playerAt(base, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) f.treasury = 0;
    });
    expect(dispatch(poor, { type: 'readOmen' }, env).error?.code).toBe('notEnoughSilver');
    expect(dispatch(base, { type: 'readOmen', settlementId: 'set_99999' }, env).error?.code).toBe('notThere');
  });

  it('builds the basis from Favor, Valgrim, Lucky and Seer-Taught', () => {
    const s = playerAt(base, (d) => {
      d.player.house.favor.saltha = 30;
      d.player.house.favor.valgrim = 45;
      const ruler = d.characters[d.player.rulerId];
      if (ruler) {
        ruler.traits = [...ruler.traits.filter((x) => x !== 'illOmened' && x !== 'lucky' && x !== 'skeptic'), 'lucky', 'seerTaught'];
        ruler.feats = [];
      }
    });
    const basis = playerReadingBasis(s, content);
    expect(basis.signs).toBe(false);
    expect(basis.base.voyage).toBeCloseTo(7.5);
    expect(basis.extraDice).toBe(content.tunables.faith.omens.maxExtraDice);
    expect(basis.shiftChance).toBeCloseTo(0.25);
  });

  it('a battle spends the battle omen; the daily system expires the rest', () => {
    let s = withPlayerOmen(base, env, 'battle', 'blessed');
    s = withPlayerOmen(s, env, 'voyage', 'fair', 10);
    s = withPlayerOmen(s, env, 'harvest', 'fair', 90);
    const battle = {
      type: 'BattleEnded',
      kind: 'raid',
      attackerFactionId: s.player.factionId,
      defenderFactionId: 'fac_9999',
      result: { winner: 'defender', buildingsBurned: 0 },
    } as unknown as SimEvent;
    s = inDraft(s, env, (_d, ctx) => ctx.runAs('battle', () => ctx.emit(battle))).state;
    expect(s.player.house.omens?.battle).toBeUndefined();
    expect(s.player.house.omens?.voyage).toBeDefined();
    s = advance(s, 11 * HOURS_PER_DAY, env).state;
    expect(s.player.house.omens?.voyage).toBeUndefined();
    expect(s.player.house.omens?.harvest).toBeDefined();
  });
});
