/**
 * Tunables owned by the 'faith' module: src/content/data/tunables/faith.json, read in sim code as
 * `ctx.tunables.faith`. The faith agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): Favor range/neglect/sacrifice range (`standing.favor`), Faith Wrath thresholds and decay
 * (`standing.faithWrath`), the Piety range (`standing.piety`), the omen formula and the §31.12
 * modifier table (`omens`), and the grove's Favor multipliers (`buildings.grove`).
 *
 * Everything here is a value the design leaves open (first guesses for the balance harness).
 * Owner decision ADR-002: Favor, omens and Piety abstract morale, luck and reputation; nothing here
 * models divine action.
 *
 * Omen modifiers for other modules: the §31.12 table is `balance.omens.modifiers[omen]`
 * (moralePct, stormMult, battleMorale); `omens.extraModifiers[activity][omen]` below adds
 * activity-specific dotted modifiers (duel nerve, harvest output). Both are content, readable by any
 * module through `ctx.balance` / `ctx.tunables.faith`.
 */
import { z } from 'zod';
import { count, enumMap, ModifiersSchema, nonNeg, num, prob } from '../common';
import { FaithIdSchema, GodIdSchema, OMEN_IDS, SettlementTierIdSchema } from '../ids';

/** Activities an omen is read for (design §22.6). Balance `omens.activities` names their gods. */
export const OMEN_ACTIVITIES = ['voyage', 'battle', 'duel', 'harvest'] as const;
export type OmenActivity = (typeof OMEN_ACTIVITIES)[number];
export const OmenActivitySchema = z.enum(OMEN_ACTIVITIES);

/** Sizes of a grove offering or of alms. */
export const OFFERING_SIZES = ['modest', 'generous', 'lavish'] as const;
export type OfferingSize = (typeof OFFERING_SIZES)[number];
export const OfferingSizeSchema = z.enum(OFFERING_SIZES);

/** What is offered at the grove (§22.6: "silver or livestock offerings"). */
export const OFFERING_KINDS = ['silver', 'livestock'] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];
export const OfferingKindSchema = z.enum(OFFERING_KINDS);

/** Deeds may take their Favor amount from these `balance.standing.favor` keys (single source). */
export const DEED_BALANCE_KEYS = ['feast', 'relic', 'oathBroken', 'templeSteadRaided'] as const;
export type DeedBalanceKey = (typeof DEED_BALANCE_KEYS)[number];

/** Deed keys are camelCase ids; each needs the locale key `faith.deed.<key>` (tested). */
export const DeedKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/);

/**
 * A deed that moves Favor (Old Ways houses) and/or Piety (Lantern houses). The gods it pleases
 * default to those whose `favorRises` (gods.json) list the deed's key; `gods` overrides that, and a
 * caller may override both with an explicit god (e.g. a relic's god).
 */
export const DeedSchema = z
  .object({
    /** Favor change per god before multipliers (positive gains are scaled by the `favor.gainPct` modifiers). */
    amount: num.optional(),
    /** Take the Favor amount from `balance.standing.favor.<key>` instead of `amount`. */
    balanceKey: z.enum(DEED_BALANCE_KEYS).optional(),
    /** Gods affected: a list, or 'all'. Default: gods whose favorRises name this deed. */
    gods: z.union([z.array(GodIdSchema).min(1), z.literal('all')]).optional(),
    /** Piety change for a house that keeps the Lantern (positive gains scaled by `piety.gainPct`). */
    piety: num.optional(),
    /** At most this many times per calendar month per house (further deeds count for nothing). */
    maxPerMonth: count.optional(),
    /** Tell the player (a low-priority notification with the key `faith.deed.<key>`). Default true. */
    notify: z.boolean().optional(),
  })
  .strict()
  .refine((d) => !(d.amount !== undefined && d.balanceKey !== undefined), { message: 'amount and balanceKey are exclusive' })
  .refine((d) => d.amount !== undefined || d.balanceKey !== undefined || d.piety !== undefined, {
    message: 'a deed needs amount, balanceKey or piety',
  });
