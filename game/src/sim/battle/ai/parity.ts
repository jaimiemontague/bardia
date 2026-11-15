/**
 * The auto-resolve parity harness (ADR-003: auto-resolve must stay within ±10% of simulated win
 * rates). For each matchup it builds fixture setups with varying seeds (and so varying maps), runs
 * the tactical engine with the battle AI on both sides to the end, and compares the attackers'
 * share of victories with the auto-resolve's predicted win probability (§31.11) for the same
 * setups. A stalemate ('none') counts as half a victory: neither side carried the field.
 *
 * Matchups mirror the game's own battles: the attacking party has a named leader on every squad and
 * no chief (the player's side when it attacks); the defenders are a chief's bodyguard and squads
 * under sergeants (an AI garrison or warband). Power ratios span Hopeless to Decisive, over field,
 * forest, river, beach, walled towns (palisade with a ram, ring-fort with torches, stone walls with
 * ladders), fortresses, night attacks, omens and guardians. Raids and cloister raids are reported
 * but not held to the bound: their victory is getting away with any loot (a different contest from
 * the power model; their loot, not their win rate, is what auto-resolve scales).
 *
 * Used by tools/battle-parity (full runs) and ai/parity.test.ts (a fast, looser version).
 */
import type { Content } from '@content/index';
import type { BattleTemplateId } from '@content/schemas/tunables/battle';
import type { BattleKind, BattleResult, BattleSetup, OmenId } from '@sim/core/state';
import { autoResolveBattle, predictBattle } from '../autoresolve';
import { BattleEngine } from '../engine/engine';
import { Rng } from '@sim/core/rng';
import { makeTestSetup, type FixtureOptions, type FixtureSquad } from '../testing';
import type { BattleAiFactory } from '../engine/types';

/** One matchup of the harness. */
export interface ParityMatchup {
  id: string;
  kind: BattleKind;
  template?: BattleTemplateId;
  attacker: FixtureSquad[];
  defender: FixtureSquad[];
  fortTier?: 0 | 1 | 2 | 3 | 4;
  approach?: 'night' | 'dawn' | 'challenge';
  omen?: OmenId;
  hasRam?: boolean;
  hasPitch?: boolean;
  ladders?: boolean;
  armourTier?: [number, number];
  weaponTier?: [number, number];
  /** Reported but not held to the bound (raids: victory = getting away with any loot). */
  informational?: boolean;
}

/** Results of one matchup. */
export interface ParityRow {
  id: string;
  kind: BattleKind;
  runs: number;
  /** Mean predicted attacker win probability (auto-resolve, §31.11). */
  predicted: number;
  /** Attackers' share of simulated victories (stalemates count half). */
  simulated: number;
  /** Share of stalemates. */
  draws: number;
  diff: number;
  informational: boolean;
  /** Within the tolerance (always true for informational rows). */
  ok: boolean;
  /** Mean share of each side's men lost in the simulated battles, and in the auto-resolve of the same setups. */
  lossShare: { simAttacker: number; simDefender: number; autoAttacker: number; autoDefender: number };
  avgDurationS: number;
  /** Auto-resolve victories in the same setups (its own draws), for a sanity check. */
  autoWins: number;
}

export interface ParityReport {
  rows: ParityRow[];
  /** Largest |diff| over the rows held to the bound. */
  worst: number;
  ok: boolean;
  battles: number;
}

export interface ParityOptions {
  runs: number;
  seed?: string;
  tolerance?: number;
  /** Battle AI for both sides (default: the engine's default AI). */
  ai?: BattleAiFactory;
  /** Run only these matchup ids. */
  only?: readonly string[];
  /** Called after each matchup (progress output). */
  onRow?: (row: ParityRow) => void;
  /** Hard cap on simulated seconds per battle (default: the tunables' maxDurationS). */
  maxSeconds?: number;
}

// ---------------------------------------------------------------------------------------------
// Matchups

const lead = (name: string, command: number, melee = 3, extra: Partial<NonNullable<FixtureSquad['leader']>> = {}) => ({ name, command, melee, role: 'lieutenant' as const, ...extra });
/** A party squad under a named leader (the attackers: no chief). */
const P = (unit: string, men: number, command = 3, melee = 3): FixtureSquad => ({ unit, men, leader: lead(`${unit} leader`, command, melee) });
/** The defenders' chief and his bodyguard. */
const C = (unit: string, men: number, command = 3, melee = 4): FixtureSquad => ({ unit, men, leader: { name: 'Chief', command, melee, role: 'chief' }, chief: true });
/** A squad under an unnamed sergeant. */
const U = (unit: string, men: number): FixtureSquad => ({ unit, men });

