/**
 * zod schemas for the sea-battle commands and effect ops (validated by the kernel before the
 * handler runs; effect schemas also validate content packs at load time).
 */
import { CultureIdSchema, OMEN_IDS, ShipTypeIdSchema } from '@content/schemas/ids';
import { z } from 'zod';

const finite = z.number().finite();
const nonNeg = z.number().finite().min(0);
const share = z.number().finite().min(0).max(1);
const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const windStr = z.enum(['calm', 'light', 'fresh', 'strong', 'gale']);
const sideKey = z.enum(['attacker', 'defender']);
const fate = z.enum(['fine', 'wounded', 'captured', 'dead']);

export const SeaSideRefSchema = z
  .object({
    fleetId: prefixed('flt').optional(),
    factionId: prefixed('fac').optional(),
    ships: z
      .array(
        z
          .object({
            type: ShipTypeIdSchema,
            crew: z.number().int().min(0).optional(),
            hullHp: nonNeg.optional(),
            sailHp: nonNeg.optional(),
            shipId: prefixed('shp').optional(),
          })
          .strict(),
      )
      .optional(),
    men: z.record(z.string().min(1), z.number().int().min(0)).optional(),
    captainId: prefixed('chr').optional(),
    role: z.enum(['warfleet', 'raider', 'patrol', 'merchant']).optional(),
    morale: z.number().finite().min(0).max(100).optional(),
    pitchT: nonNeg.optional(),
    culture: CultureIdSchema.optional(),
  })
  .strict()
  .refine((s) => s.fleetId !== undefined || (s.factionId !== undefined && (s.ships?.length ?? 0) > 0), 'a side needs fleetId, or factionId with ships');

const battleShape = {
  attacker: SeaSideRefSchema,
  defender: SeaSideRefSchema,
  origin: z.string().min(1),
  arena: z.string().regex(/^[a-z][A-Za-z0-9]*$/).optional(),
  coastBearing: finite.optional(),
  wind: z.object({ dir: finite, str: windStr }).strict().optional(),
  zoneId: z.string().min(1).optional(),
  omen: z.enum(OMEN_IDS).optional(),
};

export const StartSeaBattleEffectSchema = z
  .object({ op: z.literal('startSeaBattle'), ...battleShape, mode: z.enum(['ask', 'auto']).optional() })
  .strict();

export const AutoResolveSeaBattleEffectSchema = z.object({ op: z.literal('autoResolveSeaBattle'), ...battleShape }).strict();

export const StartSeaBattleCommandSchema = z
  .object({
    type: z.literal('startSeaBattle'),
    seaBattleId: prefixed('sea'),
    mode: z.enum(['fight', 'auto']),
    deck: z
      .array(z.object({ shipId: prefixed('shp'), archers: z.number().int().min(0), boarders: z.number().int().min(0) }).strict())
      .optional(),
    deckShares: z.object({ archers: share, boarders: share }).strict().optional(),
    fireArrows: z.boolean().optional(),
  })
  .strict();

const DuelResultSchema = z
  .object({
    winnerId: prefixed('chr'),
    loserFate: z.enum(['spared', 'yielded', 'killed', 'captured']),
    injuries: z.array(z.object({ charId: prefixed('chr'), injury: z.string().min(1) }).strict()),
    renown: finite,
    autoResolved: z.boolean(),
  })
  .passthrough();

const ShipOutcomeSchema = z
  .object({
    shipId: prefixed('shp'),
    side: sideKey,
    status: z.enum(['active', 'struck', 'captured', 'sunk', 'burned', 'fled']),
    hullHp: nonNeg,
    sailHp: nonNeg,
    crew: nonNeg,
    capturedBy: sideKey.optional(),
  })
  .strict();

export const SeaBattleResultSchema = z
  .object({
    winner: z.enum(['attacker', 'defender', 'none']),
    retreated: z.boolean(),
    shipsSunk: z.array(prefixed('shp')),
    shipsCaptured: z.array(prefixed('shp')),
    crewLost: z.array(z.object({ side: sideKey, killed: nonNeg, wounded: nonNeg, captured: nonNeg }).strict()),
    captainDuel: DuelResultSchema.optional(),
    durationS: nonNeg,
    xp: z.record(prefixed('chr'), nonNeg),
    autoResolved: z.boolean(),
    shipsBurned: z.array(prefixed('shp')).optional(),
    shipsFled: z.array(prefixed('shp')).optional(),
    capturedBy: z.record(prefixed('shp'), sideKey).optional(),
    ships: z.array(ShipOutcomeSchema).optional(),
    captainFates: z.record(prefixed('chr'), fate).optional(),
    playerFate: fate.optional(),
    pitchUsedT: z.object({ attacker: nonNeg, defender: nonNeg }).strict().optional(),
    surrendered: z.boolean().optional(),
    playerTransferredTo: prefixed('shp').optional(),
    crewCaptives: z.object({ attacker: nonNeg, defender: nonNeg }).strict().optional(),
  })
  .strict();

export const ApplySeaBattleResultCommandSchema = z
  .object({ type: z.literal('applySeaBattleResult'), seaBattleId: prefixed('sea'), result: SeaBattleResultSchema })
  .strict();
