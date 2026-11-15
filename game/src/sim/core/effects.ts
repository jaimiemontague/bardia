/**
 * Effect primitives (design §19.1) as a registry. Storylet choices, relics, quests and events
 * describe consequences as data — `{ "op": "addSilver", "amount": 200 }` — and `applyEffects`
 * routes each op to the one module that implements it. Core implements the pure-state ops below;
 * modules implement the rest (addMen, woundCharacter, marry, spawnFleet, startBattle …; owners in
 * core/ownership.ts) by augmenting `EffectMap` and providing `SimModule.effects` (+ optional
 * `effectSchemas`). Unknown ops throw.
 */
import { GodIdSchema, GoodIdSchema } from '@content/schemas/ids';
import { z } from 'zod';
import { clamp } from './dmath';
import { getOrCreateRelation, recomputeOpinion } from './factory';
import { isSafeRecordKey } from './keys';
import type { EffectHandlers, EffectSchemas, SimContext, SimEnv } from './module';
import type { EntityLink, VoiceId } from './events';
import type {
  CharId,
  FactionId,
  FleetId,
  GameState,
  GodId,
  GoodId,
  Hour,
  NotificationPriority,
  SettlementId,
  StoryletScope,
  TextVars,
} from './state';
import { addDays } from './time';

/**
 * Effect op → parameters. Core ops come from CoreEffectMap; modules augment:
 *   declare module '@sim/core/effects' { interface EffectMap { addMen: { unit: UnitTypeId; count: number } } }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface EffectMap extends CoreEffectMap {}

export type EffectOp = keyof EffectMap;
export type EffectOf<K extends EffectOp> = { op: K } & EffectMap[K];
/** Discriminated union of every registered effect. */
export type Effect = { [K in EffectOp]: EffectOf<K> }[EffectOp];
/** An effect as loaded from content JSON (validate with `validateEffects(env, effects)`). */
export type EffectData = { op: string; [key: string]: unknown };

/** Thrown for unknown ops or invalid parameters. */
export class EffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EffectError';
  }
}

/** Parameters of the core (kernel-implemented) effect ops. */
export interface CoreEffectMap {
  /** Silver to a faction treasury (default: the player's), a fleet, or a settlement stock. Floors at 0. */
  addSilver: { amount: number; factionId?: FactionId; fleetId?: FleetId; settlementId?: SettlementId };
  /**
   * Goods (tons) to a fleet (default: the player's expedition fleet) or a settlement market (tons
   * for every good). Floors at 0. Fleets carry rations as a COUNT in `fleet.rations` (§11.1), so
   * `good: 'rations'` aimed at a fleet adds `tons × balance.economy.rationsPerTon` rations there;
   * `fleet.cargo.rations` is never used.
   */
  addGoods: { good: GoodId; tons: number; fleetId?: FleetId; settlementId?: SettlementId };
  /** Rations by count to a fleet (default: the player's expedition fleet). Floors at 0. */
  addRations: { count: number; fleetId?: FleetId };
  /** Adds an opinion modifier between two actors (stacks with an existing modifier of the same reason). */
  changeOpinion: { a: string; b: string; amount: number; reason?: string; decayPerMonth?: number; untilHour?: Hour };
  /** Holding loyalty (settlementId) or a character's loyalty (charId); clamped by balance.loyalty. */
  changeLoyalty: { amount: number; settlementId?: SettlementId; charId?: CharId };
  changeRenown: { amount: number };
  changeHonor: { amount: number };
  changeDread: { amount: number };
  changeFavor: { god: GodId; amount: number };
  setFlag: { flag: string; value?: number | boolean | string };
  addChronicle: { kind: string; textKey: string; importance?: number; vars?: TextVars; refs?: string[] };
  notify: { key: string; priority?: NotificationPriority; vars?: TextVars; link?: EntityLink };
  narrate: { key: string; vars?: TextVars; voice?: VoiceId };
  unlockCodex: { topic: string };
  scheduleStorylet: {
    storyletId: string;
    inDays?: number;
    atHour?: Hour;
    scope?: { kind: StoryletScope; id?: string };
    vars?: TextVars;
  };
}

// ---------------------------------------------------------------------------------------------
// Parameter schemas (design §30.7: "validated per-op by zod").

const finite = z.number().finite();
const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const safeKey = z.string().refine(isSafeRecordKey, 'must be a non-empty key other than __proto__/constructor/prototype');
/** TextVars: string → string | number | boolean | null. */
export const TextVarsSchema = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]));
/** EntityLink (kinds are an augmentable registry, so any string is accepted here). */
export const EntityLinkSchema = z
  .object({ kind: z.string(), id: z.string().optional(), pos: z.object({ x: finite, y: finite }).strict().optional() })
  .strict();
