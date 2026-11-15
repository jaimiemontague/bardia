/**
 * The intel store (state.intel): writing reports, snapshots of the truth as a source sees it, pruning.
 *
 * Reports per fact kind are kept newest first (by the hour the fact was true), at most
 * `maxReportsPerFact`; a new report from the same source replaces that source's older one, so a
 * keeper asked twice does not count as two witnesses.
 */
import type { Tunables as IntelTunables } from '@content/schemas/tunables/intel';
import type { SimContext } from '@sim/core/module';
import type { RandomSource } from '@sim/core/rng';
import type { FactionId, GameState, Hour, IntelFact, IntelFactKey, IntelRecord, JsonValue, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { INTEL_FACT_KEYS } from './types';

/** `state.intel` key of an observer's record about a settlement. */
export function intelKey(observer: FactionId, settlementId: SettlementId): string {
  return `${observer}|${settlementId}`;
}

/** Reliability of a source (tunables table, else the default). */
export function sourceReliability(t: IntelTunables, source: string): number {
  return Object.hasOwn(t.sources, source) ? (t.sources[source] as number) : t.defaultReliability;
}

/** Rounds a reliability to 3 decimals (stable JSON). */
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Adds reports to an observer's record (creating it). Returns the fact kinds written. Values must be
 * JSON (they are copied). Reports dated after `now` are clamped to `now`.
 */
export function addReports(
  draft: GameState,
  t: IntelTunables,
  now: Hour,
  observer: FactionId,
  settlementId: SettlementId,
  facts: Partial<Record<IntelFactKey, JsonValue>>,
  source: string,
  reliability: number,
  hour: Hour,
): IntelFactKey[] {
  const key = intelKey(observer, settlementId);
  let rec = Object.hasOwn(draft.intel, key) ? draft.intel[key] : undefined;
  if (!rec) {
    rec = { observer, settlementId, facts: {} };
    draft.intel[key] = rec;
  }
  const when = Math.min(now, Math.max(0, Math.floor(hour)));
  const rel = round3(Math.min(1, Math.max(0, reliability)));
  const written: IntelFactKey[] = [];
  for (const k of INTEL_FACT_KEYS) {
    if (!Object.hasOwn(facts, k)) continue;
    const value = facts[k];
    if (value === undefined) continue;
    const report: IntelFact = { value: structuredCloneJson(value), source, reliability: rel, hour: when };
    const list = (rec.facts[k] ?? []).filter((f) => f.source !== source || f.hour > when);
    if (list.some((f) => f.source === source)) continue; // a newer report from this source already stands
    let i = 0;
    while (i < list.length && (list[i] as IntelFact).hour >= when) i++;
    list.splice(i, 0, report);
    if (list.length > t.maxReportsPerFact) list.length = t.maxReportsPerFact;
    rec.facts[k] = list;
    written.push(k);
  }
  return written;
}

/** A deep copy of a JSON value (no prototype, no shared references with the caller). */
function structuredCloneJson(v: JsonValue): JsonValue {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(structuredCloneJson);
  const out: Record<string, JsonValue> = {};
  for (const k of Object.keys(v)) out[k] = structuredCloneJson((v as Record<string, JsonValue>)[k] as JsonValue);
  return out;
}

const ECONOMY_LADDER = ['ruined', 'destitute', 'poor', 'fair', 'thriving'] as const;

/** Blurs a count by up to ±(1 − reliability) × scale (uniform), never below 0. */
function blur(value: number, reliability: number, t: IntelTunables, rng: RandomSource): number {
  const spread = (1 - reliability) * t.noise.scale;
  if (spread <= 0 || value <= 0) return Math.max(0, Math.round(value));
  return Math.max(0, Math.round(value * (1 + rng.range(-spread, spread))));
}

/** Ships docked at a settlement and fleets lying there. */
function fleetsInPort(state: GameState, settlementId: SettlementId): { ships: number; fleets: number } {
  let ships = 0;
  for (const ship of Object.values(state.ships)) if (ship.dockedAt === settlementId && ship.locationFleetId === undefined) ships++;
  let fleets = 0;
  const s = state.settlements[settlementId];
  if (s) {
    for (const f of Object.values(state.fleets)) {
      if (f.mode !== 'docked') continue;
      const dx = f.pos.x - s.mapPos.x;
      const dy = f.pos.y - s.mapPos.y;
      if (dx * dx + dy * dy <= 4) {
        fleets++;
        ships += f.shipIds.length;
      }
    }
  }
  return { ships, fleets };
}

/** Factions at war with a faction (relations with stance 'war'), sorted. */
function warsOf(state: GameState, factionId: FactionId): FactionId[] {
  const out: FactionId[] = [];
  for (const rel of Object.values(state.relations)) {
    if (rel.stance !== 'war') continue;
    if (rel.a === factionId) out.push(rel.b as FactionId);
    else if (rel.b === factionId) out.push(rel.a as FactionId);
  }
  return out.filter((id) => Object.hasOwn(state.factions, id)).sort();
}

/**
 * The facts about a settlement as a source of `reliability` reports them now: the true values, numbers
 * blurred and (for poor sources) the economy possibly one step off. Unknown keys are skipped.
 */
export function snapshotFacts(
  state: GameState,
  t: IntelTunables,
  settlementId: SettlementId,
  keys: readonly IntelFactKey[],
  reliability: number,
  rng: RandomSource,
): Partial<Record<IntelFactKey, JsonValue>> {
  const s = state.settlements[settlementId];
  if (!s) return {};
  const out: Partial<Record<IntelFactKey, JsonValue>> = {};
  for (const k of INTEL_FACT_KEYS) {
    if (!keys.includes(k)) continue;
    switch (k) {
      case 'garrison': {
        const units: Record<string, number> = {};
        let total = 0;
        for (const u of Object.keys(s.garrison).sort()) {
          const n = blur(s.garrison[u] ?? 0, reliability, t, rng);
          if (n > 0) {
            units[u] = n;
            total += n;
          }
        }
        out.garrison = { total, units };
        break;
      }
      case 'fortTier':
        out.fortTier = s.fortTier;
        break;
      case 'armour':
        out.armour = s.armourTier;
        break;
      case 'weapons':
        out.weapons = s.weaponTier;
        break;
      case 'silver':
        out.silver = blur(s.silver, reliability, t, rng);
        break;
      case 'economy': {
        let i = ECONOMY_LADDER.indexOf(s.economy as (typeof ECONOMY_LADDER)[number]);
        if (i >= 0 && reliability < t.noise.economySlipBelow && rng.chance(1 - reliability)) {
          i = Math.min(ECONOMY_LADDER.length - 1, Math.max(0, i + (rng.chance(0.5) ? 1 : -1)));
        }
        out.economy = i >= 0 ? (ECONOMY_LADDER[i] as string) : s.economy;
        break;
      }
      case 'leader': {
        const c = state.characters[s.leaderId];
        if (c) out.leader = { charId: c.id, name: c.name, traits: [...c.traits] };
        break;
      }
      case 'wars':
        out.wars = warsOf(state, s.factionId);
        break;
      case 'fleets': {
        const p = fleetsInPort(state, settlementId);
        out.fleets = { ships: blur(p.ships, reliability, t, rng), fleets: p.fleets };
        break;
      }
      case 'relicRumor':
        // Rumours are told (addIntel from storylets, skalds, quests), never read off the settlement.
        break;
    }
  }
  return out;
}

/** Fact kinds a source can see (tunables.sourceKeys, else all but relic rumours). */
export function keysForSource(t: IntelTunables, source: string): IntelFactKey[] {
  if (Object.hasOwn(t.sourceKeys, source)) return [...(t.sourceKeys[source] as IntelFactKey[])];
  return INTEL_FACT_KEYS.filter((k) => k !== 'relicRumor');
}

/** observeSettlement: snapshot + addReports, with the IntelGained event. Returns the keys written. */
export function observe(
  draft: GameState,
  ctx: SimContext,
  observer: FactionId,
  settlementId: SettlementId,
  source: string,
  keys: readonly IntelFactKey[],
  reliability: number,
): IntelFactKey[] {
  const t = ctx.tunables.intel;
  const facts = snapshotFacts(draft, t, settlementId, keys, reliability, ctx.rng('intel'));
  const written = addReports(draft, t, ctx.hour, observer, settlementId, facts, source, reliability, ctx.hour);
  if (written.length > 0) ctx.emit({ type: 'IntelGained', observer, settlementId, keys: written, source, reliability: round3(reliability) });
  return written;
}

/** Monthly: drops reports older than `pruneDays`, empty fact lists and empty records. */
export function pruneIntel(draft: GameState, t: IntelTunables, now: Hour): void {
  const cutoff = now - t.pruneDays * HOURS_PER_DAY;
  for (const key of Object.keys(draft.intel)) {
    const rec = draft.intel[key] as IntelRecord;
    let changed = false;
    const facts: IntelRecord['facts'] = {};
    for (const k of INTEL_FACT_KEYS) {
      const list = rec.facts[k];
      if (!list) continue;
      const kept = list.filter((f) => f.hour >= cutoff);
      if (kept.length !== list.length) changed = true;
      if (kept.length > 0) facts[k] = kept;
    }
    if (Object.keys(facts).length === 0) delete draft.intel[key];
    else if (changed) rec.facts = facts;
  }
}

/** Removes records whose settlement no longer exists (a razed town). */
export function dropOrphans(draft: GameState): void {
  for (const key of Object.keys(draft.intel)) {
    const rec = draft.intel[key] as IntelRecord;
    if (!Object.hasOwn(draft.settlements, rec.settlementId) || !Object.hasOwn(draft.factions, rec.observer)) delete draft.intel[key];
  }
}
