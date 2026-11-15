/**
 * 'narrative' simulation module (scheduler order 140).
 * Scope: Storylet engine, condition language, line pools, scheduled storylets, petitions (§19.1-19.2, §29.7).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: storyletChoice
 *   pending kinds: storylet
 *   condition fns: daysSince, rand, count
 *   state slices: storylets
 * Adds (module-internal, implicitly owned): commands sayLine, narrativeSession; effects fireStoryletTrigger,
 * composeVerse; events StoryletFired, StoryletResolved, LineSpoken, VerseComposed; id prefix stl_.
 * Tunables: src/content/data/tunables/narrative.json (+ schemas/tunables/narrative.ts), read as ctx.tunables.narrative.
 * Strings/assets: src/content/locales/en/narrative.json and src/content/assets/manifest/narrative.json (prefix 'narrative.').
 * Content packs: src/content/data/storylets/** (src/content/storylets.ts), src/content/data/lines/** (src/content/lines.ts).
 * Gate: npm run verify:module -- narrative
 *
 * Layout: conditions/ (lexer, Pratt parser, evaluator, checker, path catalogue, functions), library.ts
 * (per-env compile + load-time validation), engine.ts (triggers → candidates → delivery → resolution),
 * triggers.ts (trigger registry, generic event binding), params.ts (effect placeholders), lines.ts (line pools),
 * verse.ts (kenning generator), api.ts (pure helpers for the client and tools).
 */
import { LINE_SCOPE_ROOTS } from '@content/lines';
import { CommandError } from '@sim/core/commands';
import { TextVarsSchema } from '@sim/core/effects';
import type { SimEvent } from '@sim/core/events';
import { isSafeRecordKey } from '@sim/core/keys';
import type { Reactions, SimContext, SimEnv, SimModule } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import { z } from 'zod';
import { narrativeConditionFns } from './conditions/functions';
import { chooseStorylet, handleFiring, runDaily, runHourly, runMonthly } from './engine';
import { narrativeInvariants } from './invariants';
import { bundledContent, createLibraryCache, type NarrativeContent, type NarrativeLibrary } from './library';
import { recordLine, selectLine, startSession } from './lines';
import { ensureSlice, initSlice, noteMark } from './slice';
import { eventTriggerIndex, firingsFor, type Firing } from './triggers';
import './types';
import type { ScopeBindings } from './types';
import { composeVerseLines } from './verse';

export * from './api';
export { composeVerseLines, resolveVerseLine, selectDeeds, type VerseLimits } from './verse';
export { lastLine, lineRng, selectLine, type LinePick, type LineRequest } from './lines';
export { buildLibrary, bundledContent, bundledLibrary, SCOPE_KINDS, STANDARD_VARS, type NarrativeContent, type NarrativeLibrary } from './library';
export { TRIGGER_SPECS, type Firing, type TriggerSpec } from './triggers';
export { NARRATIVE_STREAM } from './engine';
export type * from './types';

const ENTITY_ROOT_ENUM = z.enum(['settlement', 'holding', 'faction', 'character', 'fleet']);
const camel = z.string().regex(/^[a-z][a-zA-Z0-9]*$/);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);

/** Command schemas (validated by dispatch before the handlers run). */
const commandSchemas = {
  storyletChoice: z
    .object({
      type: z.literal('storyletChoice'),
      instanceId: z.string().min(1).max(64),
      choice: z.union([z.number().int().min(0).max(31), z.enum(['default', 'later'])]),
    })
    .strict(),
  sayLine: z
    .object({
      type: z.literal('sayLine'),
      pool: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/, "must be 'role.context'"),
      scope: z.record(z.enum(LINE_SCOPE_ROOTS), z.string().min(1).max(64)).optional(),
      vars: TextVarsSchema.optional(),
    })
    .strict(),
  narrativeSession: z.object({ type: z.literal('narrativeSession'), reason: z.enum(['newGame', 'load']).optional() }).strict(),
};

