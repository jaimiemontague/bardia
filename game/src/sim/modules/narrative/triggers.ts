/**
 * The storylet trigger registry (design §19.1; vocabulary `StoryletTriggers` in core/state.ts). Each trigger
 * says how it is fired:
 *   - 'monthly' / 'daily' / 'scheduled': by the narrative module's own systems;
 *   - 'event': by a reaction to a domain event (EVENT_OWNERS in core/ownership.ts) — bound GENERICALLY: the
 *     payload is scanned for entity ids (set_/fac_/chr_/flt_) and `isPlayer` flags, so the narrative module
 *     needs no knowledge of other modules' payload types;
 *   - 'effect': by any module applying the `fireStoryletTrigger` effect (no domain event exists for it, e.g.
 *     entering a building or making landfall). Every trigger can also be fired that way.
 * A storylet's `triggerParams` are matched by equality against the firing's params (top-level scalars of the
 * event payload plus `player` = "the player's faction/ruler/fleet/holding is involved"), except where a
 * trigger defines its own matcher (onRelationThreshold: threshold crossing).
 */
import { isSafeRecordKey } from '@sim/core/keys';
import type { GameState, JsonValue, TextVars } from '@sim/core/state';
import type { ScopeBindings } from './types';

/** One firing of a trigger: what it is about and the parameters storylets can match. */
export interface Firing {
  trigger: string;
  bindings: ScopeBindings;
  params: Record<string, string | number | boolean>;
  /** Payload for `event.*` paths (defaults to `params`). */
  event?: Record<string, JsonValue>;
  /** Extra text vars. */
  vars?: TextVars;
}

export type TriggerSource = 'monthly' | 'daily' | 'scheduled' | 'event' | 'effect';
type ParamValue = string | number | boolean;

export interface TriggerSpec {
  readonly source: TriggerSource;
  /** Domain event types that fire this trigger. */
  readonly events: readonly string[];
  /** May storylets with this trigger use `event.*` paths? */
  readonly hasEvent: boolean;
  /** Entity roots the firing may bind beyond the storylet's own scope (values may be null). */
  readonly extraRoots: readonly string[];
  /** Custom event → firings (default: generic binding scan). */
  readonly fromEvent?: (payload: Readonly<Record<string, unknown>>, state: GameState, depth: number) => Firing[];
  /** Custom matcher of a storylet's triggerParams (default: every key equal). */
  readonly match?: (params: Readonly<Record<string, ParamValue>>, firing: Firing) => boolean;
}

const ALL_ENTITIES = ['settlement', 'holding', 'faction', 'character', 'fleet'] as const;

// ---------------------------------------------------------------------------------------------
// Generic payload binding.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON-safe copy of a payload: scalars and plain objects up to `depth` levels (arrays and others dropped). */
export function snapshotPayload(v: Readonly<Record<string, unknown>>, depth: number): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'type' || !isSafeRecordKey(k)) continue;
    if (typeof x === 'string' || typeof x === 'boolean') out[k] = x;
    else if (typeof x === 'number') {
      if (Number.isFinite(x)) out[k] = x;
    } else if (x === null) out[k] = null;
    else if (isRecord(x) && depth > 1) out[k] = snapshotPayload(x, depth - 1);
  }
  return out;
}

/** Top-level scalar fields of a payload (trigger params). */
function scalarParams(v: Readonly<Record<string, unknown>>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'type' || !isSafeRecordKey(k)) continue;
    if (typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) out[k] = x;
  }
  return out;
}

/** How deep (and how much) of a payload the id scan visits. */
const SCAN_DEPTH = 3;
const SCAN_MAX_NODES = 256;
const ENTITY_ID = /^(set|fac|chr|flt)_.+$/;

/**
 * Ids found in a payload, breadth-first (shallower ids come first, then key order), through nested objects
 * and arrays up to SCAN_DEPTH levels; also whether any object carries `isPlayer: true`.
 */
