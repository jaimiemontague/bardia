/**
 * Sea-battle AI (design §15.3) and fleet orders (§15.2).
 *
 * - Side level (every replan): merchants flee from the start; patrols retreat at 50 % crew losses;
 *   other fleets retreat when outnumbered 2:1 (fighting strength).
 * - Ship level: flee below 30 % hull or crew, when routed or when the side retreats; galleys charge
 *   with the ram and close for the sea-fire siphon; board with a deck-power advantage; otherwise
 *   keep archery range, biased upwind. Struck enemies are taken when nothing else is left.
 * - The player's other ships follow orders: Follow, Attack target, Screen, Hold, Board target.
 * - Steering: desired heading → hazard/edge avoidance (look-ahead on the arena distance fields) →
 *   rudder; propulsion picks sail or oars by speed on that heading, close quarters and stamina.
 */
import { clamp, dcos, dsin, PI } from '@sim/core/dmath';
import { hazardDistance } from './arena';
import { boardingAdvantage, canGrapple, deckPower, deckSideOf, tryGrapple } from './boarding';
import { centerDist, isActive, nearestEnemy } from './combat';
import type { SeaShip, SeaWorld, SideIdx } from './engineTypes';
import { bearingOf, DEG, headingX, headingY, wrapPi } from './geom';
import { bestSpeedOn, crewOf, rowSpeed, sailSpeed, velX, velY } from './physics';

/** Fighting strength of a side's active ships (crew × quality × morale × hull condition). */
export function sideStrength(w: SeaWorld, side: SideIdx): number {
  let sum = 0;
  for (const s of w.ships) {
    if (s.side !== side || s.status !== 'active') continue;
    sum += crewOf(s) * (s.atkEff + s.defEff) * (s.morale / w.balance.boarding.moraleDivisor) * (0.5 + 0.5 * (s.hull / s.hullMax));
  }
  return sum;
}

/** Crew a side has lost so far (killed, wounded, captured), as a share of its starting crew. */
export function sideLossShare(w: SeaWorld, side: SideIdx): number {
  const st = w.sides[side];
  if (st.startCrew <= 0) return 0;
  let lost = 0;
  for (const s of w.ships) if (s.side === side) lost += s.startCrew - crewOf(s);
  return clamp(lost / st.startCrew, 0, 1);
}

/** Sounds the retreat for a side. */
export function soundRetreat(w: SeaWorld, side: SideIdx): void {
  const st = w.sides[side];
  if (st.retreating) return;
  st.retreating = true;
  st.retreatS = 0;
  for (const s of w.ships) if (s.side === side) s.replanT = 0;
  w.events.push({ t: w.timeS, kind: 'retreat', side });
}

/** Side-level decisions (§15.3 Run / Patrols / Merchants). The player's side decides for itself. */
export function updateSideAI(w: SeaWorld, side: SideIdx): void {
  const st = w.sides[side];
  if (st.retreating) return;
  if (st.isPlayer && !w.aiControlsPlayer) return;
  const ai = w.balance.seaBattle.ai;
  if (st.role === 'merchant') {
    soundRetreat(w, side);
    return;
  }
  if (st.role === 'patrol') {
    if (sideLossShare(w, side) >= ai.patrolLossPct) soundRetreat(w, side);
    return;
  }
  const own = sideStrength(w, side);
  const enemy = sideStrength(w, side === 0 ? 1 : 0);
  if (own <= 0 || enemy >= ai.outnumberedRatio * own) soundRetreat(w, side);
}

/** Should this ship run? */
function shouldFlee(w: SeaWorld, s: SeaShip): boolean {
  const st = w.sides[s.side];
  if (st.retreating || s.routed) return true;
  if (s.controller === 'orders' && s.order.kind === 'withdraw') return true;
  if (s.controller !== 'ai') return false;
  const run = w.balance.seaBattle.ai.runBelowPct;
  if (s.hull < run * s.hullMax) return true;
  return st.role !== 'patrol' && crewOf(s) < run * s.startCrew;
}

function validEnemy(w: SeaWorld, s: SeaShip, idx: number, allowStruck = false): boolean {
  const t = w.ships[idx];
  if (!t || t.side === s.side) return false;
  return t.status === 'active' || (allowStruck && t.status === 'struck');
}