const priority = z.enum(['low', 'normal', 'high', 'critical']);
const op = <K extends string>(name: K, shape: z.ZodRawShape) => z.object({ op: z.literal(name), ...shape }).strict();

/** zod schemas for the core effect ops (registered by the core pseudo-module). */
export const CORE_EFFECT_SCHEMAS: EffectSchemas = {
  addSilver: op('addSilver', {
    amount: finite,
    factionId: prefixed('fac').optional(),
    fleetId: prefixed('flt').optional(),
    settlementId: prefixed('set').optional(),
  }),
  addGoods: op('addGoods', { good: GoodIdSchema, tons: finite, fleetId: prefixed('flt').optional(), settlementId: prefixed('set').optional() }),
  addRations: op('addRations', { count: finite, fleetId: prefixed('flt').optional() }),
  changeOpinion: op('changeOpinion', {
    a: z.string().min(1),
    b: z.string().min(1),
    amount: finite,
    reason: z.string().optional(),
    decayPerMonth: finite.optional(),
    untilHour: z.number().int().optional(),
  }),
  changeLoyalty: op('changeLoyalty', { amount: finite, settlementId: prefixed('set').optional(), charId: prefixed('chr').optional() }),
  changeRenown: op('changeRenown', { amount: finite }),
  changeHonor: op('changeHonor', { amount: finite }),
  changeDread: op('changeDread', { amount: finite }),
  changeFavor: op('changeFavor', { god: GodIdSchema, amount: finite }),
  setFlag: op('setFlag', { flag: safeKey, value: z.union([finite, z.boolean(), z.string()]).optional() }),
  addChronicle: op('addChronicle', {
    kind: z.string().min(1),
    textKey: z.string().min(1),
    importance: finite.optional(),
    vars: TextVarsSchema.optional(),
    refs: z.array(z.string()).optional(),
  }),
  notify: op('notify', { key: z.string().min(1), priority: priority.optional(), vars: TextVarsSchema.optional(), link: EntityLinkSchema.optional() }),
  narrate: op('narrate', { key: z.string().min(1), vars: TextVarsSchema.optional(), voice: z.string().min(1).optional() }),
  unlockCodex: op('unlockCodex', { topic: safeKey }),
  scheduleStorylet: op('scheduleStorylet', {
    storyletId: z.string().min(1),
    inDays: z.number().int().min(0).optional(),
    atHour: z.number().int().optional(),
    scope: z.object({ kind: z.string().min(1), id: z.string().optional() }).strict().optional(),
    vars: TextVarsSchema.optional(),
  }),
};

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * Validates effect data (e.g. a storylet's or relic's effects at content-load time) against the
 * env's effect registry and schemas. Returns human-readable issues; an empty list means valid.
 * `where` prefixes each issue (e.g. 'storylet oldAgeWarning choice 1').
 */
export function validateEffects(env: SimEnv, effects: readonly unknown[], where = 'effects'): string[] {
  const issues: string[] = [];
  effects.forEach((effect, i) => {
    const opName = (effect as { op?: unknown } | null)?.op;
    if (typeof opName !== 'string') {
      issues.push(`${where}[${i}]: effect without op`);
      return;
    }
    const entry = env.effects.get(opName);
    if (!entry) {
      issues.push(`${where}[${i}]: unknown effect op '${opName}'`);
      return;
    }
    if (entry.schema) {
      const parsed = entry.schema.safeParse(effect);
      if (!parsed.success) issues.push(`${where}[${i}] (${opName}): ${formatIssues(parsed.error)}`);
    }
  });
  return issues;
}

/** Applies a list of effects in order. */
export function applyEffects(draft: GameState, effects: readonly (Effect | EffectData)[], ctx: SimContext): void {
  for (const effect of effects) applyEffect(draft, effect, ctx);
}

/** Applies a single effect via the env's effect registry (validated by its schema if it has one). */
export function applyEffect(draft: GameState, effect: Effect | EffectData, ctx: SimContext): void {
  const opName = (effect as { op?: unknown }).op;
  if (typeof opName !== 'string') throw new EffectError('effect without op');
  const entry = ctx.env.effects.get(opName);
  if (!entry) throw new EffectError(`unknown effect op '${opName}'`);
  let params: unknown = effect;
  if (entry.schema) {
    const parsed = entry.schema.safeParse(effect);
    if (!parsed.success) throw new EffectError(`invalid '${opName}' effect: ${formatIssues(parsed.error)}`);
    params = parsed.data !== null && typeof parsed.data === 'object' ? { ...(parsed.data as object), op: opName } : parsed.data;
  }
  ctx.runAs(entry.moduleId, () => entry.handler(draft, params as never, ctx));
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new EffectError(`${what} must be a finite number`);
  return value;
}

