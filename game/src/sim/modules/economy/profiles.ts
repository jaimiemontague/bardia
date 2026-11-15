/**
 * Market profiles (design §11.2): each settlement's monthly production and consumption of every
 * good and its target stock T, from population, culture, faith, tier, economy state, buildings,
 * region and province tags (tunables.economy). Pure; the per-good tables are precomputed once per
 * Content object so the monthly pass over hundreds of markets is plain arithmetic.
 *
 *   P = perCapitaProduction × pop/1000 × tier (craft) × region × culture outputPct × (farms | prosperity) + buildings
 *   C = perCapitaConsumption × culture × faith × tier goods × pop/1000 × tier (luxury × prosperity) + buildings
 *   T = max(floor, (C × targetMonths + P × prodTargetMonths) × tier stock × Market-building stock) + fixed stores
 */
import type { Content } from '@content/index';
import { GOOD_IDS, type CultureId, type FaithId, type GoodId, type SettlementTierId } from '@content/schemas/ids';
import type { Settlement } from '@sim/core/state';
import { buildingEffect, buildingTier, cultureModifier, recGet, recNum, recOr } from './realm';

/** The goods in their canonical order (array index = good index everywhere in this module). */
export const GOODS: readonly GoodId[] = GOOD_IDS;
export const GOOD_COUNT = GOODS.length;

/** Index of a good id (−1 when unknown). */
export function goodIndex(good: string): number {
  return (GOODS as readonly string[]).indexOf(good);
}

interface TierTable {
  prod: number;
  craft: number;
  cons: number;
  luxury: number;
  stock: number;
  floor: number;
  goods: number[];
  fixed: number[];
}

interface BuildingTable {
  id: string;
  /** [tier − 1][good] tons per month. */
  prod: number[][];
  cons: number[][];
}

/** Per-good tables derived once from Content. */
export interface ProfileTables {
  basePrice: number[];
  luxury: boolean[];
  craft: boolean[];
  food: boolean[];
  prodBase: number[];
  consBase: number[];
  cultureProd: Partial<Record<CultureId, number[]>>;
  cultureCons: Partial<Record<CultureId, number[]>>;
  /** 1 + Σ `goods.<id>.outputPct` / 100 of the culture's bonuses. */
  cultureOutput: Partial<Record<CultureId, number[]>>;
  faithCons: Partial<Record<FaithId, number[]>>;
  regionProd: Record<string, number[]>;
  tagProd: Record<string, number[]>;
  tiers: Record<SettlementTierId, TierTable>;
  buildings: BuildingTable[];
  stockMult: readonly number[];
}

function fill(table: Partial<Record<string, number>> | undefined, fallback: number): number[] {
  return GOODS.map((g) => recOr(table, g, fallback));
}

let memoContent: Content | undefined;
let memoTables: ProfileTables | undefined;

/** The derived tables for a Content object (memoized by identity). */
export function profileTables(content: Content): ProfileTables {
  if (memoContent === content && memoTables) return memoTables;
  const t = content.tunables.economy;
  const tags = new Array<boolean>(GOOD_COUNT);
  const luxuryTags = t.luxuryTags;
  GOODS.forEach((g, i) => {
    tags[i] = content.balance.goods[g].tags.some((tag) => luxuryTags.includes(tag));
  });
  const cultureProd: Partial<Record<CultureId, number[]>> = {};
  const cultureCons: Partial<Record<CultureId, number[]>> = {};
  const cultureOutput: Partial<Record<CultureId, number[]>> = {};
  for (const c of Object.keys(content.cultures) as CultureId[]) {
    cultureProd[c] = fill(recGet(t.cultureProduction, c), 0);
    cultureCons[c] = fill(recGet(t.cultureConsumption, c), 1);
    cultureOutput[c] = GOODS.map((g) => Math.max(0, 1 + cultureModifier(content, c, `goods.${g}.outputPct`) / 100));
  }
  const faithCons: Partial<Record<FaithId, number[]>> = {};
  for (const f of Object.keys(t.faithConsumption) as FaithId[]) faithCons[f] = fill(recGet(t.faithConsumption, f), 1);
  const regionProd: Record<string, number[]> = {};
  for (const r of Object.keys(t.regionProduction)) regionProd[r] = fill(recGet(t.regionProduction, r), 1);
  const tagProd: Record<string, number[]> = {};
  for (const tag of Object.keys(t.tagProduction)) tagProd[tag] = fill(recGet(t.tagProduction, tag), 0);
  const tiers = {} as Record<SettlementTierId, TierTable>;
  for (const id of Object.keys(t.tiers) as SettlementTierId[]) {
    const p = t.tiers[id];
    tiers[id] = {
      prod: p.prod,
      craft: p.craft,
      cons: p.cons,
      luxury: p.luxury,
      stock: p.stock,
      floor: p.targetFloor,
      goods: fill(p.goods, 1),
      fixed: fill(p.fixed, 0),
    };
  }
  const buildings: BuildingTable[] = [];
  for (const id of Object.keys(t.buildingGoods)) {
    const def = recGet(t.buildingGoods, id);
    if (!def) continue;
    const maxTier = Math.max(0, ...Object.values(def.prod ?? {}).map((a) => a.length), ...Object.values(def.cons ?? {}).map((a) => a.length));
    const prod: number[][] = [];
    const cons: number[][] = [];
    for (let tier = 0; tier < maxTier; tier++) {
      prod.push(GOODS.map((g) => recGet(def.prod, g)?.[tier] ?? 0));
      cons.push(GOODS.map((g) => recGet(def.cons, g)?.[tier] ?? 0));
    }
    buildings.push({ id, prod, cons });
  }
  memoTables = {
    basePrice: GOODS.map((g) => content.balance.goods[g].basePerTon),
    luxury: tags,
    craft: GOODS.map((g) => t.craftGoods.includes(g)),
    food: GOODS.map((g) => t.foodGoods.includes(g)),
    prodBase: fill(t.productionPer1000, 0),
    consBase: fill(t.consumptionPer1000, 0),
    cultureProd,
    cultureCons,
    cultureOutput,
    faithCons,
    regionProd,
    tagProd,
    tiers,
    buildings,
    stockMult: t.marketStockMult,
  };
  memoContent = content;
  return memoTables;
}