/** Target choice: nearest enemy, preferring ships we can board, sticky to the current target. */
function chooseTarget(w: SeaWorld, s: SeaShip): number {
  const ai = w.t.ai;
  let best = -1;
  let bestScore = Infinity;
  let currentScore = Infinity;
  for (const t of w.ships) {
    if (t.side === s.side || t.status !== 'active') continue;
    let score = centerDist(s, t);
    if (boardingAdvantage(w, s, t) >= ai.boardAdvantage) score *= ai.boardTargetBias;
    if (t.routed) score *= 0.8;
    if (t.idx === s.goalTarget) currentScore = score;
    if (score < bestScore) {
      bestScore = score;
      best = t.idx;
    }
  }
  if (currentScore < Infinity && bestScore >= currentScore * ai.targetStickiness) return s.goalTarget;
  return best;
}

/** Picks a goal for an AI-controlled or order-following ship. */
export function planShip(w: SeaWorld, s: SeaShip): void {
  if (s.status !== 'active') return;
  if (s.grapple >= 0) {
    s.goal = 'grappled';
    return;
  }
  if (shouldFlee(w, s)) {
    if (s.goal !== 'flee' || w.tick % 20 === s.idx % 20) s.fleeHeading = fleeHeading(w, s);
    s.goal = 'flee';
    return;
  }
  if (s.controller === 'orders') {
    planOrders(w, s);
    return;
  }
  planFree(w, s);
}

function planFree(w: SeaWorld, s: SeaShip): void {
  const target = chooseTarget(w, s);
  if (target < 0) {
    const struck = nearestEnemy(w, s, (t) => t.status === 'struck');
    if (struck.idx >= 0) {
      s.goal = 'capture';
      s.goalTarget = struck.idx;
    } else {
      s.goal = 'idle';
      s.goalTarget = -1;
    }
    return;
  }
  s.goalTarget = target;
  const t = w.ships[target]!;
  const d = centerDist(s, t);
  const reachable = !s.deepDraft || hazardDistance(w.arena, t.x, t.y, true) > t.radius + s.radius + 6;
  const adv = s.regrappleCd <= 0 && reachable ? boardingAdvantage(w, s, t) : 0;
  const wavering = t.routed || t.morale < w.balance.battle.waverAt;
  if (!reachable) s.goal = 'range';
  else if (canRamNow(w, s, t, d)) s.goal = 'ram';
  else if (s.seaFire && s.siphonCharges > 0 && s.siphonCd <= 0 && d <= w.balance.seaBattle.seaFire.coneM * 5) s.goal = 'seaFire';
  else if (adv >= w.t.ai.boardAdvantage || (wavering && adv >= w.t.ai.boardWaveringAdvantage)) s.goal = 'board';
  else s.goal = 'range';
}

/** A galley charges with its ram only when ready, in range, and able to catch the target. */
function canRamNow(w: SeaWorld, s: SeaShip, t: SeaShip, d: number): boolean {
  if (!s.galley || s.ramCd > 0 || d > w.t.ai.ramRangeM || t.grapple >= 0) return false;
  if (d < 120) return true;
  const ux = (t.x - s.x) / Math.max(1e-6, d);
  const uy = (t.y - s.y) / Math.max(1e-6, d);
  const away = velX(t) * ux + velY(t) * uy;
  return away < w.t.ai.ramCatchRatio * rowSpeed(w, s);
}

