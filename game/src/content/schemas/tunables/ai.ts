/**
 * Tunables owned by the 'ai' module: src/content/data/tunables/ai.json, read in sim code as
 * `ctx.tunables.ai`. The ai agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase).
 */
import { z } from 'zod';

export const schema = z.object({}).strict();
export type Tunables = z.infer<typeof schema>;
