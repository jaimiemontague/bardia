/**
 * 'economy' simulation module (scheduler order 70).
 * Scope: Markets and prices, income and upkeep, the monthly ledger, trade pacts and routes, debt (§11, §31.1, §31.15).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   effects: changeEconomy
 *   commands: trade, haggle
 *   state slices: markets
 * Module-owned additions (not in ownership.ts; reported to the integrator):
 *   commands: setTradeRoute, clearTradeRoute
 *   effects: changeStores (the house storehouse; registered in ownership.ts)
 *   state: GameState.storehouse (the house storehouse at the capital: units and rules in types.ts)
 *   events: LedgerReport, TradeCompleted, HaggleResponse, TradeRouteChanged, TradeRouteIncident,
 *           EconomyChanged, ArrearsChanged
 *   condition fns: price, stock, economyState, treasury, inArrears, tradeRoutes
 *   state: GameState.economy (ledgers, arrears, routes, price events, blockades, rapport, haggle);
 *          Market.tradeVolume/tradeTons; Ship.tradeRouteId; PlayerPolicies.ledgerPause
 * Effects used (owned elsewhere): military addMen (desertion), damageShip/sinkShip (route storms) — each
 * skipped while its owner is absent.
 * Tunables: src/content/data/tunables/economy.json (+ schemas/tunables/economy.ts), read as ctx.tunables.economy.
 * Strings/assets: src/content/locales/en/economy.json and src/content/assets/manifest/economy.json (prefix 'economy.').
 * Gate: npm run verify:module -- economy
 *
 * HOW IT WORKS
 *   - init: markets for every settlement with a warm-up of market months (markets.ts); the house storehouse
 *     with its starting provisions (storehouse.ts). migrate (v1 → v2): the storehouse for older saves.
 *   - monthly: trade routes (routes.ts) → the market pass (stocks, AI merchant flows, economy drift) →
 *     every house's ledger, arrears and the player's LedgerReport (ledger.ts, arrears.ts).
 *   - commands: trade / haggle (trading.ts), setTradeRoute / clearTradeRoute (routes.ts).
 *   - effects: changeEconomy (effects.ts). Pure helpers for the client: prices (price.ts), ledgers
 *     (computeLedger), portable wealth (loot.ts).
 */
