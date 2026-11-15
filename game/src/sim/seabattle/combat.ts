/**
 * Sea-battle combat (design §15.2, §31.10): casualties and morale, automatic archery volleys within
 * 80 m, fire arrows igniting sails, burning sails and hulls, dousing, the sea-fire siphon, the galley
 * ram, sinking (swimmers, rescue, captains), striking colours and capture, and flagship loss.
 */
import { clamp } from '@sim/core/dmath';
import { hazardDistance, lineOfSight } from './arena';
import type { SeaShip, SeaWorld, SideIdx } from './engineTypes';
import { DEG, wrapPi, bearingOf } from './geom';
import { busyFactor, crewOf, ramDamage, rowSpeed, sailSpeed } from './physics';

/** Countdown timers end within this of zero (fixed steps accumulate rounding error). */
export const TIMER_EPS = 1e-9;

// ---------------------------------------------------------------------------------------------
// Casualties and morale.

/**
 * Removes `men` casualties from a ship, spread over the roles in proportion to their numbers (or
 * the given role weights). Killed/wounded split by balance.battle.woundedShare; morale falls by
 * §31.10 `−120 × casualties / starting men`.
 */
export function applyCasualties(w: SeaWorld, s: SeaShip, men: number, weights?: { archers: number; rowers: number; boarders: number }): number {
  const wa = s.archers * (weights ? weights.archers : 1);
  const wr = s.rowers * (weights ? weights.rowers : 1);
  const wb = s.boarders * (weights ? weights.boarders : 1);
  const total = wa + wr + wb;
  if (total <= 0 || men <= 0) return 0;
  const lost = Math.min(men, total);
  const fa = (wa / total) * lost;
  const fr = (wr / total) * lost;
  const fb = (wb / total) * lost;
  s.archers = Math.max(0, s.archers - fa);
  s.rowers = Math.max(0, s.rowers - fr);
  s.boarders = Math.max(0, s.boarders - fb);
  const ws = w.balance.battle.woundedShare;
  s.wounded += lost * ws;
  s.killed += lost * (1 - ws);
  if (s.startCrew > 0) changeMorale(w, s, (w.balance.battle.morale.lossesMult * lost) / s.startCrew);
  return lost;
}

/** Adds to a ship's morale (clamped 0–100). */
export function changeMorale(_w: SeaWorld, s: SeaShip, delta: number): void {
  s.morale = clamp(s.morale + delta, 0, 100);
}

/** balance.battle.moraleMult band for a morale value (steady / wavering / routing). */
export function moraleBandMult(w: SeaWorld, s: SeaShip): number {
  const b = w.balance.battle;
  if (s.routed || s.morale < b.routAt) return b.moraleMult.routing;
  if (s.morale < b.waverAt) return b.moraleMult.wavering;
  return b.moraleMult.steady;
}

/** True when the ship still takes part (active, in the arena). */
export function isActive(s: SeaShip): boolean {
  return s.status === 'active';
}

/** Distance between hull centres. */
export function centerDist(a: SeaShip, b: SeaShip): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------------------------
// Archery (§15.2: automatic volleys within 80 m; §31.10 volley formula).

/** Picks the volley target: the player's chosen ship if in range and visible, else the nearest. */
export function volleyTarget(w: SeaWorld, s: SeaShip): number {
  const range = w.balance.seaBattle.archeryRangeM;
  const samples = w.t.archery.losSamples;
  if (s.target >= 0) {
    const t = w.ships[s.target];
    if (t && t.side !== s.side && isActive(t) && centerDist(s, t) <= range && lineOfSight(w.arena, s.x, s.y, t.x, t.y, samples)) return t.idx;
  }
  let best = -1;
  let bestD = range;
  for (const t of w.ships) {
    if (t.side === s.side || !isActive(t)) continue;
    const d = centerDist(s, t);
    if (d > bestD) continue;
    if (!lineOfSight(w.arena, s.x, s.y, t.x, t.y, samples)) continue;
    best = t.idx;
    bestD = d;
  }
  return best;
}

/** Expected casualties of one volley from `s` at `target` (before the random factor). */
export function volleyHits(w: SeaWorld, s: SeaShip, target: SeaShip, fire: boolean): number {
  const r = w.balance.battle.ranged;
  const range = w.balance.seaBattle.archeryRangeM;
  const d = centerDist(s, target);
  const acc = Math.max(r.accMin, 1 - (r.accSlope * d) / range);
  const side = w.sides[s.side];
  const shooters = s.archers * busyFactor(w, s);
  const atk = s.rangedAtk * (1 + side.archeryBonus);
  const hits = (r.kRanged * shooters * atk * acc * w.t.archery.deckCover * moraleBandMult(w, s)) / Math.max(0.1, target.defEff);
  return fire ? hits * w.t.archery.fireArrowHitMult : hits;
}

