/**
 * Standings and loyalty in words (ARCHITECTURE §20 rule 5: words before numbers). Presentation only: these bands
 * say how a number reads to the player; no game rule depends on them. Used by the character sheet and the top
 * bar's portrait tooltip.
 */

export type HonorWord = 'spotless' | 'trusted' | 'fair' | 'doubted' | 'oathbreaker';
export type DreadWord = 'terrible' | 'feared' | 'wary' | 'none';
export type FavorWord = 'blessed' | 'favoured' | 'watched' | 'cold' | 'forsaken';
export type PietyWord = 'devout' | 'faithful' | 'lax';
export type LoyaltyWord = 'devoted' | 'loyal' | 'wavering' | 'disloyal';

/** Honor (-100..100) in a word. */
export function honorWord(v: number): HonorWord {
  if (v >= 60) return 'spotless';
  if (v >= 25) return 'trusted';
  if (v >= 0) return 'fair';
  if (v >= -40) return 'doubted';
  return 'oathbreaker';
}

/** Dread (0..100) in a word. */
export function dreadWord(v: number): DreadWord {
  if (v >= 70) return 'terrible';
  if (v >= 40) return 'feared';
  if (v >= 15) return 'wary';
  return 'none';
}

/** The gods' average Favor (-50..50) in a word. */
export function favorWord(v: number): FavorWord {
  if (v >= 25) return 'blessed';
  if (v >= 8) return 'favoured';
  if (v >= -7) return 'watched';
  if (v >= -25) return 'cold';
  return 'forsaken';
}

/** Piety (0..100) in a word. */
export function pietyWord(v: number): PietyWord {
  if (v >= 60) return 'devout';
  if (v >= 25) return 'faithful';
  return 'lax';
}

/** A follower's loyalty (0..100) in a word. */
export function loyaltyWord(v: number): LoyaltyWord {
  if (v >= 75) return 'devoted';
  if (v >= 50) return 'loyal';
  if (v >= 25) return 'wavering';
  return 'disloyal';
}

/** Average Favor over the gods, and the god most in favour. */
export function favorSummary(favor: Readonly<Record<string, number>>): {
  avg: number;
  top?: [string, number];
} {
  const gods = Object.entries(favor);
  if (gods.length === 0) return { avg: 0 };
  let top: [string, number] | undefined;
  let sum = 0;
  for (const g of gods) {
    sum += g[1];
    if (top === undefined || g[1] > top[1]) top = g;
  }
  return top ? { avg: Math.round(sum / gods.length), top } : { avg: Math.round(sum / gods.length) };
}
