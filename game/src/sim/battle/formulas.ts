/**
 * The design's battle formulas (§31.8 melee, §31.9 formations/terrain, §31.10 ranged, morale,
 * fatigue, fire and player safety, §31.11 power) as small pure functions over balance values.
 * The engine and the auto-resolve both call these, so a formula lives in exactly one place.
 */
import { clamp, dcos, dsin, PI } from '@sim/core/dmath';
import type { Balance } from '@content/schemas/balance';
import type { FormationId, OmenId } from '@sim/core/state';
import type { ResolvedUnit } from './data';

type B = Balance['battle'];

/** Melee frontage for a formation (§31.8: line 20, shieldWall 24, wedge 12, loose 10). */
export function frontage(b: B, formation: FormationId): number {
  return b.formations[formation].frontage;
}

/** Movement speed multiplier of a formation (§31.9). */
export function formationSpeed(b: B, formation: FormationId): number {
  return b.formations[formation].speed;
}

/**
 * Formation defence multiplier (§31.9). Shield wall uses the unit's `shieldWallDef` (1.3 bondi,
 * 1.6 huscarls) and the Fjord-Wall bonus (+20% further, multiplicative).
 */
export function formationDef(b: B, formation: FormationId, unit: ResolvedUnit): number {
  if (formation === 'shieldWall') return unit.shieldWallDef * (1 + unit.shieldWallBonus);
  return b.formations[formation].def;
}

/** Morale multiplier: steady ≥ waverAt → 1.0, wavering → 0.75, routing → 0.3 (§31.8). */
export function moraleMult(b: B, morale: number, routing: boolean): number {
  if (routing) return b.moraleMult.routing;
  return morale >= b.waverAt ? b.moraleMult.steady : b.moraleMult.wavering;
}

/** Fatigue multiplier: stamina ≥ lowAt → 1.0 else 0.8 (§31.8). */
export function fatigueMult(b: B, stamina: number): number {
  return stamina >= b.fatigue.lowAt ? 1 : b.fatigue.lowMult;
}

/** Inputs of atk_eff / def_eff that do not depend on the opponent. */
export interface EffInputs {
  base: number;
  /** Weapon (atk) or armour (def) multiplier for the side's tier. */
  equipMult: number;
  command: number;
  vetStars: number;
  stamina: number;
  /** Product of every other factor (morale, omen, specials, formation, terrain, fort …). */
  extra: number;
}

/**
 * atk_eff = atk × weaponMult × (1 + 0.02×Cmd) × (1 + 0.05×vet) × fatigueMult × moraleMult × omen × specials
 * def_eff = def × armourMult × (1 + 0.02×Cmd) × (1 + 0.05×vet) × fatigueMult × formationDef × terrainDef × fortDef
 * (the opponent-independent factors after `base × equip` are folded into `extra` by the caller).
 */
export function effStat(b: B, x: EffInputs): number {
  return x.base * x.equipMult * (1 + b.commandBonus * x.command) * (1 + b.veterancyBonus * x.vetStars) * fatigueMult(b, x.stamina) * x.extra;
}

/** Which arc of the defender a blow comes from: 0 front, 1 side, 2 rear (§31.8 flank). */
export type FlankArc = 0 | 1 | 2;

/**
 * Arc of an attacker at direction (dx, dy) from a defender facing (fx, fy) (unit vector).
 * cos thresholds come from the tunables' frontArcDeg / rearArcDeg, precomputed by the caller.
 */
export function flankArc(fx: number, fy: number, dx: number, dy: number, cosFront: number, cosRear: number): FlankArc {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return 0;
  const c = (fx * dx + fy * dy) / len;
  if (c >= cosFront) return 0;
  if (c <= cosRear) return 2;
  return 1;
}

/** Flank multiplier: front 1.0, side 1.3 (1.4 against a wedge), rear 1.6. */
export function flankMult(b: B, arc: FlankArc, defenderFormation: FormationId): number {
  if (arc === 0) return b.flank.front;
  if (arc === 2) return b.flank.rear;
  return defenderFormation === 'wedge' ? b.formations.wedge.sideFlank : b.flank.side;
}

/**
 * Charge multiplier on contact (§31.8): the unit's charge (infantry 1.5, Strand-Riders 1.5, Corvani
 * horsemen 1.6), ×1.25 in wedge; against an intact front shield wall the charge is negated (→ 1.0).
 */
export function chargeMult(b: B, unit: ResolvedUnit, formation: FormationId, vsFrontShieldWall: boolean): number {
  if (vsFrontShieldWall) return b.charge.vsShieldWall;
  return unit.charge * (formation === 'wedge' ? b.formations.wedge.chargeMult : 1);
}

/**
 * Casualties per second inflicted on B by A (§31.8, before rand(0.9, 1.1)):
 * K_m × min(menA, frontage) × (atkA_eff / defB_eff) × flank × charge.
 */
export function meleeCasualtiesPerS(b: B, menA: number, formationA: FormationId, atkA: number, defB: number, flank: number, charge: number): number {
  if (menA <= 0 || defB <= 0) return 0;
  const front = Math.min(menA, frontage(b, formationA));
  return b.kMelee * front * (atkA / defB) * flank * charge;
}

