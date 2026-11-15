/**
 * Unit access helpers over balance.json `units` (§12.2): the player's roster, culture uniques and
 * the base types they replace, enemy rosters by culture (period changes: Corvani horsemen and
 * javelinmen instead of lancers and crossbowmen, human or animal guardians only), requirement
 * parsing, bounties with the equipment-tier surcharge and culture modifiers, veterancy stars, squad
 * caps and effective stats. All pure.
 */
import type { Content } from '@content/index';
import type { Balance, UnitDef } from '@content/schemas/balance';
import type { CultureId } from '@content/schemas/ids';
import { tierMult } from '@sim/core/balance';
import { clamp } from '@sim/core/dmath';
import type { FactionId, GameState, Settlement, UnitTypeId } from '@sim/core/state';
import { buildingTier, oldWaysFavor, realmModifier } from './realm';

/** The unit definition, or undefined for unknown ids. */
export function findUnit(balance: Balance, id: string): UnitDef | undefined {
  return Object.hasOwn(balance.units, id) ? balance.units[id] : undefined;
}

/** True for units the player can muster (side 'player' with a bounty and a wage). */
export function isPlayerUnit(balance: Balance, id: string): boolean {
  const u = findUnit(balance, id);
  return u !== undefined && u.side === 'player' && u.bounty !== undefined && u.wage !== undefined;
}

/** Every player unit id in balance order (base types and culture uniques). */
export function playerUnitIds(balance: Balance): UnitTypeId[] {
  return Object.keys(balance.units).filter((id) => isPlayerUnit(balance, id));
}

/** The base type a culture unique replaces (itself for base types). */
export function baseUnitOf(balance: Balance, id: string): UnitTypeId {
  let current = id;
  for (let i = 0; i < 8; i++) {
    const u = findUnit(balance, current);
    if (!u?.replaces) return current;
    current = u.replaces;
  }
  return current;
}

/** The culture unique that replaces `baseId` for `culture`, if any (Skarn huscarls → Fjord-Wall Huscarls). */
export function cultureUniqueFor(balance: Balance, baseId: string, culture: CultureId): UnitTypeId | undefined {
  for (const [id, u] of Object.entries(balance.units)) {
    if (u.side === 'player' && u.culture === culture && u.replaces === baseId) return id;
  }
  return undefined;
}

/**
 * The units a holding of `culture` offers on the Muster screen, in balance order: base types not
 * replaced by a unique of that culture, plus that culture's uniques (§12.2 "these replace or upgrade
 * the base type for that culture"). Requirements (Hall II, berserker cap …) are checked separately.
 */
export function musterRoster(balance: Balance, culture: CultureId): UnitTypeId[] {
  const out: UnitTypeId[] = [];
  for (const id of playerUnitIds(balance)) {
    const u = balance.units[id] as UnitDef;
    if (u.culture !== undefined) {
      if (u.culture === culture) out.push(id);
      continue;
    }
    if (cultureUniqueFor(balance, id, culture) === undefined) out.push(id);
  }
  return out;
}

/** Units native to a culture (its enemy roster, e.g. the Corvani horsemen, javelinmen and men-at-arms). */
export function cultureRoster(balance: Balance, culture: CultureId): UnitTypeId[] {
  return Object.keys(balance.units).filter((id) => balance.units[id]?.culture === culture);
}

/** Generic units of a side without a culture (outlaws, cloister guard; guardians; beasts). */
export function genericUnits(balance: Balance, side: UnitDef['side']): UnitTypeId[] {
  return Object.keys(balance.units).filter((id) => {
    const u = balance.units[id] as UnitDef;
    return u.side === side && u.culture === undefined;
  });
}

/** Why a unit cannot be mustered at a holding (requirement codes), or [] when it can. */
export function unmetRequirements(state: GameState, content: Content, holding: Settlement, unitId: string): string[] {
  const balance = content.balance;
  const u = findUnit(balance, unitId);
  if (!u) return ['unknownUnit'];
  if (!isPlayerUnit(balance, unitId)) return ['notRecruitable'];
  if (!musterRoster(balance, holding.culture).includes(unitId)) return [u.culture !== undefined ? 'culture' : 'replaced'];
  const out: string[] = [];
  for (const req of u.requires ?? []) {
    const [kind, arg] = req.split(':');
    if (kind === 'hall') {
      if (buildingTier(holding, 'hall') < Number(arg ?? 0)) out.push(`hall:${String(arg)}`);
    } else if (kind === 'culture') {
      if (holding.culture !== arg) out.push(req);
    } else if (kind === 'renownCap') {
      if (berserkerCap(state, balance) <= 0) out.push(req);
    } else if (kind === 'oldWaysFavor') {
      if (oldWaysFavor(state) < 0) out.push(req);
    } else if (kind === 'building') {
      const [, building, tier] = req.split(':');
      if (buildingTier(holding, building ?? '') < Number(tier ?? 1)) out.push(req);
    } else {
      out.push(req);
    }
  }
  return out;
}