function planOrders(w: SeaWorld, s: SeaShip): void {
  const side = w.sides[s.side];
  const flag = side.flagship >= 0 ? w.ships[side.flagship] : undefined;
  const flagOk = flag !== undefined && flag !== s && flag.status === 'active';
  switch (s.order.kind) {
    case 'follow':
      if (flagOk) {
        s.goal = 'follow';
        return;
      }
      break;
    case 'screen':
      if (flagOk) {
        s.goal = 'screen';
        return;
      }
      break;
    case 'hold':
      s.goal = 'hold';
      return;
    case 'attack':
      if (validEnemy(w, s, s.order.target)) {
        s.goalTarget = s.order.target;
        const t = w.ships[s.order.target]!;
        s.goal = canRamNow(w, s, t, centerDist(s, t)) ? 'ram' : 'range';
        return;
      }
      s.order = { kind: 'follow', target: -1 };
      break;
    case 'board':
      if (validEnemy(w, s, s.order.target, true)) {
        s.goalTarget = s.order.target;
        s.goal = w.ships[s.order.target]!.status === 'struck' ? 'capture' : 'board';
        return;
      }
      s.order = { kind: 'follow', target: -1 };
      break;
    case 'shoot':
      // Stand off at archery range: never rams or boards (a struck target is simply taken).
      if (validEnemy(w, s, s.order.target, true)) {
        s.goalTarget = s.order.target;
        s.goal = w.ships[s.order.target]!.status === 'struck' ? 'capture' : 'range';
        return;
      }
      s.order = { kind: 'follow', target: -1 };
      break;
    case 'move':
      if (s.order.x !== undefined && s.order.y !== undefined) {
        s.moveX = s.order.x;
        s.moveY = s.order.y;
        s.goal = 'moveTo';
        return;
      }
      s.order = { kind: 'hold', target: -1 };
      s.goal = 'hold';
      return;
    case 'withdraw':
      // shouldFlee already sent it running; nothing else to plan.
      break;
  }
  // No flagship to follow/screen (or the target is gone): fight on as a free captain.
  if (s.order.kind === 'follow' && flagOk) {
    s.goal = 'follow';
    return;
  }
  planFree(w, s);
}

/**
 * Flee direction: samples `fleeRays` headings, scoring speed on that heading, distance from the
 * enemies, a short clear run, and a near arena edge.
 */
