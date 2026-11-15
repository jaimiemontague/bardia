/**
 * Tunables owned by the 'economy' module: src/content/data/tunables/economy.json, read in sim code as
 * `ctx.tunables.economy`. The economy agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): the price formula, spreads, Speechcraft and tariff values (`balance.market`), goods base
 * prices (`balance.goods`), taxes, tolls, tribute shares, wages and arrears (`balance.economy`),
 * building upkeep (`balance.buildings`) and loot shares (`balance.loot`).
 *
 * Everything here is a value the design leaves open (§11.2 "production and consumption from culture,
 * tier and buildings", AI merchant flows, economy-state drift, haggling, trade-route risks): first
 * guesses for the balance harness.
 */
import { z } from 'zod';
import { BUILDING_IDS, CULTURE_IDS, FAITH_IDS, GOOD_IDS, SEASON_IDS, SETTLEMENT_TIER_IDS } from '../ids';

const num = z.number().finite();
const nonNeg = num.min(0);
const prob = num.min(0).max(1);
const positive = num.positive();
const count = z.number().int().min(0);
const camelId = z.string().regex(/^[a-z][A-Za-z0-9]*$/);
/** Inclusive [lo, hi] range with lo ≤ hi. */
const range = z.tuple([num, num]).refine(([lo, hi]) => lo <= hi, 'range lo must not exceed hi');

/** A partial good → number table (unknown goods are errors). */
const goodTable = (value: z.ZodNumber) => z.record(z.enum(GOOD_IDS), value);
/** A full good → number table (every good must be listed). */
const fullGoodTable = (value: z.ZodNumber) => {
  const shape = {} as Record<(typeof GOOD_IDS)[number], z.ZodNumber>;
  for (const g of GOOD_IDS) shape[g] = value;
  return z.object(shape).strict();
};
const tierTable = <T extends z.ZodTypeAny>(value: T) => {
  const shape = {} as Record<(typeof SETTLEMENT_TIER_IDS)[number], T>;
  for (const t of SETTLEMENT_TIER_IDS) shape[t] = value;
  return z.object(shape).strict();
};

const TierProfileSchema = z
  .object({
    /** Multiplier on per-capita production of ordinary goods. */
    prod: nonNeg,
    /** Multiplier on per-capita production of craft goods (`craftGoods`: cloth, jewellery, weapons). */
    craft: nonNeg,
    /** Multiplier on per-capita consumption of ordinary goods. */
    cons: nonNeg,
    /** Multiplier on per-capita consumption of luxury goods (goods tagged with one of `luxuryTags`). */
    luxury: nonNeg,
    /** Multiplier on the target stock T (merchant stock depth). */
    stock: positive,
    /** Floor of T in tons for every good (the §11.2 price formula floors the stock at 1 t, so T ≥ 1 shows scarcity). */
    targetFloor: nonNeg,
    /** Extra consumption multipliers for single goods (cloisters burn candles, temple-steads pour mead). */
    goods: goodTable(nonNeg).optional(),
    /** Fixed stores added to T and to the initial stock (fortress magazines), tons. */
    fixed: goodTable(nonNeg).optional(),
  })
  .strict();

const BuildingGoodsSchema = z
  .object({
    /** Production added by the building, tons per month, indexed by building tier − 1. */
    prod: z.record(z.enum(GOOD_IDS), z.array(nonNeg)).optional(),
    /** Consumption added by the building, tons per month, indexed by building tier − 1. */
    cons: z.record(z.enum(GOOD_IDS), z.array(nonNeg)).optional(),
  })
  .strict();

const MarketSchema = z
  .object({
    /** T = consumption × targetMonths + production × prodTargetMonths (then tier, building and floor rules). */
    targetMonths: nonNeg,
    prodTargetMonths: nonNeg,
    /** Stock above T × overstockMult spoils or leaves the map at `overstockDecay` of the excess per month. */
    overstockMult: positive,
    overstockDecay: prob,
    /** Months of market dynamics simulated when markets are first created (new game / old save). */
    warmupMonths: count,
    /** Initial stock as a share of T before the warm-up, drawn uniformly from this range. */
    initialStock: range,
    /** Tariff on the player's trade at markets of other factions (a trade pact cuts it by balance.market.tradePactTariffCut). */
    foreignTariff: prob,
    /** The merchant always keeps at least this edge over the market price, however good the player's favour. */
    minMerchantEdge: prob,
    /** Decimal places kept for stock, target, production and consumption (tons). */
    stockDecimals: z.number().int().min(0).max(6),
    /** Weight of the newest month in the trade-volume moving average. */
    volumeAlpha: prob,
  })
  .strict();

const FallbackLanesSchema = z
  .object({
    /** Each coastal market links to this many nearest coastal markets … */
    neighbours: count,
    /** … within this straight-line distance (map cells). */
    maxCells: positive,
    /** Inland markets (or ones no sea lane reaches) link overland to this many nearest markets … */
    landNeighbours: count,
    landMaxCells: positive,
    /** Sea distance = straight line × seaDetour; land distance × landDetour. */
    seaDetour: positive,
    landDetour: positive,
    cellKm: positive,
    /** Nominal travel speeds (km per day) for lane days. */
    seaKmPerDay: positive,
    landKmPerDay: positive,
  })
  .strict();

