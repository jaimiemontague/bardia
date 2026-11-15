/**
 * Per-context cache of rendered sample buffers (plucked notes, drum hits, noise beds, bells,
 * impulse responses). Buffers belong to one BaseAudioContext (its sample rate), so the cache is a
 * WeakMap keyed by context: an OfflineAudioContext used for a placeholder render gets its own set and
 * is garbage-collected with it.
 */
import { noise, type NoiseColour } from './dsp';

const caches = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Most buffers kept per context before the oldest are evicted (plucked notes are the bulk). */
export const SAMPLE_CACHE_LIMIT = 400;

/** Mono or stereo sample data. */
export type SampleData = Float32Array | readonly [Float32Array, Float32Array];

function toBuffer(ctx: BaseAudioContext, data: SampleData): AudioBuffer {
  const chans = data instanceof Float32Array ? [data] : [data[0], data[1]];
  const len = Math.max(1, chans[0]?.length ?? 1);
  const buf = ctx.createBuffer(chans.length, len, ctx.sampleRate);
  chans.forEach((c, i) => buf.getChannelData(i).set(c.subarray(0, len)));
  return buf;
}

/**
 * The buffer cached under `key` for this context, rendering it with `render(sampleRate)` on first
 * use. Keys must encode everything the render depends on.
 */
export function cachedBuffer(ctx: BaseAudioContext, key: string, render: (sampleRate: number) => SampleData): AudioBuffer {
  let map = caches.get(ctx);
  if (!map) {
    map = new Map();
    caches.set(ctx, map);
  }
  const hit = map.get(key);
  if (hit) {
    // Refresh recency (Map iteration order is insertion order).
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const buf = toBuffer(ctx, render(ctx.sampleRate));
  map.set(key, buf);
  if (map.size > SAMPLE_CACHE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  return buf;
}

/** Number of buffers cached for a context (tests, the audio lab's stats line). */
export function cachedBufferCount(ctx: BaseAudioContext): number {
  return caches.get(ctx)?.size ?? 0;
}

/** A loopable noise bed of a colour (noise has no audible seam, so it loops without a crossfade). */
export function noiseBuffer(ctx: BaseAudioContext, colour: NoiseColour, seconds = 4, seed = 'bed'): AudioBuffer {
  return cachedBuffer(ctx, `noise|${colour}|${seconds}|${seed}`, (sr) => noise(colour, sr * seconds, seed));
}
