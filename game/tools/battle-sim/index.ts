/**
 * Runs headless tactical battles from a seed and prints their outcomes (both sides AI-controlled,
 * the placeholder or real battle AI from src/sim/battle/ai/), with per-step timing so balance and
 * performance can be checked from the command line.
 *
 *   npm run tool -- battle-sim [--kind raid] [--template village] [--seed s] [--count 10]
 *       [--culture albric] [--fort 0..4] [--approach dawn|night|challenge] [--site cave]
 *       [--attackers huscarls:40,bondi:50] [--defenders thegns:30!,fyrdSpearmen:40]
 *       [--events] [--json] [--compare]
 *
 * Squad lists are `unit:men` pairs; a trailing `!` marks the chief (defenders) / the player
 * (attackers; the first attacker squad is the player by default). `--compare` also runs the
 * auto-resolve on each setup and prints its winner next to the simulated one. `--events` prints
 * the battle log of every battle. `--json` prints one JSON line per battle instead of a table.
 */
import { getContent } from '../../src/content/index';
import type { BattleTemplateId } from '../../src/content/schemas/tunables/battle';
import { autoResolveBattle } from '../../src/sim/battle/autoresolve';
import { BattleEngine } from '../../src/sim/battle/engine/engine';
import { makeTestSetup, type FixtureOptions, type FixtureSquad } from '../../src/sim/battle/testing';
import { Rng } from '../../src/sim/core/rng';
import type { BattleKind, BattleResult, CultureId, SiteKind } from '../../src/sim/core/state';

interface Args {
  kind: BattleKind;
  template?: BattleTemplateId;
  seed: string;
  count: number;
  culture: CultureId;
  fort: 0 | 1 | 2 | 3 | 4;
  approach: 'night' | 'dawn' | 'challenge';
  site?: SiteKind;
  attackers?: FixtureSquad[];
  defenders?: FixtureSquad[];
  events: boolean;
  json: boolean;
  compare: boolean;
}

function squads(spec: string, side: 'attacker' | 'defender'): FixtureSquad[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s, k) => {
      const marked = s.endsWith('!');
      const [unit, men] = (marked ? s.slice(0, -1) : s).split(':');
      const f: FixtureSquad = { unit: unit ?? 'bondi', men: Math.max(1, Number(men ?? 30)) };
      if (side === 'attacker') f.leader = { name: `Leader ${k + 1}`, command: 3, melee: 4, isPlayer: marked || k === 0, role: marked || k === 0 ? 'player' : 'lieutenant' };
      else if (marked) {
        f.leader = { name: 'Chief', command: 3, melee: 4, role: 'chief' };
        f.chief = true;
      }
      return f;
    });
}

function parse(argv: string[]): Args {
  const a: Args = { kind: 'raid', seed: 'sim', count: 5, culture: 'albric', fort: 0, approach: 'dawn', events: false, json: false, compare: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i] ?? '';
    if (k === '--kind') a.kind = v() as BattleKind;
    else if (k === '--template') a.template = v() as BattleTemplateId;
    else if (k === '--seed') a.seed = v();
    else if (k === '--count') a.count = Math.max(1, Number(v()));
    else if (k === '--culture') a.culture = v() as CultureId;
    else if (k === '--fort') a.fort = Math.max(0, Math.min(4, Number(v()))) as Args['fort'];
    else if (k === '--approach') a.approach = v() as Args['approach'];
    else if (k === '--site') a.site = v() as SiteKind;
    else if (k === '--attackers') a.attackers = squads(v(), 'attacker');
    else if (k === '--defenders') a.defenders = squads(v(), 'defender');
    else if (k === '--events') a.events = true;
    else if (k === '--json') a.json = true;
    else if (k === '--compare') a.compare = true;
  }
  return a;
}

function sideLoss(r: BattleResult, side: 'attacker' | 'defender'): { killed: number; wounded: number; captured: number } {
  const out = { killed: 0, wounded: 0, captured: 0 };
  for (const c of r.casualties) {
    if (c.side !== side) continue;
    out.killed += c.killed;
    out.wounded += c.wounded;
    out.captured += c.captured;
  }
  return out;
}

