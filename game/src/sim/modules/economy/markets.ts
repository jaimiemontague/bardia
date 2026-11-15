/**
 * The monthly market pass (design §11.2, §9.4), run for every settlement:
 *
 *  1. profiles: production, consumption and target stock T from population, culture, faith, tier,
 *     economy state, buildings, region and province tags (profiles.ts);
 *  2. stocks: S += production − consumption, each with ±noise (balance.market.monthlyNoise);
 *  3. AI merchant flows along the lane graph toward higher prices: for each lane and good the
 *     quantity that would equalise the two prices net of transport cost and tariffs (closed form
 *     under the price power law), damped by `flowRate`, capped by the source stock and by the lane's
 *     traffic (market sizes, ×pactTrafficMult for a trade pact), and blocked by war between the two
 *     owners, blockades and sieges; event modifiers (famine, harvest) shift the prices merchants see;
 *  4. overstock spoils or leaves the map; values are rounded;
 *  5. the economy state of each settlement drifts toward a score built from food security, trade
 *     volume, devastation, war, sieges, blockades and events (§11.2 last bullet).
 *
 * Markets exist for EVERY settlement (their goods are part of its portable wealth, §11.6); only
 * settlements with a market tier or a Market building trade (§9.2) and join the merchant lanes.
 *
 * Performance (§29.8, ≤ 10 ms on month boundaries): the pass reads one snapshot of each table it
 * needs, works on flat typed arrays (markets × goods), and replaces `draft.markets` with one write.
 */
import { ECONOMY_STATE_IDS, type EconomyStateId } from '@content/schemas/ids';
import { clamp, dpow } from '@sim/core/dmath';
import { relationKey } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { FactionId, GameState, Market, Relation, Settlement, SettlementId } from '@sim/core/state';
import { buildLaneGraph, type LaneNode } from './lanes';
import { eventApplies, regionPriceMod } from './price';
import { GOOD_COUNT, GOODS, goodIndex, profileTables, writeProfile } from './profiles';
import { hasTradeMarket, isBesieged, provinceTagTable, recNum, roundTo } from './realm';
import { economyOf, readEconomy, snap } from './slice';
import type { PriceEvent } from './types';

/** Options of one market pass. */
export interface MarketPassOptions {
  /** Warm-up month at market creation: no economy-state drift, no expiry bookkeeping. */
  warmup?: boolean;
}

/** Statistics of a pass (tests and the perf tool). */
export interface MarketPassStats {
  markets: number;
  created: number;
  lanes: number;
  flowTons: number;
  changedStates: number;
}

const RATIONS = goodIndex('rations');

/** Relation of two factions in a relations table (undefined when none). */
function relationOf(relations: Readonly<Record<string, Relation>>, a: string, b: string): Relation | undefined {
  if (a === b) return undefined;
  return relations[relationKey(a, b)];
}

function pactActive(rel: Relation | undefined, kind: string, hour: number): boolean {
  if (!rel) return false;
  for (const p of rel.pacts) if (p.kind === kind && (p.untilHour === undefined || p.untilHour > hour)) return true;
  return false;
}

/**
 * Runs one market month over every settlement (creating markets that are missing). Draws from the
 * `economy:market` stream (`economy:init` during the warm-up) and `economy:drift`.
 */
