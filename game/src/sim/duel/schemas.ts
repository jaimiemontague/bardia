/**
 * zod schemas for the duel module's effect op and commands (validated by `applyEffect`,
 * `validateEffects` at content load, and `dispatch`).
 */
import { DuelWeaponIdSchema } from '@content/schemas/ids';
import { z } from 'zod';
import { DUEL_ARENAS, DUEL_CHOICES, DUEL_END_REASONS, DUEL_MODES, DUEL_ORIGINS, DUEL_STAKES } from './types';

const charId = z.string().regex(/^chr_.+$/, 'must be a chr_ id');
const tier = z.number().int().min(1).max(6);
const pct = z.number().finite().min(0).max(100);

const DuelistRefSchema = z.union([
  z.literal('player'),
  charId,
  z
    .object({
      charId: z.union([z.literal('player'), charId]),
      weapon: DuelWeaponIdSchema.optional(),
      armourTier: tier.optional(),
      weaponTier: tier.optional(),
      ratingBonus: z.number().finite().optional(),
      damagePct: z.number().finite().optional(),
    })
    .strict(),
]);

/** `startDuel` effect parameters (StartDuelEffect). */
export const StartDuelEffectSchema = z
  .object({
    op: z.literal('startDuel'),
    a: DuelistRefSchema,
    b: DuelistRefSchema,
    stakes: z.enum(DUEL_STAKES),
    arena: z.enum(DUEL_ARENAS),
    origin: z.enum(DUEL_ORIGINS),
    ref: z.string().min(1).optional(),
    declinable: z.boolean().optional(),
  })
  .strict();

/** `startDuel` command (StartDuelCommand). */
export const StartDuelCommandSchema = z
  .object({
    type: z.literal('startDuel'),
    duelId: z.string().regex(/^duel_.+$/, 'must be a duel_ id'),
    mode: z.enum([...DUEL_MODES, 'decline']),
    weapon: DuelWeaponIdSchema.optional(),
    onWin: z.enum(DUEL_CHOICES).optional(),
  })
  .strict();

const FIGHT_REASONS = DUEL_END_REASONS.filter((r): r is Exclude<(typeof DUEL_END_REASONS)[number], 'auto'> => r !== 'auto');

/** `applyDuelResult` command (ApplyDuelResultCommand). */
export const ApplyDuelResultCommandSchema = z
  .object({
    type: z.literal('applyDuelResult'),
    duelId: z.string().regex(/^duel_.+$/, 'must be a duel_ id'),
    outcome: z
      .object({
        winner: z.enum(['a', 'b']),
        reason: z.enum(FIGHT_REASONS as [Exclude<(typeof DUEL_END_REASONS)[number], 'auto'>, ...Exclude<(typeof DUEL_END_REASONS)[number], 'auto'>[]]),
        durationS: z.number().finite().min(0).max(3600),
        hpPct: z.object({ a: pct, b: pct }).strict(),
        tauntsLanded: z.object({ a: z.number().int().min(0).max(1000), b: z.number().int().min(0).max(1000) }).strict(),
        exchanges: z.number().int().min(0).max(10000).optional(),
      })
      .strict(),
    choice: z.enum(DUEL_CHOICES).optional(),
  })
  .strict();