const FlowsSchema = z
  .object({
    /** AI merchant tons a lane carries per month between two town-sized markets. */
    laneTonsPerMonth: nonNeg,
    /** Market size factor for lane capacity (a lane carries the smaller of its two ends). */
    sizeFactor: tierTable(nonNeg),
    /** Price premium merchants need to move a good: base + per lane-day (+ tariffs between foreign markets). */
    transportCostBase: nonNeg,
    transportCostPerDay: nonNeg,
    /** Overland links cost this many times more per day. */
    landCostMult: positive,
    /** Share of the price-equalising quantity actually moved in a month. */
    flowRate: prob,
    /** At most this share of the source's stock leaves along one lane in a month. */
    maxSourceShare: prob,
    /** Lane capacity multiplier when the two factions have a trade pact (§11.4 "+AI merchant traffic"). */
    pactTrafficMult: positive,
    /** Tariff merchants pay between markets of different factions without a trade pact. */
    foreignTariff: prob,
    fallback: FallbackLanesSchema,
  })
  .strict();

const DriftSchema = z
  .object({
    /** Constant term of the economy score per culture (rich old lands, poor frontiers). */
    cultureBase: z.record(z.enum(CULTURE_IDS), num),
    /** Food security: weight × clamp(rations S/T − 1, foodMin, foodMax). */
    foodWeight: num,
    foodMin: num,
    foodMax: num,
    /** Trade volume: weight × clamp(volume / (Σ consumption × volumeShareRef) − 1, −1, 1). */
    tradeWeight: num,
    volumeShareRef: positive,
    /** Flat terms while devastated, at war, besieged, blockaded. */
    devastation: num,
    war: num,
    siege: num,
    blockade: num,
    /** Share of the event score (changeEconomy `score`) that fades each month. */
    eventDecay: prob,
    /** Chance per month to move one economy step toward the target. */
    stepChance: prob,
    /** Extra score beyond the half-step needed to move (avoids flicker at the boundary). */
    hysteresis: nonNeg,
  })
  .strict();

const EventsSchema = z
  .object({
    /** Days a preset price event lasts (the multipliers are balance.market.famineRationsMult / goodHarvestRationsMult). */
    famineDays: positive,
    goodHarvestDays: positive,
    /** Largest and smallest multiplier a price event may carry. */
    maxMult: positive,
    minMult: positive,
  })
  .strict();

const LedgerSchema = z
  .object({
    /** Character roles that draw a lieutenant's wage (non-kin, not the ruler, not captive). */
    lieutenantRoles: z.array(camelId),
    /** AI garrisons are part-time levies: their wages are scaled by this. */
    aiGarrisonWageMult: nonNeg,
    /** Wage per man for unit types without a `wage` in balance.units (enemy and guardian units). */
    fallbackUnitWage: nonNeg,
    /** A flag `${crownFlagPrefix}<kingdomId>` marks a crown the player holds (royal estates, route slots). */
    crownFlagPrefix: z.string().min(1),
    /** Province tag that marks a Straits province (§31.1 straits tolls). */
    straitsTag: camelId,
    /** Faction culture that collects the full straits rate (balance.economy.straitsTollMult.eyjar). */
    straitsFullRateCulture: z.enum(CULTURE_IDS),
  })
  .strict();

const ArrearsSchema = z
  .object({
    /** Outstanding arrears never exceed this many months of expenses (men will not wait forever). */
    capMonths: positive,
    /** Fleet morale bounds when arrears lower it. */
    moraleMin: num,
    moraleMax: num,
  })
  .strict();

const TradeSchema = z
  .object({
    /** A fleet within this many map cells of a settlement (and not sailing) can trade there. */
    dockRadius: nonNeg,
    /** Sale proceeds abroad go into the fleet's silver (carried home); at home they go to the treasury. */
    proceedsToFleetAbroad: z.boolean(),
    /** Merchant rapport gained per 1,000 s traded, capped per transaction. */
    rapportPerThousand: nonNeg,
    rapportGainCap: nonNeg,
    /** Largest quantity of one good in a single transaction (tons; sanity cap). */
    maxTonsPerGood: positive,
  })
  .strict();

const HaggleSchema = z
  .object({
    /** Largest improvement the player may ask for, percent of the listed price. */
    maxAskPct: positive,
    /** Acceptance chance = base + speechcraftPer × Speechcraft + rapportPer × rapport − greedWeight × greed − askWeight × ask% − roundPenalty × (round − 1). */
    base: num,
    speechcraftPer: num,
    rapportPer: num,
    greedWeight: num,
    askWeight: num,
    roundPenalty: num,
    minChance: prob,
    maxChance: prob,
    /** Width of the counter-offer band after the acceptance chance. */
    counterBand: prob,
    /** A counter-offer meets the player at this share of the ask. */
    counterShare: prob,
    /** Rapport lost when the merchant refuses (pushing too hard), plus per round beyond the first. */
    rapportLossOnRefuse: nonNeg,
    rapportLossPerRound: nonNeg,
    /** Rapport gained when a haggled deal is closed. */
    rapportGainOnAccept: nonNeg,
    rapportRange: range,
    /** Merchant greed (0–1) is drawn per settlement from this range (stable for the campaign). */
    greedRange: range,
  })
  .strict();

