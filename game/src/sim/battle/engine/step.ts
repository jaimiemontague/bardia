/**
 * One fixed simulation step (1 / balance.battle.tickHz seconds). Order of phases:
 * client orders → map changes → reinforcements and sleepers → visibility → AI → human squads' stances → timers → paths →
 * movement → separation → contacts → melee, maul, volleys, impacts → work at sites, fire →
 * casualties → morale, fatigue → figures → end conditions.
 */
import { applyQueued, applyOrder, requestPath } from './orders';
import { checkEnd } from './end';
import { autoDuelOutcome, resolveDuel } from './leaders';
import { applyCasualties, arrivals, updateFatigue, updateMorale, updateTimers, wakeSleepers } from './morale';
import { moveSquads, processPaths, separate, updateFigures } from './movement';
import { resolveImpacts, resolveMaul, resolveMelee, resolveRanged, updateContacts } from './combat';
import { rebuildCosts } from './costs';
import { updateVisibility } from './sense';
import { humanStances } from './stances';
import { updateFire, workAtSites } from './world';
import type { BattleState, SideIdx } from './types';
import { sideIdx } from './types';

/** A duel that involves no human-controlled side is settled at once (headless and AI-only battles). */
function settleAiDuel(state: BattleState): void {
  const req = state.duel;
  if (state.status !== 'duelRequested' || !req) return;
  const challengerSide = sideIdx(req.side);
  const chiefSide = (1 - challengerSide) as SideIdx;
  if (state.humanSides[challengerSide] || state.humanSides[chiefSide]) return;
  resolveDuel(state, autoDuelOutcome(state, req, state.rng));
}

/** Advances the battle by one tick (no-op when ended; paused while a duel awaits its outcome). */
export function stepBattle(state: BattleState): void {
  if (state.status === 'ended') return;
  applyQueued(state);
  settleAiDuel(state);
  if (state.status !== 'running') return;
  for (const s of state.squads) {
    s.px = s.x;
    s.py = s.y;
    s.pFacing = s.facing;
  }
  if (state.costsDirty) {
    rebuildCosts(state);
    for (const s of state.squads) if (s.status === 'active' && s.task.kind !== 'none' && s.task.kind !== 'retreat' && s.task.kind !== 'drive') requestPath(state, s);
  }
  arrivals(state);
  wakeSleepers(state);
  if (state.tick % state.data.t.visibilityIntervalTicks === 0) updateVisibility(state);
  for (const side of [0, 1] as const) {
    const ai = state.ai[side];
    if (ai) ai.update(state, side, (order) => applyOrder(state, side, order));
  }
  humanStances(state);
  settleAiDuel(state);
  updateTimers(state);
  processPaths(state);
  moveSquads(state);
  separate(state);
  updateContacts(state);
  resolveMelee(state);
  resolveMaul(state);
  resolveRanged(state);
  resolveImpacts(state);
  workAtSites(state);
  updateFire(state);
  applyCasualties(state);
  updateMorale(state);
  updateFatigue(state);
  updateFigures(state);
  state.tick++;
  state.timeS = state.tick * state.dt;
  checkEnd(state);
}
