/**
 * Rules shared by the engine and auto-resolve, so both read the same numbers (parity, §33 M5 ①).
 */
import type { Balance } from '@content/schemas/balance';
import { tierMult } from '@sim/core/balance';
import { clamp } from '@sim/core/dmath';
import type { SeaBattleSetup, SeaSideSetup, SeaShipSetup } from '@sim/core/state';

/** The two sides in engine order (0 attacker, 1 defender). */
export function sidesOf(setup: SeaBattleSetup): [SeaSideSetup, SeaSideSetup] {
  return [setup.attacker, setup.defender];
}

/** True when any ship of the side is a drakkar (dread, fleet morale). */
export function hasDrakkar(side: SeaSideSetup): boolean {
  return side.ships.some((s) => s.type === 'drakkar');
}

/**
 * Starting morale of a side (§31.10 adapted to the sea): fleet morale + 2 × Command + omen (the
 * player's side) + the drakkar fleet-morale bonus − 5 when the enemy has Dread ≥ 50 and a drakkar.
 */
export function sideStartMorale(balance: Balance, setup: SeaBattleSetup, sideIdx: 0 | 1): number {
  const [a, d] = sidesOf(setup);
  const side = sideIdx === 0 ? a : d;
  const enemy = sideIdx === 0 ? d : a;
  const bm = balance.battle.morale;
  let m = side.morale + bm.perCommand * (side.command ?? 0);
  if (setup.omen !== undefined && side.isPlayer) m += balance.omens.modifiers[setup.omen].battleMorale;
  let fleetMorale = 0;
  for (const s of side.ships) fleetMorale = Math.max(fleetMorale, balance.ships[s.type].fleetMorale);
  m += fleetMorale;
  if ((enemy.dread ?? 0) >= bm.dreadDrakkarMin && hasDrakkar(enemy)) m -= bm.dreadDrakkarPenalty;
  return clamp(m, 1, 100);
}

/** Melee attack/defence after equipment tiers (§12.4). */
export function shipAtkEff(balance: Balance, side: SeaSideSetup, ship: SeaShipSetup): number {
  return (ship.atk ?? 4) * tierMult(balance, side.weaponTier);
}
export function shipDefEff(balance: Balance, side: SeaSideSetup, ship: SeaShipSetup): number {
  return (ship.def ?? 4) * tierMult(balance, side.armourTier);
}

/** Ranged attack of the men on the bow after the weapon tier. */
export function shipRangedAtk(balance: Balance, side: SeaSideSetup, ship: SeaShipSetup, levyRangedAtk: number): number {
  return (ship.rangedAtk ?? levyRangedAtk) * tierMult(balance, side.weaponTier);
}

/** Total men aboard a side's ships. */
export function sideCrew(side: SeaSideSetup): number {
  let n = 0;
  for (const s of side.ships) n += s.crew;
  return n;
}
