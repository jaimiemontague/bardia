/**
 * Evaluator of the condition language (design §29.7). The AST is compiled once into closures; evaluating
 * them is pure and deterministic (the only randomness is rand(), which draws from the EvalScope's rng).
 *
 * Semantics:
 *   - values are JSON scalars: number | string | boolean | null; paths through missing things are null;
 *   - `&&`, `||`, `!` use truthiness (false, null, 0, '' are false), short-circuit and return booleans;
 *   - `==` / `!=` are strict (no coercion: 1 == '1' is false; null == null is true);
 *   - `<` `<=` `>` `>=` compare numbers (anything else is false);
 *   - `+ - * / %` work on numbers; a non-number operand or a non-finite result (x / 0) gives null;
 *   - intrinsics (min, max, floor, ceil, round, abs, clamp) take numbers; anything else gives null;
 *   - registered functions get zod-validated arguments; invalid arguments or an unknown function throw
 *     ConditionRuntimeError (the static checker reports both at content load).
 */
import type { ConditionEvalContext, ConditionFn } from '@sim/core/module';
import type { JsonValue } from '@sim/core/state';
import { INTRINSICS } from './functions';
import { parseExpression, type Expr } from './parser';
import { compilePath } from './paths';
import { ConditionRuntimeError, toValue, truthy, type EvalScope, type Value } from './scope';

/** A compiled expression. */
export type Evaluator = (s: EvalScope) => Value;

function num2(l: Evaluator, r: Evaluator, op: (a: number, b: number) => number): Evaluator {
  return (s) => {
    const a = l(s);
    if (typeof a !== 'number') return null;
    const b = r(s);
    if (typeof b !== 'number') return null;
    const v = op(a, b);
    return Number.isFinite(v) ? v : null;
  };
}

function cmp(l: Evaluator, r: Evaluator, op: (a: number, b: number) => boolean): Evaluator {
  return (s) => {
    const a = l(s);
    const b = r(s);
    return typeof a === 'number' && typeof b === 'number' ? op(a, b) : false;
  };
}

function compileCall(e: Extract<Expr, { kind: 'call' }>): Evaluator {
  const argFns = e.args.map(compileNode);
  const intrinsic = Object.hasOwn(INTRINSICS, e.name) ? INTRINSICS[e.name] : undefined;
  if (intrinsic) {
    const arity = argFns.length;
    return (s) => {
      if (arity < intrinsic.minArgs || arity > intrinsic.maxArgs) return null;
      const nums: number[] = [];
      for (const f of argFns) {
        const v = f(s);
        if (typeof v !== 'number') return null;
        nums.push(v);
      }
      return toValue(intrinsic.fn(nums));
    };
  }
  const name = e.name;
  const allLiteral = e.args.every((a) => a.kind === 'literal');
  let cachedFn: ConditionFn | undefined;
  let cachedArgs: readonly JsonValue[] | undefined;
  return (s) => {
    const entry = s.env.conditionFns.get(name);
    if (!entry) throw new ConditionRuntimeError(`unknown function '${name}'`);
    const fn = entry.fn;
    let args: readonly JsonValue[];
    if (allLiteral && cachedFn === fn && cachedArgs !== undefined) {
      args = cachedArgs;
    } else {
      const raw = argFns.map((f) => f(s));
      const parsed = fn.args.safeParse(raw);
      if (!parsed.success) {
        throw new ConditionRuntimeError(`${name}(${raw.map((v) => JSON.stringify(v)).join(', ')}): ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
      }
      args = parsed.data as JsonValue[];
      if (allLiteral) {
        cachedFn = fn;
        cachedArgs = args;
      }
    }
    const ctx: ConditionEvalContext = s.rng !== undefined ? { state: s.state, env: s.env, scope: s.scope, rng: s.rng } : { state: s.state, env: s.env, scope: s.scope };
    return toValue(fn.evaluate(args, ctx));
  };
}

function compileNode(e: Expr): Evaluator {
  switch (e.kind) {
    case 'literal': {
      const v = e.value;
      return () => v;
    }
    case 'path':
      return compilePath(e.root, e.segments);
    case 'call':
      return compileCall(e);
    case 'unary': {
      const f = compileNode(e.operand);
      if (e.op === '!') return (s) => !truthy(f(s));
      return (s) => {
        const v = f(s);
        return typeof v === 'number' ? -v : null;
      };
    }
    case 'binary': {
      const l = compileNode(e.left);
      const r = compileNode(e.right);
      switch (e.op) {
        case '&&':
          return (s) => truthy(l(s)) && truthy(r(s));
        case '||':
          return (s) => truthy(l(s)) || truthy(r(s));
        case '==':
          return (s) => l(s) === r(s);
        case '!=':
          return (s) => l(s) !== r(s);
        case '<':
          return cmp(l, r, (a, b) => a < b);
        case '<=':
          return cmp(l, r, (a, b) => a <= b);
        case '>':
          return cmp(l, r, (a, b) => a > b);
        case '>=':
          return cmp(l, r, (a, b) => a >= b);
        case '+':
          return num2(l, r, (a, b) => a + b);
        case '-':
          return num2(l, r, (a, b) => a - b);
        case '*':
          return num2(l, r, (a, b) => a * b);
        case '/':
          return num2(l, r, (a, b) => a / b);
        case '%':
          return num2(l, r, (a, b) => a % b);
      }
    }
  }
}

/** Compiles a parsed expression. */
export function compileExpression(ast: Expr): Evaluator {
  return compileNode(ast);
}

const MAX_CACHED = 4096;
let cache: Record<string, Evaluator> = Object.create(null) as Record<string, Evaluator>;
let cached = 0;

/** Parses and compiles a source string (memoised). Throws ConditionSyntaxError. */
export function compileSource(source: string): Evaluator {
  const hit = cache[source];
  if (hit !== undefined) return hit;
  const f = compileExpression(parseExpression(source));
  if (cached >= MAX_CACHED) {
    cache = Object.create(null) as Record<string, Evaluator>;
    cached = 0;
  }
  cache[source] = f;
  cached++;
  return f;
}

/** Evaluates a source string once (tests, tools). */
export function evaluate(source: string, scope: EvalScope): Value {
  return compileSource(source)(scope);
}
