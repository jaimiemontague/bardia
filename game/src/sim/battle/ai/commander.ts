/**
 * Commander layer (§13.7, §18.10): every `balance.battle.commanderReplanS` seconds the side picks a
 * plan — Hold, Defend-in-depth, Counterattack, Encircle or Withdraw — from the force ratio, the
 * ground under its squads and its mission, with a little seeded noise (scaled down by coordination)
 * and hysteresis; then gives every squad a role and, where the plan wants one, a post (anchor).
 * Counterattack and Encircle first form up on a line short of the enemy when the side is
 * coordinated enough, then go in together.
 */
import { clamp, dlog } from '@sim/core/dmath';
import { onField } from '../engine/geometry';
import type { BattleOrder, BattleState, BSquad } from '../engine/types';
import { PLAN_KINDS, type Brain, type PlanKind } from './brain';
import { bestSpotNear, groundScore, nearestWalkable } from './geo';

/** Squads the commander directs: own, active, fighting men. */
export function commandable(state: BattleState, b: Brain): BSquad[] {
  const out: BSquad[] = [];
  for (const s of state.squads) if (s.side === b.side && s.status === 'active' && !s.retreating && !s.unit.nonCombatant) out.push(s);
  return out;
}

function isMobile(b: Brain, s: BSquad): boolean {
  return !s.unit.hasRanged && !s.isChief && !s.unit.single && (s.unit.cavalry || s.unit.speed >= b.t.commander.mobileSpeed);
}

/** Whether the side may leave the field when beaten (a garrison fights for its home; beasts and guardians hold). */
function canWithdraw(b: Brain): boolean {
  return b.mission !== 'garrison' && b.mission !== 'guard' && b.mission !== 'protect';
}

/** The plan utilities for this moment (before noise and hysteresis). */
export function planUtilities(state: BattleState, b: Brain, own: readonly BSquad[]): Record<PlanKind, number> {
  const c = b.t.commander;
  const p = b.pic;
  const u: Record<PlanKind, number> = { hold: -Infinity, defendInDepth: -Infinity, counterattack: -Infinity, encircle: -Infinity, withdraw: -Infinity };
  if (own.length === 0) return u;
  const lr = clamp(dlog(Math.max(0.05, p.forceRatio) / c.attackRatio), -1.2, 1.2);
  let ground = 0;
  for (const s of own) ground += groundScore(state, s.x, s.y, s.unit.hasRanged);
  ground /= own.length;
  p.ground = ground;
  const attacker = b.side === 0;
  const now = state.timeS;

  u.counterattack = 0.5 + 0.9 * lr - b.boldness + (attacker ? c.attackerAggression : 0) + 1.2 * p.enemyRouting;
  // Holding is for the weaker side on good ground; an attacker came to fight and cannot wait long.
  const holdBase = 0.5 - 0.8 * lr + b.boldness + c.terrainBonus * ground;
  const attackerMustGo = attacker && (b.mission === 'field' || b.mission === 'storm') && now >= c.attackerHoldMaxS;
  if (!attackerMustGo && b.mission !== 'raid' && b.mission !== 'seize') u.hold = holdBase;
  if (!attacker) u.defendInDepth = holdBase + (b.mission === 'garrison' || b.mission === 'guard' || b.mission === 'protect' ? 0.35 : -0.15);
  // Encircle: enough squads, someone fast, and the coordination to time it; never through walls.
  let mobile = 0;
  for (const s of own) if (isMobile(b, s)) mobile++;
  const walled = state.gates.length > 0 && (b.mission === 'storm' || b.mission === 'garrison');
  if (own.length >= c.encircleMinSquads && mobile > 0 && mobile < own.length && b.coordination >= c.encircleMinCoordination && !walled && p.forceRatio >= 0.8) {
    u.encircle = u.counterattack + c.encircleBonus + 0.08 * Math.min(3, mobile) + 0.2 * (b.coordination - c.encircleMinCoordination);
  }
  if (canWithdraw(b) && p.forceRatio < c.withdrawRatio && p.lossShare >= c.withdrawLossShare) {
    u.withdraw = 1.5 + 2 * (c.withdrawRatio - p.forceRatio) / c.withdrawRatio;
  }
  return u;
}

