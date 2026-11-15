/**
 * zod schemas of the holdings commands (validated by dispatch, ARCHITECTURE §5). Deterministic: no
 * transforms. The rules (holding, tiers, slots, silver, counts) are checked by the handlers through
 * the pure previews in rules.ts, which return clear issue codes.
 */
import { TAX_RATE_IDS } from '@content/schemas/ids';
import type { CommandSchemas } from '@sim/core/module';
import { z } from 'zod';

const settlementId = z.string().regex(/^set_.+$/, 'must be a set_ id');
const camelId = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'ids are camelCase');

/** Command schemas of the holdings module. */
export const HOLDINGS_COMMAND_SCHEMAS: CommandSchemas = {
  setTax: z.object({ type: z.literal('setTax'), holdingId: settlementId, tax: z.enum(TAX_RATE_IDS) }).strict(),
  queueBuilding: z.object({ type: z.literal('queueBuilding'), holdingId: settlementId, buildingId: camelId }).strict(),
  setGarrison: z
    .object({
      type: z.literal('setGarrison'),
      holdingId: settlementId,
      units: z.record(camelId, z.number().int().min(0)),
    })
    .strict(),
};
