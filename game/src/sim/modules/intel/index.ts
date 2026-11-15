/**
 * 'intel' simulation module (scheduler order 120).
 * Scope: Intel records with source, reliability and age; mead-hall intelligence; maps (§20, §31.19).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   effects: addIntel
 *   commands: buyMap
 *   events: IntelGained, MapAcquired
 *   state slices: intel
 * Module-owned additions (not in ownership.ts; reported to the integrator):
 *   effects: observeSettlement
 *   condition fns: hasIntel, intelConfidence, intelLabel, holdsMap
 *   state: PlayerHouse.maps
 * Effects used (owned elsewhere): core addSilver; quests revealSite (skipped while quests is absent).
 * Tunables: src/content/data/tunables/intel.json (+ schemas/tunables/intel.ts), read as ctx.tunables.intel.
 * Strings/assets: src/content/locales/en/intel.json and src/content/assets/manifest/intel.json (prefix 'intel.').
 * Gate: npm run verify:module -- intel
 *
 * HOW IT WORKS
 *   - Reports enter through `addIntel` (storylets, the tavern, envoys, skalds: values as told) and
 *     `observeSettlement` (a source looks at the real settlement: the truth, blurred by reliability).
 *     The same store serves the player and AI factions (observer = faction id, §18.6).
 *   - The player's fleets reaching a harbour see its walls, ships and prosperity ('sighting').
 *   - Monthly, reports older than `pruneDays` and records of vanished settlements are dropped.
 *   - Confidence, labels, ranges and conflicts are computed on read (formulas.ts, query.ts).
 */
import { getContent } from '@content/index';
import { CommandError } from '@sim/core/commands';
import { EffectError } from '@sim/core/effects';
import type { CommandHandlers, CommandSchemas, ConditionEvalContext, ConditionFns, EffectHandlers, EffectSchemas, Reactions, SimContext, SimModule } from '@sim/core/module';
import type { FactionId, FleetId, GameState, IntelFactKey, SettlementId, SiteId } from '@sim/core/state';
import { z } from 'zod';
import { ageDays, bestReportIndex, confidenceLabel, factConfidence } from './formulas';
import { intelRecord } from './query';
import { addReports, dropOrphans, keysForSource, observe, pruneIntel, sourceReliability } from './store';
import { INTEL_FACT_KEYS, type HeldMap } from './types';
import './types';

export type { HeldMap, IntelLabel, IntelSource } from './types';
export { INTEL_FACT_KEYS, INTEL_SOURCES } from './types';
export { ageDays, bestReportIndex, canonical, confidenceLabel, confidenceOf, displayedRange, factConfidence, numericValue, reportsConflict } from './formulas';
export { believedValue, factView, intelRecord, intelSummary, knownSettlements, type IntelFactView, type IntelQueryContent } from './query';
export { intelKey, keysForSource, snapshotFacts, sourceReliability } from './store';

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const FactKeySchema = z.enum(INTEL_FACT_KEYS as unknown as [IntelFactKey, ...IntelFactKey[]]);
const SourceSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'sources are camelCase ids');
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]));

/** zod schemas of the intel effect ops. */
export const INTEL_EFFECT_SCHEMAS: EffectSchemas = {
  addIntel: z
    .object({
      op: z.literal('addIntel'),
      settlementId: prefixed('set'),
      facts: z.record(FactKeySchema, JsonValueSchema).refine((f) => Object.keys(f).length > 0, 'addIntel needs at least one fact'),
      source: SourceSchema,
      observer: prefixed('fac').optional(),
      reliability: z.number().finite().min(0).max(1).optional(),
      hour: z.number().int().min(0).optional(),
    })
    .strict(),
  observeSettlement: z
    .object({
      op: z.literal('observeSettlement'),
      settlementId: prefixed('set'),
      source: SourceSchema,
      observer: prefixed('fac').optional(),
      keys: z.array(FactKeySchema).min(1).optional(),
      reliability: z.number().finite().min(0).max(1).optional(),
    })
    .strict(),
};

function requireSettlement(draft: GameState, id: string, op: string): SettlementId {
  if (!Object.hasOwn(draft.settlements, id)) throw new EffectError(`${op}: unknown settlement ${id}`);
  return id as SettlementId;
}