const RoutesSchema = z
  .object({
    /** Ship types that can run a trade route (§11.4: a knarr). */
    shipTypes: z.array(camelId).min(1),
    /** Speechcraft of a hired factor (lieutenant captains use their own). */
    factorSpeechcraft: nonNeg,
    maxTripsPerMonth: count,
    minRoundTripDays: positive,
    /** Loading and unloading days at each end of the loop. */
    portDays: nonNeg,
    /** A route buys at most this share of a market's stock of one good per trip. */
    maxStockShare: prob,
    /** Goods are carried only while the expected margin is at least this share of the buying price. */
    minMarginPct: nonNeg,
    /** Harbour toll paid per call at a market of another faction (to that faction). */
    harbourToll: nonNeg,
    /** Piracy chance per leg (×piracyWarMult while the route's house is at war with anyone). */
    piracyPerLeg: prob,
    piracyWarMult: nonNeg,
    /** Piracy multiplier when both ends belong to the route's house or a trade partner (safe harbour). */
    safeHarbourMult: nonNeg,
    /** Storm chance per leg by season. */
    stormPerLeg: z.object(Object.fromEntries(SEASON_IDS.map((s) => [s, prob])) as Record<(typeof SEASON_IDS)[number], typeof prob>).strict(),
    /** Share of the cargo lost to a storm; hull damage (needs the military module's damageShip op); chance the ship founders. */
    stormLossShare: prob,
    stormHullDamage: nonNeg,
    stormSinkChance: prob,
  })
  .strict();

const LootSchema = z
  .object({
    /** Goods in portable-wealth estimates are valued at the local market price ('local') or the base price ('base'). */
    priceMode: z.enum(['local', 'base']),
  })
  .strict();

export const schema = z
  .object({
    /** Per-capita consumption everywhere, tons per month per 1,000 people. */
    consumptionPer1000: fullGoodTable(nonNeg),
    /** Per-capita production everywhere (rations: farms and fisheries), tons per month per 1,000 people. */
    productionPer1000: goodTable(nonNeg),
    /** Extra production by settlement culture (§11.1 main producers), tons per month per 1,000 people. */
    cultureProduction: z.record(z.enum(CULTURE_IDS), goodTable(nonNeg)),
    /** Consumption multipliers by settlement culture (§11.1 main consumers). */
    cultureConsumption: z.record(z.enum(CULTURE_IDS), goodTable(nonNeg)),
    /** Consumption multipliers by settlement faith (Lantern candles, sacramental wine). */
    faithConsumption: z.record(z.enum(FAITH_IDS), goodTable(nonNeg)),
    /** Production multipliers by region id (province.regionId): climate and fishing grounds. */
    regionProduction: z.record(camelId, goodTable(nonNeg)),
    /** `regionMod` of the §11.2 price formula, by region id. */
    regionPrice: z.record(camelId, goodTable(positive)),
    /** Extra production from province tags (iron, furs, ironBogs …), tons per month per 1,000 people. */
    tagProduction: z.record(camelId, goodTable(nonNeg)),
    /** Goods whose production uses the tier's `craft` multiplier. */
    craftGoods: z.array(z.enum(GOOD_IDS)),
    /** Goods carrying one of these balance.goods tags use the tier's `luxury` consumption multiplier and scale with prosperity. */
    luxuryTags: z.array(camelId),
    /** Goods whose production is raised by the Farms building (balance.buildings.farms foodOutputPct). */
    foodGoods: z.array(z.enum(GOOD_IDS)),
    tiers: tierTable(TierProfileSchema),
    /** Goods made and used by buildings, by building id. */
    buildingGoods: z.record(z.enum(BUILDING_IDS), BuildingGoodsSchema),
    /** T multiplier by Market building tier (index tier − 1): "merchant stock variety". */
    marketStockMult: z.array(positive),
    market: MarketSchema,
    flows: FlowsSchema,
    drift: DriftSchema,
    events: EventsSchema,
    ledger: LedgerSchema,
    arrears: ArrearsSchema,
    trade: TradeSchema,
    haggle: HaggleSchema,
    routes: RoutesSchema,
    loot: LootSchema,
    /** The house storehouse at the capital (economy-owned `state.storehouse`). */
    storehouse: z
      .object({
        /** A new game's storehouse holds rations for this many days of every man in the capital's garrison. */
        startRationDays: nonNeg,
        /** Trade goods a new game's storehouse starts with, tons (rations are never listed here). */
        startGoods: goodTable(nonNeg),
      })
      .strict(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
