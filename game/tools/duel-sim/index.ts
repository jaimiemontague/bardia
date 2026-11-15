/**
 * Headless duel balance harness (design §14; ADR-003 parity spirit): AI vs AI duels in the real-time
 * engine (60 Hz), the Assisted Mode and auto-resolve, with win rates, durations and end reasons.
 *
 *   npm run tool -- duel-sim                       all matchups, 400 duels each, every mode
 *   npm run tool -- duel-sim --n 1000 --mode realtime --difficulty seaKing --style tricky
 *   npm run tool -- duel-sim --check               exit 1 unless the balance checks pass:
 *        equal fighters win 50% (±tolerance) and a +2 Melee advantage wins 65–75%, both for
 *        5 v 3 and for 7 v 5 (real time and auto-resolve; Assisted Mode is reported only, since
 *        it is decided mostly by reading tells). Run it per difficulty with --difficulty.
 *
 * Options: --n <duels per matchup> --mode realtime|assisted|auto|all --difficulty <id>
 *          --style aggressive|defensive|tricky|brute|mixed --stakes yield|death|firstBlood
 *          --arena hall|deck|beach|holmgang|field --seed <text> --check --quiet
 */
import { getContent } from '../../src/content/index';
import type { DifficultyId, DuelWeaponId } from '../../src/content/schemas/ids';
import { Rng } from '../../src/sim/core/rng';
import type { DuelSetup } from '../../src/sim/core/state';
import { AssistedDuel } from '../../src/sim/duel/assisted';
import { autoResolveDuel, duelWinProbability } from '../../src/sim/duel/autoresolve';
import { DuelEngine } from '../../src/sim/duel/engine';
import { testDuelSetup, type TestFighter } from '../../src/sim/duel/testing';
import { AI_STYLES, type AiStyle, type DuelArena, type DuelEndReason, type DuelFightSummary, type DuelStakes } from '../../src/sim/duel/types';

type Mode = 'realtime' | 'assisted' | 'auto';

interface Args {
  n: number;
  modes: Mode[];
  difficulty: DifficultyId;
  style: AiStyle | 'mixed';
  stakes: DuelStakes;
  arena: DuelArena;
  seed: string;
  check: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = get('mode') ?? 'all';
  return {
    n: Math.max(10, Number(get('n') ?? 400)),
    modes: mode === 'all' ? ['realtime', 'assisted', 'auto'] : [mode as Mode],
    difficulty: (get('difficulty') ?? 'raider') as DifficultyId,
    style: (get('style') ?? 'mixed') as AiStyle | 'mixed',
    stakes: (get('stakes') ?? 'yield') as DuelStakes,
    arena: (get('arena') ?? 'hall') as DuelArena,
    seed: get('seed') ?? 'duel-sim',
    check: argv.includes('--check'),
    quiet: argv.includes('--quiet'),
  };
}

interface Matchup {
  name: string;
  a: TestFighter;
  b: TestFighter;
  /** Expected A win-rate band for --check (absent: report only). */
  band?: [number, number];
  /** Modes the band applies to (default: all). */
  bandModes?: Mode[];
}

interface Stats {
  winsA: number;
  n: number;
  durationS: number;
  reasons: Partial<Record<DuelEndReason, number>>;
}

const content = getContent();

function fight(mode: Mode, setup: DuelSetup): DuelFightSummary {
  switch (mode) {
    case 'realtime':
      return new DuelEngine(setup, content, { ai: { a: true, b: true } }).run();
    case 'assisted':
      return new AssistedDuel(setup, content, { humanSide: null }).run();
    case 'auto':
      return autoResolveDuel(setup, content.balance, new Rng(`${setup.seed}|auto`)).summary;
  }
}