/** True if the unit counts against the berserker cap (it requires 'renownCap'). */
export function isCappedByRenown(balance: Balance, unitId: string): boolean {
  return findUnit(balance, unitId)?.requires?.includes('renownCap') ?? false;
}

/** §31.5: berserkerCap = min(cap, floor(renown / divisor)) — 0 when Old Ways Favor is negative. */
export function berserkerCap(state: GameState, balance: Balance): number {
  if (oldWaysFavor(state) < 0) return 0;
  const renown = Math.max(0, state.player.house.renown);
  return Math.min(balance.recruit.berserkerCap, Math.floor(renown / balance.recruit.berserkerRenownDivisor));
}

/** The equipment surcharge per recruit: bountyPerTierPerTrack × Σ (tier − 1) over both tracks (§12.4). */
export function equipmentSurcharge(balance: Balance, armourTier: number, weaponTier: number): number {
  const step = balance.equipment.bountyPerTierPerTrack;
  return step * (Math.max(0, armourTier - 1) + Math.max(0, weaponTier - 1));
}

/** Bounty per recruit for a faction: base × (1 + unit.<id>.bountyPct/100), rounded, + equipment surcharge. */
export function unitBounty(state: GameState, content: Content, factionId: FactionId, unitId: string): number {
  const u = findUnit(content.balance, unitId);
  if (!u || u.bounty === undefined) return 0;
  const pct = realmModifier(state, content, factionId, `unit.${unitId}.bountyPct`);
  const base = Math.max(0, Math.round(u.bounty * (1 + pct / 100)));
  const f = state.factions[factionId];
  return base + equipmentSurcharge(content.balance, f?.armouryTier ?? 1, f?.weaponTier ?? 1);
}

/** Monthly wage per man (economy pays it; shown on the Muster screen). */
export function unitWage(balance: Balance, unitId: string): number {
  return findUnit(balance, unitId)?.wage ?? 0;
}

/** Veterancy stars (0–3) for battles survived (§12.6: ★ after 1, ★★ after 3, ★★★ after 6). */
export function vetStarsFor(balance: Balance, battles: number): 0 | 1 | 2 | 3 {
  let stars = 0;
  balance.squads.veterancyBattles.forEach((need, i) => {
    if (battles >= need) stars = i + 1;
  });
  return clamp(stars, 0, 3) as 0 | 1 | 2 | 3;
}

/** The fewest battles that earn `stars` (inverse of vetStarsFor). */
export function battlesForStars(balance: Balance, stars: number): number {
  if (stars <= 0) return 0;
  const table = balance.squads.veterancyBattles;
  return table[Math.min(stars, table.length) - 1] ?? 0;
}

/** §12.3 squad cap: min(maxCap, baseCap + capPerCommand × Command), further capped by the unit's maxPerSquad. */
export function squadCap(balance: Balance, command: number, unitId?: string): number {
  const s = balance.squads;
  let cap = Math.min(s.maxCap, s.baseCap + s.capPerCommand * Math.max(0, command));
  const max = unitId !== undefined ? findUnit(balance, unitId)?.maxPerSquad : undefined;
  if (max !== undefined) cap = Math.min(cap, max);
  return cap;
}

/** Per-man attack, defence and morale with equipment tiers and veterancy (before battle-time factors). */
export function effectiveUnitStats(
  balance: Balance,
  unitId: string,
  armourTier: number,
  weaponTier: number,
  vetStars: number,
): { atk: number; def: number; morale: number; ranged?: number } {
  const u = findUnit(balance, unitId);
  if (!u) return { atk: 0, def: 0, morale: 0 };
  const vet = 1 + balance.squads.veterancyPerStar * clamp(vetStars, 0, 3);
  const out: { atk: number; def: number; morale: number; ranged?: number } = {
    atk: u.atk * tierMult(balance, weaponTier) * vet,
    def: u.def * tierMult(balance, armourTier) * vet,
    morale: u.morale * vet,
  };
  if (u.ranged) out.ranged = u.ranged.atk * tierMult(balance, weaponTier) * vet;
  return out;
}
