/**
 * Trade routes (design §11.4): a knarr and a captain (a lieutenant, or a hired factor paid
 * balance.economy.factorWage a month) loop between two markets with chosen goods.
 *
 * Monthly, before the market pass: each active route makes as many round trips as fit the month
 * (carrying the fraction over), at most `maxTripsPerMonth`. Each leg buys the chosen goods where they
 * are cheap (at most `maxStockShare` of the stock, the knarr's hold split between the goods) and sells
 * them at the other end while the expected margin clears `minMarginPct` — through the same price
 * integrals as the player's trades, with the captain's Speechcraft. Foreign harbours charge a toll (paid
 * to their owner). Risks per leg: piracy (×war, ×safe harbours) loses the leg's cargo; storms by season
 * lose part of it, damage the hull (military's damageShip) and may founder the ship (sinkShip) — the route
 * is then lost. War with either end suspends a route until peace; a missing ship, captain or market too.
 * The month's net profit is a ledger line (LedgerExtras.tradeRoutes).
 */
import type { Content } from '@content/index';
import { CommandError } from '@sim/core/commands';
import type { SimContext } from '@sim/core/module';
import type { CharId, FactionId, GameState, GoodId, SettlementId, ShipId } from '@sim/core/state';
import type { WorldIndex } from '../world/types';
import { season } from '@sim/core/time';
import type { LedgerExtras } from './ledger';
import { buyValue, goodPriceInput, sellValue, tariffFor, tradeMults } from './price';
import { GOODS } from './profiles';
import { atWar, atWarWithAnyone, crownCount, effectiveSkill, hasPact, hasTradeMarket, isBlockaded, roundTo } from './realm';
import { economyOf, readEconomy } from './slice';
import type { ClearTradeRouteCommand, LedgerItem, SetTradeRouteCommand, TradeRoute, TradeRouteId, TradeRouteSuspension } from './types';

function err(code: string, message: string): CommandError {
  return new CommandError(code, message);
}

/** The world module's geography digest (read defensively: the world module may be absent). */
function worldIndexOf(state: GameState): WorldIndex | undefined {
  return (state as GameState & { worldIndex?: WorldIndex }).worldIndex;
}

/** Route slots of the player's house (§11.4: 1, +1 per crown, at most 3). */
export function routeSlots(state: GameState, content: Content): number {
  const base = content.balance.market.tradeRouteSlots[0] ?? 1;
  const max = content.balance.market.tradeRouteSlots[1] ?? base;
  const crowns = crownCount(state, content.tunables.economy.ledger.crownFlagPrefix);
  return Math.min(max, base + crowns * content.balance.market.tradeRouteSlotsPerCrown);
}

/** Nominal sea days between two markets (world index lane, else straight line). */
export function seaDaysBetween(state: GameState, content: Content, a: SettlementId, b: SettlementId): number {
  const lane = worldIndexOf(state)?.settlements[a]?.lanes.find((l) => l.to === b);
  if (lane && lane.seaDays !== null) return lane.seaDays;
  const fb = content.tunables.economy.flows.fallback;
  const sa = state.settlements[a];
  const sb = state.settlements[b];
  if (!sa || !sb) return Infinity;
  const cells = Math.sqrt((sa.mapPos.x - sb.mapPos.x) ** 2 + (sa.mapPos.y - sb.mapPos.y) ** 2);
  return (cells * fb.cellKm * fb.seaDetour) / fb.seaKmPerDay;
}

/** Days of one round trip (two legs plus loading at both ends), at least `minRoundTripDays`. */
export function roundTripDays(state: GameState, content: Content, a: SettlementId, b: SettlementId): number {
  const r = content.tunables.economy.routes;
  return roundTo(Math.max(r.minRoundTripDays, 2 * seaDaysBetween(state, content, a, b) + 2 * r.portDays), 2);
}

function validGoods(list: readonly unknown[] | undefined): GoodId[] {
  const out: GoodId[] = [];
  for (const g of list ?? []) {
    if (typeof g !== 'string' || !(GOODS as readonly string[]).includes(g)) throw err('badGood', `Unknown good ${String(g)}.`);
    if (!out.includes(g as GoodId)) out.push(g as GoodId);
  }
  return out;
}

