/**
 * Stances of the squads a human commands (§13.5), as the battle tunables describe them:
 *   Engage (default for melee units): an idle squad attacks a seen enemy that comes within
 *     `tunables.autoEngageRangeTiles` on its own;
 *   Skirmish (default for ranged units): an idle squad runs back while a melee enemy is closer than
 *     `tunables.skirmishKeepFrac` × its shooting range, then turns to face the threat and shoots again;
 *   Hold: never moves without orders and never pursues.
 * Only idle squads react (an order always wins), and only on human-controlled sides: the battle AI
 * (ai/) gives its own squads their orders. Deterministic (state only, no RNG), checked four times a
 * second.
 */
import { clamp } from '@sim/core/dmath';
import { gapBetween, angleOf } from './geometry';
import { nearestEnemy, setTask } from './orders';
import { shotRange } from './sense';
import type { BattleState, BSquad } from './types';

/** Ticks between stance checks (5 ticks = 0.25 s at 20 Hz). */
export const STANCE_INTERVAL_TICKS = 5;

function idle(s: BSquad): boolean {
  return s.status === 'active' && !s.retreating && s.task.kind === 'none' && s.waypoints.length === 0 && s.contacts === 0 && !s.unit.nonCombatant;
}

/** Lets idle human-commanded squads act on their stance. */
export function humanStances(state: BattleState): void {
  if (state.tick % STANCE_INTERVAL_TICKS !== 0) return;
  if (!state.humanSides[0] && !state.humanSides[1]) return;
  const t = state.data.t;
  for (const s of state.squads) {
    if (!state.humanSides[s.side] || !idle(s) || s.stance === 'hold') continue;
    if (s.stance === 'engage') {
      const foe = nearestEnemy(state, s, t.autoEngageRangeTiles, (o) => o.status === 'active' || o.status === 'asleep');
      if (foe) setTask(state, s, 'attack', foe.x, foe.y, { target: foe.idx });
      continue;
    }
    // Skirmish: keep melee enemies at a distance (ranged squads by their range, others by the engage range).
    const keep = s.unit.hasRanged ? t.skirmishKeepFrac * shotRange(state, s, s.x, s.y) : t.autoEngageRangeTiles * t.skirmishKeepFrac;
    if (!(keep > 0)) continue;
    const foe = nearestEnemy(state, s, keep, (o) => o.status === 'active' && !o.unit.hasRanged);
    if (!foe) continue;
    let dx = s.x - foe.x;
    let dy = s.y - foe.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) {
      dx = -s.fx;
      dy = -s.fy;
    } else {
      dx /= d;
      dy /= d;
    }
    const back = keep - gapBetween(s, foe) + 2;
    const x = clamp(s.x + dx * back, 1, state.map.w - 1);
    const y = clamp(s.y + dy * back, 1, state.map.h - 1);
    setTask(state, s, 'move', x, y, { facing: angleOf(foe.x - s.x, foe.y - s.y), run: true });
  }
}
