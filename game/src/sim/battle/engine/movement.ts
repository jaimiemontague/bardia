/**
 * Movement: the path-search queue (budgeted per tick), path following with direct approach when the
 * way is clear, retreat/rout descent on the distance field to the extraction zone, facing, local
 * separation between squads, escapes, and render figures following their formation slots.
 */
import { formationSpeed } from '../formulas';
import { S, Z } from '../map/grid';
import { lineClear, PathStatus, smoothPath } from '../path';
import { tileSpeed } from './costs';
import { drivePaces, driveSquad, drivesAway } from './drive';
import { emit } from './events';
import { angleOf, figureSlots, gapBetween, gapToPoint, onField, slotWorld, turnToward } from './geometry';
import { requestPath } from './orders';
import { shotRange } from './sense';
import type { BattleState, BSquad } from './types';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const tmpPath: number[] = [];
const tmpSlots: number[] = [];

/** Tile index under a point (clamped to the map). */
export function tileOf(state: BattleState, x: number, y: number): number {
  const w = state.map.w;
  const tx = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(state.map.h - 1, Math.max(0, Math.floor(y)));
  return ty * w + tx;
}

/** Where the squad's current task wants it to go (or null when it should stand). */
export function taskGoal(state: BattleState, s: BSquad): [number, number] | null {
  const t = s.task;
  switch (t.kind) {
    case 'attack': {
      const target = state.squads[t.target];
      if (!target || !onField(target)) return null;
      return [target.x, target.y];
    }
    case 'move':
    case 'loot':
    case 'torch':
    case 'douse':
    case 'gate':
    case 'volley':
      return [t.x, t.y];
    default:
      return null;
  }
}

/** Runs queued path searches within the per-tick budget. */
export function processPaths(state: BattleState): void {
  let budget = state.data.t.maxPathSearchesPerTick;
  const q = state.pathQueue;
  while (budget > 0 && q.length > 0) {
    const s = state.squads[q.shift()!]!;
    if (!s.pathPending) continue;
    s.pathPending = false;
    const goal = taskGoal(state, s);
    if (!goal || !onField(s)) continue;
    const side = state.sides[s.side];
    const start = tileOf(state, s.x, s.y);
    const g = tileOf(state, goal[0], goal[1]);
    const status = state.pg.findPath(side.cost, start, g, tmpPath, side.minCost, 8000);
    s.path = status === PathStatus.None ? [] : smoothPath(side.cost, state.map.w, start, tmpPath);
    s.pathPos = 0;
    s.pathGoal = g;
    s.repathT = state.data.t.repathIntervalS;
    budget--;
  }
}

/** Movement speed (tiles/s) of a squad on its current tile. */
export function squadSpeed(state: BattleState, s: BSquad, running: boolean): number {
  const t = state.data.t;
  const side = state.sides[s.side];
  let v = s.unit.speed * formationSpeed(state.data.b, s.formation) * tileSpeed(state, side, tileOf(state, s.x, s.y));
  if (running) v *= t.runSpeedMult;
  if (s.loot > 0) {
    const cap = Math.max(1, s.men * t.carryValuePerMan);
    v *= 1 - t.loadSpeedPenalty * Math.min(1, s.loot / cap);
  }
  if (s.unformedT > 0) v *= t.asleep.unformedMult;
  return v;
}

/**
 * Moves toward (gx, gy) by up to `step` tiles; returns the distance moved. A step that would end on
 * a blocked tile slides along the blocking edge (x or y alone) instead, so a squad cutting a
 * corner of a house never sticks; a squad standing on a blocked tile may always step off it.
 */
function stepToward(state: BattleState, s: BSquad, gx: number, gy: number, step: number, desperate: boolean): number {
  const dx = gx - s.x;
  const dy = gy - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return 0;
  const k = Math.min(1, step / d);
  const side = state.sides[s.side];
  const costs = desperate ? side.retreatCost : side.cost;
  const free = (x: number, y: number) => Number.isFinite(costs[tileOf(state, x, y)]!) || !Number.isFinite(costs[tileOf(state, s.x, s.y)]!);
  const nx = s.x + dx * k;
  const ny = s.y + dy * k;
  if (free(nx, ny)) {
    s.x = nx;
    s.y = ny;
    return d * k;
  }
  // Slide: keep the larger component first.
  const order = Math.abs(dx) >= Math.abs(dy) ? [0, 1] : [1, 0];
  for (const axis of order) {
    const sx = axis === 0 ? s.x + Math.sign(dx) * Math.min(Math.abs(dx), step) : s.x;
    const sy = axis === 1 ? s.y + Math.sign(dy) * Math.min(Math.abs(dy), step) : s.y;
    if ((sx !== s.x || sy !== s.y) && free(sx, sy)) {
      const m = Math.abs(sx - s.x) + Math.abs(sy - s.y);
      s.x = sx;
      s.y = sy;
      return m;
    }
  }
  return 0;
}