export function fleeHeading(w: SeaWorld, s: SeaShip): number {
  let ax = 0;
  let ay = 0;
  for (const t of w.ships) {
    if (t.side === s.side || t.status !== 'active') continue;
    const dx = s.x - t.x;
    const dy = s.y - t.y;
    const d2 = Math.max(100, dx * dx + dy * dy);
    ax += dx / d2;
    ay += dy / d2;
  }
  const al = Math.sqrt(ax * ax + ay * ay);
  if (al > 0) {
    ax /= al;
    ay /= al;
  }
  const n = w.t.ai.fleeRays;
  const size = w.arena.sizeM;
  let best = s.h;
  let bestScore = -Infinity;
  const top = Math.max(0.1, s.rowMs, s.sailMs * 1.25);
  for (let k = 0; k < n; k++) {
    const h = (k / n) * 2 * PI;
    const hx = dsin(h);
    const hy = -dcos(h);
    let score = (bestSpeedOn(w, s, h) / top) * 1.0 + (hx * ax + hy * ay) * 1.2;
    // Distance to the edge along this heading, and whether the run there is clear water.
    const tx = hx > 1e-9 ? (size - s.x) / hx : hx < -1e-9 ? -s.x / hx : Infinity;
    const ty = hy > 1e-9 ? (size - s.y) / hy : hy < -1e-9 ? -s.y / hy : Infinity;
    const run = Math.min(tx, ty, size);
    for (let d = 40; d < run; d += 40) {
      if (hazardDistance(w.arena, s.x + hx * d, s.y + hy * d, s.deepDraft) < s.radius + 15) {
        score -= 1 + 2 * clamp(1 - d / 400, 0, 1);
        break;
      }
    }
    score += 0.6 * (1 - run / size);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Steering.

/** Sail or oars for a heading (AI choice; §31.2 auto-row and stamina management). */
function chooseProp(w: SeaWorld, s: SeaShip, heading: number, fine: boolean): void {
  if (fine) {
    s.propulsion = 'oars';
    return;
  }
  const row = rowSpeed(w, s);
  const sail = sailSpeed(w, s, heading);
  if (s.stamina < w.t.ai.restStamina && sail >= w.t.ai.sailIfStaminaRatio * row) s.propulsion = 'sail';
  else s.propulsion = sail >= row * w.balance.sailing.autoRowRatio ? 'sail' : 'oars';
}

function clearAhead(w: SeaWorld, s: SeaShip, h: number, look: number, allowExit: boolean): boolean {
  const hx = dsin(h);
  const hy = -dcos(h);
  const margin = s.radius + 12;
  const edge = w.t.physics.edgeAvoidM;
  const size = w.arena.sizeM;
  for (let k = 0; k <= 3; k++) {
    const f = k / 3;
    const px = s.x + hx * (k === 0 ? s.lengthM / 2 + 4 : look * f);
    const py = s.y + hy * (k === 0 ? s.lengthM / 2 + 4 : look * f);
    if (hazardDistance(w.arena, px, py, s.deepDraft) < margin) return false;
    if (!allowExit && (px < edge || py < edge || px > size - edge || py > size - edge)) {
      // Heading further out is blocked; heading back inside is always fine.
      const inward = (px < edge && hx > 0) || (px > size - edge && hx < 0) || (py < edge && hy > 0) || (py > size - edge && hy < 0);
      if (!inward) return false;
    }
  }
  return true;
}

/** Turns a desired heading into a safe one (look-ahead on hazards and the arena edge). */
function avoid(w: SeaWorld, s: SeaShip, desired: number, allowExit: boolean): number {
  const look = Math.max(60, Math.abs(s.v) * w.t.ai.lookaheadS) + s.lengthM / 2;
  if (clearAhead(w, s, desired, look, allowExit)) return desired;
  // Try headings 20°, 40°, … either side, first on the side the ship is already turning to.
  const first = wrapPi(desired - s.h) >= 0 ? 1 : -1;
  for (let k = 1; k <= 8; k++) {
    const near = desired + first * k * 20 * DEG;
    if (clearAhead(w, s, near, look, allowExit)) return near;
    const far = desired - first * k * 20 * DEG;
    if (clearAhead(w, s, far, look, allowExit)) return far;
  }
  return desired + PI;
}

/** Rudder toward a heading (proportional, saturating). */
function rudderTo(s: SeaShip, heading: number): void {
  const diff = wrapPi(heading - s.h);
  s.rudder = clamp(diff / Math.max(0.05, s.turnRate * 1.5), -1, 1);
}

/** Steer to a point; returns the distance. */
function headFor(w: SeaWorld, s: SeaShip, x: number, y: number, throttle: number, fine: boolean, allowExit = false): number {
  const dx = x - s.x;
  const dy = y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const desired = avoid(w, s, bearingOf(dx, dy), allowExit);
  chooseProp(w, s, desired, fine);
  rudderTo(s, desired);
  s.throttle = throttle;
  return d;
}

/** Station-keeping on a moving point (follow, screen, come alongside). */
function keepStation(w: SeaWorld, s: SeaShip, x: number, y: number, refSpeed: number, refHeading: number, arrive: number): void {
  const dx = x - s.x;
  const dy = y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= arrive) {
    chooseProp(w, s, refHeading, true);
    rudderTo(s, avoid(w, s, refHeading, false));
    s.throttle = clamp(refSpeed / Math.max(0.1, s.vmax || s.rowMs), 0, 1);
    return;
  }
  const desired = avoid(w, s, bearingOf(dx, dy), false);
  chooseProp(w, s, desired, d < w.t.ai.closeQuartersM);
  rudderTo(s, desired);
  const vWant = refSpeed + clamp((d - arrive) * 0.08, 0, 4);
  s.throttle = clamp(vWant / Math.max(0.1, s.vmax || s.rowMs), 0, 1);
}

/** Per-step steering for every ship not under the player's direct helm. */
export function steerShip(w: SeaWorld, s: SeaShip): void {
  if (s.status !== 'active' || s.groundedS > 0) return;
  if (s.grapple >= 0) {
    s.throttle = 0;
    s.rudder = 0;
    return;
  }
  if (s.controller === 'player') {
    if (s.hasMove) {
      const d = headFor(w, s, s.moveX, s.moveY, 1, false);
      if (d <= w.t.orders.arriveRadiusM) {
        s.hasMove = false;
        s.throttle = 0;
        s.rudder = 0;
      } else if (d < 60) s.throttle = Math.max(0.25, d / 60);
    }
    return;
  }
  switch (s.goal) {
    case 'flee':
      rudderTo(s, avoid(w, s, s.fleeHeading, true));
      chooseProp(w, s, s.fleeHeading, false);
      s.throttle = 1;
      return;
    case 'idle':
    case 'hold':
      s.propulsion = 'oars';
      s.throttle = 0;
      s.rudder = 0;
      return;
    case 'range':
      steerRange(w, s);
      return;
    case 'board':
    case 'capture':
      steerAlongside(w, s);
      return;
    case 'ram':
      steerRam(w, s);
      return;
    case 'seaFire':
      steerSeaFire(w, s);
      return;
    case 'follow':
    case 'screen':
      steerFormation(w, s);
      return;
    case 'moveTo': {
      // A 'move' order: sail to the point, then hold there.
      const d = headFor(w, s, s.moveX, s.moveY, 1, false);
      if (d <= w.t.orders.arriveRadiusM) {
        s.order = { kind: 'hold', target: -1 };
        s.goal = 'hold';
        s.throttle = 0;
        s.rudder = 0;
      } else if (d < 60) s.throttle = Math.max(0.25, d / 60);
      return;
    }
    default:
      return;
  }
}

function steerRange(w: SeaWorld, s: SeaShip): void {
  const t = w.ships[s.goalTarget];
  if (!t || !isActive(t)) {
    s.throttle = 0;
    return;
  }
  const R = w.t.ai.keepRangeShare * w.balance.seaBattle.archeryRangeM;
  const dx = s.x - t.x;
  const dy = s.y - t.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const fromT = bearingOf(dx, dy);
  const fine = d < w.t.ai.closeQuartersM;
  if (d > R + 20) {
    // Approach a point on the archery ring, rotated toward the wind (stay upwind, §15.3).
    const bias = w.t.ai.upwindBiasDeg * DEG;
    const turn = wrapPi(w.windFrom - fromT);
    const ring = fromT + clamp(turn, -bias, bias);
    headFor(w, s, t.x + headingX(ring) * R, t.y + headingY(ring) * R, d > w.t.ai.cruiseBeyondM ? w.t.ai.cruiseThrottle : 1, false);
    return;
  }
  if (d < R - 15) {
    const desired = avoid(w, s, fromT, false);
    chooseProp(w, s, desired, true);
    rudderTo(s, desired);
    s.throttle = 1;
    return;
  }
  // In the band: circle the target, choosing the direction that keeps us upwind.
  const cw = fromT + PI / 2;
  const ccw = fromT - PI / 2;
  const upwindCw = dcos(wrapPi(cw - w.windFrom));
  const upwindCcw = dcos(wrapPi(ccw - w.windFrom));
  const tangent = Math.abs(wrapPi(cw - s.h)) < Math.abs(wrapPi(ccw - s.h)) - 0.3 ? cw : upwindCw >= upwindCcw ? cw : ccw;
  const desired = avoid(w, s, tangent, false);
  chooseProp(w, s, desired, true);
  rudderTo(s, desired);
  s.throttle = 0.55;
}

function steerAlongside(w: SeaWorld, s: SeaShip): void {
  const t = w.ships[s.goalTarget];
  if (!t || (t.status !== 'active' && t.status !== 'struck')) {
    s.throttle = 0;
    return;
  }
  if (canGrapple(w, s, t)) {
    tryGrapple(w, s, t);
    if (s.grapple >= 0 || w.ships[t.idx]!.status === 'captured') return;
  }
  // Abeam point on the target's nearer side, led by its velocity.
  const rx = -headingY(t.h);
  const ry = headingX(t.h);
  const side = (s.x - t.x) * rx + (s.y - t.y) * ry >= 0 ? 1 : -1;
  const off = t.radius + s.radius + w.t.ai.alongsideGapM;
  const dx0 = t.x - s.x;
  const dy0 = t.y - s.y;
  const dist = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const lead = clamp(dist / Math.max(1, s.vmax || s.rowMs), 0, 6);
  const tvx = velX(t);
  const tvy = velY(t);
  const px = t.x + rx * side * off + tvx * lead;
  const py = t.y + ry * side * off + tvy * lead;
  const tSpeed = Math.sqrt(tvx * tvx + tvy * tvy);
  if (dist > 45) {
    headFor(w, s, px, py, dist > w.t.ai.cruiseBeyondM ? w.t.ai.cruiseThrottle : 1, false);
    return;
  }
  // Close: aim a little ahead of the abeam point (aligns headings) and match speed.
  const fx = headingX(t.h);
  const fy = headingY(t.h);
  const ax = px + fx * 12;
  const ay = py + fy * 12;
  const desired = avoid(w, s, bearingOf(ax - s.x, ay - s.y), false);
  s.propulsion = 'oars';
  rudderTo(s, desired);
  const along = (px - s.x) * fx + (py - s.y) * fy;
  const lateral = Math.abs((px - s.x) * rx + (py - s.y) * ry);
  let vWant = tSpeed + clamp(along * 0.25, -1.2, 1.2);
  if (tSpeed < 0.5) vWant = clamp(dist * 0.08, 0.2, 1.6) * (lateral > 6 ? 1 : 0.6);
  s.throttle = clamp(vWant / Math.max(0.1, s.vmax || s.rowMs), -0.5, 1);
}

function steerRam(w: SeaWorld, s: SeaShip): void {
  const t = w.ships[s.goalTarget];
  if (!t || !isActive(t)) {
    s.throttle = 0;
    return;
  }
  if (s.backOffS > 0) {
    s.throttle = -1;
    s.rudder = 0;
    return;
  }
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const tLead = clamp(d / Math.max(1, s.rowMs + 0.5), 0, 20);
  headFor(w, s, t.x + velX(t) * tLead, t.y + velY(t) * tLead, 1, true);
}

function steerSeaFire(w: SeaWorld, s: SeaShip): void {
  const t = w.ships[s.goalTarget];
  if (!t || !isActive(t)) {
    s.throttle = 0;
    return;
  }
  const d = headFor(w, s, t.x, t.y, 1, true);
  if (d < 70) s.throttle = 0.45;
}

function steerFormation(w: SeaWorld, s: SeaShip): void {
  const side = w.sides[s.side];
  const flag = side.flagship >= 0 ? w.ships[side.flagship] : undefined;
  if (!flag || flag.status !== 'active') {
    s.throttle = 0;
    return;
  }
  const o = w.t.orders;
  const fx = headingX(flag.h);
  const fy = headingY(flag.h);
  if (s.goal === 'screen') {
    const e = nearestEnemy(w, flag, (t) => t.status === 'active');
    let ux = fx;
    let uy = fy;
    if (e.idx >= 0) {
      const t = w.ships[e.idx]!;
      const dx = t.x - flag.x;
      const dy = t.y - flag.y;
      const dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > 1) {
        ux = dx / dl;
        uy = dy / dl;
      }
    }
    // Spread several screening ships along the line.
    let k = 0;
    for (const o2 of w.ships) if (o2.side === s.side && o2.goal === 'screen' && o2.idx < s.idx) k++;
    const lat = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * o.followSpacingM * 0.7;
    keepStation(w, s, flag.x + ux * o.screenDistM - uy * lat, flag.y + uy * o.screenDistM + ux * lat, Math.abs(flag.v), flag.h, o.arriveRadiusM);
    return;
  }
  let k = 0;
  for (const o2 of w.ships) if (o2.side === s.side && o2.goal === 'follow' && o2.idx < s.idx) k++;
  const row = Math.floor(k / 2) + 1;
  const lat = (k % 2 === 0 ? 1 : -1) * 0.6 * o.followSpacingM;
  const rx = -fy;
  const ry = fx;
  keepStation(w, s, flag.x - fx * row * o.followSpacingM + rx * lat, flag.y - fy * row * o.followSpacingM + ry * lat, Math.abs(flag.v), flag.h, o.arriveRadiusM);
}

/** Cut-free and grapple helpers for the flagship's inputs. */
export function nearestGrappleTarget(w: SeaWorld, s: SeaShip): number {
  let best = -1;
  let bestD = Infinity;
  for (const t of w.ships) {
    if (t.side === s.side || (t.status !== 'active' && t.status !== 'struck')) continue;
    if (!canGrapple(w, s, t)) continue;
    const d = centerDist(s, t);
    if (d < bestD) {
      bestD = d;
      best = t.idx;
    }
  }
  return best;
}

/** Deck-power ratio exposed for the HUD ("board odds"). */
export function boardOdds(w: SeaWorld, s: SeaShip, t: SeaShip): number {
  const b = w.balance.boarding;
  const pa = deckPower(b, deckSideOf(w, s, true));
  const pd = deckPower(b, deckSideOf(w, t, false));
  return pa + pd > 0 ? pa / (pa + pd) : 0.5;
}