/** Fires a volley if ready; called every step for each active ship. */
export function updateArchery(w: SeaWorld, s: SeaShip): void {
  if (s.controller === 'player') {
    // The ship under the player's hand only nocks: the player looses its volleys (volley.ts).
    if (s.volleyT > 0) s.volleyT = s.volleyT - w.dt > TIMER_EPS ? s.volleyT - w.dt : 0;
    return;
  }
  if (s.volleyT > 0) s.volleyT -= w.dt;
  if (s.volleyT > TIMER_EPS || s.holdFire || s.archers < 0.5 || s.grapple >= 0 || s.status !== 'active') return;
  const ti = volleyTarget(w, s);
  if (ti < 0) {
    s.volleyT = 0.5;
    return;
  }
  const target = w.ships[ti]!;
  const side = w.sides[s.side];
  const fire = side.fireArrows && side.pitchT >= w.t.archery.pitchPerVolleyT && target.sail > 0;
  if (fire) {
    side.pitchT -= w.t.archery.pitchPerVolleyT;
    side.pitchUsedT += w.t.archery.pitchPerVolleyT;
  }
  const [lo, hi] = w.balance.battle.randRange;
  const hits = volleyHits(w, s, target, fire) * w.rng.range(lo, hi);
  applyCasualties(w, target, hits);
  w.events.push({ t: w.timeS, kind: 'volley', from: s.idx, to: target.idx, hits, fire });
  if (fire && !target.sailBurning) {
    const r = w.balance.battle.ranged;
    const acc = Math.max(r.accMin, 1 - (r.accSlope * centerDist(s, target)) / w.balance.seaBattle.archeryRangeM);
    const p = w.balance.seaBattle.fireArrowSailIgnite * acc * (target.sailSet ? 1 : w.t.fire.furledIgniteMult);
    if (w.rng.chance(p)) {
      target.sailBurning = true;
      w.events.push({ t: w.timeS, kind: 'ignite', ship: target.idx, part: 'sail', cause: 'arrows' });
    }
  }
  s.volleyT += w.balance.battle.ranged.volleyS;
}

// ---------------------------------------------------------------------------------------------
// Fire and dousing.

/** Starts dousing (half the crew busy for 10 s). Returns false when there is nothing to douse. */
export function startDouse(w: SeaWorld, s: SeaShip): boolean {
  if (s.status !== 'active' || s.douseS > 0 || (!s.sailBurning && s.hullBurnS <= 0)) return false;
  s.douseS = w.balance.seaBattle.douse.seconds;
  w.events.push({ t: w.timeS, kind: 'douseStarted', ship: s.idx });
  return true;
}

/** Burning sails (3 HP/s), burning hulls, dousing outcome. */
export function updateFire(w: SeaWorld, s: SeaShip): void {
  const dt = w.dt;
  const f = w.t.fire;
  if (s.sailBurning) {
    s.sail -= w.balance.seaBattle.burningSailDps * dt;
    if (s.sail <= 0) {
      s.sail = 0;
      s.sailBurning = false;
      w.events.push({ t: w.timeS, kind: 'sailDestroyed', ship: s.idx });
      if (s.hullBurnS <= 0 && w.rng.chance(f.sailBurnoutHullChance)) {
        s.hullBurnS = f.sailBurnoutHullS;
        s.hullBurnDps = f.sailBurnoutHullDps;
        w.events.push({ t: w.timeS, kind: 'ignite', ship: s.idx, part: 'hull', cause: 'burnout' });
      }
    }
  }
  if (s.hullBurnS > 0) {
    s.hull -= s.hullBurnDps * dt;
    s.hullBurnS -= dt;
    if (s.hullBurnS <= TIMER_EPS) {
      s.hullBurnS = 0;
      s.seaFireBurning = false;
    }
  }
  if (s.sailBurning || s.hullBurnS > 0) changeMorale(w, s, f.burningMoralePerS * dt);
  if (s.douseS > 0) {
    s.douseS -= dt;
    if (s.douseS <= TIMER_EPS) {
      s.douseS = 0;
      const p = w.balance.seaBattle.douse.success * (s.seaFireBurning ? f.seaFireDouseMult : 1);
      if (w.rng.chance(p)) {
        s.sailBurning = false;
        s.hullBurnS = 0;
        s.seaFireBurning = false;
        w.events.push({ t: w.timeS, kind: 'extinguished', ship: s.idx });
      } else w.events.push({ t: w.timeS, kind: 'douseFailed', ship: s.idx });
    }
  }
}

