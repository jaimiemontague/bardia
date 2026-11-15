/**
 * Test fixtures for the military module (other modules' tests may import them). Pure helpers over
 * the kernel test utilities: an env and state with this module, markets on demand, content with
 * overridden military tunables, and small state edits through one kernel operation.
 */
import { getContent, type Content } from '@content/index';
import type { Tunables as MilitaryTunables } from '@content/schemas/tunables/military';
import type { Command } from '@sim/core/commands';
import { dispatch, type DispatchResult } from '@sim/core/dispatch';
import type { SimContext, SimEnv, SimModule } from '@sim/core/module';
import { advance } from '@sim/core/scheduler';
import type { GameState, GoodId, Market, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, testEnv, testState, type TestStateOptions } from '../../testing';
import { module as military } from './index';

/** Content with some military tunables replaced (deep-merged one level). */
export function militaryContent(overrides: Partial<{ [K in keyof MilitaryTunables]: Partial<MilitaryTunables[K]> }>, base: Content = getContent()): Content {
  const current = base.tunables.military;
  const merged = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const prev = (current as Record<string, unknown>)[key];
    merged[key] = prev !== null && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as object), ...(value as object) } : value;
  }
  return { ...base, tunables: { ...base.tunables, military: merged as MilitaryTunables } };
}

/** An env with core + military (+ extra test modules). */
export function militaryEnv(extra: readonly SimModule[] = [], content?: Content): SimEnv {
  return testEnv([military, ...extra], content ?? getContent());
}

/** A new-game state with core + military (+ extra test modules). */
export function militaryState(opts: TestStateOptions & { extra?: readonly SimModule[] } = {}): GameState {
  const { extra = [], ...rest } = opts;
  return testState({ ...rest, modules: [military, ...extra] });
}

/** Runs `fn` in one operation and returns the new state. */
export function edit(state: GameState, env: SimEnv, fn: (draft: GameState, ctx: SimContext) => void): GameState {
  return inDraft(state, env, fn).state;
}

/** Gives a settlement a market with the given stock (tons). */
export function withMarket(state: GameState, env: SimEnv, settlementId: SettlementId, stock: Partial<Record<GoodId, number>>): GameState {
  return edit(state, env, (draft) => {
    const market: Market = { stock: { ...stock }, target: {}, prod: {}, cons: {}, lastUpdate: 0 };
    draft.markets[settlementId] = market;
  });
}

/** Dispatches a command and throws when it is rejected (for setup steps). */
export function mustDispatch(state: GameState, env: SimEnv, cmd: Command): DispatchResult {
  const r = dispatch(state, cmd, env);
  if (r.error) throw new Error(`${cmd.type} rejected: ${r.error.code} ${r.error.message}`);
  return r;
}

/** Advances whole days. */
export function days(state: GameState, env: SimEnv, n: number): ReturnType<typeof advance> {
  return advance(state, n * HOURS_PER_DAY, env);
}

/** The player's capital id. */
export function capitalOf(state: GameState): SettlementId {
  return state.player.capitalId;
}
