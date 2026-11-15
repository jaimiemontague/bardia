/**
 * Compiles and validates the narrative content against a SimEnv (design §29.5 content pipeline, §29.7):
 * storylet conditions, variables and choices are type-checked by the condition checker, choice effects are
 * validated with the effect registry (`validateEffects`), triggers and scopes are checked against the
 * registries, and line-pool conditions are compiled. Content with issues is EXCLUDED from play (so a
 * disabled module's functions never crash the engine) and every issue is reported by `issues`; the content
 * tests require zero issues.
 *
 * Libraries are cached per (content, env) pair — a few entries, since tests build many envs.
 */
import { getLinePools, getVerseBank, type LineContent, type LinePoolContent, type VerseBankContent } from '@content/lines';
import { getStorylets } from '@content/storylets';
import { validateEffects, type EffectData } from '@sim/core/effects';
import type { SimEnv } from '@sim/core/module';
import { checkExpression } from './conditions/checker';
import { compileExpression, type Evaluator } from './conditions/compile';
import { isIntrinsic } from './conditions/functions';
import { ENTITY_ROOTS, GLOBAL_ROOTS } from './conditions/paths';
import { prepareForValidation, type VarKinds } from './params';
import { triggerSpec } from './triggers';
import type { StoryletChoiceSpec, StoryletSpec } from './types';

/** Storylet scope kinds the engine knows how to bind (an augmentable registry; unknown kinds are errors). */
export const SCOPE_KINDS = ['player', 'holding', 'settlement', 'faction', 'character', 'fleet'] as const;
export type KnownScope = (typeof SCOPE_KINDS)[number];

/** Text variables every storylet instance may carry (when its context provides them). */
export const STANDARD_VARS = [
  'rulerName',
  'rulerSex',
  'capitalName',
  'year',
  'season',
  'settlementName',
  'holdingName',
  'factionName',
  'characterName',
  'characterSex',
  'fleetLeaderName',
] as const;

/** Entity roots bound by each scope kind. */
const SCOPE_ROOTS: Readonly<Record<KnownScope, readonly string[]>> = {
  player: [],
  holding: ['holding', 'settlement', 'faction'],
  settlement: ['settlement', 'faction'],
  faction: ['faction'],
  character: ['character', 'faction'],
  fleet: ['fleet', 'faction'],
};

export interface CompiledChoice {
  readonly index: number;
  readonly spec: StoryletChoiceSpec;
  readonly when?: Evaluator;
}

export interface CompiledStorylet {
  readonly def: StoryletSpec;
  readonly when?: Evaluator;
  /** Instance variables in definition order. */
  readonly vars: readonly { name: string; fn: Evaluator }[];
  readonly choices: readonly CompiledChoice[];
  readonly weight: number;
  readonly cooldownDays: number;
  readonly delegable: boolean;
  /** Roots its expressions may use. */
  readonly roots: readonly string[];
}

export interface StoryletLibrary {
  readonly all: readonly CompiledStorylet[];
  readonly byId: Readonly<Record<string, CompiledStorylet>>;
  readonly byTrigger: Readonly<Record<string, readonly CompiledStorylet[]>>;
  /** Monthly storylets grouped by scope kind. */
  readonly monthlyByScope: Readonly<Record<string, readonly CompiledStorylet[]>>;
}

export interface CompiledLine {
  readonly line: LineContent;
  readonly when?: Evaluator;
  readonly weight: number;
  /** Key in LineMemory.uses. */
  readonly useKey: string;
}

export interface CompiledPool {
  readonly pool: LinePoolContent;
  readonly lines: readonly CompiledLine[];
  readonly roots: readonly string[];
}

/** Everything the engine needs, compiled for one env. */
export interface NarrativeLibrary {
  readonly env: SimEnv;
  readonly storylets: StoryletLibrary;
  readonly pools: Readonly<Record<string, CompiledPool>>;
  readonly verse: VerseBankContent;
  /** Every problem found; content with problems is excluded. */
  readonly issues: readonly string[];
}

/** The narrative content a module instance plays with. */
export interface NarrativeContent {
  readonly storylets: readonly StoryletSpec[];
  readonly pools: readonly LinePoolContent[];
  readonly verse: VerseBankContent;
}

/** Default line weight. */
export const DEFAULT_LINE_WEIGHT = 10;

