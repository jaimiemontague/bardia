/** Schema for data/traits.json (design §5.4, §32.6). Effects are modifier bags (see ARCHITECTURE.md). */
import { z } from 'zod';
import { ModifiersSchema } from './common';

export const TRAIT_KINDS = ['personality', 'gift', 'flaw', 'injury', 'education'] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];

export const TraitDefSchema = z
  .object({
    name: z.string(),
    kind: z.enum(TRAIT_KINDS),
    /** Mutually exclusive partner (Brave/Craven …). */
    opposite: z.string().optional(),
    /** Passed to children with balance.character.traitInheritChance. */
    inheritable: z.boolean(),
    /** Can be picked at character creation (§5.1 step 7). */
    creation: z.enum(['positive', 'negative', 'none']),
    modifiers: ModifiersSchema,
    flags: z.array(z.string()),
    description: z.string(),
  })
  .strict();
export type TraitDef = z.infer<typeof TraitDefSchema>;

export const TraitsSchema = z
  .record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), TraitDefSchema)
  .superRefine((traits, ctx) => {
    for (const [id, t] of Object.entries(traits)) {
      if (t.opposite !== undefined) {
        const o = traits[t.opposite];
        if (!o) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `trait ${id}: unknown opposite ${t.opposite}` });
        else if (o.opposite !== id)
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `trait ${id}: opposite ${t.opposite} does not point back` });
      }
    }
  });
export type Traits = z.infer<typeof TraitsSchema>;
