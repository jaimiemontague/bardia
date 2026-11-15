/**
 * Kernel-owned commands, events and effects, registered by the 'core' pseudo-module that
 * createSimEnv() always prepends to the module list (order −1000).
 */
import { z } from 'zod';
import { CommandError } from './commands';
import { CORE_EFFECT_SCHEMAS, CORE_EFFECTS } from './effects';
import { getRelation } from './factory';
import { isSafeRecordKey } from './keys';
import type { EntityLink, SimEvent, VoiceId } from './events';
import type { ConditionFns, SimModule } from './module';
import { runTicks } from './scheduler';
import type {
  ChronicleEntry,
  GameState,
  GodId,
  Hour,
  NotificationPriority,
  PendingDecision,
  PendingId,
  PendingKind,
  PlayerPolicies,
  TextVars,
} from './state';
import { HOURS_PER_DAY, season } from './time';

/** `wait`: pass time at home (§7.3). Either a number of days, or until something needs attention. */
export interface WaitCommand {
  days?: number;
  /** Stop at the first pending decision or high/critical notification. */
  untilEvent?: boolean;
  /** Cap for `untilEvent` waits (default 360 days). */
  maxDays?: number;
}

/**
 * `setPolicy`: one of the steward policies in PlayerPolicies (augmentable). Only keys that exist
 * in `state.player.policies` are accepted, so a module adding a policy must write its default in
 * `init` (new games) and `migrate` (old saves).
 */
export type SetPolicyCommand = { [K in keyof PlayerPolicies]: { policy: K; value: PlayerPolicies[K] } }[keyof PlayerPolicies];

declare module './commands' {
  interface CommandMap {
    wait: WaitCommand;
    setPolicy: SetPolicyCommand;
    /** Dismiss a pending decision of kind 'message'. */
    acknowledge: { pendingId: PendingId };
  }
}

declare module './events' {
  interface EventMap {
    TimeAdvanced: { fromHour: Hour; toHour: Hour; hours: number };
    DayStarted: { hour: Hour; year: number; monthIndex: number; day: number };
    WeekStarted: { hour: Hour };
    MonthStarted: { hour: Hour; year: number; monthIndex: number };
    YearStarted: { hour: Hour; year: number };
    /** `illustration`: image asset id of a picture for the alert box and the inbox entry (never toasts or the feed). */
    Notification: { priority: NotificationPriority; key: string; vars: TextVars; link?: EntityLink; illustration?: string };
    NarrationLine: { key: string; vars: TextVars; voice: VoiceId };
    ChronicleAdded: { entry: ChronicleEntry };
    PendingRaised: { decision: PendingDecision };
    PendingResolved: { id: PendingId; kind: PendingKind };
    StandingChanged: { stat: 'renown' | 'honor' | 'dread' | 'favor' | 'faithWrath' | 'piety'; delta: number; value: number; god?: GodId };
    LoyaltyChanged: { targetId: string; delta: number; value: number };
    OpinionChanged: { a: string; b: string; delta: number; opinion: number; reason: string };
    CodexUnlocked: { topic: string };
    PolicyChanged: { policy: string; value: string };
  }
}

/** Default cap for `wait { untilEvent: true }`. */
export const WAIT_UNTIL_EVENT_MAX_DAYS = 360;

export const coreModule: SimModule = {
  id: 'core',
  order: -1000,
  version: 1,
  handlers: {
    wait(draft, cmd, ctx) {
      if (draft.pending !== null) throw new CommandError('pendingDecision', 'Resolve the pending decision before waiting.');
      if (cmd.untilEvent) {
        const maxDays = cmd.maxDays ?? WAIT_UNTIL_EVENT_MAX_DAYS;
        if (!Number.isInteger(maxDays) || maxDays <= 0) throw new CommandError('invalidDays', 'maxDays must be a positive integer');
        const mark = ctx.events.length;
        runTicks(draft, maxDays * HOURS_PER_DAY, ctx, () => {
          for (let i = mark; i < ctx.events.length; i++) {
            const e = ctx.events[i];
            if (e?.type === 'Notification' && (e.priority === 'high' || e.priority === 'critical')) return true;
          }
          return false;
        });
        return;
      }
      const days = cmd.days ?? 0;
      if (!Number.isInteger(days) || days <= 0) throw new CommandError('invalidDays', 'days must be a positive integer');
      runTicks(draft, days * HOURS_PER_DAY, ctx);
    },
    setPolicy(draft, cmd, ctx) {
      const policies = draft.player.policies as unknown as Record<string, unknown>;
      if (!isSafeRecordKey(cmd.policy) || !Object.hasOwn(policies, cmd.policy)) {
        throw new CommandError('unknownPolicy', `Unknown policy '${String(cmd.policy)}'`);
      }
      policies[cmd.policy] = cmd.value;
      ctx.emit({ type: 'PolicyChanged', policy: String(cmd.policy), value: String(cmd.value) });
    },
    acknowledge(draft, cmd, ctx) {
      const p = draft.pending;
      if (!p || p.id !== cmd.pendingId) throw new CommandError('notPending', `'${cmd.pendingId}' is not pending`);
      if (p.kind !== 'message') throw new CommandError('wrongKind', `Pending '${p.kind}' cannot be acknowledged; use its own command`);
      ctx.resolvePending(p.id);
    },
  },
  effects: CORE_EFFECTS,
  effectSchemas: CORE_EFFECT_SCHEMAS,
  conditionFns: coreConditionFns(),
  invariants(state: GameState): string[] {
    return coreInvariants(state);
  },
};

