/**
 * Headless sea-battle statistics (balance harness for design §15 / §33 M5 ① "sea auto-resolve
 * parity ±10%"):
 *
 *   npm run tool -- sea-sim                         all preset matchups, 20 seeds each
 *   npm run tool -- sea-sim --runs 50 --arena skerries --wind strong
 *   npm run tool -- sea-sim --matchup raidVsGalley
 *   npm run tool -- sea-sim --attacker snekkja,snekkja --defender galley --defender-culture saraleonese
 *   npm run tool -- sea-sim --json                  machine-readable output
 *
 * For each matchup it runs the engine with the AI on both sides and reports win rates next to the
 * auto-resolve prediction, battle length (battle and real seconds at 1×), casualties, ships lost,
 * notable events and the cost of one engine step.
 */
import { getContent } from '../../src/content/index';
import type { CultureId, ShipTypeId, WindStrength } from '../../src/sim/core/state';
import { seaWinProbability } from '../../src/sim/seabattle/autoresolve';
import { SeaBattleEngine } from '../../src/sim/seabattle/engine';
import { makeSeaSetup, testSeaContent, type TestSeaSide } from '../../src/sim/seabattle/testing';

interface Matchup {
  id: string;
  label: string;
  attacker: TestSeaSide;
  defender: TestSeaSide;
}

