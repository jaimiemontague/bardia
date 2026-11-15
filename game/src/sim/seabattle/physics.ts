/**
 * Sea-battle physics: the §31.2 wind polar, sail vs oars propulsion with crew stamina, turning,
 * integration, grounding on shallows/rocks/land and hull-capsule collisions (including the galley
 * ram, §15.2). Pure functions over the mutable engine state; no allocation in the per-step paths.
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as SeaTunables } from '@content/schemas/tunables/seabattle';
import { clamp, dcos, dpow, dsin, PI } from '@sim/core/dmath';
import type { WindStrength } from '@sim/core/state';
import { TERRAIN, terrainAt } from './arena';
import type { SeaShip, SeaWorld } from './engineTypes';
import { DEG, lerp, segmentClosest, wrapPi } from './geom';

/** Rows of the §31.2 wind-factor table. */
export type PointOfSail = 'running' | 'broadReach' | 'beamReach' | 'closeHauled' | 'inIrons';

/** Angle (degrees, 0–180) between a heading and the direction the wind blows FROM. */
export function offWindDeg(heading: number, windFrom: number): number {
  return Math.abs(wrapPi(heading - windFrom)) / DEG;
}

/** Point of sail for an off-the-wind angle (balance.sailing.pointOfSailDeg bands, §31.2). */
export function pointOfSail(offDeg: number, bands: Balance['sailing']['pointOfSailDeg']): PointOfSail {
  if (offDeg < bands.inIronsMax) return 'inIrons';
  if (offDeg <= bands.closeHauledMax) return 'closeHauled';
  if (offDeg <= bands.beamReachMax) return 'beamReach';
  if (offDeg <= bands.broadReachMax) return 'broadReach';
  return 'running';
}

/** §31.2 wind factor for a heading (radians) in a wind blowing from `windFrom` (radians). */
export function windFactor(balance: Balance, heading: number, windFrom: number, str: WindStrength): number {
  const pos = pointOfSail(offWindDeg(heading, windFrom), balance.sailing.pointOfSailDeg);
  return balance.sailing.windFactor[pos][str];
}

/** The best wind factor any heading can reach in this strength (for auto-resolve speed). */
export function bestWindFactor(balance: Balance, str: WindStrength): number {
  const f = balance.sailing.windFactor;
  return Math.max(f.running[str], f.broadReach[str], f.beamReach[str], f.closeHauled[str]);
}

/** §31.2 crewFactor for sail handling: ratio ≥ 0.6 ? 1 : 0.7 + 0.5 × ratio. */
export function crewSailFactor(balance: Balance, crew: number, crewMax: number): number {
  const c = balance.sailing.crewFactor;
  const ratio = crewMax > 0 ? crew / crewMax : 0;
  return ratio >= c.fullAt ? 1 : c.base + c.slope * ratio;
}

/** §31.2 hullFactor: 0.7 + 0.3 × hull / hullMax. */
export function hullSpeedFactor(balance: Balance, hull: number, hullMax: number): number {
  const c = balance.sailing.hullFactor;
  return c.base + c.slope * clamp(hullMax > 0 ? hull / hullMax : 0, 0, 1);
}

/** Share of full sail drive left to a damaged sail (0 at 0 HP). */
export function sailHpFactor(t: SeaTunables, sail: number, sailMax: number): number {
  if (sail <= 0 || sailMax <= 0) return 0;
  const f = t.physics.sailHpSpeedFloor;
  return f + (1 - f) * clamp(sail / sailMax, 0, 1);
}

/** Share of full rowing speed with `rowers` at the oars (benches = oarsShareOfCrewMax × crewMax). */
export function benchFactor(t: SeaTunables, rowers: number, crewMax: number): number {
  const benches = t.physics.oarsShareOfCrewMax * crewMax;
  if (rowers <= 0 || benches <= 0) return 0;
  const r = rowers / benches;
  if (r >= 1) return 1;
  // Exact sqrt for the default exponent; dpow (engine-independent) otherwise.
  return t.physics.rowPowerExp === 0.5 ? Math.sqrt(r) : dpow(r, t.physics.rowPowerExp);
}

