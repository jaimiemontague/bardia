/**
 * Building blocks for the procedural sound effects (§28.5 "generated noise and envelope sounds"):
 * a voice object that tracks its sources and fades/stops them together, plus noise bursts, metallic
 * pings, pitched thumps, LFOs and an event scheduler for loops made of discrete events (oars,
 * hammer blows, hoofbeats, gull calls, babbling voices).
 */
import type { NoiseColour } from './dsp';
import { noiseBuffer } from './samples';

/** What a sound renderer gets. */
export interface SfxEnv {
  readonly ctx: BaseAudioContext;
  /** Dry output (the sound's own gain/pan → its bus). */
  readonly out: AudioNode;
  /** Reverb send input, when the bus has one. */
  readonly wet?: AudioNode | undefined;
  /** Seeded variation source in [0, 1). */
  readonly rnd: () => number;
  /** Pitch / rate multiplier (common `rate` param). */
  readonly rate: number;
}

/** A playing procedural sound. */
export interface SfxVoice {
  /** Context time after which the sound is silent (Infinity for a loop until stopped). */
  readonly endsAt: number;
  /** Schedules pending events up to `until` (event-stream loops; a no-op for the rest). */
  advance(until: number): void;
  /** Fades out over `fadeS` starting at `at`, then stops every source. */
  stop(at: number, fadeS: number): void;
}

/** Event scheduler for loops: called with the window [from, until) to fill. */
export type EventStream = (from: number, until: number) => void;

/** Base voice: a gain node feeding `env.out`, tracked sources, optional event stream. */
export class Voice implements SfxVoice {
  readonly gain: GainNode;
  readonly env: SfxEnv;
  endsAt: number;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private stream: EventStream | undefined;
  private scheduledUntil: number;
  private stopped = false;

  constructor(env: SfxEnv, when: number, endsAt: number, level = 1) {
    this.env = env;
    this.endsAt = endsAt;
    this.scheduledUntil = when;
    this.gain = env.ctx.createGain();
    this.gain.gain.value = level;
    this.gain.connect(env.out);
  }

  get ctx(): BaseAudioContext {
    return this.env.ctx;
  }

  /** Tracks a scheduled source so `stop` can end it. */
  track<T extends AudioScheduledSourceNode>(n: T): T {
    this.sources.push(n);
    if (this.sources.length > 256) this.sources.splice(0, this.sources.length - 256);
    return n;
  }

  /** Installs the event stream of a loop (scheduled from `advance`). */
  setStream(stream: EventStream): void {
    this.stream = stream;
  }

  /** A send from `node` into the reverb (if any) at `level`. */
  sendWet(node: AudioNode, level: number): void {
    if (!this.env.wet || level <= 0) return;
    const g = this.ctx.createGain();
    g.gain.value = level;
    node.connect(g);
    g.connect(this.env.wet);
  }

  advance(until: number): void {
    if (this.stopped || !this.stream || until <= this.scheduledUntil) return;
    this.stream(this.scheduledUntil, until);
    this.scheduledUntil = until;
  }

  stop(at: number, fadeS: number): void {
    if (this.stopped) return;
    this.stopped = true;
    const end = at + Math.max(0.005, fadeS);
    const g = this.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(0, end);
    for (const s of this.sources) {
      try {
        s.stop(end + 0.02);
      } catch {
        /* already stopped */
      }
    }
    this.endsAt = Math.min(this.endsAt, end + 0.05);
  }
}

// ---------------------------------------------------------------------------------------------
// Node helpers

export function gainNode(ctx: BaseAudioContext, value: number, dest: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/** A looping noise source into `dest`, from `when` to `end` (Infinity: until the voice stops). */
export function noiseSource(v: Voice, colour: NoiseColour, dest: AudioNode, when: number, end = Infinity, playbackRate = 1): AudioBufferSourceNode {
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx, colour, 4, `sfx-${colour}`);
  src.loop = true;
  src.playbackRate.value = playbackRate;
  src.connect(dest);
  src.start(when, v.env.rnd() * 3.5);
  if (Number.isFinite(end)) src.stop(end);
  return v.track(src);
}