const PRESETS: Matchup[] = [
  { id: 'equalSnekkjas', label: '3 snekkja vs 3 snekkja', attacker: { ships: ['snekkja', 'snekkja', 'snekkja'] }, defender: { ships: ['snekkja', 'snekkja', 'snekkja'] } },
  { id: 'outnumbered', label: '4 snekkja vs 2 snekkja', attacker: { ships: ['snekkja', 'snekkja', 'snekkja', 'snekkja'] }, defender: { ships: ['snekkja', 'snekkja'] } },
  { id: 'veterans', label: '2 snekkja (huscarls, tier 3) vs 3 snekkja (levy)', attacker: { ships: [{ type: 'snekkja', atk: 7, def: 8 }, { type: 'snekkja', atk: 7, def: 8 }], armourTier: 3, weaponTier: 3 }, defender: { ships: ['snekkja', 'snekkja', 'snekkja'] } },
  { id: 'dragon', label: 'drakkar + 2 snekkja vs 3 snekkja', attacker: { ships: ['drakkar', 'snekkja', 'snekkja'] }, defender: { ships: ['snekkja', 'snekkja', 'snekkja'] } },
  { id: 'raidVsGalley', label: '3 snekkja vs galley (sea-fire)', attacker: { ships: ['snekkja', 'snekkja', 'snekkja'] }, defender: { ships: ['galley'], culture: 'saraleonese' } },
  { id: 'raidVsPlainGalley', label: '3 snekkja vs galley (no sea-fire)', attacker: { ships: ['snekkja', 'snekkja', 'snekkja'] }, defender: { ships: ['galley'] } },
  { id: 'fireArrows', label: '3 snekkja + pitch vs 3 snekkja', attacker: { ships: ['snekkja', 'snekkja', 'snekkja'], pitchT: 3 }, defender: { ships: ['snekkja', 'snekkja', 'snekkja'] } },
  { id: 'merchants', label: 'drakkar + 2 snekkja vs 2 knarr (merchants)', attacker: { ships: ['drakkar', 'snekkja', 'snekkja'] }, defender: { ships: ['knarr', 'knarr'], role: 'merchant' } },
  { id: 'patrol', label: '2 karvi vs 2 snekkja (patrol)', attacker: { ships: ['karvi', 'karvi'] }, defender: { ships: ['snekkja', 'snekkja'], role: 'patrol' } },
  { id: 'river', label: '3 karvi vs 4 riverboats (river)', attacker: { ships: ['karvi', 'karvi', 'karvi'] }, defender: { ships: ['riverboat', 'riverboat', 'riverboat', 'riverboat'] } },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function shipsArg(v: string | undefined): ShipTypeId[] | undefined {
  return v ? (v.split(',').map((s) => s.trim()).filter(Boolean) as ShipTypeId[]) : undefined;
}

interface Stats {
  id: string;
  label: string;
  runs: number;
  attackerWins: number;
  defenderWins: number;
  draws: number;
  pAttackerAuto: number;
  engineAttackerRate: number;
  parityGap: number;
  meanBattleS: number;
  meanRealS: number;
  meanCasualties: { attacker: number; defender: number };
  meanShipsLost: { attacker: number; defender: number };
  events: Record<string, number>;
  stepUsMean: number;
  stepUsMax: number;
}

function runMatchup(m: Matchup, runs: number, arena: string, wind: WindStrength): Stats {
  const content = testSeaContent(getContent());
  let aw = 0;
  let dw = 0;
  let dr = 0;
  let battleS = 0;
  const cas = { attacker: 0, defender: 0 };
  const lost = { attacker: 0, defender: 0 };
  const events: Record<string, number> = {};
  let steps = 0;
  let totalMs = 0;
  let maxUs = 0;
  let p = 0;
  for (let r = 0; r < runs; r++) {
    const setup = makeSeaSetup({ seed: `${m.id}-${r}`, attacker: m.attacker, defender: m.defender, arena, wind: { dir: (r * 47) % 360, str: wind } }, content);
    p += seaWinProbability(content, setup).pAttacker;
    const e = new SeaBattleEngine(setup, content, { aiControlsPlayer: true });
    const cap = Math.ceil(content.tunables.battle.maxBattleS / e.w.dt) + 10;
    for (let i = 0; i < cap && e.status !== 'ended'; i++) {
      const t0 = performance.now();
      e.step();
      const dt = performance.now() - t0;
      totalMs += dt;
      maxUs = Math.max(maxUs, dt * 1000);
      steps++;
      for (const ev of e.drainEvents()) events[ev.kind] = (events[ev.kind] ?? 0) + 1;
    }
    const res = e.result() ?? e.runToEnd();
    if (res.winner === 'attacker') aw++;
    else if (res.winner === 'defender') dw++;
    else dr++;
    battleS += res.durationS;
    for (const c of res.crewLost) cas[c.side] += c.killed + c.wounded + c.captured;
    for (const o of res.ships ?? []) if (o.status === 'sunk' || o.status === 'burned' || o.status === 'captured') lost[o.side] += 1;
  }
  const engineRate = (aw + 0.5 * dr) / runs;
  const pAuto = p / runs;
  const timeScale = content.balance.seaBattle.timeScale;
  for (const k of Object.keys(events)) events[k] = Math.round(((events[k] ?? 0) / runs) * 10) / 10;
  return {
    id: m.id,
    label: m.label,
    runs,
    attackerWins: aw,
    defenderWins: dw,
    draws: dr,
    pAttackerAuto: pAuto,
    engineAttackerRate: engineRate,
    parityGap: engineRate - pAuto,
    meanBattleS: battleS / runs,
    meanRealS: battleS / runs / timeScale,
    meanCasualties: { attacker: cas.attacker / runs, defender: cas.defender / runs },
    meanShipsLost: { attacker: lost.attacker / runs, defender: lost.defender / runs },
    events,
    stepUsMean: steps > 0 ? (totalMs * 1000) / steps : 0,
    stepUsMax: maxUs,
  };
}

function main(): void {
  const runs = Number(arg('runs') ?? 20);
  const arena = arg('arena') ?? 'coastal';
  const wind = (arg('wind') ?? 'fresh') as WindStrength;
  const json = process.argv.includes('--json');
  let matchups = PRESETS;
  const att = shipsArg(arg('attacker'));
  const def = shipsArg(arg('defender'));
  if (att && def) {
    const attacker: TestSeaSide = { ships: att };
    const defender: TestSeaSide = { ships: def };
    const ac = arg('attacker-culture');
    const dc = arg('defender-culture');
    if (ac) attacker.culture = ac as CultureId;
    if (dc) defender.culture = dc as CultureId;
    const role = arg('defender-role');
    if (role) defender.role = role as TestSeaSide['role'] & string;
    matchups = [{ id: 'custom', label: `${att.join('+')} vs ${def.join('+')}`, attacker, defender }];
  } else if (arg('matchup')) {
    matchups = PRESETS.filter((m) => m.id === arg('matchup'));
    if (matchups.length === 0) {
      console.error(`unknown matchup; presets: ${PRESETS.map((m) => m.id).join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }
  const all = matchups.map((m) => runMatchup(m, runs, arena, wind));
  if (json) {
    console.log(JSON.stringify({ runs, arena, wind, matchups: all }, null, 2));
    return;
  }
  console.log(`sea-sim: ${runs} runs per matchup, arena '${arena}', wind ${wind} (direction varies per run)\n`);
  const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)}%`;
  for (const s of all) {
    const flag = Math.abs(s.parityGap) > 0.1 ? '  ← outside ±10%' : '';
    console.log(`${s.label}`);
    console.log(`  engine: attacker ${pct(s.attackerWins / s.runs)}  defender ${pct(s.defenderWins / s.runs)}  draw ${pct(s.draws / s.runs)}   auto-resolve P(attacker) ${pct(s.pAttackerAuto)}  gap ${(s.parityGap * 100).toFixed(0)} pts${flag}`);
    console.log(`  length: ${s.meanBattleS.toFixed(0)} battle s (${s.meanRealS.toFixed(0)} s real at 1×)   casualties A ${s.meanCasualties.attacker.toFixed(0)} / D ${s.meanCasualties.defender.toFixed(0)}   ships lost A ${s.meanShipsLost.attacker.toFixed(1)} / D ${s.meanShipsLost.defender.toFixed(1)}`);
    const ev = ['volley', 'ignite', 'ram', 'seaFire', 'grapple', 'cutFree', 'boardingWon', 'struck', 'sunk', 'fled', 'grounded', 'routed'].map((k) => `${k} ${s.events[k] ?? 0}`).join(' · ');
    console.log(`  events/battle: ${ev}`);
    console.log(`  step: mean ${s.stepUsMean.toFixed(1)} µs, max ${s.stepUsMax.toFixed(0)} µs\n`);
  }
}

main();
