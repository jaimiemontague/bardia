/**
 * Prices (design §11.2, §11.3). Pure functions shared by the simulation and the client.
 *
 *   price = base × clamp((T / max(S, 1))^e, lo, hi) × regionMod × eventMod     (balance.market: e, lo, hi)
 *
 * A trade of q tons moves the stock while it happens, so its value is the integral of the unit price
 * over the stock levels it passes through (`buyCost`, `sellRevenue`): selling a whole hold of furs in
 * a small market drives the price down as the furs pile up. The player's prices then apply the spread
 * (buy +10 %, sell −10 %), reduced by favour (Speechcraft ±1 % per point, `prices.favorPct` culture
 * bonuses, traits and feats, a haggled improvement) but never below the merchant's minimum edge, and
 * the tariff at foreign markets (a trade pact cuts it, §11.4). Because favour only narrows the spread,
 * buying and selling the same good in the same market always loses silver.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { clamp, dlog, dpow } from '@sim/core/dmath';
import type { GameState, GoodId, Market, SettlementId } from '@sim/core/state';
import { isSafeRecordKey } from '@sim/core/keys';
import { recGet, recNum, recOr } from './realm';
import type { PriceEvent } from './types';

/** The parameters of one good at one market that the price formula needs. */
export interface GoodPriceInput {
  /** Base price, s/ton (balance.goods[good].basePerTon). */
  base: number;
  /** Target stock T, tons. */
  target: number;
  /** Stock S, tons. */
  stock: number;
  /** regionMod × eventMod. */
  mod: number;
}

/** The clamped stock factor of the §11.2 formula: clamp((T / max(S, 1))^e, lo, hi). */
export function stockFactor(balance: Balance, target: number, stock: number): number {
  const m = balance.market;
  const ratio = target / Math.max(stock, 1);
  if (!(ratio > 0)) return m.priceClampMin;
  return clamp(dpow(ratio, m.priceExponent), m.priceClampMin, m.priceClampMax);
}

/**
 * §11.2 market price of one ton (s): base × clamp((T / max(S,1))^e, lo, hi) × regionMod × eventMod.
 */
export function priceFormula(balance: Balance, base: number, target: number, stock: number, regionMod = 1, eventMod = 1): number {
  return base * stockFactor(balance, target, stock) * regionMod * eventMod;
}

/** The market (mid) price of one ton at the current stock. */
export function unitPrice(balance: Balance, input: GoodPriceInput): number {
  return input.base * stockFactor(balance, input.target, input.stock) * input.mod;
}

/** ∫ₐᵇ (T/s)^e ds for 1 ≤ a ≤ b. */
function powerIntegral(target: number, a: number, b: number, e: number): number {
  if (Math.abs(1 - e) < 1e-9) return target * (dlog(b) - dlog(a));
  return (dpow(target, e) * (dpow(b, 1 - e) - dpow(a, 1 - e))) / (1 - e);
}

/**
 * ∫ of the clamped stock factor over stock levels [x0, x1] (tons): exact, piecewise (the stock floor
 * at 1 t, the upper clamp, the power law, the lower clamp).
 */
export function stockFactorIntegral(balance: Balance, target: number, x0: number, x1: number): number {
  const m = balance.market;
  const lo = m.priceClampMin;
  const hi = m.priceClampMax;
  const e = m.priceExponent;
  let a = Math.max(0, x0);
  const b = Math.max(0, x1);
  if (!(b > a)) return 0;
  if (!(target > 0)) return lo * (b - a);
  if (!(e > 0)) {
    // Degenerate exponent: integrate numerically (midpoint rule) for robustness.
    const steps = 32;
    const h = (b - a) / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += stockFactor(balance, target, a + (i + 0.5) * h);
    return sum * h;
  }
  let total = 0;
  if (a < 1) {
    const end = Math.min(b, 1);
    total += clamp(dpow(target, e), lo, hi) * (end - a);
    a = end;
    if (!(b > a)) return total;
  }
  const sHi = target * dpow(hi, -1 / e); // below: the upper clamp
  const sLo = target * dpow(lo, -1 / e); // above: the lower clamp
  if (a < sHi) {
    const end = Math.min(b, sHi);
    total += hi * (end - a);
    a = end;
  }
  if (a < b && a < sLo) {
    const end = Math.min(b, sLo);
    total += powerIntegral(target, a, end, e);
    a = end;
  }
  if (a < b) total += lo * (b - a);
  return total;
}

/** Market value of buying `tons` (the stock falls from S to S − tons). Requires tons ≤ S. */
export function buyValue(balance: Balance, input: GoodPriceInput, tons: number): number {
  if (!(tons > 0)) return 0;
  return input.base * input.mod * stockFactorIntegral(balance, input.target, input.stock - tons, input.stock);
}