function requireObserver(draft: GameState, id: string | undefined, op: string): FactionId {
  const observer = (id ?? draft.player.factionId) as FactionId;
  if (!Object.hasOwn(draft.factions, observer)) throw new EffectError(`${op}: unknown observer ${observer}`);
  return observer;
}

/** Intel effect implementations. */
export const INTEL_EFFECTS: EffectHandlers = {
  addIntel(draft, e, ctx) {
    const t = ctx.tunables.intel;
    const settlementId = requireSettlement(draft, e.settlementId, 'addIntel');
    const observer = requireObserver(draft, e.observer, 'addIntel');
    const reliability = e.reliability ?? sourceReliability(t, e.source);
    const written = addReports(draft, t, ctx.hour, observer, settlementId, e.facts, e.source, reliability, e.hour ?? ctx.hour);
    if (written.length > 0) ctx.emit({ type: 'IntelGained', observer, settlementId, keys: written, source: e.source, reliability: Math.round(reliability * 1000) / 1000 });
  },
  observeSettlement(draft, e, ctx) {
    const t = ctx.tunables.intel;
    const settlementId = requireSettlement(draft, e.settlementId, 'observeSettlement');
    const observer = requireObserver(draft, e.observer, 'observeSettlement');
    const reliability = e.reliability ?? sourceReliability(t, e.source);
    observe(draft, ctx, observer, settlementId, e.source, e.keys ?? keysForSource(t, e.source), reliability);
  },
};

// ---------------------------------------------------------------------------------------------
// buyMap (§20.5).

/** zod schemas of the intel commands. */
export const INTEL_COMMAND_SCHEMAS: CommandSchemas = {
  buyMap: z.object({
    type: z.literal('buyMap'),
    siteId: prefixed('site'),
    settlementId: prefixed('set'),
    price: z.number().int().min(0),
    sellerId: z.string().min(1).optional(),
  }),
};

/** True if the player's ruler or expedition is at a settlement (in it, or a fleet/army lying within presenceRadius). */
export function playerPresentAt(state: GameState, settlementId: SettlementId, radius: number): boolean {
  const s = state.settlements[settlementId];
  if (!s) return false;
  const near = (pos: { x: number; y: number }) => {
    const dx = pos.x - s.mapPos.x;
    const dy = pos.y - s.mapPos.y;
    return dx * dx + dy * dy <= radius * radius;
  };
  const ruler = state.characters[state.player.rulerId];
  if (ruler?.alive) {
    const loc = ruler.location;
    if (loc.kind === 'settlement' && loc.id === settlementId) return true;
    if (loc.kind === 'fleet' && Object.hasOwn(state.fleets, loc.id) && near((state.fleets[loc.id] as { pos: { x: number; y: number } }).pos)) return true;
    if (loc.kind === 'army' && Object.hasOwn(state.armies, loc.id) && near((state.armies[loc.id] as { pos: { x: number; y: number } }).pos)) return true;
  }
  const exp = state.player.expeditionFleetId;
  if (exp !== undefined && Object.hasOwn(state.fleets, exp)) {
    const f = state.fleets[exp as FleetId];
    if (f && f.mode !== 'sailing' && near(f.pos)) return true;
  }
  return false;
}

