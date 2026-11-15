/**
 * Static checker of the condition language (design §29.7: "paths are type-checked at content build"). Run at
 * content load against the SimEnv, so a typo fails in tests instead of when a player clicks:
 *   - syntax errors (with columns);
 *   - roots that the expression's context does not bind (a fleet path in a holding storylet);
 *   - unknown paths/fields/keys (with "did you mean" suggestions) and paths that end at an object;
 *   - unknown functions, wrong arity, literal arguments rejected by the function's zod schema, argument kinds
 *     that cannot match, functions forbidden in this context (rand() in a choice condition);
 *   - type errors: comparing a number with a string, ordering strings, arithmetic on non-numbers, a string
 *     literal that is not one of an enum field's values (`settlement.economy == 'thrivng'`);
 *   - the expression's result kind against what the context expects (a condition must be boolean).
 */
import type { SimEnv } from '@sim/core/module';
import { argShape, INTRINSICS, isIntrinsic, zodLeafKind } from './functions';
import { ConditionSyntaxError } from './lexer';
import { parseExpression, type Expr } from './parser';
import { checkPath, type LeafKind } from './paths';

/** Static type of an expression. `values` is the closed set of strings an enum field may hold. */
export interface StaticType {
  kind: LeafKind | 'null' | 'any';
  values?: readonly string[];
  /** The value of a string literal (for enum checks). */
  literal?: string;
}

export interface CheckOptions {
  env: SimEnv;
  /** Roots this expression may use. */
  roots: readonly string[];
  /** Required result kind (default 'any'). */
  expect?: LeafKind | 'any';
  /** Registered functions not allowed in this context (e.g. ['rand'] for choice conditions). */
  forbid?: readonly string[];
}

export interface CheckResult {
  /** The AST when the expression parsed. */
  ast?: Expr;
  type: StaticType;
  issues: string[];
}

/** Levenshtein distance (small strings only). */
function distance(a: string, b: string): number {
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] as number;
}

