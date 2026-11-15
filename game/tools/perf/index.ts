/**
 * Strategic-layer performance check against the design budget (§29.8: ≤ 2 ms per game day on
 * average, ≤ 10 ms on month boundaries).
 *
 *   npm run perf [-- --days 120] [--max-ms-per-day 2] [--max-month-ms 10] [--strict-reference]
 *
 * Builds a large deterministic world (≈1,500 characters, 150 fleets, 150 settlements) and advances
 * it one day at a time with
 *   (a) the real module registry — this is the gated number (exit code 1 over budget);
 *   (b) the registry plus a REFERENCE module that follows the hot-path guidance in ARCHITECTURE.md
 *       §7/§16 (ctx.rng, an hourly pass over sailing fleets only, daily/monthly passes over
 *       characters) — informational unless --strict-reference, it shows module authors what a
 *       well-behaved load costs on this machine.
 */
import { createCharacter } from '../../src/sim/core/factory';
import { baseState, runOperation } from '../../src/sim/core/context';
import { createSimEnv } from '../../src/sim/core/env';
import type { SimModule } from '../../src/sim/core/module';
import { advance } from '../../src/sim/core/scheduler';
import { dispatch } from '../../src/sim/core/dispatch';
import { headlessCommand } from '../../src/sim/headless';
import type { CharId, FleetId, GameState } from '../../src/sim/core/state';
import { HOURS_PER_DAY, DAYS_PER_MONTH } from '../../src/sim/core/time';
import { MODULES } from '../../src/sim/modules';
import { testWorld } from '../../src/sim/testing';

interface Args {
  days: number;
  maxMsPerDay: number;
  maxMonthMs: number;
  strictReference: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 120, maxMsPerDay: 2, maxMonthMs: 10, strictReference: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => Number(argv[++i]);
    if (a === '--days') args.days = next();
    else if (a === '--max-ms-per-day') args.maxMsPerDay = next();
    else if (a === '--max-month-ms') args.maxMonthMs = next();
    else if (a === '--strict-reference') args.strictReference = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

/** A load that follows the guidance: cached RNG, minimal hourly work, coarse passes on boundaries. */
const referenceModule: SimModule = {
  id: 'perfReference',
  order: 999,
  systems: {
    hourly(draft, ctx) {
      // Scan the operation's base state (no proxy traps), write only the rows that change.
      const rng = ctx.rng('perfReference:drift');
      const fleets = baseState(draft.fleets);
      for (const id in fleets) {
        if (fleets[id as FleetId]?.mode !== 'sailing') continue;
        const fleet = draft.fleets[id as FleetId];
        if (fleet) fleet.pos.x += 0.1 + rng.float() * 0.05;
      }
    },
    daily(draft, ctx) {
      const rng = ctx.rng('perfReference:daily');
      const chars = baseState(draft.characters);
      for (const id in chars) {
        const c = chars[id as CharId];
        if (!c?.alive || c.health.hpPct >= 100 || !rng.chance(0.05)) continue;
        const target = draft.characters[id as CharId];
        if (target) target.health.hpPct = Math.min(100, target.health.hpPct + 1);
      }
    },
    monthly(draft, ctx) {
      const rng = ctx.rng('perfReference:monthly');
      const chars = baseState(draft.characters);
      for (const id in chars) {
        if (!rng.chance(0.01)) continue;
        const target = draft.characters[id as CharId];
        if (target) target.xp += 10;
      }
    },
  },
};

function buildWorld(modules: readonly SimModule[]): GameState {
  const world = testWorld({ modules, seed: 'perf', factions: 30, settlementsPerFaction: 5, fleetsPerFaction: 5 });
  const env = createSimEnv({ modules });
  return runOperation(world.state, env, (draft, ctx) =>
    ctx.runAs('perfWorld', () => {
      const factionIds = Object.keys(draft.factions);
      for (let i = 0; Object.keys(draft.characters).length < 1500; i++) {
        createCharacter(draft, ctx, { culture: 'skarn', age: 20 + (i % 40), factionId: factionIds[i % factionIds.length] as never });
      }
      for (const fleet of Object.values(draft.fleets)) fleet.mode = 'sailing';
      for (const c of Object.values(draft.characters)) c.health.hpPct = 60;
    }),
  ).state;
}

function measure(label: string, modules: readonly SimModule[], days: number): { avg: number; maxMonth: number; max: number } {
  const env = createSimEnv({ modules });
  let state = buildWorld(modules);
  const counts = `${Object.keys(state.characters).length} characters, ${Object.keys(state.fleets).length} fleets, ${Object.keys(state.settlements).length} settlements`;
  let total = 0;
  let max = 0;
  let maxMonth = 0;
  for (let d = 0; d < days; d++) {
    const t0 = performance.now();
    const r = advance(state, HOURS_PER_DAY, env);
    const dt = performance.now() - t0;
    state = r.state;
    // Decisions are answered with the headless defaults outside the timed window.
    for (let guard = 0; state.pending && guard < 16; guard++) {
      const h = headlessCommand(state, state.pending);
      if (!('command' in h)) throw new Error(`${label}: stopped at pending '${state.pending.kind}': ${h.error}`);
      const res = dispatch(state, h.command, env);
      if (res.error) throw new Error(`${label}: ${state.pending.kind}: ${res.error.code} ${res.error.message}`);
      state = res.state;
    }
    total += dt;
    max = Math.max(max, dt);
    if ((d + 1) % DAYS_PER_MONTH === 0) maxMonth = Math.max(maxMonth, dt);
  }
  const avg = total / days;
  console.log(`${label}: ${counts}; ${days} days: avg ${avg.toFixed(3)} ms/day, max ${max.toFixed(2)} ms, max on month boundary ${maxMonth.toFixed(2)} ms`);
  return { avg, maxMonth, max };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(`budget: avg ≤ ${args.maxMsPerDay} ms/day, month boundary ≤ ${args.maxMonthMs} ms (design §29.8)`);
  const real = measure('(a) registry', MODULES, args.days);
  const ref = measure('(b) registry + reference load', [...MODULES, referenceModule], args.days);
  const failures: string[] = [];
  const check = (name: string, r: { avg: number; maxMonth: number }) => {
    if (r.avg > args.maxMsPerDay) failures.push(`${name}: avg ${r.avg.toFixed(3)} ms/day > ${args.maxMsPerDay}`);
    if (r.maxMonth > args.maxMonthMs) failures.push(`${name}: month boundary ${r.maxMonth.toFixed(2)} ms > ${args.maxMonthMs}`);
  };
  check('registry', real);
  if (args.strictReference) check('reference', ref);
  if (failures.length > 0) {
    console.error(`OVER BUDGET:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else console.log('within budget.');
}

main();
