/**
 * Guards for string keys that index plain-object records in GameState (`flags`, `rng`, `codex`,
 * `favor`, `policies`, …). A key such as '__proto__' or 'constructor' would read or write
 * Object.prototype machinery instead of an own property, so such keys are rejected outright and
 * existence checks always use Object.hasOwn — never `in` or truthiness.
 */

/** Keys that are never valid record keys in the simulation. */
export const RESERVED_RECORD_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** True if `key` is a non-empty string that is safe to use as a plain-object record key. */
export function isSafeRecordKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && !RESERVED_RECORD_KEYS.includes(key);
}

/** Throws a RangeError (with `what` in the message) unless `key` is a safe record key. */
export function assertSafeRecordKey(key: unknown, what: string): asserts key is string {
  if (!isSafeRecordKey(key)) throw new RangeError(`${what}: '${String(key)}' is not a valid key`);
}

/** Own-property check that ignores Object.prototype members. */
export function hasOwnKey(record: object, key: string): boolean {
  return Object.hasOwn(record, key);
}