/** The harness's matchups (≥ 12 held to the bound). */
export const PARITY_MATCHUPS: readonly ParityMatchup[] = [
  // Open field: like against like, at even and uneven odds.
  { id: 'field-even', kind: 'field', template: 'field', attacker: [P('bondi', 50), P('bondi', 50), P('bondi', 50)], defender: [C('bondi', 50), U('bondi', 50), U('bondi', 50)] },
  { id: 'field-outnumbered', kind: 'field', template: 'field', attacker: [P('bondi', 45), P('bondi', 45), P('bondi', 45)], defender: [C('bondi', 60), U('bondi', 60), U('bondi', 60)] },
  { id: 'field-hopeless', kind: 'field', template: 'field', attacker: [P('bondi', 40), P('bondi', 40)], defender: [C('bondi', 60), U('bondi', 60), U('bondi', 60), U('bondi', 60)] },
  // Quality against numbers, and combined arms.
  { id: 'field-huscarls-vs-levy', kind: 'field', template: 'field', attacker: [P('huscarls', 40, 4), P('huscarls', 30, 3)], defender: [C('fyrdSpearmen', 50), U('fyrdSpearmen', 50), U('fyrdSpearmen', 50), U('fyrdSpearmen', 50)] },
  { id: 'field-mixed', kind: 'field', template: 'field', attacker: [P('huscarls', 40, 4, 5), P('bondi', 50), P('archers', 30, 2), P('berserkers', 20, 2)], defender: [C('thegns', 30), U('fyrdSpearmen', 40), U('fyrdSpearmen', 40), U('albricBowmen', 30)] },
  { id: 'field-archers', kind: 'field', template: 'field', attacker: [P('bondi', 50), P('archers', 40, 2), P('archers', 40, 2)], defender: [C('thegns', 35), U('fyrdSpearmen', 50), U('fyrdSpearmen', 50)] },
  { id: 'field-horsemen', kind: 'field', template: 'field', attacker: [P('huscarls', 40, 4), P('bondi', 50), P('bondi', 50)], defender: [C('menAtArms', 40), U('horsemen', 35), U('horsemen', 35), U('javelinmen', 40)] },
  // Ground and omens.
  { id: 'forest-defended', kind: 'field', template: 'forest', attacker: [P('bondi', 55), P('bondi', 55), P('wolfcoats', 25)], defender: [C('caelRaiders', 45), U('caelRaiders', 45), U('caelRaiders', 45)] },
  { id: 'river-crossing', kind: 'field', template: 'riverCrossing', attacker: [P('huscarls', 40, 4), P('bondi', 50), P('bondi', 50)], defender: [C('druzhina', 40), U('druzhina', 40), U('bondi', 50)] },
  { id: 'field-ill-omen', kind: 'field', template: 'field', omen: 'ill', attacker: [P('bondi', 55), P('bondi', 55), P('bondi', 55)], defender: [C('bondi', 50), U('bondi', 50), U('bondi', 50)] },
  { id: 'beach-landing', kind: 'beach', template: 'beach', omen: 'blessed', attacker: [P('huscarls', 40, 4), P('bondi', 50), P('archers', 30, 2)], defender: [C('thegns', 30), U('fyrdSpearmen', 50), U('fyrdSpearmen', 50), U('albricBowmen', 30)] },
  // Walls.
  { id: 'assault-palisade-ram', kind: 'assault', template: 'town', fortTier: 1, hasRam: true, attacker: [P('huscarls', 50, 5), P('bondi', 60, 4), P('bondi', 60, 4), P('archers', 40, 3)], defender: [C('thegns', 30), U('fyrdSpearmen', 45), U('fyrdSpearmen', 45), U('albricBowmen', 30)] },
  { id: 'assault-ringfort', kind: 'assault', template: 'town', fortTier: 2, hasPitch: true, attacker: [P('huscarls', 50, 5), P('bondi', 60, 4), P('bondi', 60, 4), P('archers', 40, 3)], defender: [C('thegns', 35), U('fyrdSpearmen', 45), U('fyrdSpearmen', 45), U('albricBowmen', 35)] },
  { id: 'fortress-ladders', kind: 'fortress', template: 'fortress', fortTier: 3, ladders: true, hasRam: true, attacker: [P('huscarls', 60, 6), P('huscarls', 50, 5), P('bondi', 70, 5), P('bondi', 70, 5), P('archers', 50, 4)], defender: [C('menAtArms', 40), U('menAtArms', 40), U('bondi', 50), U('albricBowmen', 30)] },
  { id: 'night-assault', kind: 'assault', template: 'village', approach: 'night', attacker: [P('wolfcoats', 25, 3), P('bondi', 45), P('bondi', 45)], defender: [C('thegns', 30), U('fyrdSpearmen', 45), U('fyrdSpearmen', 45), U('albricBowmen', 30)] },
  { id: 'guardian-barrow', kind: 'guardian', template: 'caveMouth', attacker: [P('huscarls', 40, 4), P('bondi', 50), P('bondi', 50)], defender: [U('barrowWardens', 30), U('barrowWardens', 25)] },
  { id: 'defense-of-hall', kind: 'defense', template: 'town', fortTier: 1, hasRam: true, attacker: [C('huscarls', 40, 4), U('bondi', 60), U('bondi', 60), U('archers', 40)], defender: [P('huscarls', 40, 4), P('bondi', 50), P('archers', 30, 2)] },
  // Raids (reported only).
  { id: 'raid-village', kind: 'raid', template: 'village', informational: true, attacker: [P('huscarls', 40, 4), P('bondi', 50), P('archers', 30, 2)], defender: [C('thegns', 30), U('fyrdSpearmen', 40), U('fyrdSpearmen', 40), U('albricBowmen', 30)] },
  { id: 'cloister-raid', kind: 'cloister', template: 'cloister', informational: true, attacker: [P('bondi', 50), P('bondi', 50)], defender: [C('cloisterGuard', 25, 1, 2), U('cloisterGuard', 15), U('monks', 12)] },
];

