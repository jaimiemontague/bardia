/**
 * Debt and pay (design §11.7). The treasury never goes below 0; expenses that cannot be paid become
 * arrears (capped at tunables.economy.arrears.capMonths of running expenses — men do not wait
 * forever). Every month end with arrears outstanding (balance.economy.arrears):
 *   - fleet morale −10;
 *   - holding loyalty −5;
 *   - lieutenants' loyalty −10;
 *   - 5 % of the men in garrisons, fleets and armies desert.
 * Arrears are paid first out of later surpluses (ledger.ts). Desertion uses the military module's
 * `addMen` effect with a negative count when that module is present (it keeps its veterancy books),
 * else edits the men tables directly.
 */
import { clamp } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { SimContext } from '@sim/core/module';
import type { ArmyId, FactionId, FleetId, GameState, SettlementId } from '@sim/core/state';
import { isKinOf, recNum } from './realm';
import { economyOf } from './slice';

/** Integer share of `men` with stochastic rounding of the fraction. */
function deserters(men: number, share: number, rng: RandomSource): number {
  const x = Math.max(0, men) * share;
  const whole = Math.floor(x);
  return whole + (rng.float() < x - whole ? 1 : 0);
}

type Container = { settlementId: SettlementId } | { fleetId: FleetId } | { armyId: ArmyId };

/** Removes `count` men of `unit` from a container (military's addMen when registered). */
function removeMen(draft: GameState, ctx: SimContext, where: Container, unit: string, count: number): void {
  if (count <= 0) return;
  if (ctx.env.effects.has('addMen')) {
    ctx.applyEffects([{ op: 'addMen', unit, count: -count, ...where }]);
    return;
  }
  if ('settlementId' in where) {
    const s = draft.settlements[where.settlementId];
    if (s) s.garrison[unit] = Math.max(0, recNum(s.garrison, unit) - count);
  } else if ('fleetId' in where) {
    const f = draft.fleets[where.fleetId];
    if (f) f.men[unit] = Math.max(0, recNum(f.men, unit) - count);
  } else {
    const a = draft.armies[where.armyId];
    if (!a) return;
    let left = count;
    for (const sq of a.squads) {
      if (left <= 0) break;
      if (sq.unit !== unit) continue;
      const take = Math.min(sq.men, left);
      sq.men -= take;
      left -= take;
    }
  }
}

/** Applies the §11.7 penalties for one month of arrears to a house. `view` is a snapshot of the state. */
function arrearsPenalties(draft: GameState, ctx: SimContext, view: GameState, factionId: FactionId): number {
  const a = ctx.balance.economy.arrears;
  const t = ctx.tunables.economy;
  const rng = ctx.rng('economy:arrears');
  const faction = view.factions[factionId];
  if (!faction) return 0;
  let deserted = 0;
  // Holdings: loyalty, garrison desertion.
  for (const id of Object.keys(view.settlements) as SettlementId[]) {
    const s = view.settlements[id];
    if (!s || s.factionId !== factionId) continue;
    if (s.holding) ctx.applyEffects([{ op: 'changeLoyalty', amount: a.loyaltyPerMonth, settlementId: id }]);
    for (const unit of Object.keys(s.garrison).sort()) {
      const n = deserters(recNum(s.garrison, unit), a.desertionPerMonth, rng);
      removeMen(draft, ctx, { settlementId: id }, unit, n);
      deserted += n;
    }
  }
  // Lieutenants' loyalty.
  for (const id of Object.keys(view.characters)) {
    const c = view.characters[id as keyof typeof view.characters];
    if (!c || !c.alive || c.factionId !== factionId || c.id === faction.rulerId || !c.role) continue;
    if (!t.ledger.lieutenantRoles.includes(c.role.kind) || c.location.kind === 'captive') continue;
    if (isKinOf(view, c.id, faction.rulerId)) continue;
    ctx.applyEffects([{ op: 'changeLoyalty', amount: a.lieutenantLoyalty, charId: c.id }]);
  }
  // Fleets: morale and desertion.
  for (const id of Object.keys(view.fleets) as FleetId[]) {
    const f = view.fleets[id];
    if (!f || f.ownerId !== factionId) continue;
    const live = draft.fleets[id];
    if (live) live.morale = clamp(live.morale + a.morale, t.arrears.moraleMin, t.arrears.moraleMax);
    for (const unit of Object.keys(f.men).sort()) {
      const n = deserters(recNum(f.men, unit), a.desertionPerMonth, rng);
      removeMen(draft, ctx, { fleetId: id }, unit, n);
      deserted += n;
    }
  }
  // Armies: desertion.
  for (const id of Object.keys(view.armies) as ArmyId[]) {
    const army = view.armies[id];
    if (!army || army.ownerId !== factionId) continue;
    const byUnit: Record<string, number> = {};
    for (const sq of army.squads) byUnit[sq.unit] = (byUnit[sq.unit] ?? 0) + sq.men;
    for (const unit of Object.keys(byUnit).sort()) {
      const n = deserters(byUnit[unit] ?? 0, a.desertionPerMonth, rng);
      removeMen(draft, ctx, { armyId: id }, unit, n);
      deserted += n;
    }
  }
  return deserted;
}

/**
 * Updates a house's arrears after its ledger was paid (`before` → `after` silver outstanding) and,
 * while arrears remain, applies the month's penalties. Emits ArrearsChanged (every month for the
 * player, on start and clearance for other houses) and notifies the player.
 */
export function applyArrears(draft: GameState, ctx: SimContext, view: GameState, factionId: FactionId, before: number, after: number): void {
  const eco = economyOf(draft);
  const prev = eco.arrears[factionId];
  const isPlayer = factionId === draft.player.factionId;
  if (after <= 0) {
    if (prev || before > 0) {
      delete eco.arrears[factionId];
      ctx.emit({ type: 'ArrearsChanged', factionId, amount: 0, months: 0, cleared: true });
      if (isPlayer) ctx.notify('economy.arrears.cleared', { priority: 'normal', link: { kind: 'screen', id: 'ledger' } });
    }
    return;
  }
  const months = (prev?.months ?? 0) + 1;
  eco.arrears[factionId] = { amount: after, months, sinceHour: prev?.sinceHour ?? ctx.hour };
  if (isPlayer || !prev) ctx.emit({ type: 'ArrearsChanged', factionId, amount: after, months, cleared: false });
  const deserted = arrearsPenalties(draft, ctx, view, factionId);
  if (isPlayer) {
    ctx.notify(months === 1 ? 'economy.arrears.begin' : 'economy.arrears.continue', {
      priority: 'high',
      vars: { amount: after, months, deserted },
      link: { kind: 'screen', id: 'ledger' },
    });
  }
}
