/**
 * zod schemas for the battle module's effect op and commands (validated by the kernel before the
 * handlers run; content packs validate `startBattle` effects at load time with validateEffects).
 */
import { GoodIdSchema, OMEN_IDS } from '@content/schemas/ids';
import { z } from 'zod';

const finite = z.number().finite();
const nonNeg = z.number().finite().min(0);
const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const unitId = z.string().regex(/^[a-z][A-Za-z0-9]*$/);
const formation = z.enum(['line', 'shieldWall', 'wedge', 'loose']);
const stance = z.enum(['hold', 'engage', 'skirmish']);
const sideKey = z.enum(['attacker', 'defender']);
const approach = z.enum(['night', 'dawn', 'challenge']);
const tier = z.number().int().min(0).max(4);

const SourceSchema = z
  .object({ kind: z.enum(['fleet', 'army', 'settlement', 'explicit']), id: z.string().min(1).optional(), men: nonNeg })
  .strict();

/** A squad given explicitly (guardians, storylet forces). */
export const SquadSchema = z
  .object({
    leaderId: prefixed('chr'),
    unit: unitId,
    men: z.number().int().min(1),
    vetStars: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    formation,
    sources: z.array(SourceSchema).optional(),
    unnamed: z.boolean().optional(),
    stance: stance.optional(),
  })
  .strict();

const SideRefSchema = z
  .object({
    factionId: prefixed('fac').optional(),
    fleetId: prefixed('flt').optional(),
    armyId: prefixed('arm').optional(),
    settlementId: prefixed('set').optional(),
    characterIds: z.array(prefixed('chr')).optional(),
    chiefId: prefixed('chr').optional(),
    squads: z.array(SquadSchema).optional(),
    moraleMods: finite.optional(),
    isPlayer: z.boolean().optional(),
    hasRam: z.boolean().optional(),
    hasPitch: z.boolean().optional(),
    ladders: z.boolean().optional(),
    culture: z.string().min(1).optional(),
    armourTier: z.number().int().min(1).max(6).optional(),
    weaponTier: z.number().int().min(1).max(6).optional(),
  })
  .strict();

const LootPoolSchema = z.object({ silver: nonNeg, goods: z.record(GoodIdSchema, nonNeg) }).strict();

export const StartBattleEffectSchema = z
  .object({
    op: z.literal('startBattle'),
    kind: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    attacker: SideRefSchema,
    defender: SideRefSchema,
    settlementId: prefixed('set').optional(),
    siteId: prefixed('site').optional(),
    approach: approach.optional(),
    timerS: z.number().finite().positive().optional(),
    origin: z.string().min(1),
    mapTemplate: z.string().min(1).optional(),
    omen: z.enum(OMEN_IDS).optional(),
    weather: z.object({ windDir: finite.optional(), windStr: nonNeg.optional(), rain: z.boolean().optional(), night: z.boolean().optional() }).strict().optional(),
    loot: LootPoolSchema.optional(),
    fortTier: tier.optional(),
    coastal: z.boolean().optional(),
  })
  .strict();

const PlannedSquadSchema = z
  .object({
    leaderId: prefixed('chr'),
    unit: unitId,
    men: z.number().int().min(1),
    formation: formation.optional(),
    stance: stance.optional(),
  })
  .strict();

export const StartBattleCommandSchema = z
  .object({
    type: z.literal('startBattle'),
    battleId: prefixed('bat'),
    mode: z.enum(['fight', 'auto']),
    approach: approach.optional(),
    squads: z.array(PlannedSquadSchema).optional(),
  })
  .strict();

const CasualtySchema = z
  .object({ side: sideKey, leaderId: prefixed('chr'), killed: z.number().int().min(0), wounded: z.number().int().min(0), captured: z.number().int().min(0) })
  .strict();
const SquadLossSchema = z
  .object({
    side: sideKey,
    unit: unitId,
    source: z.object({ kind: z.enum(['fleet', 'army', 'settlement', 'explicit']), id: z.string().min(1).optional() }).strict(),
    killed: z.number().int().min(0),
    wounded: z.number().int().min(0),
    captured: z.number().int().min(0),
  })
  .strict();
const fate = z.enum(['fine', 'wounded', 'seriouslyWounded', 'mortallyWounded', 'captured', 'dead']);

/** A BattleResult as the client hands it back (unknown keys are stripped). */
export const BattleResultSchema = z.object({
  winner: z.enum(['attacker', 'defender', 'none']),
  retreated: z.boolean(),
  casualties: z.array(CasualtySchema),
  chief: z.object({ killed: z.boolean(), captured: z.boolean() }).strict(),
  playerFate: z.enum(['fine', 'wounded', 'captured', 'dead']).optional(),
  lootValue: nonNeg,
  lootGoods: z.record(GoodIdSchema, nonNeg),
  buildingsBurned: z.number().int().min(0),
  durationS: nonNeg,
  xp: z.record(prefixed('chr'), nonNeg),
  autoResolved: z.boolean(),
  squadLosses: z.array(SquadLossSchema).optional(),
  leaderFates: z.record(prefixed('chr'), fate).optional(),
  surrendered: z.boolean().optional(),
  lootSilver: nonNeg.optional(),
  lootBurnedShare: z.number().finite().min(0).max(1).optional(),
  pitchUsedT: z.object({ attacker: nonNeg, defender: nonNeg }).strict().optional(),
  duels: z
    .array(
      z
        .object({ challengerId: prefixed('chr'), chiefId: prefixed('chr'), winnerId: prefixed('chr'), loserFate: z.enum(['spared', 'yielded', 'killed', 'captured']) })
        .strict(),
    )
    .optional(),
});

export const ApplyBattleResultCommandSchema = z
  .object({
    type: z.literal('applyBattleResult'),
    battleId: prefixed('bat'),
    result: BattleResultSchema,
  })
  .strict();

/** `autoResolveBattle` (same parameters as startBattle). */
export const AutoResolveBattleEffectSchema = StartBattleEffectSchema.extend({ op: z.literal('autoResolveBattle') });
