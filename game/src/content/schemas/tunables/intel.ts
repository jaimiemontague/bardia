/**
 * Tunables owned by the 'intel' module: src/content/data/tunables/intel.json, read in sim code as
 * `ctx.tunables.intel`. The §31.19 confidence formula and labels stay in balance.json (`intel`); these
 * are the source table of §20.4 and the module's bookkeeping parameters.
 */
import { z } from 'zod';

const prob = z.number().finite().min(0).max(1);
const FACT_KEYS = ['garrison', 'fortTier', 'armour', 'weapons', 'silver', 'economy', 'leader', 'wars', 'relicRumor', 'fleets'] as const;

export const schema = z
  .object({
    /** Reliability per source (§20.4: server 0.75, keeper 0.6, drunk 0.4, merchant 0.8, envoy 0.85, scout/Raven-Quill 1). */
    sources: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), prob),
    /** Reliability of a source missing from the table. */
    defaultReliability: prob,
    /** Reports kept per fact kind and observer (newest first). */
    maxReportsPerFact: z.number().int().min(1),
    /** Reports older than this many days are pruned (monthly). */
    pruneDays: z.number().finite().positive(),
    /** Two reports conflict when both are at least this confident and they disagree. */
    conflictMinConfidence: prob,
    /** Numbers count as disagreeing when their displayed ranges do not overlap. */
    noise: z
      .object({
        /** observeSettlement: a reported number is off by up to ±(1 − reliability) × scale of its true value. */
        scale: z.number().finite().min(0).max(1),
        /** Below this reliability, a reported economy state may be one step off. */
        economySlipBelow: prob,
      })
      .strict(),
    /** Fact kinds each source can report in observeSettlement (default: all). */
    sourceKeys: z.record(z.string(), z.array(z.enum(FACT_KEYS))),
    /** What the player's fleet sees on arriving at a settlement's harbour (a 'sighting'). */
    arrivalKeys: z.array(z.enum(FACT_KEYS)),
    /** Map prices (§20.5: 20–80 s): a buyMap price outside the range is rejected. */
    mapPrice: z.tuple([z.number().int().min(0), z.number().int().min(0)]).refine(([a, b]) => a <= b, 'lo <= hi'),
    /** buyMap needs the ruler or the expedition at the settlement. */
    mapNeedsPresence: z.boolean(),
    /** A fleet or army within this many cells of a settlement counts as being there. */
    presenceRadius: z.number().finite().min(0),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
