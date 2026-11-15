/**
 * Functions of the condition language (design §29.7).
 *
 * - INTRINSICS are part of the language itself (pure arithmetic: min, max, floor, ceil, round, abs, clamp).
 *   Their names are reserved: no module may register a condition function with one of them.
 * - Registered functions come from the modules' `conditionFns` (core: flag, season, opinion; people:
 *   hasTrait; narrative: daysSince, rand, count; …). Arguments are validated with each function's zod tuple:
 *   at content load when they are literals (checker), at evaluation otherwise.
 */
import { getRelation } from '@sim/core/factory';
import { isSafeRecordKey } from '@sim/core/keys';
import type { ConditionEvalContext, ConditionFns } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import { daysBetween } from '@sim/core/time';
import { z, type ZodType } from 'zod';
import type { LeafKind } from './paths';

// ---------------------------------------------------------------------------------------------
// Intrinsics.

export interface Intrinsic {
  readonly minArgs: number;
  readonly maxArgs: number;
  /** Receives finite numbers only (any other argument makes the call null). */
  readonly fn: (args: readonly number[]) => number;
  readonly doc: string;
}

/** Built-in numeric functions (reserved names). */
export const INTRINSICS: Readonly<Record<string, Intrinsic>> = {
  min: { minArgs: 2, maxArgs: 8, fn: (a) => Math.min(...a), doc: 'smallest argument' },
  max: { minArgs: 2, maxArgs: 8, fn: (a) => Math.max(...a), doc: 'largest argument' },
  floor: { minArgs: 1, maxArgs: 1, fn: (a) => Math.floor(a[0] as number), doc: 'round down' },
  ceil: { minArgs: 1, maxArgs: 1, fn: (a) => Math.ceil(a[0] as number), doc: 'round up' },
  round: { minArgs: 1, maxArgs: 1, fn: (a) => Math.round(a[0] as number), doc: 'round half up' },
  abs: { minArgs: 1, maxArgs: 1, fn: (a) => Math.abs(a[0] as number), doc: 'absolute value' },
  clamp: { minArgs: 3, maxArgs: 3, fn: ([x, lo, hi]) => Math.min(Math.max(x as number, lo as number), hi as number), doc: 'clamp(x, lo, hi)' },
};

/** True if `name` is a language intrinsic. */
export function isIntrinsic(name: string): boolean {
  return Object.hasOwn(INTRINSICS, name);
}

// ---------------------------------------------------------------------------------------------
// zod introspection (arity and expected argument kinds of registered functions).

interface ZodDefLike {
  typeName?: string;
  schema?: ZodType<unknown>;
  innerType?: ZodType<unknown>;
  type?: ZodType<unknown>;
  in?: ZodType<unknown>;
  items?: ZodType<unknown>[];
  rest?: ZodType<unknown> | null;
  options?: ZodType<unknown>[];
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
  exactLength?: { value: number } | null;
  value?: unknown;
}

function defOf(schema: ZodType<unknown>): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

/** Strips wrappers that do not change the shape (refine/transform/brand/pipe). */
function unwrap(schema: ZodType<unknown>): ZodType<unknown> {
  let s = schema;
  for (let i = 0; i < 16; i++) {
    const d = defOf(s);
    if (d.typeName === 'ZodEffects' && d.schema) s = d.schema;
    else if (d.typeName === 'ZodBranded' && d.type) s = d.type;
    else if (d.typeName === 'ZodPipeline' && d.in) s = d.in;
    else if (d.typeName === 'ZodReadonly' && d.innerType) s = d.innerType;
    else break;
  }
  return s;
}

/** Arity and per-position schemas of an argument-tuple schema (undefined when it cannot be determined). */
export interface ArgShape {
  min: number;
  max: number;
  /** Schema for each position when every alternative agrees on it (else undefined). */
  at(index: number): ZodType<unknown> | undefined;
}

/** Introspects a condition function's `args` schema: tuples, unions of tuples, arrays. */
export function argShape(schema: ZodType<unknown>): ArgShape | undefined {
  const s = unwrap(schema);
  const d = defOf(s);
  if (d.typeName === 'ZodTuple' && d.items) {
    const items = d.items;
    const rest = d.rest ?? undefined;
    return { min: items.length, max: rest ? Number.POSITIVE_INFINITY : items.length, at: (i) => items[i] ?? rest };
  }
  if (d.typeName === 'ZodArray' && d.type) {
    const el = d.type;
    const exact = d.exactLength?.value;
    return {
      min: exact ?? d.minLength?.value ?? 0,
      max: exact ?? d.maxLength?.value ?? Number.POSITIVE_INFINITY,
      at: () => el,
    };
  }
  if (d.typeName === 'ZodUnion' && d.options) {
    const shapes = d.options.map(argShape);
    if (shapes.some((x) => x === undefined)) return undefined;
    const all = shapes as ArgShape[];
    return {
      min: Math.min(...all.map((x) => x.min)),
      max: Math.max(...all.map((x) => x.max)),
      // Alternatives may disagree per position; literal arguments are then checked by parsing the whole tuple.
      at: (i) => (all.length === 1 ? all[0]?.at(i) : undefined),
    };
  }
  return undefined;
}

/** The scalar kind a zod schema accepts ('any' when it accepts several or cannot be told). */
export function zodLeafKind(schema: ZodType<unknown>): LeafKind | 'any' {
  let s = unwrap(schema);
  for (let i = 0; i < 8; i++) {
    const d = defOf(s);
    if ((d.typeName === 'ZodOptional' || d.typeName === 'ZodNullable' || d.typeName === 'ZodDefault') && d.innerType) s = unwrap(d.innerType);
    else break;
  }
  const d = defOf(s);
  switch (d.typeName) {
    case 'ZodString':
    case 'ZodEnum':
    case 'ZodNativeEnum':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodLiteral': {
      const t = typeof d.value;
      return t === 'string' || t === 'number' || t === 'boolean' ? t : 'any';
    }
    default:
      return 'any';
  }
}