/** The bundled content packs (validated by src/content/storylets.ts and lines.ts). */
export function bundledContent(): NarrativeContent {
  // Scopes and triggers are plain strings in the content layer; buildLibrary checks them against the registries.
  return { storylets: getStorylets() as unknown as readonly StoryletSpec[], pools: getLinePools(), verse: getVerseBank() };
}

/** Roots available to a storylet's expressions (scope roots + the trigger's event roots). */
export function storyletRoots(def: StoryletSpec): string[] {
  const roots = [...GLOBAL_ROOTS];
  const scopeRoots = (SCOPE_KINDS as readonly string[]).includes(def.scope) ? SCOPE_ROOTS[def.scope as KnownScope] : [];
  for (const r of scopeRoots) if (!roots.includes(r)) roots.push(r);
  const spec = triggerSpec(def.trigger);
  if (spec) {
    for (const r of spec.extraRoots) if (!roots.includes(r)) roots.push(r);
    if (spec.hasEvent) roots.push('event');
  }
  return roots;
}

function compileStorylet(env: SimEnv, def: StoryletSpec, defaultWeight: number, defaultCooldownDays: number, issues: string[]): CompiledStorylet | undefined {
  const where = `storylet ${def.id}`;
  const before = issues.length;
  if (!(SCOPE_KINDS as readonly string[]).includes(def.scope)) issues.push(`${where}: unknown scope '${def.scope}' (known: ${SCOPE_KINDS.join(', ')})`);
  const spec = triggerSpec(def.trigger);
  if (!spec) issues.push(`${where}: unknown trigger '${def.trigger}'`);
  const roots = storyletRoots(def);
  const check = (src: string, what: string, expect: 'boolean' | 'any', forbid?: readonly string[]) => {
    const r = checkExpression(src, forbid ? { env, roots, expect, forbid } : { env, roots, expect });
    for (const i of r.issues) issues.push(`${where} ${what}: ${i}`);
    return r;
  };
  let when: Evaluator | undefined;
  if (def.when !== undefined) {
    const r = check(def.when, 'when', 'boolean');
    if (r.ast) when = compileExpression(r.ast);
  }
  const vars: { name: string; fn: Evaluator }[] = [];
  const varKinds: Record<string, 'number' | 'string' | 'boolean' | 'any'> = {};
  for (const name of STANDARD_VARS) varKinds[name] = name === 'year' ? 'number' : 'string';
  for (const [name, src] of Object.entries(def.vars ?? {})) {
    if ((STANDARD_VARS as readonly string[]).includes(name)) issues.push(`${where} vars.${name}: shadows a standard variable`);
    const r = check(src, `vars.${name}`, 'any');
    if (r.ast) vars.push({ name, fn: compileExpression(r.ast) });
    varKinds[name] = r.type.kind === 'null' ? 'any' : r.type.kind;
  }
  const choices: CompiledChoice[] = [];
  def.choices.forEach((choice, index) => {
    let cw: Evaluator | undefined;
    if (choice.when !== undefined) {
      const r = check(choice.when, `choice ${index} when`, 'boolean', ['rand']);
      if (r.ast) cw = compileExpression(r.ast);
    }
    const kinds: VarKinds = varKinds;
    const openVars = def.trigger === 'scheduled';
    const dummies = choice.effects.map((effect, i) => {
      const p = prepareForValidation(effect as EffectData, { env, roots, vars: kinds, openVars });
      for (const x of p.issues) issues.push(`${where} choice ${index} effect ${i}: ${x}`);
      return p.dummy;
    });
    for (const x of validateEffects(env, dummies, `${where} choice ${index} effects`)) issues.push(x);
    choices.push(cw ? { index, spec: choice, when: cw } : { index, spec: choice });
  });
  if (def.defaultChoice !== undefined) {
    const c = def.choices[def.defaultChoice];
    if (!c) issues.push(`${where}: defaultChoice ${def.defaultChoice} out of range`);
    else if (c.when !== undefined) issues.push(`${where}: the default choice must not have a 'when' condition`);
  }
  if (def.expiresInDays !== undefined && def.defaultChoice === undefined) issues.push(`${where}: expiresInDays needs a defaultChoice`);
  if (def.delegable === true && def.defaultChoice === undefined) issues.push(`${where}: delegable storylets need a defaultChoice`);
  if (issues.length > before) return undefined;
  const base = {
    def,
    vars,
    choices,
    weight: def.weight ?? defaultWeight,
    cooldownDays: def.cooldownDays ?? defaultCooldownDays,
    delegable: def.defaultChoice !== undefined && (def.delegable ?? def.scope === 'holding'),
    roots,
  };
  return when ? { ...base, when } : base;
}

