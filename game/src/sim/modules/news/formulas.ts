/**
 * Pure news formulas (design §19.3, §31.19) — shared by the simulation and the client:
 *   delay  = travelDays × (delayBase − delayPerImportance × importance)   (1.5 − 0.1 × importance)
 *   reach  = reachBase + reachPerImportance × importance travel-days       (5 + 5 × importance)
 *   drift  = Π over the hops of (1 + u), u ∈ [−distortion, +distortion]    (±10% per hop)
 * The per-hop drift u is a deterministic hash of (item seed, settlement id), so a copy's numbers can
 * be re-derived from state at any time instead of being stored per copy.
 */
import type { Balance } from '@content/schemas/balance';
import { clamp } from '@sim/core/dmath';
import { hashString32 } from '@sim/core/rng';
import type { Hour, JsonValue, NewsItem, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import type { NewsImportance } from './types';

/** The §31.19 news table (balance.intel.news). */
export type NewsBalance = Balance['intel']['news'];

/** Clamps any number to a valid importance 1–5 (rounded). */
export function toImportance(value: number): NewsImportance {
  if (!Number.isFinite(value)) return 1;
  return clamp(Math.round(value), 1, 5) as NewsImportance;
}

/** Delay factor per travel-day for an importance: 1.5 − 0.1 × importance (never below 0.05). */
export function newsDelayFactor(importance: number, b: NewsBalance): number {
  return Math.max(0.05, b.delayBase - b.delayPerImportance * importance);
}

/** Days the word takes to cover `travelDays` (design: travelDays × (1.5 − 0.1 × importance)). */
export function newsDelayDays(travelDays: number, importance: number, b: NewsBalance): number {
  return travelDays * newsDelayFactor(importance, b);
}

/** Maximum reach in travel-days from the origin (design: 5 + 5 × importance). */
export function newsReachDays(importance: number, b: NewsBalance): number {
  return b.reachBase + b.reachPerImportance * importance;
}

/** Absolute hour at which word of an item (happened at `hour`) reaches a place `travelDays` away. */
export function newsArrivalHour(hour: Hour, travelDays: number, importance: number, b: NewsBalance): Hour {
  return hour + Math.round(newsDelayDays(travelDays, importance, b) * HOURS_PER_DAY);
}

/** The per-hop drift factor of the copy heard at `settlementId`: 1 + u, u ∈ [−distortion, +distortion]. */
export function hopDrift(seed: number, settlementId: SettlementId, distortion: number): number {
  const u = hashString32(settlementId, seed >>> 0) / 4294967296; // [0, 1)
  return 1 + (2 * u - 1) * Math.max(0, Math.min(0.95, distortion));
}

/** Hops between the origin and copy `copy` of an item (0 for the origin). */
export function copyHops(item: Pick<NewsItem, 'reachedFrom'>, copy: number): number {
  const from = item.reachedFrom;
  if (!from) return copy === 0 ? 0 : 1;
  let hops = 0;
  let i = copy;
  // A well-formed chain strictly decreases; the bound guards against corrupt data.
  for (let guard = 0; i > 0 && guard <= from.length; guard++) {
    const parent = from[i];
    if (parent === undefined || parent < 0) break;
    hops++;
    i = parent;
  }
  return hops;
}

/** The cumulative drift (product of per-hop factors) of copy `copy` of an item (1 for the origin). */
export function copyDrift(item: Pick<NewsItem, 'reachedFrom' | 'reachedIds' | 'seed' | 'distortion'>, copy: number): number {
  const from = item.reachedFrom;
  const seed = item.seed ?? 0;
  let drift = 1;
  let i = copy;
  for (let guard = 0; i > 0 && guard <= item.reachedIds.length; guard++) {
    const id = item.reachedIds[i];
    if (id === undefined) break;
    drift *= hopDrift(seed, id, item.distortion);
    const parent = from?.[i];
    if (parent === undefined || parent < 0) break;
    i = parent;
  }
  return drift;
}

/** The hour copy `copy` was heard (the item's hour plus the delay over its travel-days). */
export function copyHeardHour(item: Pick<NewsItem, 'hour' | 'importance' | 'reachedDays'>, copy: number, b: NewsBalance): Hour {
  const days = item.reachedDays?.[copy] ?? 0;
  return newsArrivalHour(item.hour, days, item.importance, b);
}

function driftNumber(value: number, drift: number): number {
  const v = value * drift;
  return Number.isInteger(value) ? Math.round(v) : Math.round(v * 100) / 100;
}

/**
 * Facts as told after drifting by `drift`: every number not under an exact key is multiplied and
 * rounded (integers stay integers); strings, booleans and null are unchanged. Nested arrays and
 * objects are distorted recursively. Returns a new object; the input is not modified.
 */
export function distortFacts(facts: Readonly<Record<string, JsonValue>>, drift: number, exactKeys: readonly string[] = []): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(facts)) out[key] = exactKeys.includes(key) ? cloneJson(value) : distortValue(value, drift, exactKeys);
  return out;
}

function distortValue(value: JsonValue, drift: number, exactKeys: readonly string[]): JsonValue {
  if (typeof value === 'number') return drift === 1 ? value : driftNumber(value, drift);
  if (Array.isArray(value)) return value.map((v) => distortValue(v, drift, exactKeys));
  if (value !== null && typeof value === 'object') return distortFacts(value, drift, exactKeys);
  return value;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneJson(v);
    return out;
  }
  return value;
}

/** Bounds of the drift after `hops` hops: [(1 − d)^hops, (1 + d)^hops]. */
export function driftBounds(hops: number, distortion: number): [number, number] {
  let lo = 1;
  let hi = 1;
  const d = Math.max(0, Math.min(0.95, distortion));
  for (let i = 0; i < hops; i++) {
    lo *= 1 - d;
    hi *= 1 + d;
  }
  return [lo, hi];
}

/** Importance from ascending thresholds: 1 + the number of thresholds `value` reaches (max 5). */
export function importanceFromThresholds(value: number, thresholds: readonly number[]): NewsImportance {
  let n = 1;
  for (const t of thresholds) if (value >= t) n++;
  return toImportance(n);
}

/** Days after the event at which an item of this importance may be pruned. */
export function maxAgeDays(importance: number, maxAge: readonly number[]): number {
  return maxAge[toImportance(importance) - 1] ?? maxAge[maxAge.length - 1] ?? 360;
}
