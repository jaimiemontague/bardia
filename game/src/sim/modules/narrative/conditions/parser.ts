/**
 * Pratt parser of the condition language (design §29.7): tokens → AST. No `eval`, ever.
 *
 * Precedence (loosest first):  ||  →  &&  →  == !=  →  < <= > >=  →  + -  →  * / %  →  prefix ! -
 * Binary operators are left-associative; equality and comparison are NON-associative (`a < b < c` is a
 * syntax error: write `a < b && b < c`). Primaries: number, string, true/false/null, paths
 * (`settlement.economy`, `player.house.favor.valgrim`), function calls (`hasTrait(ruler.id, 'brave')`) and
 * parenthesised expressions.
 */
import { ConditionSyntaxError, tokenize, type Token } from './lexer';

export type BinaryOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%';
export type UnaryOp = '!' | '-';
export type LiteralValue = number | string | boolean | null;

export type Expr =
  | { kind: 'literal'; value: LiteralValue; pos: number }
  | { kind: 'path'; root: string; segments: string[]; pos: number }
  | { kind: 'call'; name: string; args: Expr[]; pos: number }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; pos: number }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: number };

/** Maximum nesting depth (guards the recursive descent against pathological input). */
export const MAX_NESTING = 48;
/** Maximum arguments per function call. */
export const MAX_ARGS = 8;

interface InfixInfo {
  bp: number;
  nonAssoc: boolean;
}

const INFIX: Readonly<Record<string, InfixInfo>> = {
  '||': { bp: 10, nonAssoc: false },
  '&&': { bp: 20, nonAssoc: false },
  '==': { bp: 30, nonAssoc: true },
  '!=': { bp: 30, nonAssoc: true },
  '<': { bp: 40, nonAssoc: true },
  '<=': { bp: 40, nonAssoc: true },
  '>': { bp: 40, nonAssoc: true },
  '>=': { bp: 40, nonAssoc: true },
  '+': { bp: 50, nonAssoc: false },
  '-': { bp: 50, nonAssoc: false },
  '*': { bp: 60, nonAssoc: false },
  '/': { bp: 60, nonAssoc: false },
  '%': { bp: 60, nonAssoc: false },
};
const PREFIX_BP = 70;

class Parser {
  private i = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.i] as Token;
  }

  private next(): Token {
    const t = this.tokens[this.i] as Token;
    if (t.kind !== 'eof') this.i++;
    return t;
  }

  private error(message: string, pos: number): never {
    throw new ConditionSyntaxError(message, pos, this.source);
  }

  private describe(t: Token): string {
    if (t.kind === 'eof') return 'end of expression';
    if (t.kind === 'string') return 'a string';
    if (t.kind === 'number') return `number ${t.value}`;
    return `'${t.value}'`;
  }

  private expectPunct(value: string): Token {
    const t = this.peek();
    if (t.kind !== 'punct' || t.value !== value) this.error(`expected '${value}' but found ${this.describe(t)}`, t.pos);
    return this.next();
  }

  parse(): Expr {
    if (this.peek().kind === 'eof') this.error('empty expression', 0);
    const e = this.expr(0);
    const t = this.peek();
    if (t.kind !== 'eof') this.error(`unexpected ${this.describe(t)} after a complete expression`, t.pos);
    return e;
  }

  private expr(minBp: number): Expr {
    if (++this.depth > MAX_NESTING) this.error(`expression nested deeper than ${MAX_NESTING} levels`, this.peek().pos);
    try {
      let left = this.prefix();
      for (;;) {
        const t = this.peek();
        if (t.kind !== 'op') break;
        const info = INFIX[t.value];
        if (info === undefined) this.error(`unexpected ${this.describe(t)}`, t.pos);
        if (info.bp <= minBp) break;
        this.next();
        const right = this.expr(info.bp);
        left = { kind: 'binary', op: t.value as BinaryOp, left, right, pos: t.pos };
        if (info.nonAssoc) {
          const n = this.peek();
          if (n.kind === 'op' && INFIX[n.value]?.bp === info.bp) {
            this.error(`'${t.value}' cannot be chained with '${n.value}'; combine comparisons with && and parentheses`, n.pos);
          }
        }
      }
      return left;
    } finally {
      this.depth--;
    }
  }

  private prefix(): Expr {
    const t = this.next();
    switch (t.kind) {
      case 'number':
        return { kind: 'literal', value: t.num as number, pos: t.pos };
      case 'string':
        return { kind: 'literal', value: t.value, pos: t.pos };
      case 'ident':
        return this.identifier(t);
      case 'op':
        if (t.value === '!' || t.value === '-') {
          const operand = this.expr(PREFIX_BP);
          // Fold `-12` into a literal so negative constants stay literals (statically checkable arguments).
          if (t.value === '-' && operand.kind === 'literal' && typeof operand.value === 'number') {
            return { kind: 'literal', value: -operand.value, pos: t.pos };
          }
          return { kind: 'unary', op: t.value, operand, pos: t.pos };
        }
        return this.error(`unexpected ${this.describe(t)}`, t.pos);
      case 'punct':
        if (t.value === '(') {
          if (this.peek().kind === 'punct' && this.peek().value === ')') this.error('empty parentheses', this.peek().pos);
          const inner = this.expr(0);
          this.expectPunct(')');
          return inner;
        }
        return this.error(`unexpected ${this.describe(t)}`, t.pos);
      default:
        return this.error('unexpected end of expression', t.pos);
    }
  }

  private identifier(t: Token): Expr {
    if (t.value === 'true') return { kind: 'literal', value: true, pos: t.pos };
    if (t.value === 'false') return { kind: 'literal', value: false, pos: t.pos };
    if (t.value === 'null') return { kind: 'literal', value: null, pos: t.pos };
    const after = this.peek();
    if (after.kind === 'punct' && after.value === '(') {
      this.next();
      const args: Expr[] = [];
      if (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
        for (;;) {
          if (args.length >= MAX_ARGS) this.error(`more than ${MAX_ARGS} arguments`, this.peek().pos);
          args.push(this.expr(0));
          const sep = this.peek();
          if (sep.kind === 'punct' && sep.value === ',') {
            this.next();
            continue;
          }
          break;
        }
      }
      this.expectPunct(')');
      const dot = this.peek();
      if (dot.kind === 'punct' && dot.value === '.') this.error('a function result has no fields', dot.pos);
      return { kind: 'call', name: t.value, args, pos: t.pos };
    }
    const segments: string[] = [];
    while (this.peek().kind === 'punct' && this.peek().value === '.') {
      this.next();
      const seg = this.next();
      if (seg.kind !== 'ident') this.error(`expected a field name after '.' but found ${this.describe(seg)}`, seg.pos);
      segments.push(seg.value);
    }
    return { kind: 'path', root: t.value, segments, pos: t.pos };
  }
}

/** Parses a condition-language expression into an AST. Throws ConditionSyntaxError. */
export function parseExpression(source: string): Expr {
  return new Parser(tokenize(source), source).parse();
}

/** Renders an AST back to a fully parenthesised expression (tests and diagnostics). */
export function printExpression(e: Expr): string {
  switch (e.kind) {
    case 'literal':
      return typeof e.value === 'string' ? `'${e.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(e.value);
    case 'path':
      return [e.root, ...e.segments].join('.');
    case 'call':
      return `${e.name}(${e.args.map(printExpression).join(', ')})`;
    case 'unary':
      return `(${e.op}${printExpression(e.operand)})`;
    case 'binary':
      return `(${printExpression(e.left)} ${e.op} ${printExpression(e.right)})`;
  }
}