/** The fixture options of one run of a matchup. */
export function matchupSetup(content: Content, m: ParityMatchup, seed: string): BattleSetup {
  const opts: FixtureOptions = { kind: m.kind, seed, mapSeed: `${seed}|map`, attacker: m.attacker, defender: m.defender, playerSide: null };
  if (m.template !== undefined) opts.template = m.template;
  if (m.fortTier !== undefined) opts.fortTier = m.fortTier;
  if (m.approach !== undefined) opts.approach = m.approach;
  if (m.omen !== undefined) opts.omen = m.omen;
  if (m.hasRam !== undefined) opts.hasRam = m.hasRam;
  if (m.hasPitch !== undefined) opts.hasPitch = m.hasPitch;
  if (m.ladders !== undefined) opts.ladders = m.ladders;
  if (m.armourTier !== undefined) opts.armourTier = m.armourTier;
  if (m.weaponTier !== undefined) opts.weaponTier = m.weaponTier;
  return makeTestSetup(content, opts);
}

function lossShares(setup: BattleSetup, r: BattleResult): [number, number] {
  const men = (side: 'attacker' | 'defender') => (side === 'attacker' ? setup.attacker : setup.defender).squads.reduce((a, s) => a + s.men, 0);
  const lost = (side: 'attacker' | 'defender') => r.casualties.filter((c) => c.side === side).reduce((a, c) => a + c.killed + c.wounded + c.captured, 0);
  return [lost('attacker') / Math.max(1, men('attacker')), lost('defender') / Math.max(1, men('defender'))];
}

/** Runs one matchup `runs` times. */
export function runMatchup(content: Content, m: ParityMatchup, opts: ParityOptions): ParityRow {
  const seed = opts.seed ?? 'parity';
  const tol = opts.tolerance ?? 0.1;
  let wins = 0;
  let draws = 0;
  let pred = 0;
  let dur = 0;
  let autoWins = 0;
  const loss = { simAttacker: 0, simDefender: 0, autoAttacker: 0, autoDefender: 0 };
  const maxTicks = Math.ceil((opts.maxSeconds ?? content.tunables.battle.maxDurationS) * content.balance.battle.tickHz) + 1;
  for (let i = 0; i < opts.runs; i++) {
    const setup = matchupSetup(content, m, `${seed}|${m.id}|${i}`);
    pred += predictBattle(setup, content).winProbability;
    const engine = BattleEngine.create(setup, content, opts.ai ? { humanSides: [], ai: opts.ai } : { humanSides: [] });
    const r = engine.runToEnd(maxTicks);
    if (r.winner === 'attacker') wins++;
    else if (r.winner === 'none') draws++;
    dur += r.durationS;
    const [la, ld] = lossShares(setup, r);
    loss.simAttacker += la;
    loss.simDefender += ld;
    const auto = autoResolveBattle(setup, content, Rng.derive(setup.seed, 'autoresolve'));
    if (auto.winner === 'attacker') autoWins++;
    const [aa, ad] = lossShares(setup, auto);
    loss.autoAttacker += aa;
    loss.autoDefender += ad;
  }
  const n = Math.max(1, opts.runs);
  const predicted = pred / n;
  const simulated = (wins + 0.5 * draws) / n;
  const diff = simulated - predicted;
  const informational = m.informational === true;
  return {
    id: m.id,
    kind: m.kind,
    runs: opts.runs,
    predicted,
    simulated,
    draws: draws / n,
    diff,
    informational,
    ok: informational || Math.abs(diff) <= tol,
    lossShare: { simAttacker: loss.simAttacker / n, simDefender: loss.simDefender / n, autoAttacker: loss.autoAttacker / n, autoDefender: loss.autoDefender / n },
    avgDurationS: dur / n,
    autoWins: autoWins / n,
  };
}

/** Runs the harness over the matchups. */
export function runParity(content: Content, opts: ParityOptions, matchups: readonly ParityMatchup[] = PARITY_MATCHUPS): ParityReport {
  const rows: ParityRow[] = [];
  let battles = 0;
  for (const m of matchups) {
    if (opts.only && !opts.only.includes(m.id)) continue;
    const row = runMatchup(content, m, opts);
    rows.push(row);
    battles += row.runs;
    opts.onRow?.(row);
  }
  let worst = 0;
  for (const r of rows) if (!r.informational) worst = Math.max(worst, Math.abs(r.diff));
  return { rows, worst, ok: rows.every((r) => r.ok), battles };
}
