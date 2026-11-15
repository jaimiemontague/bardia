/**
 * Battle-AI geometry and terrain helpers: tiles, walls, defensive ground, spots near a point,
 * travel times to the ships, and the rough combat value of a squad. Read-only over the engine
 * state; no allocation in the per-squad paths beyond small tuples.
 */
import { formationDef } from '../formulas';
import { S, TERRAIN_INFO, Z } from '../map/grid';
import { onField } from '../engine/geometry';
import type { BattleState, BSquad, SideIdx } from '../engine/types';

/** Tile index under a point (clamped to the map). */
export function tileOf(state: BattleState, x: number, y: number): number {
  const m = state.map;
  return Math.min(m.h - 1, Math.max(0, Math.floor(y))) * m.w + Math.min(m.w - 1, Math.max(0, Math.floor(x)));
}

/** True when the point lies inside the fortification ring. */
export function insideWalls(state: BattleState, x: number, y: number): boolean {
  return (state.map.zone[tileOf(state, x, y)]! & Z.inside) !== 0;
}

/** True when the map has a wall ring with at least one gate still shut and no gate broken. */
export function wallsClosed(state: BattleState): boolean {
  if (state.gates.length === 0) return false;
  for (const g of state.gates) if (g.broken) return false;
  return true;
}

/** True when a squad of `side` can walk onto the tile under (x, y). */
export function walkable(state: BattleState, side: SideIdx, x: number, y: number): boolean {
  if (x < 0.5 || y < 0.5 || x > state.map.w - 0.5 || y > state.map.h - 0.5) return false;
  return Number.isFinite(state.sides[side].cost[tileOf(state, x, y)]!);
}

/**
 * True when `s` can reach the ground under (x, y) on its own side's costs: the same side of a
 * closed wall ring (or a gate is open, or the side has ladders).
 */
export function reachable(state: BattleState, s: BSquad, x: number, y: number): boolean {
  if (state.gates.length === 0 || state.sides[s.side].ladders) return true;
  if (insideWalls(state, s.x, s.y) === insideWalls(state, x, y)) return true;
  return !wallsClosed(state);
}

/**
 * Defensive quality of standing at (x, y) for a squad (0 = open ground): hills and woods (§31.9)
 * and wall cover are good, fords and marsh bad. Ranged squads value height (range and accuracy).
 */
export function groundScore(state: BattleState, x: number, y: number, ranged: boolean): number {
  const m = state.map;
  const i = tileOf(state, x, y);
  const t = state.data.t;
  const b = state.data.b;
  const info = TERRAIN_INFO[m.terrain[i]!];
  let v = 0;
  if (m.height[i]! >= t.hillHeight) v += ranged ? 0.25 : b.terrain.hill.def - 1;
  if (info) v += b.terrain[info.combat].def - 1;
  if ((m.zone[i]! & Z.wallCover) !== 0) v += b.terrain.palisade.def - 1;
  if (m.struct[i] === S.tower) v += ranged ? 0.3 : 0;
  return v;
}

/**
 * The best spot near (x, y) by `score` (sampled on a coarse grid, minus a distance cost), walkable
 * for `side` and on the same side of the walls as (x, y).
 */
export function bestSpotNear(
  state: BattleState,
  side: SideIdx,
  x: number,
  y: number,
  radius: number,
  score: (px: number, py: number) => number,
  distCost = 0.02,
): [number, number] {
  let bx = x;
  let by = y;
  let best = walkable(state, side, x, y) ? score(x, y) : -Infinity;
  const inside = insideWalls(state, x, y);
  const step = Math.max(2, Math.round(radius / 4));
  for (let oy = -radius; oy <= radius; oy += step)
    for (let ox = -radius; ox <= radius; ox += step) {
      if (ox === 0 && oy === 0) continue;
      const d2 = ox * ox + oy * oy;
      if (d2 > radius * radius) continue;
      const px = Math.floor(x + ox) + 0.5;
      const py = Math.floor(y + oy) + 0.5;
      if (!walkable(state, side, px, py) || insideWalls(state, px, py) !== inside) continue;
      const v = score(px, py) - distCost * Math.sqrt(d2);
      if (v > best + 1e-9) {
        best = v;
        bx = px;
        by = py;
      }
    }
  return [bx, by];
}

