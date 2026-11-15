/**
 * The holdings module's root slice (`state.holdingsState`) and its upkeep: creation on new games and on
 * campaigns already under way (init / migrate from the stub, ARCHITECTURE §12), the hourly gate
 * `nextDueHour`, and the ruler's absence clock.
 */
import type { SimContext } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import { earliestDone, playerHoldingIds, rulerAtHome } from './rules';
import type { HoldingsState } from './types';

/** Data version of the slice. */
export const HOLDINGS_VERSION = 1;

/** The slice, created on first use. */
export function holdingsOf(draft: GameState, hour: number): HoldingsState {
  draft.holdingsState ??= { version: HOLDINGS_VERSION, lastMonthlyHour: hour, reports: {} };
  return draft.holdingsState;
}

/** Recomputes the hourly gate from every build queue. */
export function refreshNextDue(draft: GameState, slice: HoldingsState): void {
  const due = earliestDone(draft);
  if (due === undefined) {
    if (slice.nextDueHour !== undefined) delete slice.nextDueHour;
  } else if (slice.nextDueHour !== due) slice.nextDueHour = due;
}

/** Starts or stops the ruler's absence clock (§31.7 absence over 120 days). */
export function updateAbsence(draft: GameState, slice: HoldingsState, hour: number): void {
  if (rulerAtHome(draft)) {
    if (slice.awaySinceHour !== undefined) delete slice.awaySinceHour;
  } else if (slice.awaySinceHour === undefined) slice.awaySinceHour = hour;
}

/**
 * New game, or a campaign the module has never seen: the slice, sane holding fields (a build queue
 * array on every holding), the absence clock and the hourly gate. Idempotent.
 */
export function initHoldings(draft: GameState, ctx: SimContext): void {
  const slice = holdingsOf(draft, ctx.hour);
  slice.version = HOLDINGS_VERSION;
  slice.reports ??= {};
  for (const id of playerHoldingIds(draft)) {
    const h = draft.settlements[id]?.holding;
    if (!h) continue;
    if (!Array.isArray(h.buildQueue)) h.buildQueue = [];
  }
  updateAbsence(draft, slice, ctx.hour);
  refreshNextDue(draft, slice);
}
