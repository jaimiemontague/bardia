/**
 * Schema for data/gods.json (design §4.4). Owner decision: gods exist only as the characters'
 * belief. Favor is a morale-and-luck abstraction; no god ever acts in the world.
 */
import { z } from 'zod';
import { enumMap } from './common';
import { GOD_IDS } from './ids';

export const GodDefSchema = z
  .object({
    name: z.string(),
    epithet: z.string(),
    domains: z.array(z.string()).min(1),
    /** Deed keys that raise this god's Favor with the player's house. */
    favorRises: z.array(z.string()),
    /** Abstract effect tags the faith module maps to modifiers (morale, luck, prestige). */
    favorEffects: z.array(z.string()),
    /** Omen activities this god is consulted for (§22.6). */
    omenActivities: z.array(z.enum(['voyage', 'battle', 'duel', 'harvest'])),
    description: z.string(),
  })
  .strict();
export type GodDef = z.infer<typeof GodDefSchema>;

export const GodsSchema = enumMap(GOD_IDS, GodDefSchema);
export type Gods = z.infer<typeof GodsSchema>;