export function runMarketMonth(draft: GameState, ctx: SimContext, opts: MarketPassOptions = {}): MarketPassStats {
  const content = ctx.content;
  const balance = ctx.balance;
  const t = ctx.tunables.economy;
  const hour = ctx.hour;
  const warmup = opts.warmup === true;
  const tables = profileTables(content);
  const settlements = snap(draft.settlements);
  const markets = snap(draft.markets);
  const provinces = snap(draft.provinces);
  const relations = snap(draft.relations);
  const eco = snap(readEconomy(draft));
  const tags = provinceTagTable(provinces);
  const rng = ctx.rng(warmup ? 'economy:init' : 'economy:market');

  const ids = Object.keys(settlements) as SettlementId[];
  const n = ids.length;
  const G = GOOD_COUNT;
  const S = new Float64Array(n * G);
  const P = new Float64Array(n * G);
  const C = new Float64Array(n * G);
  const T = new Float64Array(n * G);
  const M = new Float64Array(n * G).fill(1);
  const flowVol = new Float64Array(n);
  const regions: (string | undefined)[] = new Array<string | undefined>(n);
  let created = 0;

  // Active price events (usually a handful).
  const events: PriceEvent[] = eco.priceEvents.filter((e) => e.untilHour > hour);
  const regionPrice = t.regionPrice;
  const [initLo, initHi] = t.market.initialStock;

  for (let i = 0; i < n; i++) {
    const id = ids[i] as SettlementId;
    const s = settlements[id] as Settlement;
    const region = provinces[s.provinceId]?.regionId;
    regions[i] = region;
    const off = i * G;
    writeProfile(content, tables, s, region, tags[s.provinceId] ?? [], P, C, T, off);
    const market = Object.hasOwn(markets, id) ? markets[id] : undefined;
    if (market) {
      for (let g = 0; g < G; g++) S[off + g] = Math.max(0, recNum(market.stock, GOODS[g] as string));
    } else {
      created++;
      for (let g = 0; g < G; g++) S[off + g] = (T[off + g] as number) * rng.range(initLo, initHi);
    }
    if (region !== undefined && Object.hasOwn(regionPrice, region)) {
      for (let g = 0; g < G; g++) M[off + g] = regionPriceMod(content, region, GOODS[g] as (typeof GOODS)[number]);
    }
    for (const e of events) {
      if (!eventApplies(e, id, region, hour)) continue;
      const g = goodIndex(e.good);
      if (g >= 0) M[off + g] = (M[off + g] as number) * e.mult;
    }
  }

  // 2. Production and consumption with noise.
  const noise = balance.market.monthlyNoise;
  for (let x = 0; x < n * G; x++) {
    const p = P[x] as number;
    const c = C[x] as number;
    if (p <= 0 && c <= 0) continue;
    const pr = p > 0 ? p * (1 + noise * (2 * rng.float() - 1)) : 0;
    const cr = c > 0 ? c * (1 + noise * (2 * rng.float() - 1)) : 0;
    S[x] = Math.max(0, (S[x] as number) + pr - cr);
  }

  // 3. AI merchant flows between trading markets.
  const nodes: LaneNode[] = [];
  const nodeMarket: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = settlements[ids[i] as SettlementId] as Settlement;
    if (!hasTradeMarket(content, s)) continue;
    nodes.push({ id: s.id, pos: s.mapPos, coastal: s.coastal });
    nodeMarket.push(i);
  }
  const worldIndex = snap((draft as GameState & { worldIndex?: unknown }).worldIndex);
  const graph = buildLaneGraph(content, nodes, worldIndex);
  const f = t.flows;
  const e = balance.market.priceExponent;
  const invE = e > 0 ? 1 / e : 1;
  // Effective targets T' = T × mod^(1/e): prices compare as (T'/S)^e.
  const Teff = new Float64Array(n * G);
  for (let x = 0; x < n * G; x++) {
    const m = M[x] as number;
    Teff[x] = m === 1 ? (T[x] as number) : (T[x] as number) * dpow(m, invE);
  }
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = settlements[ids[i] as SettlementId] as Settlement;
    const until = eco.blockades[s.id];
    const ext = s as Settlement & Record<string, unknown>;
    if ((until !== undefined && until > hour) || ext.blockaded === true || (typeof ext.blockadedUntil === 'number' && ext.blockadedUntil > hour) || isBesieged(s)) {
      blocked[i] = 1;
    }
  }
  const want = new Float64Array(G);
  let flowTons = 0;
  for (const lane of graph.lanes) {
    const ia = nodeMarket[lane.a] as number;
    const ib = nodeMarket[lane.b] as number;
    if (blocked[ia] === 1 || blocked[ib] === 1) continue;
    const sa = settlements[ids[ia] as SettlementId] as Settlement;
    const sb = settlements[ids[ib] as SettlementId] as Settlement;
    const rel = relationOf(relations, sa.factionId, sb.factionId);
    if (rel?.stance === 'war') continue;
    const pact = pactActive(rel, 'trade', hour);
    const foreign = sa.factionId !== sb.factionId && !pact;
    const capacity = f.laneTonsPerMonth * Math.min(recNum(f.sizeFactor, sa.tier), recNum(f.sizeFactor, sb.tier)) * (pact ? f.pactTrafficMult : 1);
    if (!(capacity > 0)) continue;
    const cost = f.transportCostBase + f.transportCostPerDay * lane.days * (lane.land ? f.landCostMult : 1) + (foreign ? f.foreignTariff : 0);
    const k = dpow(1 + cost, invE);
    const oa = ia * G;
    const ob = ib * G;
    let total = 0;
    for (let g = 0; g < G; g++) {
      const Ta = Teff[oa + g] as number;
      const Tb = Teff[ob + g] as number;
      const Sa = S[oa + g] as number;
      const Sb = S[ob + g] as number;
      let q = 0;
      const dab = Tb + k * Ta;
      if (dab > 0) {
        const qab = (Tb * Sa - k * Ta * Sb) / dab;
        if (qab > 0) q = Math.min(qab * f.flowRate, Sa * f.maxSourceShare);
      }
      if (q === 0) {
        const dba = Ta + k * Tb;
        if (dba > 0) {
          const qba = (Ta * Sb - k * Tb * Sa) / dba;
          if (qba > 0) q = -Math.min(qba * f.flowRate, Sb * f.maxSourceShare);
        }
      }
      want[g] = q;
      total += Math.abs(q);
    }
    if (total <= 1e-9) continue;
    const scale = total > capacity ? capacity / total : 1;
    for (let g = 0; g < G; g++) {
      const q = (want[g] as number) * scale;
      if (q === 0) continue;
      S[oa + g] = Math.max(0, (S[oa + g] as number) - q);
      S[ob + g] = Math.max(0, (S[ob + g] as number) + q);
    }
    const moved = total * scale;
    flowVol[ia] = (flowVol[ia] as number) + moved;
    flowVol[ib] = (flowVol[ib] as number) + moved;
    flowTons += moved;
  }

  // 4. Overstock, rounding, write-back.
  const over = t.market.overstockMult;
  const decay = t.market.overstockDecay;
  const dec = t.market.stockDecimals;
  const alpha = t.market.volumeAlpha;
  const next: Record<SettlementId, Market> = {};
  const volume = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const id = ids[i] as SettlementId;
    const off = i * G;
    const old = Object.hasOwn(markets, id) ? markets[id] : undefined;
    const stock: Market['stock'] = {};
    const target: Market['target'] = {};
    const prod: Market['prod'] = {};
    const cons: Market['cons'] = {};
    for (let g = 0; g < G; g++) {
      const good = GOODS[g] as (typeof GOODS)[number];
      let s = S[off + g] as number;
      const cap = (T[off + g] as number) * over;
      if (s > cap) s -= (s - cap) * decay;
      stock[good] = roundTo(Math.max(0, s), dec);
      target[good] = roundTo(T[off + g] as number, dec);
      prod[good] = roundTo(P[off + g] as number, dec);
      cons[good] = roundTo(C[off + g] as number, dec);
    }
    const traded = old?.tradeTons ?? 0;
    const vol = warmup && !old ? (flowVol[i] as number) : (1 - alpha) * (old?.tradeVolume ?? 0) + alpha * ((flowVol[i] as number) + traded);
    volume[i] = vol;
    const market: Market = { ...(old ?? {}), stock, target, prod, cons, lastUpdate: hour };
    market.tradeVolume = roundTo(vol, dec);
    market.tradeTons = 0;
    next[id] = market;
  }
  draft.markets = next;

  let changedStates = 0;
  if (!warmup) {
    changedStates = driftEconomies(draft, ctx, ids, settlements, relations, S, T, C, volume);
    expireBookkeeping(draft, hour);
  }
  return { markets: n, created, lanes: graph.lanes.length, flowTons, changedStates };
}

