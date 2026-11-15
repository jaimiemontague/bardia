import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { SimModule } from '@sim/core/module';
import { Rng } from '@sim/core/rng';
import type { GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { testState } from '../../../testing';
import { narrativeTestEnv } from '../testing';
import { compileSource, evaluate } from './compile';
import { ConditionRuntimeError, type EvalScope } from './scope';

let counterCalls = 0;
const testFnModule: SimModule = {
  id: 'testNarrativeFns',
  order: 141,
  conditionFns: {
    testCounter: { args: z.tuple([]), returns: 'number', evaluate: () => ++counterCalls },
    testEcho: { args: z.tuple([z.number()]), returns: 'number', evaluate: ([x]) => x as number },
    testObject: { args: z.tuple([]), returns: 'number', evaluate: () => ({ a: 1 }) },
  },
};

const { env, module } = narrativeTestEnv({ modules: [testFnModule] });
const base: GameState = testState({ modules: [module, testFnModule] });

function mutable(): GameState {
  return structuredClone(base) as GameState;
}

function scope(state: GameState = base, extra: Partial<EvalScope> = {}): EvalScope {
  return { state, env, scope: { settlement: state.player.capitalId, holding: state.player.capitalId, faction: state.player.factionId }, ...extra };
}

const ev = (src: string, s: EvalScope = scope()) => evaluate(src, s);

describe('evaluator: operators', () => {
  it('arithmetic on numbers; anything else or a non-finite result is null', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('7 / 2')).toBe(3.5);
    expect(ev('7 % 4')).toBe(3);
    expect(ev('-(2 + 3)')).toBe(-5);
    expect(ev('1 / 0')).toBeNull();
    expect(ev('5 % 0')).toBeNull();
    expect(ev(`'a' + 1`)).toBeNull();
    expect(ev('vars.missing * 2')).toBeNull();
    expect(ev('-vars.missing')).toBeNull();
  });

  it('comparisons compare numbers only; equality is strict', () => {
    expect(ev('2 > 1')).toBe(true);
    expect(ev('2 <= 2')).toBe(true);
    expect(ev(`'b' > 'a'`)).toBe(false);
    expect(ev('null < 1')).toBe(false);
    expect(ev(`1 == '1'`)).toBe(false);
    expect(ev('null == null')).toBe(true);
    expect(ev('vars.missing == null')).toBe(true);
    expect(ev(`'x' != 'y'`)).toBe(true);
  });

  it('logic uses truthiness, returns booleans and short-circuits', () => {
    expect(ev(`0 || ''`)).toBe(false);
    expect(ev('!0')).toBe(true);
    expect(ev(`'x' && 1`)).toBe(true);
    counterCalls = 0;
    expect(ev('false && testCounter() > 0')).toBe(false);
    expect(ev('true || testCounter() > 0')).toBe(true);
    expect(counterCalls).toBe(0);
    expect(ev('true && testCounter() > 0')).toBe(true);
    expect(counterCalls).toBe(1);
  });

  it('intrinsics take numbers only', () => {
    expect(ev('max(1, 5, 3)')).toBe(5);
    expect(ev('min(4, 2)')).toBe(2);
    expect(ev('clamp(15, 0, 10)')).toBe(10);
    expect(ev('clamp(-1, 0, 10)')).toBe(0);
    expect(ev('floor(2.7) + ceil(2.1) + round(2.5) + abs(-3)')).toBe(2 + 3 + 3 + 3);
    expect(ev(`min(1, 'a')`)).toBeNull();
    expect(ev('min(1)')).toBeNull();
  });
});

