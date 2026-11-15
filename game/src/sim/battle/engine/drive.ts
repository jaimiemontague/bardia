/**
 * Direct control (owner play-test 2026-11-15): while the player holds W A S D the selected squads
 * walk that way in real time ("drive"), turning to face their road, and halt the moment the keys are
 * let go. The client sends one `drive` order per change of the held direction, never per frame, so
 * a drive is logged and replayed like any other order.
 *
 * - A drive replaces a squad's move/attack task; a later mouse order or ability replaces the drive.
 *   A stop (0, 0) halts only squads still driving, and they hold their ground: the stance does not
 *   send them off on its own until their next order.
 * - The squads of one drive keep their places relative to each other: each tick they all move at the
 *   pace of the slowest of them that is free to move (terrain included), so the line holds.
 * - Movement respects terrain costs and blocked tiles. Blocked head-on, a squad slips round the
 *   obstacle on the nearer side with a way through (within tunables.drive.slideProbeTiles, keeping
 *   the side it chose); on a diagonal it slides along the blocking edge. Against a long wall it stops.
 * - A driven squad that meets the enemy stands and fights; it breaks off only when the player steers
 *   it away from its foe (taking blows as it goes).
 *
 * Deterministic: state only, dmath for angles, no allocation in the per-tick path.
 */
import { clamp, dcos, PI } from '@sim/core/dmath';
import { angleOf, gapBetween, onField, turnToward } from './geometry';
import { setTask } from './orders';
import { squadSpeed, tileOf } from './movement';
import type { BattleState, BSquad } from './types';

/** Own speed of each driving squad this tick, and the group pace, by squad index (scratch). */
let ownPace = new Float64Array(64);
let groupPace = new Float64Array(64);

function driving(s: BSquad): boolean {
  return s.task.kind === 'drive' && s.status === 'active' && !s.retreating;
}

/** Starts (or stops, with 0, 0) a drive for squads that can take orders. */
export function applyDrive(state: BattleState, squads: readonly BSquad[], dx: number, dy: number, run: boolean): void {
  if (dx === 0 && dy === 0) {
    for (const s of squads) if (s.task.kind === 'drive') stopDrive(state, s);
    return;
  }
  const k = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  const ux = dx * k;
  const uy = dy * k;
  const face = angleOf(ux, uy);
  const group = ++state.driveSeq;
  for (const s of squads) {
    s.waypoints.length = 0;
    s.chargeArmed = false;
    s.retreating = false;
    setTask(state, s, 'drive', s.x, s.y, { facing: face, run });
    s.driveX = ux;
    s.driveY = uy;
    s.driveGroup = group;
  }
}

/** Halts a driven squad where it stands; it holds its ground until its next order. */
export function stopDrive(state: BattleState, s: BSquad): void {
  setTask(state, s, 'none', s.x, s.y, { facing: s.facing });
  s.driveX = 0;
  s.driveY = 0;
  s.driveGroup = -1;
  s.driveHeld = true;
}

/** Works out this tick's pace of every driving squad (the slowest free member of its group). */
export function drivePaces(state: BattleState): void {
  const sq = state.squads;
  if (ownPace.length < sq.length) {
    ownPace = new Float64Array(sq.length * 2);
    groupPace = new Float64Array(sq.length * 2);
  }
  const mult = state.data.t.drive.speedMult;
  let any = false;
  for (const s of sq) {
    if (!driving(s)) continue;
    any = true;
    ownPace[s.idx] = squadSpeed(state, s, s.task.run) * mult;
  }
  if (!any) return;
  for (const s of sq) {
    if (!driving(s)) continue;
    let p = ownPace[s.idx]!;
    for (const o of sq) {
      if (o === s || o.driveGroup !== s.driveGroup || !driving(o) || o.contacts !== 0) continue;
      if (ownPace[o.idx]! < p) p = ownPace[o.idx]!;
    }
    groupPace[s.idx] = p;
  }
}

