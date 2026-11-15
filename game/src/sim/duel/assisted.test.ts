import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import duelStrings from '@content/locales/en/duel.json';
import { AssistedDuel, choiceCategory, tellAccuracy } from './assisted';
import { strikeDamage } from './stats';
import { testDuelSetup, type TestFighter } from './testing';
import { ASSISTED_CHOICES, type AssistedChoice, type DuelStakes } from './types';

const content = getContent();
const bal = content.balance;
const cfg = content.tunables.duel;

function duel(a: TestFighter = {}, b: TestFighter = {}, stakes: DuelStakes = 'death', humanSide: 'a' | 'b' | null = null, seed = 'as'): AssistedDuel {
  return new AssistedDuel(testDuelSetup(a, b, { stakes, seed }), content, { humanSide });
}

const dmg = (d: AssistedDuel, side: 'a' | 'b', mult: number) => {
  const p = d.setup.profiles!;
  const atk = side === 'a' ? p.a : p.b;
  const def = side === 'a' ? p.b : p.a;
  return strikeDamage(atk, def, mult) * cfg.assisted.weaponDamageMult[atk.weapon];
};

describe('§14.7 resolution matrix', () => {
  it('a Strike beats a wrong-height Guard at ×0.7', () => {
    const d = duel();
    const r = d.scripted('lowStrike', 'guardHigh');
    expect(r.events.find((e) => e.kind === 'wrongGuard')?.amount).toBeCloseTo(dmg(d, 'a', bal.duel.assisted.wrongGuardMult), 9);
  });

  it('a same-height Guard blocks a Strike: the shield takes it, HP untouched', () => {
    const d = duel();
    const r = d.scripted('highStrike', 'guardHigh');
    expect(r.events.map((e) => e.kind)).toContain('block');
    expect(r.fighters.b.hp).toBe(r.fighters.b.hpMax);
    expect(r.fighters.b.shieldMax - r.fighters.b.shieldHp).toBeCloseTo(dmg(d, 'a', 1), 9);
  });

  it('a Strike beats Bash at ×1.2 and Feint at ×1.0', () => {
    const d = duel();
    expect(d.scripted('highStrike', 'bash').events.find((e) => e.kind === 'hit')?.amount).toBeCloseTo(dmg(d, 'a', bal.duel.assisted.strikeVsBashMult), 9);
    const f = duel();
    expect(f.scripted('lowStrike', 'feint').events.find((e) => e.kind === 'hit')?.amount).toBeCloseTo(dmg(f, 'a', 1), 9);
  });

  it('Bash beats Guard: the defender cannot Guard next exchange (and loses Shield HP)', () => {
    const d = duel();
    const r = d.scripted('bash', 'guardLow');
    expect(r.events.map((e) => e.kind)).toContain('bashStagger');
    expect(r.fighters.b.staggered).toBe(true);
    expect(r.fighters.b.shieldMax - r.fighters.b.shieldHp).toBe(bal.duel.moves.bash.shieldDamage);
    expect(d.options('b')).not.toContain('guardHigh');
    expect(d.options('b')).not.toContain('guardLow');
    expect(() => d.scripted('feint', 'guardHigh')).toThrow();
    d.scripted('feint', 'feint');
    expect(d.options('b')).toContain('guardHigh');
  });

  it('Feint beats Guard: Initiative — the feinter sees the foe’s category next exchange', () => {
    const d = duel({}, {}, 'death', 'a');
    // Script the first exchange through the public API: a feints into b's guard.
    const r = d.scripted('feint', 'guardHigh');
    expect(r.events.map((e) => e.kind)).toContain('initiative');
    const p = d.prompt();
    expect(p.initiative).toBe('a');
    expect(p.tell).toBeNull();
    expect(p.revealed).not.toBeNull();
    const report = d.choose('highStrike');
    expect(choiceCategory(report.choices.b as AssistedChoice)).toBe(p.revealed);
  });

  it('Strike vs Strike: both hit, the faster (Agility + Melee) first', () => {
    const d = duel({ stats: { agility: 6 } }, {});
    const r = d.scripted('highStrike', 'lowStrike');
    expect(r.events.filter((e) => e.kind === 'hit').map((e) => e.side)).toEqual(['a', 'b']);
    const s = duel({}, { stats: { melee: 6 } });
    expect(s.scripted('highStrike', 'lowStrike').events.filter((e) => e.kind === 'hit').map((e) => e.side)).toEqual(['b', 'a']);
    // To first blood only the faster one draws it.
    const fb = duel({}, { stats: { agility: 7 } }, 'firstBlood');
    const end = fb.scripted('highStrike', 'highStrike');
    expect(end.outcome).toMatchObject({ winner: 'b', reason: 'firstBlood' });
    expect(end.events.filter((e) => e.kind === 'hit')).toHaveLength(1);
  });

  it('Bash vs Bash: both stagger; Guard vs Guard and Feint vs Feint: nothing happens', () => {
    const d = duel();
    const r = d.scripted('bash', 'bash');
    expect(r.fighters.a.staggered && r.fighters.b.staggered).toBe(true);
    const g = duel();
    expect(g.scripted('guardHigh', 'guardLow').events.map((e) => e.kind)).toEqual(['nothing']);
    expect(g.scripted('feint', 'feint').events.map((e) => e.kind)).toEqual(['nothing']);
  });

  it('every pair of choices resolves to a legal state (exhaustive)', () => {
    for (const a of ASSISTED_CHOICES) {
      for (const b of ASSISTED_CHOICES) {
        const d = duel({}, {}, 'death', null, `pair-${a}-${b}`);
        const r = d.scripted(a, b);
        expect(r.fighters.a.hp).toBeLessThanOrEqual(r.fighters.a.hpMax);
        expect(r.fighters.b.hp).toBeLessThanOrEqual(r.fighters.b.hpMax);
        expect(r.events.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('§14.7 tells', () => {
  it('accuracy = 50% + 5% × (yourWits − theirWits + 4), clamped 40–90%', () => {
    const a = bal.duel.assisted;
    expect(tellAccuracy(a, 4, 4)).toBeCloseTo(0.7);
    expect(tellAccuracy(a, 6, 4)).toBeCloseTo(0.8);
    expect(tellAccuracy(a, 10, 1)).toBe(0.9);
    expect(tellAccuracy(a, 1, 10)).toBe(0.4);
    expect(tellAccuracy(a, 2, 4)).toBeCloseTo(0.6);
  });

  it('a tell names the AI’s real choice with that accuracy (empirical) and uses duel.tell.* keys', () => {
    let right = 0;
    let total = 0;
    for (let i = 0; i < 300 && total < 2000; i++) {
      const d = duel({ stats: { wits: 6 } }, { stats: { wits: 4 } }, 'yield', 'a', `tell${i}`);
      while (!d.ended && !d.quarter && total < 2000) {
        const p = d.prompt();
        const report = d.choose(p.options.includes('guardHigh') ? 'guardHigh' : 'feint');
        if (p.tell) {
          expect(p.tell.key).toMatch(/^duel\.tell\.(highStrike|lowStrike|guardHigh|guardLow|bash|feint)\.\d$/);
          expect(p.tell.accuracy).toBeCloseTo(0.8);
          total += 1;
          if (p.tell.hint === report.choices.b) right += 1;
        }
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(right / total).toBeGreaterThan(0.76);
    expect(right / total).toBeLessThan(0.84);
  });

  it('every tell variant exists and its pronouns follow the foe (ICU select on vars.sex)', () => {
    const table = duelStrings as Record<string, string>;
    for (const choice of ASSISTED_CHOICES) {
      for (let v = 0; v < cfg.assisted.tellVariants; v++) {
        const msg = table[`duel.tell.${choice}.${v}`];
        expect(msg, `duel.tell.${choice}.${v}`).toBeTypeOf('string');
        const female = String(new IntlMessageFormat(msg!, 'en').format({ sex: 'female' }));
        const male = String(new IntlMessageFormat(msg!, 'en').format({ sex: 'male' }));
        const other = String(new IntlMessageFormat(msg!, 'en').format({ sex: 'other' }));
        expect(female).not.toMatch(/\b(he|his|him)\b/i);
        expect(male).not.toMatch(/\b(she|her)\b/i);
        expect(other).not.toMatch(/\b(he|his|him|she|her)\b/i);
      }
    }
    // The prompt passes the AI's sex (synthetic fighters without one fall back to 'other').
    const d = duel({}, {}, 'yield', 'a', 'sex');
    d.setup.profiles!.b.sex = 'female';
    const p = d.prompt();
    expect(p.tell?.vars).toEqual({ sex: 'female' });
    const anon = duel({}, {}, 'yield', 'a', 'sex2').prompt();
    expect(anon.tell?.vars).toEqual({ sex: 'other' });
  });
});

describe('Assisted duels end correctly', () => {
  it('asking for quarter ends a duel to yield; in a duel to the death the AI decides by mercy', () => {
    const y = duel({}, {}, 'yield', 'a');
    y.prompt();
    expect(y.choose('yield').outcome).toMatchObject({ winner: 'b', reason: 'yield' });
    const merciful = new AssistedDuel(testDuelSetup({}, {}, { stakes: 'death' }), content, { humanSide: 'a' });
    merciful.setup.profiles!.b.mercy = 1;
    merciful.prompt();
    expect(merciful.choose('yield').outcome).toMatchObject({ winner: 'b', reason: 'yield' });
    const cruel = new AssistedDuel(testDuelSetup({}, {}, { stakes: 'death' }), content, { humanSide: 'a' });
    cruel.setup.profiles!.b.mercy = 0;
    cruel.prompt();
    const r = cruel.choose('yield');
    expect(r.outcome).toBeNull();
    expect(r.events.map((e) => e.kind)).toContain('quarterRefused');
    expect(r.choices.a).toBe('open');
    expect(cruel.prompt().canYield).toBe(false);
  });

  it('an AI below its nerve asks the human for quarter in a duel to the death', () => {
    const d = new AssistedDuel(testDuelSetup({ stats: { might: 6, melee: 5 } }, { traits: ['craven'] }, { stakes: 'death', seed: 'nerve' }), content, { humanSide: 'a' });
    // A craven's nerve fails early (independent of the current tunable values).
    d.setup.profiles!.b.yieldHp = 0.7;
    let guard = 0;
    while (!d.ended && !d.quarter && guard++ < 80) {
      const p = d.prompt();
      const strike = p.revealed === 'guard' || p.tell?.hint === 'guardHigh' ? 'lowStrike' : 'highStrike';
      d.choose(strike);
    }
    expect(d.quarter).toEqual({ asker: 'b', decider: 'a' });
    expect(() => d.prompt()).toThrow();
    expect(d.answerQuarter(true).outcome).toMatchObject({ winner: 'a', reason: 'yield' });
  });

  it('exhaustion halves damage; holmgang shields are taken up again', () => {
    const d = duel();
    let last = d.scripted('bash', 'feint');
    for (let i = 0; i < 20 && !last.events.some((e) => e.kind === 'exhausted' && e.side === 'a'); i++) last = d.scripted('bash', 'feint');
    expect(last.fighters.a.exhausted).toBe(true);
    const hit = d.scripted('highStrike', 'feint').events.find((e) => e.kind === 'hit');
    expect(hit?.amount).toBeCloseTo(dmg(d, 'a', bal.duel.exhaustion.damageMult), 9);
    const h = new AssistedDuel(testDuelSetup({ weapon: 'daneAxe', stats: { might: 10, melee: 10 } }, {}, { arena: 'holmgang' }), content);
    let r = h.scripted('highStrike', 'guardHigh');
    for (let i = 0; i < 4 && !r.events.some((e) => e.kind === 'shieldBreak'); i++) r = h.scripted('highStrike', 'guardHigh');
    expect(r.events.map((e) => e.kind)).toContain('shieldBreak');
    expect(r.events.map((e) => e.kind)).toContain('shieldSwap');
    expect(r.fighters.b.shieldsLeft).toBe(2);
    expect(r.fighters.b.shieldHp).toBe(r.fighters.b.shieldMax);
  });

  it('AI vs AI runs to an end, deterministically', () => {
    const run = (seed: string) => new AssistedDuel(testDuelSetup({ style: 'tricky' }, { style: 'brute', weapon: 'spear' }, { seed }), content).run();
    const x = run('ai-1');
    expect(run('ai-1')).toEqual(x);
    expect(x.exchanges).toBeLessThanOrEqual(cfg.assisted.maxExchanges);
    for (let i = 0; i < 30; i++) expect(run(`ai-many-${i}`).winner).toMatch(/^[ab]$/);
  });

  it('the maximum exchange count judges on remaining HP', () => {
    const d = duel({}, {}, 'death');
    d.scripted('highStrike', 'feint');
    let r = d.scripted('guardHigh', 'guardHigh');
    while (!r.outcome) r = d.scripted('guardHigh', 'guardHigh');
    expect(r.outcome).toMatchObject({ winner: 'a', reason: 'timeout', exchanges: cfg.assisted.maxExchanges });
  });
});
