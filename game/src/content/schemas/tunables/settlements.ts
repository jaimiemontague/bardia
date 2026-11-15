/**
 * Tunables owned by the 'settlements' module: src/content/data/tunables/settlements.json, read in sim code as
 * `ctx.tunables.settlements`. The aftermath numbers are the design's §16.3 table; raids, the cargo screen and the
 * mead-hall costs are §16.1, §16.2 and §20.2. Values the design leaves open are first guesses.
 */
import { z } from 'zod';

const num = z.number().finite();
const nonNeg = num.min(0);
const share = num.min(0).max(1);
const range = z.tuple([num, num]).refine(([a, b]) => a <= b, 'lo <= hi');

const FateSchema = z
  .object({
    renown: num,
    dread: num,
    honor: num,
    /** Extra Honor change when the settlement shares the player's culture (sacking your own kind). */
    honorSameCulture: num,
    ownerOpinion: num,
    neighbourOpinion: num,
    kinOpinion: num,
    /** Economy: set outright, or move by steps. */
    economy: z.enum(['ruined', 'destitute', 'poor', 'fair', 'thriving']).optional(),
    economySteps: z.number().int(),
    popLoss: range,
    devastationYears: range,
    /** Share of the settlement's silver and goods the fleet takes (hidden hoards, an offering, a tribute lump). */
    lootShare: range,
    /** The fleet may plunder the market afterwards (the Cargo screen). */
    cargo: z.boolean(),
  })
  .strict();

export const schema = z
  .object({
    fates: z
      .object({
        sackAndBurn: FateSchema,
        plunderAndLeave: FateSchema,
        spare: FateSchema,
        takeCaptives: FateSchema,
        makeTributary: FateSchema,
        annex: FateSchema,
        liberate: FateSchema,
        raid: FateSchema,
      })
      .strict(),
    annex: z
      .object({
        /** Garrison left behind: at least max(minGarrison, popShare × pop) men (§16.3). */
        minGarrison: z.number().int().min(0),
        popShare: share,
        startLoyalty: num,
        /** A governor of another culture or faith (§16.3). */
        foreignGovernorLoyalty: num,
      })
      .strict(),
    /** Hours the party may plunder the market after a won raid or assault (§16.2). */
    lootWindowHours: z.number().int().min(1),
    cargo: z.object({ burnDread: num, givePoorHonor: num, givePoorRenown: num }).strict(),
    tavern: z
      .object({
        drinkCost: nonNeg,
        roundCost: z.record(z.string(), nonNeg),
        roundRenown: range,
        roundLoyaltyAtHome: num,
        travellersFacts: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
        /** §20.2: a drink abroad has this chance to overhear one piece of news the keeper knows. */
        drinkRumourChance: num.min(0).max(1),
      })
      .strict(),
    /** A fleet or army within this many cells of a settlement is at it. */
    presenceRadius: num.positive(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