describe('evaluator: paths', () => {
  it('reads kernel fields and virtual fields', () => {
    const s = base;
    const ruler = s.characters[s.player.rulerId];
    const capital = s.settlements[s.player.capitalId];
    expect(ev('ruler.age')).toBe(16);
    expect(ev('ruler.isRuler')).toBe(true);
    expect(ev('ruler.name')).toBe(ruler?.name);
    expect(ev('ruler.attributes.might')).toBe(ruler?.attributes.might);
    expect(ev('ruler.skills.seafaring')).toBe(ruler?.skills.seafaring);
    expect(ev('player.treasury')).toBe(s.factions[s.player.factionId]?.treasury);
    expect(ev('house.favor.valgrim')).toBe(s.player.house.favor.valgrim);
    expect(ev('settlement.economy')).toBe(capital?.economy);
    expect(ev('settlement.isPlayerHolding')).toBe(true);
    expect(ev('settlement.isCapital')).toBe(true);
    expect(ev('holding.loyalty')).toBe(capital?.holding?.loyalty);
    expect(ev('player.capital.name')).toBe(capital?.name);
    expect(ev('faction.isPlayer')).toBe(true);
    expect(ev('time.season')).toBe('spring');
    expect(ev('time.year')).toBe(812);
    expect(ev('time.month')).toBe(0);
    expect(ev('time.day')).toBe(1);
  });

  it('records default to 0, entities evaluate to their id, missing things are null', () => {
    expect(ev('settlement.buildings.noSuchBuilding')).toBe(0);
    expect(ev('settlement')).toBe(base.player.capitalId);
    expect(ev('ruler')).toBe(base.player.rulerId);
    expect(ev('faction.ruler')).toBe(base.player.rulerId);
    expect(ev('house.favor')).toBeNull();
    expect(ev('fleet.rations')).toBeNull();
    expect(ev('character.age')).toBeNull();
    expect(ev('ruler.spouse.name')).toBeNull();
    expect(ev('noSuchRoot.x')).toBeNull();
    expect(ev('vars.cost', scope(base, { vars: { cost: 40 } }))).toBe(40);
    expect(ev('event.voyageDays', scope(base, { event: { voyageDays: 4, nested: { x: 'y' } } }))).toBe(4);
    expect(ev('event.nested.x', scope(base, { event: { nested: { x: 'y' } } }))).toBe('y');
  });

  it('sees state changes (the same compiled expression re-reads state)', () => {
    const f = compileSource('settlement.economy == "thriving"');
    const s = mutable();
    expect(f(scope(s))).toBe(false);
    (s.settlements[s.player.capitalId] as { economy: string }).economy = 'thriving';
    expect(f(scope(s))).toBe(true);
  });
});

describe('evaluator: registered functions', () => {
  it('calls core functions with validated arguments', () => {
    const s = mutable();
    expect(ev(`flag('raided')`, scope(s))).toBe(false);
    s.flags.raided = 3;
    expect(ev(`flag('raided') == 3`, scope(s))).toBe(true);
    expect(ev(`season()`)).toBe('spring');
    expect(ev(`opinion(player.factionId, 'fac_999')`)).toBe(0);
    expect(ev('testEcho(2 + 2)')).toBe(4);
  });

  it('throws ConditionRuntimeError for unknown functions and invalid arguments', () => {
    expect(() => ev('noSuchFn()')).toThrow(ConditionRuntimeError);
    expect(() => ev('flag(1)')).toThrow(/flag\(1\)/);
    expect(() => ev(`testEcho('a')`)).toThrow(ConditionRuntimeError);
  });

  it('non-scalar results become null', () => {
    expect(ev('testObject()')).toBeNull();
  });

  it('rand() draws from the scope rng deterministically; 0.5 without one', () => {
    const a = new Rng('seed-a');
    const b = new Rng('seed-a');
    const xs = [0, 1, 2].map(() => ev('rand()', scope(base, { rng: a })));
    const ys = [0, 1, 2].map(() => ev('rand()', scope(base, { rng: b })));
    expect(xs).toEqual(ys);
    for (const x of xs) expect(x as number).toBeGreaterThanOrEqual(0);
    expect(new Set(xs).size).toBe(3);
    expect(ev('rand()')).toBe(0.5);
  });

  it('daysSince() reads marks and returns neverDays for unknown keys', () => {
    const s = mutable();
    expect(ev(`daysSince('boundaryStone')`, scope(s))).toBe(env.content.tunables.narrative.neverDays);
    s.storylets.marks = { boundaryStone: 0, 'chronicle:raid': 0 };
    s.time.hour = 10 * HOURS_PER_DAY + 5;
    expect(ev(`daysSince('boundaryStone')`, scope(s))).toBe(10);
    expect(ev(`daysSince('chronicle:raid') >= 10`, scope(s))).toBe(true);
  });

  it('count() counts realm collections and tallies', () => {
    const s = mutable();
    expect(ev(`count('holdings')`, scope(s))).toBe(1);
    expect(ev(`count('children')`, scope(s))).toBe(0);
    expect(ev(`count('wars')`, scope(s))).toBe(0);
    expect(ev(`count('fired', 'drunkenBoast')`, scope(s))).toBe(0);
    s.storylets.tallies = { drunkenBoast: 2, 'chronicle:raid': 5, BattleEnded: 1 };
    expect(ev(`count('fired', 'drunkenBoast')`, scope(s))).toBe(2);
    expect(ev(`count('chronicle', 'raid')`, scope(s))).toBe(5);
    expect(ev(`count('event', 'BattleEnded')`, scope(s))).toBe(1);
    expect(() => ev(`count('fired')`, scope(s))).toThrow(ConditionRuntimeError);
    expect(() => ev(`count('holdings', 'x')`, scope(s))).toThrow(ConditionRuntimeError);
  });
});