/** Rowing slows when the crew is spent (balance.sailing.lowStamina / lowStaminaRowMult). */
export function staminaRowFactor(balance: Balance, stamina: number): number {
  return stamina < balance.sailing.lowStamina ? balance.sailing.lowStaminaRowMult : 1;
}

/** Fighting men available for a role while half the crew is busy dousing. */
export function busyFactor(w: SeaWorld, s: SeaShip): number {
  return s.douseS > 0 ? 1 - w.balance.seaBattle.douse.crewShare : 1;
}

/** Crew aboard and able (fighting + rowing). */
export function crewOf(s: SeaShip): number {
  return s.archers + s.rowers + s.boarders;
}

/**
 * Top speeds (m/s) of a ship right now: row speed and sail speed on a given heading. Sail speed is
 * 0 when the sail is gone; row speed is 0 with nobody at the oars.
 */
export function rowSpeed(w: SeaWorld, s: SeaShip): number {
  const side = w.sides[s.side];
  return (
    s.rowMs *
    benchFactor(w.t, s.rowers * busyFactor(w, s), s.crewMax) *
    staminaRowFactor(w.balance, s.stamina) *
    hullSpeedFactor(w.balance, s.hull, s.hullMax) *
    side.seafaringMult
  );
}

export function sailSpeed(w: SeaWorld, s: SeaShip, heading: number): number {
  const side = w.sides[s.side];
  return (
    s.sailMs *
    windFactor(w.balance, heading, w.windFrom, w.windStr) *
    sailHpFactor(w.t, s.sail, s.sailMax) *
    crewSailFactor(w.balance, crewOf(s), s.crewMax) *
    hullSpeedFactor(w.balance, s.hull, s.hullMax) *
    side.seafaringMult
  );
}

/** The best speed a ship could make on its best heading in this wind (for pursuit checks). */
export function potentialSpeed(w: SeaWorld, s: SeaShip): number {
  const side = w.sides[s.side];
  const sail =
    s.sailMs *
    bestWindFactor(w.balance, w.windStr) *
    sailHpFactor(w.t, s.sail, s.sailMax) *
    crewSailFactor(w.balance, crewOf(s), s.crewMax) *
    hullSpeedFactor(w.balance, s.hull, s.hullMax) *
    side.seafaringMult;
  return Math.max(rowSpeed(w, s), sail);
}

/** Best achievable speed on a heading (the mode the AI would pick there). */
export function bestSpeedOn(w: SeaWorld, s: SeaShip, heading: number): number {
  return Math.max(rowSpeed(w, s), sailSpeed(w, s, heading));
}

/** Sets cached heading trig after `s.h` changes. */
export function updateTrig(s: SeaShip): void {
  s.sinH = dsin(s.h);
  s.cosH = dcos(s.h);
}

/** True for ships that still move under their own control. */
export function isMobile(s: SeaShip): boolean {
  return s.status === 'active' && s.groundedS <= 0 && s.grapple < 0;
}

/**
 * One integration step for a ship: propulsion choice (auto-row in irons), speed and stamina,
 * turning, position, push decay, terrain contact and arena exit.
 */
