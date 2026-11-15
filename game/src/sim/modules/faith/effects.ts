/**
 * Effect ops the faith module implements (ARCHITECTURE.md §10), for storylets, relics, quests and
 * other modules' consequences:
 *
 *   { "op": "faithDeed", "deed": "missionarySentAway" }       a deed rule (tunables.faith.deeds)
 *   { "op": "changeFaithWrath", "amount": -10 }               restitution to a mother-house (§16.4)
 *   { "op": "changePiety", "amount": 5 }
 *   { "op": "buildChapel" }                                   the Missionary "Welcome" choice (§17.7)
 */
import { GodIdSchema } from '@content/schemas/ids';
import { DeedKeySchema } from '@content/schemas/tunables/faith';
import { EffectError } from '@sim/core/effects';
import type { EffectHandlers, EffectSchemas } from '@sim/core/module';
import type { FactionId, SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { addChapel } from './conversion';
import { applyDeed, changePlayerPiety } from './favor';
import { changeFaithWrath } from './wrath';

const finite = z.number().finite();
const op = <K extends string>(name: K, shape: z.ZodRawShape) => z.object({ op: z.literal(name), ...shape }).strict();

export const FAITH_EFFECT_SCHEMAS: EffectSchemas = {
  faithDeed: op('faithDeed', {
    deed: DeedKeySchema,
    factionId: z.string().regex(/^fac_.+$/, 'must be a fac_ id').optional(),
    god: GodIdSchema.optional(),
    scale: finite.min(0).optional(),
  }),
  changeFaithWrath: op('changeFaithWrath', { amount: finite }),
  changePiety: op('changePiety', { amount: finite }),
  buildChapel: op('buildChapel', { settlementId: z.string().regex(/^set_.+$/, 'must be a set_ id').optional() }),
};

export const FAITH_EFFECTS: EffectHandlers = {
  faithDeed(draft, e, ctx) {
    if (!Object.hasOwn(ctx.tunables.faith.deeds, e.deed)) throw new EffectError(`faithDeed: unknown deed '${e.deed}'`);
    const factionId: FactionId = e.factionId ?? draft.player.factionId;
    if (factionId !== draft.player.factionId && !draft.factions[factionId]) throw new EffectError(`faithDeed: unknown faction ${factionId}`);
    const opts: { god?: typeof e.god; scale?: number } = {};
    if (e.god !== undefined) opts.god = e.god;
    if (e.scale !== undefined) opts.scale = e.scale;
    applyDeed(draft, ctx, factionId, e.deed, opts);
  },
  changeFaithWrath(draft, e, ctx) {
    changeFaithWrath(draft, ctx, e.amount);
  },
  changePiety(draft, e, ctx) {
    changePlayerPiety(draft, ctx, e.amount, e.amount > 0);
  },
  buildChapel(draft, e, ctx) {
    const id: SettlementId = e.settlementId ?? draft.player.capitalId;
    const s = draft.settlements[id];
    if (!s) throw new EffectError(`buildChapel: unknown settlement ${id}`);
    if (s.factionId !== draft.player.factionId) throw new EffectError(`buildChapel: ${id} is not the player's`);
    addChapel(draft, ctx, id);
  },
};
