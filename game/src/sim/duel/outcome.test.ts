import { describe, expect, it } from 'vitest';
import type { EffectData } from '@sim/core/effects';
import { Rng, type RandomSource } from '@sim/core/rng';
import type { DuelSetup } from '@sim/core/state';
import { choiceProblem, decideOutcome, type OutcomeWorld } from './outcome';
import { testDuelContent, testDuelSetup } from './testing';
import type { DuelChoice, DuelFightSummary, DuelMode } from './types';

const content = testDuelContent();
const b = content.balance;
const t = content.tunables.duel;

/** A RandomSource with scripted chance() and int() answers (then falls back to a seeded Rng). */
function scripted(opts: { chances?: boolean[]; ints?: number[] } = {}): RandomSource {
  const rng = new Rng('outcome');
  const chances = [...(opts.chances ?? [])];
  const ints = [...(opts.ints ?? [])];
  return Object.assign(Object.create(rng) as RandomSource, {
    chance: (p: number) => (chances.length > 0 ? (chances.shift() as boolean) : rng.chance(p)),
    int: (lo: number, hi: number) => (ints.length > 0 ? (ints.shift() as number) : rng.int(lo, hi)),
  });
}

const PLAYER = 'chr_9001' as const;
const FOE = 'chr_9002' as const;

function world(over: Partial<OutcomeWorld> = {}): OutcomeWorld {
  return {
    playerRulerId: PLAYER,
    playerFactionId: 'fac_1',
    factionOf: { a: 'fac_1', b: 'fac_2' },
    captiveAt: { a: 'set_1', b: 'set_2' },
    ...over,
  };
}

function setup(over: Partial<DuelSetup> = {}, stakes: DuelSetup['stakes'] = 'yield'): DuelSetup {
  const s = testDuelSetup({ name: 'Player' }, { name: 'Foe' }, { stakes, playerSide: 'a' });
  s.origin = 'battle';
  s.tiers = { a: 2, b: 2 };
  s.gentle = false;
  return { ...s, ...over };
}

function fight(over: Partial<DuelFightSummary> = {}): DuelFightSummary {
  return { winner: 'a', reason: 'down', durationS: 40, hpPct: { a: 70, b: 0 }, tauntsLanded: { a: 0, b: 0 }, ...over };
}

function decide(s: DuelSetup, f: DuelFightSummary, opts: { choice?: DuelChoice; mode?: DuelMode; rng?: RandomSource; world?: OutcomeWorld } = {}) {
  return decideOutcome({
    setup: s,
    fight: f,
    mode: opts.mode ?? 'realtime',
    choice: opts.choice,
    balance: b,
    tunables: t,
    world: opts.world ?? world(),
    rng: opts.rng ?? scripted({ ints: [1], chances: [false] }),
  });
}

const ops = (effects: EffectData[], op: string) => effects.filter((e) => e.op === op);