/** The `setTradeRoute` command. */
export function handleSetTradeRoute(draft: GameState, cmd: SetTradeRouteCommand, ctx: SimContext): void {
  const content = ctx.content;
  const t = content.tunables.economy.routes;
  const player = draft.player.factionId;
  const eco = economyOf(draft);
  const editing = cmd.routeId !== undefined ? eco.routes[cmd.routeId] : undefined;
  if (cmd.routeId !== undefined && (!editing || editing.factionId !== player)) throw err('unknownRoute', 'No such trade route.');
  const ship = draft.ships[cmd.shipId];
  if (!ship || ship.ownerId !== player) throw err('unknownShip', 'No such ship of yours.');
  if (!t.shipTypes.includes(ship.type)) throw err('wrongShip', 'Only a knarr can run a trade route.');
  if (ship.locationFleetId !== undefined) throw err('shipInFleet', 'The ship is with a fleet.');
  if (ship.tradeRouteId !== undefined && ship.tradeRouteId !== cmd.routeId) throw err('shipBusy', 'The ship already runs a route.');
  if (cmd.fromId === cmd.toId) throw err('sameMarket', 'A route needs two different markets.');
  for (const id of [cmd.fromId, cmd.toId]) {
    const s = draft.settlements[id];
    if (!s || !draft.markets[id] || !hasTradeMarket(content, s)) throw err('noMarket', 'Both ends need a market.');
    if (!s.coastal && worldIndexOf(draft)?.settlements[id]?.port === -1) throw err('noHarbour', 'Both ends need a harbour.');
    if (s.factionId !== player && atWar(draft, player, s.factionId)) throw err('embargo', 'You are at war with that market.');
  }
  if (cmd.captainId !== undefined) {
    const c = draft.characters[cmd.captainId];
    if (!c?.alive || c.factionId !== player || c.location.kind === 'captive') throw err('badCaptain', 'No such captain of yours.');
    if (c.id === draft.player.rulerId) throw err('badCaptain', 'The ruler cannot captain a knarr.');
    for (const r of Object.values(eco.routes)) if (r.captainId === c.id && r.id !== cmd.routeId) throw err('captainBusy', 'That captain already runs a route.');
  }
  const outbound = validGoods(cmd.outbound);
  const inbound = validGoods(cmd.inbound);
  if (outbound.length === 0) throw err('noGoods', 'Choose at least one good to carry.');
  if (!editing) {
    const mine = Object.values(eco.routes).filter((r) => r.factionId === player).length;
    if (mine >= routeSlots(draft, content)) throw err('noSlot', 'The house cannot run another trade route.');
  }
  const id = (editing?.id ?? ctx.newId('rec')) as TradeRouteId;
  const route: TradeRoute = {
    id,
    factionId: player,
    shipId: ship.id,
    fromId: cmd.fromId,
    toId: cmd.toId,
    outbound,
    inbound,
    sinceHour: editing?.sinceHour ?? ctx.hour,
    roundTripDays: roundTripDays(draft, content, cmd.fromId, cmd.toId),
    tripProgress: editing?.tripProgress ?? 0,
    status: 'active',
    trips: editing?.trips ?? 0,
    profit: editing?.profit ?? 0,
    lastProfit: editing?.lastProfit ?? 0,
    losses: editing?.losses ?? 0,
  };
  if (cmd.captainId !== undefined) route.captainId = cmd.captainId;
  if (editing && editing.shipId !== ship.id) {
    const old = draft.ships[editing.shipId];
    if (old) delete old.tradeRouteId;
  }
  eco.routes[id] = route;
  ship.tradeRouteId = id;
  if (ship.dockedAt !== undefined) delete ship.dockedAt;
  ctx.emit({ type: 'TradeRouteChanged', routeId: id, factionId: player, change: editing ? 'updated' : 'set' });
}

/** The `clearTradeRoute` command. */
export function handleClearTradeRoute(draft: GameState, cmd: ClearTradeRouteCommand, ctx: SimContext): void {
  const eco = economyOf(draft);
  const route = eco.routes[cmd.routeId];
  if (!route || route.factionId !== draft.player.factionId) throw err('unknownRoute', 'No such trade route.');
  endRoute(draft, route, 'cleared', ctx);
}