function runMatchup(mode: Mode, m: Matchup, args: Args): Stats {
  const stats: Stats = { winsA: 0, n: 0, durationS: 0, reasons: {} };
  const styleRng = new Rng(`${args.seed}|styles|${m.name}`);
  for (let i = 0; i < args.n; i++) {
    // Mirror every other duel (A on the right) so side order can never bias a matchup.
    const mirror = i % 2 === 1;
    const style = (): AiStyle => (args.style === 'mixed' ? styleRng.pick(AI_STYLES) : args.style);
    const sa = style();
    const sb = args.style === 'mixed' ? sa : style();
    const fa: TestFighter = { style: sa, ...m.a };
    const fb: TestFighter = { style: sb, ...m.b };
    const setup = testDuelSetup(mirror ? fb : fa, mirror ? fa : fb, { arena: args.arena, stakes: args.stakes, seed: `${args.seed}|${m.name}|${i}` });
    setup.difficulty = args.difficulty;
    const r = fight(mode, setup);
    const aWon = mirror ? r.winner === 'b' : r.winner === 'a';
    stats.n += 1;
    if (aWon) stats.winsA += 1;
    stats.durationS += r.durationS;
    stats.reasons[r.reason] = (stats.reasons[r.reason] ?? 0) + 1;
  }
  return stats;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const weapons = Object.keys(content.balance.weapons) as DuelWeaponId[];
  const matchups: Matchup[] = [
    { name: 'equal (axe v axe)', a: {}, b: {}, band: [0.44, 0.56] },
    // Assisted Mode (§14.7) is decided mostly by reading tells; stats only scale damage there, so
    // the +2 Melee band gates the real-time AI and auto-resolve (the Assisted figure is reported).
    { name: '+2 Melee (5 v 3)', a: { stats: { melee: 5 } }, b: { stats: { melee: 3 } }, band: [0.65, 0.75], bandModes: ['realtime', 'auto'] },
    // The same edge between two seasoned fighters must still count (no saturation above the pivot).
    { name: '+2 Melee (7 v 5)', a: { stats: { melee: 7 } }, b: { stats: { melee: 5 } }, band: [0.65, 0.75], bandModes: ['realtime', 'auto'] },
    { name: '+1 Melee (4 v 3)', a: { stats: { melee: 4 } }, b: { stats: { melee: 3 } } },
    { name: '+2 Might', a: { stats: { might: 6 } }, b: {} },
    { name: '+2 Agility', a: { stats: { agility: 6 } }, b: {} },
    { name: '+2 Vigor', a: { stats: { vigor: 6 } }, b: {} },
    { name: '+1 armour tier', a: { armourTier: 3 }, b: {} },
    ...weapons.filter((w) => w !== 'axe').map((w): Matchup => ({ name: `${w} v axe`, a: { weapon: w }, b: {} })),
  ];
  const failures: string[] = [];
  for (const mode of args.modes) {
    if (!args.quiet) console.log(`\n=== ${mode} — ${args.n} duels per matchup, difficulty ${args.difficulty}, style ${args.style}, ${args.stakes} in the ${args.arena} ===`);
    for (const m of matchups) {
      const t0 = process.hrtime.bigint();
      const s = runMatchup(mode, m, args);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const rate = s.winsA / s.n;
      const reasons = Object.entries(s.reasons)
        .map(([k, v]) => `${k} ${pct((v ?? 0) / s.n)}`)
        .join(', ');
      let verdict = '';
      if (m.band && (m.bandModes === undefined || m.bandModes.includes(mode))) {
        // Allow the binomial standard error on top of the band.
        const se = Math.sqrt((rate * (1 - rate)) / s.n);
        const ok = rate >= m.band[0] - 2 * se && rate <= m.band[1] + 2 * se;
        verdict = ok ? '  ✔' : `  ✘ (expected ${pct(m.band[0])}–${pct(m.band[1])})`;
        if (!ok) failures.push(`${mode}: ${m.name} won ${pct(rate)}`);
      }
      if (!args.quiet) {
        console.log(
          `${m.name.padEnd(22)} A wins ${pct(rate).padStart(6)}  avg ${(s.durationS / s.n).toFixed(1).padStart(5)} s  [${reasons}]  ${(ms / s.n).toFixed(2)} ms/duel${verdict}`,
        );
      }
    }
  }
  if (!args.quiet) {
    const base = testDuelSetup({}, {});
    const plus2 = testDuelSetup({ stats: { melee: 5 } }, { stats: { melee: 3 } });
    console.log(
      `\nAnalytic auto-resolve (§14.8): equal ${pct(duelWinProbability(content.balance, base.profiles!.a.rating, base.profiles!.b.rating))}, +2 Melee ${pct(duelWinProbability(content.balance, plus2.profiles!.a.rating, plus2.profiles!.b.rating))}`,
    );
  }
  if (args.check) {
    if (failures.length > 0) {
      console.error(`\nbalance check FAILED:\n  ${failures.join('\n  ')}`);
      process.exitCode = 1;
    } else console.log('\nbalance check passed.');
  }
}

main();
