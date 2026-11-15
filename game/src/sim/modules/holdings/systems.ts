/**
 * Scheduled work of the holdings module (ARCHITECTURE §6–§7: coarse work monthly, hourly work gated):
 *   hourly   finishes buildings whose time has come (gated by `holdingsState.nextDueHour`): the tier is
 *            raised in `settlement.buildings` (walls also set `fortTier`), BuildingCompleted is emitted,
 *            the player is told and the Chronicle gets a line;
 *   daily    the ruler's absence clock, and the hourly gate re-derived from the queues;
 *   monthly  the §31.7 loyalty pass for each of the player's holdings through core `changeLoyalty`,
 *            with the reasons stored for the Affairs of State screen.
 */
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { GameState, Settlement, SettlementId } from '@sim/core/state';
import { loyaltyReasons, maxTier, playerHoldingIds, tierInfo } from './rules';
import { holdingsOf, refreshNextDue, updateAbsence } from './slice';

function completeBuilding(draft: GameState, ctx: SimContext, s: Settlement, buildingId: string, tier: number): void {
  const before = Math.max(0, Math.floor(s.buildings[buildingId] ?? 0));
  if (tier > before) s.buildings[buildingId] = tier;
  const fort = tierInfo(ctx.content, buildingId, tier)?.effects['fortTier'];
  if (typeof fort === 'number' && Number.isFinite(fort)) s.fortTier = clamp(Math.round(fort), 0, 4) as Settlement['fortTier'];
  ctx.emit({ type: 'BuildingCompleted', settlementId: s.id, factionId: s.factionId, buildingId, tier });
  if (s.factionId !== draft.player.factionId) return;
  const t = ctx.tunables.holdings;
  ctx.notify('holdings.notify.built', {
    vars: { holding: s.name, building: buildingId, tier },
    link: { kind: 'screen', id: 'affairs' },
  });
  ctx.chronicle({
    kind: 'holdings.buildingCompleted',
    textKey: 'holdings.chronicle.built',
    importance: tier >= maxTier(ctx.content, buildingId) ? t.chronicle.topTierImportance : t.chronicle.importance,
    vars: { holding: s.name, building: buildingId, tier },
    refs: [s.id],
  });
}

/** Hourly: completes every queue entry that is due. */
export function hourlyBuildings(draft: GameState, ctx: SimContext): void {
  const due = draft.holdingsState?.nextDueHour;
  if (due === undefined || due > ctx.hour) return;
  for (const id of playerHoldingIds(draft)) {
    const s = draft.settlements[id];
    const h = s?.holding;
    if (!s || !h) continue;
    if (!h.buildQueue.some((q) => q.doneHour <= ctx.hour)) continue;
    const done = h.buildQueue.filter((q) => q.doneHour <= ctx.hour);
    h.buildQueue = h.buildQueue.filter((q) => q.doneHour > ctx.hour);
    for (const q of done) completeBuilding(draft, ctx, s, q.buildingId, q.tier);
  }
  refreshNextDue(draft, holdingsOf(draft, ctx.hour));
}

/** Daily: the absence clock and the hourly gate. */
export function dailyHoldings(draft: GameState, ctx: SimContext): void {
  const slice = holdingsOf(draft, ctx.hour);
  updateAbsence(draft, slice, ctx.hour);
  refreshNextDue(draft, slice);
}

/** Monthly: the §31.7 loyalty pass of every holding of the player's house. */
export function monthlyLoyalty(draft: GameState, ctx: SimContext): void {
  const slice = holdingsOf(draft, ctx.hour);
  const L = ctx.balance.loyalty;
  const ids = playerHoldingIds(draft);
  for (const id of ids) {
    const s = draft.settlements[id];
    const h = s?.holding;
    if (!s || !h) continue;
    const prev = Object.hasOwn(slice.reports, id) ? slice.reports[id] : undefined;
    const external = prev ? Math.round((h.loyalty - prev.after) * 100) / 100 : 0;
    const reasons = loyaltyReasons(draft, ctx.content, id, { slice });
    const total = reasons.reduce((sum, r) => sum + r.amount, 0);
    const before = h.loyalty;
    if (total !== 0) ctx.applyEffects([{ op: 'changeLoyalty', amount: total, settlementId: id }]);
    const after = h.loyalty;
    slice.reports[id] = { hour: ctx.hour, before, after, reasons, external };
    if (before >= L.revoltBelow && after < L.revoltBelow) {
      ctx.notify('holdings.notify.unrest', { priority: 'high', vars: { holding: s.name, loyalty: Math.round(after) }, link: { kind: 'screen', id: 'affairs' } });
    } else if (before < L.highAt && after >= L.highAt) {
      ctx.notify('holdings.notify.loyal', { priority: 'low', vars: { holding: s.name }, link: { kind: 'screen', id: 'affairs' } });
    }
  }
  for (const key of Object.keys(slice.reports)) if (!ids.includes(key as SettlementId)) delete slice.reports[key as SettlementId];
  slice.lastMonthlyHour = ctx.hour;
}

/** FeastHeld { factionId?, kind? } (whoever holds feasts): the feast term of §31.7 for the player's house. */
export function onFeastHeld(draft: GameState, event: unknown, ctx: SimContext): void {
  const e = event as { factionId?: unknown };
  if (e.factionId !== undefined && e.factionId !== draft.player.factionId) return;
  holdingsOf(draft, ctx.hour).feastHour = ctx.hour;
}