/** " (did you mean 'x'?)" for the closest option, or ''. */
export function suggest(name: string, options: readonly string[]): string {
  let best: string | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  const lower = name.toLowerCase();
  for (const o of options) {
    const d = distance(lower, o.toLowerCase());
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  const limit = Math.max(1, Math.floor(name.length / 3));
  return best !== undefined && bestD <= limit ? ` (did you mean '${best}'?)` : '';
}

const ANY: StaticType = { kind: 'any' };
const NUMBER: StaticType = { kind: 'number' };
const BOOLEAN: StaticType = { kind: 'boolean' };

class Checker {
  readonly issues: string[] = [];
  constructor(private readonly opts: CheckOptions) {}

  private issue(pos: number, message: string): void {
    this.issues.push(`col ${pos + 1}: ${message}`);
  }

  infer(e: Expr): StaticType {
    switch (e.kind) {
      case 'literal':
        if (e.value === null) return { kind: 'null' };
        if (typeof e.value === 'string') return { kind: 'string', literal: e.value };
        return { kind: typeof e.value === 'number' ? 'number' : 'boolean' };
      case 'path':
        return this.path(e);
      case 'call':
        return this.call(e);
      case 'unary': {
        const t = this.infer(e.operand);
        if (e.op === '!') return BOOLEAN;
        if (t.kind !== 'number' && t.kind !== 'any') this.issue(e.pos, `unary '-' needs a number, got ${t.kind}`);
        return NUMBER;
      }
      case 'binary':
        return this.binary(e);
    }
  }

  private path(e: Extract<Expr, { kind: 'path' }>): StaticType {
    if (!this.opts.roots.includes(e.root)) {
      this.issue(e.pos, `'${e.root}' is not available here (available: ${this.opts.roots.join(', ')})${suggest(e.root, this.opts.roots)}`);
      return ANY;
    }
    const r = checkPath(e.root, e.segments, suggest);
    if (!r.ok) {
      this.issue(e.pos, r.message);
      return ANY;
    }
    return r.values ? { kind: r.type, values: r.values } : { kind: r.type };
  }

  private call(e: Extract<Expr, { kind: 'call' }>): StaticType {
    const argTypes = e.args.map((a) => this.infer(a));
    const intrinsic = Object.hasOwn(INTRINSICS, e.name) ? INTRINSICS[e.name] : undefined;
    if (intrinsic) {
      if (e.args.length < intrinsic.minArgs || e.args.length > intrinsic.maxArgs) {
        const want = intrinsic.minArgs === intrinsic.maxArgs ? `${intrinsic.minArgs}` : `${intrinsic.minArgs}–${intrinsic.maxArgs}`;
        this.issue(e.pos, `${e.name}() takes ${want} argument(s), got ${e.args.length}`);
      }
      argTypes.forEach((t, i) => {
        if (t.kind !== 'number' && t.kind !== 'any') this.issue((e.args[i] as Expr).pos, `${e.name}() takes numbers, argument ${i + 1} is ${t.kind}`);
      });
      return NUMBER;
    }
    const entry = this.opts.env.conditionFns.get(e.name);
    if (!entry) {
      const names = [...this.opts.env.conditionFns.keys(), ...Object.keys(INTRINSICS)];
      this.issue(e.pos, `unknown function '${e.name}'${suggest(e.name, names)}`);
      return ANY;
    }
    if (this.opts.forbid?.includes(e.name)) this.issue(e.pos, `${e.name}() is not allowed here`);
    const fn = entry.fn;
    const shape = argShape(fn.args);
    if (shape && (e.args.length < shape.min || e.args.length > shape.max)) {
      const want = shape.min === shape.max ? `${shape.min}` : shape.max === Number.POSITIVE_INFINITY ? `at least ${shape.min}` : `${shape.min}–${shape.max}`;
      this.issue(e.pos, `${e.name}() takes ${want} argument(s), got ${e.args.length}`);
    } else if (e.args.every((a) => a.kind === 'literal')) {
      const parsed = fn.args.safeParse(e.args.map((a) => (a as Extract<Expr, { kind: 'literal' }>).value));
      if (!parsed.success) this.issue(e.pos, `${e.name}(): ${parsed.error.issues.map((i) => `${i.path.length > 0 ? `argument ${Number(i.path[0]) + 1}` : 'arguments'}: ${i.message}`).join('; ')}`);
    } else if (shape) {
      e.args.forEach((a, i) => {
        const schema = shape.at(i);
        if (!schema) return;
        if (a.kind === 'literal') {
          const r = schema.safeParse(a.value);
          if (!r.success) this.issue(a.pos, `${e.name}() argument ${i + 1}: ${r.error.issues.map((x) => x.message).join('; ')}`);
          return;
        }
        const want = zodLeafKind(schema);
        const got = argTypes[i] as StaticType;
        if (want !== 'any' && got.kind !== 'any' && got.kind !== 'null' && got.kind !== want) {
          this.issue(a.pos, `${e.name}() argument ${i + 1} must be a ${want}, got ${got.kind}`);
        }
      });
    }
    return { kind: fn.returns };
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>): StaticType {
    const l = this.infer(e.left);
    const r = this.infer(e.right);
    switch (e.op) {
      case '&&':
      case '||':
        return BOOLEAN;
      case '==':
      case '!=': {
        const known = (t: StaticType) => t.kind !== 'any' && t.kind !== 'null';
        if (known(l) && known(r) && l.kind !== r.kind) this.issue(e.pos, `'${e.op}' compares a ${l.kind} with a ${r.kind}`);
        this.enumCheck(e, l, r);
        this.enumCheck(e, r, l);
        return BOOLEAN;
      }
      case '<':
      case '<=':
      case '>':
      case '>=':
        for (const [t, side] of [
          [l, e.left],
          [r, e.right],
        ] as const) {
          if (t.kind !== 'number' && t.kind !== 'any') this.issue(side.pos, `'${e.op}' compares numbers, got ${t.kind}`);
        }
        return BOOLEAN;
      default:
        for (const [t, side] of [
          [l, e.left],
          [r, e.right],
        ] as const) {
          if (t.kind !== 'number' && t.kind !== 'any') this.issue(side.pos, `'${e.op}' needs numbers, got ${t.kind}`);
        }
        return NUMBER;
    }
  }

  private enumCheck(e: Extract<Expr, { kind: 'binary' }>, field: StaticType, other: StaticType): void {
    if (field.values === undefined || other.literal === undefined) return;
    if (!field.values.includes(other.literal)) {
      this.issue(e.pos, `'${other.literal}' is not a possible value (${field.values.join(', ')})${suggest(other.literal, field.values)}`);
    }
  }
}

/** Parses and checks an expression. Never throws; problems are returned as issues. */
export function checkExpression(source: string, opts: CheckOptions): CheckResult {
  let ast: Expr;
  try {
    ast = parseExpression(source);
  } catch (err) {
    if (err instanceof ConditionSyntaxError) return { type: ANY, issues: [`syntax: ${err.message}`] };
    throw err;
  }
  const c = new Checker(opts);
  const type = c.infer(ast);
  const expect = opts.expect ?? 'any';
  if (expect !== 'any' && type.kind !== 'any' && type.kind !== expect) {
    c.issues.push(expect === 'boolean' ? `a condition must be true or false, this is a ${type.kind} (compare it, e.g. '... > 0')` : `expected a ${expect}, got ${type.kind}`);
  }
  return { ast, type, issues: c.issues };
}

/** Names a module must not use for condition functions (language intrinsics). */
export function reservedFunctionNames(): string[] {
  return Object.keys(INTRINSICS).filter(isIntrinsic);
}
