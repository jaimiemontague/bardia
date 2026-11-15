/**
 * Duel auto-resolve (design §14.8):
 *
 *   DuelRating = 2×Melee + Might + Agility + Vigor/2 + 3×(weaponTier−1) + 3×(armourTier−1) + level/2
 *                + traits (Brave +2, Towering +3, Wrathful +2, Craven −3) + relics
 *   P(A wins)  = 1 / (1 + e^(−0.25 × (R_A − R_B)))            (k = balance.duel.autoK, via dmath)
 *
 * The rating itself is computed once per fighter into `DuelistProfile.rating` (stats.ts
 * `duelRating`). Injury rolls for the loser (and the winner's 20% chance) are part of the §14.9
 * outcome (outcome.ts), shared with fought duels.
 */
import type { Balance } from '@content/schemas/balance';
import { clamp, dsigmoid } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { DuelSetup } from '@sim/core/state';
import type { DuelFightSummary, DuelSide } from './types';

/** §14.8 `P(A wins) = 1 / (1 + e^(−k × (R_A − R_B)))`. */
export function duelWinProbability(balance: Balance, ratingA: number, ratingB: number): number {
  return dsigmoid(balance.duel.autoK * (ratingA - ratingB));
}

/** The auto-resolved fight: one draw decides the winner; the loser's remaining HP is a nominal share. */
export interface AutoResolveResult {
  winner: DuelSide;
  /** Probability that A wins. */
  pA: number;
  summary: DuelFightSummary;
}

/**
 * Auto-resolves a duel with profiles. Consumes exactly two draws from `rng` (the winner, then the
 * winner's remaining HP share for the summary), so callers can rely on the stream position.
 */
export function autoResolveDuel(setup: DuelSetup, balance: Balance, rng: RandomSource): AutoResolveResult {
  const profiles = setup.profiles;
  if (!profiles) throw new RangeError(`duel ${setup.id}: setup has no fighter profiles`);
  const pA = duelWinProbability(balance, profiles.a.rating, profiles.b.rating);
  const winner: DuelSide = rng.float() < pA ? 'a' : 'b';
  // The winner's HP left: the clearer the favourite, the less the win cost (for the winner-injury scaling of fought duels only).
  const pWin = winner === 'a' ? pA : 1 - pA;
  const winnerHp = clamp(100 * (0.2 + 0.6 * pWin * rng.float() + 0.2 * pWin), 1, 100);
  const loserHp = setup.stakes === 'firstBlood' ? clamp(winnerHp * 0.8, 1, 100) : 0;
  const durationS = balance.duel.durationS[0] + (balance.duel.durationS[1] - balance.duel.durationS[0]) * (1 - Math.abs(pA - 0.5) * 2);
  const reason = setup.stakes === 'firstBlood' ? 'firstBlood' : 'down';
  return {
    winner,
    pA,
    summary: {
      winner,
      reason,
      durationS,
      hpPct: winner === 'a' ? { a: winnerHp, b: loserHp } : { a: loserHp, b: winnerHp },
      tauntsLanded: { a: 0, b: 0 },
    },
  };
}