export function integrateShip(w: SeaWorld, s: SeaShip): void {
  const dt = w.dt;
  const b = w.balance;
  const p = w.t.physics;
  s.px = s.x;
  s.py = s.y;
  s.ph = s.h;
  if (s.status === 'sunk' || s.status === 'burned' || s.status === 'fled') return;

  const controlled = s.status === 'active' && s.grapple < 0;
  const row = rowSpeed(w, s);
  let vmax = 0;
  s.rowing = false;
  if (s.status !== 'active') {
    s.sailSet = false;
  } else if (s.propulsion === 'oars') {
    s.sailSet = false;
    s.rowing = row > 0;
    vmax = row;
  } else {
    s.sailSet = s.sail > 0;
    const sail = sailSpeed(w, s, s.h);
    if (sail < row * b.sailing.autoRowRatio) {
      s.rowing = row > 0;
      vmax = row;
    } else vmax = sail;
  }
  s.vmax = vmax;

  let throttle = controlled ? s.throttle : 0;
  if (s.groundedS > 0) throttle = 0;
  let target: number;
  if (throttle >= 0) target = throttle * vmax;
  else target = row > 0 ? throttle * row * p.reverseRowMult : 0;
  const backingOff = s.backOffS > 0 && controlled;
  if (backingOff) {
    // Back water away from the hazard or the rammed hull (or pull ahead when the stern touched).
    target = (s.backOffDir >= 0 ? 1 : -1) * row * p.reverseRowMult;
    s.rowing = row > 0;
  }
  if (!s.deepDraft && terrainAt(w.arena, s.x, s.y) === TERRAIN.shallow) {
    const cap = Math.max(vmax, row) * p.shallowSpeedMult;
    target = clamp(target, -cap, cap);
  }
  if (s.groundedS > 0) {
    s.v = 0;
    s.groundedS -= dt;
    if (s.groundedS <= 1e-9) {
      // Refloated at the last safe pose (collisions may have shoved the stranded hull), then back
      // water clear of the hazard.
      restoreSafePose(s);
      s.groundedS = 0;
      s.backOffS = Math.max(s.backOffS, p.groundedBackOffS);
    }
  } else {
    const speedingUp = Math.abs(target) > Math.abs(s.v) && target * s.v >= 0;
    const tau = speedingUp ? p.accelS : p.decelS;
    s.v += (target - s.v) * Math.min(1, dt / tau);
  }

  // Stamina: rowing hard drains it; resting at sail or idle recovers it.
  const stroke = s.rowing ? Math.max(Math.abs(throttle), s.backOffS > 0 ? 1 : 0) : 0;
  if (stroke > 0) s.stamina = Math.max(0, s.stamina - p.rowStaminaDrainPerS * (p.staminaThrottleExp === 2 ? stroke * stroke : dpow(stroke, p.staminaThrottleExp)) * dt);
  else s.stamina = Math.min(100, s.stamina + p.staminaRecoverPerS * dt);

  // Turning: oars pivot the hull; a sail needs steerage way. Not while backing away from a hazard
  // (a pivot is what swings a bow or stern onto the rocks).
  if (controlled && s.groundedS <= 0 && !backingOff) {
    let steer: number;
    if (s.rowing) steer = p.oarsTurnMult;
    else steer = clamp(p.sailTurnMinFactor + (1 - p.sailTurnMinFactor) * (Math.abs(s.v) / p.sailTurnFullSpeedMs), p.sailTurnMinFactor, 1);
    if (s.rudder !== 0) {
      s.h = wrapHeading(s.h + clamp(s.rudder, -1, 1) * s.turnRate * steer * dt);
      updateTrig(s);
    }
  }

  s.x += (s.sinH * s.v + s.pvx) * dt;
  s.y += (-s.cosH * s.v + s.pvy) * dt;
  const decay = Math.max(0, 1 - p.pushDecayPerS * dt);
  s.pvx *= decay;
  s.pvy *= decay;

  terrainContact(w, s);

  const m = p.exitMarginM;
  const size = w.arena.sizeM;
  if (s.status === 'active' && (s.x < -m || s.y < -m || s.x > size + m || s.y > size + m)) {
    s.status = 'fled';
    s.v = 0;
    w.events.push({ t: w.timeS, kind: 'fled', ship: s.idx });
  }
}

function wrapHeading(h: number): number {
  const two = 2 * PI;
  let x = h % two;
  if (x < 0) x += two;
  return x;
}

/** Puts a ship back on its last safe pose (position and heading). */
function restoreSafePose(s: SeaShip): void {
  s.x = s.safeX;
  s.y = s.safeY;
  if (s.h !== s.safeH) {
    s.h = s.safeH;
    updateTrig(s);
  }
}

function solidTerrain(c: number): boolean {
  return c === TERRAIN.land || c === TERRAIN.rock;
}

/**
 * Contact with land, rocks and (deep-draft hulls) shallows, probed at the bow, the centre and the
 * stern so a pivoting hull is caught as well as one under way. On contact the ship is put back on
 * its last safe pose and stopped. Struck at `groundMinSpeedMs` or faster it runs aground (hull
 * damage ∝ speed, stuck for groundedS, half that on a rock it bounces off); a slower touch only
 * makes the crew fend off and back away from the contact. Otherwise the pose is remembered as safe.
 */
