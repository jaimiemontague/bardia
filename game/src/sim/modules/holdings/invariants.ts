/**
 * Invariants of the holdings module (tests, fuzzers and `npm run sim`): the player's holdings carry a
 * valid tax level and a loyalty within the balance range, building tiers within the balance tables,
 * and well-formed build queues (known buildings, the next tier only, one entry per building, no more
 * entries than the largest slot count); the slice's hourly gate is never later than a due entry.
 */
import { getContent } from '@content/index';
import type { GameState } from '@sim/core/state';
import { currentTier, earliestDone, isTaxRate, maxTier, playerHoldingIds } from './rules';

/** Invariant violations of the holdings module (human-readable). */
export function holdingsInvariants(state: GameState): string[] {
  const content = getContent();
  const out: string[] = [];
  const { min, max } = content.balance.loyalty;
  const maxSlots = Math.max(content.balance.holdings.buildSlots, content.balance.holdings.buildSlotsHighStewardship);
  for (const id of playerHoldingIds(state)) {
    const s = state.settlements[id];
    const h = s?.holding;
    if (!s || !h) continue;
    if (!isTaxRate(h.tax)) out.push(`holding ${id}: unknown tax ${String(h.tax)}`);
    if (!Number.isFinite(h.loyalty) || h.loyalty < min || h.loyalty > max) out.push(`holding ${id}: loyalty ${h.loyalty} outside [${min}, ${max}]`);
    for (const b of Object.keys(s.buildings)) {
      if (!Object.hasOwn(content.balance.buildings, b)) continue;
      const tier = currentTier(s, b);
      if (tier > maxTier(content, b)) out.push(`holding ${id}: ${b} tier ${tier} above the top tier`);
    }
    if (!Array.isArray(h.buildQueue)) {
      out.push(`holding ${id}: buildQueue is not an array`);
      continue;
    }
    if (h.buildQueue.length > maxSlots) out.push(`holding ${id}: ${h.buildQueue.length} buildings queued (max ${maxSlots})`);
    const seen: string[] = [];
    for (const q of h.buildQueue) {
      if (!Object.hasOwn(content.balance.buildings, q.buildingId)) out.push(`holding ${id}: unknown building ${q.buildingId} queued`);
      else if (q.tier !== currentTier(s, q.buildingId) + 1) out.push(`holding ${id}: ${q.buildingId} tier ${q.tier} queued at tier ${currentTier(s, q.buildingId)}`);
      if (seen.includes(q.buildingId)) out.push(`holding ${id}: ${q.buildingId} queued twice`);
      seen.push(q.buildingId);
      if (!Number.isFinite(q.doneHour)) out.push(`holding ${id}: ${q.buildingId} has no completion hour`);
    }
  }
  const slice = state.holdingsState;
  if (slice) {
    const due = earliestDone(state);
    // A decision can stop time mid-tick (ARCHITECTURE §6): an entry due this very hour may still be waiting.
    if (due !== undefined && (slice.nextDueHour === undefined || slice.nextDueHour > due)) out.push(`holdingsState.nextDueHour ${String(slice.nextDueHour)} is later than the earliest completion ${due}`);
    for (const [id, r] of Object.entries(slice.reports)) {
      if (!Number.isFinite(r.after) || r.after < min || r.after > max) out.push(`holdingsState.reports.${id}: loyalty ${r.after} outside the range`);
    }
  }
  return out;
}