/** A periodic modulator on `param`: `depth` × waveform at `rateHz`. */
export function lfo(v: Voice, param: AudioParam, rateHz: number, depth: number, when: number, end = Infinity, type: OscillatorType = 'sine'): OscillatorNode {
  const o = v.ctx.createOscillator();
  o.type = type;
  o.frequency.value = rateHz;
  const d = v.ctx.createGain();
  d.gain.value = depth;
  o.connect(d);
  d.connect(param);
  o.start(when);
  if (Number.isFinite(end)) o.stop(end);
  return v.track(o);
}

export interface BurstOptions {
  colour?: NoiseColour;
  type?: BiquadFilterType;
  freq: number;
  /** Filter frequency at the end of the burst (sweep). */
  freqEnd?: number;
  q?: number;
  dur: number;
  peak: number;
  attack?: number;
}

/** A filtered noise burst with an attack/exponential-decay envelope; returns its end time. */
export function burst(v: Voice, dest: AudioNode, when: number, o: BurstOptions): number {
  const ctx = v.ctx;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(dest);
  const f = biquad(ctx, o.type ?? 'bandpass', o.freq, o.q ?? 1, amp);
  const attack = Math.max(0.001, o.attack ?? 0.002);
  const end = when + attack + o.dur * 1.6;
  if (o.freqEnd !== undefined) {
    f.frequency.setValueAtTime(o.freq, when);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), when + attack + o.dur);
  }
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(o.peak, when + attack);
  amp.gain.setTargetAtTime(0, when + attack, Math.max(0.002, o.dur / 3));
  noiseSource(v, o.colour ?? 'white', f, when, end);
  return end;
}

/**
 * A struck metal/wood resonance: sine partials at `f0 × ratios[i]`, each with amplitude `amps[i]`
 * and an exponential decay rate `decays[i]` (1/s). Returns the end time.
 */
export function ping(v: Voice, dest: AudioNode, when: number, f0: number, ratios: readonly number[], decays: readonly number[], amps: readonly number[], peak: number): number {
  const ctx = v.ctx;
  let end = when;
  ratios.forEach((ratio, i) => {
    const freq = f0 * ratio;
    if (freq > 18000) return;
    const decay = decays[i] ?? decays[decays.length - 1] ?? 10;
    const amp = (amps[i] ?? 0.1) * peak;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.001);
    g.gain.setTargetAtTime(0, when + 0.001, 1 / decay);
    g.connect(dest);
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    o.connect(g);
    const stopAt = when + 5 / decay;
    o.start(when);
    o.stop(stopAt);
    v.track(o);
    end = Math.max(end, stopAt);
  });
  return end;
}

/** A pitched thump (drum-like body): sine falling from f0 to f1 over `dur`. Returns the end time. */
export function thump(v: Voice, dest: AudioNode, when: number, f0: number, f1: number, dur: number, peak: number): number {
  const ctx = v.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.003);
  g.gain.setTargetAtTime(0, when + 0.003, Math.max(0.005, dur / 3));
  g.connect(dest);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
  o.connect(g);
  const end = when + dur * 1.8 + 0.01;
  o.start(when);
  o.stop(end);
  v.track(o);
  return end;
}

/** Random float in [lo, hi) from the env's seeded source. */
export function between(env: SfxEnv, lo: number, hi: number): number {
  return lo + (hi - lo) * env.rnd();
}

/** A "next event time" ticker for event-stream loops: calls `emit(t)` for every event in [from, until). */
export function everyEvent(start: number, interval: (env: SfxEnv) => number, env: SfxEnv, emit: (t: number) => void): EventStream {
  let next = start;
  return (_from, until) => {
    while (next < until) {
      emit(next);
      next += Math.max(0.02, interval(env));
    }
  };
}
