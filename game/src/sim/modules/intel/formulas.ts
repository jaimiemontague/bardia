/**
 * Intel formulas (design §20.4, §31.19), pure — the client and the AI use the same functions:
 *
 *   confidence = reliability × e^(−ageDays / decayDays)          (decayDays 90)
 *   label      = Stale if ageDays > staleDays (180), else High ≥ 0.7, Medium ≥ 0.4, else Low
 *   range      = value × (1 ± rangeSpread × (1 − confidence))     (rangeSpread 0.5)
 *
 * Conflicts: two reports about one fact disagree when both are confident enough and their values
 * differ — numbers when their displayed ranges do not overlap, other values when not equal. Both are
 * kept; the UI shows the most confident and flags the conflict.
 */
import type { Balance } from '@content/schemas/balance';
import { dexp } from '@sim/core/dmath';
import type { Hour, IntelFact, JsonValue } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import type { IntelLabel } from './types';

/** The §31.19 constants (balance.intel). */
export type IntelBalance = Pick<Balance['intel'], 'decayDays' | 'staleDays' | 'confidence' | 'rangeSpread'>;

/** Age in days of a report at `now` (never negative). */
export function ageDays(fact: Pick<IntelFact, 'hour'>, now: Hour): number {
  return Math.max(0, (now - fact.hour) / HOURS_PER_DAY);
}

/** confidence = reliability × e^(−ageDays / decayDays), in [0, 1]. */
export function confidenceOf(reliability: number, days: number, b: IntelBalance): number {
  const r = Math.min(1, Math.max(0, reliability));
  return r * dexp(-Math.max(0, days) / b.decayDays);
}

/** Confidence of a stored report at `now`. */
export function factConfidence(fact: Pick<IntelFact, 'hour' | 'reliability'>, now: Hour, b: IntelBalance): number {
  return confidenceOf(fact.reliability, ageDays(fact, now), b);
}

/** High / Medium / Low, or Stale beyond `staleDays`. */
export function confidenceLabel(confidence: number, days: number, b: IntelBalance): IntelLabel {
  if (days > b.staleDays) return 'stale';
  if (confidence >= b.confidence.high) return 'high';
  if (confidence >= b.confidence.medium) return 'medium';
  return 'low';
}

/** The displayed range of a number: value × (1 ± spread × (1 − confidence)), rounded outward to integers for counts. */
export function displayedRange(value: number, confidence: number, b: IntelBalance, integer = true): [number, number] {
  const err = b.rangeSpread * (1 - Math.min(1, Math.max(0, confidence)));
  const lo = value * (1 - err);
  const hi = value * (1 + err);
  const a = Math.min(lo, hi);
  const z = Math.max(lo, hi);
  return integer ? [Math.floor(a), Math.ceil(z)] : [a, z];
}

/** The number a fact value stands for (garrison → total, fleets → ships), or undefined. */
export function numericValue(value: JsonValue): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, JsonValue>;
    for (const k of ['total', 'ships', 'value']) {
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

/** Stable JSON text of a value (sorted object keys) for equality tests. */
export function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, JsonValue>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k] as JsonValue)}`)
    .join(',')}}`;
}

/** True when two reports disagree (both confident enough; numbers: ranges do not overlap). */
export function reportsConflict(a: IntelFact, b: IntelFact, now: Hour, bal: IntelBalance, minConfidence: number): boolean {
  const ca = factConfidence(a, now, bal);
  const cb = factConfidence(b, now, bal);
  if (ca < minConfidence || cb < minConfidence) return false;
  const na = numericValue(a.value);
  const nb = numericValue(b.value);
  if (na !== undefined && nb !== undefined) {
    const [alo, ahi] = displayedRange(na, ca, bal, false);
    const [blo, bhi] = displayedRange(nb, cb, bal, false);
    return ahi < blo || bhi < alo;
  }
  return canonical(a.value) !== canonical(b.value);
}

/** Index of the most confident report (ties: the newest), or −1 for none. */
export function bestReportIndex(facts: readonly IntelFact[], now: Hour, b: IntelBalance): number {
  let best = -1;
  let bestC = -1;
  facts.forEach((f, i) => {
    const c = factConfidence(f, now, b);
    if (c > bestC + 1e-12 || (Math.abs(c - bestC) <= 1e-12 && best >= 0 && f.hour > (facts[best] as IntelFact).hour)) {
      best = i;
      bestC = c;
    }
  });
  return best;
}