import { GOOD_IDS } from '@content/schemas/ids';
import type { CommandSchemas, ConditionEvalContext, ConditionFns, SimModule } from '@sim/core/module';
import type { GameState, GoodId, SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { ECONOMY_EFFECT_SCHEMAS, ECONOMY_EFFECTS } from './effects';
import { applyMonthlyLedgers } from './ledger';
import { ensureMarkets, runMarketMonth } from './markets';
import { marketPrice } from './price';
import { GOODS } from './profiles';
import { handleClearTradeRoute, handleSetTradeRoute, runTradeRoutes } from './routes';
import { economyOf, readEconomy } from './slice';
import { ensureStorehouse, storehouseInvariants, STORES_EFFECT_SCHEMAS, STORES_EFFECTS } from './storehouse';
import { handleHaggle, handleTrade } from './trading';
import type { HaggleCommand, SetTradeRouteCommand, TradeCommand } from './types';
import './types';

export type * from './types';
export { computeLedger, computeLedgers, settlementTax, unitWageOf, type LedgerComputation, type LedgerExtras } from './ledger';
export { goodsValue, portableWealth } from './loot';
export { buyValue, marketPrice, priceFormula, sellValue, stockFactor, tradeMults, unitPrice } from './price';
export { roundTripDays, routeSlots } from './routes';
export { haggleChance, merchantGreed, priceDeal, tradesFromStorehouse, tradingFleet, type Deal, type DealLine } from './trading';
export { homeSpeaker, readStorehouse, storedGoods, storedTons } from './storehouse';

const setId = z.string().regex(/^set_.+$/, 'must be a set_ id');
const tons = z.record(z.enum(GOOD_IDS), z.number().finite().min(0));

/** zod schemas of the economy commands. */
export const ECONOMY_COMMAND_SCHEMAS: CommandSchemas = {
  trade: z.object({ type: z.literal('trade'), settlementId: setId, buy: tons.optional(), sell: tons.optional(), fleetId: z.string().regex(/^flt_.+$/).optional(), storehouse: z.boolean().optional() }),
  haggle: z.object({
    type: z.literal('haggle'),
    settlementId: setId,
    action: z.enum(['offer', 'accept', 'walkAway']),
    buy: tons.optional(),
    sell: tons.optional(),
    fleetId: z.string().regex(/^flt_.+$/).optional(),
    storehouse: z.boolean().optional(),
    askPct: z.number().finite().optional(),
  }),
  setTradeRoute: z.object({
    type: z.literal('setTradeRoute'),
    routeId: z.string().regex(/^rec_.+$/).optional(),
    shipId: z.string().regex(/^shp_.+$/),
    captainId: z.string().regex(/^chr_.+$/).optional(),
    fromId: setId,
    toId: setId,
    outbound: z.array(z.enum(GOOD_IDS)).min(1),
    inbound: z.array(z.enum(GOOD_IDS)).optional(),
  }),
  clearTradeRoute: z.object({ type: z.literal('clearTradeRoute'), routeId: z.string().regex(/^rec_.+$/) }),
};

function settlementArg(args: readonly unknown[], i: number, ctx: ConditionEvalContext): SettlementId | undefined {
  const a = args[i];
  const id = typeof a === 'string' ? a : Object.hasOwn(ctx.scope, 'settlement') ? ctx.scope['settlement'] : ctx.state.player.capitalId;
  return id !== undefined && Object.hasOwn(ctx.state.settlements, id) ? (id as SettlementId) : undefined;
}

const goodArg = z.enum(GOOD_IDS);

/** The economy module's condition functions. */
export const ECONOMY_CONDITION_FNS: ConditionFns = {
  /** price(good, settlement?): the market price, s/ton (0 without a market). */
  price: {
    args: z.union([z.tuple([goodArg]), z.tuple([goodArg, z.string()])]),
    returns: 'number',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 1, ctx);
      return s !== undefined ? Math.round(marketPrice(ctx.state, ctx.env.content, s, args[0] as GoodId)) : 0;
    },
  },
  /** stock(good, settlement?): market stock, tons. */
  stock: {
    args: z.union([z.tuple([goodArg]), z.tuple([goodArg, z.string()])]),
    returns: 'number',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 1, ctx);
      return s !== undefined ? (ctx.state.markets[s]?.stock[args[0] as GoodId] ?? 0) : 0;
    },
  },
  /** economyState(settlement?): 'ruined' … 'thriving'. */
  economyState: {
    args: z.union([z.tuple([]), z.tuple([z.string()])]),
    returns: 'string',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      return s !== undefined ? (ctx.state.settlements[s]?.economy ?? '') : '';
    },
  },
  /** treasury(): the player's treasury, silver. */
  treasury: { args: z.tuple([]), returns: 'number', evaluate: (_a, ctx) => ctx.state.factions[ctx.state.player.factionId]?.treasury ?? 0 },
  /** inArrears(): the player's house owes its men. */
  inArrears: { args: z.tuple([]), returns: 'boolean', evaluate: (_a, ctx) => (readEconomy(ctx.state).arrears[ctx.state.player.factionId]?.amount ?? 0) > 0 },
  /** tradeRoutes(): active trade routes of the player's house. */
  tradeRoutes: {
    args: z.tuple([]),
    returns: 'number',
    evaluate: (_a, ctx) => Object.values(readEconomy(ctx.state).routes).filter((r) => r.factionId === ctx.state.player.factionId && r.status === 'active').length,
  },
};