/** Intel command handlers. */
export const INTEL_HANDLERS: CommandHandlers = {
  buyMap(draft, cmd, ctx) {
    const t = ctx.tunables.intel;
    const siteId = cmd.siteId as SiteId;
    const settlementId = cmd.settlementId as SettlementId;
    if (!Object.hasOwn(draft.settlements, settlementId)) throw new CommandError('unknownSettlement', `No settlement ${settlementId}.`);
    if (!Object.hasOwn(draft.sites, siteId)) throw new CommandError('unknownSite', `No site ${siteId}.`);
    const maps = draft.player.house.maps;
    if (maps !== undefined && Object.hasOwn(maps, siteId)) throw new CommandError('alreadyHeld', 'The house already holds this map.');
    const [lo, hi] = t.mapPrice;
    if (cmd.price < lo || cmd.price > hi) throw new CommandError('badPrice', `A map costs ${lo}–${hi} silver.`, { lo, hi });
    if (t.mapNeedsPresence && !playerPresentAt(draft, settlementId, t.presenceRadius)) throw new CommandError('notThere', 'Someone of the house must be there to strike the deal.');
    const treasury = draft.factions[draft.player.factionId]?.treasury ?? 0;
    if (treasury < cmd.price) throw new CommandError('notEnoughSilver', `Needs ${cmd.price} silver.`, { cost: cmd.price, treasury });
    if (cmd.price > 0) ctx.applyEffects([{ op: 'addSilver', amount: -cmd.price }]);
    const held: HeldMap = { siteId, hour: ctx.hour, fromSettlementId: settlementId, price: cmd.price };
    (draft.player.house.maps ??= {})[siteId] = held;
    if (ctx.env.effects.has('revealSite')) ctx.applyEffects([{ op: 'revealSite', siteId } as never]);
    ctx.emit({ type: 'MapAcquired', siteId, settlementId, price: cmd.price });
    const site = draft.sites[siteId];
    ctx.notify('intel.notify.mapAcquired', { priority: 'normal', vars: { site: site?.name ?? siteId, price: cmd.price }, link: { kind: 'site', id: siteId } });
  },
};

// ---------------------------------------------------------------------------------------------
// Reactions (foreign events read defensively by name).

type Loose = Record<string, unknown>;
type LooseReaction = (draft: GameState, e: Loose, ctx: SimContext) => void;

const REACTIONS: Record<string, LooseReaction> = {
  /** The player's fleet or army reaches a settlement: what anyone can see from the harbour. */
  Arrived(draft, e, ctx) {
    const settlementId = typeof e['settlementId'] === 'string' ? (e['settlementId'] as SettlementId) : undefined;
    if (settlementId === undefined || !Object.hasOwn(draft.settlements, settlementId)) return;
    if (e['factionId'] !== draft.player.factionId) return;
    const s = draft.settlements[settlementId];
    if (!s || s.factionId === draft.player.factionId) return;
    const t = ctx.tunables.intel;
    observe(draft, ctx, draft.player.factionId, settlementId, 'sighting', t.arrivalKeys, sourceReliability(t, 'sighting'));
  },
};

// ---------------------------------------------------------------------------------------------
// Condition functions (player's knowledge; settlement from the argument or scope.settlement).

function scopedSettlement(args: readonly unknown[], i: number, ctx: ConditionEvalContext): SettlementId | undefined {
  const a = args[i];
  if (typeof a === 'string') return a as SettlementId;
  return Object.hasOwn(ctx.scope, 'settlement') ? (ctx.scope['settlement'] as SettlementId) : undefined;
}

function bestOf(ctx: ConditionEvalContext, settlementId: SettlementId | undefined, key: IntelFactKey) {
  if (settlementId === undefined) return undefined;
  const rec = intelRecord(ctx.state, ctx.state.player.factionId, settlementId);
  const list = rec?.facts[key];
  if (!list || list.length === 0) return undefined;
  const b = ctx.env.balance.intel;
  const now = ctx.state.time.hour;
  const best = list[bestReportIndex(list, now, b)];
  if (!best) return undefined;
  return { confidence: factConfidence(best, now, b), days: ageDays(best, now) };
}

