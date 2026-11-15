/**
 * What a condition-language expression is evaluated against. A superset of the kernel's
 * ConditionEvalContext (state, env, scope, rng) plus the storylet context roots `event` and `vars`.
 */
import type { SimEnv } from '@sim/core/module';
import type { RandomSource } from '@sim/core/rng';
import type { GameState, JsonValue, TextVars } from '@sim/core/state';

/** Value of an expression: JSON scalars only. */
export type Value = number | string | boolean | null;

export interface EvalScope {
  /** The state being read (frozen state or a draft); never mutated. */
  readonly state: GameState;
  readonly env: SimEnv;
  /** Entity root → id (settlement, holding, faction, character, fleet). */
  readonly scope: Readonly<Record<string, string>>;
  /** Random source for rand(); absent outside operations (rand() then returns 0.5). */
  readonly rng?: RandomSource;
  /** The triggering event's payload (`event.*`). */
  readonly event?: Readonly<Record<string, JsonValue>>;
  /** Text/instance variables (`vars.*`). */
  readonly vars?: Readonly<TextVars>;
}

/** Thrown when an expression cannot be evaluated (unknown function, invalid arguments). */
export class ConditionRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionRuntimeError';
  }
}

/** Truthiness of the language: false, null, 0 and '' are false. */
export function truthy(v: Value): boolean {
  return v !== null && v !== false && v !== 0 && v !== '';
}

/** Coerces any value to a language value (non-finite numbers, objects and arrays become null). */
export function toValue(v: unknown): Value {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return null;
}
