/**
 * Portable wealth (design §11.6, §31.20): what a settlement holds that raiders can carry off —
 * `portable = silverStock + goodsPortableShare × goodsValue`, the goods valued at the local market
 * price (or the base price, tunables.economy.loot.priceMode). Pure; the client's raid planner and the
 * battle/settlement modules (from their own copy of the formula's data) use it.
 */
import type { Content } from '@content/index';
import type { GameState, GoodId, SettlementId } from '@sim/core/state';
import { marketPrice } from './price';
import { GOODS } from './profiles';

/** Value of a settlement's market goods (local or base prices). */
export function goodsValue(state: GameState, content: Content, settlementId: SettlementId): number {
  const m = state.markets[settlementId];
  if (!m) return 0;
  const local = content.tunables.economy.loot.priceMode === 'local';
  let sum = 0;
  for (const g of GOODS) {
    const tons = Math.max(0, m.stock[g] ?? 0);
    if (tons <= 0) continue;
    const price = local ? marketPrice(state, content, settlementId, g as GoodId) : content.balance.goods[g].basePerTon;
    sum += tons * price;
  }
  return sum;
}

/** §31.20 portable wealth of a settlement, silver. */
export function portableWealth(state: GameState, content: Content, settlementId: SettlementId): number {
  const s = state.settlements[settlementId];
  if (!s) return 0;
  return Math.round(Math.max(0, s.silver) + content.balance.loot.goodsPortableShare * goodsValue(state, content, settlementId));
}