/** Nearest walkable point to (x, y) for `side` (spiral search), or (x, y) itself. */
export function nearestWalkable(state: BattleState, side: SideIdx, x: number, y: number, maxR = 8): [number, number] {
  if (walkable(state, side, x, y)) return [x, y];
  for (let r = 1; r <= maxR; r++)
    for (let oy = -r; oy <= r; oy++)
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        const px = Math.floor(x + ox) + 0.5;
        const py = Math.floor(y + oy) + 0.5;
        if (walkable(state, side, px, py)) return [px, py];
      }
  return [x, y];
}

/** Seconds a squad needs to reach its extraction zone running (retreat field / speed). */
export function timeToSafety(state: BattleState, s: BSquad): number {
  const f = state.sides[s.side].retreatField[tileOf(state, s.x, s.y)]!;
  if (!Number.isFinite(f)) return 999;
  const t = state.data.t;
  const load = s.loot > 0 ? 1 - t.loadSpeedPenalty * Math.min(1, s.loot / Math.max(1, s.men * t.carryValuePerMan)) : 1;
  return f / Math.max(0.1, s.unit.speed * t.runSpeedMult * load);
}

/** Carrying capacity of a squad (silver value). */
export function carryCap(state: BattleState, s: BSquad): number {
  return s.men * state.data.t.carryValuePerMan;
}

/**
 * Per-man fighting worth of a squad, opponent-free (atk_eff + def_eff + 0.6 × ranged, §31.11 shape):
 * equipment, Command, veterancy, the leader's melee/defence and the current formation's defence.
 */
export function perManWorth(state: BattleState, s: BSquad): number {
  const side = state.sides[s.side];
  const bal = state.data.b;
  const lead = s.leaderPresent && s.leader ? s.leader : null;
  const common = (1 + bal.commandBonus * (lead?.command ?? 0)) * (1 + bal.veterancyBonus * s.vet);
  const meleeSkill = lead ? 1 + state.data.balance.character.skillEffects.meleeSquadAtk * lead.melee : 1;
  const atk = s.unit.atk * side.weaponMult * common * meleeSkill * side.omenAtk;
  const def = s.unit.def * side.armourMult * common * formationDef(bal, s.formation, s.unit) * (lead ? 1 + lead.defPct / 100 : 1);
  const rng = s.unit.rangedAtk * side.weaponMult * (1 + bal.ranged.leaderArcheryBonus * (lead?.archery ?? 0));
  return atk + def + state.data.balance.autoresolve.rangedWeight * rng;
}

/** Men a squad fights as (a single beast fights as its hit points in men). */
export function fightingMen(state: BattleState, s: BSquad): number {
  if (s.unit.single) return Math.max(0, s.hp) / state.data.t.singleHpPerMan;
  return Math.max(0, s.men);
}

/** Combat value now: men × worth × morale/60 (routing squads count a third, non-combatants nothing). */
export function combatValue(state: BattleState, s: BSquad, worth: number): number {
  if (s.unit.nonCombatant || !onField(s)) return 0;
  const m = Math.max(5, s.morale) / state.data.balance.autoresolve.moraleDivisor;
  return fightingMen(state, s) * worth * m * (s.status === 'routing' ? 0.3 : 1);
}

/** Centre of the side's deployment posts (where it came from: its rear). */
export function homeOf(state: BattleState, side: SideIdx): [number, number] {
  const posts = state.map.deploy[side];
  if (posts.length === 0) return [state.map.w / 2, side === 0 ? state.map.h - 4 : 4];
  let x = 0;
  let y = 0;
  for (const p of posts) {
    x += p.x;
    y += p.y;
  }
  return [x / posts.length, y / posts.length];
}

/** Unit vector from (ax, ay) toward (bx, by), or (0, −1) when they coincide. */
export function dirTo(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  return d < 1e-6 ? [0, -1] : [dx / d, dy / d];
}

/** Euclidean distance between centres. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}