/** Picks a plan (utilities + Gumbel noise scaled by coordination + hysteresis) and reassigns roles. */
export function replan(state: BattleState, b: Brain, issue: (o: BattleOrder) => string | null): void {
  const own = commandable(state, b);
  const u = planUtilities(state, b, own);
  const c = b.t.commander;
  const temp = c.planNoise * (1 - 0.5 * b.coordination);
  let best: PlanKind = b.plan;
  let bestV = -Infinity;
  for (const k of PLAN_KINDS) {
    if (!Number.isFinite(u[k])) continue;
    // One draw per finite option, in a fixed order (deterministic).
    const v = u[k] + (k === b.plan ? c.planInertia : 0) + (temp > 0 ? b.rng.gumbel(temp) : 0);
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  if (!Number.isFinite(bestV)) return;
  const changed = best !== b.plan;
  if (changed || b.history.length === 0) {
    b.history.push({ t: state.timeS, plan: best, forceRatio: b.pic.forceRatio, utilities: { ...u } });
    if (b.history.length > 64) b.history.shift();
  }
  if (changed) {
    b.plan = best;
    b.planSinceT = state.timeS;
    b.phase = 'form';
  }
  if (best === 'withdraw') {
    if (!state.sides[b.side].retreatAll) issue({ kind: 'retreatAll' });
    return;
  }
  if ((best === 'counterattack' || best === 'encircle') && changed) {
    const formable = b.coordination >= 0.45 && b.pic.enemyDist > c.stagingDistTiles + 10 && b.mission !== 'raid' && b.mission !== 'seize' && b.mission !== 'garrison';
    b.phase = formable ? 'form' : 'go';
  }
  assignRoles(state, b, own);
}

/** Moves the plan from forming up to going in once enough squads stand on the line (or time is up). */
export function updatePhase(state: BattleState, b: Brain, own: readonly BSquad[]): void {
  if (b.phase !== 'form' || (b.plan !== 'counterattack' && b.plan !== 'encircle')) return;
  const c = b.t.commander;
  let total = 0;
  let there = 0;
  let threatened = false;
  const vis = state.sides[b.side].visible;
  for (const s of own) {
    if (!b.anchored[s.idx]) continue;
    total++;
    const dx = s.x - b.anchorX[s.idx]!;
    const dy = s.y - b.anchorY[s.idx]!;
    if (dx * dx + dy * dy <= 3.5 * 3.5) there++;
    for (const o of state.squads)
      if (o.side !== b.side && vis[o.idx] === 1 && o.status === 'active' && Math.abs(o.x - s.x) + Math.abs(o.y - s.y) < 12) threatened = true;
  }
  if (threatened || total === 0 || there >= c.stagingShare * total || state.timeS - b.planSinceT >= c.stagingWaitS) {
    b.phase = 'go';
    assignRoles(state, b, own);
  }
}

/** Roles and posts for the plan in force. */
export function assignRoles(state: BattleState, b: Brain, own: readonly BSquad[]): void {
  const p = b.pic;
  const c = b.t.commander;
  for (const s of own) b.anchored[s.idx] = 0;
  const melee: BSquad[] = [];
  const ranged: BSquad[] = [];
  let chief: BSquad | null = null;
  for (const s of own) {
    if (s.unit.hasRanged && !s.unit.cavalry) {
      b.role[s.idx] = 'ranged';
      ranged.push(s);
    } else if (s.isChief) {
      b.role[s.idx] = 'chief';
      chief = s;
    } else {
      b.role[s.idx] = 'line';
      melee.push(s);
    }
  }
  const anchor = (s: BSquad, x: number, y: number) => {
    const [wx, wy] = nearestWalkable(state, b.side, x, y);
    b.anchored[s.idx] = 1;
    b.anchorX[s.idx] = wx;
    b.anchorY[s.idx] = wy;
  };
  const settled = b.mission === 'garrison' || b.mission === 'guard' || b.mission === 'protect';
  // The chief commits when the side is clearly winning or has little else; otherwise he stays back.
  const chiefCommits = chief !== null && (own.length <= 2 || ((b.plan === 'counterattack' || b.plan === 'encircle') && p.forceRatio >= 1.3));
  if (chief && chiefCommits) {
    b.role[chief.idx] = 'line';
    melee.push(chief);
  }
  // Lateral order across the axis (left to right as seen from our side).
  const lateral = (s: BSquad) => (s.x - p.ownX) * p.px + (s.y - p.ownY) * p.py;
  melee.sort((x, y) => lateral(x) - lateral(y) || x.idx - y.idx);
  ranged.sort((x, y) => lateral(x) - lateral(y) || x.idx - y.idx);

  switch (b.plan) {
    case 'hold': {
      for (const s of melee) {
        const [x, y] = bestSpotNear(state, b.side, s.x, s.y, 6, (px, py) => groundScore(state, px, py, false));
        anchor(s, x, y);
      }
      for (const s of ranged) {
        const [x, y] = bestSpotNear(state, b.side, s.x, s.y, 6, (px, py) => groundScore(state, px, py, true));
        anchor(s, x, y);
      }
      if (chief && !chiefCommits) anchor(chief, p.ownX - p.ax * 6, p.ownY - p.ay * 6);
      break;
    }
    case 'defendInDepth': {
      if (settled) {
        // Posts from the guard plan (where each squad stood at the start); the reserve stays by the chief.
        for (const s of own) anchor(s, b.postX[s.idx]!, b.postY[s.idx]!);
        const reserve = melee.filter((s) => s !== chief).sort((x, y) => b.cv[y.idx]! - b.cv[x.idx]! || x.idx - y.idx)[0];
        if (reserve && chief && melee.length >= 3) {
          b.role[reserve.idx] = 'reserve';
          anchor(reserve, b.postX[chief.idx]! - p.ax * 3, b.postY[chief.idx]! - p.ay * 3);
        }
        break;
      }
      // Open ground: the front half holds, the rest stand a line behind.
      const byFront = [...melee].sort((x, y) => (y.x - p.ownX) * p.ax + (y.y - p.ownY) * p.ay - ((x.x - p.ownX) * p.ax + (x.y - p.ownY) * p.ay) || x.idx - y.idx);
      const front = Math.max(1, Math.ceil(byFront.length / 2));
      byFront.forEach((s, k) => {
        if (k < front) {
          const [x, y] = bestSpotNear(state, b.side, s.x, s.y, 5, (px, py) => groundScore(state, px, py, false));
          anchor(s, x, y);
        } else {
          b.role[s.idx] = 'reserve';
          anchor(s, s.x - p.ax * c.depthTiles * 0.5, s.y - p.ay * c.depthTiles * 0.5);
        }
      });
      for (const s of ranged) {
        const [x, y] = bestSpotNear(state, b.side, s.x, s.y, 6, (px, py) => groundScore(state, px, py, true));
        anchor(s, x, y);
      }
      if (chief && !chiefCommits) anchor(chief, p.ownX - p.ax * c.depthTiles, p.ownY - p.ay * c.depthTiles);
      break;
    }
    case 'counterattack':
    case 'encircle': {
      const flankers: BSquad[] = [];
      const line: BSquad[] = [];
      for (const s of melee) (b.plan === 'encircle' && isMobile(b, s) ? flankers : line).push(s);
      if (b.plan === 'encircle' && line.length === 0 && flankers.length > 0) line.push(flankers.shift()!);
      // Flankers circle wide of the enemy's ends (alternately left and right) until they get there.
      flankers.forEach((s, k) => {
        const sign = k % 2 === 0 ? (lateral(s) <= 0 ? -1 : 1) : lateral(s) <= 0 ? 1 : -1;
        b.role[s.idx] = sign < 0 ? 'flankL' : 'flankR';
        const off = p.enemySpread + c.flankOffsetTiles;
        const x = p.enemyX + p.px * off * sign - p.ax * 3;
        const y = p.enemyY + p.py * off * sign - p.ay * 3;
        anchor(s, x, y);
      });
      if (b.phase === 'form') {
        // Forming-up line short of the enemy, squads in their current left-to-right order.
        const d = Math.max(0, p.enemyDist - c.stagingDistTiles);
        const cx = p.ownX + p.ax * d;
        const cy = p.ownY + p.ay * d;
        const widths = line.map((s) => s.hw * 2 + 2);
        const total = widths.reduce((a, w) => a + w, 0);
        let off = -total / 2;
        line.forEach((s, k) => {
          const lat = off + widths[k]! / 2;
          off += widths[k]!;
          anchor(s, cx + p.px * lat, cy + p.py * lat);
        });
        const rw = ranged.map((s) => s.hw * 2 + 2);
        const rt = rw.reduce((a, w) => a + w, 0);
        let roff = -rt / 2;
        ranged.forEach((s, k) => {
          const lat = roff + rw[k]! / 2;
          roff += rw[k]!;
          anchor(s, cx - p.ax * 5 + p.px * lat, cy - p.ay * 5 + p.py * lat);
        });
      }
      if (chief && !chiefCommits) anchor(chief, p.ownX - p.ax * c.depthTiles * 0.6, p.ownY - p.ay * c.depthTiles * 0.6);
      break;
    }
    case 'withdraw':
      break;
  }
}

/** True when the chief's squad is on the field. */
export function chiefOf(state: BattleState, b: Brain): BSquad | null {
  const i = state.sides[b.side].chiefIdx;
  const s = i >= 0 ? state.squads[i] : undefined;
  return s && onField(s) ? s : null;
}
