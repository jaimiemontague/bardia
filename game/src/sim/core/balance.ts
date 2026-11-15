/**
 * Typed access to balance.json (design §31). The data is validated by the zod schema in
 * src/content/schemas/balance.ts; inside the simulation always read tunables from `ctx.balance`
 * (so tests and mods can substitute values) — never hard-code a number that belongs in balance.json.
 */
import type { Balance, DifficultyPreset, ShipDef, UnitDef } from '@content/schemas/balance';
import type { DifficultyId, ShipTypeId } from '@content/schemas/ids';

export { getBalance } from '@content/index';
export type { Balance, BuildingDef, DifficultyPreset, GoodDef, ShipDef, UnitDef, WeaponDef } from '@content/schemas/balance';

/** The difficulty preset (§5.5). */
export function difficultyPreset(balance: Balance, id: DifficultyId): DifficultyPreset {
  return balance.difficulty[id];
}

/** A unit definition; throws for unknown ids (content bug). */
export function unitDef(balance: Balance, id: string): UnitDef {
  const def = balance.units[id];
  if (!def) throw new RangeError(`balance: unknown unit '${id}'`);
  return def;
}

/** A ship definition. */
export function shipDef(balance: Balance, type: ShipTypeId): ShipDef {
  return balance.ships[type];
}

/** XP needed to reach `level` (§22.1 table; level 1 = 0). */
export function xpForLevel(balance: Balance, level: number): number {
  const table = balance.xp.levelTable;
  if (level <= 1) return 0;
  return table[Math.min(level, table.length) - 1] as number;
}

/** The level reached with `xp` total experience. */
export function levelForXp(balance: Balance, xp: number): number {
  const table = balance.xp.levelTable;
  let level = 1;
  for (let i = 0; i < table.length; i++) if (xp >= (table[i] as number)) level = i + 1;
  return level;
}

/** Index of the renown tier (§22.3) for a renown value (0 = Unknown). */
export function renownTierIndex(balance: Balance, renown: number): number {
  let idx = 0;
  balance.renown.tiers.forEach((t, i) => {
    if (renown >= t.min) idx = i;
  });
  return idx;
}

/** Equipment multiplier for a tier (§12.4): 1 + tierStep × (tier − 1). */
export function tierMult(balance: Balance, tier: number): number {
  return 1 + balance.battle.tierStep * (tier - 1);
}