function compilePool(env: SimEnv, pool: LinePoolContent, issues: string[]): CompiledPool | undefined {
  const roots = [...GLOBAL_ROOTS];
  for (const r of pool.scope) if (!roots.includes(r)) roots.push(r);
  const lines: CompiledLine[] = [];
  for (const line of pool.lines) {
    const useKey = `${pool.id}:${line.id}`;
    const weight = line.weight ?? DEFAULT_LINE_WEIGHT;
    if (line.when === undefined) {
      lines.push({ line, weight, useKey });
      continue;
    }
    const r = checkExpression(line.when, { env, roots, expect: 'boolean' });
    for (const i of r.issues) issues.push(`line ${pool.id}#${line.id} when: ${i}`);
    if (r.issues.length === 0 && r.ast) lines.push({ line, weight, useKey, when: compileExpression(r.ast) });
  }
  if (lines.length === 0) {
    issues.push(`line pool ${pool.id}: no usable lines`);
    return undefined;
  }
  return { pool, lines, roots };
}

/** Compiles and validates content for an env. Never throws for content problems. */
export function buildLibrary(env: SimEnv, content: NarrativeContent): NarrativeLibrary {
  const issues: string[] = [];
  const t = env.content.tunables.narrative;
  for (const name of env.conditionFns.keys()) {
    if (isIntrinsic(name)) issues.push(`condition function '${name}' (module '${env.conditionFns.get(name)?.moduleId ?? '?'}') is shadowed by the language intrinsic of the same name`);
  }
  const all: CompiledStorylet[] = [];
  const byId: Record<string, CompiledStorylet> = {};
  const seen: Record<string, true> = {};
  for (const def of content.storylets) {
    if (Object.hasOwn(seen, def.id)) {
      issues.push(`storylet ${def.id}: duplicate id`);
      continue;
    }
    seen[def.id] = true;
    const c = compileStorylet(env, def, t.defaultWeight, t.defaultCooldownDays, issues);
    if (c) {
      all.push(c);
      byId[def.id] = c;
    }
  }
  for (const c of all) {
    c.def.choices.forEach((choice, i) => {
      if (choice.followUp !== undefined && !Object.hasOwn(seen, choice.followUp)) issues.push(`storylet ${c.def.id} choice ${i}: follow-up '${choice.followUp}' does not exist`);
      else if (choice.followUp !== undefined && !Object.hasOwn(byId, choice.followUp)) issues.push(`storylet ${c.def.id} choice ${i}: follow-up '${choice.followUp}' is excluded (see its issues)`);
    });
  }
  const byTrigger: Record<string, CompiledStorylet[]> = {};
  const monthlyByScope: Record<string, CompiledStorylet[]> = {};
  for (const c of all) {
    (byTrigger[c.def.trigger] ??= []).push(c);
    if (c.def.trigger === 'monthly') (monthlyByScope[c.def.scope] ??= []).push(c);
  }
  const pools: Record<string, CompiledPool> = {};
  for (const pool of content.pools) {
    if (Object.hasOwn(pools, pool.id)) {
      issues.push(`line pool ${pool.id}: duplicate id`);
      continue;
    }
    const p = compilePool(env, pool, issues);
    if (p) pools[pool.id] = p;
  }
  return { env, storylets: { all, byId, byTrigger, monthlyByScope }, pools, verse: content.verse, issues };
}

/** Entity roots (re-exported for tooling). */
export const ENTITY_ROOT_NAMES = ENTITY_ROOTS;

/**
 * A small per-(content, env) cache. `content` is resolved lazily on first use, so a module can be created
 * at import time without validating packs then.
 */
export function createLibraryCache(content: () => NarrativeContent, size = 4): (env: SimEnv) => NarrativeLibrary {
  let resolved: NarrativeContent | undefined;
  const entries: NarrativeLibrary[] = [];
  return (env) => {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] as NarrativeLibrary;
      if (e.env === env) {
        if (i > 0) {
          entries.splice(i, 1);
          entries.unshift(e);
        }
        return e;
      }
    }
    resolved ??= content();
    const lib = buildLibrary(env, resolved);
    entries.unshift(lib);
    if (entries.length > size) entries.length = size;
    return lib;
  };
}

/** Library of the bundled content (used by the pure helpers the client calls). */
export const bundledLibrary = createLibraryCache(bundledContent);
