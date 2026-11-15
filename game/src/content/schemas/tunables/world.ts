/**
 * Tunables owned by the 'world' module: src/content/data/tunables/world.json, read in sim code as
 * `ctx.tunables.world`. The world agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase); the values here are world generation, politics, knowledge and movement parameters that
 * the design does not fix (first guesses for the balance harness unless a § is cited).
 */
import { z } from 'zod';

const num = z.number().finite();
const nonNeg = z.number().finite().min(0);
const prob = z.number().finite().min(0).max(1);
const intRange = z.tuple([z.number().int(), z.number().int()]).refine(([lo, hi]) => lo <= hi, 'range: lo must be <= hi');
const numRange = z.tuple([num, num]).refine(([lo, hi]) => lo <= hi, 'range: lo must be <= hi');
const id = z.string().min(1);
const weights = z.record(z.string().min(1), nonNeg);

const TIERS = ['hamlet', 'village', 'town', 'city', 'capital', 'cloister', 'fortress', 'emporium', 'templeStead'] as const;
const tierRecord = <T extends z.ZodTypeAny>(v: T) => z.object(Object.fromEntries(TIERS.map((t) => [t, v])) as Record<(typeof TIERS)[number], T>).strict();
const ECONOMIES = ['ruined', 'destitute', 'poor', 'fair', 'thriving'] as const;
const economyWeights = z.object(Object.fromEntries(ECONOMIES.map((e) => [e, nonNeg])) as Record<(typeof ECONOMIES)[number], typeof nonNeg>).strict();
const AXES = ['aggression', 'greed', 'honor', 'caution', 'ambition', 'piety'] as const;
const personality = z.object(Object.fromEntries(AXES.map((a) => [a, z.number().finite().min(0).max(100)])) as Record<(typeof AXES)[number], z.ZodNumber>).strict();
const personalityDelta = z.object(Object.fromEntries(AXES.map((a) => [a, num.optional()])) as Record<(typeof AXES)[number], z.ZodOptional<z.ZodNumber>>).strict();
const SKILLS = ['melee', 'archery', 'command', 'seafaring', 'wildcraft', 'speechcraft', 'stewardship', 'runecraft'] as const;
const skillRanges = z.object(Object.fromEntries(SKILLS.map((s) => [s, intRange])) as Record<(typeof SKILLS)[number], typeof intRange>).strict();
const skillDeltas = z.object(Object.fromEntries(SKILLS.map((s) => [s, z.number().int().optional()])) as Record<(typeof SKILLS)[number], z.ZodOptional<z.ZodNumber>>).strict();

/** How one region's (or one realm's) politics are generated (§17.1). */
const PoliticsRule = z
  .object({
    /** Faction kind of the realm's ruler (holds the seat province). */
    seatKind: id,
    /** The realm's ruler holds every province of the realm directly (petty kingdoms, Corvani realms, Saraleon). */
    holdAll: z.boolean(),
    /** Faction kind of the other provinces of the realm when `holdAll` is false (jarls, clans, cities). */
    memberKind: id,
    /** Chance a member province's ruler is sworn to the realm's ruler as a vassal. */
    swornChance: prob,
    /** Faction kind for colonized provinces that belong to no realm (Rimewild posts, Isafold settlers). */
    unclaimedKind: id,
    /** Rulers of the region's realms are siblings (the Varenne heirs, §4.2). */
    siblingRulers: z.boolean(),
    /** Ruler age range (years) for this region's realm rulers. */
    rulerAge: intRange,
  })
  .strict();

/** A starting conflict: `count` pairs of factions of the given region (or across two regions). */
const ConflictRule = z
  .object({
    regionId: id,
    /** Second region (cross-region hostility, e.g. Velkar cities and the Kurgai), default: the same region. */
    otherRegionId: id.optional(),
    count: z.number().int().min(0),
    /** Faction kind required of the first / second side (e.g. the Kurgai khanate against Velkar cities). */
    kindA: id.optional(),
    kindB: id.optional(),
    /** 'war' sets stance war; 'feud' only adds the feud modifier. */
    kind: z.enum(['war', 'feud']),
    /** Only pairs whose provinces share a border (or a sea zone, when no land border exists). */
    neighboursOnly: z.boolean(),
  })
  .strict();

