/**
 * The per-operation SimContext and the operation runner. Every state change (dispatch, advance,
 * new game, load, test helpers) is ONE operation: an Immer `produce` with one context bound to the
 * draft. At the end of the operation, still inside the recipe, the kernel
 *   1. drains pending reactions (modules reacting to events, §11 of ARCHITECTURE.md),
 *   2. writes every RNG stream touched through `ctx.rng()` back to `state.rng` (once),
 *   3. snapshots the emitted events so none of them references an Immer draft (drafts are revoked
 *      when the operation ends; events must stay readable and JSON-serialisable).
 */
import type { ModuleTunables } from '@content/index';
import { current, isDraft, original, produce, type Draft } from 'immer';
import { applyEffects, type Effect, type EffectData } from './effects';
import type { EntityLink, SimEvent, VoiceId } from './events';
import { newId as mintId, type IdPrefix, type IdPrefixMap } from './ids';
import type { PendingRequest, SimContext, SimEnv } from './module';
import { assertStreamName, Rng, streamSeedState, type RngState } from './rng';
import type {
  ChronicleEntry,
  GameState,
  NotificationPriority,
  PendingDecision,
  PendingDecisionOf,
  PendingId,
  PendingKind,
  TextVars,
} from './state';

/** Raised when kernel bookkeeping is misused (e.g. resolving a decision that is not pending). */
export class SimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimError';
  }
}

/** Maximum generations of reactions (an event raised by a reaction to an event raised by …). */
export const MAX_REACTION_DEPTH = 8;

/** The context plus the kernel-only hooks used by the scheduler and the operation runner. */
export interface KernelContext extends SimContext {
  /** Runs reactions for every event emitted since the last drain (no-op while already draining). */
  drainReactions(): void;
  /** Drains reactions, flushes RNG streams and snapshots events. Called once per operation. */
  finish(): void;
}

interface CachedStream {
  rng: Rng;
  /** State words when the operation first touched the stream (null: the stream did not exist). */
  initial: RngState | null;
  /** Words the cached generator started from (initial or the lazily seeded state). */
  start: RngState;
}