const ID_TABLES: [keyof GameState, string][] = [
  ['characters', 'chr'],
  ['factions', 'fac'],
  ['provinces', 'prv'],
  ['settlements', 'set'],
  ['sites', 'site'],
  ['fleets', 'flt'],
  ['ships', 'shp'],
  ['armies', 'arm'],
  ['quests', 'qst'],
  ['relics', 'rel'],
  ['news', 'news'],
];

/** Condition-language functions over kernel-owned state (design §29.7). */
function coreConditionFns(): ConditionFns {
  return {
    /** flag('x') → the flag's value, or false when unset. */
    flag: {
      args: z.tuple([z.string().min(1)]),
      returns: 'boolean',
      evaluate: ([name], { state }) => {
        const key = String(name);
        return isSafeRecordKey(key) && Object.hasOwn(state.flags, key) ? (state.flags[key] as string | number | boolean) : false;
      },
    },
    /** season() → 'spring' | 'summer' | 'autumn' | 'winter'. */
    season: {
      args: z.tuple([]),
      returns: 'string',
      evaluate: (_args, { state }) => season(state.time.hour),
    },
    /** opinion(a, b) → the relation's opinion (0 when the two have no relation yet). */
    opinion: {
      args: z.tuple([z.string().min(1), z.string().min(1)]),
      returns: 'number',
      evaluate: ([a, b], { state }) => (a === b ? 0 : (getRelation(state, String(a), String(b))?.opinion ?? 0)),
    },
  };
}

/** Kernel invariants: id integrity, non-negative silver, fleet/ship links, sane time and RNG states. */
export function coreInvariants(state: GameState): string[] {
  const out: string[] = [];
  if (!Number.isInteger(state.time.hour) || state.time.hour < 0) out.push(`time.hour invalid: ${state.time.hour}`);
  for (const [table, prefix] of ID_TABLES) {
    const rows = state[table] as Record<string, { id: string }>;
    for (const [key, row] of Object.entries(rows)) {
      if (row.id !== key) out.push(`${String(table)}: key ${key} != id ${row.id}`);
      if (!key.startsWith(`${prefix}_`)) out.push(`${String(table)}: id ${key} lacks prefix ${prefix}_`);
      const n = Number(key.slice(prefix.length + 1));
      if (Number.isInteger(n) && n >= state.meta.nextId) out.push(`${String(table)}: id ${key} >= meta.nextId ${state.meta.nextId}`);
    }
  }
  for (const f of Object.values(state.factions)) {
    if (!(f.treasury >= 0) || !Number.isFinite(f.treasury)) out.push(`faction ${f.id} treasury ${f.treasury}`);
  }
  for (const f of Object.values(state.fleets)) {
    if (!(f.silver >= 0) || !Number.isFinite(f.silver)) out.push(`fleet ${f.id} silver ${f.silver}`);
  }
  for (const s of Object.values(state.settlements)) {
    if (!(s.silver >= 0) || !Number.isFinite(s.silver)) out.push(`settlement ${s.id} silver ${s.silver}`);
  }
  // Each ship belongs to at most one fleet, and fleet.shipIds agrees with ship.locationFleetId.
  const shipFleet: Record<string, string> = {};
  for (const f of Object.values(state.fleets)) {
    for (const shipId of f.shipIds) {
      const ship = state.ships[shipId];
      if (!ship) out.push(`fleet ${f.id} lists unknown ship ${shipId}`);
      else if (ship.locationFleetId !== f.id) out.push(`fleet ${f.id} lists ship ${shipId} whose locationFleetId is ${String(ship.locationFleetId)}`);
      const other = shipFleet[shipId];
      if (other !== undefined) out.push(`ship ${shipId} is in both fleet ${other} and fleet ${f.id}`);
      else shipFleet[shipId] = f.id;
    }
  }
  for (const ship of Object.values(state.ships)) {
    if (ship.locationFleetId !== undefined && shipFleet[ship.id] !== ship.locationFleetId) {
      out.push(`ship ${ship.id} points at fleet ${ship.locationFleetId}, which does not list it`);
    }
  }
  for (const [name, s] of Object.entries(state.rng)) {
    if (s.length !== 4 || s.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffffffff)) out.push(`rng ${name} malformed`);
    else if ((s[0] | s[1] | s[2] | s[3]) === 0) out.push(`rng ${name} all-zero`);
  }
  for (const [key, rel] of Object.entries(state.relations)) {
    const expected = rel.a < rel.b ? `${rel.a}|${rel.b}` : `${rel.b}|${rel.a}`;
    if (key !== expected) out.push(`relation key ${key} != ${expected}`);
  }
  if (state.pending === null && state.pendingQueue.length > 0) out.push('pendingQueue non-empty while pending is null');
  return out;
}

/**
 * Localisation keys carried by a kernel event (notification, narration line, chronicle entry,
 * message decision). Tools and tests use it to check that every emitted key has a string.
 */
export function eventTextKeys(event: SimEvent): string[] {
  switch (event.type) {
    case 'Notification':
    case 'NarrationLine':
      return [event.key];
    case 'ChronicleAdded':
      return [event.entry.textKey];
    case 'PendingRaised':
      return event.decision.kind === 'message' ? [event.decision.payload.key] : [];
    default:
      return [];
  }
}
