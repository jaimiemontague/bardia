/** Weather invariants (tests, fuzzers and `npm run sim`): human-readable violations, empty when sane. */
import type { Tunables as WeatherTunables } from '@content/schemas/tunables/weather';
import type { GameState } from '@sim/core/state';
import { WIND_CLASSES } from './wind';

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Checks `state.weather` against the module's contract. `windHours` = balance.sailing.windUpdateHours. */
export function weatherInvariants(state: GameState, t: WeatherTunables, windHours: number): string[] {
  const out: string[] = [];
  const w = state.weather;
  const hour = state.time.hour;
  const zoneIds = Object.keys(w.zones);
  if (zoneIds.length > 0) {
    if (!finite(w.lastUpdateHour) || w.lastUpdateHour > hour) out.push(`weather.lastUpdateHour ${w.lastUpdateHour} is after the current hour ${hour}`);
    // A decision can stop time mid-tick (state.time.resume) before this hour's weather update has run.
    else if (hour - w.lastUpdateHour >= windHours + (state.time.resume ? 1 : 0)) out.push(`weather keyframes are stale: lastUpdateHour ${w.lastUpdateHour}, hour ${hour}`);
  }
  for (const id of zoneIds) {
    const z = w.zones[id];
    if (z === undefined) continue;
    if (!finite(z.windDir) || z.windDir < 0 || z.windDir >= 360) out.push(`weather zone ${id}: windDir ${z.windDir} outside [0, 360)`);
    if (!WIND_CLASSES.includes(z.windStr)) out.push(`weather zone ${id}: unknown windStr ${String(z.windStr)}`);
    if (z.speed !== undefined && (!finite(z.speed) || z.speed < 0 || z.speed > t.wind.maxKn)) out.push(`weather zone ${id}: speed ${z.speed}`);
    if (typeof z.fog !== 'boolean' || typeof z.ice !== 'boolean') out.push(`weather zone ${id}: fog/ice must be booleans`);
    const tr = z.track;
    if (tr !== undefined && ![tr.fromDir, tr.fromKn, tr.toDir, tr.toKn, tr.nDir, tr.nKn].every(finite)) out.push(`weather zone ${id}: non-finite keyframes`);
  }
  if (w.storms.length > t.storms.maxCells) out.push(`weather: ${w.storms.length} storm cells exceed maxCells ${t.storms.maxCells}`);
  const seen: Record<string, true> = {};
  for (const c of w.storms) {
    if (Object.hasOwn(seen, c.id)) out.push(`weather storm ${c.id}: duplicate id`);
    seen[c.id] = true;
    const n = Number(c.id.startsWith('storm_') ? c.id.slice(6) : NaN);
    if (!Number.isInteger(n) || (w.seq !== undefined && n >= w.seq)) out.push(`weather storm ${c.id}: id not below seq ${String(w.seq)}`);
    if (![c.pos.x, c.pos.y, c.velocity.x, c.velocity.y, c.radius, c.untilHour].every(finite)) out.push(`weather storm ${c.id}: non-finite fields`);
    if (!(c.radius > 0)) out.push(`weather storm ${c.id}: radius ${c.radius}`);
    if (c.intensity !== undefined && (!finite(c.intensity) || c.intensity < 0 || c.intensity > 1)) out.push(`weather storm ${c.id}: intensity ${c.intensity}`);
    if (c.untilHour <= hour) out.push(`weather storm ${c.id}: expired at ${c.untilHour} but still live at ${hour}`);
    if (c.bornHour !== undefined && c.bornHour > hour) out.push(`weather storm ${c.id}: born in the future (${c.bornHour})`);
    const met = c.met ?? [];
    if (met.some((f, i) => met.indexOf(f) !== i)) out.push(`weather storm ${c.id}: duplicate fleets in met`);
  }
  return out;
}