function sameWords(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

class Context implements KernelContext {
  moduleId = 'core';
  private readonly streams = new Map<string, CachedStream>();
  /** Reaction generation of each event in `sink` (0 = raised by a handler/system/kernel). */
  private readonly depths: number[] = [];
  private reactCursor = 0;
  private currentDepth = 0;
  private draining = false;

  constructor(
    readonly state: GameState,
    readonly env: SimEnv,
    private readonly sink: SimEvent[],
  ) {
    for (let i = 0; i < sink.length; i++) this.depths.push(0);
  }

  get balance() {
    return this.env.balance;
  }
  get content() {
    return this.env.content;
  }
  get tunables(): ModuleTunables {
    return this.env.content.tunables;
  }
  get hour() {
    return this.state.time.hour;
  }
  get events(): readonly SimEvent[] {
    return this.sink;
  }

  emit(event: SimEvent): void {
    this.sink.push(event);
    this.depths.push(this.currentDepth);
  }

  rng(stream: string): Rng {
    const hit = this.streams.get(stream);
    if (hit) return hit.rng;
    assertStreamName(stream);
    const saved = Object.hasOwn(this.state.rng, stream) ? this.state.rng[stream] : undefined;
    const initial: RngState | null = saved ? [saved[0], saved[1], saved[2], saved[3]] : null;
    const start = initial ?? streamSeedState(this.state.meta.seed, stream);
    const rng = new Rng(start);
    this.streams.set(stream, { rng, initial, start });
    return rng;
  }

  pend<K extends PendingKind>(request: PendingRequest<K>): PendingDecisionOf<K> {
    const decision = {
      id: mintId(this.state, 'pnd'),
      kind: request.kind,
      hour: this.state.time.hour,
      source: this.moduleId,
      payload: request.payload,
    } as PendingDecisionOf<K>;
    if (this.state.pending === null) this.state.pending = decision as PendingDecision;
    else this.state.pendingQueue.push(decision as PendingDecision);
    this.emit({ type: 'PendingRaised', decision: decision as PendingDecision });
    return decision;
  }

  resolvePending(id: PendingId): void {
    const current = this.state.pending;
    if (!current || current.id !== id) throw new SimError(`resolvePending: '${id}' is not the current pending decision`);
    this.state.pending = this.state.pendingQueue.shift() ?? null;
    this.emit({ type: 'PendingResolved', id, kind: current.kind });
  }

  applyEffects(effects: readonly (Effect | EffectData)[]): void {
    applyEffects(this.state, effects, this);
  }

  newId<P extends IdPrefix>(prefix: P): IdPrefixMap[P] {
    return mintId(this.state, prefix);
  }

  notify(key: string, opts: { priority?: NotificationPriority; vars?: TextVars; link?: EntityLink } = {}): void {
    const event: SimEvent = { type: 'Notification', priority: opts.priority ?? 'normal', key, vars: opts.vars ?? {} };
    if (opts.link !== undefined) event.link = opts.link;
    this.emit(event);
  }

  narrate(key: string, vars: TextVars = {}, voice: VoiceId = 'skald'): void {
    this.emit({ type: 'NarrationLine', key, vars, voice });
  }

  chronicle(entry: Omit<ChronicleEntry, 'hour' | 'vars' | 'refs' | 'importance'> & Partial<ChronicleEntry>): ChronicleEntry {
    const full: ChronicleEntry = {
      hour: entry.hour ?? this.state.time.hour,
      kind: entry.kind,
      importance: entry.importance ?? 1,
      textKey: entry.textKey,
      vars: { ...(entry.vars ?? {}) },
      refs: [...(entry.refs ?? [])],
    };
    this.state.chronicle.push(full);
    this.emit({ type: 'ChronicleAdded', entry: { ...full, vars: { ...full.vars }, refs: [...full.refs] } });
    return full;
  }

  runAs<T>(moduleId: string, fn: () => T): T {
    const previous = this.moduleId;
    this.moduleId = moduleId;
    try {
      return fn();
    } finally {
      this.moduleId = previous;
    }
  }

  drainReactions(): void {
    if (this.draining) return; // the outer drain loop picks up events emitted by reactions
    if (this.env.reactions.size === 0) {
      this.reactCursor = this.sink.length;
      return;
    }
    this.draining = true;
    try {
      while (this.reactCursor < this.sink.length) {
        const index = this.reactCursor++;
        const event = this.sink[index] as SimEvent;
        const subscribers = this.env.reactions.get(event.type);
        if (!subscribers) continue;
        const depth = (this.depths[index] ?? 0) + 1;
        if (depth > MAX_REACTION_DEPTH) {
          throw new SimError(`reaction chain deeper than ${MAX_REACTION_DEPTH} generations at event '${event.type}' (a reaction loop?)`);
        }
        const outer = this.currentDepth;
        this.currentDepth = depth;
        try {
          for (const sub of subscribers) this.runAs(sub.moduleId, () => sub.fn(this.state, event as never, this));
        } finally {
          this.currentDepth = outer;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Writes every stream drawn from through ctx.rng() back to state.rng (once per operation). */
  private flushRng(): void {
    for (const [stream, cached] of this.streams) {
      const now = Object.hasOwn(this.state.rng, stream) ? this.state.rng[stream] : undefined;
      const untouched = cached.initial === null ? now === undefined : now !== undefined && sameWords(now, cached.initial);
      if (!untouched) {
        throw new SimError(
          `rng stream '${stream}' was advanced both through ctx.rng() and the functional rng API in one operation; use ctx.rng() only`,
        );
      }
      const words = cached.rng.getState();
      if (!sameWords(words, cached.start)) this.state.rng[stream] = words;
    }
    this.streams.clear();
  }

  finish(): void {
    this.drainReactions();
    this.flushRng();
    for (let i = 0; i < this.sink.length; i++) this.sink[i] = snapshotValue(this.sink[i], 0) as SimEvent;
  }
}

/**
 * Returns `value` with every Immer draft inside it replaced by a plain snapshot (`current()`).
 * Containers are copied only when something inside them changed; frozen values (finalized state)
 * cannot contain drafts and are returned as they are.
 */
function snapshotValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isDraft(value)) return current(value);
  if (Object.isFrozen(value)) return value;
  if (depth > 64) throw new SimError('event payload is nested more than 64 levels deep (a cycle?); events must be JSON-serialisable');
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const v: unknown = value[i];
      const s = snapshotValue(v, depth + 1);
      if (s !== v) {
        out ??= value.slice();
        out[i] = s;
      }
    }
    return out ?? value;
  }
  let out: Record<string, unknown> | undefined;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const v = record[key];
    const s = snapshotValue(v, depth + 1);
    if (s !== v) {
      out ??= { ...record };
      out[key] = s;
    }
  }
  return out ?? value;
}

/**
 * The value as it was when the current operation began (Immer `original`), or `value` itself when it
 * is not a draft. Reading through it costs no proxy traps (~50× cheaper than reading the draft), so
 * hot systems use it to SCAN large tables and then touch only the matching rows through the draft:
 *
 *   for (const [id, f] of Object.entries(baseState(draft.fleets))) if (f.mode === 'sailing') move(draft.fleets[id as FleetId]);
 *
 * It does not see changes made earlier in the same operation (an advance(24) is one operation), so
 * only filter on fields that cannot have changed since, and always WRITE through the draft.
 */
export function baseState<T>(value: T): T {
  return isDraft(value) ? (original(value as Draft<T>) as T) : value;
}

/** Creates a context bound to `draft`; emitted events are appended to `sink`. Kernel use. */
export function createContext(draft: GameState, env: SimEnv, sink: SimEvent[] = []): KernelContext {
  return new Context(draft, env, sink);
}

/** Result of one operation. */
export interface OperationResult<T> {
  state: GameState;
  events: SimEvent[];
  /** Whatever `fn` returned. */
  value: T;
}

/**
 * Runs one operation: `fn` mutates an Immer draft of `state` through a fresh context; then
 * reactions are drained, RNG streams flushed and events snapshotted, all before the draft is
 * finalized. Exceptions propagate and leave `state` untouched.
 */
export function runOperation<T>(state: GameState, env: SimEnv, fn: (draft: GameState, ctx: KernelContext) => T): OperationResult<T> {
  const events: SimEvent[] = [];
  let value: T | undefined;
  const next = produce(state, (draft) => {
    const ctx = createContext(draft as GameState, env, events);
    value = fn(draft as GameState, ctx);
    ctx.finish();
  });
  return { state: next, events, value: value as T };
}
