/**
 * Tunables owned by the 'holdings' module: src/content/data/tunables/holdings.json, read in sim code as
 * `ctx.tunables.holdings`. The holdings agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): building costs, days, upkeep and effects (§10.4), tax multipliers (§31.1), the loyalty
 * deltas (§31.7) and the build-slot rule (§10.3).
 *
 * Values here are not in the design (first guesses for the balance harness):
 *   founding   cost and days of a first tier the design prices "—" (Hall I, Smithy I, Shipyard I,
 *              Mead-hall I, Seer's Hut), for holdings that lack the building (the capital starts with them);
 *   harbourBuildings  buildings only a coastal or river-port holding can raise;
 *   chronicle  importance of a completed building in the Chronicle;
 *   garrison.penaltyShareOfRecommended  the §31.7 low-garrison term applies only when the men at home
 *              (garrison, the house's docked fleets, wounded healing there) fall below this share of the
 *              §10.3 recommended 5 % of the people; between the two the screen only warns (a fresh start
 *              keeps about 50 to 85 % of the recommended men at home);
 *   loyalty.residence  monthly loyalty at the holding where the ruler holds court (it offsets the drift
 *              toward 50 at a fresh start; the counterpart of the design's absence term).
 */
import { z } from 'zod';

const count = z.number().int().min(0);
const FoundingSchema = z.object({ cost: count, days: z.number().int().min(1) }).strict();

export const schema = z
  .object({
    founding: z.record(z.string(), FoundingSchema),
    harbourBuildings: z.array(z.string()),
    chronicle: z.object({ importance: count, topTierImportance: count }).strict(),
    garrison: z.object({ penaltyShareOfRecommended: z.number().min(0).max(1) }).strict(),
    loyalty: z.object({ residence: z.number().finite() }).strict(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
