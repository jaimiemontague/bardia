import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { SimModule } from '@sim/core/module';
import { narrativeTestEnv } from '../testing';
import { checkExpression, suggest } from './checker';
import { argShape, zodLeafKind } from './functions';
import { checkPath } from './paths';

const testFns: SimModule = {
  id: 'testCheckerFns',
  order: 142,
  conditionFns: {
    hasTrait: { args: z.tuple([z.string().regex(/^chr_/), z.string().min(1)]), returns: 'boolean', evaluate: () => false },
    testVariadic: { args: z.array(z.number()).min(1), returns: 'number', evaluate: () => 0 },
  },
};
const { env } = narrativeTestEnv({ modules: [testFns] });
const ROOTS = ['player', 'house', 'ruler', 'time', 'vars', 'settlement', 'holding', 'faction'];

const issues = (src: string, roots: readonly string[] = ROOTS, extra: { expect?: 'boolean' | 'number' | 'string' | 'any'; forbid?: string[] } = {}) =>
  checkExpression(src, { env, roots, ...extra }).issues;

describe('checker: valid expressions', () => {
  it('accepts well-typed conditions without issues', () => {
    for (const src of [
      `settlement.economy == 'thriving' && holding.loyalty < 40`,
      `player.house.favor.valgrim > 10 || house.renown >= 100`,
      `season() == 'winter' && flag('raided')`,
      `hasTrait(ruler.id, 'brave') && ruler.age >= 16`,
      `hasTrait(ruler, 'brave')`,
      `opinion(player.factionId, faction.id) < -20`,
      `daysSince('boundaryStone') > 90 && count('holdings') >= 2 && rand() < 0.5`,
      `count('fired', 'drunkenBoast') == 0`,
      `max(1, floor(holding.pop / 50)) > 0`,
      `vars.anything == 3 && vars.other != 'x'`,
      `settlement.buildings.smithy >= 2 && ruler.skills.seafaring > 3`,
      `faction.ruler.age > 60 && !faction.atWar`,
      `time.season == 'summer' && time.month >= 3`,
      `testVariadic(1, 2, 3) > 0`,
    ]) {
      expect({ src, issues: issues(src, ROOTS, { expect: 'boolean' }) }).toEqual({ src, issues: [] });
    }
  });

  it('infers result types', () => {
    expect(checkExpression('1 + 2', { env, roots: ROOTS }).type.kind).toBe('number');
    expect(checkExpression('settlement.economy', { env, roots: ROOTS }).type).toMatchObject({ kind: 'string', values: expect.arrayContaining(['thriving']) });
    expect(checkExpression('ruler', { env, roots: ROOTS }).type.kind).toBe('string');
    expect(checkExpression('vars.x', { env, roots: ROOTS }).type.kind).toBe('any');
    expect(checkExpression(`flag('x')`, { env, roots: ROOTS }).type.kind).toBe('boolean');
  });
});

