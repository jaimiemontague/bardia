import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { DifficultyId } from '@content/schemas/ids';
import { Rng } from '@sim/core/rng';
import { skilledDifficulty } from './ai';
import { DuelEngine, type DuelInput } from './engine';
import { testDuelSetup, type TestFighter } from './testing';
import { AI_STYLES, type AiStyle, type StrikeHeight } from './types';

const content = getContent();
const bal = content.balance;
const cfg = content.tunables.duel;
const pivotWits = bal.character.attributePivot;

describe('skill sharpens the AI; difficulty sets its base (ADR-003: never stats)', () => {
  const base = cfg.ai.difficulty.raider;
  const k = cfg.ai.skill;

  it('at the Melee and Wits pivots the difficulty values are used unchanged', () => {
    expect(skilledDifficulty(cfg, base, k.meleePivot, pivotWits, pivotWits)).toEqual(base);
  });

  it('more Melee: faster reactions, fewer mistakes, tighter timing, more aborts; less Melee: the reverse', () => {
    const pro = skilledDifficulty(cfg, base, k.meleePivot + 2, pivotWits, pivotWits);
    const raw = skilledDifficulty(cfg, base, k.meleePivot - 2, pivotWits, pivotWits);
    expect(pro.reactionMs).toBeCloseTo(base.reactionMs * (1 - k.reactionPctPerMelee / 100) ** 2);
    expect(pro.mistakeChance).toBeLessThan(base.mistakeChance);
    expect(pro.timingSdMs).toBeLessThan(base.timingSdMs);
    expect(pro.abortChance).toBeCloseTo(Math.min(1, base.abortChance + 2 * k.abortPerMelee));
    expect(raw.reactionMs).toBeGreaterThan(base.reactionMs);
    expect(raw.mistakeChance).toBeGreaterThan(base.mistakeChance);
    expect(pro.decisionMs).toBe(base.decisionMs);
  });

  it('sharper Wits misread fewer heights; the multipliers stay within their bounds', () => {
    expect(skilledDifficulty(cfg, base, k.meleePivot, pivotWits + 3, pivotWits).readError).toBeLessThan(base.readError);
    const legend = skilledDifficulty(cfg, base, 10, 10, pivotWits);
    const novice = skilledDifficulty(cfg, base, 0, 1, pivotWits);
    expect(legend.reactionMs).toBeGreaterThanOrEqual(base.reactionMs * k.multMin - 1e-9);
    expect(novice.reactionMs).toBeLessThanOrEqual(base.reactionMs * k.multMax + 1e-9);
    expect(legend.mistakeChance).toBeGreaterThanOrEqual(0);
    expect(novice.mistakeChance).toBeLessThanOrEqual(1);
  });

  it('the difficulty never changes a fighter’s numbers, only how its AI plays', () => {
    const setup = testDuelSetup({}, {}, { seed: 'stats' });
    const profiles = (['hearthside', 'raider', 'seaKing', 'longWinter'] as DifficultyId[]).map((difficulty) => {
      const e = new DuelEngine(setup, content, { ai: { a: true, b: true }, difficulty });
      return [e.fighter('a').p, e.fighter('b').p, e.fighter('a').parryWindowMs];
    });
    for (const p of profiles) expect(p).toEqual(profiles[0]);
  });
});

interface Fingerprint {
  /** Strikes started per second (light + heavy). */
  attackRate: number;
  heavyShare: number;
  /** Feints per strike started. */
  feintShare: number;
  /** Parries made per blow the opponent landed or had stopped. */
  parryShare: number;
  /** Blocks per blow the opponent landed or had stopped. */
  blockShare: number;
  tauntsPerDuel: number;
}

/** Plays `style` (side a) against a fixed opponent in AI-vs-AI duels and measures its habits. */
function fingerprint(style: AiStyle, n = 60): Fingerprint {
  let seconds = 0;
  let strikes = 0;
  let heavies = 0;
  let feints = 0;
  let parries = 0;
  let blocks = 0;
  let incoming = 0;
  let taunts = 0;
  for (let i = 0; i < n; i++) {
    const e = new DuelEngine(testDuelSetup({ style }, { style: 'aggressive' }, { seed: `fp-${style}-${i}`, stakes: 'death' }), content, { ai: { a: true, b: true } });
    while (!e.ended) {
      e.step();
      for (const f of e.fx) {
        if (f.kind === 'windup' && f.side === 'a' && f.attack !== 'bash') {
          strikes += 1;
          if (f.attack === 'heavy') heavies += 1;
        }
        if (f.kind === 'feint' && f.side === 'a') feints += 1;
        if (f.kind === 'tauntStart' && f.side === 'a') taunts += 1;
        // Blows of the opponent that reached a: parried (fx side = parrier), blocked (side = striker) or clean.
        if (f.kind === 'parry' && f.side === 'a') {
          parries += 1;
          incoming += 1;
        }
        if (f.kind === 'block' && f.side === 'b') {
          blocks += 1;
          incoming += 1;
        }
        if (f.kind === 'hit' && f.side === 'b') incoming += 1;
      }
    }
    seconds += e.timeMs / 1000;
  }
  return {
    attackRate: strikes / seconds,
    heavyShare: heavies / Math.max(1, strikes),
    feintShare: feints / Math.max(1, strikes),
    parryShare: parries / Math.max(1, incoming),
    blockShare: blocks / Math.max(1, incoming),
    tauntsPerDuel: taunts / n,
  };
}