/** Economy invariants: sane markets, treasuries, arrears, routes and ship links. */
export function economyInvariants(state: GameState): string[] {
  const out: string[] = [];
  for (const [id, m] of Object.entries(state.markets)) {
    if (!Object.hasOwn(state.settlements, id)) out.push(`market ${id}: no such settlement`);
    for (const g of GOODS) {
      const v = m.stock[g];
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) out.push(`market ${id}: stock of ${g} is ${v}`);
      const tgt = m.target[g];
      if (tgt !== undefined && !(Number.isFinite(tgt) && tgt >= 0)) out.push(`market ${id}: target of ${g} is ${tgt}`);
    }
  }
  if (state.economy !== undefined) {
    for (const id of Object.keys(state.settlements)) if (!Object.hasOwn(state.markets, id) && state.meta.moduleVersions['economy'] !== undefined) out.push(`settlement ${id}: no market`);
  }
  for (const f of Object.values(state.factions)) if (!(Number.isFinite(f.treasury) && f.treasury >= 0)) out.push(`faction ${f.id}: treasury ${f.treasury}`);
  const eco = readEconomy(state);
  for (const [id, a] of Object.entries(eco.arrears)) if (!(a.amount >= 0) || !Number.isFinite(a.amount)) out.push(`arrears ${id}: ${a.amount}`);
  for (const [id, r] of Object.entries(eco.routes)) {
    const ship = state.ships[r.shipId];
    if (!ship) out.push(`route ${id}: ship ${r.shipId} is gone`);
    else if (ship.tradeRouteId !== id) out.push(`route ${id}: ship ${r.shipId} does not name it`);
    if (!Object.hasOwn(state.factions, r.factionId)) out.push(`route ${id}: unknown faction`);
  }
  for (const ship of Object.values(state.ships)) {
    if (ship.tradeRouteId !== undefined && !Object.hasOwn(eco.routes, ship.tradeRouteId)) out.push(`ship ${ship.id}: runs unknown route ${ship.tradeRouteId}`);
  }
  for (const e of eco.priceEvents) if (!(e.mult > 0) || !Number.isFinite(e.untilHour)) out.push(`price event ${e.reason}: bad values`);
  out.push(...storehouseInvariants(state));
  return out;
}

export const module: SimModule = {
  id: 'economy',
  order: 70,
  version: 2,
  init(draft, ctx) {
    economyOf(draft);
    if (draft.player.policies.ledgerPause === undefined) draft.player.policies.ledgerPause = 'off';
    ensureMarkets(draft, ctx);
    ensureStorehouse(draft, ctx);
  },
  migrate(draft, _fromVersion, ctx) {
    economyOf(draft);
    if (draft.player.policies.ledgerPause === undefined) draft.player.policies.ledgerPause = 'off';
    ensureMarkets(draft, ctx);
    ensureStorehouse(draft, ctx);
  },
  handlers: {
    trade: (draft, cmd, ctx) => handleTrade(draft, cmd as TradeCommand, ctx),
    haggle: (draft, cmd, ctx) => handleHaggle(draft, cmd as HaggleCommand, ctx),
    setTradeRoute: (draft, cmd, ctx) => handleSetTradeRoute(draft, cmd as SetTradeRouteCommand, ctx),
    clearTradeRoute: (draft, cmd, ctx) => handleClearTradeRoute(draft, cmd, ctx),
  },
  commandSchemas: ECONOMY_COMMAND_SCHEMAS,
  systems: {
    daily(draft) {
      const h = draft.economy?.haggle;
      if (h !== undefined && h.hour !== draft.time.hour) delete economyOf(draft).haggle;
    },
    monthly(draft, ctx) {
      const extras = runTradeRoutes(draft, ctx);
      runMarketMonth(draft, ctx);
      applyMonthlyLedgers(draft, ctx, extras);
    },
  },
  effects: { ...ECONOMY_EFFECTS, ...STORES_EFFECTS },
  effectSchemas: { ...ECONOMY_EFFECT_SCHEMAS, ...STORES_EFFECT_SCHEMAS },
  conditionFns: ECONOMY_CONDITION_FNS,
  invariants: (state) => economyInvariants(state),
};