/**
 * The Saraleon sea-fire siphon (§15.2): a 30 m cone off the bow sets every enemy hull in it burning
 * (4 HP/s for 15 s), costs −15 morale and some crew. Never fires with a friendly ship in the cone.
 */
export function updateSeaFire(w: SeaWorld, s: SeaShip): void {
  if (s.siphonCd > 0) s.siphonCd -= w.dt;
  if (!s.seaFire || s.siphonCharges <= 0 || s.siphonCd > TIMER_EPS || s.status !== 'active' || s.grapple >= 0) return;
  const sf = w.balance.seaBattle.seaFire;
  const half = w.t.fire.seaFireHalfAngleDeg * DEG;
  const bowX = s.x + s.sinH * s.halfSeg;
  const bowY = s.y - s.cosH * s.halfSeg;
  let hit = 0;
  let friendly = false;
  for (const t of w.ships) {
    if (t === s || (t.status !== 'active' && t.status !== 'struck')) continue;
    const dx = t.x - bowX;
    const dy = t.y - bowY;
    const d = Math.sqrt(dx * dx + dy * dy) - t.halfSeg - t.radius;
    if (d > sf.coneM) continue;
    if (Math.abs(wrapPi(bearingOf(dx, dy) - s.h)) > half) continue;
    if (t.side === s.side) friendly = true;
    else if (t.status === 'active') hit++;
  }
  if (hit === 0 || friendly) return;
  const targets: number[] = [];
  for (const t of w.ships) {
    if (t.side === s.side || t.status !== 'active') continue;
    const dx = t.x - bowX;
    const dy = t.y - bowY;
    const d = Math.sqrt(dx * dx + dy * dy) - t.halfSeg - t.radius;
    if (d > sf.coneM || Math.abs(wrapPi(bearingOf(dx, dy) - s.h)) > half) continue;
    t.hullBurnS = Math.max(t.hullBurnS, sf.seconds);
    t.hullBurnDps = Math.max(t.hullBurnS > 0 ? t.hullBurnDps : 0, sf.hullDps);
    t.seaFireBurning = true;
    if (t.sail > 0 && t.sailSet) t.sailBurning = true;
    changeMorale(w, t, sf.morale);
    applyCasualties(w, t, crewOf(t) * w.t.fire.seaFireCrewLossPct);
    targets.push(t.idx);
  }
  s.siphonCharges -= 1;
  s.siphonCd = w.t.fire.seaFireCooldownS;
  w.events.push({ t: w.timeS, kind: 'seaFire', from: s.idx, targets });
}

/** Applies a galley ram strike (§15.2: 40–80 hull). */
export function applyRam(w: SeaWorld, rammer: SeaShip, target: SeaShip, closing: number): void {
  const r = w.t.ram;
  const damage = ramDamage(w, closing);
  target.hull -= damage;
  target.v *= 0.3;
  changeMorale(w, target, r.morale);
  applyCasualties(w, target, crewOf(target) * r.crewLossPct);
  rammer.hull -= r.selfDamage;
  rammer.ramCd = r.cooldownS;
  rammer.backOffS = r.backOffS;
  rammer.backOffDir = -1;
  rammer.v = 0;
  w.events.push({ t: w.timeS, kind: 'ram', from: rammer.idx, to: target.idx, damage });
}

// ---------------------------------------------------------------------------------------------
// Striking, capture, sinking, flagship loss.

/** Nearest ship of the other side matching a filter (index or −1) and its distance. */
export function nearestEnemy(w: SeaWorld, s: SeaShip, filter: (t: SeaShip) => boolean): { idx: number; d: number } {
  let idx = -1;
  let best = Infinity;
  for (const t of w.ships) {
    if (t.side === s.side || !filter(t)) continue;
    const d = centerDist(s, t);
    if (d < best) {
      best = d;
      idx = t.idx;
    }
  }
  return { idx, d: best };
}

/** Nearest friendly ship matching a filter. */
export function nearestFriend(w: SeaWorld, s: SeaShip, filter: (t: SeaShip) => boolean): { idx: number; d: number } {
  let idx = -1;
  let best = Infinity;
  for (const t of w.ships) {
    if (t === s || t.side !== s.side || !filter(t)) continue;
    const d = centerDist(s, t);
    if (d < best) {
      best = d;
      idx = t.idx;
    }
  }
  return { idx, d: best };
}

