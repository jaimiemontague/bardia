/** Small zod helpers shared by the content schemas. */
import { z } from 'zod';

/** Any finite number. */
export const num = z.number().finite();
/** A finite number ≥ 0. */
export const nonNeg = z.number().finite().min(0);
/** A probability in [0, 1]. */
export const prob = z.number().finite().min(0).max(1);
/** An integer. */
export const int = z.number().int();
/** A non-negative integer. */
export const count = z.number().int().min(0);

/** `[lo, hi]` with lo ≤ hi. */
export const range = z
  .tuple([num, num])
  .refine(([lo, hi]) => lo <= hi, { message: 'range: lo must be <= hi' });

/**
 * A strict object with exactly the given keys, each validated by `value`.
 * Infers `{ [K in keys]: z.infer<value> }`.
 */
export function enumMap<const K extends readonly [string, ...string[]], V extends z.ZodTypeAny>(
  keys: K,
  value: V,
) {
  const shape = {} as { [P in K[number]]: V };
  for (const k of keys) (shape as Record<string, V>)[k] = value;
  return z.object(shape).strict();
}

/** Modifier bag used by traits, feats, culture bonuses: dotted key → number (see ARCHITECTURE.md). */
export const ModifiersSchema = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/), num);
export type Modifiers = z.infer<typeof ModifiersSchema>;
