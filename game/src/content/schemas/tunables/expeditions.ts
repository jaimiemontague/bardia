/**
 * Tunables owned by the 'expeditions' module: src/content/data/tunables/expeditions.json, read in sim code as
 * `ctx.tunables.expeditions`. Food, foraging, starvation and fatigue numbers are balance.food (§31.6); these are
 * the module's own parameters the design leaves open.
 */
import { z } from 'zod';

export const schema = z
  .object({
    /** A fleet within this many cells of the home port (and not under sail) can stand down at once. */
    homeRadius: z.number().finite().positive(),
    /** A land party within this many cells of its fleet can board again at once. */
    reboardRadius: z.number().finite().positive(),
    /** Rations a spawned fleet carries per man when the effect does not say. */
    spawnRationDays: z.number().int().min(0),
    /** Fleet modes in which the crews forage and fish (coastal legs beach at night). */
    forageModes: z.array(z.string().min(1)),
    /**
     * A lost expedition (no ship afloat, no crew, no sea road home): the survivors come home at once, the cargo,
     * silver and rations aboard are lost.
     */
    lost: z
      .object({
        /** Share of the men still aboard when the last ship is lost who reach home (those the storm or battle killed are already gone). */
        survivorShare: z.number().min(0).max(1),
        /** Share of the men who were ashore, or who abandon ships that cannot sail, who walk home. */
        overlandSurvivorShare: z.number().min(0).max(1),
        /** Chance that each returning leader comes home wounded (people's woundCharacter). */
        leaderWoundChance: z.number().min(0).max(1),
        /** How badly ('none': never). Never mortal: a lost voyage must not start a succession of its own. */
        leaderWound: z.enum(['none', 'minor', 'serious']),
        /** Other harbours of the house tried, nearest first, when the capital cannot be reached by sea (not ice). */
        fallbackHarbours: z.number().int().min(0).max(20),
      })
      .strict(),
    /**
     * A land expedition (the march): no ships; the men carry the food, the trade goods and the plunder on their
     * backs and stand down when they walk back into the hall.
     */
    march: z
      .object({
        /** The most food each man carries from home, in days of his own rations. */
        foodDaysPerMan: z.number().int().min(1).max(120),
        /** Tons each man carries: food (at economy.rationsPerTon), trade goods and plunder together. */
        carryTonsPerMan: z.number().finite().positive().max(1),
        /** Other holdings of the house tried, nearest first, when the capital cannot be reached on foot. */
        fallbackHoldings: z.number().int().min(0).max(20),
      })
      .strict(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
