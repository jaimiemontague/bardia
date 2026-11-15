/**
 * The simulation module contract. Every gameplay system (world, weather, economy, …) is a
 * SimModule exported as `module` from src/sim/modules/<id>/index.ts and listed once in the
 * registry (src/sim/modules.ts). Modules never edit kernel files: they add state fields, commands,
 * events, effects, pending kinds and id prefixes through TypeScript module augmentation, and
 * behaviour through the hooks below.
 */
import type { Content, ModuleTunables } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import type { ZodType } from 'zod';
import type { CommandOf, CommandType } from './commands';
import type { Effect, EffectData, EffectOf, EffectOp } from './effects';
import type { EntityLink, EventType, SimEvent, SimEventOf, VoiceId } from './events';
import type { IdPrefix, IdPrefixMap } from './ids';
import type { RandomSource, Rng } from './rng';
import type {
  ChronicleEntry,
  GameState,
  Hour,
  JsonValue,
  NotificationPriority,
  PendingDecisionOf,
  PendingId,
  PendingKind,
  PendingPayloads,
  SystemPhase,
  TextVars,
} from './state';

/** Handles one command type. Mutate `draft`; throw CommandError to reject. */
export type CommandHandler<K extends CommandType> = (draft: GameState, cmd: CommandOf<K>, ctx: SimContext) => void;
export type CommandHandlers = { [K in CommandType]?: CommandHandler<K> };

/**
 * Optional zod schemas validating a command object (including `type`) before the handler runs.
 * The handler receives the schema's OUTPUT (defaults, trims and transforms applied; `type` kept),
 * while the replay log keeps the raw input — so schemas must be pure and deterministic.
 */
export type CommandSchemas = { [K in CommandType]?: ZodType<unknown> };

/** A scheduled system. Runs inside the scheduler's Immer draft. Call ctx.pend(...) to stop time. */
export type SystemFn = (draft: GameState, ctx: SimContext) => void;
export type Systems = { [P in SystemPhase]?: SystemFn };

/** Applies one effect op (storylet choices, relics, quests …). Throw on invalid parameters. */
export type EffectHandler<K extends EffectOp> = (draft: GameState, effect: EffectOf<K>, ctx: SimContext) => void;
export type EffectHandlers = { [K in EffectOp]?: EffectHandler<K> };

/**
 * Optional zod schemas for effect parameters (the whole effect object including `op`). Used by
 * `validateEffects(env, effects)` when content (storylets, relics, quests) loads, and by
 * `applyEffect` before the handler runs (the handler receives the parsed output, `op` kept).
 */
export type EffectSchemas = { [K in EffectOp]?: ZodType<unknown> };

/**
 * Reacts to an event emitted by any module (or the kernel). Reactions run inside the same
 * operation, after the handler/system/effect that emitted the event returns, in module order,
 * attributed to the reacting module. They may mutate state, emit further events (which are
 * reacted to in turn, up to MAX_REACTION_DEPTH generations), apply effects and raise decisions.
 */
export type ReactionFn<K extends EventType> = (draft: GameState, event: SimEventOf<K>, ctx: SimContext) => void;
export type Reactions = { [K in EventType]?: ReactionFn<K> };

/** What a condition-language function (design §29.7) sees when it is evaluated. */
export interface ConditionEvalContext {
  /** The state being read (frozen state or a draft); never mutate it. */
  readonly state: GameState;
  readonly env: SimEnv;
  /** Scope bindings of the storylet / line being evaluated, e.g. { settlement: 'set_4' }. */
  readonly scope: Readonly<Record<string, string>>;
  /** Random source for functions such as rand(); present only when evaluated inside an operation. */
  readonly rng?: RandomSource;
}

/** A whitelisted function of the condition language, contributed by the module that owns the data. */
export interface ConditionFn {
  /** zod schema for the argument tuple (checked at content load / build time). */
  readonly args: ZodType<unknown>;
  /** Result type, for type-checking expressions at content build. */
  readonly returns: 'number' | 'boolean' | 'string';
  /** Pure evaluation. Must not mutate state. */
  evaluate(args: readonly JsonValue[], ctx: ConditionEvalContext): JsonValue;
}
export type ConditionFns = Record<string, ConditionFn>;

