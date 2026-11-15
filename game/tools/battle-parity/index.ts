/**
 * Auto-resolve parity harness (ADR-003): for every matchup, runs AI-against-AI tactical battles and
 * compares the attackers' simulated win rate with the auto-resolve's predicted win probability
 * (§31.11) for the same setups. The bound is ±10% (absolute) on every matchup held to it.
 *
 *   npm run tool -- battle-parity [--runs 200] [--seed parity] [--only id,id] [--tolerance 0.1]
 *       [--difficulty raider] [--json] [--list]
 *
 * Exit code 1 when a matchup is outside the tolerance. The matchups and the harness live in
 * src/sim/battle/ai/parity.ts (a fast version runs in ai/parity.test.ts).
 */
import { getContent } from '../../src/content/index';
import { createBattleAi } from '../../src/sim/battle/ai/index';
import { PARITY_MATCHUPS, runParity, type ParityRow } from '../../src/sim/battle/ai/parity';

interface Args {
  runs: number;
  seed: string;
  only?: string[];
  tolerance: number;
  difficulty?: string;
  json: boolean;
  list: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = { runs: 200, seed: 'parity', tolerance: 0.1, json: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i] ?? '';
    if (k === '--runs') a.runs = Math.max(1, Math.floor(Number(v())));
    else if (k === '--seed') a.seed = v();
    else if (k === '--only') a.only = v().split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    else if (k === '--tolerance') a.tolerance = Number(v());
    else if (k === '--difficulty') a.difficulty = v();
    else if (k === '--json') a.json = true;
    else if (k === '--list') a.list = true;
  }
  return a;
}

const pct = (x: number) => `${(x * 100).toFixed(1).padStart(5)}%`;

function line(r: ParityRow): string {
  const flag = r.informational ? 'info' : r.ok ? ' ok ' : 'FAIL';
  return (
    `${flag} ${r.id.padEnd(24)} ${r.kind.padEnd(9)} n=${String(r.runs).padStart(4)}  predicted ${pct(r.predicted)}  simulated ${pct(r.simulated)}  diff ${(r.diff >= 0 ? '+' : '') + (r.diff * 100).toFixed(1)}%` +
    `  draws ${pct(r.draws)}  losses sim A ${pct(r.lossShare.simAttacker)} D ${pct(r.lossShare.simDefender)} / auto A ${pct(r.lossShare.autoAttacker)} D ${pct(r.lossShare.autoDefender)}  ${r.avgDurationS.toFixed(0)}s`
  );
}

function main(): void {
  const args = parse(process.argv.slice(2));
  if (args.list) {
    for (const m of PARITY_MATCHUPS) console.log(`${m.id.padEnd(24)} ${m.kind}${m.informational ? ' (informational)' : ''}`);
    return;
  }
  const content = getContent();
  const t = content.tunables.battle;
  const aiOpts: { reactionS?: number; coordination?: number } = {};
  if (args.difficulty !== undefined) {
    const r = t.aiReactionS[args.difficulty];
    const c = t.ai.coordination[args.difficulty];
    if (r === undefined || c === undefined) throw new Error(`unknown difficulty '${args.difficulty}'`);
    aiOpts.reactionS = r;
    aiOpts.coordination = c;
  }
  const t0 = process.hrtime.bigint();
  const opts: Parameters<typeof runParity>[1] = {
    runs: args.runs,
    seed: args.seed,
    tolerance: args.tolerance,
    ai: createBattleAi(aiOpts),
    onRow: (r) => {
      if (args.json) console.log(JSON.stringify(r));
      else console.log(line(r));
    },
  };
  if (args.only) opts.only = args.only;
  const report = runParity(content, opts);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!args.json) {
    const held = report.rows.filter((r) => !r.informational);
    console.log(
      `\n${report.battles} battles in ${(ms / 1000).toFixed(1)} s (${(ms / Math.max(1, report.battles)).toFixed(1)} ms each); ` +
        `${held.filter((r) => r.ok).length}/${held.length} matchups within ±${(args.tolerance * 100).toFixed(0)}%, worst ${(report.worst * 100).toFixed(1)}%`,
    );
  }
  if (!report.ok) process.exitCode = 1;
}

main();