function collectIds(v: Readonly<Record<string, unknown>>): { ids: string[]; isPlayerFlag: boolean } {
  const ids: string[] = [];
  let isPlayerFlag = false;
  let level: unknown[] = [v];
  let visited = 0;
  for (let depth = 0; depth <= SCAN_DEPTH && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (++visited > SCAN_MAX_NODES) return { ids, isPlayerFlag };
      const entries: [string, unknown][] = Array.isArray(node) ? node.map((x, i) => [String(i), x]) : Object.entries(node as Record<string, unknown>);
      for (const [k, x] of entries) {
        if (typeof x === 'string') {
          if (ENTITY_ID.test(x)) ids.push(x);
        } else if (k === 'isPlayer' && x === true) isPlayerFlag = true;
        else if (typeof x === 'object' && x !== null) next.push(x);
      }
    }
    level = next;
  }
  return { ids, isPlayerFlag };
}

/**
 * Generic firing for an event: binds the first settlement / non-player faction / character / fleet id found,
 * marks the settlement as a holding when it is one of the player's, and sets `params.player`.
 */
export function genericFiring(trigger: string, payload: Readonly<Record<string, unknown>>, state: GameState, depth: number): Firing {
  const { ids, isPlayerFlag } = collectIds(payload);
  const bindings: ScopeBindings = {};
  const pf = state.player.factionId;
  const ruler = state.player.rulerId;
  let involved = isPlayerFlag;
  let playerFactionSeen = false;
  for (const id of ids) {
    if (id === pf) playerFactionSeen = true;
    if (id === ruler) involved = true;
    if (id.startsWith('set_')) {
      if (bindings.settlement === undefined && Object.hasOwn(state.settlements, id)) {
        bindings.settlement = id;
        const s = state.settlements[id as `set_${string}`];
        if (s?.holding !== undefined && s.factionId === pf) {
          bindings.holding = id;
          involved = true;
        }
      }
    } else if (id.startsWith('fac_')) {
      if (bindings.faction === undefined && id !== pf && Object.hasOwn(state.factions, id)) bindings.faction = id;
    } else if (id.startsWith('chr_')) {
      if (bindings.character === undefined && Object.hasOwn(state.characters, id)) bindings.character = id;
    } else if (id.startsWith('flt_')) {
      if (bindings.fleet === undefined && Object.hasOwn(state.fleets, id)) {
        bindings.fleet = id;
        if (state.fleets[id as `flt_${string}`]?.ownerId === pf) involved = true;
      }
    }
  }
  if (playerFactionSeen) involved = true;
  if (bindings.faction === undefined && playerFactionSeen) bindings.faction = pf;
  const params = { ...scalarParams(payload), player: involved };
  return { trigger, bindings, params, event: { ...snapshotPayload(payload, depth), player: involved } };
}

// ---------------------------------------------------------------------------------------------
// onRelationThreshold (core OpinionChanged: { a, b, delta, opinion, reason }).

function opinionFirings(payload: Readonly<Record<string, unknown>>, state: GameState): Firing[] {
  const a = payload.a;
  const b = payload.b;
  const delta = payload.delta;
  const opinion = payload.opinion;
  if (typeof a !== 'string' || typeof b !== 'string' || typeof delta !== 'number' || typeof opinion !== 'number') return [];
  const mine = (x: string) => x === state.player.factionId || x === state.player.rulerId;
  const other = mine(a) ? b : mine(b) ? a : undefined;
  if (other === undefined || delta === 0) return [];
  const bindings: ScopeBindings = {};
  if (other.startsWith('fac_') && Object.hasOwn(state.factions, other)) bindings.faction = other;
  else if (other.startsWith('chr_') && Object.hasOwn(state.characters, other)) bindings.character = other;
  else return [];
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  const params = { before: opinion - delta, after: opinion, delta, reason, player: true };
  return [{ trigger: 'onRelationThreshold', bindings, params, event: { ...params, other } }];
}

