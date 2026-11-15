/**
 * The after-battle summary seen from the player's side (pure, from the setup and the engine's result):
 * the outcome, men lost on both sides (killed, wounded, taken), loot, buildings burned, and what became
 * of every named leader.
 */
import type { BattleSideKey } from '@sim/battle/types';
import type { BattleResult, BattleSetup } from '@sim/core/state';

export type BattleOutcome = 'victory' | 'defeat' | 'retreat' | 'draw';

export interface SideTally {
  men: number;
  killed: number;
  wounded: number;
  captured: number;
}

export interface LeaderLine {
  id: string;
  name: string;
  side: BattleSideKey;
  fate: string;
  isPlayer: boolean;
}

export interface BattleSummary {
  outcome: BattleOutcome;
  own: SideTally;
  enemy: SideTally;
  lootValue: number;
  lootSilver: number;
  lootGoods: { good: string; tons: number }[];
  buildingsBurned: number;
  durationS: number;
  leaders: LeaderLine[];
  chief: { killed: boolean; captured: boolean };
}

/** The outcome for `side`. */
export function outcomeFor(result: Pick<BattleResult, 'winner' | 'retreated'>, side: BattleSideKey): BattleOutcome {
  if (result.winner === side) return 'victory';
  if (result.winner === 'none') return 'draw';
  return result.retreated ? 'retreat' : 'defeat';
}

function tally(setup: BattleSetup, result: BattleResult, side: BattleSideKey): SideTally {
  const squads = side === 'attacker' ? setup.attacker.squads : setup.defender.squads;
  const out: SideTally = { men: squads.reduce((a, s) => a + s.men, 0), killed: 0, wounded: 0, captured: 0 };
  for (const c of result.casualties) {
    if (c.side !== side) continue;
    out.killed += c.killed;
    out.wounded += c.wounded;
    out.captured += c.captured;
  }
  return out;
}

/**
 * Builds the summary. `nameOf` resolves a leader id to a display name (campaign characters, else the
 * setup's leader records).
 */
export function summarize(setup: BattleSetup, result: BattleResult, side: BattleSideKey, nameOf: (id: string) => string | undefined): BattleSummary {
  const enemy: BattleSideKey = side === 'attacker' ? 'defender' : 'attacker';
  const leaders: LeaderLine[] = [];
  const fates = result.leaderFates ?? {};
  for (const key of ['attacker', 'defender'] as const) {
    const s = key === 'attacker' ? setup.attacker : setup.defender;
    for (const sq of s.squads) {
      if (sq.unnamed === true || leaders.some((l) => l.id === sq.leaderId)) continue;
      const info = setup.leaders?.[sq.leaderId];
      const name = nameOf(sq.leaderId) ?? info?.name;
      if (name === undefined) continue;
      leaders.push({ id: sq.leaderId, name, side: key, fate: fates[sq.leaderId] ?? 'fine', isPlayer: info?.isPlayer === true });
    }
  }
  leaders.sort((a, b) => (a.side === side ? 0 : 1) - (b.side === side ? 0 : 1));
  const goods = Object.entries(result.lootGoods ?? {})
    .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
    .map(([good, tons]) => ({ good, tons }));
  return {
    outcome: outcomeFor(result, side),
    own: tally(setup, result, side),
    enemy: tally(setup, result, enemy),
    lootValue: Math.round(result.lootValue),
    lootSilver: Math.round(result.lootSilver ?? 0),
    lootGoods: goods,
    buildingsBurned: result.buildingsBurned,
    durationS: Math.round(result.durationS),
    leaders,
    chief: { ...result.chief },
  };
}
