/**
 * Faith test fixtures (ARCHITECTURE.md §16): other modules' tests may import these to put the
 * player's house into a given faith situation without running the faith rules.
 *
 *   const state2 = withPlayerOmen(state, env, 'battle', 'blessed');
 *   const state3 = withFaithWrath(state2, env, 65);
 */
import type { OmenActivity } from '@content/schemas/tunables/faith';
import type { SimEnv } from '@sim/core/module';
import type { GameState, GodId, OmenId } from '@sim/core/state';
import { addDays } from '@sim/core/time';
import { inDraft } from '@sim/testing';
import { ensureFaithState } from './state';
import { wrathLevelOf } from './wrath';
import './types';

/** Returns `state` with the player holding an omen for an activity (in force for `days`). */
export function withPlayerOmen(state: GameState, env: SimEnv, activity: OmenActivity, omen: OmenId, days = 30): GameState {
  return inDraft(state, env, (draft) => {
    const omens = (draft.player.house.omens ??= {});
    omens[activity] = { omen, score: 0, readHour: draft.time.hour, untilHour: addDays(draft.time.hour, days) };
  }).state;
}

/** Returns `state` with the player's Favor for a god set (no events). */
export function withFavor(state: GameState, env: SimEnv, god: GodId, value: number): GameState {
  return inDraft(state, env, (draft) => {
    draft.player.house.favor[god] = value;
  }).state;
}

/** Returns `state` with the player's Faith Wrath set and its threshold level recorded (no events). */
export function withFaithWrath(state: GameState, env: SimEnv, value: number): GameState {
  return inDraft(state, env, (draft) => {
    draft.player.house.faithWrath = value;
    ensureFaithState(draft).wrathLevel = wrathLevelOf(env.balance, value);
  }).state;
}
