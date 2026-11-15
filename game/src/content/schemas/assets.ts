/**
 * Asset-manifest entries (design §27.3: id, path, size, anchor and frames for every asset; §28.5
 * audio and voice). `path` is where the owner's FINAL file is dropped (relative to public/assets/);
 * `placeholder` is the recipe the client uses to generate a stand-in while that file is absent.
 */
import { z } from 'zod';

const finite = z.number().finite();
const positive = z.number().finite().positive();
const relPath = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_\-/]*\.[a-z0-9]+$/, 'path must be a relative lower-case path with an extension (e.g. portraits/ruler.png)');

/** Procedural placeholder recipe: a generator id known to the client plus its parameters. */
export const PlaceholderRecipeSchema = z
  .object({
    generator: z.string().min(1),
    params: z.record(z.string(), z.union([z.string(), finite, z.boolean()])).optional(),
    /** Text drawn on (or spoken by) the placeholder so it is clearly labelled. */
    label: z.string().optional(),
  })
  .strict();

const ImageAssetSchema = z
  .object({
    kind: z.literal('image'),
    path: relPath,
    size: z.tuple([positive, positive]),
    /** Pivot in [0,1]² (default centre). */
    anchor: z.tuple([finite, finite]).optional(),
    /** Animation frames laid out horizontally (default 1). */
    frames: z.number().int().positive().optional(),
    placeholder: PlaceholderRecipeSchema,
  })
  .strict();

const AudioAssetSchema = z
  .object({
    kind: z.enum(['music', 'sfx']),
    path: relPath,
    durationS: positive.optional(),
    loop: z.boolean().optional(),
    placeholder: PlaceholderRecipeSchema,
  })
  .strict();

/** A voice-over line: the localisation key it speaks and the narrator voice (§26.2). */
const VoiceAssetSchema = z
  .object({
    kind: z.literal('voice'),
    path: relPath,
    lineKey: z.string().min(1),
    voice: z.string().min(1),
    placeholder: PlaceholderRecipeSchema,
  })
  .strict();

export const AssetEntrySchema = z.discriminatedUnion('kind', [ImageAssetSchema, AudioAssetSchema, VoiceAssetSchema]);
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

/** One manifest fragment: asset id → entry. */
export const AssetManifestFragmentSchema = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/), AssetEntrySchema);
export type AssetManifestFragment = z.infer<typeof AssetManifestFragmentSchema>;
