/**
 * zod schemas for the military module's commands and effect ops (validated by dispatch / applyEffect
 * and by `validateEffects` when content packs load). Deterministic: no transforms that depend on
 * anything but the input.
 */
import { FormationIdSchema, GoodIdSchema, ShipTypeIdSchema } from '@content/schemas/ids';
import type { CommandSchemas, EffectSchemas } from '@sim/core/module';
import { z } from 'zod';

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const settlementId = prefixed('set');
const fleetId = prefixed('flt');
const armyId = prefixed('arm');
const shipId = prefixed('shp');
const charId = prefixed('chr');
const factionId = prefixed('fac');
const unitId = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'unit ids are camelCase');
const finite = z.number().finite();
const menCount = z.number().int().min(0);
const men = z.record(unitId, menCount);
const pos = z.object({ x: finite, y: finite }).strict();

const containerShape = {
  settlementId: settlementId.optional(),
  fleetId: fleetId.optional(),
  armyId: armyId.optional(),
  pool: z.boolean().optional(),
};
const ContainerRefSchema = z.object(containerShape).strict();

const cmd = <K extends string>(type: K, shape: z.ZodRawShape) => z.object({ type: z.literal(type), ...shape }).strict();
const op = <K extends string>(name: K, shape: z.ZodRawShape) => z.object({ op: z.literal(name), ...shape }).strict();

/** Command schemas. */
export const MILITARY_COMMAND_SCHEMAS: CommandSchemas = {
  muster: cmd('muster', { holdingId: settlementId, units: men, fleetId: fleetId.optional() }),
  queueShip: cmd('queueShip', {
    holdingId: settlementId,
    shipType: ShipTypeIdSchema,
    name: z.string().max(60).optional(),
    buyTimber: z.boolean().optional(),
  }),
  repairShip: cmd('repairShip', { shipIds: z.array(shipId).min(1).max(64) }),
  upgradeArmoury: cmd('upgradeArmoury', {
    track: z.enum(['armour', 'weapons']),
    holdingId: settlementId.optional(),
    buyIron: z.boolean().optional(),
  }),
  transfer: cmd('transfer', {
    fromId: settlementId,
    toId: settlementId,
    men: men.optional(),
    shipIds: z.array(shipId).max(64).optional(),
    goods: z.record(GoodIdSchema, finite.min(0)).optional(),
  }),
  promoteLieutenant: cmd('promoteLieutenant', {
    unit: unitId,
    settlementId: settlementId.optional(),
    fleetId: fleetId.optional(),
    armyId: armyId.optional(),
  }),
  hireSellsword: cmd('hireSellsword', { settlementId, offer: z.number().int().min(0) }),
};

/** Effect schemas. */
export const MILITARY_EFFECT_SCHEMAS: EffectSchemas = {
  addMen: op('addMen', { ...containerShape, unit: unitId, count: z.number().int(), battles: finite.min(0).optional(), wounded: z.boolean().optional() }),
  killMen: op('killMen', {
    ...containerShape,
    unit: unitId,
    count: menCount,
    wounded: menCount.optional(),
    captured: menCount.optional(),
    homeId: settlementId.optional(),
    popLoss: z.boolean().optional(),
  }),
  moveMen: op('moveMen', { from: ContainerRefSchema, to: ContainerRefSchema, men, wounded: z.boolean().optional() }),
  spawnArmy: op('spawnArmy', {
    ownerId: factionId.optional(),
    leaderId: charId.optional(),
    settlementId: settlementId.optional(),
    pos: pos.optional(),
    homeId: settlementId.optional(),
    squads: z
      .array(
        z
          .object({
            unit: unitId,
            men: z.number().int().positive(),
            leaderId: charId.optional(),
            vetStars: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
            formation: FormationIdSchema.optional(),
          })
          .strict(),
      )
      .min(1),
    tag: z.string().min(1).optional(),
  }),
  disbandArmy: op('disbandArmy', { armyId, to: ContainerRefSchema.optional() }),
  damageShip: op('damageShip', { shipId, hull: finite.optional(), sail: finite.optional(), cause: z.string().min(1).optional() }),
  sinkShip: op('sinkShip', { shipId, cause: z.string().min(1).optional() }),
  captureShip: op('captureShip', {
    shipId,
    factionId: factionId.optional(),
    fleetId: fleetId.optional(),
    settlementId: settlementId.optional(),
  }),
  addShip: op('addShip', {
    shipType: ShipTypeIdSchema,
    factionId: factionId.optional(),
    settlementId: settlementId.optional(),
    fleetId: fleetId.optional(),
    name: z.string().min(1).max(60).optional(),
  }),
};
