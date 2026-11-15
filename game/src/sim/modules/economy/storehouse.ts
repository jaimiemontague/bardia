/**
 * The house storehouse at the capital (`state.storehouse`; units and rules in ./types.ts header): creation and
 * the new-game seed, defensive reads, the `changeStores` effect, who speaks for the house at the capital's
 * market, and invariants.
 */
import { GoodIdSchema } from '@content/schemas/ids';
import type { Content } from '@content/index';
import type { EffectHandlers, EffectSchemas, SimContext } from '@sim/core/module';
import type { Character, GameState, GoodId } from '@sim/core/state';
import { z } from 'zod';
import { GOODS } from './profiles';
import { effectiveSkill, isRecord, roundTo } from './realm';
import type { GoodTons, Storehouse } from './types';

const EMPTY: Storehouse = Object.freeze({ goods: Object.freeze({}) as GoodTons, rations: 0 }) as Storehouse;

/** The storehouse as it is (an empty one when the slice is absent). Pure. */
export function readStorehouse(state: GameState): Storehouse {
  const s = state.storehouse;
  return isRecord(s) ? (s as Storehouse) : EMPTY;
}

/** The storehouse, created (and repaired) on demand. Call with a draft. */
export function storehouseOf(draft: GameState): Storehouse {
  if (!isRecord(draft.storehouse)) draft.storehouse = { goods: {}, rations: 0 };
  const s = draft.storehouse as Storehouse;
  if (!isRecord(s.goods)) s.goods = {};
  if (!(Number.isFinite(s.rations) && s.rations >= 0)) s.rations = 0;
  return s;
}

/** Tons of a good in the storehouse (rations as tons of their count). Pure. */
export function storedTons(store: Storehouse, good: GoodId, rationsPerTon: number): number {
  if (good === 'rations') return Math.max(0, store.rations) / rationsPerTon;
  return Math.max(0, store.goods[good] ?? 0);
}

/** Trade goods in the storehouse (rations excluded), tons, in content order. Pure. */
export function storedGoods(store: Storehouse): [GoodId, number][] {
  const out: [GoodId, number][] = [];
  for (const g of GOODS) {
    if (g === 'rations') continue;
    const v = store.goods[g] ?? 0;
    if (v > 0) out.push([g, v]);
  }
  return out;
}

/** Men in a settlement's garrison. */
function garrisonMen(state: GameState): number {
  let n = 0;
  for (const v of Object.values(state.settlements[state.player.capitalId]?.garrison ?? {})) n += Math.max(0, v ?? 0);
  return n;
}

/**
 * Creates the storehouse if it is missing (new games and saves made before it existed), seeded with rations
 * for `startRationDays` days of the capital garrison and the `startGoods`. An existing storehouse is kept.
 */
export function ensureStorehouse(draft: GameState, ctx: SimContext): void {
  if (isRecord(draft.storehouse)) {
    storehouseOf(draft);
    return;
  }
  const t = ctx.tunables.economy.storehouse;
  const store = storehouseOf(draft);
  store.rations = Math.max(0, Math.ceil(garrisonMen(draft) * ctx.balance.food.rationsPerManPerDay * t.startRationDays));
  for (const g of GOODS) {
    const v = t.startGoods[g] ?? 0;
    if (g !== 'rations' && v > 0) store.goods[g] = roundTo(v, 3);
  }
}

/**
 * Who speaks for the house at the capital's market: the best Speechcraft among the house's people who are
 * in the capital (alive, free), the ruler included.
 */
export function homeSpeaker(state: GameState, content: Content): Character | undefined {
  const cap = state.player.capitalId;
  let best: Character | undefined;
  let bestV = -1;
  for (const id of Object.keys(state.characters)) {
    const c = state.characters[id as keyof GameState['characters']];
    if (!c?.alive || c.location.kind !== 'settlement' || c.location.id !== cap) continue;
    if (c.id !== state.player.rulerId && c.factionId !== state.player.factionId) continue;
    const v = effectiveSkill(content, c, 'speechcraft');
    if (v > bestV || (v === bestV && best !== undefined && c.id < best.id)) {
      bestV = v;
      best = c;
    }
  }
  return best;
}

/** Adds to (or takes from) the storehouse; amounts floor at 0. */
export function changeStores(draft: GameState, goods: GoodTons | undefined, rations: number | undefined): void {
  const store = storehouseOf(draft);
  for (const g of GOODS) {
    const d = goods?.[g];
    if (d === undefined || d === 0 || g === 'rations') continue;
    const v = roundTo((store.goods[g] ?? 0) + d, 3);
    if (v > 0) store.goods[g] = v;
    else delete store.goods[g];
  }
  if (rations !== undefined && rations !== 0) store.rations = Math.max(0, Math.round(store.rations + rations));
}

/** zod schema of changeStores. */
export const STORES_EFFECT_SCHEMAS: EffectSchemas = {
  changeStores: z
    .object({
      op: z.literal('changeStores'),
      goods: z.record(GoodIdSchema, z.number().finite()).optional(),
      rations: z.number().finite().optional(),
    })
    .strict()
    .refine((e) => e.goods === undefined || e.goods.rations === undefined, { message: "changeStores: rations go in 'rations' (a count), not in goods" }),
};

/** The changeStores effect. */
export const STORES_EFFECTS: EffectHandlers = {
  changeStores(draft, e) {
    changeStores(draft, e.goods, e.rations);
  },
};

/** Storehouse invariants: finite, non-negative amounts; no rations among the goods. */
export function storehouseInvariants(state: GameState): string[] {
  const s = state.storehouse;
  if (s === undefined) return [];
  const out: string[] = [];
  if (!isRecord(s) || !isRecord(s.goods)) return ['storehouse: malformed'];
  if (!(Number.isInteger(s.rations) && s.rations >= 0)) out.push(`storehouse: rations ${s.rations}`);
  for (const [g, v] of Object.entries(s.goods)) {
    if (g === 'rations') out.push('storehouse: rations kept as goods');
    if (!(Number.isFinite(v) && (v ?? 0) > 0)) out.push(`storehouse: ${g} is ${v}`);
  }
  return out;
}
