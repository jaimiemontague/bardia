/**
 * Read-only market helpers shared by the market screens (home and abroad). Every price comes from the
 * economy module's own pure functions (`marketPrice`, `priceDeal`); this file only chooses which markets the
 * player knows about, which side holds the player's goods (a fleet abroad, the house storehouse at home)
 * and labels prices for display.
 *
 * Known markets: the player's own holdings plus every settlement the player's ships have visited
 * (`state.knowledge.visited`, world module) that has a market. The economy module keeps no record of the
 * prices seen on a visit, so the prices shown are the markets' current ones.
 */
import type { Content } from '@content/index';
import type { CommandError } from '@sim/core/commands';
import type { Fleet, GameState, GoodId, SettlementId } from '@sim/core/state';
import { marketPrice } from '@sim/modules/economy/price';
import { hasTradeMarket } from '@sim/modules/economy/realm';
import { seaDaysBetween } from '@sim/modules/economy/routes';
import { readStorehouse, storedTons } from '@sim/modules/economy/storehouse';
import { cargoTons, holdOf, priceDeal, type Deal } from '@sim/modules/economy/trading';
import type { GoodTons } from '@sim/modules/economy/types';

/** A price compared with the good's usual (base) price. */
export type PriceSignal = 'cheap' | 'fair' | 'dear';

/** Share of the base price at or below which a good counts as cheap. */
export const CHEAP_AT = 0.85;
/** Share of the base price at or above which a good counts as dear. */
export const DEAR_AT = 1.2;

/** The goods of the economy, in content order. */
export function goodIds(content: Content): GoodId[] {
  return Object.keys(content.balance.goods) as GoodId[];
}

/** Whether a settlement has a market the player can see prices at. */
export function hasMarket(state: GameState, content: Content, id: SettlementId): boolean {
  return state.markets[id] !== undefined && hasTradeMarket(content, state.settlements[id]);
}

/**
 * Markets the player knows: their own holdings, then visited settlements, each with a market, sorted by
 * name within each group. `exclude` drops one settlement (the market being viewed).
 */
export function knownMarkets(state: GameState, content: Content, exclude?: SettlementId): SettlementId[] {
  const own: SettlementId[] = [];
  const visited: SettlementId[] = [];
  const holdings = state.factions[state.player.factionId]?.holdingIds ?? [];
  for (const id of holdings) if (id !== exclude && hasMarket(state, content, id)) own.push(id);
  for (const key of Object.keys(state.knowledge?.visited ?? {})) {
    const id = key as SettlementId;
    if (id === exclude || own.includes(id) || !Object.hasOwn(state.settlements, id)) continue;
    if (hasMarket(state, content, id)) visited.push(id);
  }
  const byName = (a: SettlementId, b: SettlementId) => (state.settlements[a]?.name ?? a).localeCompare(state.settlements[b]?.name ?? b);
  return [...own.sort(byName), ...visited.sort(byName)];
}

/** Days since the player last visited a settlement (undefined for never; 0 for own holdings). */
export function daysSinceVisit(state: GameState, id: SettlementId): number | undefined {
  const s = state.settlements[id];
  if (s?.factionId === state.player.factionId) return 0;
  const hour = state.knowledge?.visited[id];
  return hour === undefined ? undefined : Math.max(0, Math.floor((state.time.hour - hour) / 24));
}

/** Labels a market price against the good's base price. */
export function priceSignal(content: Content, good: GoodId, price: number): PriceSignal {
  const base = content.balance.goods[good]?.basePerTon ?? 0;
  if (!(base > 0) || !(price > 0)) return 'fair';
  const r = price / base;
  return r <= CHEAP_AT ? 'cheap' : r >= DEAR_AT ? 'dear' : 'fair';
}

/** The current market price of a good at a settlement, whole silver per ton (0 without a market). */
export function priceAt(state: GameState, content: Content, id: SettlementId, good: GoodId): number {
  return Math.round(marketPrice(state, content, id, good));
}

/** Highest (sell: where it fetches most) or lowest (buy: where it is cheapest) price among `markets`. */
export function bestPrice(state: GameState, content: Content, good: GoodId, markets: readonly SettlementId[], side: 'sell' | 'buy'): { id: SettlementId; price: number } | undefined {
  let best: { id: SettlementId; price: number } | undefined;
  for (const id of markets) {
    const price = priceAt(state, content, id, good);
    if (!(price > 0)) continue;
    if (side === 'buy' && (state.markets[id]?.stock[good] ?? 0) < 0.5) continue;
    if (!best || (side === 'sell' ? price > best.price : price < best.price)) best = { id, price };
  }
  return best;
}

/** Nominal sea days between two markets (economy's lane distance), rounded to a tenth; undefined if unknown. */
export function seaDays(state: GameState, content: Content, a: SettlementId, b: SettlementId): number | undefined {
  const d = seaDaysBetween(state, content, a, b);
  return Number.isFinite(d) ? Math.round(d * 10) / 10 : undefined;
}

/** Who holds the goods on the player's side of a deal: a fleet in the harbour, or the house storehouse (capital). */
export type Holder = { kind: 'fleet'; fleet: Fleet } | { kind: 'storehouse' };

/** The `trade` command fields that name a holder. */
export function holderFields(holder: Holder): { fleetId: Fleet['id'] } | { storehouse: true } {
  return holder.kind === 'fleet' ? { fleetId: holder.fleet.id } : { storehouse: true };
}