describe('checker: errors', () => {
  it('reports syntax errors with a column', () => {
    expect(issues('a &&')[0]).toMatch(/^syntax: .*column/);
  });

  it('reports roots not bound in this context', () => {
    expect(issues('fleet.rations > 0')[0]).toMatch(/'fleet' is not available here/);
    expect(issues('event.voyageDays > 3')[0]).toMatch(/'event' is not available/);
    expect(issues('setlement.pop > 0')[0]).toMatch(/did you mean 'settlement'/);
  });

  it('reports unknown fields and keys with suggestions, and paths that end at objects', () => {
    expect(issues('settlement.ecnomy == 1')[0]).toMatch(/has no field 'ecnomy'.*did you mean 'economy'/);
    expect(issues('house.favor.valgrin > 0')[0]).toMatch(/has no key 'valgrin'.*did you mean 'valgrim'/);
    expect(issues('ruler.skills.sailing > 0')[0]).toMatch(/has no key 'sailing'/);
    expect(issues('ruler.age.years > 0')[0]).toMatch(/is a number; it has no field 'years'/);
    expect(issues('house.favor > 0')[0]).toMatch(/is not a value; pick a field/);
    expect(issues('ruler.attributes == 1')[0]).toMatch(/is not a value/);
  });

  it('reports unknown functions, arity and invalid literal arguments', () => {
    expect(issues('hasTrat(ruler, "x")')[0]).toMatch(/unknown function 'hasTrat'.*did you mean 'hasTrait'/);
    expect(issues('flag()')[0]).toMatch(/flag\(\) takes 1 argument\(s\), got 0/);
    expect(issues('season(1)')[0]).toMatch(/takes 0 argument/);
    expect(issues('flag(1)')[0]).toMatch(/flag\(\): argument 1/);
    expect(issues(`count('ships')`)[0]).toMatch(/count\(\)/);
    expect(issues(`count('fired')`)[0]).toMatch(/count\(\)/);
    expect(issues(`count('holdings', 'x', 'y')`)[0]).toMatch(/takes 1–2 argument/);
    expect(issues(`hasTrait('set_1', 'brave')`)[0]).toMatch(/hasTrait\(\): argument 1/);
    expect(issues(`hasTrait(ruler.id, 3)`)[0]).toMatch(/argument 2/);
    expect(issues(`hasTrait(ruler.age, 'brave')`)[0]).toMatch(/argument 1 must be a string, got number/);
    expect(issues('testVariadic()')[0]).toMatch(/at least 1/);
    expect(issues('min(1)')[0]).toMatch(/min\(\) takes 2–8/);
    expect(issues(`floor('a')`)[0]).toMatch(/takes numbers/);
  });

  it('reports forbidden functions', () => {
    expect(issues('rand() < 0.5', ROOTS, { forbid: ['rand'] })[0]).toMatch(/rand\(\) is not allowed here/);
  });

  it('reports type errors', () => {
    expect(issues(`settlement.pop == 'big'`)[0]).toMatch(/compares a number with a string/);
    expect(issues(`settlement.name < 3`)[0]).toMatch(/compares numbers, got string/);
    expect(issues(`settlement.name + 1 > 0`)[0]).toMatch(/needs numbers/);
    expect(issues(`-settlement.name == 1`)[0]).toMatch(/unary '-' needs a number/);
    expect(issues(`settlement.economy == 'thrivng'`)[0]).toMatch(/'thrivng' is not a possible value.*did you mean 'thriving'/);
    expect(issues(`'prosperous' != settlement.economy`)[0]).toMatch(/not a possible value/);
    expect(issues(`time.season == 'monsoon'`)[0]).toMatch(/not a possible value/);
  });

  it('checks the expected result kind', () => {
    expect(issues('holding.pop', ROOTS, { expect: 'boolean' })[0]).toMatch(/must be true or false/);
    expect(issues('holding.pop > 0', ROOTS, { expect: 'number' })[0]).toMatch(/expected a number, got boolean/);
    expect(issues('vars.x', ROOTS, { expect: 'boolean' })).toEqual([]);
  });
});

describe('checker helpers', () => {
  it('suggest() finds close names only', () => {
    expect(suggest('economi', ['economy', 'pop'])).toBe(" (did you mean 'economy'?)");
    expect(suggest('zzz', ['economy'])).toBe('');
  });

  it('argShape() introspects tuples, unions and arrays', () => {
    expect(argShape(z.tuple([z.string(), z.number()]))).toMatchObject({ min: 2, max: 2 });
    expect(argShape(z.tuple([z.string()]).rest(z.number()))).toMatchObject({ min: 1, max: Number.POSITIVE_INFINITY });
    expect(argShape(z.union([z.tuple([z.string()]), z.tuple([z.string(), z.string()])]))).toMatchObject({ min: 1, max: 2 });
    expect(argShape(z.array(z.number()).min(1).max(3))).toMatchObject({ min: 1, max: 3 });
    expect(argShape(z.tuple([z.string()]).refine(() => true))).toMatchObject({ min: 1, max: 1 });
    expect(argShape(z.string())).toBeUndefined();
  });

  it('zodLeafKind() names the accepted scalar kind', () => {
    expect(zodLeafKind(z.string().min(1))).toBe('string');
    expect(zodLeafKind(z.enum(['a', 'b']))).toBe('string');
    expect(zodLeafKind(z.number().optional())).toBe('number');
    expect(zodLeafKind(z.literal(true))).toBe('boolean');
    expect(zodLeafKind(z.union([z.string(), z.number()]))).toBe('any');
  });

  it('checkPath() handles every root kind', () => {
    const none = () => '';
    expect(checkPath('event', ['anything', 'deep'], none)).toEqual({ ok: true, type: 'any' });
    expect(checkPath('character', ['spouse', 'faction', 'name'], none)).toEqual({ ok: true, type: 'string' });
    expect(checkPath('fleet', ['cargo', 'iron'], none)).toEqual({ ok: true, type: 'number' });
    expect(checkPath('fleet', ['cargo', 'gold'], none)).toMatchObject({ ok: false });
    expect(checkPath('player', ['policies', 'petitions'], none)).toEqual({ ok: true, type: 'string' });
    expect(checkPath('settlement', ['buildings', '__proto__'], none)).toMatchObject({ ok: false });
  });
});
