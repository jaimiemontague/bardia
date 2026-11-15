/**
 * Design key → balance.json path, for the keys of the design's §31.22 "Key starting values" excerpt
 * whose path in balance.json differs (they were grouped with related tunables). Every other §31.22
 * key exists at the same path. content.test.ts checks that each mapped path resolves to a value;
 * ARCHITECTURE.md §9 shows the same table.
 */
export const DESIGN_KEY_PATHS: Readonly<Record<string, string>> = {
  'battle.chargeS': 'battle.charge.durationS',
  'battle.chargeRunTiles': 'battle.charge.runTiles',
  'battle.kRanged': 'battle.ranged.kRanged',
  'battle.volleyS': 'battle.ranged.volleyS',
  'diplomacy.tributeCooldownDays': 'diplomacy.cooldownDays.tribute',
};

/** Every key of the §31.22 excerpt (design order). */
export const DESIGN_EXCERPT_KEYS: readonly string[] = [
  'economy.taxPerCapita',
  'economy.taxMult',
  'economy.prosperity',
  'economy.lieutenantWage',
  'economy.factorWage',
  'economy.rationPrice',
  'economy.rationsPerTon',
  'recruit.poolRate',
  'recruit.regenRate',
  'recruit.cooldownDays',
  'recruit.gatherDays',
  'battle.tickHz',
  'battle.kMelee',
  'battle.kRanged',
  'battle.volleyS',
  'battle.routAt',
  'battle.waverAt',
  'battle.chargeS',
  'battle.chargeRunTiles',
  'battle.tierStep',
  'battle.woundedShare',
  'autoresolve.exponent',
  'autoresolve.playerPenalty',
  'sailing.beachHours',
  'sailing.openHours',
  'sailing.staminaRowDrain',
  'sailing.staminaRest',
  'storms.season',
  'storms.seafaringReduction',
  'intel.decayDays',
  'intel.staleDays',
  'renown.decayPerMonth',
  'renown.decayAfterIdleMonths',
  'duel.parryBaseMs',
  'duel.parryPerAgilityMs',
  'duel.autoK',
  'diplomacy.tributeCooldownDays',
  'diplomacy.oddsScale',
];

/** The balance.json path of a design key (identity unless it is in DESIGN_KEY_PATHS). */
export function balancePathOf(designKey: string): string {
  return DESIGN_KEY_PATHS[designKey] ?? designKey;
}
