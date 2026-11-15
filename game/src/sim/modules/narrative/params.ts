/**
 * Effect parameters that refer to the storylet's context (see src/content/storylets.ts):
 *   "$settlement" | "$holding" | "$capital"   a settlement id     "$faction" | "$player"   a faction id
 *   "$character" | "$ruler"                    a character id      "$fleet"                 a fleet id
 *   { "$var": "name" }                          an instance variable
 *   { "$expr": "..." }                          a condition-language expression evaluated when applied
 *
 * At content load the placeholders are checked (known, bound by the storylet's scope, expressions valid) and
 * replaced by type-correct dummies so the op's zod schema can validate the rest (`validateEffects`). When a
 * choice is applied they are replaced by the real values.
 */
import { EffectError, type EffectData } from '@sim/core/effects';
import type { SimEnv } from '@sim/core/module';
import type { GameState, TextVars } from '@sim/core/state';
import { checkExpression } from './conditions/checker';
import { compileSource } from './conditions/compile';
import type { EvalScope } from './conditions/scope';
import type { ScopeBindings } from './types';

interface Placeholder {
  /** Root the storylet scope must bind (undefined: always available). */
  root?: 'settlement' | 'holding' | 'faction' | 'character' | 'fleet';
  /** Dummy id used for load-time validation. */
  dummy: string;
  resolve(state: GameState, bindings: ScopeBindings): string | undefined;
}

/** The scope placeholders allowed in effect parameters. */
export const PLACEHOLDERS: Readonly<Record<string, Placeholder>> = {
  $settlement: { root: 'settlement', dummy: 'set_0', resolve: (_s, b) => b.settlement ?? b.holding },
  $holding: { root: 'holding', dummy: 'set_0', resolve: (_s, b) => b.holding },
  $faction: { root: 'faction', dummy: 'fac_0', resolve: (_s, b) => b.faction },
  $character: { root: 'character', dummy: 'chr_0', resolve: (_s, b) => b.character },
  $fleet: { root: 'fleet', dummy: 'flt_0', resolve: (_s, b) => b.fleet },
  $ruler: { dummy: 'chr_0', resolve: (s) => s.player.rulerId },
  $player: { dummy: 'fac_0', resolve: (s) => s.player.factionId },
  $capital: { dummy: 'set_0', resolve: (s) => s.player.capitalId },
};

const MAX_DEPTH = 8;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `{ "$var": "x" }` → 'x'. */
function varRef(v: unknown): string | undefined {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v.$var === 'string' ? v.$var : undefined;
}

/** `{ "$expr": "..." }` → the source. */
function exprRef(v: unknown): string | undefined {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v.$expr === 'string' ? v.$expr : undefined;
}

/** Kind of a variable for dummies: from the checker for storylet vars, 'string' for standard text vars. */
export type VarKinds = Readonly<Record<string, 'number' | 'string' | 'boolean' | 'any'>>;

export interface ParamCheckOptions {
  env: SimEnv;
  /** Roots the storylet binds (also used to check $expr). */
  roots: readonly string[];
  /** Variables the storylet defines (name → kind). */
  vars: VarKinds;
  /** Accept unknown $var names (storylets fed vars by the scheduler or a parent). */
  openVars: boolean;
}

function dummyFor(kind: 'number' | 'string' | 'boolean' | 'any'): string | number | boolean {
  if (kind === 'string') return 'x';
  if (kind === 'boolean') return true;
  return 1;
}

/**
 * Checks the placeholders of one effect and returns a copy with dummies (for validateEffects) plus issues.
 */
export function prepareForValidation(effect: EffectData, opts: ParamCheckOptions): { dummy: EffectData; issues: string[] } {
  const issues: string[] = [];
  const walk = (v: unknown, path: string, depth: number): unknown => {
    if (depth > MAX_DEPTH) {
      issues.push(`${path}: nested too deeply`);
      return v;
    }
    if (typeof v === 'string') {
      if (!v.startsWith('$')) return v;
      const p = Object.hasOwn(PLACEHOLDERS, v) ? PLACEHOLDERS[v] : undefined;
      if (!p) {
        issues.push(`${path}: unknown placeholder '${v}' (known: ${Object.keys(PLACEHOLDERS).join(', ')})`);
        return v;
      }
      if (p.root !== undefined && !opts.roots.includes(p.root)) issues.push(`${path}: '${v}' is not bound by this storylet's scope`);
      return p.dummy;
    }
    const name = varRef(v);
    if (name !== undefined) {
      const kind = Object.hasOwn(opts.vars, name) ? opts.vars[name] : undefined;
      if (kind === undefined && !opts.openVars) issues.push(`${path}: unknown variable '${name}'`);
      return dummyFor(kind ?? 'any');
    }
    const src = exprRef(v);
    if (src !== undefined) {
      const r = checkExpression(src, { env: opts.env, roots: opts.roots });
      for (const i of r.issues) issues.push(`${path} $expr '${src}': ${i}`);
      return dummyFor(r.type.kind === 'null' ? 'any' : r.type.kind);
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = k === 'op' && depth === 0 ? x : walk(x, path === '' ? k : `${path}.${k}`, depth + 1);
      return out;
    }
    return v;
  };
  const dummy = walk(effect, '', 0) as EffectData;
  return { dummy, issues };
}

/** What substitution needs at apply time. */
export interface ParamContext {
  state: GameState;
  bindings: ScopeBindings;
  vars: Readonly<TextVars>;
  /** Scope for `$expr` (rand() draws from its rng). */
  evalScope: EvalScope;
}

/** Replaces placeholders with real values. Throws EffectError when a placeholder cannot be resolved. */
export function substituteEffect(effect: EffectData, pc: ParamContext): EffectData {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
    if (typeof v === 'string') {
      if (!v.startsWith('$')) return v;
      const p = Object.hasOwn(PLACEHOLDERS, v) ? PLACEHOLDERS[v] : undefined;
      if (!p) throw new EffectError(`unknown placeholder '${v}'`);
      const id = p.resolve(pc.state, pc.bindings);
      if (id === undefined) throw new EffectError(`placeholder '${v}' is not bound`);
      return id;
    }
    const name = varRef(v);
    if (name !== undefined) {
      if (!Object.hasOwn(pc.vars, name)) throw new EffectError(`variable '${name}' is not set`);
      return pc.vars[name];
    }
    const src = exprRef(v);
    if (src !== undefined) return compileSource(src)(pc.evalScope);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = k === 'op' && depth === 0 ? x : walk(x, depth + 1);
      return out;
    }
    return v;
  };
  return walk(effect, 0) as EffectData;
}
