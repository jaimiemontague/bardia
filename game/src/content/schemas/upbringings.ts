/** Schema for data/upbringings.json (design §5.1 steps 4 and 7). */
import { z } from 'zod';
import { SkillIdSchema } from './ids';

export const UPBRINGING_IDS = [
  'shieldBorn',
  'bowyersChild',
  'hirdRaised',
  'fisherFolk',
  'woodsRunner',
  'thingSpeakersChild',
  'stewardsWard',
  'seerTouched',
] as const;
export type UpbringingId = (typeof UPBRINGING_IDS)[number];

export const UpbringingDefSchema = z
  .object({
    name: z.string(),
    /** Gets +balance.character.upbringingSkillBonus. */
    skill: SkillIdSchema,
    /** The optional starting trait this upbringing unlocks (step 4). */
    startingTrait: z.string(),
    /** The 6 positive traits offered at step 7 (traits with creation 'positive'). */
    traitOptions: z.array(z.string()).length(6),
  })
  .strict();
export type UpbringingDef = z.infer<typeof UpbringingDefSchema>;

const shape = Object.fromEntries(UPBRINGING_IDS.map((id) => [id, UpbringingDefSchema])) as { [K in UpbringingId]: typeof UpbringingDefSchema };
export const UpbringingsSchema = z
  .object({ $notes: z.array(z.string()).optional(), ...shape })
  .strict()
  .transform(({ $notes: _notes, ...rest }) => rest as { [K in UpbringingId]: UpbringingDef });
export type Upbringings = z.output<typeof UpbringingsSchema>;
