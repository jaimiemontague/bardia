/**
 * What squads perceive: ground height and elevation, shooting range, sight and hidden squads.
 */
import { effectiveRange } from '../formulas';
import { gapBetween, onField } from './geometry';
import type { BattleState, BSquad } from './types';

/** Ground height (0..3) under a point. */
export function heightAt(state: BattleState, x: number, y: number): number {
  const m = state.map;
  const tx = Math.min(m.w - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(m.h - 1, Math.max(0, Math.floor(y)));
  return m.height[ty * m.w + tx]!;
}

/** True when the shooter stands higher than the point it shoots at. */
export function isElevated(state: BattleState, s: BSquad, x: number, y: number): boolean {
  return heightAt(state, s.x, s.y) > heightAt(state, x, y);
}

/** Effective shooting range of a squad at a point (×1.2 from higher ground). */
export function shotRange(state: BattleState, s: BSquad, x: number, y: number): number {
  return effectiveRange(state.data.b, s.unit.range, isElevated(state, s, x, y));
}

/** Recomputes each side's view of the enemy (sight radius, night, hidden squads). */
export function updateVisibility(state: BattleState): void {
  const t = state.data.t;
  const sight = state.night ? t.nightSightTiles : t.sightTiles;
  const reveal = state.data.b.hideRevealTiles;
  for (const side of state.sides) {
    const vis = side.visible;
    for (const o of state.squads) {
      if (o.side === side.idx) {
        vis[o.idx] = 1;
        continue;
      }
      if (!onField(o)) {
        vis[o.idx] = 0;
        continue;
      }
      let seen = 0;
      for (const s of state.squads) {
        if (s.side !== side.idx || (s.status !== 'active' && s.status !== 'routing')) continue;
        const g = gapBetween(s, o);
        if (o.hidden ? g <= reveal : g <= sight) {
          seen = 1;
          break;
        }
      }
      vis[o.idx] = seen;
    }
  }
}
