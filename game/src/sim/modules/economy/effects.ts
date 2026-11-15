/**
 * The `changeEconomy` effect (design §19.1; owned by economy): storylets, quests, raids and sieges change
 * a settlement's (or a region's) economy state, its drift score, its prices (a price event), its market
 * stocks or its harbour blockade. Targets: `settlementId`, else every settlement of `regionId`, else the
 * player's capital.
 */
import { ECONOMY_STATE_IDS, EconomyStateIdSchema, GoodIdSchema, type EconomyStateId } from '@content/schemas/ids';
import { clamp } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import type { EffectHandlers, EffectSchemas } from '@sim/core/module';
import type { GameState, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { z } from 'zod';
import { setEconomyState } from './markets';
import { GOODS } from './profiles';
import { roundTo } from './realm';
import { economyOf } from './slice';
import type { PriceEvent } from './types';

const finite = z.number().finite();

/** zod schema of changeEconomy. */
export const ECONOMY_EFFECT_SCHEMAS: EffectSchemas = {
  changeEconomy: z
    .object({
      op: z.literal('changeEconomy'),
      settlementId: z.string().regex(/^set_.+$/).optional(),
      regionId: z.string().min(1).optional(),
      set: EconomyStateIdSchema.optional(),
      steps: z.number().int().min(-4).max(4).optional(),
      score: finite.optional(),
      price: z.object({ good: GoodIdSchema, mult: z.number().finite().positive(), days: z.number().finite().positive() }).strict().optional(),
      preset: z.enum(['famine', 'goodHarvest']).optional(),
      goods: z.record(GoodIdSchema, finite).optional(),
      stockPct: z.number().finite().min(-100).optional(),
      blockadeDays: z.number().finite().min(0).optional(),
      reason: z.string().min(1).max(60).optional(),
    })
    .strict()
    .refine((e) => ['set', 'steps', 'score', 'price', 'preset', 'goods', 'stockPct', 'blockadeDays'].some((k) => (e as Record<string, unknown>)[k] !== undefined), {
      message: 'changeEconomy needs at least one change',
    }),
};

function targets(draft: GameState, settlementId: string | undefined, regionId: string | undefined): SettlementId[] {
  if (settlementId !== undefined) {
    if (!Object.hasOwn(draft.settlements, settlementId)) throw new EffectError(`changeEconomy: unknown settlement ${settlementId}`);
    return [settlementId as SettlementId];
  }
  if (regionId !== undefined) {
    const out: SettlementId[] = [];
    for (const s of Object.values(draft.settlements)) if (draft.provinces[s.provinceId]?.regionId === regionId) out.push(s.id);
    return out;
  }
  return Object.hasOwn(draft.settlements, draft.player.capitalId) ? [draft.player.capitalId] : [];
}

/** Economy effect implementations. */
export const ECONOMY_EFFECTS: EffectHandlers = {
  changeEconomy(draft, e, ctx) {
    const t = ctx.tunables.economy;
    const eco = economyOf(draft);
    const ids = targets(draft, e.settlementId, e.regionId);
    const reason = e.reason ?? 'event';
    const hour = ctx.hour;
    // Price events are recorded once (per settlement, or for the region).
    const events: Omit<PriceEvent, 'settlementId' | 'regionId'>[] = [];
    if (e.price) events.push({ good: e.price.good, mult: clamp(e.price.mult, t.events.minMult, t.events.maxMult), untilHour: hour + Math.round(e.price.days * HOURS_PER_DAY), reason });
    if (e.preset === 'famine') events.push({ good: 'rations', mult: ctx.balance.market.famineRationsMult, untilHour: hour + t.events.famineDays * HOURS_PER_DAY, reason: e.reason ?? 'famine' });
    if (e.preset === 'goodHarvest') events.push({ good: 'rations', mult: ctx.balance.market.goodHarvestRationsMult, untilHour: hour + t.events.goodHarvestDays * HOURS_PER_DAY, reason: e.reason ?? 'goodHarvest' });
    for (const ev of events) {
      if (e.settlementId === undefined && e.regionId !== undefined) eco.priceEvents.push({ ...ev, regionId: e.regionId });
      else for (const id of ids) eco.priceEvents.push({ ...ev, settlementId: id });
    }
    const dec = t.market.stockDecimals;
    for (const id of ids) {
      const s = draft.settlements[id];
      if (!s) continue;
      if (e.set !== undefined || e.steps !== undefined) {
        let level = ECONOMY_STATE_IDS.indexOf(e.set ?? s.economy);
        if (level < 0) level = 3;
        level = clamp(level + (e.steps ?? 0), 0, ECONOMY_STATE_IDS.length - 1);
        setEconomyState(draft, ctx, id, ECONOMY_STATE_IDS[level] as EconomyStateId, reason);
      }
      if (e.score !== undefined) eco.eventScore[id] = roundTo((eco.eventScore[id] ?? 0) + e.score, 4);
      const market = draft.markets[id];
      if (market && (e.goods !== undefined || e.stockPct !== undefined)) {
        for (const g of GOODS) {
          let v = market.stock[g] ?? 0;
          if (e.stockPct !== undefined) v *= 1 + e.stockPct / 100;
          v += e.goods?.[g] ?? 0;
          market.stock[g] = roundTo(Math.max(0, v), dec);
        }
      }
      if (e.blockadeDays !== undefined) {
        if (e.blockadeDays > 0) eco.blockades[id] = hour + Math.round(e.blockadeDays * HOURS_PER_DAY);
        else delete eco.blockades[id];
      }
    }
  },
};