/** The intel module's condition functions. */
export const INTEL_CONDITION_FNS: ConditionFns = {
  /** hasIntel(key?) / hasIntel(key, settlementId): the player holds any (or that) report about the settlement. */
  hasIntel: {
    args: z.union([z.tuple([]), z.tuple([FactKeySchema]), z.tuple([FactKeySchema, z.string()])]),
    returns: 'boolean',
    evaluate: (args, ctx) => {
      const settlementId = scopedSettlement(args, 1, ctx);
      if (settlementId === undefined) return false;
      const rec = intelRecord(ctx.state, ctx.state.player.factionId, settlementId);
      if (!rec) return false;
      if (typeof args[0] === 'string') return (rec.facts[args[0] as IntelFactKey]?.length ?? 0) > 0;
      return Object.keys(rec.facts).length > 0;
    },
  },
  /** intelConfidence(key, settlementId?): confidence 0–1 of the player's best report (0 if none). */
  intelConfidence: {
    args: z.union([z.tuple([FactKeySchema]), z.tuple([FactKeySchema, z.string()])]),
    returns: 'number',
    evaluate: (args, ctx) => bestOf(ctx, scopedSettlement(args, 1, ctx), args[0] as IntelFactKey)?.confidence ?? 0,
  },
  /** intelLabel(key, settlementId?): 'high' | 'medium' | 'low' | 'stale' | 'none'. */
  intelLabel: {
    args: z.union([z.tuple([FactKeySchema]), z.tuple([FactKeySchema, z.string()])]),
    returns: 'string',
    evaluate: (args, ctx) => {
      const best = bestOf(ctx, scopedSettlement(args, 1, ctx), args[0] as IntelFactKey);
      return best ? confidenceLabel(best.confidence, best.days, ctx.env.balance.intel) : 'none';
    },
  },
  /** holdsMap(siteId?): the player's house holds the map to a site (default scope.site). */
  holdsMap: {
    args: z.union([z.tuple([]), z.tuple([z.string()])]),
    returns: 'boolean',
    evaluate: (args, ctx) => {
      const siteId = typeof args[0] === 'string' ? args[0] : Object.hasOwn(ctx.scope, 'site') ? ctx.scope['site'] : undefined;
      const maps = ctx.state.player.house.maps;
      return siteId !== undefined && maps !== undefined && Object.hasOwn(maps, siteId);
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Invariants.

/** Violations of the intel slice's contract (empty when sane). */
export function intelInvariants(state: GameState, maxReports: number): string[] {
  const out: string[] = [];
  const now = state.time.hour;
  for (const [key, rec] of Object.entries(state.intel)) {
    if (key !== `${rec.observer}|${rec.settlementId}`) out.push(`intel ${key}: key does not match observer|settlement`);
    for (const k of Object.keys(rec.facts)) {
      if (!INTEL_FACT_KEYS.includes(k as IntelFactKey)) {
        out.push(`intel ${key}: unknown fact kind ${k}`);
        continue;
      }
      const list = rec.facts[k as IntelFactKey] ?? [];
      if (list.length === 0) out.push(`intel ${key}.${k}: empty report list`);
      if (list.length > maxReports) out.push(`intel ${key}.${k}: ${list.length} reports exceed ${maxReports}`);
      const sources: string[] = [];
      list.forEach((f, i) => {
        if (!(f.reliability >= 0 && f.reliability <= 1)) out.push(`intel ${key}.${k}[${i}]: reliability ${f.reliability}`);
        if (!Number.isInteger(f.hour) || f.hour > now || f.hour < 0) out.push(`intel ${key}.${k}[${i}]: hour ${f.hour}`);
        if (i > 0 && f.hour > (list[i - 1]?.hour ?? Infinity)) out.push(`intel ${key}.${k}: reports not newest first`);
        if (sources.includes(f.source)) out.push(`intel ${key}.${k}: two reports from ${f.source}`);
        sources.push(f.source);
      });
    }
  }
  const maps = state.player.house.maps ?? {};
  for (const [siteId, m] of Object.entries(maps)) {
    if (m.siteId !== siteId) out.push(`intel: map ${siteId} records site ${m.siteId}`);
    if (m.hour > now) out.push(`intel: map ${siteId} acquired in the future`);
  }
  return out;
}

export const module: SimModule = {
  id: 'intel',
  order: 120,
  version: 1,
  init(draft) {
    dropOrphans(draft);
  },
  migrate(draft) {
    dropOrphans(draft);
  },
  handlers: INTEL_HANDLERS,
  commandSchemas: INTEL_COMMAND_SCHEMAS,
  effects: INTEL_EFFECTS,
  effectSchemas: INTEL_EFFECT_SCHEMAS,
  systems: {
    monthly(draft, ctx) {
      pruneIntel(draft, ctx.tunables.intel, ctx.hour);
      dropOrphans(draft);
    },
  },
  reactions: REACTIONS as unknown as Reactions,
  conditionFns: INTEL_CONDITION_FNS,
  invariants: (state) => intelInvariants(state, getContent().tunables.intel.maxReportsPerFact),
};
