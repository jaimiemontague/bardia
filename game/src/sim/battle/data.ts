/**
 * Content access for the battle engine: resolved unit stats (balance.json `units` plus the
 * battle tunables' `extraUnits`), ability cooldowns and small typed helpers. Pure functions over
 * `Content`; nothing here reads GameState.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import type { Tunables as BattleTunables } from '@content/schemas/tunables/battle';
import type { FormationId } from '@sim/core/state';

export type { BattleTunables };
export type BattleBalance = Balance['battle'];

/** Every ability the engine knows (§13.5). `retreat` is the global "Retreat to Ships" order. */
export const ABILITY_IDS = ['shieldWall', 'charge', 'volley', 'torch', 'ram', 'rally', 'frenzy', 'hide', 'challenge', 'douse'] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

/** A unit row with every optional field resolved (what the engine reads each tick). */
export interface ResolvedUnit {
  id: string;
  atk: number;
  def: number;
  rangedAtk: number;
  range: number;
  reloadS: number;
  speed: number;
  morale: number;
  formations: FormationId[];
  /** Abilities from the unit row (shieldWall, charge, volley, fireArrows, torch, ram, frenzy, hide, ambush, areaMaul). */
  abilities: string[];
  shieldWallDef: number;
  /** Charge multiplier (unit `charge`, else balance.battle.charge.infantry). */
  charge: number;
  cavalry: boolean;
  single: boolean;
  hp: number;
  maxPerSquad: number;
  nonCombatant: boolean;
  vsCavalryAtkMult: number;
  vsShieldWallAtkMult: number;
  shieldWallBonus: number;
  accuracyBonus: number;
  torchSpeedMult: number;
  shootWhileMoving: boolean;
  cannotEnterBuildings: boolean;
  neverRoutWhileObjective: boolean;
  maulDamage: number;
  maulRadiusTiles: number;
  fleeAtHpPct: number;
  /** Charges (abilities include 'charge') — not shield-wall-only units. */
  canCharge: boolean;
  hasRanged: boolean;
}

/** Bundle of the content the engine reads, resolved once per battle. */
export interface BattleData {
  content: Content;
  balance: Balance;
  b: BattleBalance;
  t: BattleTunables;
  units: Record<string, ResolvedUnit>;
}

function special(specials: Record<string, number> | undefined, key: string, fallback: number): number {
  const v = specials?.[key];
  return typeof v === 'number' ? v : fallback;
}

/** Resolves one unit id against balance.units, then the tunables' extraUnits. Throws for unknown ids. */
export function resolveUnit(content: Content, unitId: string): ResolvedUnit {
  const b = content.balance.battle;
  const def = content.balance.units[unitId];
  if (def) {
    const sp = def.specials;
    return {
      id: unitId,
      atk: def.atk,
      def: def.def,
      rangedAtk: def.ranged?.atk ?? 0,
      range: def.ranged?.range ?? 0,
      reloadS: def.ranged?.reloadS ?? b.ranged.volleyS,
      speed: def.speed,
      morale: def.morale,
      formations: [...def.formations],
      abilities: [...def.abilities],
      shieldWallDef: def.shieldWallDef ?? b.formations.shieldWall.def,
      charge: def.charge ?? b.charge.infantry,
      cavalry: def.cavalry === true,
      single: def.single === true,
      hp: def.hp ?? 0,
      maxPerSquad: def.maxPerSquad ?? 0,
      nonCombatant: false,
      vsCavalryAtkMult: special(sp, 'vsCavalryAtkMult', 1),
      vsShieldWallAtkMult: special(sp, 'vsShieldWallAtkMult', 1),
      shieldWallBonus: special(sp, 'shieldWallBonus', 0),
      accuracyBonus: special(sp, 'accuracyBonus', 0),
      torchSpeedMult: special(sp, 'torchSpeedMult', 1),
      shootWhileMoving: special(sp, 'shootWhileMoving', 0) > 0,
      cannotEnterBuildings: special(sp, 'cannotEnterBuildings', 0) > 0,
      neverRoutWhileObjective: special(sp, 'neverRoutWhileBarrowStands', 0) > 0,
      maulDamage: special(sp, 'maulDamage', 0),
      maulRadiusTiles: special(sp, 'maulRadiusTiles', 0),
      fleeAtHpPct: special(sp, 'fleeAtHpPct', 0),
      canCharge: def.abilities.includes('charge'),
      hasRanged: def.ranged !== undefined,
    };
  }
  const extra = content.tunables.battle.extraUnits[unitId];
  if (!extra) throw new RangeError(`battle: unknown unit '${unitId}'`);
  return {
    id: unitId,
    atk: extra.atk,
    def: extra.def,
    rangedAtk: 0,
    range: 0,
    reloadS: b.ranged.volleyS,
    speed: extra.speed,
    morale: extra.morale,
    formations: [...extra.formations],
    abilities: [...extra.abilities],
    shieldWallDef: b.formations.shieldWall.def,
    charge: b.charge.infantry,
    cavalry: false,
    single: false,
    hp: 0,
    maxPerSquad: 0,
    nonCombatant: extra.nonCombatant === true,
    vsCavalryAtkMult: 1,
    vsShieldWallAtkMult: 1,
    shieldWallBonus: 0,
    accuracyBonus: 0,
    torchSpeedMult: 1,
    shootWhileMoving: false,
    cannotEnterBuildings: false,
    neverRoutWhileObjective: false,
    maulDamage: 0,
    maulRadiusTiles: 0,
    fleeAtHpPct: 0,
    canCharge: extra.abilities.includes('charge'),
    hasRanged: false,
  };
}

