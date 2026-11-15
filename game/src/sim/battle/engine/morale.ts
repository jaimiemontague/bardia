/**
 * Morale (§31.10 per-second changes, waver/rout/rally), fatigue, whole-man casualties from the
 * fractional accumulators, squads wiped out, non-combatants surrendering, reinforcements arriving,
 * sleepers waking, and the per-squad timers (cooldowns, charge, frenzy, unformed).
 */
import { clamp } from '@sim/core/dmath';
import { moraleFromLosses } from '../formulas';
import { wake } from './combat';
import { pushCache } from './create';
import { emit } from './events';
import { distToRect, gapBetween, onField } from './geometry';
import { leaderRisk, playerDown, playerLosses } from './leaders';
import type { BattleState, BSquad } from './types';

function tileOf(state: BattleState, x: number, y: number): number {
  const m = state.map;
  return Math.min(m.h - 1, Math.max(0, Math.floor(y))) * m.w + Math.min(m.w - 1, Math.max(0, Math.floor(x)));
}

/** Counts down cooldowns and effect timers. */
export function updateTimers(state: BattleState): void {
  const dt = state.dt;
  const bal = state.data.b;
  for (const s of state.squads) {
    if (s.status === 'reserve' || s.status === 'escaped' || s.status === 'destroyed' || s.status === 'surrendered') continue;
    for (let k = 0; k < s.cooldowns.length; k++) if (s.cooldowns[k]! > 0) s.cooldowns[k] = Math.max(0, s.cooldowns[k]! - dt);
    if (s.chargeT > 0) s.chargeT = Math.max(0, s.chargeT - dt);
    if (s.chargeBlockedT > 0) s.chargeBlockedT = Math.max(0, s.chargeBlockedT - dt);
    if (s.unformedT > 0) s.unformedT = Math.max(0, s.unformedT - dt);
    if (s.frenzyT > 0) {
      s.frenzyT -= dt;
      if (s.frenzyT <= 0) {
        s.frenzyT = 0;
        s.stamina = Math.min(s.stamina, bal.fatigue.afterFrenzy);
      }
    }
    s.quietT += dt;
  }
}

/** Raid waves (and any other reserves) march onto the field when their time comes. */
export function arrivals(state: BattleState): void {
  for (const s of state.squads) {
    if (s.status !== 'reserve' || s.arrivalT > state.timeS) continue;
    s.status = 'active';
    s.px = s.x;
    s.py = s.y;
    emit(state, 'reinforcements', { squad: s });
  }
}

/** Sleepers wake on an enemy close by, a fire close by, or some time after the alarm. */
export function wakeSleepers(state: BattleState): void {
  const a = state.data.t.asleep;
  for (const s of state.squads) {
    if (s.status !== 'asleep') continue;
    let wakeUp = state.alarmT >= 0 && state.timeS >= state.alarmT + a.wakeS;
    if (!wakeUp)
      for (const o of state.squads) {
        if (o.side === s.side || (o.status !== 'active' && o.status !== 'routing')) continue;
        if (gapBetween(s, o) <= a.alertRadiusTiles) {
          wakeUp = true;
          break;
        }
      }
    if (!wakeUp)
      for (const b of state.buildings) {
        if (b.burning && distToRect(s.x, s.y, b.x, b.y, b.w, b.h) <= a.alertRadiusTiles) {
          wakeUp = true;
          break;
        }
      }
    if (wakeUp) wake(state, s);
  }
}

/** Leaves a squad's carried loot on the ground as a cache. */
function dropLoot(state: BattleState, s: BSquad): void {
  if (s.loot <= 0) return;
  const value = s.loot;
  s.loot = 0;
  const c = pushCache(state, s.x, s.y, value, -1, false);
  emit(state, 'lootDropped', { squad: s, target: state.caches[c]!.id, value: Math.round(value) });
}

/** Morale hit for friends near a squad that broke. */
function adjacentRout(state: BattleState, s: BSquad): void {
  const r = state.data.t.adjacentRadiusTiles;
  const delta = state.data.b.morale.adjacentRout;
  for (const o of state.squads) {
    if (o === s || o.side !== s.side || o.status !== 'active') continue;
    if (gapBetween(s, o) <= r && o.frenzyT <= 0) o.morale = clamp(o.morale + delta, 0, 100);
  }
}

/** A squad breaks and flees (§31.10 rout below 12). */
export function rout(state: BattleState, s: BSquad): void {
  if (s.status !== 'active' && s.status !== 'asleep') return;
  s.status = 'routing';
  s.chargeArmed = false;
  s.task.kind = 'none';
  s.waypoints.length = 0;
  s.hidden = false;
  dropLoot(state, s);
  emit(state, 'routed', { squad: s });
  adjacentRout(state, s);
  leaderRisk(state, s, false);
  s.routedOnce = true;
}

