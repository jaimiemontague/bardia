/**
 * Line pools (design §26.3, §9.7 variety rules): role × context pools with conditions and weights, and
 * deterministic anti-repetition memory in state.
 *
 * Selection (`selectLine`, pure — the client may call it directly):
 *   1. eligible = the pool's lines whose `when` holds for the caller's scope;
 *   2. fresh = eligible lines not spoken in this SESSION (LineMemory.recent[pool]); a session starts at a new
 *      game and whenever the client sends `narrativeSession` (after a load);
 *   3. if any are fresh, draw one by weight / (1 + useWeightDecay × timesEverSpoken); otherwise take the
 *      least-recently spoken eligible line (so lines only come round again once the pool is exhausted);
 *   4. the draw is a pure function of (campaign seed, pool, session, total lines spoken): the same state
 *      always yields the same line, and `sayLine` — which records the line — picks exactly what
 *      `selectLine` previewed.
 * Within a session no line of a pool repeats while unused eligible lines remain ("no greeting repeats within a
 * session for the same role", §2.6 L5, M7 acceptance ①).
 */
import type { SimEnv } from '@sim/core/module';
import { Rng } from '@sim/core/rng';
import type { GameState, TextVars } from '@sim/core/state';
import type { EvalScope } from './conditions/scope';
import { holds, standardVars } from './engine';
import { bundledLibrary, type CompiledLine, type CompiledPool, type NarrativeLibrary } from './library';
import { newLineMemory, type NarrativeSlice } from './slice';
import type { LineMemory, ScopeBindings } from './types';

/** A request for a line. */
export interface LineRequest {
  pool: string;
  /** Entity bindings for the pool's scope roots, e.g. { settlement: 'set_4', character: 'chr_9' }. */
  scope?: Readonly<Record<string, string>>;
  /** Extra text vars (merged over the standard ones). */
  vars?: Readonly<TextVars>;
}

/** The chosen line. */
export interface LinePick {
  pool: string;
  lineId: string;
  textKey: string;
  vars: TextVars;
  voice?: string;
}

function memoryOf(state: GameState): LineMemory {
  return state.storylets.lines ?? newLineMemory();
}

function poolBindings(pool: CompiledPool, scope: Readonly<Record<string, string>> | undefined): ScopeBindings {
  const out: ScopeBindings = {};
  if (!scope) return out;
  for (const root of pool.pool.scope) {
    const id = Object.hasOwn(scope, root) ? scope[root] : undefined;
    if (typeof id === 'string') out[root] = id;
  }
  return out;
}

/** The deterministic random source of the next pick in a pool. */
export function lineRng(state: GameState, pool: string): Rng {
  const mem = memoryOf(state);
  return new Rng(`${state.meta.seed}|lines|${pool}|${mem.session}|${mem.draws}`);
}

function effectiveWeight(line: CompiledLine, mem: LineMemory, decay: number): number {
  const uses = Object.hasOwn(mem.uses, line.useKey) ? (mem.uses[line.useKey] as number) : 0;
  return line.weight / (1 + decay * uses);
}

/**
 * Picks a line from a pool without changing state. Returns null for an unknown pool or when no line's
 * condition holds. `lib` defaults to the bundled content compiled for `env`.
 */
export function selectLine(state: GameState, env: SimEnv, request: LineRequest, lib: NarrativeLibrary = bundledLibrary(env)): LinePick | null {
  const pool = Object.hasOwn(lib.pools, request.pool) ? lib.pools[request.pool] : undefined;
  if (!pool) return null;
  const bindings = poolBindings(pool, request.scope);
  const rng = lineRng(state, pool.pool.id);
  const scope: Record<string, string> = {};
  for (const [k, v] of Object.entries(bindings)) if (typeof v === 'string') scope[k] = v;
  const vars: TextVars = { ...standardVars(state, bindings), ...(request.vars ?? {}) };
  const evalScope: EvalScope = { state, env, scope, rng, vars };
  const eligible = pool.lines.filter((l) => holds(l.when, evalScope));
  if (eligible.length === 0) return null;
  const mem = memoryOf(state);
  const recent = Object.hasOwn(mem.recent, pool.pool.id) ? (mem.recent[pool.pool.id] as string[]) : [];
  const fresh = eligible.filter((l) => !recent.includes(l.line.id));
  let chosen: CompiledLine | undefined;
  if (fresh.length > 0) {
    const decay = env.content.tunables.narrative.lines.useWeightDecay;
    chosen = fresh.length === 1 ? fresh[0] : rng.weighted(fresh, (l) => effectiveWeight(l, mem, decay));
  } else {
    // Exhausted: the least recently spoken eligible line.
    let best = Number.POSITIVE_INFINITY;
    for (const l of eligible) {
      const at = recent.indexOf(l.line.id);
      if (at < best) {
        best = at;
        chosen = l;
      }
    }
  }
  if (!chosen) return null;
  const pick: LinePick = { pool: pool.pool.id, lineId: chosen.line.id, textKey: chosen.line.textKey, vars };
  const voice = chosen.line.voice ?? pool.pool.voice;
  if (voice !== undefined) pick.voice = voice;
  return pick;
}

/** Records a spoken line in the memory (moves it to the end of the session list, counts the use). */
export function recordLine(slice: NarrativeSlice, pool: CompiledPool, lineId: string): void {
  const mem = slice.lines;
  const id = pool.pool.id;
  const list = Object.hasOwn(mem.recent, id) ? (mem.recent[id] as string[]).filter((x) => x !== lineId) : [];
  list.push(lineId);
  // Bounded by the pool size: forget lines that no longer exist in the pool.
  const known = pool.pool.lines.map((l) => l.id);
  mem.recent[id] = list.filter((x) => known.includes(x)).slice(-known.length);
  const useKey = `${id}:${lineId}`;
  mem.uses[useKey] = (Object.hasOwn(mem.uses, useKey) ? (mem.uses[useKey] as number) : 0) + 1;
  mem.last[id] = lineId;
  mem.draws += 1;
}

/** Starts a new session: per-session recency is forgotten; lifetime use counts are kept. */
export function startSession(slice: NarrativeSlice): void {
  const mem = slice.lines;
  mem.session += 1;
  mem.recent = {};
  mem.last = {};
}

/** The line a pool spoke last (lets a screen re-render what it showed). */
export function lastLine(state: GameState, pool: string): string | undefined {
  const last = state.storylets.lines?.last;
  return last !== undefined && Object.hasOwn(last, pool) ? last[pool] : undefined;
}
