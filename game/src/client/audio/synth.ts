/**
 * The placeholder score's instruments, built from WebAudio nodes on any BaseAudioContext (the live
 * AudioContext or an OfflineAudioContext rendering a placeholder file). §28.1 palette: lyre, harp and
 * oud are Karplus–Strong plucks (cached buffers); bowed strings, fiddle, bone flute, horn, drone,
 * choir and hum are small oscillator/filter graphs; frame drums are pre-rendered hits.
 *
 * Every call schedules one note at an absolute context time and cleans up after itself (sources
 * carry stop times, so finished notes are released by the audio graph).
 */
import { bellSample, drumSample, pluck } from './dsp';
import { cachedBuffer, noiseBuffer } from './samples';
import type { DrumHit, InstrumentId } from './styles';
import { midiToHz } from './theory';

/** Where a note is played: a context and the node it connects to (a layer or voice gain). */
export interface Voicing {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
}

/** Plucked-string models (§28.1 lyre; harp for the Albric/Cael lands; oud for the southern trade cities). */
const PLUCKS = {
  lyre: { t60: 2.2, brightness: 0.45, position: 0.22, ring: 1.4, level: 0.55 },
  harp: { t60: 3.0, brightness: 0.62, position: 0.13, ring: 2.2, level: 0.5 },
  oud: { t60: 1.4, brightness: 0.85, position: 0.09, ring: 0.8, level: 0.5 },
} as const;
type PluckId = keyof typeof PLUCKS;

function isPluck(i: InstrumentId): i is PluckId {
  return i === 'lyre' || i === 'harp' || i === 'oud';
}

/** Vowel formants (Hz, relative gain) for choir/voice placeholders. */
export const FORMANTS = {
  a: [
    [800, 1],
    [1150, 0.5],
    [2900, 0.18],
  ],
  o: [
    [450, 1],
    [800, 0.45],
    [2830, 0.1],
  ],
  u: [
    [325, 1],
    [700, 0.3],
    [2530, 0.06],
  ],
  e: [
    [400, 1],
    [1600, 0.4],
    [2700, 0.2],
  ],
  i: [
    [300, 1],
    [2200, 0.3],
    [3000, 0.18],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;
export type Vowel = keyof typeof FORMANTS;

/**
 * Attack–decay–sustain–release on a gain param: linear attack to `peak`, exponential decay to
 * `peak·sustain`, held until `release` then an exponential release of ~`r` seconds. Returns the time
 * after which the voice is inaudible.
 */
export function envelope(g: AudioParam, when: number, peak: number, a: number, d: number, sustain: number, release: number, r: number): number {
  const relAt = Math.max(release, when + a);
  g.setValueAtTime(0, when);
  g.linearRampToValueAtTime(peak, when + a);
  if (sustain < 1) g.setTargetAtTime(peak * sustain, when + a, Math.max(0.005, d / 3));
  g.setTargetAtTime(0, relAt, Math.max(0.005, r / 3));
  return relAt + r * 1.6;
}

/** Adds a delayed vibrato (depth in cents) to oscillators' detune params. */
function vibrato(ctx: BaseAudioContext, targets: readonly AudioParam[], when: number, end: number, rateHz: number, cents: number, delay: number): void {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rateHz;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, when);
  depth.gain.linearRampToValueAtTime(0, when + delay);
  depth.gain.linearRampToValueAtTime(cents, when + delay + 0.35);
  lfo.connect(depth);
  for (const t of targets) depth.connect(t);
  lfo.start(when);
  lfo.stop(end);
}

/** Creates, connects and schedules an oscillator. */
export function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detuneCents: number, dest: AudioNode, when: number, end: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detuneCents;
  o.connect(dest);
  o.start(when);
  o.stop(end);
  return o;
}

/** Creates a biquad filter connected to `dest`. */
export function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, dest: AudioNode, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (gainDb !== 0) f.gain.value = gainDb;
  f.connect(dest);
  return f;
}

/**
 * A vowel formant bank: returns the input node; each formant is a bandpass (bandwidth ~90 Hz) with
 * its relative gain × `makeup`, summed into `dest`. Formant centre frequencies are exposed as the
 * filters' params on the returned object so callers can glide between vowels.
 */
export function formantBank(ctx: BaseAudioContext, vowel: Vowel, makeup: number, dest: AudioNode): GainNode & { formants?: BiquadFilterNode[] } {
  const input: GainNode & { formants?: BiquadFilterNode[] } = ctx.createGain();
  const formants: BiquadFilterNode[] = [];
  for (const [freq, g] of FORMANTS[vowel]) {
    const fg = ctx.createGain();
    fg.gain.value = g * makeup;
    fg.connect(dest);
    const bp = filter(ctx, 'bandpass', freq, freq / 90, fg);
    input.connect(bp);
    formants.push(bp);
  }
  input.formants = formants;
  return input;
}