/** Follows the squad's path (or walks straight when the way is clear); returns true on arrival. */
function followPath(state: BattleState, s: BSquad, gx: number, gy: number, step: number): { moved: number; arrived: boolean } {
  const t = state.data.t;
  const side = state.sides[s.side];
  const w = state.map.w;
  const here = tileOf(state, s.x, s.y);
  const goal = tileOf(state, gx, gy);
  const dx = gx - s.x;
  const dy = gy - s.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= t.arriveRadiusTiles) return { moved: 0, arrived: true };
  // Direct approach when close and the straight line is clear and not slower.
  if (dist < 10 && (here === goal || lineClear(side.cost, w, here, goal, Math.max(side.cost[here]!, side.cost[goal]!) * 1.05))) {
    const moved = stepToward(state, s, gx, gy, step, false);
    if (moved === 0 && !s.pathPending) requestPath(state, s);
    return { moved, arrived: false };
  }
  if (s.pathPending) return { moved: 0, arrived: false };
  if (s.path.length === 0 || s.pathPos >= s.path.length) {
    if (s.repathT <= 0) requestPath(state, s);
    return { moved: 0, arrived: false };
  }
  let moved = 0;
  let left = step;
  while (left > 1e-6 && s.pathPos < s.path.length) {
    const wp = s.path[s.pathPos]!;
    const wx = (wp % w) + 0.5;
    const wy = Math.floor(wp / w) + 0.5;
    const last = s.pathPos === s.path.length - 1;
    const tx = last ? gx : wx;
    const ty = last ? gy : wy;
    const ddx = tx - s.x;
    const ddy = ty - s.y;
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dd <= (last ? t.arriveRadiusTiles : 0.3)) {
      s.pathPos++;
      continue;
    }
    const m = stepToward(state, s, tx, ty, left, false);
    if (m === 0) {
      requestPath(state, s);
      break;
    }
    moved += m;
    left -= m;
  }
  return { moved, arrived: false };
}

/** Descends the retreat field toward the extraction zone; returns the distance moved. */
function retreatStep(state: BattleState, s: BSquad, step: number): number {
  const side = state.sides[s.side];
  const field = side.retreatField;
  const map = state.map;
  const w = map.w;
  let moved = 0;
  let left = step;
  for (let guard = 0; guard < 4 && left > 1e-6; guard++) {
    const here = tileOf(state, s.x, s.y);
    let best = here;
    let bestV = field[here]!;
    const cx = here % w;
    const cy = (here - cx) / w;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k]!;
      const ny = cy + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
      const ni = ny * w + nx;
      if (k >= 4 && (!Number.isFinite(side.retreatCost[cy * w + nx]!) || !Number.isFinite(side.retreatCost[ny * w + cx]!))) continue;
      const v = field[ni]!;
      if (v < bestV - 1e-6) {
        bestV = v;
        best = ni;
      }
    }
    if (best === here) {
      // At a local minimum (inside the zone, or a tile the field does not reach): head for the
      // tile centre, or straight for the nearest map edge as a last resort.
      if (!Number.isFinite(field[here]!)) {
        const toLeft = s.x;
        const toRight = map.w - s.x;
        const toTop = s.y;
        const toBottom = map.h - s.y;
        const m = Math.min(toLeft, toRight, toTop, toBottom);
        const gx = m === toLeft ? -1 : m === toRight ? map.w + 1 : s.x;
        const gy = m === toTop ? -1 : m === toBottom ? map.h + 1 : s.y;
        const dx = gx - s.x;
        const dy = gy - s.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const k2 = Math.min(1, left / Math.max(d, 1e-6));
        s.x = Math.min(map.w - 0.01, Math.max(0.01, s.x + dx * k2));
        s.y = Math.min(map.h - 0.01, Math.max(0.01, s.y + dy * k2));
        moved += left;
      }
      break;
    }
    const bx = (best % w) + 0.5;
    const by = Math.floor(best / w) + 0.5;
    const m = stepToward(state, s, bx, by, left, true);
    if (m === 0) break;
    moved += m;
    left -= m;
  }
  return moved;
}

/** True when the squad stands in its side's extraction zone. */
export function inExtraction(state: BattleState, s: BSquad): boolean {
  const bit = s.side === 0 ? Z.extractA : Z.extractD;
  return (state.map.zone[tileOf(state, s.x, s.y)]! & bit) !== 0;
}

