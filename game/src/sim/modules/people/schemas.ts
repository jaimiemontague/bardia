/**
 * zod schemas for the people module's commands (client input) and effect ops (content data,
 * validated by `validateEffects` at load time and by `applyEffect` before the handler runs).
 */
import { AttributeIdSchema, SkillIdSchema } from '@content/schemas/ids';
import { isSafeRecordKey } from '@sim/core/keys';
import type { CommandSchemas, EffectSchemas } from '@sim/core/module';
import { z } from 'zod';
import type { AssignableRole } from './types';

/** Every role `assignRole` hands out (a Record, so adding a RoleKinds member without listing it here fails to compile). */
const ASSIGNABLE: Record<AssignableRole, true> = { lieutenant: true, governor: true, envoy: true, captain: true, steward: true, seer: true, npc: true };
/** Roles the player may assign (the ruler and the regent come only from succession). */
export const ASSIGNABLE_ROLES = Object.keys(ASSIGNABLE) as [AssignableRole, ...AssignableRole[]];

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const charId = prefixed('chr');
const factionId = prefixed('fac');
const settlementId = prefixed('set');
const fleetId = prefixed('flt');
const pendingId = prefixed('pnd');
const key = z.string().min(1).refine(isSafeRecordKey, 'must be a non-empty key other than __proto__/constructor/prototype');
const textVars = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]));
const severity = z.enum(['minor', 'serious', 'mortal']);
const op = <K extends string, S extends z.ZodRawShape>(name: K, shape: S) => z.object({ op: z.literal(name), ...shape }).strict();

export const EFFECT_SCHEMAS: EffectSchemas = {
  woundCharacter: op('woundCharacter', {
    charId: charId.optional(),
    severity: severity.optional(),
    wound: z.enum(['none', 'minor', 'serious', 'mortal']).optional(),
    injury: key.optional(),
    rollInjury: z.boolean().optional(),
    cause: z.string().min(1).optional(),
  }).refine((e) => e.severity !== undefined || e.wound !== undefined || e.injury !== undefined || e.rollInjury === true, {
    message: 'woundCharacter needs a severity (or wound), an injury or rollInjury',
  }),
  addTrait: op('addTrait', { charId: charId.optional(), trait: key, source: z.string().min(1).optional() }),
  removeTrait: op('removeTrait', { charId: charId.optional(), trait: key }),
  marry: op('marry', { charId: charId.optional(), spouseId: charId }),
  birth: op('birth', {
    motherId: charId.optional(),
    fatherId: charId.optional(),
    sex: z.enum(['male', 'female']).optional(),
    name: z.string().min(1).optional(),
    twins: z.boolean().optional(),
  }),
  kill: op('kill', { charId: charId.optional(), cause: z.string().min(1), killerId: charId.optional(), byFactionId: factionId.optional() }),
  capture: op('capture', {
    charId: charId.optional(),
    byFactionId: factionId.optional(),
    captorFactionId: factionId.optional(),
    at: settlementId.optional(),
    ransom: z.number().finite().min(0).optional(),
    cause: z.string().min(1).optional(),
    hostage: z.boolean().optional(),
  }).refine((e) => e.byFactionId !== undefined || e.captorFactionId !== undefined, { message: 'capture needs byFactionId' }),
  giveItem: op('giveItem', { charId: charId.optional(), itemId: key, fromCharId: charId.optional() }),
  grantXp: op('grantXp', { charId: charId.optional(), amount: z.number().finite().positive(), source: z.string().min(1).optional() }),
  releaseCharacter: op('releaseCharacter', { charId, reason: z.string().min(1).optional(), to: settlementId.optional() }),
  grantDeedName: op('grantDeedName', { charId: charId.optional(), key: z.string().min(1), vars: textVars.optional() }),
};

const points = z.number().int().min(0);

export const COMMAND_SCHEMAS: CommandSchemas = {
  assignRole: z.object({
    charId,
    role: z.enum(ASSIGNABLE_ROLES),
    holdingId: settlementId.optional(),
    fleetId: fleetId.optional(),
  }),
  heal: z.object({ charId, method: z.enum(['seer', 'church']), healerId: charId.optional() }),
  designateHeir: z.object({
    heirId: charId,
    pendingId: pendingId.optional(),
    regency: z.enum(['play', 'skip']).optional(),
    regentId: charId.optional(),
  }),
  adopt: z.object({ childId: charId }),
  foster: z.object({
    childId: charId,
    mode: z.enum(['tutor', 'lieutenant', 'ally', 'home']),
    focusSkill: SkillIdSchema.optional(),
    lieutenantId: charId.optional(),
    factionId: factionId.optional(),
  }),
  captivityAction: z.object({ pendingId, choice: z.enum(['wait', 'escape', 'bargain', 'sendWord', 'swearFealty']) }),
  allocatePoints: z.object({
    charId,
    skills: z.record(SkillIdSchema, points).optional(),
    attributes: z.record(AttributeIdSchema, points).optional(),
  }),
  chooseFeat: z.object({ pendingId, featId: key }),
};
