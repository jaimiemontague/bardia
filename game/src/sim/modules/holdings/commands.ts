/**
 * Command handlers of the holdings module. Each validates through the same pure preview the Affairs of
 * State screen shows (rules.ts) and rejects with the first issue as the `CommandError` code.
 *
 *   setTax          the holding's tax level; economy's ledger reads `holding.tax` at the next month,
 *                   the monthly loyalty pass reads it too (§31.1, §31.7).
 *   queueBuilding   pays the silver now (core addSilver) and adds the next tier to the holding's build
 *                   queue; it completes in the hourly system (systems.ts).
 *   setGarrison     sends men home from the garrison to the holding's recruitment pool through
 *                   military's `moveMen` effect (it keeps their veterancy); without military, the raw
 *                   garrison and pool counts move.
 */
import { CommandError } from '@sim/core/commands';
import type { SimContext } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import { garrisonPreview, isTaxRate, playerHolding, queuePreview } from './rules';
import { holdingsOf, refreshNextDue } from './slice';
import type { QueueBuildingCommand, SetGarrisonCommand, SetTaxCommand } from './types';

/** `setTax` handler. */
export function handleSetTax(draft: GameState, cmd: SetTaxCommand, _ctx: SimContext): void {
  const s = playerHolding(draft, cmd.holdingId);
  if (!s) throw new CommandError('notYourHolding', `setTax: ${cmd.holdingId} is not one of your holdings`);
  if (!isTaxRate(cmd.tax)) throw new CommandError('badTax', `setTax: unknown tax level ${String(cmd.tax)}`);
  if (s.holding.tax !== cmd.tax) s.holding.tax = cmd.tax;
}

/** `queueBuilding` handler. */
export function handleQueueBuilding(draft: GameState, cmd: QueueBuildingCommand, ctx: SimContext): void {
  const p = queuePreview(draft, ctx.content, cmd);
  const first = p.issues[0];
  if (first) throw new CommandError(first, `queueBuilding rejected: ${first} (${cmd.buildingId})`, { buildingId: cmd.buildingId, issue: first });
  const s = playerHolding(draft, cmd.holdingId);
  const next = p.next;
  if (!s || !next || p.doneHour === undefined) throw new CommandError('notYourHolding');
  if (next.cost > 0) ctx.applyEffects([{ op: 'addSilver', amount: -next.cost, factionId: draft.player.factionId }]);
  s.holding.buildQueue.push({ buildingId: cmd.buildingId, tier: next.tier, doneHour: p.doneHour });
  refreshNextDue(draft, holdingsOf(draft, ctx.hour));
}

/** `setGarrison` handler. */
export function handleSetGarrison(draft: GameState, cmd: SetGarrisonCommand, ctx: SimContext): void {
  const p = garrisonPreview(draft, ctx.content, cmd);
  const first = p.issues[0];
  if (first) throw new CommandError(first, `setGarrison rejected: ${first}`);
  const s = playerHolding(draft, cmd.holdingId);
  if (!s) throw new CommandError('notYourHolding');
  if (ctx.env.effects.has('moveMen')) {
    ctx.applyEffects([{ op: 'moveMen', from: { settlementId: s.id }, to: { settlementId: s.id, pool: true }, men: p.release } as never]);
    return;
  }
  for (const unit of Object.keys(p.release)) {
    const n = p.release[unit] ?? 0;
    const left = (s.garrison[unit] ?? 0) - n;
    if (left > 0) s.garrison[unit] = left;
    else delete s.garrison[unit];
    s.holding.pool.current = Math.max(0, s.holding.pool.current) + n;
  }
}