/** True when a driven squad locked in melee is being steered away from its foe (it breaks off). */
export function drivesAway(state: BattleState, s: BSquad): boolean {
  if (s.task.kind !== 'drive') return false;
  const foe = state.squads[s.meleeTarget];
  if (!foe) return false;
  const dx = foe.x - s.x;
  const dy = foe.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return false;
  const cos = (s.driveX * dx + s.driveY * dy) / d;
  return cos < dcos((state.data.t.drive.breakOffDeg * PI) / 180);
}

function free(state: BattleState, s: BSquad, x: number, y: number): boolean {
  const cost = state.sides[s.side].cost;
  return Number.isFinite(cost[tileOf(state, x, y)]!) || !Number.isFinite(cost[tileOf(state, s.x, s.y)]!);
}

/** Tries to move by (mx, my) inside the map; returns the distance moved (0 when blocked). */
function tryMove(state: BattleState, s: BSquad, mx: number, my: number): number {
  const nx = clamp(s.x + mx, 0.5, state.map.w - 0.5);
  const ny = clamp(s.y + my, 0.5, state.map.h - 0.5);
  if ((nx === s.x && ny === s.y) || !free(state, s, nx, ny)) return 0;
  const dx = nx - s.x;
  const dy = ny - s.y;
  s.x = nx;
  s.y = ny;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Moves a squad `step` tiles along its drive direction; blocked, it slides along the edge (diagonal)
 * or slips past at 45° (head-on). Returns the distance moved.
 */
function driveMove(state: BattleState, s: BSquad, step: number): number {
  const ux = s.driveX;
  const uy = s.driveY;
  const m = tryMove(state, s, ux * step, uy * step);
  if (m > 0) return m;
  if (ux !== 0 && uy !== 0) {
    // Diagonal: keep whichever axis is open.
    const a = tryMove(state, s, ux * step, 0);
    if (a > 0) return a;
    return tryMove(state, s, 0, uy * step);
  }
  // Head-on: find the nearer side with a way through (the side chosen last time first), then slip
  // round at 45° or, hard against the obstacle, sideways.
  const probe = state.data.t.drive.slideProbeTiles;
  for (let k = 1; k <= probe; k++) {
    for (const side of [s.driveSlide, -s.driveSlide]) {
      const px = -uy * side;
      const py = ux * side;
      const lx = s.x + px * k;
      const ly = s.y + py * k;
      if (!free(state, s, lx, ly) || !free(state, s, lx + ux, ly + uy)) continue;
      s.driveSlide = side;
      const r = Math.SQRT1_2;
      const d = tryMove(state, s, (ux + px) * r * step, (uy + py) * r * step);
      return d > 0 ? d : tryMove(state, s, px * step, py * step);
    }
  }
  return 0;
}

/** One tick of a driven squad that is free to move (not locked in melee, or breaking off). */
export function driveSquad(state: BattleState, s: BSquad, turn: number): void {
  const step = groupPace[s.idx]! * state.dt;
  const moved = step > 0 ? driveMove(state, s, step) : 0;
  if (moved > 0) {
    s.moving = true;
    s.running = s.task.run;
  }
  turnToward(s, angleOf(s.driveX, s.driveY), turn * state.data.t.drive.turnRateMult);
}

/**
 * The nearest seen enemy in front of `s` (inside tunables.drive.chargeConeDeg around its facing and
 * within chargeRangeTiles), for a charge "ahead"; undefined when there is none.
 */
export function enemyAhead(state: BattleState, s: BSquad): BSquad | undefined {
  const c = state.data.t.drive;
  const cosHalf = dcos((c.chargeConeDeg * PI) / 360);
  const vis = state.sides[s.side].visible;
  let best: BSquad | undefined;
  let bestGap = c.chargeRangeTiles;
  for (const o of state.squads) {
    if (o.side === s.side || !onField(o) || vis[o.idx] !== 1) continue;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6 && (s.fx * dx + s.fy * dy) / d < cosHalf) continue;
    const g = gapBetween(s, o);
    if (g <= bestGap) {
      bestGap = g;
      best = o;
    }
  }
  return best;
}