export interface SimModule {
  /** Unique id; also the folder name and the default RNG stream prefix. */
  readonly id: string;
  /** Scheduler order (unique). Lower runs first in every phase. */
  readonly order: number;
  /**
   * Set to false to keep the module out of every SimEnv (e.g. while it is broken mid-work, so the
   * full registry, sim-cli and e2e keep running). Default: enabled.
   */
  readonly enabled?: boolean;
  /** Data version of this module's state; bump it and implement `migrate` when the shape changes. */
  readonly version?: number;
  /**
   * New game: create this module's initial state. Runs once, in module order. ALSO runs when a save
   * made before this module existed is loaded (`meta.moduleVersions[id]` missing), so it must work
   * on a campaign that is already under way.
   */
  init?(draft: GameState, ctx: SimContext): void;
  /** Loading an older save: upgrade this module's state from `fromVersion` to `version`. */
  migrate?(draft: GameState, fromVersion: number, ctx: SimContext): void;
  /** Command handlers. A command type may be handled by exactly one module. */
  handlers?: CommandHandlers;
  /** Optional runtime validation of incoming commands. */
  commandSchemas?: CommandSchemas;
  /** Scheduled systems: hourly every hour, the others on calendar boundaries (time.ts). */
  systems?: Systems;
  /** Effect ops this module implements. An op may be implemented by exactly one module. */
  effects?: EffectHandlers;
  /** Optional parameter schemas for this module's effect ops (must have a matching handler). */
  effectSchemas?: EffectSchemas;
  /** Reactions to events raised by any module (several modules may react to one event type). */
  reactions?: Reactions;
  /** Condition-language functions this module contributes (names are unique across modules). */
  conditionFns?: ConditionFns;
  /** Invariant checks used by tests/fuzzers: return human-readable violations. */
  invariants?(state: GameState): string[];
}

/** Arguments for raising a pending decision. */
export interface PendingRequest<K extends PendingKind> {
  kind: K;
  payload: PendingPayloads[K];
}

/** Per-operation context handed to handlers, systems, effects, reactions, init and migrate. */
export interface SimContext {
  /** The Immer draft being modified by this operation. */
  readonly state: GameState;
  readonly env: SimEnv;
  readonly balance: Balance;
  readonly content: Content;
  /** Module-owned tunables (src/content/data/tunables/<moduleId>.json), e.g. `ctx.tunables.economy`. */
  readonly tunables: ModuleTunables;
  /** Current game hour (state.time.hour). */
  readonly hour: Hour;
  /** Id of the module whose code is currently running ('core' for kernel code). */
  readonly moduleId: string;
  /** Events emitted so far in this operation (read-only view). */
  readonly events: readonly SimEvent[];
  /** Emit an event to the client (returned from dispatch/advance) and to other modules' reactions. */
  emit(event: SimEvent): void;
  /**
   * The named RNG stream (§7 of ARCHITECTURE.md), cached for this operation and written back to
   * `state.rng` once when it ends. Name streams `<moduleId>` or `<moduleId>:<sub>`.
   */
  rng(stream: string): Rng;
  /**
   * Ask the player for a decision. Sets state.pending (or queues it if one is already pending)
   * and stops the scheduler immediately. Returns the created decision.
   */
  pend<K extends PendingKind>(request: PendingRequest<K>): PendingDecisionOf<K>;
  /** Clear the current pending decision (must match `id`) and promote the next queued one. */
  resolvePending(id: PendingId): void;
  /** Apply structured effects (§19.1); unknown ops throw. */
  applyEffects(effects: readonly (Effect | EffectData)[]): void;
  /** Mint a deterministic id. */
  newId<P extends IdPrefix>(prefix: P): IdPrefixMap[P];
  /** Emit a Notification event. */
  notify(key: string, opts?: { priority?: NotificationPriority; vars?: TextVars; link?: EntityLink }): void;
  /** Emit a NarrationLine event. */
  narrate(key: string, vars?: TextVars, voice?: VoiceId): void;
  /** Append to the Chronicle (and emit ChronicleAdded). `hour` defaults to now. */
  chronicle(entry: Omit<ChronicleEntry, 'hour' | 'vars' | 'refs' | 'importance'> & Partial<ChronicleEntry>): ChronicleEntry;
  /** Run `fn` attributed to another module id (used by the kernel when calling module code). */
  runAs<T>(moduleId: string, fn: () => T): T;
}

/** A registered command handler. */
export interface HandlerEntry {
  moduleId: string;
  handler: CommandHandler<CommandType>;
  schema?: ZodType<unknown>;
}

/** A registered effect handler. */
export interface EffectEntry {
  moduleId: string;
  handler: EffectHandler<EffectOp>;
  schema?: ZodType<unknown>;
}

/** A registered system function. */
export interface SystemEntry {
  moduleId: string;
  order: number;
  fn: SystemFn;
}

/** A registered reaction (one per module per event type). */
export interface ReactionEntry {
  moduleId: string;
  order: number;
  fn: ReactionFn<EventType>;
}

/** A registered condition-language function. */
export interface ConditionEntry {
  moduleId: string;
  fn: ConditionFn;
}

/** The validated, indexed module registry plus content — built once per session (env.ts). */
export interface SimEnv {
  /** All enabled modules including the core pseudo-module, sorted by order. */
  readonly modules: readonly SimModule[];
  /** Ids of modules that were passed in but skipped because `enabled === false`. */
  readonly disabled: readonly string[];
  readonly balance: Balance;
  readonly content: Content;
  readonly handlers: ReadonlyMap<string, HandlerEntry>;
  readonly effects: ReadonlyMap<string, EffectEntry>;
  readonly systems: { readonly [P in SystemPhase]: readonly SystemEntry[] };
  /** Event type → reactions in module order. */
  readonly reactions: ReadonlyMap<string, readonly ReactionEntry[]>;
  readonly conditionFns: ReadonlyMap<string, ConditionEntry>;
}
