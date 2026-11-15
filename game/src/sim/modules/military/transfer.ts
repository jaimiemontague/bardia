/**
 * Transfers between holdings (§10.3 Affairs of State → Transfers): men, ships and goods leave at once,
 * travel for `max(minDays, ceil(distance / cellsPerDay))` days as a delayed arrival record and risk
 * interception on the way (more while the realm is at war). Intercepted shipments lose men (killed —
 * the home population falls), goods and ship condition.
 */
import type { Content } from '@content/index';
import { GOOD_IDS, type GoodId } from '@content/schemas/ids';
import { CommandError } from '@sim/core/commands';
import type { SimContext } from '@sim/core/module';
import type { GameState, Hour, SettlementId, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { settlementContainer, sumMen } from './men';
import { distance, factionCapitalId, holdingOf, isAtWar, recNum } from './realm';
import { findShipDef, sinkShipNow } from './ships';
import { militaryOf, refreshNextDue } from './slice';
import type { MenRecord, TransferCommand, TransferRecord } from './types';

export type TransferIssue =
  | 'notYourHolding'
  | 'sameHolding'
  | 'nothingToSend'
  | 'badCount'
  | 'notEnoughMen'
  | 'shipNotHere'
  | 'noMarket'
  | 'notEnoughGoods';

/** What the Transfers panel shows. */
export interface TransferPreview {
  days: number;
  arriveHour: Hour;
  interceptChance: number;
  atWar: boolean;
  men: number;
  issues: TransferIssue[];
  ok: boolean;
}

/** Travel days between two settlements for a transfer. */
export function transferDays(state: GameState, content: Content, fromId: SettlementId, toId: SettlementId): number {
  const a = state.settlements[fromId];
  const b = state.settlements[toId];
  const t = content.tunables.military.transfer;
  if (!a || !b) return t.minDays;
  return Math.max(t.minDays, Math.ceil(distance(a.mapPos, b.mapPos) / t.cellsPerDay));
}

/** Interception chance of a transfer of `days` days for the player's realm. */
export function interceptChance(state: GameState, content: Content, days: number, atWar: boolean): number {
  const t = content.tunables.military.transfer;
  const p = Math.min(t.interceptCap, t.interceptPerDay * days);
  return atWar ? p : p * t.interceptPeaceMult;
}

/** Pure preview/validation of a transfer for the player's faction. */
export function transferPreview(state: GameState, content: Content, cmd: TransferCommand): TransferPreview {
  const factionId = state.player.factionId;
  const from = holdingOf(state, cmd.fromId, factionId);
  const to = holdingOf(state, cmd.toId, factionId);
  const issues: TransferIssue[] = [];
  if (!from || !to) issues.push('notYourHolding');
  if (cmd.fromId === cmd.toId) issues.push('sameHolding');
  let men = 0;
  for (const unit of Object.keys(cmd.men ?? {})) {
    const n = recNum(cmd.men, unit);
    if (!Number.isInteger(n) || n < 0) {
      if (!issues.includes('badCount')) issues.push('badCount');
      continue;
    }
    if (from && n > recNum(from.garrison, unit) && !issues.includes('notEnoughMen')) issues.push('notEnoughMen');
    men += n;
  }
  const shipIds = cmd.shipIds ?? [];
  for (const id of shipIds) {
    const ship = state.ships[id];
    const here =
      ship !== undefined &&
      ship.ownerId === factionId &&
      ship.dockedAt === cmd.fromId &&
      ship.locationFleetId === undefined &&
      ship.transitId === undefined;
    if (!here && !issues.includes('shipNotHere')) issues.push('shipNotHere');
  }
  const duplicate = shipIds.some((id, i) => shipIds.indexOf(id) !== i);
  if (duplicate && !issues.includes('shipNotHere')) issues.push('shipNotHere');
  let goodsTons = 0;
  for (const good of Object.keys(cmd.goods ?? {})) {
    const tons = recNum(cmd.goods as Record<string, number>, good);
    if (!(GOOD_IDS as readonly string[]).includes(good) || tons < 0) {
      if (!issues.includes('badCount')) issues.push('badCount');
      continue;
    }
    if (tons === 0) continue;
    goodsTons += tons;
    const fromMarket = state.markets[cmd.fromId];
    if (!fromMarket || !state.markets[cmd.toId]) {
      if (!issues.includes('noMarket')) issues.push('noMarket');
      continue;
    }
    if (tons > (fromMarket.stock[good as GoodId] ?? 0) + 1e-9 && !issues.includes('notEnoughGoods')) issues.push('notEnoughGoods');
  }
  if (men === 0 && shipIds.length === 0 && goodsTons === 0) issues.push('nothingToSend');
  const days = transferDays(state, content, cmd.fromId, cmd.toId);
  const atWar = isAtWar(state, factionId);
  return {
    days,
    arriveHour: state.time.hour + days * HOURS_PER_DAY,
    interceptChance: interceptChance(state, content, days, atWar),
    atWar,
    men,
    issues,
    ok: issues.length === 0,
  };
}

/** `transfer` handler. */
export function handleTransfer(draft: GameState, cmd: TransferCommand, ctx: SimContext): void {
  const p = transferPreview(draft, ctx.content, cmd);
  const first = p.issues[0];
  if (first) throw new CommandError(first, `transfer rejected: ${first}`);
  const from = draft.settlements[cmd.fromId];
  if (!from) throw new CommandError('notYourHolding');
  const m = militaryOf(draft);
  const id = ctx.newId('rec');
  const source = settlementContainer(draft, from);
  const men: MenRecord = {};
  const vetBattles: Record<string, number> = {};
  for (const unit of Object.keys(cmd.men ?? {})) {
    const want = recNum(cmd.men, unit);
    if (want <= 0) continue;
    const battles = source.battles(unit);
    const n = source.remove(unit, want);
    if (n <= 0) continue;
    men[unit] = n;
    if (battles > 0) vetBattles[unit] = battles;
  }
  const shipIds: ShipId[] = [];
  for (const shipId of cmd.shipIds ?? []) {
    const ship = draft.ships[shipId];
    if (!ship) continue;
    delete ship.dockedAt;
    ship.transitId = id;
    shipIds.push(shipId);
  }
  const goods: Partial<Record<GoodId, number>> = {};
  const effects: Parameters<SimContext['applyEffects']>[0][number][] = [];
  for (const good of Object.keys(cmd.goods ?? {}) as GoodId[]) {
    const tons = recNum(cmd.goods as Record<string, number>, good);
    if (tons <= 0) continue;
    goods[good] = tons;
    effects.push({ op: 'addGoods', good, tons: -tons, settlementId: cmd.fromId });
  }
  if (effects.length > 0) ctx.applyEffects(effects);
  const record: TransferRecord = {
    id,
    factionId: draft.player.factionId,
    fromId: cmd.fromId,
    toId: cmd.toId,
    men,
    vetBattles,
    shipIds,
    goods,
    departHour: ctx.hour,
    arriveHour: p.arriveHour,
    days: p.days,
  };
  m.transfers.push(record);
  refreshNextDue(m);
}

/** Arrivals: interception roll, then men to the garrison, ships to the harbour, goods to the market. */
export function processTransfers(draft: GameState, ctx: SimContext): void {
  const m = militaryOf(draft);
  if (m.transfers.length === 0) return;
  const due = m.transfers.filter((t) => t.arriveHour <= ctx.hour);
  if (due.length === 0) return;
  m.transfers = m.transfers.filter((t) => t.arriveHour > ctx.hour);
  const tun = ctx.tunables.military.transfer;
  for (const t of due) {
    const rng = ctx.rng('military:transfer');
    const chance = interceptChance(draft, ctx.content, t.days, isAtWar(draft, t.factionId));
    const intercepted = rng.chance(chance);
    // The destination may have been lost on the way: fall back to the source, then the capital.
    let destId: SettlementId | undefined = t.toId;
    if (!holdingOf(draft, t.toId, t.factionId)) destId = holdingOf(draft, t.fromId, t.factionId) ? t.fromId : factionCapitalId(draft, t.factionId);
    const dest = destId !== undefined ? draft.settlements[destId] : undefined;
    let menLost = 0;
    const arrived: MenRecord = {};
    for (const unit of Object.keys(t.men)) {
      const n = recNum(t.men, unit);
      const lost = intercepted ? Math.floor(n * tun.menLossShare) : 0;
      menLost += lost;
      if (n - lost > 0) arrived[unit] = n - lost;
    }
    if (menLost > 0) {
      const home = draft.settlements[t.fromId];
      if (home && home.factionId === t.factionId) home.pop = Math.max(0, home.pop - menLost);
    }
    if (dest) {
      const target = settlementContainer(draft, dest);
      for (const unit of Object.keys(arrived)) target.add(unit, recNum(arrived, unit), recNum(t.vetBattles, unit));
    }
    const shipsHome: ShipId[] = [];
    for (const shipId of t.shipIds) {
      const ship = draft.ships[shipId];
      if (!ship) continue;
      delete ship.transitId;
      if (intercepted) {
        const def = findShipDef(ctx.balance, ship.type);
        if (def) {
          ship.hullHp = Math.max(0, ship.hullHp - def.hull * tun.shipDamageShare);
          ship.sailHp = Math.max(0, ship.sailHp - def.sail * tun.shipDamageShare);
        }
        if (ship.hullHp <= 0) {
          sinkShipNow(draft, ctx, shipId, 'intercepted');
          continue;
        }
      }
      if (dest) ship.dockedAt = dest.id;
      shipsHome.push(shipId);
    }
    const goodsEffects: Parameters<SimContext['applyEffects']>[0][number][] = [];
    for (const good of Object.keys(t.goods) as GoodId[]) {
      const tons = t.goods[good] ?? 0;
      const kept = intercepted ? tons * (1 - tun.goodsLossShare) : tons;
      if (kept > 0 && dest && draft.markets[dest.id]) goodsEffects.push({ op: 'addGoods', good, tons: kept, settlementId: dest.id });
    }
    if (goodsEffects.length > 0) ctx.applyEffects(goodsEffects);
    ctx.emit({
      type: 'TransferArrived',
      transferId: t.id,
      factionId: t.factionId,
      fromId: t.fromId,
      toId: dest?.id ?? t.toId,
      intercepted,
      men: arrived,
      menLost,
      shipIds: shipsHome,
    });
    if (t.factionId === draft.player.factionId && dest) {
      if (intercepted) {
        ctx.notify('military.transfer.intercepted', {
          priority: 'high',
          vars: { holding: dest.name, lost: menLost, men: sumMen(arrived) },
          link: { kind: 'settlement', id: dest.id },
        });
      } else {
        ctx.notify('military.transfer.arrived', {
          priority: 'low',
          vars: { holding: dest.name, men: sumMen(arrived), ships: shipsHome.length },
          link: { kind: 'settlement', id: dest.id },
        });
      }
    }
  }
}
