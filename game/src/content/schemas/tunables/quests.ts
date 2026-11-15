/**
 * Tunables owned by the 'quests' module: src/content/data/tunables/quests.json, read in sim code as
 * `ctx.tunables.quests`. The quests agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase).
 */
import { z } from 'zod';

export const schema = z.object({}).strict();
export type Tunables = z.infer<typeof schema>;
