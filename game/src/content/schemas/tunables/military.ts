/**
 * Tunables owned by the 'military' module: src/content/data/tunables/military.json, read in sim code as
 * `ctx.tunables.military`. The military agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): recruitment (§31.5), squads/veterancy (§12.3/§12.6), equipment (§12.4), ships and the
 * shipyard (§12.7). Everything here is a value the design leaves open (first guesses for the balance
 * harness).
 */
import { z } from 'zod';
import { CultureIdSchema, SettlementTierIdSchema, SkillIdSchema } from '../ids';

const num = z.number().finite();
const nonNeg = num.min(0);
const prob = num.min(0).max(1);
const count = z.number().int().min(0);
const positive = num.positive();
/** Inclusive [lo, hi] range with lo ≤ hi. */
const range = z.tuple([num, num]).refine(([lo, hi]) => lo <= hi, 'range lo must not exceed hi');
const intRange = z.tuple([count, count]).refine(([lo, hi]) => lo <= hi, 'range lo must not exceed hi');
const signedIntRange = z
  .tuple([z.number().int(), z.number().int()])
  .refine(([lo, hi]) => lo <= hi, 'range lo must not exceed hi');
const camelId = z.string().regex(/^[a-z][A-Za-z0-9]*$/);

const PoolSchema = z
  .object({
    /** Share of the pool maximum a holding starts with when the module first sees it (new game / old save). */
    startShare: prob,
  })
  .strict();

const TransferSchema = z
  .object({
    /** Map-grid cells a transfer covers per day (sea or coastal road; §10.3 "takes travel time"). */
    cellsPerDay: positive,
    minDays: z.number().int().min(1),
    /** Interception chance per day of travel while the realm is at war (§10.3 "risks interception"). */
    interceptPerDay: prob,
    interceptCap: prob,
    /** Multiplier on the interception chance when the realm is at war with nobody. */
    interceptPeaceMult: nonNeg,
    /** Share of the men lost when a transfer is intercepted (killed; home population falls). */
    menLossShare: prob,
    goodsLossShare: prob,
    /** Hull and sail damage (share of the maximum) dealt to each transferred ship. */
    shipDamageShare: prob,
  })
  .strict();

const ArmourySchema = z
  .object({
    /** Iron missing from the capital's market is bought from the treasury at basePerTon × this markup. */
    ironBuyMarkup: positive,
    buyIronByDefault: z.boolean(),
  })
  .strict();

const FieldRepairSchema = z
  .object({
    /** Tons of timber from the fleet's cargo per damaged ship and repair session (§12.7 "needs timber in cargo"). */
    timberPerShip: nonNeg,
    /** Field repair never takes hull or sail above this share of the maximum (the rest needs a shipyard). */
    maxShare: prob,
  })
  .strict();

const WoundedSchema = z
  .object({
    /** Fleet modes in which wounded aboard heal at the home rate (§12.6: 30 days at home, 60 at sea). */
    homeFleetModes: z.array(camelId),
  })
  .strict();

const LieutenantsSchema = z
  .object({
    /** Character role kinds that count as lieutenants (capacity, wages, loyalty drift). */
    roles: z.array(camelId).min(1),
    /** Whether kin serving as lieutenants count against the Hall capacity. */
    countKinInCapacity: z.boolean(),
    /** Flags `<prefix><kingdomId>` set by the holdings module (crowns, §10.8) each add capacity. */
    crownFlagPrefix: z.string().min(1),
    /** Monthly drift toward driftTarget (+ the ruler's `loyalty.lieutenants` modifiers). */
    drift: nonNeg,
    driftTarget: num,
    victory: num,
    victoryMax: num,
    defeat: num,
    defeatMax: num,
    /** Monthly bonus for holding a governorship. */
    governor: num,
    /** Honest lieutenants under a ruler of high / low Honor (§12.5 "alignment of honour"). */
    honestHighHonorAt: num,
    honestHighHonor: num,
    honestLowHonorAt: num,
    honestLowHonor: num,
    /** Ambitious lieutenants without a governorship feel passed over. */
    ambitiousIdle: num,
    /** Monthly desertion chance below balance.loyalty.lieutenantDesertBelow: base + perPoint × shortfall. */
    desertBase: prob,
    desertPerPoint: prob,
    kinDesertMult: nonNeg,
    /** Share of deserters who go over to the Rival house (when there is one). */
    defectChance: prob,
    /** Loyalty a deserter has toward the house they defect to. */
    defectorLoyalty: num,
  })
  .strict();

const SellswordsSchema = z
  .object({
    /** Settlement tiers whose mead-halls always have sellswords (others need a mead-hall building). */
    settlementTiers: z.array(SettlementTierIdSchema),
    /** Offers per mead-hall per month. */
    offers: intRange,
    level: intRange,
    skillPointsBase: count,
    skillPointsPerLevel: count,
    skills: z.array(SkillIdSchema).min(1),
    traitPool: z.array(camelId).min(1),
    traitCount: intRange,
    /** Chance that a sellsword is a foreigner from `foreignCultures` instead of the local culture. */
    foreignChance: prob,
    foreignCultures: z.array(CultureIdSchema).min(1),
    /** Chance that a sellsword is a woman (shield-maidens were rare in the period). */
    femaleChance: prob,
    /** Attribute offset range around balance.character.attributeStart. */
    attributeSpread: signedIntRange,
    /** Backstory ids; each has the locale key `military.backstory.<id>`. */
    backstories: z.array(camelId).min(1),
    /** Relative noise on the level-scaled price (balance.recruit.sellswordCost). */
    priceNoise: prob,
    priceRound: z.number().int().positive(),
    /** Months the hired-offer history is kept (an offer is valid in its own month only). */
    historyMonths: z.number().int().min(1),
  })
  .strict();

const VeteransSchema = z
  .object({
    skillPointsBase: count,
    skillPointsPerLevel: count,
    /** Skills a promoted veteran's points go to, by weight order (first = most). */
    skills: z.array(SkillIdSchema).min(1),
    traitChance: prob,
    traitPool: z.array(camelId).min(1),
    /** A squad with at least this many battles adds +1 to the promoted veteran's level roll. */
    levelBonusBattles: count,
  })
  .strict();

export const schema = z
  .object({
    /** Ships that may wait in one shipyard's queue (building or waiting for a slot). */
    shipQueueMax: z.number().int().positive(),
    /** A fleet within this many map cells of a settlement and in 'docked' mode is in its harbour. */
    dockRadius: nonNeg,
    /** Resolved battle ids remembered so a battle's veterancy is applied once. */
    battlesRemembered: z.number().int().positive(),
    pool: PoolSchema,
    transfer: TransferSchema,
    armoury: ArmourySchema,
    fieldRepair: FieldRepairSchema,
    wounded: WoundedSchema,
    lieutenants: LieutenantsSchema,
    sellswords: SellswordsSchema,
    veterans: VeteransSchema,
    /** Age range of generated sellswords and promoted veterans. */
    lieutenantAge: range,
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