/** threshold T (required) crossed upwards (before < T ≤ after) or downwards (before > T ≥ after); direction optional. */
function thresholdMatch(tp: Readonly<Record<string, ParamValue>>, firing: Firing): boolean {
  const t = tp.threshold;
  const before = firing.params.before;
  const after = firing.params.after;
  if (typeof t !== 'number' || typeof before !== 'number' || typeof after !== 'number') return false;
  const up = before < t && after >= t;
  const down = before > t && after <= t;
  const dir = tp.direction;
  if (dir === 'up' ? !up : dir === 'down' ? !down : !(up || down)) return false;
  for (const [k, v] of Object.entries(tp)) {
    if (k === 'threshold' || k === 'direction') continue;
    if (firing.params[k] !== v) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The registry.

const eventTrigger = (events: string[]): TriggerSpec => ({ source: 'event', events, hasEvent: true, extraRoots: ALL_ENTITIES });
const effectTrigger: TriggerSpec = { source: 'effect', events: [], hasEvent: true, extraRoots: ALL_ENTITIES };

/** Trigger → how it fires. Keys must be members of `StoryletTriggers` (core/state.ts). */
export const TRIGGER_SPECS: Readonly<Record<string, TriggerSpec>> = {
  monthly: { source: 'monthly', events: [], hasEvent: false, extraRoots: [] },
  onArrival: eventTrigger(['Arrived']),
  onEnterBuilding: effectTrigger,
  onBattleEnd: eventTrigger(['BattleEnded']),
  onDuelEnd: eventTrigger(['DuelEnded']),
  onSeasonStart: { source: 'monthly', events: [], hasEvent: true, extraRoots: [] },
  onBirthday: { source: 'daily', events: [], hasEvent: true, extraRoots: [] },
  onAgeReached: { source: 'daily', events: [], hasEvent: true, extraRoots: [] },
  onRelationThreshold: { source: 'event', events: ['OpinionChanged'], hasEvent: true, extraRoots: ['faction', 'character'], fromEvent: opinionFirings, match: thresholdMatch },
  onVoyageDay: { source: 'daily', events: [], hasEvent: true, extraRoots: [] },
  onLanding: effectTrigger,
  onNewsHeard: eventTrigger(['NewsHeard']),
  onRelicFound: eventTrigger(['RelicFound']),
  onDeath: eventTrigger(['Death']),
  onThing: eventTrigger(['AllthingOpened']),
  scheduled: { source: 'scheduled', events: [], hasEvent: false, extraRoots: [] },
};

/** The spec of a trigger, if the narrative module knows it. */
export function triggerSpec(trigger: string): TriggerSpec | undefined {
  return Object.hasOwn(TRIGGER_SPECS, trigger) ? TRIGGER_SPECS[trigger] : undefined;
}

/** Does a storylet's triggerParams match a firing? */
export function matchTriggerParams(trigger: string, params: Readonly<Record<string, ParamValue>> | undefined, firing: Firing): boolean {
  const spec = triggerSpec(trigger);
  if (spec?.match) return spec.match(params ?? {}, firing);
  if (params === undefined) return true;
  for (const [k, v] of Object.entries(params)) if (firing.params[k] !== v) return false;
  return true;
}

/** Event type → the triggers it fires. */
export function eventTriggerIndex(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [trigger, spec] of Object.entries(TRIGGER_SPECS)) {
    for (const ev of spec.events) (out[ev] ??= []).push(trigger);
  }
  return out;
}

/** Firings for one event and trigger. */
export function firingsFor(trigger: string, payload: Readonly<Record<string, unknown>>, state: GameState, depth: number): Firing[] {
  const spec = triggerSpec(trigger);
  if (spec?.fromEvent) return spec.fromEvent(payload, state, depth);
  return [genericFiring(trigger, payload, state, depth)];
}