/** Glides a formant bank to another vowel at `when` over `seconds`. */
export function glideVowel(bank: { formants?: BiquadFilterNode[] }, vowel: Vowel, when: number, seconds: number): void {
  const targets = FORMANTS[vowel];
  bank.formants?.forEach((f, i) => {
    const t = targets[i];
    if (!t) return;
    f.frequency.setTargetAtTime(t[0], when, Math.max(0.005, seconds / 3));
    f.Q.setTargetAtTime(t[0] / 90, when, Math.max(0.005, seconds / 3));
  });
}

/** Plays a plucked note from a cached Karplus–Strong buffer. */
function playPluck(v: Voicing, inst: PluckId, midi: number, when: number, durS: number, vel: number): void {
  const m = PLUCKS[inst];
  const freq = midiToHz(midi);
  const seconds = Math.min(4, m.t60 * 1.1);
  const buf = cachedBuffer(v.ctx, `pluck|${inst}|${midi}`, (sr) =>
    pluck({ sampleRate: sr, freq, seconds, t60: m.t60, brightness: m.brightness, position: m.position, seed: inst }),
  );
  const src = v.ctx.createBufferSource();
  src.buffer = buf;
  const amp = v.ctx.createGain();
  const level = m.level * vel ** 1.4;
  const end = Math.min(when + buf.duration, when + durS + m.ring);
  amp.gain.setValueAtTime(level, when);
  amp.gain.setTargetAtTime(0, Math.max(when + 0.02, end - 0.12), 0.04);
  src.connect(amp);
  amp.connect(v.out);
  src.start(when);
  src.stop(end + 0.05);
}

/**
 * Schedules one note of a melodic/harmonic instrument. `durS` is the gate (key held) length; the
 * release tail follows it.
 */
