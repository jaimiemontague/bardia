/**
 * Headless simulation runner.
 *
 *   npm run sim -- --seed ketil --days 365 [--difficulty raider] [--save-check] [--modules world,weather]
 *
 * Creates a game, advances day by day (stopping at pending decisions, which it auto-dismisses when
 * it can), and prints timing, the final date, a state hash and the save size. It fails (exit 1) on
 * invariant violations and on localisation keys emitted by the simulation that have no English
 * string in src/content/locales. `--modules` (or the BARDIA_MODULES environment variable, a
 * comma-separated list of module ids) runs a subset of the registry, e.g. to leave a broken module
 * out.
 */
import { headlessCommand } from '../src/sim/headless';
import { GameSession, checkInvariants, eventTextKeys, formatDate, hashString32, selectModules, type SimEvent } from '../src/sim/index';
import type { DifficultyId } from '../src/content/schemas/ids';
import { missingLocaleKeys } from '../src/content/locales/index';

interface Args {
  seed: string;
  days: number;
  difficulty: DifficultyId;
  saveCheck: boolean;
  modules: string[] | undefined;
}

function moduleList(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const eventKeys = (e: SimEvent): string[] => eventTextKeys(e);

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: 'bardia', days: 365, difficulty: 'raider', saveCheck: false, modules: moduleList(process.env.BARDIA_MODULES) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--seed') args.seed = next();
    else if (a === '--days') args.days = Number(next());
    else if (a === '--difficulty') args.difficulty = next() as DifficultyId;
    else if (a === '--save-check') args.saveCheck = true;
    else if (a === '--modules') args.modules = moduleList(next());
    else if (a === '--help' || a === '-h') {
      console.log('usage: npm run sim -- [--seed S] [--days N] [--difficulty hearthside|raider|seaKing|longWinter] [--save-check] [--modules a,b]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(args.days) || args.days < 0) throw new Error('--days must be a non-negative integer');
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const modules = selectModules(args.modules);
  const session = GameSession.newGame({ seed: args.seed, difficulty: args.difficulty }, { modules });
  const t1 = performance.now();
  let events = 0;
  let pendingStops = 0;
  const pendingKinds: Record<string, number> = {};
  const keys = new Set<string>();
  for (const e of session.startupEvents) for (const k of eventKeys(e)) keys.add(k);
  session.subscribe((_s, ev) => {
    events += ev.length;
    for (const e of ev) for (const k of eventKeys(e)) keys.add(k);
  });
  const targetHour = session.getState().time.hour + args.days * 24;
  while (session.getState().time.hour < targetHour) {
    const remaining = targetHour - session.getState().time.hour;
    const r = session.advance(Math.min(24, remaining));
    if (r.pending) {
      pendingStops++;
      const h = headlessCommand(session.getState(), r.pending);
      const res = 'command' in h ? session.dispatch(h.command) : { error: { code: 'noDefault', message: h.error } };
      if (res.error) {
        console.log(`stopped at pending '${r.pending.kind}' (${r.pending.id}): ${res.error.code} ${res.error.message}`);
        process.exitCode = 1;
        break;
      }
      pendingKinds[r.pending.kind] = (pendingKinds[r.pending.kind] ?? 0) + 1;
    }
  }
  const t2 = performance.now();
  const state = session.getState();
  const json = JSON.stringify(state);
  const hash = hashString32(json).toString(16).padStart(8, '0');
  const violations = checkInvariants(state, session.env);
  console.log(
    `seed=${args.seed} difficulty=${args.difficulty} modules=${session.env.modules.length}${args.modules ? ` (subset: ${args.modules.join(',')})` : ''}${session.env.disabled.length > 0 ? ` disabled=${session.env.disabled.join(',')}` : ''}`,
  );
  console.log(`newGame: ${(t1 - t0).toFixed(1)} ms`);
  console.log(`advance ${args.days} days: ${(t2 - t1).toFixed(1)} ms (${((t2 - t1) / Math.max(1, args.days)).toFixed(3)} ms/day)`);
  console.log(`date: ${formatDate(state.time.hour)} (hour ${state.time.hour}); events=${events}; pendingStops=${pendingStops} ${JSON.stringify(pendingKinds)}`);
  console.log(`entities: ${Object.keys(state.characters).length} characters, ${Object.keys(state.settlements).length} settlements, ${Object.keys(state.ships).length} ships`);
  console.log(`state hash: ${hash}; JSON ${(json.length / 1024).toFixed(1)} KiB`);
  const missing = missingLocaleKeys(keys);
  console.log(`localisation: ${keys.size} distinct keys emitted, ${missing.length} missing`);
  if (missing.length > 0) {
    console.error(`keys without an English string (add them to src/content/locales/en/<area>.json):\n  ${missing.slice(0, 50).join('\n  ')}`);
    process.exitCode = 1;
  }
  if (args.saveCheck) {
    const s0 = performance.now();
    const blob = session.save();
    const loaded = GameSession.load(blob, { modules });
    const same = loaded.save() === blob;
    const s1 = performance.now();
    console.log(`save: ${(blob.length / 1024).toFixed(1)} KiB, save+load+save ${(s1 - s0).toFixed(1)} ms, identical=${same}`);
    if (!same) process.exitCode = 1;
  }
  if (violations.length > 0) {
    console.error(`invariant violations:\n  ${violations.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main();
