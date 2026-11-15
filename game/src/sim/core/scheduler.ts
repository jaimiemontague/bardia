/**
 * The strategic clock (design §7.1, §29.3). Time advances one game hour per tick. Each tick:
 *   1. state.time.hour += 1
 *   2. every module's `hourly` system, in module order
 *   3. on calendar boundaries crossed by this hour: DayStarted + `daily` systems, then
 *      WeekStarted + `weekly`, MonthStarted + `monthly`, YearStarted + `yearly` (each in module order)
 *
 * The scheduler STOPS IMMEDIATELY after any system raises a pending decision (ctx.pend). The rest
 * of that tick is not lost: a cursor (state.time.resume) records where to continue, and the next
 * advance finishes the interrupted tick before starting a new hour. Time never advances while
 * state.pending is non-null.
 *
 * Reactions (SimModule.reactions) to events emitted by a boundary announcement or a system run
 * right after it, before the next system; a reaction may raise a decision, which stops time too.
 */
import { runOperation, type KernelContext } from './context';
import type { SimEvent } from './events';
import type { SimContext, SimEnv } from './module';
import type { GameState, PendingDecision, SystemPhase } from './state';
import { boundariesBetween, toCalendar } from './time';

/** Resume-cursor order meaning "phase announced, no system has run yet" (finite: cursors are saved as JSON). */
const BOUNDARY_ANNOUNCED = Number.MIN_SAFE_INTEGER;

/** Phase order within a tick. */
export const PHASES: readonly SystemPhase[] = ['hourly', 'daily', 'weekly', 'monthly', 'yearly'];

function phasesFor(hour: number): SystemPhase[] {
  const b = boundariesBetween(hour - 1, hour);
  const out: SystemPhase[] = ['hourly'];
  if (b.newDay) out.push('daily');
  if (b.newWeek) out.push('weekly');
  if (b.newMonth) out.push('monthly');
  if (b.newYear) out.push('yearly');
  return out;
}

/** Runs pending reactions if the context supports them (it always does inside kernel operations). */
function drain(ctx: SimContext): void {
  (ctx as Partial<KernelContext>).drainReactions?.();
}

function emitBoundary(phase: SystemPhase, draft: GameState, ctx: SimContext): void {
  const hour = draft.time.hour;
  const c = toCalendar(hour);
  switch (phase) {
    case 'daily':
      ctx.emit({ type: 'DayStarted', hour, year: c.year, monthIndex: c.monthIndex, day: c.day });
      break;
    case 'weekly':
      ctx.emit({ type: 'WeekStarted', hour });
      break;
    case 'monthly':
      ctx.emit({ type: 'MonthStarted', hour, year: c.year, monthIndex: c.monthIndex });
      break;
    case 'yearly':
      ctx.emit({ type: 'YearStarted', hour, year: c.year });
      break;
    default:
      break;
  }
}

/**
 * Runs the (remaining) phases of the tick for the current hour, honouring a resume cursor.
 * Returns false if a system raised a pending decision (the cursor is then set).
 */
function runTick(draft: GameState, ctx: SimContext): boolean {
  const phases = phasesFor(draft.time.hour);
  const cursor = draft.time.resume;
  let startPhase = 0;
  let afterOrder = -Infinity;
  if (cursor) {
    const idx = phases.indexOf(cursor.phase);
    if (idx >= 0) {
      startPhase = idx;
      afterOrder = cursor.afterOrder;
    }
    delete draft.time.resume;
  }
  for (let p = startPhase; p < phases.length; p++) {
    const phase = phases[p] as SystemPhase;
    const resuming = p === startPhase && cursor !== undefined && afterOrder !== -Infinity;
    if (!resuming) {
      emitBoundary(phase, draft, ctx);
      drain(ctx);
      if (draft.pending !== null) {
        // A reaction to the boundary announcement raised a decision: resume with this phase's systems.
        draft.time.resume = { phase, after: 'boundary', afterOrder: BOUNDARY_ANNOUNCED };
        return false;
      }
    }
    for (const sys of ctx.env.systems[phase]) {
      if (resuming && sys.order <= afterOrder) continue;
      ctx.runAs(sys.moduleId, () => sys.fn(draft, ctx));
      drain(ctx);
      if (draft.pending !== null) {
        draft.time.resume = { phase, after: sys.moduleId, afterOrder: sys.order };
        return false;
      }
    }
  }
  return true;
}

/**
 * Advances a draft by up to `hours` ticks (mutating). Returns the number of hours actually
 * consumed. `shouldStop` is checked after every completed tick (used by 'wait until event').
 */
export function runTicks(draft: GameState, hours: number, ctx: SimContext, shouldStop?: () => boolean): number {
  if (!Number.isInteger(hours) || hours < 0) throw new RangeError(`advance: hours must be a non-negative integer, got ${hours}`);
  if (draft.pending !== null) return 0;
  const startHour = draft.time.hour;
  let consumed = 0;
  let stopped = false;
  if (draft.time.resume) {
    if (!runTick(draft, ctx)) stopped = true;
    else if (shouldStop?.()) stopped = true;
  }
  while (!stopped && consumed < hours) {
    draft.time.hour += 1;
    consumed += 1;
    if (!runTick(draft, ctx)) break;
    if (shouldStop?.()) break;
  }
  if (consumed > 0) {
    ctx.emit({ type: 'TimeAdvanced', fromHour: startHour, toHour: draft.time.hour, hours: consumed });
    drain(ctx);
  }
  return consumed;
}

export interface AdvanceResult {
  state: GameState;
  events: SimEvent[];
  /** Hours actually consumed (less than requested if a decision became pending). */
  hoursAdvanced: number;
  /** The pending decision that stopped time, if any. */
  pending: PendingDecision | null;
}

/** Immutable wrapper: advances `state` by up to `hours` hours and returns the new state. */
export function advance(state: GameState, hours: number, env: SimEnv): AdvanceResult {
  const r = runOperation(state, env, (draft, ctx) => runTicks(draft, hours, ctx));
  return { state: r.state, events: r.events, hoursAdvanced: r.value, pending: r.state.pending };
}