// ---------------------------------------------------------------------------------------------
// The narrative module's condition functions: daysSince, rand, count (ownership.ts).

/** count() collections over the player's realm (cheap: small lists only). */
export const COUNT_COLLECTIONS = [
  'holdings',
  'vassals',
  'tributaries',
  'children',
  'spouses',
  'fleetShips',
  'fleetMen',
  'relics',
  'activeQuests',
  'wars',
  'inbox',
] as const;
/** count() tallies that take a key: storylets fired, domain events seen, chronicle entries by kind. */
export const COUNT_TALLIES = ['fired', 'event', 'chronicle'] as const;

/** Key of a tally/mark: storylet id, event type, or `chronicle:<kind>`. */
export function tallyKey(what: (typeof COUNT_TALLIES)[number], key: string): string {
  return what === 'chronicle' ? `chronicle:${key}` : key;
}

function playerFaction(state: GameState) {
  const id = state.player.factionId;
  return Object.hasOwn(state.factions, id) ? state.factions[id] : undefined;
}

function rulerOf(state: GameState) {
  const id = state.player.rulerId;
  return Object.hasOwn(state.characters, id) ? state.characters[id] : undefined;
}

function living(state: GameState, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids) if (isSafeRecordKey(id) && Object.hasOwn(state.characters, id) && state.characters[id as `chr_${string}`]?.alive) n++;
  return n;
}

function expedition(state: GameState) {
  const id = state.player.expeditionFleetId;
  return id !== undefined && Object.hasOwn(state.fleets, id) ? state.fleets[id] : undefined;
}

function countCollection(what: (typeof COUNT_COLLECTIONS)[number], state: GameState): number {
  const pf = playerFaction(state);
  switch (what) {
    case 'holdings':
      return pf?.holdingIds.length ?? 0;
    case 'vassals':
      return pf?.vassalIds.length ?? 0;
    case 'tributaries':
      return pf?.tributaryIds.length ?? 0;
    case 'children':
      return living(state, rulerOf(state)?.family.childIds ?? []);
    case 'spouses':
      return living(state, rulerOf(state)?.family.spouseIds ?? []);
    case 'fleetShips':
      return expedition(state)?.shipIds.length ?? 0;
    case 'fleetMen': {
      const f = expedition(state);
      let n = 0;
      if (f) for (const v of Object.values(f.men)) n += v;
      return n;
    }
    case 'relics': {
      let n = 0;
      for (const r of Object.values(state.relics)) if (r.holder === state.player.factionId) n++;
      return n;
    }
    case 'activeQuests': {
      let n = 0;
      for (const q of Object.values(state.quests)) if (q.status === 'active') n++;
      return n;
    }
    case 'wars': {
      let n = 0;
      for (const id of Object.keys(state.factions)) {
        if (id !== state.player.factionId && getRelation(state, id, state.player.factionId)?.stance === 'war') n++;
      }
      return n;
    }
    case 'inbox': {
      let n = 0;
      for (const inst of Object.values(state.storylets.instances ?? {})) if (inst.status === 'waiting') n++;
      return n;
    }
  }
}

/** The condition functions owned by the narrative module. */
export function narrativeConditionFns(): ConditionFns {
  return {
    /**
     * daysSince(key) → whole days since a storylet last fired (key = storylet id), a domain event was last
     * seen (key = event type, e.g. 'BattleEnded') or a chronicle entry of a kind was written
     * ('chronicle:<kind>'); `tunables.narrative.neverDays` if never.
     */
    daysSince: {
      args: z.tuple([z.string().min(1)]),
      returns: 'number',
      evaluate: ([key], ctx: ConditionEvalContext) => {
        const marks = ctx.state.storylets.marks;
        const k = String(key);
        if (marks !== undefined && isSafeRecordKey(k) && Object.hasOwn(marks, k)) return daysBetween(marks[k] as number, ctx.state.time.hour);
        return ctx.env.content.tunables.narrative.neverDays;
      },
    },
    /** rand() → uniform [0, 1) from the narrative stream (0.5 when evaluated outside an operation). */
    rand: {
      args: z.tuple([]),
      returns: 'number',
      evaluate: (_args, ctx) => (ctx.rng ? ctx.rng.float() : 0.5),
    },
    /**
     * count('holdings' | 'vassals' | 'tributaries' | 'children' | 'spouses' | 'fleetShips' | 'fleetMen' | 'relics' |
     * 'activeQuests' | 'wars' | 'inbox') over the player's realm, or count('fired' | 'event' | 'chronicle', key)
     * for tallies (storylet id, event type, chronicle kind).
     */
    count: {
      args: z.union([z.tuple([z.enum(COUNT_COLLECTIONS)]), z.tuple([z.enum(COUNT_TALLIES), z.string().min(1)])]),
      returns: 'number',
      evaluate: (args, ctx) => {
        const what = String(args[0]);
        if ((COUNT_COLLECTIONS as readonly string[]).includes(what)) return countCollection(what as (typeof COUNT_COLLECTIONS)[number], ctx.state);
        const k = tallyKey(what as (typeof COUNT_TALLIES)[number], String(args[1]));
        const tallies = ctx.state.storylets.tallies;
        return tallies !== undefined && isSafeRecordKey(k) && Object.hasOwn(tallies, k) ? (tallies[k] as number) : 0;
      },
    },
  };
}