export function terrainContact(w: SeaWorld, s: SeaShip): void {
  if (s.groundedS > 0) return;
  const p = w.t.physics;
  const hx = s.sinH * (s.lengthM / 2);
  const hy = -s.cosH * (s.lengthM / 2);
  const tc = terrainAt(w.arena, s.x, s.y);
  const tb = terrainAt(w.arena, s.x + hx, s.y + hy);
  const ts = terrainAt(w.arena, s.x - hx, s.y - hy);
  const blocked = (c: number) => solidTerrain(c) || (s.deepDraft && c === TERRAIN.shallow);
  const bowOrMid = blocked(tb) || blocked(tc);
  if (!bowOrMid && !blocked(ts)) {
    s.safeX = s.x;
    s.safeY = s.y;
    s.safeH = s.h;
    return;
  }
  const rock = tc === TERRAIN.rock || tb === TERRAIN.rock || ts === TERRAIN.rock;
  const speed = Math.abs(s.v) + Math.sqrt(s.pvx * s.pvx + s.pvy * s.pvy);
  restoreSafePose(s);
  s.v = 0;
  s.pvx = 0;
  s.pvy = 0;
  // Away from the contact: astern when the bow (or the middle) touched, ahead when only the stern did.
  s.backOffDir = bowOrMid ? -1 : 1;
  if (speed < p.groundMinSpeedMs) {
    s.backOffS = Math.max(s.backOffS, p.bumpBackOffS);
    return;
  }
  const damage = (rock ? p.rockDamagePerMs : p.groundDamagePerMs) * speed;
  s.hull -= damage;
  s.groundedS = rock ? p.groundedS * 0.5 : p.groundedS;
  w.events.push({ t: w.timeS, kind: 'grounded', ship: s.idx, rock, damage });
}

/** Hull capsule spine end points (stern, bow) into `out` [sx, sy, bx, by]. */
function spine(s: SeaShip, out: Float64Array, o: number): void {
  out[o] = s.x - s.sinH * s.halfSeg;
  out[o + 1] = s.y + s.cosH * s.halfSeg;
  out[o + 2] = s.x + s.sinH * s.halfSeg;
  out[o + 3] = s.y - s.cosH * s.halfSeg;
}

/** Edge-to-edge distance between two hulls (negative when overlapping). Uses w.scratch. */
export function hullGap(w: SeaWorld, a: SeaShip, b: SeaShip): number {
  const sc = w.scratch;
  spine(a, sc, 8);
  spine(b, sc, 12);
  const d2 = segmentClosest(sc[8]!, sc[9]!, sc[10]!, sc[11]!, sc[12]!, sc[13]!, sc[14]!, sc[15]!, sc);
  return Math.sqrt(d2) - a.radius - b.radius;
}

/** Velocity vector components of a ship (forward speed + push). */
export function velX(s: SeaShip): number {
  return s.sinH * s.v + s.pvx;
}
export function velY(s: SeaShip): number {
  return -s.cosH * s.v + s.pvy;
}

/** Relative speed between two ships (m/s). */
export function relativeSpeed(a: SeaShip, b: SeaShip): number {
  const dx = velX(a) - velX(b);
  const dy = velY(a) - velY(b);
  return Math.sqrt(dx * dx + dy * dy);
}

function physical(s: SeaShip): boolean {
  return s.status === 'active' || s.status === 'struck' || s.status === 'captured';
}

/**
 * Ship–ship collisions over all pairs (broad phase on bounding circles, narrow phase on hull
 * capsules). Separates overlapping hulls by mass, bleeds off closing speed, adds push-apart
 * velocity and deals collision damage; a ready galley ram striking bow-first deals ram damage.
 * Lashed (grappled) pairs are held together instead.
 */