/** Economy-state drift (§9.4, §11.2) for every settlement with people. */
function driftEconomies(
  draft: GameState,
  ctx: SimContext,
  ids: readonly SettlementId[],
  settlements: Readonly<Record<SettlementId, Settlement>>,
  relations: Readonly<Record<string, Relation>>,
  S: Float64Array,
  T: Float64Array,
  C: Float64Array,
  volume: Float64Array,
): number {
  const d = ctx.tunables.economy.drift;
  const hour = ctx.hour;
  const G = GOOD_COUNT;
  const eco = economyOf(draft);
  const eventScore = snap(eco.eventScore);
  const rng = ctx.rng('economy:drift');
  const warring: Record<string, true> = {};
  for (const key of Object.keys(relations)) {
    const rel = relations[key];
    if (rel?.stance === 'war') {
      warring[rel.a] = true;
      warring[rel.b] = true;
    }
  }
  let changed = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as SettlementId;
    const s = settlements[id] as Settlement;
    if (!(s.pop > 0)) continue;
    const off = i * G;
    let score = recNum(d.cultureBase, s.culture);
    if (RATIONS >= 0) {
      const tr = T[off + RATIONS] as number;
      if (tr > 0) score += d.foodWeight * clamp((S[off + RATIONS] as number) / tr - 1, d.foodMin, d.foodMax);
    }
    let consumption = 0;
    for (let g = 0; g < G; g++) consumption += C[off + g] as number;
    if (consumption > 0) score += d.tradeWeight * clamp((volume[i] as number) / (consumption * d.volumeShareRef) - 1, -1, 1);
    if (s.devastationUntil !== undefined && s.devastationUntil > hour) score += d.devastation;
    if (Object.hasOwn(warring, s.factionId)) score += d.war;
    if (isBesieged(s)) score += d.siege;
    const until = eco.blockades[id];
    if (until !== undefined && until > hour) score += d.blockade;
    score += recNum(eventScore, id);

    const level = ECONOMY_STATE_IDS.indexOf(s.economy);
    const cur = level < 0 ? 3 : level;
    const aim = 3 + score;
    const roll = rng.float();
    let to = cur;
    if (aim >= cur + 0.5 + d.hysteresis && cur < ECONOMY_STATE_IDS.length - 1) to = cur + 1;
    else if (aim <= cur - 0.5 - d.hysteresis && cur > 0) to = cur - 1;
    if (to !== cur && roll < d.stepChance) {
      setEconomyState(draft, ctx, id, ECONOMY_STATE_IDS[to] as EconomyStateId, 'drift');
      changed++;
    }
  }
  // Fade event scores.
  for (const id of Object.keys(eventScore) as SettlementId[]) {
    const v = recNum(eventScore, id) * (1 - d.eventDecay);
    if (Math.abs(v) < 0.01) delete eco.eventScore[id];
    else eco.eventScore[id] = roundTo(v, 4);
  }
  return changed;
}

