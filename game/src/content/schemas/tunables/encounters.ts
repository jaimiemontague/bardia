/**
 * Tunables owned by the 'encounters' module: src/content/data/tunables/encounters.json, read in sim code as
 * `ctx.tunables.encounters`. The §31.4 formulas (sight radius, evade, toll acceptance, flee morale cost) stay
 * in balance.json `encounters`; zone traffic comes from the world geography (`seaZones[].traffic`). These are
 * the module's own parameters the design leaves open: how often things are sighted, who they are, how big,
 * and what each answer costs or earns.
 */
import { z } from 'zod';

const num = z.number().finite();
const pos = z.number().finite().min(0);
const share = z.number().finite().min(0).max(1);
const range = z.tuple([pos, pos]).refine(([a, b]) => a <= b, 'range must be [min, max]');
const shareRange = z.tuple([share, share]).refine(([a, b]) => a <= b, 'range must be [min, max]');
const seasons = z.object({ spring: pos, summer: pos, autumn: pos, winter: pos }).strict();
const seaKinds = z.object({ merchant: pos, patrol: pos, raiders: pos, warfleet: pos }).strict();
const landKinds = z.object({ outlaws: pos, landPatrol: pos }).strict();
const allKinds = <T extends z.ZodTypeAny>(t: T) => z.object({ merchant: t, patrol: t, raiders: t, warfleet: t, outlaws: t, landPatrol: t }).strict();

/** Who the other party is and what they carry (one row per encounter kind). */
const KindSchema = z
  .object({
    /** Ship types they sail in (sea kinds), weighted equally. */
    ships: z.array(z.string().min(1)),
    /** At least this many hulls (a war-fleet is never a lone ship). */
    minShips: z.number().int().min(0),
    /** Their fighting men as a share of ours (min/max), never fewer than `minMen` nor more than `maxMen`. */
    menShare: range,
    minMen: z.number().int().min(1),
    maxMen: z.number().int().min(1),
    /** Unit mix (shares, normalised). */
    units: z.record(z.string().min(1), pos),
    /** Armour and weapon tiers when they serve no lord (outlaws) or are virtual crews. */
    tier: z.number().int().min(1).max(5),
    morale: z.number().int().min(0).max(100),
    seafaring: z.number().int().min(0).max(10),
    wildcraft: z.number().int().min(0).max(10),
    /** Their speed relative to their slowest ship's best speed (laden merchants are slow). */
    speedMult: pos,
    /** Silver they carry (min/max). */
    silver: range,
    /** Trade goods aboard: how many kinds and tons of each. */
    goods: z.array(z.string().min(1)),
    goodsKinds: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    goodsTons: range,
    /** Multiplier on the toll they ask (payToll) for this kind. */
    tollMult: pos,
  })
  .strict();

