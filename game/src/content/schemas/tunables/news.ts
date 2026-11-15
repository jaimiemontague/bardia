/**
 * Tunables owned by the 'news' module: src/content/data/tunables/news.json, read in sim code as
 * `ctx.tunables.news`. The news agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31.19 formula values (delay, reach, distortion per hop) stay in
 * balance.json (`intel.news`).
 */
import { z } from 'zod';

const pos = z.number().finite().positive();
const nonNeg = z.number().finite().min(0);
const count = z.number().int().min(0);
const importance = z.number().int().min(1).max(5);
const kindId = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'news kinds are camelCase ids');
const ascending = (list: readonly number[]) => list.every((v, i) => i === 0 || v >= (list[i - 1] as number));

/** One kind of news item (a headline family). Kinds missing from the table are never created by reactions. */
export const NewsKindSchema = z
  .object({
    /** Base importance 1–5 (design §19.3). */
    importance,
    /** Proclaimed news (coronations, sworn pacts): never a rumour. */
    confirmed: z.boolean().optional(),
  })
  .strict();

/** Ascending thresholds: importance = 1 + the number of thresholds reached (max 5). */
const thresholds = z.array(nonNeg).length(4).refine(ascending, 'thresholds must ascend');

export const schema = z
  .object({
    /**
     * The fallback travel network, used when `state.worldIndex` provides no settlement links: each
     * settlement links to its `neighbours` nearest settlements (sea for two coastal ones, else land),
     * plus the shortest bridges that join separate clusters (up to `bridgeMaxDays`).
     */
    network: z
      .object({
        /** Nominal sea speed (matches the sea-lane graph's 120 km/day). */
        seaKmPerDay: pos,
        /** Straight line → coast-hugging route factor. */
        seaDetour: z.number().finite().min(1),
        /** Straight line → track factor (land speed is balance.overland.kmPerDay). */
        landDetour: z.number().finite().min(1),
        neighbours: z.number().int().min(1).max(16),
        /** Links longer than this are dropped (except bridges). */
        maxEdgeDays: pos,
        /** Floor for a link's length. */
        minEdgeDays: nonNeg,
        bridgeMaxDays: pos,
      })
      .strict(),
    /** A copy this many hops (or fewer) from the origin is an eyewitness account, not a rumour. */
    confirmHops: count,
    /** Sources whose word confirms a rumour for the player. */
    reliableVia: z.array(z.enum(['keeper', 'envoy', 'merchant', 'dispatch'])),
    /** Hirdmaster dispatches (§19.3): items reaching the player's holdings. */
    dispatch: z
      .object({
        /** Items below this importance arrive silently (still heard and logged). */
        minImportance: importance,
        /** Notification priority 'normal' from this importance, 'high' from `highImportance`. */
        normalImportance: importance,
        highImportance: importance,
        /** A Hirdmaster narration line from this importance. */
        narrateMinImportance: importance,
        /** Items of this importance (not witnessed by the player) enter the Chronicle when heard. */
        chronicleMinImportance: importance,
      })
      .strict(),
    /** What a mead-hall keeper tells ("Any news?"). */
    keeper: z
      .object({
        maxItems: z.number().int().min(1),
        /** A keeper forgets items older than this. */
        memoryDays: pos,
      })
      .strict(),
    prune: z
      .object({
        /** Items are dropped this many days after the event, by importance 1–5 (once no longer spreading). */
        maxAgeDays: z.tuple([pos, pos, pos, pos, pos]),
        /** Hard cap; the least important, oldest items go first. */
        maxItems: z.number().int().min(10),
      })
      .strict(),
    /** Numeric facts that never drift (years, tiers …). */
    exactFactKeys: z.array(z.string().min(1)),
    /** Items below this importance are not created at all. */
    minImportance: importance,
    kinds: z.record(kindId, NewsKindSchema),
    /** SettlementFate `fate` id → news kind (§16.3). */
    fates: z.record(z.string().min(1), kindId),
    /** Importance bonus of events at a settlement of this tier (fates, captures, revolts). */
    tierImportance: z.record(z.string().min(1), z.number().int().min(-2).max(3)),
    /** Importance of a ruler's death, succession or capture, by faction kind. */
    factionKindImportance: z.record(z.string().min(1), importance),
    /** Importance thresholds on the men killed in a land battle. */
    battleKilled: thresholds,
    /** Importance thresholds on the ships sunk or taken in a sea battle. */
    seaBattleShips: thresholds,
    /** Importance by pact kind (unlisted kinds: the pact kinds' base). */
    pactImportance: z.record(z.string().min(1), importance),
    /** Extra importance when a pact is broken. */
    pactBrokenBonus: z.number().int().min(0).max(3),
    /** TitleChanged title keys containing one of these words count as a crowning. */
    crownTitleWords: z.array(z.string().min(1)),
    /** Storm news only when at least this many ships were lost. */
    stormMinShipsLost: z.number().int().min(1),
  })
  .strict()
  .superRefine((t, ctx) => {
    for (const [fate, kind] of Object.entries(t.fates)) {
      if (!Object.hasOwn(t.kinds, kind)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fates', fate], message: `unknown news kind '${kind}'` });
    }
    const d = t.dispatch;
    if (d.normalImportance > d.highImportance) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dispatch'], message: 'normalImportance must not exceed highImportance' });
  });
export type Tunables = z.infer<typeof schema>;
