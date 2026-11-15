/**
 * Readability rules shared by the real-time engine, its AI and the Assisted Mode (design §14.6):
 * the intent-glyph timing rule and the glyph kinds.
 */
import type { DuelSide, GlyphKind, StrikeHeight } from './types';

/** Attack kinds of the real-time engine. */
export type AttackKind = 'light' | 'heavy' | 'bash';

/**
 * §14.6 intent-glyph timing: the fraction of the opponent's wind-up after which the viewer sees
 * the glyph — 0 (from the start) if viewer Wits ≥ opponent Wits + lead, 0.5 (mid wind-up) if
 * roughly equal, null (never) if far lower. `lead` = balance.duel.glyphWitsLead (2).
 */
export function glyphShowFraction(viewerWits: number, opponentWits: number, lead: number): 0 | 0.5 | null {
  const diff = viewerWits - opponentWits;
  if (diff >= lead) return 0;
  if (diff > -lead) return 0.5;
  return null;
}

/** The glyph kind for an attack (§14.6: high / low / heavy / bash). */
export function glyphKind(attack: AttackKind, height: StrikeHeight): GlyphKind {
  if (attack === 'bash') return 'bash';
  if (attack === 'heavy') return 'heavy';
  return height;
}

const OTHER: Readonly<Record<DuelSide, DuelSide>> = { a: 'b', b: 'a' };

/** The other side. */
export function otherSide(side: DuelSide): DuelSide {
  return OTHER[side];
}
