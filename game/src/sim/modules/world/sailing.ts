/**
 * Sailing and marching speed formulas (§8.3, §8.7, §31.2), pure:
 *
 *   fleetKn = min(ship speeds in mode) × windFactor × (1 + 0.02 × partySeafaring) × crewFactor × hullFactor × relic
 *   crewFactor = ratio ≥ 0.6 ? 1 : 0.7 + 0.5 × ratio        hullFactor = 0.7 + 0.3 × hullHp / hullMax
 *   ships row when sail speed < 0.9 × row speed; rowing drains stamina 6/h (rest +10/h); below 30, rowing ×0.6
 *   land party: 30 km/day × terrain × (1 + 0.04 × Wildcraft) × (horses ? 1.4 : 1)
 *
 * The hull factor is applied per ship (the slowest effective ship sets the pace). Every number comes from
 * balance.sailing / balance.overland.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import type { WindStrength } from '@content/world';
import { datan2, PI } from '@sim/core/dmath';
import type { Army, Character, CharId, Fleet, GameState, SkillId } from '@sim/core/state';

export type PointOfSail = 'inIrons' | 'closeHauled' | 'beamReach' | 'broadReach' | 'running';

/** Compass bearing (0 = north, 90 = east; y grows southward) of travel along (dx, dy), in [0, 360). */
export function bearingDeg(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const deg = (datan2(dx, -dy) * 180) / PI;
  return deg < 0 ? deg + 360 : deg >= 360 ? deg - 360 : deg;
}

/** Angle (0–180) between a heading and the direction the wind blows FROM: 0 = into the wind, 180 = dead downwind. */
export function offWindDeg(headingDeg: number, windFromDeg: number): number {
  let d = Math.abs((((headingDeg - windFromDeg) % 360) + 360) % 360);
  if (d > 180) d = 360 - d;
  return d;
}

/** Point of sail for an angle off the wind (balance.sailing.pointOfSailDeg). */
export function pointOfSail(sailing: Balance['sailing'], off: number): PointOfSail {
  const p = sailing.pointOfSailDeg;
  if (off <= p.inIronsMax) return 'inIrons';
  if (off <= p.closeHauledMax) return 'closeHauled';
  if (off <= p.beamReachMax) return 'beamReach';
  if (off <= p.broadReachMax) return 'broadReach';
  return 'running';
}

/** Wind factor (§31.2 table) for a heading and a wind. */
export function windFactor(sailing: Balance['sailing'], headingDeg: number, windFromDeg: number, strength: WindStrength): number {
  return sailing.windFactor[pointOfSail(sailing, offWindDeg(headingDeg, windFromDeg))][strength];
}

/** §31.2 crew factor for crew / crewMax. */
export function crewFactor(sailing: Balance['sailing'], ratio: number): number {
  const c = sailing.crewFactor;
  return ratio >= c.fullAt ? 1 : c.base + c.slope * Math.max(0, ratio);
}

/** §31.2 hull factor for hullHp / hullMax. */
export function hullFactor(sailing: Balance['sailing'], ratio: number): number {
  const h = sailing.hullFactor;
  return h.base + h.slope * Math.min(1, Math.max(0, ratio));
}

/** Sum of a skill modifier over a character's traits and feats (`skill.<id>`, as the people module reads it). */
function modifierSum(c: Character, content: Content, key: string): number {
  let sum = 0;
  for (const t of c.traits) sum += content.traits[t]?.modifiers[key] ?? 0;
  for (const f of c.feats) sum += content.feats[f]?.modifiers[key] ?? 0;
  return sum;
}

/** Wound penalty on stats (§22.5). */
function woundPenalty(c: Character, balance: Balance): number {
  const w = balance.health.wounds;
  if (c.health.wound === 'minor') return w.minor.statPenalty;
  // A mortal wound impairs at least as much as a serious one (the people module owns the exact figure).
  if (c.health.wound === 'serious' || c.health.wound === 'mortal') return w.serious.statPenalty;
  return 0;
}

/** A character's skill as used by checks: base + trait/feat modifiers, reduced by the wound penalty. */
export function effectiveSkill(c: Character, skill: SkillId, content: Content): number {
  const raw = (c.skills[skill] ?? 0) + modifierSum(c, content, `skill.${skill}`);
  return Math.max(0, raw * (1 - woundPenalty(c, content.balance)));
}

/** Best effective skill among the given living characters (0 if none). */
export function bestSkill(state: GameState, ids: readonly (CharId | undefined)[], skill: SkillId, content: Content): number {
  let best = 0;
  for (const id of ids) {
    if (id === undefined || !Object.hasOwn(state.characters, id)) continue;
    const c = state.characters[id];
    if (!c?.alive) continue;
    const v = effectiveSkill(c, skill, content);
    if (v > best) best = v;
  }
  return best;
}