export function resolveCollisions(w: SeaWorld, onRam: (rammer: SeaShip, target: SeaShip, closing: number) => void): void {
  const ships = w.ships;
  const p = w.t.physics;
  const sc = w.scratch;
  const n = ships.length;
  for (let i = 0; i < n; i++) {
    const a = ships[i]!;
    if (!physical(a)) continue;
    for (let j = i + 1; j < n; j++) {
      const b = ships[j]!;
      if (!physical(b)) continue;
      const reach = a.halfSeg + a.radius + b.halfSeg + b.radius;
      const cdx = a.x - b.x;
      const cdy = a.y - b.y;
      if (cdx * cdx + cdy * cdy > reach * reach) continue;
      spine(a, sc, 8);
      spine(b, sc, 12);
      const d2 = segmentClosest(sc[8]!, sc[9]!, sc[10]!, sc[11]!, sc[12]!, sc[13]!, sc[14]!, sc[15]!, sc);
      const rr = a.radius + b.radius;
      if (d2 >= rr * rr) continue;
      const lashed = a.grapple >= 0 && a.grapple === b.grapple;
      const d = Math.sqrt(d2);
      // Normal from b's contact point to a's.
      let nx: number;
      let ny: number;
      if (d > 1e-6) {
        nx = (sc[1]! - sc[3]!) / d;
        ny = (sc[2]! - sc[4]!) / d;
      } else {
        const cd = Math.sqrt(cdx * cdx + cdy * cdy);
        nx = cd > 1e-6 ? cdx / cd : 1;
        ny = cd > 1e-6 ? cdy / cd : 0;
      }
      const pen = rr - d;
      const ma = a.mass;
      const mb = b.mass;
      const shareA = mb / (ma + mb);
      const shareB = ma / (ma + mb);
      a.x += nx * pen * shareA;
      a.y += ny * pen * shareA;
      b.x -= nx * pen * shareB;
      b.y -= ny * pen * shareB;
      if (lashed) continue;
      // Closing speed along the normal (positive = approaching).
      const closing = -((velX(a) - velX(b)) * nx + (velY(a) - velY(b)) * ny);
      if (closing <= 0) continue;
      // Ram: a ready galley hitting with its bow.
      const ramA = canRam(w, a, b, sc[1]!, sc[2]!, -nx, -ny, closing);
      const ramB = !ramA && canRam(w, b, a, sc[3]!, sc[4]!, nx, ny, closing);
      // Bleed forward speed into the other hull and push apart.
      const intoA = a.sinH * -nx + -a.cosH * -ny;
      const intoB = b.sinH * nx + -b.cosH * ny;
      if (intoA > 0) a.v -= intoA * closing * shareA;
      if (intoB > 0) b.v -= intoB * closing * shareB;
      a.pvx += nx * closing * p.restitution * shareA;
      a.pvy += ny * closing * p.restitution * shareA;
      b.pvx -= nx * closing * p.restitution * shareB;
      b.pvy -= ny * closing * p.restitution * shareB;
      if (ramA) onRam(a, b, closing);
      else if (ramB) onRam(b, a, closing);
      else if (closing > p.collisionMinSpeedMs) {
        const damage = p.collisionDamagePerMs * (closing - p.collisionMinSpeedMs);
        a.hull -= damage;
        b.hull -= damage;
        w.events.push({ t: w.timeS, kind: 'collision', a: a.idx, b: b.idx, damage });
      }
    }
  }
}

/** A ready galley ram whose bow (contact near the bow tip, heading into the target) strikes hard enough. */
function canRam(w: SeaWorld, s: SeaShip, target: SeaShip, cx: number, cy: number, nToTargetX: number, nToTargetY: number, closing: number): boolean {
  if (!s.galley || s.status !== 'active' || s.ramCd > 0 || target.side === s.side) return false;
  if (closing < w.t.ram.minSpeedMs) return false;
  const bowX = s.x + s.sinH * s.halfSeg;
  const bowY = s.y - s.cosH * s.halfSeg;
  const dx = cx - bowX;
  const dy = cy - bowY;
  const reach = w.t.ram.reachM + s.radius;
  if (dx * dx + dy * dy > reach * reach) return false;
  return s.sinH * nToTargetX + -s.cosH * nToTargetY > 0.5;
}

/** Ram damage for a closing speed: lerp over balance.seaBattle.galleyRamHull (§15.2: 40–80). */
export function ramDamage(w: SeaWorld, closing: number): number {
  const [lo, hi] = w.balance.seaBattle.galleyRamHull;
  const r = w.t.ram;
  const f = clamp((closing - r.minSpeedMs) / Math.max(1e-6, r.fullSpeedMs - r.minSpeedMs), 0, 1);
  return lerp(lo, hi, f);
}
