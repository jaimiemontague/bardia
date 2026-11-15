/**
 * Read-only intel queries for the client (settlement panel, raid planner) and the AI (§18.6: AI raids
 * target where they BELIEVE the target is weak). Pure; pass `getContent()` on the client or the
 * SimContext inside the simulation.
 *
 *   intelSummary(state, content, 'set_12')            // what the player believes about set_12
 *   believedValue(state, content, 'fac_3', 'set_12', 'garrison')   // an AI's best guess (number)
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as IntelTunables } from '@content/schemas/tunables/intel';
import type { FactionId, GameState, Hour, IntelFact, IntelFactKey, IntelRecord, JsonValue, SettlementId } from '@sim/core/state';
import { ageDays, bestReportIndex, confidenceLabel, displayedRange, factConfidence, numericValue, reportsConflict } from './formulas';
import { intelKey } from './store';
import { INTEL_FACT_KEYS, type IntelLabel } from './types';

/** The content a query needs. */
export interface IntelQueryContent {
  readonly balance: Pick<Balance, 'intel'>;
  readonly tunables: { readonly intel: IntelTunables };
}

/** What an observer believes about one fact of a settlement. */
export interface IntelFactView {
  key: IntelFactKey;
  /** The most confident report's value (as reported). */
  value: JsonValue;
  /** Its number (garrison total, ships …), if numeric. */
  number?: number;
  /** Displayed range of the number (§31.19). */
  range?: [number, number];
  confidence: number;
  label: IntelLabel;
  ageDays: number;
  source: string;
  reliability: number;
  /** When the reported value was true. */
  hour: Hour;
  /** Another confident report disagrees (both are kept; §20.4). */
  conflict: boolean;
  /** Number of reports held. */
  reports: number;
}

/** An observer's record about a settlement, or undefined. */
export function intelRecord(state: GameState, observer: FactionId, settlementId: SettlementId): IntelRecord | undefined {
  const key = intelKey(observer, settlementId);
  return Object.hasOwn(state.intel, key) ? state.intel[key] : undefined;
}

/** The view of one fact kind from its reports, or undefined if none. */
export function factView(key: IntelFactKey, reports: readonly IntelFact[] | undefined, now: Hour, content: IntelQueryContent): IntelFactView | undefined {
  if (!reports || reports.length === 0) return undefined;
  const b = content.balance.intel;
  const i = bestReportIndex(reports, now, b);
  const best = reports[i] as IntelFact;
  const confidence = factConfidence(best, now, b);
  const days = ageDays(best, now);
  const n = numericValue(best.value);
  let conflict = false;
  for (let j = 0; j < reports.length && !conflict; j++) {
    if (j !== i && reportsConflict(best, reports[j] as IntelFact, now, b, content.tunables.intel.conflictMinConfidence)) conflict = true;
  }
  const view: IntelFactView = {
    key,
    value: best.value,
    confidence,
    label: confidenceLabel(confidence, days, b),
    ageDays: days,
    source: best.source,
    reliability: best.reliability,
    hour: best.hour,
    conflict,
    reports: reports.length,
  };
  if (n !== undefined) {
    view.number = n;
    view.range = displayedRange(n, confidence, b);
  }
  return view;
}

/** Everything an observer (default: the player's faction) believes about a settlement, in §20.4 order. */
export function intelSummary(state: GameState, content: IntelQueryContent, settlementId: SettlementId, observer: FactionId = state.player.factionId): IntelFactView[] {
  const rec = intelRecord(state, observer, settlementId);
  if (!rec) return [];
  const now = state.time.hour;
  const out: IntelFactView[] = [];
  for (const k of INTEL_FACT_KEYS) {
    const v = factView(k, rec.facts[k], now, content);
    if (v) out.push(v);
  }
  return out;
}

/** An observer's best numeric guess for a fact (undefined if unknown or not numeric). */
export function believedValue(state: GameState, content: IntelQueryContent, observer: FactionId, settlementId: SettlementId, key: IntelFactKey): number | undefined {
  const rec = intelRecord(state, observer, settlementId);
  return factView(key, rec?.facts[key], state.time.hour, content)?.number;
}

/** Settlements an observer holds any record about (sorted). */
export function knownSettlements(state: GameState, observer: FactionId = state.player.factionId): SettlementId[] {
  const out: SettlementId[] = [];
  for (const rec of Object.values(state.intel)) if (rec.observer === observer) out.push(rec.settlementId);
  return out.sort();
}