/** True when `unitId` is known to balance.units or the battle tunables' extraUnits. */
export function isKnownUnit(content: Content, unitId: string): boolean {
  return Object.hasOwn(content.balance.units, unitId) || Object.hasOwn(content.tunables.battle.extraUnits, unitId);
}

/** Builds the per-battle content bundle (unit cache filled lazily by `unitOf`). */
export function battleData(content: Content): BattleData {
  return { content, balance: content.balance, b: content.balance.battle, t: content.tunables.battle, units: {} };
}

/** The resolved unit, cached in the bundle. */
export function unitOf(data: BattleData, unitId: string): ResolvedUnit {
  const hit = data.units[unitId];
  if (hit) return hit;
  const u = resolveUnit(data.content, unitId);
  data.units[unitId] = u;
  return u;
}

/** Cooldown of an ability in seconds (balance.battle.abilityCooldownS, then tunables, else 0). */
export function abilityCooldownS(data: BattleData, ability: AbilityId): number {
  const a = data.b.abilityCooldownS[ability];
  if (typeof a === 'number') return a;
  if (ability === 'rally') return data.b.morale.rallyCooldownS;
  return data.t.extraAbilityCooldownS[ability] ?? 0;
}

/** Equipment multiplier for a tier (§12.4): 1 + tierStep × (tier − 1), using the table when present. */
export function equipMult(balance: Balance, tier: number): number {
  const row = balance.equipment.tiers.find((r) => r.tier === tier);
  if (row) return row.mult;
  return 1 + balance.battle.tierStep * (tier - 1);
}

/** Fort-ring defence multiplier (§9.3). */
export function fortDefMult(balance: Balance, tier: number): number {
  return balance.fortTiers.find((r) => r.tier === tier)?.defMult ?? 1;
}

/** Gate HP for a fort tier (§9.3). */
export function gateHp(balance: Balance, tier: number): number {
  return balance.fortTiers.find((r) => r.tier === tier)?.gateHp ?? 0;
}

/** Value (silver) of a portable-wealth pool: its silver plus every good at its base price per ton. */
export function lootPoolValue(balance: Balance, pool: { silver: number; goods: Partial<Record<string, number>> } | undefined): number {
  if (!pool) return 0;
  let v = Math.max(0, pool.silver);
  for (const [good, tons] of Object.entries(pool.goods)) {
    const def = (balance.goods as Record<string, { basePerTon: number } | undefined>)[good];
    if (def && typeof tons === 'number' && tons > 0) v += tons * def.basePerTon;
  }
  return v;
}

/** Squad cap N = baseCap + capPerCommand × Command, at most maxCap (§12.3), and the unit's own cap. */
export function squadCap(balance: Balance, command: number, unit?: ResolvedUnit): number {
  const s = balance.squads;
  let cap = Math.min(s.maxCap, s.baseCap + s.capPerCommand * Math.max(0, command));
  if (unit && unit.maxPerSquad > 0) cap = Math.min(cap, unit.maxPerSquad);
  return cap;
}