/** Market value of selling `tons` (the stock rises from S to S + tons). */
export function sellValue(balance: Balance, input: GoodPriceInput, tons: number): number {
  if (!(tons > 0)) return 0;
  return input.base * input.mod * stockFactorIntegral(balance, input.target, input.stock, input.stock + tons);
}

// ---------------------------------------------------------------------------------------------
// Market modifiers

/** `regionMod` of the price formula for a good in a region (tunables.economy.regionPrice). */
export function regionPriceMod(content: Content, regionId: string | undefined, good: GoodId): number {
  if (regionId === undefined) return 1;
  return recOr(recGet(content.tunables.economy.regionPrice, regionId), good, 1);
}

/** Does a price event apply to a market? */
export function eventApplies(e: PriceEvent, settlementId: SettlementId, regionId: string | undefined, hour: number): boolean {
  if (e.untilHour <= hour) return false;
  if (e.settlementId !== undefined) return e.settlementId === settlementId;
  if (e.regionId !== undefined) return e.regionId === regionId;
  return true;
}

/** `eventMod` of the price formula: the product of the active price events for this market and good. */
export function eventPriceMod(events: readonly PriceEvent[], settlementId: SettlementId, regionId: string | undefined, good: GoodId, hour: number): number {
  let mod = 1;
  for (const e of events) if (e.good === good && eventApplies(e, settlementId, regionId, hour)) mod *= e.mult;
  return mod;
}

/** Region id of a settlement (its province's regionId). */
export function settlementRegion(state: GameState, settlementId: SettlementId): string | undefined {
  const s = state.settlements[settlementId];
  if (!s) return undefined;
  return state.provinces[s.provinceId]?.regionId;
}

/** The price inputs of one good at one market in a state. */
export function goodPriceInput(state: GameState, content: Content, settlementId: SettlementId, good: GoodId, market?: Market): GoodPriceInput {
  const m = market ?? state.markets[settlementId];
  const region = settlementRegion(state, settlementId);
  const events = state.economy?.priceEvents ?? [];
  const base = content.balance.goods[good].basePerTon;
  return {
    base,
    target: m ? recNum(m.target, good) : 0,
    stock: m ? recNum(m.stock, good) : 0,
    mod: regionPriceMod(content, region, good) * eventPriceMod(events, settlementId, region, good, state.time.hour),
  };
}

/** The current market (mid) price of a good at a settlement, s/ton (0 when it has no market). */
export function marketPrice(state: GameState, content: Content, settlementId: SettlementId, good: GoodId): number {
  if (!state.markets[settlementId] || !isSafeRecordKey(good)) return 0;
  return unitPrice(content.balance, goodPriceInput(state, content, settlementId, good));
}

// ---------------------------------------------------------------------------------------------
// The player's prices

/** Everything that moves the player's prices away from the market price. */
export interface TradeTerms {
  /** Speechcraft of whoever speaks for the buyer (the party speaker, a route captain …). */
  speechcraft: number;
  /** Σ `prices.favorPct` (culture bonuses, the speaker's traits and feats), percent. */
  favorPct: number;
  /** A haggled improvement, as a share (0.05 = 5 %). */
  haggle: number;
  /** Tariff share at this market (0 at home). */
  tariff: number;
}

/** Multipliers on market value for the player's purchases and sales. */
export interface TradeMults {
  buyMult: number;
  sellMult: number;
  /** Total favour as a share (before the merchant's minimum edge applies). */
  favour: number;
}

/** The player's buy/sell multipliers (§11.2): spread narrowed by favour, never below the merchant's edge; then the tariff. */
export function tradeMults(content: Content, terms: TradeTerms): TradeMults {
  const m = content.balance.market;
  const minEdge = content.tunables.economy.market.minMerchantEdge;
  const favour = terms.speechcraft * m.speechcraftPerPoint + terms.favorPct / 100 + terms.haggle;
  const buyEdge = Math.max(minEdge, m.buySpread - favour);
  const sellEdge = Math.max(minEdge, m.sellSpread - favour);
  const tariff = clamp(terms.tariff, 0, 0.95);
  return { buyMult: (1 + buyEdge) * (1 + tariff), sellMult: Math.max(0, 1 - sellEdge) * (1 - tariff), favour };
}

/** Tariff share for `factionId` trading at a market owned by `ownerId` (none at home; a trade pact cuts it). */
export function tariffFor(content: Content, own: boolean, pact: boolean): number {
  if (own) return 0;
  const base = content.tunables.economy.market.foreignTariff;
  return Math.max(0, base - (pact ? content.balance.market.tradePactTariffCut : 0));
}
