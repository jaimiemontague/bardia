/** Schema for data/titles.json (design §22.2 level titles with Honor/Dread variants). */
import { z } from 'zod';

export const TitleConditionSchema = z
  .object({
    stat: z.enum(['honor', 'dread', 'honorMinusDread', 'renown']),
    op: z.enum(['gte', 'gt', 'lte', 'lt']),
    value: z.number().finite(),
  })
  .strict();
export type TitleCondition = z.infer<typeof TitleConditionSchema>;

export const TitleDefSchema = z
  .object({
    level: z.number().int().min(1),
    /** English default; localization keys are `title.<level>` / `title.<level>.<variant index>`. */
    title: z.string(),
    /** First matching variant wins; otherwise `title`. */
    variants: z.array(z.object({ when: TitleConditionSchema, title: z.string() }).strict()),
  })
  .strict();
export type TitleDef = z.infer<typeof TitleDefSchema>;

export const TitlesSchema = z
  .array(TitleDefSchema)
  .min(1)
  .refine((t) => t.every((d, i) => d.level === i + 1), { message: 'titles must be listed for levels 1..N in order' });
export type Titles = z.infer<typeof TitlesSchema>;
