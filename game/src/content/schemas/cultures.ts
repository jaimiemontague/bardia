/** Schema for data/cultures.json (design §4.3 + §32.4 naming tables). */
import { z } from 'zod';
import { ModifiersSchema } from './common';
import { CULTURE_IDS, DuelWeaponIdSchema, FaithIdSchema } from './ids';
import { enumMap } from './common';

const syllables = z.array(z.string()).min(1);

/** Per-culture name generation tables. Endings are stored WITHOUT the leading '-'; '' is allowed. */
export const NamingSchema = z
  .object({
    starts: syllables,
    maleEndings: z.array(z.string()).min(1),
    femaleEndings: z.array(z.string()).min(1),
    /** Roots for place names (personal starts are also used). */
    placeRoots: syllables,
    /** Place name = root + suffix … */
    placeSuffixes: z.array(z.string()),
    /** … or prefix + root (Cael style: 'Dun ' + 'Brac'). Include a trailing space for two-word names. */
    placePrefixes: z.array(z.string()),
    /** Hand-authored examples (also used directly by the generator for variety). */
    examples: z.object({ male: z.array(z.string()), female: z.array(z.string()) }).strict(),
  })
  .strict()
  .refine((n) => n.placeSuffixes.length + n.placePrefixes.length > 0, {
    message: 'naming needs placeSuffixes or placePrefixes',
  });
export type Naming = z.infer<typeof NamingSchema>;

export const CultureBonusSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    modifiers: ModifiersSchema,
  })
  .strict();

export const CultureDefSchema = z
  .object({
    name: z.string(),
    adjective: z.string(),
    playable: z.boolean(),
    settler: z.boolean(),
    faith: FaithIdSchema,
    region: z.string(),
    portraitGroup: z.enum(['north', 'west', 'south', 'east', 'steppe', 'far']),
    uniqueUnits: z.array(z.string()),
    defaultWeapon: DuelWeaponIdSchema,
    bonuses: z.array(CultureBonusSchema),
    naming: NamingSchema,
  })
  .strict();
export type CultureDef = z.infer<typeof CultureDefSchema>;

export const CulturesSchema = enumMap(CULTURE_IDS, CultureDefSchema);
export type Cultures = z.infer<typeof CulturesSchema>;