/** The squad leaves the field through its extraction zone (saved). */
export function escape(state: BattleState, s: BSquad): void {
  s.status = 'escaped';
  if (s.loot > 0) {
    if (s.side === 0) {
      state.sides[0].lootSecured += s.loot;
      emit(state, 'lootSecured', { squad: s, value: Math.round(s.loot) });
    }
    s.loot = 0;
  }
  emit(state, 'escaped', { squad: s });
  for (let k = 0; k < s.figN; k++) state.figures.alive[s.fig0 + k] = 0;
}

/** Moves every squad for one tick (does not resolve overlaps; see `separate`). */
export function moveSquads(state: BattleState): void {
  const dt = state.dt;
  const t = state.data.t;
  const turn = (t.turnRateDegPerS * Math.PI) / 180 * dt;
  drivePaces(state);
  for (const s of state.squads) {
    s.moving = false;
    s.running = false;
    if (s.status !== 'active' && s.status !== 'routing') continue;
    if (s.repathT > 0) s.repathT -= dt;
    const fleeing = s.status === 'routing' || s.retreating;
    if (fleeing) {
      const speed = squadSpeed(state, s, true);
      const ox = s.x;
      const oy = s.y;
      const moved = retreatStep(state, s, speed * dt);
      if (moved > 0) {
        s.moving = true;
        s.running = true;
        turnToward(s, angleOf(s.x - ox, s.y - oy), turn);
      }
      if (inExtraction(state, s)) escape(state, s);
      continue;
    }
    // Fighting squads hold their ground and face their foe.
    if (s.contacts !== 0) {
      const foe = state.squads[s.meleeTarget];
      if (foe) turnToward(s, angleOf(foe.x - s.x, foe.y - s.y), turn);
      if (s.task.kind === 'move' && s.task.run) {
        // A running move order breaks off from melee (taking blows as it goes).
      } else if (drivesAway(state, s)) {
        // So does a squad the player steers away from its foe.
      } else continue;
    }
    if (s.task.kind === 'drive') {
      driveSquad(state, s, turn);
      continue;
    }
    const goal = taskGoal(state, s);
    if (!goal) {
      // The foe it was sent against has left the field: stand and await orders.
      if (s.task.kind === 'attack') {
        s.task.kind = 'none';
        s.chargeArmed = false;
      }
      if (s.task.facing !== null) turnToward(s, s.task.facing, turn);
      continue;
    }
    const kind = s.task.kind;
    // Closing on the foe, a squad dresses its front toward him (not toward its last step), so its
    // facing — and with it the footprint's reach — does not swing as it meets him.
    let faceFoe = false;
    if (kind === 'attack') {
      const target = state.squads[s.task.target]!;
      const gap = gapBetween(s, target);
      if (gap <= t.meleeReachTiles * 0.5) {
        turnToward(s, angleOf(target.x - s.x, target.y - s.y), turn);
        continue;
      }
      // Measured between centres (the gap itself depends on the facing being decided).
      const cd = Math.sqrt((target.x - s.x) * (target.x - s.x) + (target.y - s.y) * (target.y - s.y));
      faceFoe = cd <= Math.max(s.hw, s.hd) + Math.max(target.hw, target.hd) + t.faceFoeTiles;
      // Re-plan when the target has drifted from the path's end.
      if (s.pathGoal >= 0 && s.repathT <= 0) {
        const gt = tileOf(state, target.x, target.y);
        if (gt !== s.pathGoal) requestPath(state, s);
      }
    }
    if (kind === 'volley' && gapToPoint(s, goal[0], goal[1]) <= shotRange(state, s, goal[0], goal[1])) {
      turnToward(s, angleOf(goal[0] - s.x, goal[1] - s.y), turn);
      continue;
    }
    const running = s.task.run || s.chargeArmed;
    const speed = squadSpeed(state, s, running);
    const ox = s.x;
    const oy = s.y;
    const r = followPath(state, s, goal[0], goal[1], speed * dt);
    if (r.moved > 0) {
      s.moving = true;
      s.running = running;
      if (s.chargeArmed) s.runDist += r.moved;
      const foe = faceFoe ? state.squads[s.task.target] : undefined;
      turnToward(s, foe ? angleOf(foe.x - s.x, foe.y - s.y) : angleOf(s.x - ox, s.y - oy), turn);
    } else if (s.chargeArmed) s.runDist = 0;
    if (r.arrived && kind === 'move') {
      if (s.waypoints.length >= 2) {
        const nx = s.waypoints.shift()!;
        const ny = s.waypoints.shift()!;
        s.task.x = nx;
        s.task.y = ny;
        s.path.length = 0;
        s.pathPos = 0;
        requestPath(state, s);
      } else {
        s.task.kind = 'none';
      }
    }
  }
}