export const schema = z
  .object({
    /** No encounters in the first days of a voyage (the home waters are watched). */
    graceDays: z.number().int().min(0),
    /** Minimum days between two encounters of the same expedition. */
    minDaysBetween: z.number().int().min(0),
    /** Cap on the daily chance. */
    maxPerDay: share,
    sea: z
      .object({
        /** Zone traffic (geography, 0.02–0.06) × this = the base daily sighting chance. */
        trafficMult: pos,
        /** Traffic of a zone the geography does not list (rivers, lakes, tests). */
        defaultTraffic: pos,
        seasonMult: seasons,
        /** Fog: surprise sightings (§8.6 hidden encounters). */
        fogMult: pos,
        /** + share of hostile shores within `shoreRadius` cells × this. */
        hostileShoreSlope: pos,
        shoreRadius: pos,
        /** Opinion at or below which a lord counts as hostile even without war. */
        hostileOpinion: num,
        /** Bigger fleets are seen from further off: × (1 + perExtraShip × (ships − 1)), capped. */
        sizePerExtraShip: pos,
        sizeMultMax: pos,
        /** Faster fleets are past before trouble gathers: × clamp(refKn / ourKn, min, max). */
        refKn: pos,
        speedMult: range,
        /** What is sighted in a zone the geography does not list (its `encounterMix` otherwise, §31.4). */
        defaultMix: seaKinds,
        /** × by season. */
        seasonKindMult: z.object({ spring: seaKinds, summer: seaKinds, autumn: seaKinds, winter: seaKinds }).strict(),
        /** Patrols and war fleets × (1 + this × hostile share). */
        hostileKindSlope: seaKinds,
      })
      .strict(),
    land: z
      .object({
        /** Daily chance for a land party on the march. */
        basePerDay: share,
        /** × when the party is not marching (camped ashore). */
        idleMult: pos,
        /** × in the player's own lands. */
        ownLandMult: pos,
        /** × in a hostile lord's land. */
        hostileMult: pos,
        seasonMult: seasons,
        kindWeights: landKinds,
        /** Settlements within this many cells decide whose land it is. */
        landRadius: pos,
      })
      .strict(),
    /** Real AI fleets within sight (§8.6 visible encounters). */
    realFleets: z
      .object({
        /** Chance a fleet in sight comes to an encounter (else it keeps its distance). */
        chance: share,
        cooldownDays: z.number().int().min(0),
        /** Fleet intent → what it is met as. */
        kindByIntent: z.record(z.string().min(1), z.enum(['merchant', 'patrol', 'raiders', 'warfleet'])),
      })
      .strict(),
    kinds: allKinds(KindSchema),
    /** Hail (§15.1): news, a rumour, a little goodwill. */
    hail: z
      .object({
        newsItems: z.number().int().min(1),
        newsPerSpeechcraft: pos,
        rumourBase: share,
        rumourPerSpeechcraft: share,
        opinion: num,
      })
      .strict(),
    /** A merchant's small deal. */
    trade: z
      .object({
        maxTons: pos,
        /** Sell price = basePerTon × (sellBase + sellPerSpeechcraft × skill). */
        sellBase: pos,
        sellPerSpeechcraft: pos,
        /** Rations offered (min/max) and the price per ration × (buyBase − buyPerSpeechcraft × skill). */
        rationsOffered: range,
        buyBase: pos,
        buyPerSpeechcraft: pos,
        minRations: z.number().int().min(1),
        opinion: num,
      })
      .strict(),
    /** Paying a toll: (base + perMan × our men) × kind tollMult × (1 − discount × speechcraft). */
    payToll: z
      .object({
        base: pos,
        perMan: pos,
        speechcraftDiscount: share,
        /** Short of silver, provisions make up the rest (at most this many days of food). */
        maxRationDays: pos,
        /** Patrols' lords like being paid. */
        opinion: num,
        /** Paying off sea-raiders or outlaws costs Renown. */
        cowedRenown: num,
      })
      .strict(),
    /** Demanding a toll (§31.4). Success: their share; failure: merchants run, others fight. */
    demandToll: z
      .object({
        /** P(accept) when the score is ≥ 0 at zero noise: rises linearly over ±balance noise. */
        dread: num,
        opinion: num,
        /** Honor lost shaking down people who meant no harm. */
        honor: num,
        /** Cargo value counted per ton (× basePerTon). */
        valueMult: pos,
      })
      .strict(),
    /** Attacking (sea battle or land battle). */
    attack: z
      .object({
        /** Standing when we strike people who meant no harm. */
        unprovokedOpinion: num,
        unprovokedHonor: num,
        /** On victory. */
        renown: allKinds(num),
        dread: allKinds(num),
        /** Share of a virtual party's silver and goods taken on victory. */
        plunderShare: share,
        /** Sea-battle arena by zone exposure (geography: openOcean, coastal). */
        seaArena: z.record(z.string().min(1), z.string().min(1)),
      })
      .strict(),
    /** Evade / slip away failures that cost only time. */
    lostDay: z
      .object({
        morale: num,
        stamina: num,
        /** Days of food eaten while beating about. */
        rationDays: pos,
      })
      .strict(),
    /** Land slip-away: clamp(base + wildcraftSlope × (ours − theirs) − sizeSlope × max(0, our men − sizeFree), min, max). */
    slipAway: z
      .object({
        base: share,
        wildcraftSlope: share,
        sizeSlope: share,
        sizeFree: pos,
        min: share,
        max: share,
      })
      .strict(),
    /** Flee: always possible; they catch us when faster and hostile. */
    flee: z
      .object({
        catchBase: share,
        catchSlope: pos,
        catchMax: share,
        stamina: num,
      })
      .strict(),
    /** Caught at sea: what yielding costs. */
    caught: z
      .object({
        silverShare: shareRange,
        cargoShare: shareRange,
        /** With nothing else aboard they take food (days, at most `maxRationShare` of it). */
        rationDays: pos,
        maxRationShare: share,
        renown: num,
      })
      .strict(),
    /** Ambushed ashore: what falling back costs. */
    fallBack: z
      .object({
        lossShare: shareRange,
        /** Share of those losses that are wounded rather than dead. */
        woundedShare: share,
        woundChance: share,
      })
      .strict(),
    /** XP for the companion whose skill carried an evasion or a hard bargain. */
    skillXp: z.number().int().min(0),
    /** Number of text variants per kind (locale keys `encounters.sighted.<kind>.<n>`, n = 1..count). */
    textVariants: allKinds(z.number().int().min(1)),
    caughtVariants: z.number().int().min(1),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
