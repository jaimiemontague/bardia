/** Schema for data/names.json: bynames and ship-name parts (design §32.4). */
import { z } from 'zod';

export const NamesSchema = z
  .object({
    /** NPC bynames ("the Stout", "Crow-Eye" …), at least 60. */
    bynames: z.array(z.string()).min(60),
    ships: z
      .object({
        /** First element: adjectives/elements ("Sea", "Storm", "Iron"). */
        firsts: z.array(z.string()).min(4),
        /** Second element: animals/nouns ("Wolf", "Mare", "Wing"). */
        seconds: z.array(z.string()).min(4),
        /** Patterns: {first}, {second}, {home}. */
        patterns: z.array(z.string()).min(1),
        /** Chance to append " of {home}" when a home settlement is known. */
        ofHomeChance: z.number().min(0).max(1),
      })
      .strict(),
  })
  .strict();
export type NamesData = z.infer<typeof NamesSchema>;