function endRoute(draft: GameState, route: TradeRoute, change: 'cleared' | 'lost', ctx: SimContext, reason?: string): void {
  const eco = economyOf(draft);
  const ship = draft.ships[route.shipId];
  if (ship) {
    delete ship.tradeRouteId;
    ship.dockedAt = route.fromId;
  }
  delete eco.routes[route.id];
  ctx.emit({ type: 'TradeRouteChanged', routeId: route.id, factionId: route.factionId, change, ...(reason !== undefined ? { reason } : {}) });
}

/** Why a route cannot run this month (undefined: it can). */
function suspension(state: GameState, content: Content, r: TradeRoute): TradeRouteSuspension | undefined {
  if (!state.ships[r.shipId]) return 'ship';
  if (r.captainId !== undefined && state.characters[r.captainId]?.alive !== true) return 'captain';
  for (const id of [r.fromId, r.toId]) {
    const s = state.settlements[id];
    if (!s || !state.markets[id] || !hasTradeMarket(content, s)) return 'market';
    if (s.factionId !== r.factionId && atWar(state, r.factionId, s.factionId)) return 'war';
    if (isBlockaded(state, id, state.time.hour)) return 'embargo';
  }
  return undefined;
}

interface Leg {
  from: SettlementId;
  to: SettlementId;
  goods: readonly GoodId[];
}

/** One leg: buy where cheap, sell at the other end; returns the net silver and the cargo value at risk. */
function runLeg(draft: GameState, ctx: SimContext, r: TradeRoute, leg: Leg, speech: number): { net: number; cargoValue: number; tons: number } {
  const content = ctx.content;
  const t = content.tunables.economy;
  const capacity = content.balance.ships[draft.ships[r.shipId]?.type ?? 'knarr']?.cargoT ?? 0;
  if (leg.goods.length === 0 || capacity <= 0) return { net: 0, cargoValue: 0, tons: 0 };
  const per = capacity / leg.goods.length;
  const own = (id: SettlementId) => draft.settlements[id]?.factionId === r.factionId;
  const owner = (id: SettlementId) => draft.settlements[id]?.factionId as FactionId;
  const pact = (id: SettlementId) => hasPact(draft, r.factionId, owner(id), 'trade', ctx.hour);
  const buyM = tradeMults(content, { speechcraft: speech, favorPct: 0, haggle: 0, tariff: tariffFor(content, own(leg.from), pact(leg.from)) });
  const sellM = tradeMults(content, { speechcraft: speech, favorPct: 0, haggle: 0, tariff: tariffFor(content, own(leg.to), pact(leg.to)) });
  const mFrom = draft.markets[leg.from];
  const mTo = draft.markets[leg.to];
  if (!mFrom || !mTo) return { net: 0, cargoValue: 0, tons: 0 };
  let net = 0;
  let cargoValue = 0;
  let tons = 0;
  const dec = t.market.stockDecimals;
  for (const good of leg.goods) {
    const inFrom = goodPriceInput(draft, content, leg.from, good, mFrom);
    const q = roundTo(Math.min(per, inFrom.stock * t.routes.maxStockShare), 3);
    if (!(q > 0)) continue;
    const cost = buyValue(content.balance, inFrom, q) * buyM.buyMult;
    const inTo = goodPriceInput(draft, content, leg.to, good, mTo);
    const revenue = sellValue(content.balance, inTo, q) * sellM.sellMult;
    if (revenue - cost < cost * t.routes.minMarginPct) continue;
    mFrom.stock[good] = roundTo(Math.max(0, (mFrom.stock[good] ?? 0) - q), dec);
    mTo.stock[good] = roundTo((mTo.stock[good] ?? 0) + q, dec);
    mFrom.tradeTons = roundTo((mFrom.tradeTons ?? 0) + q, dec);
    mTo.tradeTons = roundTo((mTo.tradeTons ?? 0) + q, dec);
    net += revenue - cost;
    cargoValue += cost;
    tons += q;
  }
  return { net, cargoValue, tons };
}

/**
 * Runs every route's month. Returns the ledger extras (route profits, and harbour tolls for the
 * owners of foreign harbours). Draws from `economy:routes`.
 */