describe('AI personalities (Aggressive, Defensive, Tricky, Brute)', () => {
  const fp = Object.fromEntries(AI_STYLES.map((s) => [s, fingerprint(s)])) as Record<AiStyle, Fingerprint>;
  const others = (s: AiStyle) => AI_STYLES.filter((x) => x !== s).map((x) => fp[x]);

  it('Aggressive presses hardest: the most strikes per second', () => {
    for (const o of others('aggressive')) expect(fp.aggressive.attackRate).toBeGreaterThan(o.attackRate);
  });

  it('Defensive waits and parries: the fewest strikes and the most parries', () => {
    for (const o of others('defensive')) {
      expect(fp.defensive.attackRate).toBeLessThan(o.attackRate);
      expect(fp.defensive.parryShare).toBeGreaterThan(o.parryShare);
    }
  });

  it('Tricky feints and taunts most', () => {
    for (const o of others('tricky')) {
      expect(fp.tricky.feintShare).toBeGreaterThan(o.feintShare);
      expect(fp.tricky.tauntsPerDuel).toBeGreaterThan(o.tauntsPerDuel);
    }
  });

  it('Brute swings heavy blows and soaks rather than parries', () => {
    for (const o of others('brute')) expect(fp.brute.heavyShare).toBeGreaterThan(o.heavyShare);
    expect(fp.brute.parryShare).toBeLessThan(fp.defensive.parryShare);
    expect(fp.brute.parryShare).toBeLessThan(fp.tricky.parryShare);
  });
});

/**
 * A scripted human (side a) who walks into reach and throws light strikes at random heights at a
 * defensive AI (side b) of the given difficulty. Returns the share of strikes that land clean and
 * the share of guarded blows caught at the wrong height.
 */
function humanVsAi(difficulty: DifficultyId, opts: { human?: TestFighter; ai?: TestFighter; n?: number } = {}): { clean: number; wrongHeight: number } {
  const n = opts.n ?? 40;
  let strikes = 0;
  let clean = 0;
  let guarded = 0;
  let wrong = 0;
  for (let i = 0; i < n; i++) {
    const setup = testDuelSetup({ ...opts.human }, { style: 'defensive', ...opts.ai }, { seed: `hva-${i}`, stakes: 'death' });
    const e = new DuelEngine(setup, content, { ai: { a: false, b: true }, difficulty });
    const pick = new Rng(`heights-${i}`);
    let pending: StrikeHeight | null = null;
    while (!e.ended && e.timeMs < 40_000) {
      const me = e.fighter('a');
      const input: DuelInput = {};
      if (e.gap > me.p.reachM - 0.05) input.move = 1;
      else if ((me.action === 'idle' || me.action === 'guard') && me.stamina > 30) {
        pending = pick.chance(0.5) ? 'high' : 'low';
        input.attack = 'light';
        input.height = pending;
      }
      if (e.quarter) input.quarter = 'refuse';
      e.step({ a: input });
      for (const f of e.fx) {
        if (f.kind === 'windup' && f.side === 'a') strikes += 1;
        if (f.kind === 'hit' && f.side === 'a') clean += 1;
        if (f.kind === 'block' && f.side === 'a') {
          guarded += 1;
          if (e.fighter('b').guardHeight !== f.height) wrong += 1;
        }
      }
    }
  }
  return { clean: clean / Math.max(1, strikes), wrongHeight: wrong / Math.max(1, guarded) };
}

describe('difficulty reaction times and honest perception', () => {
  it('a harder AI lets fewer of the same scripted strikes through', () => {
    const easy = humanVsAi('hearthside');
    const normal = humanVsAi('raider');
    const hard = humanVsAi('longWinter');
    expect(easy.clean).toBeGreaterThan(normal.clean);
    expect(normal.clean).toBeGreaterThan(hard.clean);
  });

  it('an AI far below its foe’s Wits never sees the height glyph and must guess the guard', () => {
    const blind = humanVsAi('longWinter', { human: { stats: { wits: 8 } }, ai: { stats: { wits: 2 } } });
    const sighted = humanVsAi('longWinter', { human: { stats: { wits: 2 } }, ai: { stats: { wits: 8 } } });
    expect(blind.wrongHeight).toBeGreaterThan(0.3);
    expect(sighted.wrongHeight).toBeLessThan(0.2);
    expect(blind.wrongHeight - sighted.wrongHeight).toBeGreaterThan(0.2);
  });

  it('an NPC whose nerve breaks asks for quarter (and the human decides in a duel to the death)', () => {
    const setup = testDuelSetup({ stats: { might: 7, melee: 6 } }, { style: 'defensive' }, { seed: 'nerve', stakes: 'death' });
    setup.profiles!.b.yieldHp = 0.95;
    const e = new DuelEngine(setup, content, { ai: { a: false, b: true }, difficulty: 'hearthside' });
    let asked = false;
    while (!e.ended && e.timeMs < 60_000) {
      if (e.quarter) {
        expect(e.quarter).toEqual({ asker: 'b', decider: 'a' });
        asked = true;
        e.step({ a: { quarter: 'accept' } });
        break;
      }
      const me = e.fighter('a');
      // Strike until the foe kneels, then let the plea run its 1.5 s.
      const kneeling = e.fighter('b').action === 'yield';
      const input: DuelInput = kneeling ? {} : e.gap > me.p.reachM - 0.05 ? { move: 1 } : me.action === 'idle' ? { attack: 'light', height: 'low' } : {};
      e.step({ a: input });
    }
    expect(asked).toBe(true);
    expect(e.outcome).toMatchObject({ winner: 'a', reason: 'yield' });
  });
});
