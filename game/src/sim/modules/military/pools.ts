/**
 * Recruitment pools per holding (§12.1, §31.5, §10.5):
 *   poolMax  = floor(pop × poolRate × (loyaltyFactorBase + loyaltyFactorSlope × loyalty/100)), × highPoolMult at loyalty ≥ highAt
 *   regen/mo = ceil(poolMax × regenRate × (1 + regenStewardshipBonus × governor Stewardship))
 * `pool.current` counts every available recruit; `pool.veterans[unit]` is the subset who are veterans
 * of that unit type (men who came home), with their average battles in `holding.veteranBattles`.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { GameState, HoldingState, Settlement, SettlementId, UnitTypeId } from '@sim/core/state';
import { baseState } from '@sim/core/context';
import { effectiveSkill, recNum, round2 } from './realm';
import { battlesForStars } from './units';

/** §31.5 pool maximum for a population and loyalty (with the §10.5 high-loyalty bonus). */
export function poolMax(balance: Balance, pop: number, loyalty: number): number {
  const r = balance.recruit;
  const loyal = clamp(Number.isFinite(loyalty) ? loyalty : 0, balance.loyalty.min, balance.loyalty.max);
  const factor = r.loyaltyFactorBase + (r.loyaltyFactorSlope * loyal) / 100;
  let max = Math.floor(Math.max(0, pop) * r.poolRate * factor);
  if (loyal >= balance.loyalty.highAt) max = Math.floor(max * balance.loyalty.highPoolMult);
  return Math.max(0, max);
}

/** §31.5 monthly regeneration for a pool maximum and the governor's Stewardship. */
export function poolRegen(balance: Balance, max: number, stewardship: number): number {
  const r = balance.recruit;
  return Math.max(0, Math.ceil(max * r.regenRate * (1 + r.regenStewardshipBonus * Math.max(0, stewardship))));
}

/** The holding governor's effective Stewardship (0 when there is no governor). */
export function governorStewardship(state: GameState, content: Content, holding: HoldingState): number {
  return effectiveSkill(content, state.characters[holding.governorId], 'stewardship');
}

/** Σ veterans in a pool. */
export function poolVeteranTotal(holding: HoldingState): number {
  let sum = 0;
  for (const unit of Object.keys(holding.pool.veterans)) sum += recNum(holding.pool.veterans, unit);
  return sum;
}

/** Pool forecast for the client: maximum, current, next month's regeneration. */
export function poolForecast(
  state: GameState,
  content: Content,
  settlementId: SettlementId,
): { max: number; current: number; regen: number; veterans: Record<UnitTypeId, number> } | undefined {
  const s = state.settlements[settlementId];
  if (!s?.holding) return undefined;
  const max = poolMax(content.balance, s.pop, s.holding.loyalty);
  return {
    max,
    current: s.holding.pool.current,
    regen: poolRegen(content.balance, max, governorStewardship(state, content, s.holding)),
    veterans: { ...s.holding.pool.veterans },
  };
}

/** Keeps veterans a subset of the pool after it shrank (largest groups trimmed first, deterministic). */
function trimVeterans(holding: HoldingState): void {
  let excess = poolVeteranTotal(holding) - holding.pool.current;
  if (excess <= 0) return;
  const units = Object.keys(holding.pool.veterans).sort((a, b) => recNum(holding.pool.veterans, b) - recNum(holding.pool.veterans, a) || (a < b ? -1 : 1));
  for (const unit of units) {
    if (excess <= 0) break;
    const have = recNum(holding.pool.veterans, unit);
    const cut = Math.min(have, excess);
    excess -= cut;
    if (have - cut > 0) holding.pool.veterans[unit] = have - cut;
    else {
      delete holding.pool.veterans[unit];
      if (holding.veteranBattles) delete holding.veteranBattles[unit];
    }
  }
}

/** Recomputes a holding's maximum and adds one month of regeneration (capped at the maximum). */
export function regenPool(state: GameState, content: Content, s: Settlement): void {
  const holding = s.holding;
  if (!holding) return;
  const max = poolMax(content.balance, s.pop, holding.loyalty);
  const regen = poolRegen(content.balance, max, governorStewardship(state, content, holding));
  const pool = holding.pool;
  pool.max = max;
  pool.current = Math.min(max, Math.max(0, Math.floor(pool.current)) + regen);
  trimVeterans(holding);
}

/** Monthly system: every holding's pool. Scans the base table and writes only holdings. */
export function monthlyPools(draft: GameState, ctx: SimContext): void {
  const base = baseState(draft.settlements);
  for (const id in base) {
    if (!base[id as SettlementId]?.holding) continue;
    const s = draft.settlements[id as SettlementId];
    if (s) regenPool(draft, ctx.content, s);
  }
}

/** Init / old saves: holdings the module has never seen start with `pool.startShare` of their maximum. */
export function initPools(draft: GameState, ctx: SimContext): void {
  const share = ctx.tunables.military.pool.startShare;
  for (const id of Object.keys(draft.settlements) as SettlementId[]) {
    const s = draft.settlements[id];
    const holding = s?.holding;
    if (!s || !holding) continue;
    const pool = holding.pool;
    if (!pool.veterans) pool.veterans = {};
    if (pool.max === 0 && pool.current === 0) {
      pool.max = poolMax(ctx.balance, s.pop, holding.loyalty);
      pool.current = Math.floor(pool.max * share);
    }
  }
}

/** Men going home: they rejoin the pool (veterans keep their battles). */
export function addToPool(balance: Balance, holding: HoldingState, unit: UnitTypeId, count: number, battles: number): void {
  if (count <= 0) return;
  const pool = holding.pool;
  pool.current = Math.max(0, pool.current) + count;
  if (battles >= battlesForStars(balance, 1)) {
    const have = recNum(pool.veterans, unit);
    const before = holding.veteranBattles ? recNum(holding.veteranBattles, unit) : 0;
    pool.veterans[unit] = have + count;
    holding.veteranBattles ??= {};
    holding.veteranBattles[unit] = round2((have * before + count * battles) / (have + count));
  }
}

/** Takes up to `count` veterans of `unit` out of the pool's veteran subset; returns how many and their battles. */
export function takeVeterans(holding: HoldingState, unit: UnitTypeId, count: number): { count: number; battles: number } {
  const have = recNum(holding.pool.veterans, unit);
  const n = Math.min(have, Math.max(0, count));
  const battles = holding.veteranBattles ? recNum(holding.veteranBattles, unit) : 0;
  if (n <= 0) return { count: 0, battles: 0 };
  if (have - n > 0) holding.pool.veterans[unit] = have - n;
  else {
    delete holding.pool.veterans[unit];
    if (holding.veteranBattles) delete holding.veteranBattles[unit];
  }
  return { count: n, battles };
}