/** Pushes overlapping squads apart (friends softly, enemies firmly) without entering blocked tiles. */
export function separate(state: BattleState): void {
  const sq = state.squads;
  for (let i = 0; i < sq.length; i++) {
    const a = sq[i]!;
    if (!onField(a)) continue;
    for (let j = i + 1; j < sq.length; j++) {
      const b = sq[j]!;
      if (!onField(b)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const far = a.hw + a.hd + b.hw + b.hd;
      if (dx * dx + dy * dy > far * far) continue;
      const gap = gapBetween(a, b);
      if (gap >= 0) continue;
      const friends = a.side === b.side;
      // Fleeing squads slip through friends, and push their way past enemies (taking blows while
      // in contact) — so Retreat to Ships can never be soft-locked by a body of men in the way.
      if (a.status === 'routing' || b.status === 'routing' || a.retreating || b.retreating) continue;
      const push = -gap * (friends ? 0.25 : 0.5);
      const d = Math.sqrt(dx * dx + dy * dy);
      const ux = d > 1e-6 ? dx / d : 1;
      const uy = d > 1e-6 ? dy / d : 0;
      // The squad that is fighting or standing gives less ground.
      const aw = a.contacts !== 0 || !a.moving ? 0.35 : 0.65;
      const bw = b.contacts !== 0 || !b.moving ? 0.35 : 0.65;
      const tot = aw + bw;
      nudge(state, a, -ux * push * (aw / tot) * 2, -uy * push * (aw / tot) * 2);
      nudge(state, b, ux * push * (bw / tot) * 2, uy * push * (bw / tot) * 2);
    }
  }
}

function nudge(state: BattleState, s: BSquad, dx: number, dy: number): void {
  const nx = Math.min(state.map.w - 0.05, Math.max(0.05, s.x + dx));
  const ny = Math.min(state.map.h - 0.05, Math.max(0.05, s.y + dy));
  const side = state.sides[s.side];
  const ti = tileOf(state, nx, ny);
  const c = s.status === 'routing' || s.retreating ? side.retreatCost[ti]! : side.cost[ti]!;
  if (!Number.isFinite(c)) return;
  s.x = nx;
  s.y = ny;
}

/** Number of figures a squad shows for its current men. */
export function aliveFigures(state: BattleState, s: BSquad): number {
  if (s.unit.single) return s.men > 0 ? 1 : 0;
  return Math.min(s.figN, Math.ceil(s.men / state.data.b.figureMen));
}

/** Figures chase their formation slots (render only; never feeds back into the simulation). */
export function updateFigures(state: BattleState): void {
  const f = state.figures;
  const map = state.map;
  const dt = state.dt;
  f.px.set(f.x);
  f.py.set(f.y);
  for (const s of state.squads) {
    const on = onField(s);
    const n = on ? aliveFigures(state, s) : 0;
    for (let k = n; k < s.figN; k++) f.alive[s.fig0 + k] = 0;
    if (!on || n === 0) continue;
    figureSlots(state.data, s, n, tmpSlots);
    const speed = Math.max(1.5, s.unit.speed * state.data.t.runSpeedMult) * state.data.t.figureFollowSpeedMult * dt;
    const scatter = s.status === 'routing' ? 0.8 : 0;
    for (let k = 0; k < n; k++) {
      const i = s.fig0 + k;
      let [tx, ty] = slotWorld(s, tmpSlots[2 * k]!, tmpSlots[2 * k + 1]!);
      if (scatter > 0) {
        const h = ((k * 2654435761) >>> 0) / 4294967296;
        tx += (h - 0.5) * scatter * 2;
        ty += (((k * 40503 + 7) % 97) / 97 - 0.5) * scatter * 2;
      }
      const ti = Math.min(map.h - 1, Math.max(0, Math.floor(ty))) * map.w + Math.min(map.w - 1, Math.max(0, Math.floor(tx)));
      const st = map.struct[ti]!;
      if (st !== S.none && st !== S.tower && !(st === S.gate && state.gates[map.structId[ti]!]?.broken)) {
        tx = s.x + (tx - s.x) * 0.35;
        ty = s.y + (ty - s.y) * 0.35;
      }
      if (f.alive[i] === 0) {
        f.alive[i] = 1;
        f.x[i] = f.px[i] = tx;
        f.y[i] = f.py[i] = ty;
        continue;
      }
      const dx = tx - f.x[i]!;
      const dy = ty - f.y[i]!;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 8) {
        f.x[i] = tx;
        f.y[i] = ty;
      } else if (d > 1e-4) {
        const m = Math.min(1, speed / d);
        f.x[i] = f.x[i]! + dx * m;
        f.y[i] = f.y[i]! + dy * m;
      }
    }
  }
}