export function playInstrumentNote(v: Voicing, instrument: InstrumentId, midi: number, when: number, durS: number, vel: number): void {
  if (isPluck(instrument)) return playPluck(v, instrument, midi, when, durS, vel);
  const { ctx } = v;
  const f = midiToHz(midi);
  const amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(v.out);
  const gateEnd = when + Math.max(0.05, durS);
  const lv = vel ** 1.3;
  switch (instrument) {
    case 'strings': {
      // Bowed strings: two detuned saws, darkened, slow bow attack, delayed vibrato.
      const lp = filter(ctx, 'lowpass', Math.min(7000, 700 + f * 2.5), 0.6, amp);
      const end = envelope(amp.gain, when, 0.16 * lv, 0.32, 0.5, 0.82, gateEnd, 0.55);
      const a = osc(ctx, 'sawtooth', f, -7, lp, when, end);
      const b = osc(ctx, 'sawtooth', f, 7, lp, when, end);
      vibrato(ctx, [a.detune, b.detune], when, end, 5.1, 9, 0.3);
      return;
    }
    case 'fiddle': {
      // Bowed fiddle: brighter, nasal body resonance, quicker bow.
      const lp = filter(ctx, 'lowpass', Math.min(9000, 3200 + f), 0.7, amp);
      const body = filter(ctx, 'peaking', 1050, 1.6, lp, 7);
      const end = envelope(amp.gain, when, 0.15 * lv, 0.06, 0.25, 0.85, gateEnd, 0.22);
      const a = osc(ctx, 'sawtooth', f, 0, body, when, end);
      const b = osc(ctx, 'sawtooth', f, 4, body, when, end);
      vibrato(ctx, [a.detune, b.detune], when, end, 5.7, 14, 0.14);
      return;
    }
    case 'flute': {
      // Bone flute: near-sine tone plus breath noise centred on the pitch, a chiff at the onset.
      const end = envelope(amp.gain, when, 0.26 * lv, 0.05, 0.2, 0.8, gateEnd, 0.14);
      const a = osc(ctx, 'sine', f, 0, amp, when, end);
      const tri = ctx.createGain();
      tri.gain.value = 0.25;
      tri.connect(amp);
      const b = osc(ctx, 'triangle', f, 0, tri, when, end);
      vibrato(ctx, [a.detune, b.detune], when, end, 4.8, 16, 0.18);
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer(ctx, 'white', 2, 'breath');
      breath.loop = true;
      const bAmp = ctx.createGain();
      bAmp.connect(v.out);
      const bp = filter(ctx, 'bandpass', Math.min(9000, f * 1.5), 1.8, bAmp);
      bAmp.gain.setValueAtTime(0, when);
      bAmp.gain.linearRampToValueAtTime(0.09 * lv, when + 0.03);
      bAmp.gain.setTargetAtTime(0.03 * lv, when + 0.03, 0.06);
      bAmp.gain.setTargetAtTime(0, gateEnd, 0.04);
      breath.connect(bp);
      breath.start(when, (midi % 7) * 0.13);
      breath.stop(end);
      return;
    }
    case 'horn': {
      // Cow-horn / lur: saw through a lowpass that opens on the attack, with a pitch scoop up.
      const lp = filter(ctx, 'lowpass', 250, 1.4, amp);
      const end = envelope(amp.gain, when, 0.2 * lv, 0.07, 0.3, 0.85, gateEnd, 0.28);
      lp.frequency.setValueAtTime(220, when);
      lp.frequency.linearRampToValueAtTime(Math.min(6000, f * 6), when + 0.08);
      lp.frequency.setTargetAtTime(Math.min(4000, f * 3.2), when + 0.08, 0.15);
      lp.frequency.setTargetAtTime(300, gateEnd, 0.1);
      const a = osc(ctx, 'sawtooth', f, 0, lp, when, end);
      const half = ctx.createGain();
      half.gain.value = 0.5;
      half.connect(lp);
      const b = osc(ctx, 'sawtooth', f, 6, half, when, end);
      for (const o of [a, b]) {
        o.detune.setValueAtTime(o.detune.value - 70, when);
        o.detune.linearRampToValueAtTime(o.detune.value, when + 0.07);
      }
      return;
    }
    case 'drone': {
      // Drone: detuned saws and a sub sine, a slowly breathing filter.
      const lp = filter(ctx, 'lowpass', 500 + f * 1.4, 0.8, amp);
      const end = envelope(amp.gain, when, 0.1 * lv, 1.4, 1, 0.9, gateEnd, 2.2);
      osc(ctx, 'sawtooth', f, -5, lp, when, end);
      osc(ctx, 'sawtooth', f, 5, lp, when, end);
      const sub = ctx.createGain();
      sub.gain.value = 1.8;
      sub.connect(lp);
      osc(ctx, 'sine', f / 2, 0, sub, when, end);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09 + (midi % 5) * 0.013;
      const depth = ctx.createGain();
      depth.gain.value = 180;
      lfo.connect(depth);
      depth.connect(lp.frequency);
      lfo.start(when);
      lfo.stop(end);
      return;
    }
    case 'choir':
    case 'hum': {
      // Voices: detuned saws through vowel formant bandpasses ('ah'/'oh' choir, 'oo' hum).
      const vowel: Vowel = instrument === 'hum' ? 'u' : midi < 55 ? 'o' : 'a';
      const mix = formantBank(ctx, vowel, instrument === 'hum' ? 3.2 : 4.5, amp);
      const attack = instrument === 'hum' ? 0.14 : 0.5;
      const rel = instrument === 'hum' ? 0.3 : 0.8;
      const end = envelope(amp.gain, when, (instrument === 'hum' ? 0.2 : 0.14) * lv, attack, 0.4, 0.9, gateEnd, rel);
      const voices = instrument === 'hum' ? [0] : [-10, 0, 9];
      const oscs = voices.map((d) => osc(ctx, 'sawtooth', f, d, mix, when, end));
      vibrato(ctx, oscs.map((o) => o.detune), when, end, 5, 11, 0.25);
      return;
    }
  }
}

/** Plays a frame-drum hit (two pre-rendered variants per hit alternate by velocity). */
export function playDrum(v: Voicing, hit: DrumHit, when: number, vel: number): void {
  const variant = Math.round(vel * 100) % 2;
  const buf = cachedBuffer(v.ctx, `drum|${hit}|${variant}`, (sr) => drumSample(hit, sr, `v${variant}`));
  const src = v.ctx.createBufferSource();
  src.buffer = buf;
  const amp = v.ctx.createGain();
  amp.gain.value = 0.9 * vel ** 1.2;
  src.connect(amp);
  amp.connect(v.out);
  src.start(when);
}

/** Plays a cast bronze bell tolling at `freq` (church bells of the Lantern lands). */
export function playBell(v: Voicing, freq: number, when: number, vel: number, seconds = 6): void {
  const buf = cachedBuffer(v.ctx, `bell|${Math.round(freq)}|${seconds}`, (sr) => bellSample(sr, freq, seconds));
  const src = v.ctx.createBufferSource();
  src.buffer = buf;
  const amp = v.ctx.createGain();
  amp.gain.value = vel;
  src.connect(amp);
  amp.connect(v.out);
  src.start(when);
}
