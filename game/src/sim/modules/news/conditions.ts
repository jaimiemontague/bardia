/**
 * Condition-language functions (§29.7) over news (module-owned; reported to the integrator).
 * Pure; they read the player's knowledge unless a settlement is named.
 */
import type { ConditionEvalContext, ConditionFns } from '@sim/core/module';
import type { SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { z } from 'zod';

const kind = z.string().regex(/^[a-z][A-Za-z0-9]*$/);
const days = z.number().finite().min(0);
const id = z.string().min(1);

function scopedSettlement(ctx: ConditionEvalContext, explicit: unknown): SettlementId | undefined {
  if (typeof explicit === 'string' && explicit.startsWith('set_')) return explicit as SettlementId;
  for (const key of ['settlement', 'holding']) {
    if (Object.hasOwn(ctx.scope, key)) {
      const v = ctx.scope[key];
      if (typeof v === 'string' && v.startsWith('set_')) return v as SettlementId;
    }
  }
  return undefined;
}

function heardCount(ctx: ConditionEvalContext, kindFilter: string | undefined, withinDays: number | undefined): number {
  const since = withinDays !== undefined ? ctx.state.time.hour - withinDays * HOURS_PER_DAY : -Infinity;
  let n = 0;
  for (const item of Object.values(ctx.state.news)) {
    const heard = item.playerHeard;
    if (!heard || heard.via === 'witness' || heard.hour < since) continue;
    if (kindFilter !== undefined && item.kind !== kindFilter) continue;
    n++;
  }
  return n;
}

/** The news module's condition functions. */
export const NEWS_CONDITION_FNS: ConditionFns = {
  /** newsHeard(kind[, days]) → the player has heard (not witnessed) news of this kind (within `days`). */
  newsHeard: {
    args: z.union([z.tuple([kind]), z.tuple([kind, days])]),
    returns: 'boolean',
    evaluate: ([k, d], ctx) => heardCount(ctx, String(k), typeof d === 'number' ? d : undefined) > 0,
  },
  /** newsHeardCount([days]) → how many news items the player has heard (within `days`). */
  newsHeardCount: {
    args: z.union([z.tuple([]), z.tuple([days])]),
    returns: 'number',
    evaluate: ([d], ctx) => heardCount(ctx, undefined, typeof d === 'number' ? d : undefined),
  },
  /** newsKnownAt([settlementId][, kind]) → items known at a settlement (default: the scope's settlement). */
  newsKnownAt: {
    args: z.union([z.tuple([]), z.tuple([id]), z.tuple([id, kind])]),
    returns: 'number',
    evaluate: ([s, k], ctx) => {
      const settlementId = scopedSettlement(ctx, s);
      const idx = ctx.state.newsIndex;
      if (settlementId === undefined || !idx || !Object.hasOwn(idx.known, settlementId)) return 0;
      const ids = idx.known[settlementId] ?? [];
      if (typeof k !== 'string') return ids.length;
      let n = 0;
      for (const newsId of ids) if (ctx.state.news[newsId]?.kind === k) n++;
      return n;
    },
  },
};