export type DeedDef = z.infer<typeof DeedSchema>;

const OfferingSizeDef = z
  .object({
    /** Silver paid for a silver offering. */
    silver: nonNeg,
    /** Tons of the holding's rations (its herds and stores) slaughtered for a livestock offering. */
    livestockTons: nonNeg,
    /** Position in balance `standing.favor.sacrifice` [lo, hi]: 0 → lo, 1 → hi. */
    rangePos: prob,
  })
  .strict();

/** Fate ids (as SettlementFate reports them) grouped by how the Lantern judges them (§16.3). */
const FateKindsSchema = z
  .object({
    /** Sack and Burn: balance `burnCloister` on a Lantern settlement, + `sackCloister` at a cloister. */
    burn: z.array(z.string().min(1)),
    /** Plunder and Leave: `plunderLantern` on a Lantern settlement, + `sackCloister` at a cloister. */
    plunder: z.array(z.string().min(1)),
    /** Take Captives: as plunder, + `clergyCaptives` when the captives are clergy (always at a cloister). */
    captives: z.array(z.string().min(1)),
    /** Annex: `annexLantern` on a Lantern settlement. */
    annex: z.array(z.string().min(1)),
  })
  .strict();

export const schema = z
  .object({
    omens: z
      .object({
        /** Days a reading stays in force, per activity (the seer's cooldown is balance `omens.readCooldownDays`). */
        durationDays: enumMap(OMEN_ACTIVITIES, z.number().int().min(1)),
        /** Silver paid to the seer or priest per reading. */
        readCost: nonNeg,
        /** Lantern signs: `piety / pietyDivisor` replaces `Σ relevantFavor / favorDivisor`. */
        pietyDivisor: z.number().positive(),
        /** "Valgrim: more accurate omens": one extra die (keep the one nearest the mean) per this much Favor. */
        valgrimFavorPerExtraDie: z.number().positive(),
        /** Cap on extra dice from Valgrim's Favor and `omen.accuracy` modifiers. */
        maxExtraDice: count,
        /** A reading is spent by the next activity of its kind (true) or lasts until it expires. */
        consumeOnUse: enumMap(OMEN_ACTIVITIES, z.boolean()),
        /** Old Ways settlement tiers whose hub has a rune-seer even without a Seer's Hut building. */
        seerTiers: z.array(SettlementTierIdSchema),
        /** Lantern settlement tiers that have a church whose priests read signs. */
        churchTiers: z.array(SettlementTierIdSchema),
        /** A docked/beached fleet within this many map cells of a settlement counts as being there. */
        fleetAtSettlementRadius: nonNeg,
        /** Activity-specific modifier bags added to balance `omens.modifiers` (duel nerve, harvest). */
        extraModifiers: enumMap(OMEN_ACTIVITIES, enumMap(OMEN_IDS, ModifiersSchema)),
        /** AI factions re-read their omens at every month start (stored on `faction.omens`). */
        aiMonthlyReadings: z.boolean(),
        /** Omen base for AI factions outside the Old Ways (their priests' signs; neutral = 0). */
        aiBaseline: num,
      })
      .strict(),
    sacrifice: z
      .object({
        sizes: enumMap(OFFERING_SIZES, OfferingSizeDef),
        /** Favor multiplier per offering kind. */
        kindMult: enumMap(OFFERING_KINDS, nonNeg),
        /** Multiplier for the 1st, 2nd, … offering to ONE god in a calendar month (the last entry repeats). */
        diminishing: z.array(prob).min(1),
        /** A temple-stead counts as a grove of at least this tier. */
        templeSteadGroveTier: count,
      })
      .strict(),
    alms: z
      .object({
        sizes: enumMap(OFFERING_SIZES, z.object({ silver: nonNeg, piety: nonNeg }).strict()),
        /** Multiplier for the 1st, 2nd, … alms in a calendar month (the last entry repeats). */
        diminishing: z.array(prob).min(1),
      })
      .strict(),
    favor: z
      .object({
        /** Neglect decay (balance `standing.favor.neglectPerMonth`) skips gods whose Favor rose last month. */
        neglectOnlyIfUntended: z.boolean(),
        /** Scale of the `stormSurvived` deed by storm severity. */
        stormSeverityScale: z.object({ minor: nonNeg, moderate: nonNeg, severe: nonNeg }).strict(),
        /** Death causes after which no proper funeral is possible (no body came home). */
        noFuneralCauses: z.array(z.string().min(1)),
        /** Starting Favor of an Old Ways AI ruler shifts by (personality.piety − 50) / this (rounded). */
        aiPietyDivisor: z.number().positive(),
        ai: z
          .object({
            /** Monthly chance an Old Ways AI ruler makes an offering, at personality piety 100 (scaled linearly). */
            offeringChance: prob,
            offeringSize: OfferingSizeSchema,
            /** The AI only offers when its treasury holds at least this multiple of the cost. */
            minTreasuryMult: nonNeg,
          })
          .strict(),
      })
      .strict(),
    piety: z
      .object({
        /** Piety lost per month in which the house gave no alms and did no pious deed. */
        neglectPerMonth: nonNeg,
        /** Piety a house starts with when it adopts the Lantern. */
        startOnConversion: nonNeg,
      })
      .strict(),
    deeds: z.record(DeedKeySchema, DeedSchema),
    wrath: z
      .object({
        /** Faiths counted as "the Lantern" (cloister wrath, Lantern opinion, churches). */
        lanternFaiths: z.array(FaithIdSchema).min(1),
        /** Plunder and Leave on a Lantern settlement (§16.3; Sack and Burn uses balance `burnCloister`). */
        plunderLantern: num,
        /** Take Captives at a cloister: the captives are clergy (§16.3). */
        clergyCaptives: num,
        /** Annexing a Lantern settlement (§16.3). */
        annexLantern: num,
        /** How SettlementFate fate ids map onto the §16.3 Faith Wrath column. */
        fateKinds: FateKindsSchema,
        /** Apply balance `sermonsOpinion` with every Lantern faction while Faith Wrath ≥ `sermonsAt`. */
        applySermonsOpinion: z.boolean(),
        /** Lantern holy days: raiding a Lantern settlement on one adds balance `holyDayRaid`. */
        holyDays: z.array(z.object({ monthIndex: z.number().int().min(0).max(11), day: z.number().int().min(1).max(30) }).strict()),
      })
      .strict(),
    conversion: z
      .object({
        /** The faith the house adopts (§17.7). */
        targetFaith: FaithIdSchema,
        /** Lantern opinion needed (§17.7: ≥ 20): the mean opinion of the house with every Lantern faction. */
        minLanternOpinion: num,
        /** "Lantern diplomacy +20": opinion with every Lantern faction. */
        lanternDiplomacy: num,
        /** One-time loyalty change of each traditionalist (Old Ways) holding (§17.7: −20). */
        traditionalistLoyalty: num,
        /** Years over which that resentment fades (§17.7: 5); the remainder is kept in state for holdings. */
        resentmentYears: z.number().positive(),
        /** Share of a holding's folk that convert per year (§17.7: 5%). */
        holdingSharePerYear: prob,
        /** Multiplier on that rate where the house has a chapel in the holding. */
        chapelShareMult: nonNeg,
        /** A holding's faith flips once this share has converted. */
        flipShare: prob,
        /** The ruler's spouses and children in the house convert with the ruler. */
        convertKin: z.boolean(),
        /** Silver to found a chapel in a holding once the house keeps the Lantern. */
        chapelCost: nonNeg,
        /** Days after trading with or hosting the Lantern during which the Missionary storylet may fire. */
        contactWindowDays: z.number().int().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.conversion.targetFaith !== undefined && !t.wrath.lanternFaiths.includes(t.conversion.targetFaith)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'conversion.targetFaith must be one of wrath.lanternFaiths' });
    }
  });
export type Tunables = z.infer<typeof schema>;