/** Fleet speed inputs (cached by the movement system). */
export interface FleetSpeed {
  /** Slowest ship's sail speed × its hull factor (knots), before wind. */
  sailKn: number;
  /** Slowest ship's row speed × its hull factor (knots). */
  rowKn: number;
  /** (1 + bonus × Seafaring) × crewFactor × relic multiplier. */
  mult: number;
  /** Every ship can enter rivers (karvi, river boats). */
  karvi: boolean;
  /** Ships that exist in the fleet. */
  ships: number;
  /** Party Seafaring (best of leader and lieutenants). */
  seafaring: number;
  /** Any deep-draught ship (shoal penalty). */
  deepHull: boolean;
  men: number;
}

/** Computes a fleet's speed inputs from its ships, crew and party (§31.2). */
export function fleetSpeed(state: GameState, fleet: Fleet, content: Content, shoalPenaltyShips: readonly string[]): FleetSpeed {
  const sailing = content.balance.sailing;
  let sailKn = Infinity;
  let rowKn = Infinity;
  let crewMax = 0;
  let karvi = true;
  let ships = 0;
  let deepHull = false;
  for (const shipId of fleet.shipIds) {
    if (!Object.hasOwn(state.ships, shipId)) continue;
    const ship = state.ships[shipId];
    if (!ship) continue;
    const def = content.balance.ships[ship.type];
    if (!def) continue;
    ships++;
    const hf = hullFactor(sailing, def.hull > 0 ? ship.hullHp / def.hull : 1);
    sailKn = Math.min(sailKn, def.sailKn * hf);
    rowKn = Math.min(rowKn, def.rowKn * hf);
    crewMax += def.crewMax;
    if (!def.river) karvi = false;
    if (shoalPenaltyShips.includes(ship.type)) deepHull = true;
  }
  let men = 0;
  for (const n of Object.values(fleet.men)) men += Math.max(0, n);
  if (ships === 0) return { sailKn: 0, rowKn: 0, mult: 0, karvi: false, ships: 0, seafaring: 0, deepHull: false, men };
  const seafaring = bestSkill(state, [fleet.leaderId, ...fleet.lieutenantIds], 'seafaring', content);
  const crew = crewFactor(sailing, crewMax > 0 ? men / crewMax : 0);
  const relic = fleet.speedMult !== undefined && Number.isFinite(fleet.speedMult) && fleet.speedMult > 0 ? fleet.speedMult : 1;
  const mult = (1 + sailing.seafaringSpeedBonus * seafaring) * crew * relic;
  return { sailKn, rowKn, mult, karvi, ships, seafaring, deepHull, men };
}

/** Row speed after the stamina penalty (§8.3). */
export function rowSpeed(sailing: Balance['sailing'], rowKn: number, stamina: number): number {
  return stamina < sailing.lowStamina ? rowKn * sailing.lowStaminaRowMult : rowKn;
}

/** This hour's speed: sail with the wind, or row when sail speed < autoRowRatio × row speed. */
export function hourlySpeed(sailing: Balance['sailing'], speed: Pick<FleetSpeed, 'sailKn' | 'rowKn' | 'mult'>, wind: number, stamina: number): { kn: number; rowing: boolean } {
  const sail = speed.sailKn * wind;
  const row = rowSpeed(sailing, speed.rowKn, stamina);
  if (sail < row * sailing.autoRowRatio) return { kn: row * speed.mult, rowing: true };
  return { kn: sail * speed.mult, rowing: false };
}

/** Cells moved in one hour at `kn` knots. */
export function cellsPerHour(sailing: Balance['sailing'], kn: number, cellKm: number): number {
  return (kn * sailing.knotKmh) / cellKm;
}

/** Army marching inputs: km per marching hour on open plain (§8.7). */
export interface ArmySpeed {
  kmPerHour: number;
  wildcraft: number;
  horses: boolean;
}

/** Computes an army's march speed (km per marching hour before terrain). */
export function armySpeed(state: GameState, army: Army, content: Content, marchHours: number): ArmySpeed {
  const overland = content.balance.overland;
  const wildcraft = bestSkill(state, [army.leaderId, ...army.squads.map((s) => s.leaderId)], 'wildcraft', content);
  let horses = army.squads.length > 0;
  let lame = false;
  for (const sq of army.squads) {
    if (sq.men <= 0) continue;
    if (content.balance.units[sq.unit]?.cavalry !== true) horses = false;
  }
  const leader = Object.hasOwn(state.characters, army.leaderId) ? state.characters[army.leaderId] : undefined;
  if (leader?.traits.includes('lame')) lame = true;
  const kmPerDay = overland.kmPerDay * (1 + overland.wildcraftSlope * wildcraft) * (horses ? overland.horsesMult : 1) * (lame ? overland.lameMult : 1);
  return { kmPerHour: kmPerDay / Math.max(1, marchHours), wildcraft, horses };
}
