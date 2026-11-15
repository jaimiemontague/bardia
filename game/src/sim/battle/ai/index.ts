/**
 * Battle AI (§13.7, §18.10): a commander layer and a squad utility layer per AI-controlled side.
 *
 * `createDefaultBattleAi` is the `BattleAiFactory` the engine installs for every side no human
 * controls (engine/create.ts). A controller's `update(state, side, issue)` runs every tick before
 * movement and thinks once per reaction time (tunables.aiReactionS by difficulty: 1.2 / 0.8 / 0.5 /
 * 0.4 s); each think it
 *   1. perceives (brain.ts): what it sees and remembers of the enemy, the force ratio (§31.11
 *      shape), the axis of the battle, whether the enemy is breaking;
 *   2. every `balance.battle.commanderReplanS` (5 s) re-plans (commander.ts): Hold,
 *      Defend-in-depth, Counterattack, Encircle or Withdraw from the force ratio, the ground and its
 *      mission, then gives squads roles and posts; coordinated sides form up before they go in;
 *   3. runs the squad layer (squads.ts): Engage / Hold / Reposition / Fight Fire / Guard Chief /
 *      Retreat, plus looting and extracting (raiders), breaking gates and taking the objective
 *      (stormers), carrying loot to safety and hunting loot carriers (raid defenders), monks fleeing;
 *   4. uses abilities (abilities.ts): shield wall, charge, frenzy, rally, hide, volleys and fire
 *      arrows, challenge.
 * Difficulty changes reaction time and coordination (focus of force, forming up, flanking, plan
 * noise) — never stats. Orders go through the same validated API as the player's and are applied
 * at once (not recorded: a replay re-derives them). Deterministic: the only randomness is an `Rng`
 * derived from the setup seed and the side; no wall clock, no Map/Set iteration.
 */
import type { BattleAiController, BattleAiFactory, BattleOrder, BattleState, SideIdx } from '../engine/types';
import { createBrain, perceive, type Brain } from './brain';
import { commandable, replan, updatePhase } from './commander';
import { runSquads } from './squads';

export type { Brain, JobKind, Mission, PlanKind, PlanRecord, Role } from './brain';
export { PLAN_KINDS, missionOf } from './brain';
export { planUtilities } from './commander';

/** Overrides for one AI (tests, tools): reaction time and coordination instead of the difficulty's. */
export interface BattleAiOptions {
  reactionS?: number;
  coordination?: number;
}

/** A controller that exposes its brain (debug view §18.11, tests). */
export interface BattleAi extends BattleAiController {
  readonly brain: Brain;
}

/** One think: perceive, re-plan when due, run the squads. */
export function think(state: BattleState, b: Brain, issue: (o: BattleOrder) => string | null): void {
  perceive(state, b);
  if (state.timeS + 1e-9 >= b.nextPlanT) {
    replan(state, b, issue);
    b.nextPlanT = state.timeS + state.data.b.commanderReplanS;
  } else updatePhase(state, b, commandable(state, b));
  if (b.plan === 'withdraw' || state.sides[b.side].retreatAll) return;
  runSquads(state, b, commandable(state, b), issue);
}

/** A battle-AI factory with optional overrides. */
export function createBattleAi(opts: BattleAiOptions = {}): BattleAiFactory {
  return (state: BattleState, side: SideIdx): BattleAi => {
    const brain = createBrain(state, side, opts);
    return {
      brain,
      update(st, _sd, issue) {
        if (st.timeS + 1e-9 < brain.nextThinkT) return;
        brain.nextThinkT = st.timeS + brain.reactionS;
        think(st, brain, issue);
      },
    };
  };
}

/** The default battle AI factory (difficulty from the setup). */
export const createDefaultBattleAi: BattleAiFactory = createBattleAi();