/** A quote: the silver for a batch, or the economy's reason it cannot be made. */
export type Quote = { ok: true; silver: number; deal: Deal } | { ok: false; code: string };

/** Prices a batch exactly as the `trade` command will (the economy's own `priceDeal`). */
export function quoteTrade(state: GameState, content: Content, settlementId: SettlementId, holder: Holder, batch: { buy?: GoodTons; sell?: GoodTons }): Quote {
  try {
    const d = priceDeal(state, content, { settlementId, ...batch, ...holderFields(holder) });
    return { ok: true, silver: d.earned - d.spent, deal: d };
  } catch (e) {
    return { ok: false, code: (e as CommandError).code ?? 'unknown' };
  }
}

/** The silver one side of a single-good trade would cost (buy) or bring (sell), or why it cannot be made. */
export function dealQuote(state: GameState, content: Content, settlementId: SettlementId, side: 'buy' | 'sell', good: GoodId, tons: number, holder: Holder): Quote {
  if (!(tons > 0)) return { ok: false, code: 'emptyDeal' };
  const q = quoteTrade(state, content, settlementId, holder, { [side]: { [good]: tons } });
  return q.ok ? { ...q, silver: Math.abs(q.silver) } : q;
}

/** Tons of a good the player's side holds (rations as tons of their count). */
export function heldTons(state: GameState, content: Content, holder: Holder, good: GoodId): number {
  const perTon = content.balance.economy.rationsPerTon;
  return holder.kind === 'fleet' ? cargoTons(holder.fleet, good, perTon) : storedTons(readStorehouse(state), good, perTon);
}

/** Rations (a count) to tons, rounded up to the market's kilogram. */
export function rationsToTons(content: Content, rations: number): number {
  return Math.ceil((Math.max(0, rations) / content.balance.economy.rationsPerTon) * 1000) / 1000;
}

/** Codes of a quote that only say "not that much" (a limit), as opposed to a closed market. */
const LIMIT_CODES: ReadonlySet<string> = new Set(['notEnoughSilver', 'holdFull', 'notInStock', 'notAboard', 'notStored', 'emptyDeal']);

/**
 * Why the market cannot trade with the player at all right now (the economy's code: embargo, blockade, no
 * market, no ship in the harbour), or undefined when it can. Probes with the smallest batch `priceDeal` takes.
 */
export function marketClosedCode(state: GameState, content: Content, settlementId: SettlementId, holder: Holder): string | undefined {
  const q = quoteTrade(state, content, settlementId, holder, { buy: { rations: 0.001 } });
  return q.ok || LIMIT_CODES.has(q.code) ? undefined : q.code;
}

/** Free hold space (tons) on the player's side: the fleet's holds abroad; the storehouse has no limit. */
export function holdRoom(state: GameState, content: Content, holder: Holder): number {
  if (holder.kind === 'storehouse') return Number.POSITIVE_INFINITY;
  const { capacity, used } = holdOf(state, content, holder.fleet);
  return Math.max(0, Math.floor((capacity - used) * 1000) / 1000);
}

/** The most of one good the player can buy here now, and the economy's reason it is not more. */
export interface BuyLimit {
  /** Tons (to the kilogram). */
  tons: number;
  /** What stops it: the market's stock (no reason worth showing), the holds, or the purse. */
  limit: 'stock' | 'hold' | 'silver' | 'other';
}

/**
 * Finds the largest purchase of `good` the economy's `priceDeal` accepts (a bisection over its own quotes, so
 * spread, Speechcraft, tariffs and the rising price as stock runs down are all the sim's).
 */
export function maxBuy(state: GameState, content: Content, settlementId: SettlementId, good: GoodId, holder: Holder): BuyLimit {
  const stock = Math.floor((state.markets[settlementId]?.stock[good] ?? 0) * 1000) / 1000;
  const room = holdRoom(state, content, holder);
  const cap = content.tunables.economy.trade.maxTonsPerGood;
  const upper = Math.min(stock, room, cap);
  const bound: BuyLimit['limit'] = upper >= stock ? 'stock' : upper >= room ? 'hold' : 'other';
  if (!(upper > 0)) return { tons: 0, limit: bound };
  const ok = (tons: number) => quoteTrade(state, content, settlementId, holder, { buy: { [good]: tons } }).ok;
  if (ok(upper)) return { tons: upper, limit: bound };
  const fail = quoteTrade(state, content, settlementId, holder, { buy: { [good]: upper } });
  const limit: BuyLimit['limit'] = !fail.ok && fail.code === 'notEnoughSilver' ? 'silver' : !fail.ok && fail.code === 'holdFull' ? 'hold' : 'other';
  let lo = 0;
  let hi = upper;
  for (let i = 0; i < 30 && hi - lo > 0.0005; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  const tons = Math.floor(lo * 1000) / 1000;
  return { tons: tons > 0 && ok(tons) ? tons : 0, limit };
}

/** The silver the player's side can spend here: the treasury at home, the fleet's purse abroad. */
export function purseOf(state: GameState, settlementId: SettlementId, holder: Holder): number {
  const own = state.settlements[settlementId]?.factionId === state.player.factionId;
  const treasury = state.factions[state.player.factionId]?.treasury ?? 0;
  return Math.floor(own || holder.kind === 'storehouse' ? treasury : holder.fleet.silver);
}