/** A charted area at the start (§8.2). */
const StartChart = z
  .object({
    /** Province ids (geography) whose land and nearby sea are charted. */
    provinces: z.array(id),
    /** Only sea cells of these sea zones are charted (default: any zone). */
    zones: z.array(id).optional(),
    /** Chart only the coastal land strip of those provinces (cells from the sea) instead of all their land. */
    coastOnly: z.boolean(),
    /** Coastal land strip width (cells) when coastOnly. */
    landBuffer: nonNeg,
    /** Sea charted within this many cells of the charted land. */
    seaBuffer: nonNeg,
  })
  .strict();

export const schema = z
  .object({
    worldgen: z
      .object({
        /**
         * Colonized provinces with no settlements in the geography pack get their capital (name from the
         * province, at its anchor) so a campaign can start while the region packs are being filled.
         */
        synthesizeMissingCapitals: z.boolean(),
        /** Tier of a synthesized capital: royal seats vs other provinces. */
        synthesizedSeatTier: z.enum(TIERS),
        synthesizedTier: z.enum(TIERS),
        /** Population draw inside a tier's range: lo + (hi − lo) × u^skew (1 = uniform, > 1 favours small). */
        popSkew: z.number().finite().positive(),
        /** Per-culture population ranges overriding balance.settlementTiers[tier].pop. */
        popByCulture: z.record(id, z.record(id, intRange)),
        /** Province capitals that are not royal seats: population is scaled into the upper part of the range. */
        provinceCapitalPopBoost: nonNeg,
        /** Economy state weights (§9.4: mostly poor/fair, some thriving), with per-culture overrides. */
        economy: economyWeights,
        economyByCulture: z.record(id, economyWeights),
        /** Royal-seat capitals never start below this economy state. */
        seatMinEconomy: z.enum(ECONOMIES),
        /** Garrison unit weights per culture (unit ids from balance.units). */
        garrisonMix: z.record(id, weights),
        /** Garrison unit weights per tier that replace the culture mix (cloister guards). */
        garrisonMixByTier: z.record(id, weights),
        /** Royal seats' garrisons are this many times the tier ratio. */
        seatGarrisonMult: nonNeg,
        /** Base fortification tier range per settlement tier (§9.3), before culture modifiers. */
        fortByTier: tierRecord(intRange),
        /** Albric burh walls (`fort.townTierDelta`) apply to these tiers. */
        burhTiers: z.array(z.enum(TIERS)),
        /** Chance a city/capital of a culture with `fort.oldStoneWalls` keeps old imperial stone walls (tier 4). */
        stoneWallChance: z.record(id, prob),
        stoneWallTiers: z.array(z.enum(TIERS)),
        /** The capital of an empire (the Golden City) always has stone walls when its culture has them. */
        empireSeatStoneWalls: z.boolean(),
        /** Starting buildings per tier (buildings ids from balance.buildings); walls follow the fort tier. */
        buildingsByTier: tierRecord(z.record(id, z.number().int().min(0))),
        /** Buildings that need a harbour (coastal or river port). */
        harbourBuildings: z.array(id),
        /** Buildings only Old Ways settlements have. */
        oldWaysBuildings: z.array(id),
        /** Realm equipment tiers per culture: [armour, weapon] (§12.4). */
        equipmentByCulture: z.record(id, intRange),
        equipmentDefault: intRange,
        /** Settlement armour/weapon tier bonus over its realm's by tier. */
        equipmentTierBonus: z.record(id, z.number().int()),
        /** Faction treasury: months of its holdings' tax income. */
        treasuryMonths: numRange,
        /** Ruler character generation. */
        ruler: z
          .object({
            femaleChance: prob,
            attributes: intRange,
            skills: skillRanges,
            /** Culture skill emphasis added to the ranges (seafaring for the northern cultures …). */
            cultureSkills: z.record(id, skillDeltas),
            /** Level from age: 1 + floor((age − 16) / yearsPerLevel) ± 1, clamped. */
            yearsPerLevel: z.number().finite().positive(),
            maxLevel: z.number().int().min(1),
            personalityTraits: intRange,
            giftChance: prob,
            flawChance: prob,
          })
          .strict(),
        /** Settlement leader generation (leaders not drawn from a ruling family). */
        leader: z
          .object({
            femaleChance: prob,
            attributes: intRange,
            skills: skillRanges,
            yearsPerLevel: z.number().finite().positive(),
            maxLevel: z.number().int().min(1),
            personalityTraits: intRange,
          })
          .strict(),
        /** Families of AI rulers (§17.1, §23). */
        family: z
          .object({
            spouseChance: prob,
            spouseAgeGap: intRange,
            minMarriageAge: z.number().int().min(16),
            /** Chance the ruler's spouse comes from another faction's ruling family (a kinship tie). */
            foreignSpouseChance: prob,
            /** Maximum children; ages spread over the mother's years [childbearingAge]. */
            maxChildren: z.number().int().min(0),
            childbearingAge: intRange,
            childGapYears: intRange,
            /** Chance per possible child that it was born (and lived). */
            childChance: prob,
            /** Sibling count weights (index = number of siblings). */
            siblingWeights: z.array(nonNeg).min(1),
            siblingAgeGap: z.number().int().min(1),
            /** Parent's age at the ruler's birth. */
            parentAgeAtBirth: intRange,
            /** A parent older than this is dead; younger parents die with `parentDeathChance`. */
            parentMaxAge: z.number().int().min(30),
            parentDeathChance: prob,
            /** Adult kin govern the faction's other settlements before generated leaders are used. */
            kinGovernors: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    /** AI personalities (§18.2): culture template + normal noise (balance.ai.personalityNoise) + trait shifts. */
    personality: z
      .object({
        templates: z.record(id, personality),
        defaultTemplate: personality,
        traitShifts: z.record(id, personalityDelta),
      })
      .strict(),
    politics: z
      .object({
        defaultRule: PoliticsRule,
        /** Per region id. */
        regions: z.record(id, PoliticsRule.partial()),
        /** Per realm (geography kingdom id), over the region's rule. */
        kingdoms: z.record(id, PoliticsRule.partial()),
        /** Neutral regions' settlements (Thingey) are held by a neutral faction of this kind. */
        neutralKind: id,
      })
      .strict(),
    /** Starting relations (§17.2; magnitudes from balance.diplomacy.opinionModifiers where it has them). */
    relations: z
      .object({
        /** Shared border (land, or a sea zone between provinces of the same region). */
        border: num,
        /** Liege and sworn vassal. */
        fealty: num,
        /** Rivals of one region (the feuding Varenne heirs, rival petty kings). */
        regionalRivalry: num,
        /** Old Ways vs Lantern rites. */
        faithDifference: num,
        /** Random temperament per relation: uniform in ±this. */
        noise: nonNeg,
        feud: num,
        feudDecayPerMonth: nonNeg,
        /** Regions whose realms' rulers are rivals of each other. */
        rivalryRegions: z.array(id),
        conflicts: z.array(ConflictRule),
        /** Relations are created for pairs within this many provinces' reach (borders) plus every pair involving the player. */
        relatePlayerWithAll: z.boolean(),
      })
      .strict(),
    player: z
      .object({
        /** Default start: prefer provinces whose capital has a harbour. */
        preferHarbour: z.boolean(),
        /** Garrisons of the player's other settlements, as a share of the generated garrison. */
        secondaryGarrisonMult: nonNeg,
        /** Colour index of the player's banner. */
        colorIndex: z.number().int().min(0),
      })
      .strict(),
    /** The Rival (§17.8). */
    rival: z
      .object({
        /** Traits the Rival is drawn from (unknown trait ids are skipped). */
        traits: z.array(id).min(1),
        traitCount: intRange,
        personality: personalityDelta,
        /** "Raised a ring-fort on your border": the Rival's settlement nearest the player gets at least this fort tier. */
        borderFortTier: z.number().int().min(0).max(4),
        /** Rival must be a ruler at least this old. */
        minAge: z.number().int().min(16),
      })
      .strict(),
    knowledge: z
      .object({
        /** Homeland provinces are charted whole with this much sea around them. */
        homelandSeaBuffer: nonNeg,
        /** Further start charts (the Albrenn east coast from the parent's sea-chart, §8.2). */
        startCharts: z.array(StartChart),
        /** `start.chartVelkar` (Hvarn): river mouths of these regions are charted with this radius. */
        riverMouthRegions: z.array(id),
        riverMouthRadius: nonNeg,
        /** revealSettlement default radius (cells). */
        settlementRadius: nonNeg,
        /** Sight radius of player land parties: overland.sightBase + sightPerWildcraft × Wildcraft (leagues = cells). */
        minSightCells: nonNeg,
        /** A sea zone counts as fully charted at this share of its cells (§8.9). */
        zoneCompleteShare: prob,
      })
      .strict(),
    index: z
      .object({
        /** Lanes kept per settlement: reachable within this many days (sea or land). */
        laneHorizonDays: z.number().finite().positive(),
        maxLanesPerSettlement: z.number().int().min(1),
        /** Port search radius (cells) for settlements without a geography port. */
        portSearchRadius: z.number().int().min(1),
        /** Provinces of one region sharing a sea zone with centroids within this many cells count as neighbours (islands). */
        seaNeighbourCells: nonNeg,
        /** distanceDays fallback (no lane): straight-line km × detour ÷ km/day. */
        fallbackDetour: z.number().finite().min(1),
        fallbackKmPerDay: z.number().finite().positive(),
      })
      .strict(),
    movement: z
      .object({
        /** Hour of day (0–23) the sailing day starts; fleets near a coast beach for the other 24 − beachHours hours (§8.3). */
        dayStartHour: z.number().int().min(0).max(23),
        /** A fleet within this many cells of land beaches at night ("near a coast"); farther out it sails on. */
        beachMaxCoastCells: nonNeg,
        /** Portage with fewer than overland.portageMenPerShip men per ship takes this many times longer. */
        portageUndermannedMult: z.number().finite().min(1),
        /** Armies march these hours per day, starting at marchStartHour. */
        marchStartHour: z.number().int().min(0).max(23),
        marchHours: z.number().int().min(1).max(24),
        /** Ships whose draught pays the shoal penalty (§8.3). */
        shoalPenaltyShips: z.array(id),
        shoalPenalty: z.number().finite().min(1),
        /** Storm avoidance: cells within storm radius + pad are blocked when routing with avoidStorms. */
        stormPadCells: nonNeg,
        /** Snap radius (cells) for route ends that are not on navigable water/land. */
        snapRadius: z.number().int().min(1),
        /** Waypoint smoothing look-ahead (cells). */
        smoothLookahead: z.number().int().min(2),
        /** Days a portage takes when the geography gives a range: lo + (hi − lo) × this. */
        portageRangeShare: prob,
        /** Weight of the wind in route costs: 0 = distance only, 1 = full expected-speed costs. */
        windRouteWeight: prob,
      })
      .strict(),
    /** The player steering the expedition (or a war-band ashore) directly, and landfall by touch. */
    steering: z
      .object({
        /** The expedition fleet within this many cells of a harbour (or a port-less coastal settlement) touches it. */
        touchRadius: z.number().finite().min(0.5).max(6),
        /** A steered war-band within this many cells of a settlement (or of its ships) touches it. */
        armyTouchRadius: z.number().finite().min(0.5).max(6),
        /** Steering moves in sub-steps of at most this many cells (coast checks, sliding). */
        subStepCells: z.number().finite().min(0.1).max(1),
        /** A steered mover keeps a one-point route this many cells ahead (other modules read "under way"). */
        aheadCells: z.number().finite().min(0.25).max(4),
        /** A steered war-band marches at any hour (the player decides when to halt); else only in the march window. */
        armyMarchesAnyHour: z.boolean(),
        /** Navigable rivers stop a steered war-band (it slides along the bank) except where a road crosses them. */
        riversStopWarbands: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