describe('§14.9 the player wins', () => {
  it('spare: Renown + (10 + 5 × tier), Honor +5, the foe’s kin owe you', () => {
    const o = decide(setup(), fight(), { choice: 'spare' });
    expect(o.result.loserFate).toBe('spared');
    expect(o.result.renown).toBe(10 + 5 * 2);
    expect(o.result.honor).toBe(b.duel.spareHonor);
    expect(ops(o.effects, 'changeRenown')).toEqual([{ op: 'changeRenown', amount: 20 }]);
    expect(ops(o.effects, 'changeHonor')).toEqual([{ op: 'changeHonor', amount: 5 }]);
    expect(ops(o.effects, 'changeOpinion')[0]).toMatchObject({ a: 'fac_1', b: 'fac_2', amount: t.outcome.spareOpinion });
    expect(o.chronicle?.textKey).toBe('duel.chronicle.won.spared');
    expect(o.notify?.key).toBe('duel.notify.won.spared');
  });

  it('a yielded foe is "yielded"; a first-blood bout earns no Honor', () => {
    expect(decide(setup(), fight({ reason: 'yield', hpPct: { a: 80, b: 20 } })).result.loserFate).toBe('yielded');
    const fb = decide(setup({}, 'firstBlood'), fight({ reason: 'firstBlood' }));
    expect(fb.result.loserFate).toBe('spared');
    expect(fb.result.honor).toBe(0);
  });

  it('kill (only to the death, foe down): Renown ++, Dread +, blood-feud opinion, the kill op', () => {
    const o = decide(setup({}, 'death'), fight(), { choice: 'kill' });
    expect(o.result.loserFate).toBe('killed');
    expect(o.result.renown).toBe(Math.round(20 * t.outcome.killRenownMult));
    expect(o.result.dread).toBe(t.outcome.killDread);
    expect(ops(o.effects, 'kill')).toEqual([{ op: 'kill', charId: FOE, cause: 'duel', killerId: PLAYER }]);
    expect(ops(o.effects, 'changeOpinion')[0]).toMatchObject({ amount: t.outcome.killOpinion, reason: 'duelKilled' });
    expect(ops(o.effects, 'woundCharacter').filter((e) => e['charId'] === FOE)).toEqual([]);
  });

  it('a kill is refused outside a duel to the death or after quarter; capture outside the capture origins', () => {
    expect(choiceProblem(setup(), t, world(), 'a', 'down', 'kill')).not.toBeNull();
    expect(choiceProblem(setup({}, 'death'), t, world(), 'a', 'yield', 'kill')).not.toBeNull();
    expect(choiceProblem(setup({}, 'death'), t, world(), 'a', 'down', 'kill')).toBeNull();
    expect(choiceProblem(setup({ origin: 'tavern' }), t, world(), 'a', 'down', 'capture')).not.toBeNull();
    expect(choiceProblem(setup(), t, world({ factionOf: { a: undefined, b: 'fac_2' } }), 'a', 'down', 'capture')).not.toBeNull();
    // decideOutcome falls back to sparing on a refused choice.
    expect(decide(setup(), fight(), { choice: 'kill' }).result.loserFate).toBe('spared');
  });

  it('capture: the foe goes to the winner’s house and settlement', () => {
    const o = decide(setup(), fight(), { choice: 'capture' });
    expect(o.result.loserFate).toBe('captured');
    expect(ops(o.effects, 'capture')).toEqual([{ op: 'capture', charId: FOE, captorFactionId: 'fac_1', at: 'set_1' }]);
  });

  it('taunts pay Renown on a win (capped); a champion earns half; Favor is left to faith (§22.6 deeds)', () => {
    expect(decide(setup(), fight({ tauntsLanded: { a: 3, b: 0 } })).result.renown).toBe(20 + t.outcome.tauntBonusMax * b.duel.moves.taunt.renownOnWin);
    expect(decide(setup({ champion: true }), fight()).result.renown).toBe(Math.round(20 * t.outcome.championRenownMult));
    const h = decide(setup({ arena: 'holmgang', origin: 'thing' }), fight());
    // Eidr's Favor for a won duel or holmgang is the faith module's deed (it reacts to DuelEnded): no double grant.
    expect(ops(h.effects, 'changeFavor')).toEqual([]);
  });

  it('XP: 50 + 10 × the opponent’s level for the winner', () => {
    const s = setup();
    s.profiles!.b.level = 4;
    expect(decide(s, fight()).result.xp).toEqual({ [PLAYER]: b.xp.sources.duelWinBase + b.xp.sources.duelWinPerLevel * 4 });
  });
});

describe('§14.9 the player loses', () => {
  it('spared: Renown − (half the Duel Renown), injury roll, possible capture', () => {
    const o = decide(setup(), fight({ winner: 'b', hpPct: { a: 0, b: 70 } }), { rng: scripted({ chances: [false, false], ints: [50] }) });
    expect(o.result.loserFate).toBe('spared');
    expect(o.result.renown).toBe(-Math.round(20 * t.outcome.loseRenownMult));
    expect(o.result.injuries).toEqual([{ charId: PLAYER, injury: 'brokenHand' }]);
    expect(ops(o.effects, 'woundCharacter')).toEqual([{ op: 'woundCharacter', charId: PLAYER, wound: 'minor', cause: 'duel', injury: 'brokenHand' }]);
    const captured = decide(setup(), fight({ winner: 'b' }), { rng: scripted({ chances: [true] }) });
    expect(captured.result.loserFate).toBe('captured');
    expect(ops(captured.effects, 'capture')[0]).toMatchObject({ charId: PLAYER, captorFactionId: 'fac_2', at: 'set_2' });
  });

  it('lethal: death only in a duel to the death without mercy; Gentle Mode captures the player instead', () => {
    const dead = decide(setup({}, 'death'), fight({ winner: 'b' }), { rng: scripted({ chances: [false] }) });
    expect(dead.result.loserFate).toBe('killed');
    expect(ops(dead.effects, 'kill')[0]).toMatchObject({ charId: PLAYER });
    expect(dead.chronicle?.textKey).toBe('duel.chronicle.lost.killed');
    expect(dead.notify?.priority).toBe('high');
    const gentle = decide(setup({ gentle: true }, 'death'), fight({ winner: 'b' }), { rng: scripted({ chances: [false] }) });
    expect(gentle.result.loserFate).toBe('captured');
    expect(ops(gentle.effects, 'kill')).toEqual([]);
    const gentleTavern = decide(setup({ gentle: true, origin: 'tavern' }, 'death'), fight({ winner: 'b' }), { rng: scripted({ chances: [false] }) });
    expect(gentleTavern.result.loserFate).toBe('spared');
    const merciful = decide(setup({}, 'death'), fight({ winner: 'b' }), { rng: scripted({ chances: [true, false] }) });
    expect(merciful.result.loserFate).toBe('spared');
    const notToDeath = decide(setup({}, 'yield'), fight({ winner: 'b' }), { rng: scripted({ chances: [false] }) });
    expect(notToDeath.result.loserFate).toBe('spared');
  });

  it('a champion can die even in Gentle Mode (it protects only the player character)', () => {
    const s = setup({ gentle: true, champion: true }, 'death');
    const o = decide(s, fight({ winner: 'b' }), { rng: scripted({ chances: [false] }), world: world({ playerRulerId: 'chr_1' }) });
    expect(o.result.loserFate).toBe('killed');
  });
});

