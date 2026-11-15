/**
 * The player's hand-loosed broadside (owner play-test 2026-11-15): the archers of the steered ship
 * draw while Space is held and loose over one side, square to the keel, at the range the aim marker
 * showed. The volley flies for a moment and falls on a circle of `tunables.aim.fallRadiusM`; every
 * enemy hull under it is struck, harder the better the shot was centred on it. Fire arrows (pitch
 * aboard) can set the sail alight exactly as the captains' own volleys do. Then the crew nocks again
 * (`aim.nockS`). Everything here is deterministic: the client sends side and range at a tick.
 */
import { clamp } from '@sim/core/dmath';
import { applyCasualties, moraleBandMult, TIMER_EPS } from './combat';
import type { SeaBroadside, SeaShip, SeaShot, SeaWorld } from './engineTypes';
import { busyFactor } from './physics';

/** Unit vector (arena x east, y south) out of a ship's side, square to the keel. */
export function broadsideDir(s: Pick<SeaShip, 'sinH' | 'cosH'>, side: SeaBroadside): [number, number] {
  // Starboard is the heading turned 90° clockwise: (cos h, sin h); port the opposite.
  return side === 'starboard' ? [s.cosH, s.sinH] : [-s.cosH, -s.sinH];
}

/** The range a loose input asks for, kept between the shortest and the longest bowshot. */
export function clampAimRange(w: SeaWorld, rangeM: number): number {
  const a = w.t.aim;
  return clamp(Number.isFinite(rangeM) ? rangeM : a.minRangeM, a.minRangeM, a.maxRangeM);
}

/** Can this ship's archers loose by hand now (bows nocked, men to draw them, not in a deck fight)? */
export function canLoose(s: SeaShip): boolean {
  return s.status === 'active' && s.grapple < 0 && s.archers >= 0.5 && s.volleyT <= TIMER_EPS;
}

/** Men struck per unit of centring by a hand volley from `s` (before the target's defence). */
export function handVolleyPower(w: SeaWorld, s: SeaShip, rangeM: number, fire: boolean): number {
  const r = w.balance.battle.ranged;
  const a = w.t.aim;
  const side = w.sides[s.side];
  const shooters = s.archers * busyFactor(w, s);
  const atk = s.rangedAtk * (1 + side.archeryBonus);
  const span = Math.max(1e-6, a.maxRangeM - a.minRangeM);
  const far = 1 - (1 - a.farHitMult) * clamp((rangeM - a.minRangeM) / span, 0, 1);
  const power = r.kRanged * shooters * atk * w.t.archery.deckCover * moraleBandMult(w, s) * a.aimedHitMult * far;
  return fire ? power * w.t.archery.fireArrowHitMult : power;
}

/**
 * Looses a volley from `s` over `side`, `rangeM` out. Returns false (and changes nothing) when the
 * archers are not ready. Fire arrows are used while the side has pitch and loosing them is on.
 */
export function looseVolley(w: SeaWorld, s: SeaShip, side: SeaBroadside, rangeM: number): boolean {
  if (!canLoose(s)) return false;
  const a = w.t.aim;
  const range = clampAimRange(w, rangeM);
  const [ux, uy] = broadsideDir(s, side);
  const st = w.sides[s.side];
  const fire = st.fireArrows && st.pitchT >= w.t.archery.pitchPerVolleyT && w.t.archery.pitchPerVolleyT > 0;
  if (fire) {
    st.pitchT -= w.t.archery.pitchPerVolleyT;
    st.pitchUsedT += w.t.archery.pitchPerVolleyT;
  }
  const flightS = a.flightBaseS + range / a.arrowSpeedMs;
  const shot: SeaShot = {
    from: s.idx,
    side: s.side,
    broadside: side,
    fromX: s.x,
    fromY: s.y,
    x: s.x + ux * range,
    y: s.y + uy * range,
    rangeM: range,
    firedT: w.timeS,
    landT: w.timeS + flightS,
    power: handVolleyPower(w, s, range, fire),
    fire,
  };
  w.shots.push(shot);
  s.volleyT = a.nockS;
  w.events.push({ t: w.timeS, kind: 'loose', from: s.idx, side, x: shot.x, y: shot.y, rangeM: range, fire, flightS });
  return true;
}

/** Distance from a point to a hull's spine (the capsule's centre line), metres. */
export function spineDistance(s: Pick<SeaShip, 'x' | 'y' | 'sinH' | 'cosH' | 'halfSeg'>, x: number, y: number): number {
  const fx = s.sinH;
  const fy = -s.cosH;
  const dx = x - s.x;
  const dy = y - s.y;
  const along = clamp(dx * fx + dy * fy, -s.halfSeg, s.halfSeg);
  const px = s.x + fx * along;
  const py = s.y + fy * along;
  return Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
}

/**
 * How well a fall of shot at (x, y) is centred on a hull: 1 dead on its centre line, falling to 0
 * where the circle of the fall no longer touches the hull.
 */
export function centring(w: SeaWorld, t: SeaShip, x: number, y: number): number {
  return clamp(1 - spineDistance(t, x, y) / (t.radius + w.t.aim.fallRadiusM), 0, 1);
}

/** Resolves the volleys whose arrows come down this step. */
export function updateShots(w: SeaWorld): void {
  if (w.shots.length === 0) return;
  let keep = 0;
  for (let i = 0; i < w.shots.length; i++) {
    const shot = w.shots[i]!;
    if (shot.landT > w.timeS + TIMER_EPS) {
      w.shots[keep++] = shot;
      continue;
    }
    fall(w, shot);
  }
  w.shots.length = keep;
}

function fall(w: SeaWorld, shot: SeaShot): void {
  const a = w.t.aim;
  const [lo, hi] = w.balance.battle.randRange;
  let total = 0;
  let best = 0;
  const struck: number[] = [];
  for (const t of w.ships) {
    if (t.side === shot.side || t.status !== 'active') continue;
    const c = centring(w, t, shot.x, shot.y);
    if (c <= 0) continue;
    const blow = Math.min(1, c / a.fullCentring);
    const hits = ((shot.power * blow) / Math.max(0.1, t.defEff)) * w.rng.range(lo, hi);
    total += applyCasualties(w, t, hits);
    struck.push(t.idx);
    if (c > best) best = c;
    if (shot.fire && !t.sailBurning && t.sail > 0) {
      const p = w.balance.seaBattle.fireArrowSailIgnite * blow * (t.sailSet ? 1 : w.t.fire.furledIgniteMult);
      if (w.rng.chance(p)) {
        t.sailBurning = true;
        w.events.push({ t: w.timeS, kind: 'ignite', ship: t.idx, part: 'sail', cause: 'arrows' });
      }
    }
  }
  w.events.push({ t: w.timeS, kind: 'fall', from: shot.from, x: shot.x, y: shot.y, fire: shot.fire, hits: total, struck, centred: best });
}
