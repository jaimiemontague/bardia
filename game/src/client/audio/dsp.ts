/**
 * Pure sample synthesis for the placeholders: seeded noise colours, Karplus–Strong plucked strings
 * (lyre, harp, oud), frame-drum hits, a cast-bell, rain droplets, fire crackle and a reverb impulse
 * response. Every function returns plain Float32Arrays and is deterministic for its seed, so it is
 * unit-testable without WebAudio; the engine copies the results into AudioBuffers once and caches
 * them.
 */
import { hashString32 } from '@sim/core/rng';

/** Small fast PRNG (mulberry32) for sample-rate noise. Returns floats in [0, 1). */
export function noiseSource(seed: string): () => number {
  let a = hashString32(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scales a buffer so its peak magnitude is `peak` (no-op for silence). */
export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] as number));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] as number) * k;
  }
  return buf;
}

/** Linear fade-in/out of `ms` milliseconds at both ends (click-free loops and tails). */
export function fadeEdges(buf: Float32Array, sampleRate: number, ms: number): Float32Array {
  const n = Math.min(Math.floor(buf.length / 2), Math.floor((sampleRate * ms) / 1000));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    buf[i] = (buf[i] as number) * g;
    buf[buf.length - 1 - i] = (buf[buf.length - 1 - i] as number) * g;
  }
  return buf;
}

export type NoiseColour = 'white' | 'pink' | 'brown';

/** Seeded noise of a colour, normalised to peak 0.9 (pink: Kellet's filter; brown: leaky integrator). */
export function noise(colour: NoiseColour, length: number, seed: string): Float32Array {
  const rnd = noiseSource(`noise|${colour}|${seed}`);
  const out = new Float32Array(Math.max(1, Math.floor(length)));
  if (colour === 'white') {
    for (let i = 0; i < out.length; i++) out[i] = rnd() * 2 - 1;
  } else if (colour === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < out.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
      out[i] = last;
    }
  }
  return normalize(out);
}

export interface PluckOptions {
  readonly sampleRate: number;
  readonly freq: number;
  readonly seconds: number;
  /** Time for the string to decay by 60 dB (s). */
  readonly t60: number;
  /** 0..1: excitation brightness (pick hardness). */
  readonly brightness: number;
  /** 0..1: pluck position along the string (comb notch; 0.5 = middle, hollow). */
  readonly position: number;
  readonly seed: string;
}

/**
 * Karplus–Strong plucked string with a first-order all-pass for exact tuning (fractional delay),
 * frequency-independent loss set from the T60, a lowpassed noise excitation and a pluck-position
 * comb. Peak-normalised to 0.9 with a short fade at the end.
 */
export function pluck(o: PluckOptions): Float32Array {
  const sr = o.sampleRate;
  const len = Math.max(1, Math.floor(sr * o.seconds));
  const out = new Float32Array(len);
  const period = sr / Math.max(20, o.freq);
  // The two-point average adds half a sample of delay.
  const total = period - 0.5;
  const n = Math.max(2, Math.floor(total - 0.001));
  const frac = total - n;
  const apC = (1 - frac) / (1 + frac);
  const loss = 10 ** (-3 / (Math.max(0.05, o.t60) * o.freq));

  const rnd = noiseSource(`pluck|${o.seed}|${o.freq.toFixed(3)}`);
  const line = new Float32Array(n);
  // Excitation: one-pole lowpassed noise; brightness opens the filter.
  const a = 0.15 + 0.8 * Math.min(1, Math.max(0, o.brightness));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += a * (rnd() * 2 - 1 - lp);
    line[i] = lp;
  }
  // Pluck position comb: subtract a delayed copy.
  const pos = Math.max(1, Math.floor(n * Math.min(0.5, Math.max(0.05, o.position))));
  const shaped = new Float32Array(n);
  for (let i = 0; i < n; i++) shaped[i] = (line[i] as number) - 0.85 * (line[(i - pos + n) % n] as number);
  line.set(shaped);

  let idx = 0;
  let prev = 0;
  let apX1 = 0;
  let apY1 = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx] as number;
    const avg = 0.5 * (cur + prev);
    prev = cur;
    // All-pass fractional delay: y = C·x + x[n−1] − C·y[n−1]
    const y = apC * avg + apX1 - apC * apY1;
    apX1 = avg;
    apY1 = y;
    const v = y * loss;
    line[idx] = v;
    out[i] = cur;
    idx = idx + 1 >= n ? 0 : idx + 1;
  }
  // Remove DC and normalise.
  let dc = 0;
  for (let i = 0; i < len; i++) dc += out[i] as number;
  dc /= len;
  for (let i = 0; i < len; i++) out[i] = (out[i] as number) - dc;
  normalize(out);
  // Gentle release over the last 40 ms.
  const tail = Math.min(len, Math.floor(sr * 0.04));
  for (let i = 0; i < tail; i++) out[len - 1 - i] = (out[len - 1 - i] as number) * (i / tail);
  return out;
}

/** Frame-drum family samples. */
export type DrumSample = 'boom' | 'war' | 'slap' | 'tap' | 'shaker' | 'clap';

