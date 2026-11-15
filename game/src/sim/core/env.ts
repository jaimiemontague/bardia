/**
 * Builds the validated SimEnv from a module list: drops disabled modules, prepends the core
 * pseudo-module, sorts by order and indexes command handlers, effect handlers (+ schemas), systems,
 * reactions and condition functions. Any registry conflict (duplicate module id or order, two
 * handlers for one command type, two implementations of one effect op, two condition functions of
 * one name, a schema without a handler) is a startup error — this is what makes parallel module
 * development safe.
 */
import { getContent, type Content } from '@content/index';
import { coreModule } from './builtins';
import type {
  ConditionEntry,
  EffectEntry,
  HandlerEntry,
  ReactionEntry,
  SimEnv,
  SimModule,
  SystemEntry,
} from './module';
import type { GameState, SystemPhase } from './state';
import { PHASES } from './scheduler';

/** Thrown by createSimEnv with every problem found. */
export class ModuleRegistryError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Module registry is invalid:\n  ${problems.join('\n  ')}`);
    this.name = 'ModuleRegistryError';
  }
}

export interface SimEnvOptions {
  /** Gameplay modules (the core module is added automatically; `enabled: false` ones are skipped). */
  modules: readonly SimModule[];
  /** Defaults to the bundled, validated content. */
  content?: Content;
}

const MODULE_ID = /^[a-z][a-zA-Z0-9]*$/;
const CONDITION_FN_NAME = /^[a-z][a-zA-Z0-9]*$/;

function ownKeys(record: object | undefined): string[] {
  return record ? Object.keys(record) : [];
}

export function createSimEnv(options: SimEnvOptions): SimEnv {
  const problems: string[] = [];
  const disabled = options.modules.filter((m) => m.enabled === false).map((m) => m.id);
  const all: SimModule[] = [coreModule, ...options.modules.filter((m) => m.enabled !== false)];

  const ids = new Map<string, number>();
  const orders = new Map<number, string>();
  for (const m of all) {
    if (!MODULE_ID.test(m.id)) problems.push(`module id '${m.id}' must match ${MODULE_ID}`);
    ids.set(m.id, (ids.get(m.id) ?? 0) + 1);
    if (!Number.isFinite(m.order)) problems.push(`module '${m.id}' has a non-finite order`);
    const other = orders.get(m.order);
    if (other !== undefined && other !== m.id) problems.push(`modules '${other}' and '${m.id}' share order ${m.order}`);
    orders.set(m.order, m.id);
  }
  for (const [id, n] of ids) if (n > 1) problems.push(`module id '${id}' is registered ${n} times`);

  const sorted = [...all].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

  const handlers = new Map<string, HandlerEntry>();
  const effects = new Map<string, EffectEntry>();
  const systems: Record<SystemPhase, SystemEntry[]> = { hourly: [], daily: [], weekly: [], monthly: [], yearly: [] };
  const reactions = new Map<string, ReactionEntry[]>();
  const conditionFns = new Map<string, ConditionEntry>();

  for (const m of sorted) {
    for (const [type, handler] of Object.entries(m.handlers ?? {})) {
      if (typeof handler !== 'function') continue;
      const existing = handlers.get(type);
      if (existing) {
        problems.push(`command '${type}' is handled by both '${existing.moduleId}' and '${m.id}'`);
        continue;
      }
      const entry: HandlerEntry = { moduleId: m.id, handler: handler as HandlerEntry['handler'] };
      const schema = (m.commandSchemas as Record<string, HandlerEntry['schema']> | undefined)?.[type];
      if (schema) entry.schema = schema;
      handlers.set(type, entry);
    }
    for (const type of ownKeys(m.commandSchemas)) {
      if (!(m.handlers && Object.hasOwn(m.handlers, type))) problems.push(`module '${m.id}' has a schema for '${type}' but no handler`);
    }
    for (const [op, handler] of Object.entries(m.effects ?? {})) {
      if (typeof handler !== 'function') continue;
      const existing = effects.get(op);
      if (existing) {
        problems.push(`effect op '${op}' is implemented by both '${existing.moduleId}' and '${m.id}'`);
        continue;
      }
      const entry: EffectEntry = { moduleId: m.id, handler: handler as EffectEntry['handler'] };
      const schema = (m.effectSchemas as Record<string, EffectEntry['schema']> | undefined)?.[op];
      if (schema) entry.schema = schema;
      effects.set(op, entry);
    }
    for (const op of ownKeys(m.effectSchemas)) {
      if (!(m.effects && Object.hasOwn(m.effects, op))) problems.push(`module '${m.id}' has an effect schema for '${op}' but no handler`);
    }
    for (const phase of PHASES) {
      const fn = m.systems?.[phase];
      if (fn) systems[phase].push({ moduleId: m.id, order: m.order, fn });
    }
    for (const [type, fn] of Object.entries(m.reactions ?? {})) {
      if (typeof fn !== 'function') continue;
      const list = reactions.get(type) ?? [];
      list.push({ moduleId: m.id, order: m.order, fn: fn as ReactionEntry['fn'] });
      reactions.set(type, list);
    }
    for (const [name, fn] of Object.entries(m.conditionFns ?? {})) {
      if (!CONDITION_FN_NAME.test(name)) problems.push(`condition function '${name}' (module '${m.id}') must match ${CONDITION_FN_NAME}`);
      const existing = conditionFns.get(name);
      if (existing) {
        problems.push(`condition function '${name}' is provided by both '${existing.moduleId}' and '${m.id}'`);
        continue;
      }
      conditionFns.set(name, { moduleId: m.id, fn });
    }
  }

  if (problems.length > 0) throw new ModuleRegistryError(problems);
  const content = options.content ?? getContent();
  return {
    modules: sorted,
    disabled,
    balance: content.balance,
    content,
    handlers,
    effects,
    systems,
    reactions,
    conditionFns,
  };
}

/** Runs every module's invariants (core included) and returns all violations. */
export function checkInvariants(state: GameState, env: SimEnv): string[] {
  const out: string[] = [];
  for (const m of env.modules) {
    if (!m.invariants) continue;
    for (const v of m.invariants(state)) out.push(`[${m.id}] ${v}`);
  }
  return out;
}
