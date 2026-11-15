/**
 * Movement costs per side (open tile = 1, Infinity = blocked) and the retreat distance fields.
 * Rebuilt when the map changes (a gate breaks, a building collapses into rubble).
 *
 * The retreat field uses "desperate" costs: walls, stakes, houses and water are passable at a high
 * price (climbing over, breaking through, swimming), so every walkable tile has a finite distance
 * to the side's extraction zone and Retreat to Ships can never be soft-locked.
 */
import { S, T, TERRAIN_INFO, Z } from '../map/grid';
import type { BattleState, BSide } from './types';

/** Speed multiplier of a terrain kind at a height (balance.battle.terrain + tunables.terrainSpeed). */
export function terrainSpeed(state: BattleState, terrain: number, height: number): number {
  const info = TERRAIN_INFO[terrain];
  if (!info) return 1;
  const b = state.data.b;
  const t = state.data.t;
  let v: number;
  switch (info.speedKey) {
    case 'road':
    case 'sand':
    case 'rubble':
    case 'ditch':
      v = t.terrainSpeed[info.speedKey];
      break;
    default:
      v = b.terrain[info.speedKey].speed;
  }
  if (height >= t.hillHeight && terrain !== T.floor) v *= b.terrain.hill.speed;
  return v;
}

/** Rebuilds `side.cost`, `side.retreatCost` and `side.retreatField`. */
export function rebuildSideCosts(state: BattleState, side: BSide): void {
  const map = state.map;
  const t = state.data.t;
  const n = map.w * map.h;
  const extractBit = side.idx === 0 ? Z.extractA : Z.extractD;
  const sources: number[] = [];
  let minCost = Infinity;
  for (let i = 0; i < n; i++) {
    const s = map.struct[i]!;
    const terrain = map.terrain[i]!;
    const walkable = TERRAIN_INFO[terrain]!.walkable;
    const base = walkable ? 1 / terrainSpeed(state, terrain, map.height[i]!) : Infinity;
    let c: number;
    let r: number;
    if (s === S.none || s === S.tower) {
      c = base;
      r = walkable ? base : terrain === T.water ? t.retreatCost.water : Infinity;
    } else if (s === S.wall) {
      c = side.ladders ? 1 / t.climbSpeedMult : Infinity;
      r = t.retreatCost.wall;
    } else if (s === S.gate || s === S.stakes) {
      c = Infinity;
      r = t.retreatCost.wall;
    } else if (s === S.building) {
      c = Infinity;
      r = t.retreatCost.building;
    } else {
      // Ship hulls: boarding (attackers) or swimming past them.
      c = Infinity;
      r = side.idx === 0 ? 1 : t.retreatCost.water;
    }
    side.cost[i] = c;
    side.retreatCost[i] = Math.min(r, c);
    if (c < minCost) minCost = c;
    if ((map.zone[i]! & extractBit) !== 0 && Number.isFinite(side.retreatCost[i]!)) sources.push(i);
  }
  side.minCost = Number.isFinite(minCost) ? minCost : 1;
  state.pg.field(side.retreatCost, sources, side.retreatField);
}

/** Rebuilds both sides (call after the map changed). */
export function rebuildCosts(state: BattleState): void {
  rebuildSideCosts(state, state.sides[0]);
  rebuildSideCosts(state, state.sides[1]);
  state.costsDirty = false;
}

/** Speed multiplier for a squad of `side` standing on tile `i` (desperate moves are slow). */
export function tileSpeed(state: BattleState, side: BSide, i: number): number {
  const c = side.cost[i]!;
  if (Number.isFinite(c)) return 1 / c;
  const r = side.retreatCost[i]!;
  return Number.isFinite(r) ? state.data.t.climbSpeedMult : 0;
}