/** Ranged accuracy at distance d (§31.10): max(0.25, 1 − 0.6 × d / range), + elevation bonus. */
export function rangedAccuracy(b: B, d: number, range: number, elevated: boolean): number {
  const base = Math.max(b.ranged.accMin, 1 - b.ranged.accSlope * (d / Math.max(range, 1e-9)));
  return elevated ? Math.min(1, base + b.ranged.elevationAccBonus) : base;
}

/** Effective range: ×1.2 when shooting from higher ground (§31.10). */
export function effectiveRange(b: B, range: number, elevated: boolean): number {
  return elevated ? range * b.ranged.elevationRangeMult : range;
}

/** Inputs of one volley (§31.10). */
export interface VolleyInputs {
  shooters: number;
  rangedAtk: number;
  weaponMult: number;
  leaderArchery: number;
  def: number;
  armourMult: number;
  accuracy: number;
  /** Product of cover × shieldWallFront × smoke × loose × terrain accuracy × other multipliers. */
  mods: number;
}

/**
 * hits = K_r × shooters × (rng × weaponMult × (1 + 0.03 × leaderArchery)) / (def × armourMult) × acc(d) × mods.
 * Hits are men struck (casualties), before the killed/wounded split.
 */
export function volleyHits(b: B, v: VolleyInputs): number {
  if (v.shooters <= 0 || v.def <= 0) return 0;
  const atk = v.rangedAtk * v.weaponMult * (1 + b.ranged.leaderArcheryBonus * v.leaderArchery);
  return (b.ranged.kRanged * v.shooters * atk) / (v.def * v.armourMult) * v.accuracy * v.mods;
}

/** Inputs of the starting morale formula (§31.10). */
export interface MoraleStartInputs {
  base: number;
  command: number;
  vetStars: number;
  omen?: OmenId;
  warHorn: boolean;
  /** Σ morale.ownSquad of the leader's traits/feats (Brave +10, Craven −10). */
  traitMod: number;
  /** Enemy Dread ≥ 50 and they sail drakkars. */
  enemyDreadDrakkar: boolean;
  /** Side-wide modifiers (setup.moraleMods) and culture bonuses. */
  extra: number;
}

/** base + 2×Cmd + 5×vet + omen + War-Horn 15 + Brave/Craven − (Dread with drakkar ? 5 : 0), clamped 0..100. */
export function moraleStart(b: B, x: MoraleStartInputs): number {
  const m = b.morale;
  let v = x.base + m.perCommand * x.command + m.perVeterancy * x.vetStars + x.traitMod + x.extra;
  if (x.omen) v += m.omen[x.omen];
  if (x.warHorn) v += m.warHorn;
  if (x.enemyDreadDrakkar) v -= m.dreadDrakkarPenalty;
  return clamp(v, 0, 100);
}

/** Morale change from losses in one step: −120 × (casualties / starting men). */
export function moraleFromLosses(b: B, casualties: number, startMen: number): number {
  if (startMen <= 0) return 0;
  return b.morale.lossesMult * (casualties / startMen);
}

/**
 * Fire-spread chance between two buildings (§31.10):
 * p = 0.25 × flammability × (1 + 0.75 × cos θ × windStr) × (Ember-Cloak ? 2 : 1) × extra,
 * θ = angle between the direction the wind blows TOWARD and the direction to the neighbour.
 * `windFromDeg` is the direction the wind blows FROM (clockwise from north; north = −y on the map).
 */
export function fireSpreadChance(
  b: B,
  flammability: number,
  windFromDeg: number,
  windStr: number,
  dx: number,
  dy: number,
  emberCloak: boolean,
  extra: number,
): number {
  const len = Math.sqrt(dx * dx + dy * dy);
  let cos = 0;
  if (len > 1e-9 && windStr > 0) {
    const toward = ((windFromDeg + 180) * PI) / 180;
    // Compass bearing → map vector: x = sin(bearing), y = −cos(bearing).
    const wx = dsin(toward);
    const wy = -dcos(toward);
    cos = (wx * dx + wy * dy) / len;
  }
  const p = b.fire.baseChance * flammability * (1 + b.fire.windCosWeight * cos * windStr) * (emberCloak ? b.fire.emberCloakMult : 1) * extra;
  return clamp(p, 0, 1);
}

/** HP lost by the player when wounded in the ranks (§31.10): roll × (1 − armour reduction). */
export function playerWoundHp(roll: number, armourTier: number, reductionPerTier: number): number {
  return roll * Math.max(0, 1 - reductionPerTier * Math.max(0, armourTier - 1));
}

/** §31.11 squad power: men × (atk_eff + def_eff + 0.6 × rng_eff) × (moraleStart / 60). */
export function squadPower(rangedWeight: number, moraleDivisor: number, men: number, atkEff: number, defEff: number, rngEff: number, morale: number): number {
  return men * (atkEff + defEff + rangedWeight * rngEff) * (morale / moraleDivisor);
}

/** §31.11 win probability for the side with power ratio r = P_A / P_B: r^k / (r^k + 1). */
export function winProbability(exponent: number, r: number, pow: (x: number, y: number) => number): number {
  if (!(r > 0)) return 0;
  if (!Number.isFinite(r)) return 1;
  const x = pow(r, exponent);
  return x / (x + 1);
}
