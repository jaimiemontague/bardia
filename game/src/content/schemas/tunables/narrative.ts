/**
 * Tunables owned by the 'narrative' module: src/content/data/tunables/narrative.json, read in sim code as
 * `ctx.tunables.narrative`. The narrative agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase). All values here are first guesses for the balance harness (design §19.1, §10.3, §26.3).
 */
import { z } from 'zod';

const prob = z.number().finite().min(0).max(1);
const count = z.number().int().min(0);

/** A per-scope monthly budget: the chance that the scope gets storylets this month, and how many at most. */
const MonthlyBudgetSchema = z
  .object({
    /** Probability per month that this scope kind fires anything at all. */
    chance: prob,
    /** Maximum storylets of this scope kind per month (different storylets; 0 disables the scope). */
    max: count,
  })
  .strict();

export const schema = z
  .object({
    /** Weight of a storylet that does not set one. */
    defaultWeight: z.number().finite().positive(),
    /** Cooldown (days) applied when a storylet sets no `cooldownDays` (0 = none). */
    defaultCooldownDays: count,
    /** Monthly trigger budgets per storylet scope kind (player, holding, settlement, faction, character, fleet). */
    monthly: z.record(z.string(), MonthlyBudgetSchema),
    /** Chance that an eligible firing of an event trigger produces a storylet, per trigger. */
    triggerChance: z.record(z.string(), prob),
    /** Chance for triggers not listed in `triggerChance`. */
    triggerChanceDefault: prob,
    /** Maximum depth of follow-up chains resolved in one go (guards delegated loops). */
    maxFollowUpChain: z.number().int().min(1),
    /** Storylets waiting in the Affairs of State inbox at most; the oldest is settled by the steward beyond it. */
    maxInbox: count,
    /** Delegable storylets with an expiry wait in the inbox instead of stopping time while the ruler is away from home. */
    inboxWhenAbroad: z.boolean(),
    /** Chronicle importance of a storylet outcome when the storylet sets none. */
    chronicleImportance: z.number().finite().min(0),
    /** What daysSince() returns for something that never happened. */
    neverDays: z.number().int().positive(),
    /** Depth to which an event payload is copied into a storylet instance (for `event.*` paths). */
    eventSnapshotDepth: z.number().int().min(1).max(4),
    /** Line pools (§26.3): weights decay after use, w / (1 + useWeightDecay × uses). */
    lines: z
      .object({
        useWeightDecay: z.number().finite().min(0),
      })
      .strict(),
    /** Skaldic verse composition (§19.4, §23.6, §26.3). */
    verse: z
      .object({
        /** Deed lines per verse. */
        maxDeeds: z.object({ yearEnd: z.number().int().min(1), epitaph: z.number().int().min(1) }).strict(),
        /** Diversity caps: deed lines of one kind per verse (§23.6: at most 2 battles, 1 marriage). */
        maxPerKind: z.record(z.string(), z.number().int().min(1)),
        /** Cap for kinds not listed in `maxPerKind`. */
        defaultMaxPerKind: z.number().int().min(1),
        /** Weight multiplier for kennings whose stave alliterates with the line's stave word. */
        staveBonus: z.number().finite().min(1),
        /** Composed verses kept in state (the oldest is dropped first). */
        maxStored: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
