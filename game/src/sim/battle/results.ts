/**
 * Pieces of a BattleResult shared by the tactical engine's result builder and the auto-resolve:
 * the killed / wounded / captured split (§31.8, §31.11), casualties per source container (so the
 * module can write them back with `killMen`), loot taken from the place's portable wealth, and
 * leader XP (§22.1 battle sources).
 */
import type { Balance } from '@content/schemas/balance';
import type { BattleCasualties, BattleResult, CharId, GoodId, Squad } from '@sim/core/state';
import type { BattleTunables } from './data';
import type { BattleLootPool, BattleSideKey, BattleSquadLoss, SquadSourceShare } from './types';
import { roundTo, splitBy } from './util';

/** Whole men a squad lost, before the killed/wounded/captured split. */
export interface SquadLossInput {
  side: BattleSideKey;
  leaderId: CharId;
  unit: string;
  startMen: number;
  /** Men struck down (killed + wounded). */
  lost: number;
  /** Men taken while surrendering (monks, a town that gave up). */
  surrendered: number;
  sources: readonly SquadSourceShare[];
}

/** Casualty rows of one squad: killed and wounded split by `woundedShare`, a share of the loser's wounded captured. */
export function splitCasualties(lost: number, surrendered: number, woundedShare: number, loserCapturedShare: number, isLoser: boolean): { killed: number; wounded: number; captured: number } {
  let wounded = Math.round(lost * woundedShare);
  const killed = Math.max(0, lost - wounded);
  let captured = Math.max(0, surrendered);
  if (isLoser) {
    const cap = Math.round(wounded * loserCapturedShare);
    wounded -= cap;
    captured += cap;
  }
  return { killed, wounded, captured };
}

/**
 * Builds `casualties` (per squad, §30.8) and `squadLosses` (per side × source container × unit) for
 * a list of squads. Returns also the men each side lost (killed + wounded + captured).
 */
export function casualtyRows(
  squads: readonly SquadLossInput[],
  woundedShare: number,
  loserCapturedShare: number,
  loser: BattleSideKey | null,
): { casualties: BattleCasualties[]; squadLosses: BattleSquadLoss[]; lostBySide: Record<BattleSideKey, number> } {
  const casualties: BattleCasualties[] = [];
  const rows: BattleSquadLoss[] = [];
  const index: Record<string, number> = {};
  const lostBySide: Record<BattleSideKey, number> = { attacker: 0, defender: 0 };
  for (const s of squads) {
    const c = splitCasualties(s.lost, s.surrendered, woundedShare, loserCapturedShare, s.side === loser);
    casualties.push({ side: s.side, leaderId: s.leaderId, killed: c.killed, wounded: c.wounded, captured: c.captured });
    lostBySide[s.side] += c.killed + c.wounded + c.captured;
    const sources: readonly SquadSourceShare[] = s.sources.length > 0 ? s.sources : [{ kind: 'explicit', men: s.startMen }];
    const weights = sources.map((x) => x.men);
    const k = splitBy(c.killed, weights);
    const w = splitBy(c.wounded, weights);
    const cap = splitBy(c.captured, weights);
    sources.forEach((src, i) => {
      const key = `${s.side}|${src.kind}|${src.id ?? ''}|${s.unit}`;
      let at = Object.hasOwn(index, key) ? index[key]! : -1;
      if (at < 0) {
        at = rows.length;
        index[key] = at;
        rows.push({ side: s.side, unit: s.unit, source: src.id !== undefined ? { kind: src.kind, id: src.id } : { kind: src.kind }, killed: 0, wounded: 0, captured: 0 });
      }
      const row = rows[at]!;
      row.killed += k[i]!;
      row.wounded += w[i]!;
      row.captured += cap[i]!;
    });
  }
  return { casualties, squadLosses: rows, lostBySide };
}

/** Silver and goods carried off when `share` of the place's portable wealth is taken. */
export function lootFromShare(pool: BattleLootPool | undefined, share: number): { lootSilver: number; lootGoods: Partial<Record<GoodId, number>> } {
  const lootGoods: Partial<Record<GoodId, number>> = {};
  let lootSilver = 0;
  if (!pool || !(share > 0)) return { lootSilver, lootGoods };
  lootSilver = Math.floor(Math.max(0, pool.silver) * share);
  for (const good of Object.keys(pool.goods) as GoodId[]) {
    const tons = pool.goods[good];
    if (typeof tons !== 'number' || tons <= 0) continue;
    const v = roundTo(tons * share, 0.01);
    if (v > 0) lootGoods[good] = v;
  }
  return { lootSilver, lootGoods };
}

/**
 * XP for a named leader who survived (§22.1): presence base, plus the victory base and a per-enemy
 * amount (capped) — a loser's share of it on defeat — plus raid XP per silver taken by the winners.
 */
export function leaderXp(balance: Balance, t: BattleTunables, won: boolean, enemiesLost: number, lootValue: number): number {
  const src = balance.xp.sources;
  const perEnemy = Math.min(t.xp.perEnemyCap, src.battleVictoryPerEnemy * Math.max(0, enemiesLost));
  const base = src.battleVictoryBase + perEnemy;
  const raid = won ? src.raidPerSilver * Math.max(0, lootValue) : 0;
  return Math.round(t.xp.presentBase + (won ? base : base * t.xp.loserShare) + raid);
}

/** Every named leader of a setup's squads (squads led by an unnamed sergeant excluded). */
export function namedLeaders(squads: readonly Squad[]): CharId[] {
  const out: CharId[] = [];
  for (const sq of squads) if (sq.unnamed !== true && !out.includes(sq.leaderId)) out.push(sq.leaderId);
  return out;
}

/** The winner seen from `side`. */
export function sideWon(result: Pick<BattleResult, 'winner'>, side: BattleSideKey): boolean {
  return result.winner === side;
}