/** Breaks the grapple a ship is part of. */
export function breakGrapple(w: SeaWorld, s: SeaShip): void {
  if (s.grapple < 0) return;
  const g = w.grapples[s.grapple];
  if (g) {
    g.done = true;
    const a = w.ships[g.a];
    const d = w.ships[g.d];
    if (a) a.grapple = -1;
    if (d) d.grapple = -1;
  }
  s.grapple = -1;
}

/** The ship strikes its colours (surrenders; taken as a prize when the battle ends). */
export function strike(w: SeaWorld, s: SeaShip): void {
  if (s.status !== 'active') return;
  breakGrapple(w, s);
  s.status = 'struck';
  s.throttle = 0;
  s.douseS = 0;
  w.events.push({ t: w.timeS, kind: 'struck', ship: s.idx });
  onFlagshipGone(w, s);
}

/** A prize crew takes the ship: its men become captives of `by`. */
export function capture(w: SeaWorld, s: SeaShip, by: SideIdx): void {
  if (s.status === 'captured' || s.status === 'sunk' || s.status === 'burned' || s.status === 'fled') return;
  breakGrapple(w, s);
  const wasActive = s.status === 'active';
  const men = crewOf(s) + s.wounded;
  s.captured += men;
  s.wounded = 0;
  s.archers = 0;
  s.rowers = 0;
  s.boarders = 0;
  s.status = 'captured';
  s.capturedBy = by;
  s.throttle = 0;
  s.sailBurning = false;
  s.douseS = 0;
  w.events.push({ t: w.timeS, kind: 'captured', ship: s.idx, by });
  if (s.captainId !== undefined && w.captainFates[s.captainId] !== 'dead') {
    if (s.captainId === w.playerCharId) w.playerShip = -1;
    w.captainFates[s.captainId] = 'captured';
  }
  if (wasActive) onFlagshipGone(w, s);
}

/**
 * Hull at 0: the ship goes down (burned when on fire). Swimmers survive near another hull — rescued
 * by friends, captured by enemies — and the captain (or the player) may reach another ship.
 */
export function sink(w: SeaWorld, s: SeaShip): void {
  if (s.status === 'sunk' || s.status === 'burned' || s.status === 'fled' || s.status === 'captured') {
    if (s.status === 'captured' && s.hull <= 0) {
      // A prize that founders afterwards: men already counted as captives.
      s.status = s.sailBurning || s.hullBurnS > 0 ? 'burned' : 'sunk';
      w.events.push({ t: w.timeS, kind: 'sunk', ship: s.idx, burned: s.status === 'burned' });
    }
    return;
  }
  const wasActive = s.status === 'active';
  breakGrapple(w, s);
  const burned = s.sailBurning || s.hullBurnS > 0;
  s.status = burned ? 'burned' : 'sunk';
  s.hull = 0;
  s.v = 0;
  const sk = w.t.sinking;
  const aboard = crewOf(s) + s.wounded;
  const friend = nearestFriend(w, s, (t) => t.status === 'active');
  const enemy = nearestEnemy(w, s, (t) => t.status === 'active');
  const friendNear = friend.idx >= 0 && friend.d <= sk.rescueRadiusM;
  const enemyNear = enemy.idx >= 0 && enemy.d <= sk.rescueRadiusM;
  const survivors = friendNear || enemyNear ? aboard * sk.swimSurvival : 0;
  // Survivors go to whoever is closest; the wounded among them stay wounded when rescued.
  const toFriend = friendNear && (!enemyNear || friend.d <= enemy.d);
  const woundedSurvivors = s.wounded * (aboard > 0 ? survivors / aboard : 0);
  s.killed += aboard - survivors;
  if (toFriend) {
    s.rescued += survivors - woundedSurvivors;
    s.wounded = woundedSurvivors;
  } else {
    s.captured += survivors;
    s.wounded = 0;
  }
  s.archers = 0;
  s.rowers = 0;
  s.boarders = 0;
  w.events.push({ t: w.timeS, kind: 'sunk', ship: s.idx, burned });
  if (s.captainId !== undefined) captainOverboard(w, s, friend, enemy);
  if (wasActive) onFlagshipGone(w, s);
}

