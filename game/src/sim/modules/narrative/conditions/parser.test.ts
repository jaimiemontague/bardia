import { describe, expect, it } from 'vitest';
import { ConditionSyntaxError, MAX_EXPRESSION_LENGTH, tokenize } from './lexer';
import { MAX_ARGS, MAX_NESTING, parseExpression, printExpression } from './parser';

const p = (src: string) => printExpression(parseExpression(src));

function syntaxError(src: string): ConditionSyntaxError {
  try {
    parseExpression(src);
  } catch (e) {
    expect(e).toBeInstanceOf(ConditionSyntaxError);
    return e as ConditionSyntaxError;
  }
  throw new Error(`expected a syntax error for: ${src}`);
}

describe('lexer', () => {
  it('tokenizes numbers, strings, identifiers, operators and punctuation with positions', () => {
    const toks = tokenize(`a.b >= 12.5 && f('x', "y\\"z") || !c`);
    expect(toks.map((t) => [t.kind, t.value])).toEqual([
      ['ident', 'a'],
      ['punct', '.'],
      ['ident', 'b'],
      ['op', '>='],
      ['number', '12.5'],
      ['op', '&&'],
      ['ident', 'f'],
      ['punct', '('],
      ['string', 'x'],
      ['punct', ','],
      ['string', 'y"z'],
      ['punct', ')'],
      ['op', '||'],
      ['op', '!'],
      ['ident', 'c'],
      ['eof', ''],
    ]);
    expect(toks[4]?.num).toBe(12.5);
    expect(toks[3]?.pos).toBe(4);
  });

  it('decodes escapes and rejects malformed input with helpful messages', () => {
    expect(tokenize(`'a\\nb\\t\\\\'`)[0]?.value).toBe('a\nb\t\\');
    expect(() => tokenize(`'open`)).toThrow(/unterminated string/);
    expect(() => tokenize('a & b')).toThrow(/use '&&'/);
    expect(() => tokenize('a | b')).toThrow(/use '\|\|'/);
    expect(() => tokenize('a = b')).toThrow(/use '=='/);
    expect(() => tokenize('12abc')).toThrow(/malformed number/);
    expect(() => tokenize('a # b')).toThrow(/unexpected character '#'/);
    expect(() => tokenize(`'\\q'`)).toThrow(/unknown escape/);
    expect(() => tokenize('x'.repeat(MAX_EXPRESSION_LENGTH + 1))).toThrow(/longer than/);
  });
});

describe('parser: precedence and associativity', () => {
  it('|| binds looser than &&, which binds looser than comparisons', () => {
    expect(p('a || b && c')).toBe('(a || (b && c))');
    expect(p('a && b || c')).toBe('((a && b) || c)');
    expect(p('a == 1 && b < 2 || c')).toBe('(((a == 1) && (b < 2)) || c)');
  });

  it('comparison binds looser than arithmetic; * / % bind tighter than + -', () => {
    expect(p('1 + 2 * 3 > 6')).toBe('((1 + (2 * 3)) > 6)');
    expect(p('a - b - c')).toBe('((a - b) - c)');
    expect(p('a / b * c % d')).toBe('(((a / b) * c) % d)');
    expect(p('a < b == true')).toBe('((a < b) == true)');
  });

  it('prefix operators bind tightest; negative literals fold', () => {
    expect(p('!a == b')).toBe('((!a) == b)');
    expect(p('!!a')).toBe('(!(!a))');
    expect(p('-2 * 3')).toBe('(-2 * 3)');
    expect(p('-x * 3')).toBe('((-x) * 3)');
    expect(parseExpression('-12')).toEqual({ kind: 'literal', value: -12, pos: 0 });
    expect(p('a - -1')).toBe('(a - -1)');
  });

  it('parentheses override precedence', () => {
    expect(p('(a || b) && c')).toBe('((a || b) && c)');
    expect(p('((1 + 2)) * 3')).toBe('((1 + 2) * 3)');
  });

  it('parses literals, dotted paths and calls with arguments', () => {
    expect(parseExpression('true')).toMatchObject({ kind: 'literal', value: true });
    expect(parseExpression('null')).toMatchObject({ kind: 'literal', value: null });
    expect(parseExpression(`'thriving'`)).toMatchObject({ kind: 'literal', value: 'thriving' });
    expect(parseExpression('player.house.favor.valgrim')).toEqual({ kind: 'path', root: 'player', segments: ['house', 'favor', 'valgrim'], pos: 0 });
    expect(parseExpression('settlement')).toEqual({ kind: 'path', root: 'settlement', segments: [], pos: 0 });
    expect(p(`hasTrait(ruler.id, 'brave') && season() == 'winter'`)).toBe(`(hasTrait(ruler.id, 'brave') && (season() == 'winter'))`);
    expect(p('max(1, min(a, 2) + 3)')).toBe('max(1, (min(a, 2) + 3))');
    expect(p(`f('it\\'s')`)).toBe(`f('it\\'s')`);
  });
});

describe('parser: errors', () => {
  it('rejects chained comparisons (non-associative)', () => {
    expect(syntaxError('a < b < c').message).toMatch(/cannot be chained/);
    expect(syntaxError('a == b != c').message).toMatch(/cannot be chained/);
    expect(syntaxError('a <= b >= c').message).toMatch(/cannot be chained/);
  });

  it('reports the column of the problem', () => {
    const e = syntaxError('a && && b');
    expect(e.pos).toBe(5);
    expect(e.message).toMatch(/column 6/);
    expect(e.caret()).toBe('a && && b\n     ^');
  });

  it('rejects empty, unbalanced and trailing input', () => {
    expect(syntaxError('').message).toMatch(/empty expression/);
    expect(syntaxError('   ').message).toMatch(/empty expression/);
    expect(syntaxError('(a && b').message).toMatch(/expected '\)'/);
    expect(syntaxError('a && b)').message).toMatch(/after a complete expression/);
    expect(syntaxError('a b').message).toMatch(/after a complete expression/);
    expect(syntaxError('()').message).toMatch(/empty parentheses/);
    expect(syntaxError('a &&').message).toMatch(/end of expression/);
    expect(syntaxError('f(a,)').message).toMatch(/unexpected/);
    expect(syntaxError('f(a').message).toMatch(/expected '\)'/);
    expect(syntaxError('a.').message).toMatch(/field name/);
    expect(syntaxError('a.1').message).toMatch(/field name/);
    expect(syntaxError('f().x').message).toMatch(/no fields/);
    expect(syntaxError('* a').message).toMatch(/unexpected '\*'/);
    expect(syntaxError(', a').message).toMatch(/unexpected ','/);
  });

  it('guards nesting depth and argument count', () => {
    expect(() => parseExpression(`${'('.repeat(MAX_NESTING - 1)}1${')'.repeat(MAX_NESTING - 1)}`)).not.toThrow();
    expect(syntaxError(`${'('.repeat(MAX_NESTING + 2)}1${')'.repeat(MAX_NESTING + 2)}`).message).toMatch(/nested deeper/);
    expect(syntaxError(`${'!'.repeat(MAX_NESTING + 2)}a`).message).toMatch(/nested deeper/);
    const args = Array.from({ length: MAX_ARGS + 1 }, (_, i) => String(i)).join(', ');
    expect(syntaxError(`f(${args})`).message).toMatch(/more than/);
  });
});