function changeStanding(
  ctx: SimContext,
  draft: GameState,
  stat: 'renown' | 'honor' | 'dread',
  amount: number,
  min: number,
  max: number,
): void {
  const house = draft.player.house;
  const before = house[stat];
  house[stat] = clamp(before + amount, min, max);
  if (stat === 'renown' && amount > 0) house.lastRenownGainHour = draft.time.hour;
  ctx.emit({ type: 'StandingChanged', stat, delta: house[stat] - before, value: house[stat] });
}

function targetFleet(draft: GameState, fleetId: FleetId | undefined, what: string) {
  const id = fleetId ?? draft.player.expeditionFleetId;
  if (id === undefined) return undefined;
  const fleet = draft.fleets[id];
  if (!fleet) throw new EffectError(`${what}: unknown fleet ${id}`);
  return fleet;
}

/** Core effect implementations (registered by the core pseudo-module). */
export const CORE_EFFECTS: EffectHandlers = {
  addSilver(draft, e) {
    const amount = num(e.amount, 'addSilver.amount');
    if (e.fleetId !== undefined) {
      const fleet = draft.fleets[e.fleetId];
      if (!fleet) throw new EffectError(`addSilver: unknown fleet ${e.fleetId}`);
      fleet.silver = Math.max(0, fleet.silver + amount);
    } else if (e.settlementId !== undefined) {
      const s = draft.settlements[e.settlementId];
      if (!s) throw new EffectError(`addSilver: unknown settlement ${e.settlementId}`);
      s.silver = Math.max(0, s.silver + amount);
    } else {
      const factionId = e.factionId ?? draft.player.factionId;
      const faction = draft.factions[factionId];
      if (!faction) throw new EffectError(`addSilver: unknown faction ${factionId}`);
      faction.treasury = Math.max(0, faction.treasury + amount);
    }
  },
  addGoods(draft, e, ctx) {
    const tons = num(e.tons, 'addGoods.tons');
    const addToMarket = (settlementId: SettlementId, what: string) => {
      const market = draft.markets[settlementId];
      if (!market) throw new EffectError(what);
      market.stock[e.good] = Math.max(0, (market.stock[e.good] ?? 0) + tons);
    };
    if (e.settlementId !== undefined) {
      addToMarket(e.settlementId, `addGoods: settlement ${e.settlementId} has no market`);
      return;
    }
    const fleet = targetFleet(draft, e.fleetId, 'addGoods');
    if (fleet) {
      if (e.good === 'rations') fleet.rations = Math.max(0, fleet.rations + Math.round(tons * ctx.balance.economy.rationsPerTon));
      else fleet.cargo[e.good] = Math.max(0, (fleet.cargo[e.good] ?? 0) + tons);
      return;
    }
    addToMarket(draft.player.capitalId, 'addGoods: no fleet or settlement given and the capital has no market');
  },
  addRations(draft, e) {
    const count = Math.round(num(e.count, 'addRations.count'));
    const fleet = targetFleet(draft, e.fleetId, 'addRations');
    if (!fleet) throw new EffectError('addRations: no fleetId given and the player has no expedition fleet');
    fleet.rations = Math.max(0, fleet.rations + count);
  },
  changeOpinion(draft, e, ctx) {
    const amount = num(e.amount, 'changeOpinion.amount');
    const rel = getOrCreateRelation(draft, e.a, e.b);
    const reason = e.reason ?? 'event';
    const decay = e.decayPerMonth ?? 0;
    const existing = rel.modifiers.find((m) => m.reason === reason && m.decayPerMonth === decay && m.untilHour === e.untilHour);
    if (existing) existing.value += amount;
    else {
      const mod: Relation['modifiers'][number] = { reason, value: amount, decayPerMonth: decay };
      if (e.untilHour !== undefined) mod.untilHour = e.untilHour;
      rel.modifiers.push(mod);
    }
    const before = rel.opinion;
    recomputeOpinion(rel, ctx.balance.diplomacy.opinionMin, ctx.balance.diplomacy.opinionMax);
    ctx.emit({ type: 'OpinionChanged', a: rel.a, b: rel.b, delta: rel.opinion - before, opinion: rel.opinion, reason });
  },
  changeLoyalty(draft, e, ctx) {
    const amount = num(e.amount, 'changeLoyalty.amount');
    const { min, max } = ctx.balance.loyalty;
    if (e.settlementId !== undefined) {
      const holding = draft.settlements[e.settlementId]?.holding;
      if (!holding) throw new EffectError(`changeLoyalty: ${e.settlementId} is not a holding`);
      const before = holding.loyalty;
      holding.loyalty = clamp(before + amount, min, max);
      ctx.emit({ type: 'LoyaltyChanged', targetId: e.settlementId, delta: holding.loyalty - before, value: holding.loyalty });
    } else if (e.charId !== undefined) {
      const c = draft.characters[e.charId];
      if (!c) throw new EffectError(`changeLoyalty: unknown character ${e.charId}`);
      const before = c.loyalty ?? ctx.balance.defaults.characterLoyalty;
      c.loyalty = clamp(before + amount, min, max);
      ctx.emit({ type: 'LoyaltyChanged', targetId: e.charId, delta: c.loyalty - before, value: c.loyalty });
    } else {
      throw new EffectError('changeLoyalty needs settlementId or charId');
    }
  },
  changeRenown(draft, e, ctx) {
    changeStanding(ctx, draft, 'renown', num(e.amount, 'changeRenown.amount'), 0, Number.MAX_SAFE_INTEGER);
  },
  changeHonor(draft, e, ctx) {
    const b = ctx.balance.standing.honor;
    changeStanding(ctx, draft, 'honor', num(e.amount, 'changeHonor.amount'), b.min, b.max);
  },
  changeDread(draft, e, ctx) {
    const b = ctx.balance.standing.dread;
    changeStanding(ctx, draft, 'dread', num(e.amount, 'changeDread.amount'), b.min, b.max);
  },
  changeFavor(draft, e, ctx) {
    const amount = num(e.amount, 'changeFavor.amount');
    const b = ctx.balance.standing.favor;
    const favor = draft.player.house.favor;
    if (typeof e.god !== 'string' || !Object.hasOwn(favor, e.god)) throw new EffectError(`changeFavor: unknown god ${String(e.god)}`);
    const before = favor[e.god];
    favor[e.god] = clamp(before + amount, b.min, b.max);
    ctx.emit({ type: 'StandingChanged', stat: 'favor', god: e.god, delta: favor[e.god] - before, value: favor[e.god] });
  },
  setFlag(draft, e) {
    if (!isSafeRecordKey(e.flag)) throw new EffectError(`setFlag.flag must be a non-empty, non-reserved string (got '${String(e.flag)}')`);
    draft.flags[e.flag] = e.value ?? true;
  },
  addChronicle(_draft, e, ctx) {
    ctx.chronicle({
      kind: e.kind,
      textKey: e.textKey,
      importance: e.importance ?? 1,
      vars: e.vars ?? {},
      refs: e.refs ?? [],
    });
  },
  notify(_draft, e, ctx) {
    const opts: { priority?: NotificationPriority; vars?: TextVars; link?: EntityLink } = {};
    if (e.priority !== undefined) opts.priority = e.priority;
    if (e.vars !== undefined) opts.vars = e.vars;
    if (e.link !== undefined) opts.link = e.link;
    ctx.notify(e.key, opts);
  },
  narrate(_draft, e, ctx) {
    ctx.narrate(e.key, e.vars ?? {}, e.voice ?? 'skald');
  },
  unlockCodex(draft, e, ctx) {
    if (!isSafeRecordKey(e.topic)) throw new EffectError(`unlockCodex.topic must be a non-empty, non-reserved string (got '${String(e.topic)}')`);
    if (!Object.hasOwn(draft.codex.unlocked, e.topic)) {
      draft.codex.unlocked[e.topic] = draft.time.hour;
      ctx.emit({ type: 'CodexUnlocked', topic: e.topic });
    }
  },
  scheduleStorylet(draft, e) {
    let atHour: Hour;
    if (e.atHour !== undefined) atHour = num(e.atHour, 'scheduleStorylet.atHour');
    else atHour = addDays(draft.time.hour, num(e.inDays ?? 0, 'scheduleStorylet.inDays'));
    const entry: GameState['storylets']['scheduled'][number] = { storyletId: e.storyletId, atHour };
    if (e.scope !== undefined) entry.scope = { ...e.scope };
    if (e.vars !== undefined) entry.vars = { ...e.vars };
    draft.storylets.scheduled.push(entry);
  },
};

type Relation = GameState['relations'][string];
