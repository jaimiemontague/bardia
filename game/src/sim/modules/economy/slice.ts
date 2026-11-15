/**
 * The economy module's root slice (`state.economy`): creation, defensive reads and repair of
 * malformed fields (old saves, hand-edited states).
 */
import { current, isDraft } from 'immer';
import type { GameState } from '@sim/core/state';
import { isRecord } from './realm';
import type { EconomyState } from './types';

/** A fresh, empty slice. */
export function emptyEconomy(): EconomyState {
  return { ledgers: {}, arrears: {}, routes: {}, priceEvents: [], eventScore: {}, blockades: {}, rapport: {} };
}

/** The slice, created (and repaired) on demand. Call with a draft. */
export function economyOf(draft: GameState): EconomyState {
  let eco = draft.economy;
  if (!isRecord(eco)) {
    draft.economy = emptyEconomy();
    eco = draft.economy;
  }
  const e = eco as EconomyState;
  if (!isRecord(e.ledgers)) e.ledgers = {};
  if (!isRecord(e.arrears)) e.arrears = {};
  if (!isRecord(e.routes)) e.routes = {};
  if (!Array.isArray(e.priceEvents)) e.priceEvents = [];
  if (!isRecord(e.eventScore)) e.eventScore = {};
  if (!isRecord(e.blockades)) e.blockades = {};
  if (!isRecord(e.rapport)) e.rapport = {};
  return e;
}

/** Read-only view of the slice (an empty one when absent). */
export function readEconomy(state: GameState): EconomyState {
  const eco = state.economy;
  return isRecord(eco) ? (eco as EconomyState) : EMPTY;
}
const EMPTY: EconomyState = Object.freeze(emptyEconomy()) as EconomyState;

/**
 * A plain snapshot of a (possibly drafted) value that includes every change made earlier in the
 * running operation. Reading it costs no proxy traps, and — unlike `baseState` — it is correct
 * however an advance was split (replays merge consecutive advances into one operation).
 */
export function snap<T>(value: T): T {
  return isDraft(value) ? (current(value as never) as T) : value;
}
