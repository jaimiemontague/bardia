/** Schema for data/feats.json (design §22.8, §32.7 Saga Feats). */
import { z } from 'zod';
import { ModifiersSchema } from './common';

export const FeatDefSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    modifiers: ModifiersSchema,
    flags: z.array(z.string()),
  })
  .strict();
export type FeatDef = z.infer<typeof FeatDefSchema>;

export const FeatsSchema = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), FeatDefSchema);
export type Feats = z.infer<typeof FeatsSchema>;
