/**
 * Validates the world geography pack (src/content/data/world/**):
 *
 *   npm run tool -- validate-geography [--strict] [--quiet] [--bench]
 *
 *   1. schema (zod) for base.json and every region pack;
 *   2. references and consistency (unique ids/names, regions/kingdoms/provinces, capitals, cloister saints);
 *   3. the map build and its spatial checks: every province has land and holds its anchors; settlements stand on
 *      land inside their province; coastal flags match the distance to the sea; every port is reachable by sea from
 *      the Whale-Road (or by karvi for river ports) unless flagged landlocked; sites on land; no overlapping points;
 *      sea zones connected as declared; navigable rivers connected; portages on navigable water.
 *
 * Exit code 1 on errors (and on warnings with --strict). Prints a short summary of the world on success; --bench also
 * times a fresh build, the sea-routing landmark table and sea path queries between coastal province anchors.
 */
import { GeographyValidationError, parseGeography, RAW_GEOGRAPHY } from '../../src/content/world';
import { buildStaticWorld, CELL_SEA, findSeaPath, nearestCellWhere, prepareSeaRouting, validateGeographyFull, type StaticWorld } from '../../src/sim/modules/world/map/index';

/** Times a fresh build, the landmark table and sea queries between the sea cells nearest each province anchor. */
function bench(world: StaticWorld): void {
  const t0 = performance.now();
  buildStaticWorld(world.geo);
  const t1 = performance.now();
  prepareSeaRouting(world);
  const t2 = performance.now();
  const W = world.width;
  const cells: number[] = [];
  for (const p of world.geo.provinces) {
    const c = Math.floor(p.anchor[1]) * W + Math.floor(p.anchor[0]);
    const s = nearestCellWhere(W, world.height, c, 4, (i) => world.kind[i] === CELL_SEA && world.seaComponent[i] === world.referenceSeaComponent);
    if (s >= 0) cells.push(s);
  }
  const times: number[] = [];
  for (const a of cells) {
    for (const b of cells) {
      if (a === b) continue;
      const t = performance.now();
      findSeaPath(world, a, b);
      times.push(performance.now() - t);
    }
  }
  times.sort((x, y) => x - y);
  const mean = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length);
  const q = (f: number) => (times[Math.min(times.length - 1, Math.floor(f * times.length))] ?? 0).toFixed(2);
  console.log(`bench: build ${(t1 - t0).toFixed(0)} ms (budget 400); landmark table ${(t2 - t1).toFixed(0)} ms (once per world); ${times.length} sea paths between ${cells.length} coastal anchors: mean ${mean.toFixed(2)} ms, median ${q(0.5)}, p95 ${q(0.95)}, max ${q(1)} ms (typical budget 5)`);
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const doBench = process.argv.includes('--bench');
  const quiet = process.argv.includes('--quiet');
  let geo;
  try {
    geo = parseGeography(RAW_GEOGRAPHY);
  } catch (e) {
    if (e instanceof GeographyValidationError) {
      console.error(`✘ schema: ${e.issues.length} issue(s)`);
      for (const i of e.issues) console.error(`  ${i}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  const t0 = performance.now();
  const { report, world } = validateGeographyFull(geo);
  const ms = performance.now() - t0;
  for (const w of report.warnings) if (!quiet) console.warn(`  warning: ${w}`);
  for (const e of report.errors) console.error(`  error: ${e}`);
  if (world !== undefined) {
    const coastal = geo.settlements.filter((s) => s.coastal).length;
    console.log(
      `world: ${geo.provinces.length} provinces in ${geo.regions.length} regions, ${geo.kingdoms.length} realms, ${geo.seaZones.length} sea zones, ${geo.rivers.length} rivers, ${geo.lakes.length} lakes; ` +
        `${geo.settlements.length} settlements (${coastal} coastal, ${world.ports.length} ports), ${geo.sites.length} sites, ${world.lanes.lanes.length} sea lanes; built and checked in ${ms.toFixed(0)} ms`,
    );
  }
  if (doBench && world !== undefined) bench(world);
  const failed = report.errors.length > 0 || (strict && report.warnings.length > 0);
  console.log(failed ? `✘ geography: ${report.errors.length} error(s), ${report.warnings.length} warning(s)` : `✔ geography valid (${report.warnings.length} warning(s))`);
  if (failed) process.exitCode = 1;
}

main();