/**
 * Sets a settlement's economy state, emitting EconomyChanged (and notifying the player when it is
 * one of their holdings). No-op when unchanged.
 */
export function setEconomyState(draft: GameState, ctx: SimContext, id: SettlementId, to: EconomyStateId, cause: string): boolean {
  const s = draft.settlements[id];
  if (!s || s.economy === to) return false;
  const from = s.economy;
  s.economy = to;
  ctx.emit({ type: 'EconomyChanged', settlementId: id, from, to, cause });
  if (s.factionId === draft.player.factionId) {
    const up = ECONOMY_STATE_IDS.indexOf(to) > ECONOMY_STATE_IDS.indexOf(from);
    ctx.notify(up ? 'economy.state.improved' : 'economy.state.worsened', {
      priority: up ? 'low' : 'normal',
      vars: { settlement: s.name, state: to },
      link: { kind: 'settlement', id },
    });
  }
  return true;
}

/** Drops expired price events and blockades. */
function expireBookkeeping(draft: GameState, hour: number): void {
  const eco = economyOf(draft);
  if (eco.priceEvents.some((e) => e.untilHour <= hour)) eco.priceEvents = eco.priceEvents.filter((e) => e.untilHour > hour);
  for (const id of Object.keys(eco.blockades) as SettlementId[]) {
    if ((eco.blockades[id] ?? 0) <= hour) delete eco.blockades[id];
  }
}

/**
 * Creates the markets that are missing (new game, a save made before this module, settlements
 * founded since) and, when any were created, simulates `tunables.economy.market.warmupMonths` of
 * market dynamics so prices start shaped by production and trade. Returns the markets created.
 */
export function ensureMarkets(draft: GameState, ctx: SimContext): number {
  const settlements = snap(draft.settlements);
  let missing = 0;
  for (const id of Object.keys(settlements)) if (!Object.hasOwn(draft.markets, id)) missing++;
  let orphan = false;
  for (const id of Object.keys(draft.markets)) if (!Object.hasOwn(settlements, id)) orphan = true;
  if (missing === 0 && !orphan) return 0;
  const first = runMarketMonth(draft, ctx, { warmup: true });
  if (first.created > 0) {
    for (let m = 1; m < ctx.tunables.economy.market.warmupMonths; m++) runMarketMonth(draft, ctx, { warmup: true });
  }
  return first.created;
}

/** True if two factions' merchants are kept apart by war (helper for the client and routes). */
export function merchantsBlocked(state: GameState, a: FactionId, b: FactionId): boolean {
  return relationOf(state.relations, a, b)?.stance === 'war';
}