function captainOverboard(w: SeaWorld, s: SeaShip, friend: { idx: number; d: number }, enemy: { idx: number; d: number }): void {
  const id = s.captainId;
  if (id === undefined || w.captainFates[id] === 'dead' || w.captainFates[id] === 'captured') return;
  const sk = w.t.sinking;
  const isPlayer = id === w.playerCharId;
  const gentle = w.setup.gentleMode === true && isPlayer;
  if (friend.idx >= 0 && friend.d <= sk.flagshipTransferRadiusM) {
    const to = w.ships[friend.idx]!;
    if (to.captainId === undefined) to.captainId = id;
    if (w.rng.chance(sk.playerWoundOnTransfer)) w.captainFates[id] = 'wounded';
    if (isPlayer) {
      w.playerShip = to.idx;
      w.playerTransferredTo = to.shipId;
      // The engine hands the helm to the player's new ship when the steered one is lost (ensureHelm).
    }
    const side = w.sides[s.side];
    if (side.flagship === s.idx) side.flagship = to.idx;
    w.events.push({ t: w.timeS, kind: 'transfer', from: s.idx, to: to.idx });
    return;
  }
  if (isPlayer) w.playerShip = -1;
  if (enemy.idx >= 0 && enemy.d <= sk.rescueRadiusM) {
    w.captainFates[id] = 'captured';
    return;
  }
  if (gentle || w.rng.chance(sk.captainSurvival)) w.captainFates[id] = 'wounded';
  else w.captainFates[id] = 'dead';
}

/** Side-wide morale shock when a side's flagship is lost (once), and the player leaving the helm. */
export function onFlagshipGone(w: SeaWorld, s: SeaShip): void {
  const side = w.sides[s.side];
  if (side.flagship === s.idx && s.status !== 'active') {
    if (!side.flagshipLost) {
      side.flagshipLost = true;
      for (const t of w.ships) if (t.side === s.side && t.status === 'active') changeMorale(w, t, w.t.morale.flagshipLost);
      w.events.push({ t: w.timeS, kind: 'flagshipLost', side: s.side });
    }
    // The flag passes to the strongest remaining ship.
    let best = -1;
    let bestCrew = -1;
    for (const t of w.ships) {
      if (t.side !== s.side || t.status !== 'active') continue;
      const c = crewOf(t);
      if (c > bestCrew) {
        bestCrew = c;
        best = t.idx;
      }
    }
    if (w.playerShip >= 0 && w.ships[w.playerShip]?.side === s.side && w.ships[w.playerShip]?.status === 'active') best = w.playerShip;
    side.flagship = best;
  }
  if (w.playerSide === s.side && w.playerShip < 0 && !side.retreating && side.isPlayer) {
    // The player is out of the fight: the remaining ships make for the edge.
    side.retreating = true;
    side.retreatS = 0;
    for (const t of w.ships) if (t.side === s.side && t.controller === 'player') t.controller = 'orders';
    w.events.push({ t: w.timeS, kind: 'retreat', side: s.side });
  }
}

/**
 * Morale over time: recovery when no enemy is near, rout below balance.battle.routAt, rally at
 * rallyAt, and striking when a routed (or merchant) ship is caught by a ship at least as fast.
 */
export function updateMorale(w: SeaWorld, s: SeaShip): void {
  if (s.status !== 'active') return;
  const b = w.balance.battle;
  const safe = s.nearestEnemyD > w.t.morale.safeRadiusM;
  if (safe && !s.sailBurning && s.hullBurnS <= 0 && s.morale < s.startMorale) {
    s.morale = Math.min(s.startMorale, s.morale + b.morale.recoveryPerS * w.dt);
  }
  if (!s.routed && s.morale < b.routAt) {
    s.routed = true;
    w.events.push({ t: w.timeS, kind: 'routed', ship: s.idx });
  } else if (s.routed && safe && s.morale >= b.rallyAt) {
    s.routed = false;
    w.events.push({ t: w.timeS, kind: 'rallied', ship: s.idx });
  }
  const side = w.sides[s.side];
  const merchant = side.role === 'merchant';
  if ((s.routed || merchant) && s.controller !== 'player' && s.grapple < 0 && s.nearestEnemyD <= w.t.boarding.caughtRangeM) {
    const e = nearestEnemy(w, s, (t) => t.status === 'active' && !t.routed);
    if (e.idx >= 0 && e.d <= w.t.boarding.caughtRangeM) {
      const chaser = w.ships[e.idx]!;
      const mySpeed = Math.max(rowSpeed(w, s), sailSpeed(w, s, s.h));
      const theirSpeed = Math.max(rowSpeed(w, chaser), sailSpeed(w, chaser, chaser.h));
      if (theirSpeed >= mySpeed * 0.9 || s.groundedS > 0) strike(w, s);
    }
  }
}

/** Cheap hazard check used by AI steering (true = safe water for this hull). */
export function safeWater(w: SeaWorld, s: SeaShip, x: number, y: number, margin: number): boolean {
  return hazardDistance(w.arena, x, y, s.deepDraft) > margin;
}
