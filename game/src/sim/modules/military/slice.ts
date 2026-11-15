/**
 * The military root slice: creation (init / old saves), access and the hourly due-gate.
 */
import type { GameState, Hour, SettlementId } from '@sim/core/state';
import type { MilitaryState, ShipOrder } from './types';

/** A fresh, empty military slice. */
export function emptyMilitaryState(): MilitaryState {
  return { musters: [], transfers: [], shipyards: {}, hiredOffers: {}, battlesApplied: [], monthBattles: { won: 0, lost: 0 } };
}

/** The slice, created on first use (a module that runs on a state without it never crashes). */
export function militaryOf(draft: GameState): MilitaryState {
  if (!draft.military) draft.military = emptyMilitaryState();
  return draft.military;
}

/** Read-only view of the slice (an empty one when absent). */
export function readMilitary(state: GameState): MilitaryState {
  return state.military ?? EMPTY;
}

const EMPTY: MilitaryState = Object.freeze({
  musters: [],
  transfers: [],
  shipyards: {},
  hiredOffers: {},
  battlesApplied: [],
  monthBattles: { won: 0, lost: 0 },
}) as MilitaryState;

/** The shipyard queue of a holding (read-only; empty when none). */
export function shipOrdersOf(state: GameState, holdingId: SettlementId): readonly ShipOrder[] {
  const m = state.military;
  if (!m || !Object.hasOwn(m.shipyards, holdingId)) return [];
  return m.shipyards[holdingId] ?? [];
}

/** Earliest hour anything in the slice falls due (undefined when nothing is pending). */
export function computeNextDue(m: MilitaryState): Hour | undefined {
  let next: Hour | undefined;
  const consider = (h: Hour) => {
    if (next === undefined || h < next) next = h;
  };
  for (const mu of m.musters) consider(mu.arriveHour);
  for (const t of m.transfers) consider(t.arriveHour);
  for (const key of Object.keys(m.shipyards)) {
    for (const o of m.shipyards[key as SettlementId] ?? []) if (o.startHour !== null) consider(o.doneHour);
  }
  return next;
}

/** Recomputes and stores the due-gate. */
export function refreshNextDue(m: MilitaryState): void {
  const next = computeNextDue(m);
  if (next === undefined) delete m.nextDueHour;
  else m.nextDueHour = next;
}