export function runTradeRoutes(draft: GameState, ctx: SimContext): LedgerExtras {
  const content = ctx.content;
  const t = content.tunables.economy.routes;
  const eco = economyOf(draft);
  const extras: Required<LedgerExtras> = { tradeRoutes: {}, harbourTolls: {} };
  const ids = Object.keys(readEconomy(draft).routes) as TradeRouteId[];
  if (ids.length === 0) return extras;
  const rng = ctx.rng('economy:routes');
  const stormChance = t.stormPerLeg[season(ctx.hour)];
  for (const id of ids) {
    const r = eco.routes[id];
    if (!r) continue;
    const why = suspension(draft, content, r);
    if (why !== undefined) {
      if (why === 'ship') {
        endRoute(draft, r, 'lost', ctx, 'ship');
        continue;
      }
      if (r.status !== 'suspended' || r.suspended !== why) {
        r.status = 'suspended';
        r.suspended = why;
        ctx.emit({ type: 'TradeRouteChanged', routeId: id, factionId: r.factionId, change: 'suspended', reason: why });
      }
      r.lastProfit = 0;
      continue;
    }
    if (r.status === 'suspended') {
      r.status = 'active';
      delete r.suspended;
      ctx.emit({ type: 'TradeRouteChanged', routeId: id, factionId: r.factionId, change: 'resumed' });
    }
    const captain = r.captainId !== undefined ? draft.characters[r.captainId as CharId] : undefined;
    const speech = captain ? effectiveSkill(content, captain, 'speechcraft') : t.factorSpeechcraft;
    const progress = r.tripProgress + 30 / Math.max(1, r.roundTripDays);
    const trips = Math.min(t.maxTripsPerMonth, Math.floor(progress));
    r.tripProgress = roundTo(Math.min(progress - trips, 0.999), 3);
    let net = 0;
    let lost = false;
    const safe = (draft.settlements[r.fromId]?.factionId === r.factionId || hasPact(draft, r.factionId, draft.settlements[r.fromId]?.factionId ?? r.factionId, 'trade', ctx.hour)) &&
      (draft.settlements[r.toId]?.factionId === r.factionId || hasPact(draft, r.factionId, draft.settlements[r.toId]?.factionId ?? r.factionId, 'trade', ctx.hour));
    const piracy = t.piracyPerLeg * (atWarWithAnyone(draft, r.factionId) ? t.piracyWarMult : 1) * (safe ? t.safeHarbourMult : 1);
    for (let k = 0; k < trips && !lost; k++) {
      for (const leg of [{ from: r.fromId, to: r.toId, goods: r.outbound }, { from: r.toId, to: r.fromId, goods: r.inbound }] as Leg[]) {
        const res = runLeg(draft, ctx, r, leg, speech);
        let legNet = res.net;
        if (draft.settlements[leg.to]?.factionId !== r.factionId) {
          legNet -= t.harbourToll;
          const owner = draft.settlements[leg.to]?.factionId as FactionId;
          (extras.harbourTolls[owner] ??= []).push({ id, amount: t.harbourToll });
        }
        if (res.tons > 0 && rng.chance(piracy)) {
          legNet -= res.cargoValue + Math.max(0, res.net);
          r.losses += 1;
          ctx.emit({ type: 'TradeRouteIncident', routeId: id, factionId: r.factionId, kind: 'piracy', lossValue: Math.round(res.cargoValue), shipLost: false });
        } else if (rng.chance(stormChance)) {
          const loss = (res.cargoValue + Math.max(0, res.net)) * t.stormLossShare;
          legNet -= loss;
          r.losses += 1;
          const sink = rng.chance(t.stormSinkChance);
          if (!sink && t.stormHullDamage > 0 && ctx.env.effects.has('damageShip')) ctx.applyEffects([{ op: 'damageShip', shipId: r.shipId, hull: t.stormHullDamage } as never]);
          ctx.emit({ type: 'TradeRouteIncident', routeId: id, factionId: r.factionId, kind: 'storm', lossValue: Math.round(loss), shipLost: sink });
          if (sink) {
            if (ctx.env.effects.has('sinkShip')) ctx.applyEffects([{ op: 'sinkShip', shipId: r.shipId } as never]);
            else delete draft.ships[r.shipId as ShipId];
            lost = true;
          }
        }
        net += legNet;
        if (lost) break;
      }
      if (!lost) r.trips += 1;
    }
    const profit = Math.round(net);
    r.lastProfit = profit;
    r.profit += profit;
    const item: LedgerItem = { id, amount: profit, count: trips };
    (extras.tradeRoutes[r.factionId] ??= []).push(item);
    if (lost) {
      const live = eco.routes[id];
      if (live) endRoute(draft, live, 'lost', ctx, 'storm');
    }
  }
  return extras;
}