/** Monthly production, consumption and target of one settlement (arrays of GOOD_COUNT, tons). */
export interface MarketProfile {
  prod: number[];
  cons: number[];
  target: number[];
}

/**
 * Writes a settlement's profile into `prod`, `cons` and `target` at `offset` (flat arrays of
 * markets × goods). `regionId` is the province's region, `tags` its province tags.
 */
export function writeProfile(
  content: Content,
  tables: ProfileTables,
  s: Settlement,
  regionId: string | undefined,
  tags: readonly string[],
  prod: Float64Array | number[],
  cons: Float64Array | number[],
  target: Float64Array | number[],
  offset: number,
): void {
  const t = content.tunables.economy;
  const k = Math.max(0, s.pop) / 1000;
  const tier = recGet(tables.tiers, s.tier) ?? tables.tiers.town;
  const prosperity = recOr(content.balance.economy.prosperity, s.economy, 1);
  const cProd = tables.cultureProd[s.culture];
  const cCons = tables.cultureCons[s.culture];
  const cOut = tables.cultureOutput[s.culture];
  const fCons = tables.faithCons[s.faith];
  const rProd = regionId !== undefined ? recGet(tables.regionProd, regionId) : undefined;
  const farmsMult = 1 + buildingEffect(content, 'farms', buildingTier(s, 'farms'), 'foodOutputPct');
  const marketTier = buildingTier(s, 'market');
  const stockMult = tier.stock * (marketTier > 0 ? (tables.stockMult[Math.min(marketTier, tables.stockMult.length) - 1] ?? 1) : 1);
  const targetMonths = t.market.targetMonths;
  const prodMonths = t.market.prodTargetMonths;
  for (let g = 0; g < GOOD_COUNT; g++) {
    let perCap = (tables.prodBase[g] ?? 0) + (cProd?.[g] ?? 0);
    for (const tag of tags) {
      const row = recGet(tables.tagProd, tag);
      if (row) perCap += row[g] ?? 0;
    }
    let pMult = (tables.craft[g] ? tier.craft : tier.prod) * (rProd?.[g] ?? 1) * (cOut?.[g] ?? 1);
    pMult *= tables.food[g] ? farmsMult : prosperity;
    let p = perCap * k * pMult;
    const cMult = tables.luxury[g] ? tier.luxury * prosperity : tier.cons;
    let c = (tables.consBase[g] ?? 0) * (cCons?.[g] ?? 1) * (fCons?.[g] ?? 1) * (tier.goods[g] ?? 1) * k * cMult;
    for (const b of tables.buildings) {
      const level = buildingTier(s, b.id);
      if (level <= 0) continue;
      const row = Math.min(level, b.prod.length) - 1;
      if (row < 0) continue;
      p += b.prod[row]?.[g] ?? 0;
      c += b.cons[row]?.[g] ?? 0;
    }
    const fixed = tier.fixed[g] ?? 0;
    const tgt = Math.max(tier.floor, (c * targetMonths + p * prodMonths) * stockMult) + fixed;
    prod[offset + g] = p;
    cons[offset + g] = c;
    target[offset + g] = tgt;
  }
}

/** A settlement's profile as arrays (client previews, tests). */
export function settlementProfile(content: Content, s: Settlement, regionId: string | undefined, tags: readonly string[]): MarketProfile {
  const prod = new Array<number>(GOOD_COUNT).fill(0);
  const cons = new Array<number>(GOOD_COUNT).fill(0);
  const target = new Array<number>(GOOD_COUNT).fill(0);
  writeProfile(content, profileTables(content), s, regionId, tags, prod, cons, target, 0);
  return { prod, cons, target };
}

/** Σ of a record over the goods (helper for volumes and loads). */
export function sumGoods(record: Partial<Record<GoodId, number>> | undefined): number {
  let sum = 0;
  for (const g of GOODS) sum += recNum(record, g);
  return sum;
}