function main(): void {
  const args = parse(process.argv.slice(2));
  const content = getContent();
  const wins: Record<string, number> = { attacker: 0, defender: 0, none: 0 };
  let agree = 0;
  let totalTicks = 0;
  let totalMs = 0;
  let worstMs = 0;
  for (let n = 0; n < args.count; n++) {
    const seed = `${args.seed}-${n}`;
    const opts: FixtureOptions = { kind: args.kind, seed, culture: args.culture, fortTier: args.fort, approach: args.approach, hasRam: true, hasPitch: true, playerSide: null };
    if (args.template) opts.template = args.template;
    if (args.site) opts.siteKind = args.site;
    if (args.attackers) opts.attacker = args.attackers;
    if (args.defenders) opts.defender = args.defenders;
    const setup = makeTestSetup(content, opts);
    const engine = BattleEngine.create(setup, content, { humanSides: [] });
    let worstStep = 0;
    const t0 = process.hrtime.bigint();
    while (engine.status !== 'ended' && engine.tick < 20 * 60 * 40) {
      if (engine.status === 'duelRequested') {
        engine.autoResolveDuel();
        continue;
      }
      const s0 = process.hrtime.bigint();
      engine.step(1);
      const ms = Number(process.hrtime.bigint() - s0) / 1e6;
      if (ms > worstStep) worstStep = ms;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const r = engine.result() ?? engine.concede('none');
    const end = engine.state.end;
    wins[r.winner] = (wins[r.winner] ?? 0) + 1;
    totalTicks += engine.tick;
    totalMs += ms;
    worstMs = Math.max(worstMs, worstStep);
    let auto: BattleResult | null = null;
    if (args.compare) {
      auto = autoResolveBattle(setup, content, Rng.derive(setup.seed, 'autoresolve'));
      if (auto.winner === r.winner) agree++;
    }
    const la = sideLoss(r, 'attacker');
    const ld = sideLoss(r, 'defender');
    if (args.json) {
      console.log(JSON.stringify({ seed, ticks: engine.tick, msPerStep: ms / Math.max(1, engine.tick), worstStepMs: worstStep, end, result: r, auto: auto?.winner }));
    } else {
      console.log(
        `${seed.padEnd(14)} ${r.winner.padEnd(8)} ${(end?.reason ?? '-').padEnd(9)} ${r.durationS.toFixed(0).padStart(5)}s  ` +
          `A lost ${la.killed}/${la.wounded}/${la.captured}  D lost ${ld.killed}/${ld.wounded}/${ld.captured}  ` +
          `loot ${r.lootValue}  burned ${r.buildingsBurned}  chief ${r.chief.killed ? 'killed' : r.chief.captured ? 'captured' : '-'}  ` +
          `step ${(ms / Math.max(1, engine.tick)).toFixed(3)}ms (max ${worstStep.toFixed(2)})${auto ? `  auto:${auto.winner}` : ''}`,
      );
    }
    if (args.events) {
      for (const e of engine.events()) {
        const vars = e.vars ? ` ${JSON.stringify(e.vars)}` : '';
        console.log(`   ${(e.tick / 20).toFixed(1).padStart(6)}s ${e.kind}${e.side ? ` [${e.side}]` : ''}${e.squad ? ` ${e.squad}` : ''}${e.target ? ` -> ${e.target}` : ''}${e.value !== undefined ? ` (${e.value})` : ''}${vars}`);
      }
    }
  }
  if (!args.json) {
    console.log(
      `\n${args.count} battles (${args.kind}${args.template ? `/${args.template}` : ''}): attacker ${wins.attacker}, defender ${wins.defender}, none ${wins.none}; ` +
        `avg ${(totalTicks / args.count / 20).toFixed(0)}s simulated, ${(totalMs / Math.max(1, totalTicks)).toFixed(3)} ms/step, worst step ${worstMs.toFixed(2)} ms` +
        (args.compare ? `; auto-resolve agreed ${agree}/${args.count}` : ''),
    );
  }
}

main();