/** Renders one drum hit (mono, peak-normalised). */
export function drumSample(kind: DrumSample, sampleRate: number, seed = 'drum'): Float32Array {
  const sr = sampleRate;
  const rnd = noiseSource(`drum|${kind}|${seed}`);
  const secs = { boom: 0.7, war: 1.2, slap: 0.3, tap: 0.12, shaker: 0.14, clap: 0.22 }[kind];
  const len = Math.floor(sr * secs);
  const out = new Float32Array(len);
  const TWO_PI = Math.PI * 2;
  let phase = 0;
  let lp = 0;
  let hp = 0;
  let hpPrev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const w = rnd() * 2 - 1;
    let v = 0;
    switch (kind) {
      case 'boom': {
        // Pitched skin: 95 Hz falling to 58 Hz, with a soft felt-beater thump.
        const f = 58 + 37 * Math.exp(-t * 18);
        phase += (TWO_PI * f) / sr;
        lp += 0.08 * (w - lp);
        v = Math.sin(phase) * Math.exp(-t * 6.5) + lp * 2.2 * Math.exp(-t * 40);
        break;
      }
      case 'war': {
        // Big war drum: deeper, longer, rougher.
        const f = 42 + 30 * Math.exp(-t * 12);
        phase += (TWO_PI * f) / sr;
        lp += 0.05 * (w - lp);
        const body = Math.sin(phase) + 0.3 * Math.sin(phase * 1.6);
        v = Math.tanh(1.6 * body) * Math.exp(-t * 3.6) + lp * 3 * Math.exp(-t * 22);
        break;
      }
      case 'slap': {
        // Open slap near the rim: a 210 Hz ring plus a band of skin noise.
        phase += (TWO_PI * 210) / sr;
        hp = 0.75 * (hp + w - hpPrev);
        hpPrev = w;
        lp += 0.35 * (hp - lp);
        v = 0.7 * Math.sin(phase) * Math.exp(-t * 22) + 0.9 * lp * Math.exp(-t * 30);
        break;
      }
      case 'tap': {
        phase += (TWO_PI * 420) / sr;
        hp = 0.6 * (hp + w - hpPrev);
        hpPrev = w;
        v = 0.5 * Math.sin(phase) * Math.exp(-t * 60) + hp * Math.exp(-t * 80);
        break;
      }
      case 'shaker': {
        // Rattle of bone/seed: highpassed noise with a quick swell and decay.
        hp = 0.5 * (hp + w - hpPrev);
        hpPrev = w;
        const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 35);
        v = hp * env;
        break;
      }
      case 'clap': {
        // Hands: three quick bursts then a short tail.
        hp = 0.7 * (hp + w - hpPrev);
        hpPrev = w;
        lp += 0.5 * (hp - lp);
        const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.3) : Math.exp(-(t - 0.03) * 28);
        v = lp * burst;
        break;
      }
    }
    out[i] = v;
  }
  normalize(out);
  return fadeEdges(out, sr, 1);
}

/**
 * A cast bronze bell (minor-third "tierce" partials of a period bell): hum, prime, tierce, quint,
 * nominal and upper partials with individual decays; f0 is the strike note.
 */
export function bellSample(sampleRate: number, f0: number, seconds: number): Float32Array {
  const partials: readonly (readonly [number, number, number])[] = [
    // ratio, amplitude, decay (1/s)
    [0.5, 0.55, 0.35],
    [1, 0.8, 0.6],
    [1.2, 0.45, 0.8],
    [1.5, 0.3, 1.0],
    [2, 0.5, 1.2],
    [2.5, 0.2, 1.8],
    [3, 0.15, 2.4],
    [4.2, 0.1, 3.5],
  ];
  const len = Math.floor(sampleRate * seconds);
  const out = new Float32Array(len);
  for (const [ratio, amp, decay] of partials) {
    const w = (2 * Math.PI * f0 * ratio) / sampleRate;
    for (let i = 0; i < len; i++) out[i] = (out[i] as number) + amp * Math.sin(w * i) * Math.exp(-(i / sampleRate) * decay);
  }
  // Strike transient.
  const rnd = noiseSource(`bell|${f0}`);
  const strike = Math.floor(sampleRate * 0.01);
  for (let i = 0; i < strike; i++) out[i] = (out[i] as number) + (rnd() * 2 - 1) * 0.4 * (1 - i / strike);
  normalize(out);
  return fadeEdges(out, sampleRate, 5);
}

/** Random impulses with short decays (rain droplets on wool and water when `bright`, fire crackle otherwise). */
export function scatter(sampleRate: number, seconds: number, perSecond: number, seed: string, bright: boolean): Float32Array {
  const len = Math.floor(sampleRate * seconds);
  const out = new Float32Array(len);
  const rnd = noiseSource(`scatter|${seed}|${perSecond}|${bright ? 1 : 0}`);
  const count = Math.floor(seconds * perSecond);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(rnd() * len);
    const amp = 0.2 + 0.8 * rnd() ** 2;
    const decay = bright ? 1200 + rnd() * 2400 : 300 + rnd() * 900;
    const dur = Math.min(len - start, Math.floor(sampleRate * (bright ? 0.008 : 0.03)));
    let hpPrev = 0;
    let hp = 0;
    for (let i = 0; i < dur; i++) {
      const w = rnd() * 2 - 1;
      hp = bright ? 0.8 * (hp + w - hpPrev) : w;
      hpPrev = w;
      out[start + i] = (out[start + i] as number) + amp * hp * Math.exp(-(i / sampleRate) * decay);
    }
  }
  normalize(out, 0.8);
  return fadeEdges(out, sampleRate, 10);
}

/**
 * Stereo reverb impulse response: exponentially decaying noise whose high frequencies die faster
 * (a one-pole lowpass closing over time), with a short pre-delay. Returns [left, right].
 */
export function impulseResponse(sampleRate: number, seconds: number, seed = 'hall'): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const pre = Math.floor(sampleRate * 0.012);
  const chans: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const rnd = noiseSource(`ir|${seed}|${c}`);
    const out = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp((-6.9 * t) / seconds); // −60 dB at `seconds`
      const a = 0.9 * Math.exp(-t * 2.2) + 0.05;
      lp += a * (rnd() * 2 - 1 - lp);
      out[i] = lp * env;
    }
    chans.push(normalize(out, 0.5));
  }
  return [chans[0] as Float32Array, chans[1] as Float32Array];
}
