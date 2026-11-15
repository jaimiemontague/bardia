/**
 * News effect ops: `addNews` (design §19.1, owned by news) and `hearNews` (module-owned: the player
 * hears what is known at a settlement — the tavern's "Any news?", an envoy's or a merchant's word).
 */
import { EffectError } from '@sim/core/effects';
import type { EffectHandlers, EffectSchemas } from '@sim/core/module';
import type { JsonValue, SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { newsKnownAt } from './query';
import { createNews, hearCopy } from './store';
import type { NewsSpec } from './types';

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const finite = z.number().finite();
/** Any JSON value (facts). */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), finite, z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);
const localeKey = z.string().regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/, 'must be a dotted locale key');

/** zod schemas of the news effect ops. */
export const NEWS_EFFECT_SCHEMAS: EffectSchemas = {
  addNews: z
    .object({
      op: z.literal('addNews'),
      kind: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'news kinds are camelCase ids'),
      originId: prefixed('set').optional(),
      pos: z.object({ x: finite, y: finite }).strict().optional(),
      importance: z.number().int().min(1).max(5).optional(),
      facts: z.record(z.string(), JsonValueSchema).optional(),
      textKey: localeKey.optional(),
      refs: z.array(z.string().min(1)).optional(),
      factionIds: z.array(prefixed('fac')).optional(),
      hour: z.number().int().min(0).optional(),
      distortion: z.number().finite().min(0).max(0.95).optional(),
      confirmed: z.boolean().optional(),
      exactFacts: z.array(z.string().min(1)).optional(),
      dedupeKey: z.string().min(1).optional(),
    })
    .strict()
    .refine((e) => e.originId !== undefined || e.pos !== undefined, { message: 'addNews needs originId or pos' }),
  hearNews: z
    .object({
      op: z.literal('hearNews'),
      settlementId: prefixed('set'),
      via: z.enum(['keeper', 'envoy', 'merchant']).optional(),
      maxItems: z.number().int().min(1).optional(),
      minImportance: z.number().int().min(1).max(5).optional(),
    })
    .strict(),
};

/** News effect implementations. */
export const NEWS_EFFECTS: EffectHandlers = {
  addNews(draft, e, ctx) {
    const spec: NewsSpec = { kind: e.kind };
    if (e.originId !== undefined) spec.originId = e.originId;
    if (e.pos !== undefined) spec.pos = { x: e.pos.x, y: e.pos.y };
    if (e.importance !== undefined) spec.importance = e.importance;
    if (e.facts !== undefined) spec.facts = e.facts;
    if (e.textKey !== undefined) spec.textKey = e.textKey;
    if (e.refs !== undefined) spec.refs = e.refs;
    if (e.factionIds !== undefined) spec.factionIds = e.factionIds;
    if (e.hour !== undefined) spec.hour = e.hour;
    if (e.distortion !== undefined) spec.distortion = e.distortion;
    if (e.confirmed !== undefined) spec.confirmed = e.confirmed;
    if (e.exactFacts !== undefined) spec.exactFacts = e.exactFacts;
    if (e.dedupeKey !== undefined) spec.dedupeKey = e.dedupeKey;
    createNews(draft, ctx, spec);
  },
  hearNews(draft, e, ctx) {
    const settlementId = e.settlementId as SettlementId;
    if (!Object.hasOwn(draft.settlements, settlementId)) throw new EffectError(`hearNews: unknown settlement ${settlementId}`);
    const via = e.via ?? 'keeper';
    const t = ctx.tunables.news;
    const views = newsKnownAt(draft, settlementId, ctx, {
      limit: e.maxItems ?? t.keeper.maxItems,
      maxAgeDays: t.keeper.memoryDays,
      via,
      ...(e.minImportance !== undefined ? { minImportance: e.minImportance } : {}),
    });
    for (const view of views) {
      const item = draft.news[view.id];
      if (item) hearCopy(draft, ctx, item, view.copy, via, settlementId);
    }
  },
};
