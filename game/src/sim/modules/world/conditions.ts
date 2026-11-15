/**
 * World functions of the condition language (design §29.7), pure reads of the state's geography digest
 * (`state.worldIndex`) and the player's knowledge. Settlement arguments default to `scope.settlement`.
 *
 *   provinceOf(s?)        province id of a settlement ('' if unknown)
 *   regionOf(s?)          geography region id of a settlement ('' if unknown)
 *   kingdomOf(s?)         geography realm id of its province ('' if none)
 *   isCoastal(s?)         the settlement has a harbour
 *   distanceDays(a, b)    nominal travel days between two settlements (sea or land lane, else straight line)
 *   charted(s?)           the player has the settlement on the map
 *   visited(s?)           the player has been there
 *   homeland(s?)          the settlement lies in a homeland province
 */
import type { ConditionEvalContext, ConditionFns } from '@sim/core/module';
import type { GameState, SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { isChartedAt } from './knowledge';

const optSettlement = z.union([z.tuple([]), z.tuple([z.string().min(1)])]);

function settlementArg(args: readonly unknown[], i: number, ctx: ConditionEvalContext): SettlementId | undefined {
  const a = args[i];
  const id = typeof a === 'string' ? a : Object.hasOwn(ctx.scope, 'settlement') ? ctx.scope['settlement'] : undefined;
  return id !== undefined && Object.hasOwn(ctx.state.settlements, id) ? (id as SettlementId) : undefined;
}

/** Nominal days between two settlements: the faster lane, else straight line × detour ÷ fallback pace. */
export function distanceDays(state: GameState, a: SettlementId, b: SettlementId, detour: number, kmPerDay: number): number {
  if (a === b) return 0;
  const idx = state.worldIndex;
  const ga = idx?.settlements[a];
  const lane = ga?.lanes.find((l) => l.to === b);
  if (lane) {
    const s = lane.seaDays ?? Infinity;
    const l = lane.landDays ?? Infinity;
    const d = Math.min(s, l);
    if (Number.isFinite(d)) return d;
  }
  const sa = state.settlements[a];
  const sb = state.settlements[b];
  if (!sa || !sb) return Infinity;
  const dx = sa.mapPos.x - sb.mapPos.x;
  const dy = sa.mapPos.y - sb.mapPos.y;
  const km = Math.sqrt(dx * dx + dy * dy) * (idx?.cellKm ?? 5) * detour;
  return Math.round((km / kmPerDay) * 10) / 10;
}

/** The world module's condition functions. */
export const WORLD_CONDITION_FNS: ConditionFns = {
  provinceOf: {
    args: optSettlement,
    returns: 'string',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      return s !== undefined ? (ctx.state.settlements[s]?.provinceId ?? '') : '';
    },
  },
  regionOf: {
    args: optSettlement,
    returns: 'string',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      return s !== undefined ? (ctx.state.worldIndex?.settlements[s]?.regionId ?? '') : '';
    },
  },
  kingdomOf: {
    args: optSettlement,
    returns: 'string',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      const p = s !== undefined ? ctx.state.settlements[s]?.provinceId : undefined;
      return p !== undefined ? (ctx.state.worldIndex?.provinces[p]?.kingdomId ?? '') : '';
    },
  },
  isCoastal: {
    args: optSettlement,
    returns: 'boolean',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      if (s === undefined) return false;
      const g = ctx.state.worldIndex?.settlements[s];
      return g !== undefined ? g.port >= 0 : ctx.state.settlements[s]?.coastal === true;
    },
  },
  distanceDays: {
    args: z.union([z.tuple([z.string().min(1)]), z.tuple([z.string().min(1), z.string().min(1)])]),
    returns: 'number',
    evaluate: (args, ctx) => {
      const a = args.length === 2 ? settlementArg(args, 0, ctx) : settlementArg([], 0, ctx);
      const b = settlementArg(args, args.length === 2 ? 1 : 0, ctx);
      if (a === undefined || b === undefined) return -1;
      const t = ctx.env.content.tunables.world.index;
      const d = distanceDays(ctx.state, a, b, t.fallbackDetour, t.fallbackKmPerDay);
      return Number.isFinite(d) ? d : -1;
    },
  },
  charted: {
    args: optSettlement,
    returns: 'boolean',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      const k = ctx.state.knowledge;
      const pos = s !== undefined ? ctx.state.settlements[s]?.mapPos : undefined;
      return k !== undefined && pos !== undefined && isChartedAt(k, pos.x, pos.y);
    },
  },
  visited: {
    args: optSettlement,
    returns: 'boolean',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      const v = ctx.state.knowledge?.visited;
      return s !== undefined && v !== undefined && Object.hasOwn(v, s);
    },
  },
  homeland: {
    args: optSettlement,
    returns: 'boolean',
    evaluate: (args, ctx) => {
      const s = settlementArg(args, 0, ctx);
      const p = s !== undefined ? ctx.state.settlements[s]?.provinceId : undefined;
      return p !== undefined && ctx.state.provinces[p]?.homeland === true;
    },
  },
};
