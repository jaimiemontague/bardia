/**
 * Small deterministic helpers shared by the engine's result builder, the auto-resolve and the
 * module's setup/result application.
 */

/**
 * Splits the whole number `n` over `weights` by largest remainder (ties broken by index), so the
 * parts are whole, sum to `n` and follow the weights as closely as possible. Zero total weight puts
 * everything on the first entry.
 */
export function splitBy(n: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0) return weights.map((_, i) => (i === 0 ? n : 0));
  const raw = weights.map((w) => (n * Math.max(0, w)) / total);
  const out = raw.map((r) => Math.floor(r));
  let left = n - out.reduce((a, v) => a + v, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k]!.i]! += 1;
  return out;
}

/** Rounds to a multiple of `step`. */
export function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

/** Deep copy of a JSON-safe value (setups and results cross the engine/GameState boundary as copies). */
export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