/** Effect schemas (validateEffects at content load; applyEffect before the handlers run). */
const effectSchemas = {
  fireStoryletTrigger: z
    .object({
      op: z.literal('fireStoryletTrigger'),
      trigger: camel,
      scope: z.object({ kind: camel, id: z.string().min(1).optional() }).strict().optional(),
      bindings: z.record(ENTITY_ROOT_ENUM, z.string().min(1)).optional(),
      params: z.record(camel, scalar).optional(),
      vars: TextVarsSchema.optional(),
    })
    .strict(),
  composeVerse: z
    .object({
      op: z.literal('composeVerse'),
      kind: z.enum(['yearEnd', 'epitaph']),
      deeds: z
        .array(
          z
            .object({
              kind: camel,
              importance: z.number().finite().optional(),
              vars: TextVarsSchema.optional(),
            })
            .strict(),
        )
        .max(64),
      targetKey: z
        .string()
        .min(1)
        .max(128)
        .refine(isSafeRecordKey, 'must be a valid record key'),
      subject: z.object({ name: z.string().min(1), sex: z.enum(['male', 'female']).optional() }).strict().optional(),
      year: z.number().int().optional(),
      tier: z.number().int().min(0).max(9).optional(),
    })
    .strict(),
};

/** Maps a scope kind to the entity root it binds. */
function rootOfScope(kind: string): keyof ScopeBindings | undefined {
  return kind === 'holding' || kind === 'settlement' || kind === 'faction' || kind === 'character' || kind === 'fleet' ? kind : undefined;
}

/** Is the player involved in a firing's bindings? */
function playerInvolved(state: GameState, b: ScopeBindings): boolean {
  const pf = state.player.factionId;
  if (b.faction === pf || b.character === state.player.rulerId) return true;
  if (b.holding !== undefined) return true;
  const s = b.settlement !== undefined && Object.hasOwn(state.settlements, b.settlement) ? state.settlements[b.settlement as `set_${string}`] : undefined;
  if (s?.holding !== undefined && s.factionId === pf) return true;
  const f = b.fleet !== undefined && Object.hasOwn(state.fleets, b.fleet) ? state.fleets[b.fleet as `flt_${string}`] : undefined;
  return f?.ownerId === pf;
}

/** Reactions to the domain events mapped by the trigger registry, plus chronicle marks. */
function buildReactions(libs: (env: SimContext['env']) => NarrativeLibrary): Reactions {
  type Fn = (draft: GameState, event: SimEvent, ctx: SimContext) => void;
  const out: Record<string, Fn> = {};
  for (const [type, triggers] of Object.entries(eventTriggerIndex())) {
    out[type] = (draft, event, ctx) => {
      noteMark(ensureSlice(draft), type, draft.time.hour);
      const lib = libs(ctx.env);
      const depth = ctx.tunables.narrative.eventSnapshotDepth;
      const payload = event as unknown as Readonly<Record<string, unknown>>;
      for (const trigger of triggers) {
        if ((lib.storylets.byTrigger[trigger]?.length ?? 0) === 0) continue;
        for (const firing of firingsFor(trigger, payload, draft, depth)) handleFiring(ctx, lib, firing);
      }
    };
  }
  out.ChronicleAdded = (draft, event) => {
    if (event.type !== 'ChronicleAdded') return;
    noteMark(ensureSlice(draft), `chronicle:${event.entry.kind}`, event.entry.hour);
  };
  return out as unknown as Reactions;
}

/** Options for building a narrative module (tests substitute content). */
export interface NarrativeModuleOptions {
  /** Content to play with (default: the bundled packs, loaded lazily). */
  content?: () => NarrativeContent;
}

/** The narrative module plus access to its compiled content (for the pure helpers in api.ts). */
export interface NarrativeModule extends SimModule {
  /** The module's content compiled and validated for an env (cached). */
  library(env: SimEnv): NarrativeLibrary;
}