describe('§22.5 injuries from duels', () => {
  it('maps rows to people ops: a trait, a temporary injury, a mortal wound; the loser is always at least lightly wounded', () => {
    const scar = decide(setup(), fight({ winner: 'b' }), { rng: scripted({ chances: [false, false], ints: [40] }) });
    expect(ops(scar.effects, 'addTrait')).toEqual([{ op: 'addTrait', charId: PLAYER, trait: 'scarred' }]);
    expect(ops(scar.effects, 'woundCharacter')).toEqual([{ op: 'woundCharacter', charId: PLAYER, wound: 'minor', cause: 'duel' }]);
    const mortal = decide(setup(), fight({ winner: 'b' }), { rng: scripted({ chances: [false, false], ints: [99] }) });
    expect(ops(mortal.effects, 'woundCharacter')).toEqual([{ op: 'woundCharacter', charId: PLAYER, wound: 'mortal', cause: 'duel', injury: 'mortalWound' }]);
    const none = decide(setup(), fight({ winner: 'b' }), { rng: scripted({ chances: [false, false], ints: [5] }) });
    expect(none.result.injuries).toEqual([]);
    expect(ops(none.effects, 'woundCharacter')).toHaveLength(1);
  });

  it('the winner rolls 20% in auto-resolve; in a fought duel the chance scales with the HP it lost', () => {
    const auto = decide(setup(), fight({ hpPct: { a: 100, b: 0 } }), { mode: 'auto', rng: scripted({ ints: [5, 40], chances: [true] }) });
    expect(auto.result.injuries).toContainEqual({ charId: PLAYER, injury: 'scar' });
    let hurt = 0;
    const rng = new Rng('winner-injury');
    for (let i = 0; i < 2000; i++) {
      const o = decide(setup(), fight({ hpPct: { a: 100, b: 0 } }), { rng });
      if (o.result.injuries.some((x) => x.charId === PLAYER)) hurt += 1;
    }
    expect(hurt).toBe(0);
    let hurtLow = 0;
    for (let i = 0; i < 4000; i++) {
      const o = decide(setup(), fight({ hpPct: { a: 30, b: 0 } }), { rng });
      if (o.result.injuries.some((x) => x.charId === PLAYER)) hurtLow += 1;
    }
    // 20% chance × 70% of rows that are an injury.
    expect(hurtLow / 4000).toBeGreaterThan(0.11);
    expect(hurtLow / 4000).toBeLessThan(0.17);
  });

  it('practice bouts: no injuries, no Renown, a little XP for both', () => {
    const o = decide(setup({ origin: 'practice' }), fight(), { choice: 'kill' });
    expect(o.result.loserFate).toBe('spared');
    expect(o.result.injuries).toEqual([]);
    expect(o.result.renown).toBe(0);
    expect(o.effects).toEqual([]);
    expect(o.result.xp).toEqual({ [PLAYER]: t.outcome.practiceXp, [FOE]: t.outcome.practiceXp });
    expect(o.chronicle).toBeNull();
    expect(o.notify?.key).toBe('duel.notify.practice');
  });

  it('NPC duels change no standings and write no chronicle', () => {
    const s = setup({ playerSide: null });
    const o = decide(s, fight(), { rng: scripted({ chances: [false, false, false] }) });
    expect(ops(o.effects, 'changeRenown')).toEqual([]);
    expect(o.chronicle).toBeNull();
    expect(o.notify).toBeNull();
  });
});