function destroy(state: BattleState, s: BSquad): void {
  const wasOnField = onField(s);
  s.status = 'destroyed';
  s.men = 0;
  dropLoot(state, s);
  emit(state, 'destroyed', { squad: s });
  if (wasOnField) adjacentRout(state, s);
  if (s.isPlayer) playerDown(state, s);
  else leaderRisk(state, s, true);
  for (let k = 0; k < s.figN; k++) state.figures.alive[s.fig0 + k] = 0;
}

/** Non-combatants (monks) give up as soon as an enemy reaches them. */
function surrender(state: BattleState, s: BSquad): void {
  s.status = 'surrendered';
  s.surrenderedMen += s.men;
  dropLoot(state, s);
  emit(state, 'surrendered', { squad: s });
  for (let k = 0; k < s.figN; k++) state.figures.alive[s.fig0 + k] = 0;
}

/** Turns fractional casualties into whole men (and beast HP), wounds the player, wipes squads out. */
export function applyCasualties(state: BattleState): void {
  const t = state.data.t;
  for (const s of state.squads) {
    if (!onField(s)) {
      s.casAcc = 0;
      continue;
    }
    if (s.unit.single) {
      if (s.casAcc > 0) {
        s.hp -= s.casAcc * t.singleHpPerMan;
        s.casAcc = 0;
        if (s.hp <= 0) {
          s.hp = 0;
          s.lost += s.men;
          s.men = 0;
        }
      }
    } else if (s.casAcc >= 1) {
      const whole = Math.min(s.men, Math.floor(s.casAcc));
      s.casAcc -= whole;
      s.men -= whole;
      s.lost += whole;
      if (whole > 0) playerLosses(state, s, whole);
    }
    if (s.men <= 0) destroy(state, s);
  }
}

/** Per-second morale changes, rout, rally and surrender. */
export function updateMorale(state: BattleState): void {
  const dt = state.dt;
  const bal = state.data.b;
  const m = bal.morale;
  const t = state.data.t;
  const safe2 = t.safeRadiusTiles;
  for (const s of state.squads) {
    if (!onField(s)) {
      s.casTick = 0;
      continue;
    }
    const frenzied = s.frenzyT > 0;
    let delta = 0;
    if (s.casTick > 0) {
      const lossMen = s.unit.single ? (s.casTick * t.singleHpPerMan) / Math.max(1, s.hpMax) : s.casTick / Math.max(1, s.startMen);
      delta += s.unit.single ? m.lossesMult * lossMen : moraleFromLosses(bal, s.casTick, s.startMen);
    }
    s.casTick = 0;
    if (state.smoke[tileOf(state, s.x, s.y)] === 1) delta += m.fireNearbyPerS * dt;
    if (s.contacts !== 0) {
      for (const o of state.squads) if ((s.contacts & (1 << o.idx)) !== 0 && o.unit.abilities.includes('frenzy')) delta += m.berserkersContactPerS * dt;
    }
    if (frenzied && delta < 0) delta = 0;
    // Recovery when safe: no contact, no recent blows, no seen enemy within the safe radius.
    let safe = s.contacts === 0 && s.quietT >= 2;
    if (safe) {
      const vis = state.sides[s.side].visible;
      for (const o of state.squads) {
        if (o.side === s.side || o.status !== 'active' || vis[o.idx] !== 1) continue;
        if (gapBetween(s, o) <= safe2) {
          safe = false;
          break;
        }
      }
    }
    if (safe && s.morale < s.moraleStart) delta += Math.min(m.recoveryPerS * dt, s.moraleStart - s.morale);
    s.morale = clamp(s.morale + delta, 0, 100);

    if (s.unit.nonCombatant && s.contacts !== 0) {
      surrender(state, s);
      continue;
    }
    if (s.status === 'active' || s.status === 'asleep') {
      const beastFlees = s.unit.single && s.unit.fleeAtHpPct > 0 && s.hp <= s.unit.fleeAtHpPct * s.hpMax;
      const holdsFast = s.unit.neverRoutWhileObjective && !state.objectiveBreached;
      if (beastFlees || (s.morale < bal.routAt && !holdsFast)) {
        if (beastFlees) s.morale = 0;
        rout(state, s);
      }
    } else if (s.status === 'routing') {
      const leaderOk = s.unnamed || s.leaderPresent;
      const beast = s.unit.single && s.unit.fleeAtHpPct > 0;
      if (safe && leaderOk && !beast && s.morale >= bal.rallyAt) {
        s.status = 'active';
        s.task.kind = 'none';
        s.retreating = false;
        emit(state, 'rallied', { squad: s });
      }
    }
  }
}

/** Stamina: running −2/s, fighting −1.5/s, walking −0.5/s, resting +2/s. */
export function updateFatigue(state: BattleState): void {
  const f = state.data.b.fatigue;
  const dt = state.dt;
  for (const s of state.squads) {
    if (!onField(s)) continue;
    let rate: number;
    if (s.fighting) rate = f.fightingPerS;
    else if (s.running) rate = f.runningPerS;
    else if (s.moving) rate = f.walkingPerS;
    else rate = f.restingPerS;
    s.stamina = clamp(s.stamina + rate * dt, 0, f.max);
  }
}