/** Builds the narrative module. The registry uses `module` (bundled content). */
export function createNarrativeModule(options: NarrativeModuleOptions = {}): NarrativeModule {
  const libs = createLibraryCache(options.content ?? bundledContent);
  return {
    library: libs,
    id: 'narrative',
    order: 140,
    version: 1,
    init(draft) {
      initSlice(draft);
    },
    migrate(draft) {
      initSlice(draft);
    },
    handlers: {
      storyletChoice(_draft, cmd, ctx) {
        chooseStorylet(ctx, libs(ctx.env), cmd.instanceId, cmd.choice);
      },
      sayLine(draft, cmd, ctx) {
        const lib = libs(ctx.env);
        const pool = Object.hasOwn(lib.pools, cmd.pool) ? lib.pools[cmd.pool] : undefined;
        if (!pool) throw new CommandError('unknownPool', `No line pool '${cmd.pool}'`);
        for (const root of Object.keys(cmd.scope ?? {})) {
          if (!(pool.pool.scope as readonly string[]).includes(root)) throw new CommandError('badScope', `Pool '${cmd.pool}' does not take '${root}'`);
        }
        const request = { pool: cmd.pool, ...(cmd.scope !== undefined ? { scope: cmd.scope } : {}), ...(cmd.vars !== undefined ? { vars: cmd.vars } : {}) };
        const pick = selectLine(draft, ctx.env, request, lib);
        if (!pick) throw new CommandError('noLine', `No line of '${cmd.pool}' fits`);
        recordLine(ensureSlice(draft), pool, pick.lineId);
        const event: SimEvent = { type: 'LineSpoken', pool: pick.pool, lineId: pick.lineId, textKey: pick.textKey, vars: pick.vars };
        if (pick.voice !== undefined) event.voice = pick.voice;
        ctx.emit(event);
      },
      narrativeSession(draft) {
        startSession(ensureSlice(draft));
      },
    },
    commandSchemas,
    systems: {
      hourly(draft, ctx) {
        if (draft.storylets.scheduled.length === 0) return;
        runHourly(ctx, libs(ctx.env));
      },
      daily(_draft, ctx) {
        runDaily(ctx, libs(ctx.env));
      },
      monthly(_draft, ctx) {
        runMonthly(ctx, libs(ctx.env));
      },
    },
    effects: {
      fireStoryletTrigger(draft, e, ctx) {
        const bindings: ScopeBindings = {};
        for (const [root, id] of Object.entries(e.bindings ?? {})) {
          const r = rootOfScope(root);
          if (r !== undefined && typeof id === 'string') bindings[r] = id;
        }
        if (e.scope?.id !== undefined) {
          const r = rootOfScope(e.scope.kind);
          if (r !== undefined) bindings[r] = e.scope.id;
          if (r === 'holding' && bindings.settlement === undefined) bindings.settlement = e.scope.id;
        }
        const params: Firing['params'] = { ...(e.params ?? {}) };
        if (!Object.hasOwn(params, 'player')) params.player = playerInvolved(draft, bindings);
        const firing: Firing = { trigger: e.trigger, bindings, params, event: { ...params } };
        if (e.vars !== undefined) firing.vars = { ...e.vars };
        handleFiring(ctx, libs(ctx.env), firing);
      },
      composeVerse(draft, e, ctx) {
        const lib = libs(ctx.env);
        const t = ctx.tunables.narrative.verse;
        const req = {
          kind: e.kind,
          deeds: e.deeds,
          ...(e.subject !== undefined ? { subject: e.subject } : {}),
          ...(e.year !== undefined ? { year: e.year } : {}),
          ...(e.tier !== undefined ? { tier: e.tier } : {}),
        };
        const lines = composeVerseLines(lib.verse, req, ctx.rng('narrative:verse'), t);
        const slice = ensureSlice(draft);
        slice.verses[e.targetKey] = { kind: e.kind, hour: draft.time.hour, lines };
        const keys = Object.keys(slice.verses);
        if (keys.length > t.maxStored) {
          const oldest = keys
            .map((k) => ({ k, h: (slice.verses[k] as { hour: number }).hour }))
            .sort((a, b) => a.h - b.h || (a.k < b.k ? -1 : 1))
            .slice(0, keys.length - t.maxStored);
          for (const o of oldest) if (o.k !== e.targetKey) delete slice.verses[o.k];
        }
        ctx.emit({ type: 'VerseComposed', targetKey: e.targetKey, kind: e.kind, lines: lines.length });
      },
    },
    effectSchemas,
    reactions: buildReactions(libs),
    conditionFns: narrativeConditionFns(),
    invariants: narrativeInvariants,
  };
}

/** The registered narrative module (bundled content). */
export const module: NarrativeModule = createNarrativeModule();
