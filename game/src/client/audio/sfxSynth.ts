/**
 * Procedural placeholder sound effects, one renderer per catalog id (§28.2: UI, sea, weather,
 * battle, duel, town ambience, animals). Each renderer builds a small WebAudio graph on any
 * BaseAudioContext and returns an `SfxVoice`; loops run until stopped (event-based loops schedule
 * their events through `advance`). Variation comes from the env's seeded source, so a placeholder
 * render is reproducible.
 */
import type { CultureId } from '@content/schemas/ids';
import type { WindStrength } from '@sim/core/state';
import type { SfxId } from './catalog';
import { scatter } from './dsp';
import { cachedBuffer } from './samples';
import { between, biquad, burst, everyEvent, gainNode, lfo, noiseSource, ping, thump, Voice, type SfxEnv, type SfxVoice } from './sfxKit';
import { formantBank, glideVowel, playBell, playInstrumentNote, type Vowel } from './synth';

/** Resolved parameters (defaults filled, clamped) as produced by `resolveSfxParams`. */
export type ResolvedSfxParams = Readonly<Record<string, number | string>>;

/** A sound renderer. */
export type SfxRenderer = (env: SfxEnv, p: ResolvedSfxParams, when: number) => SfxVoice;

const num = (p: ResolvedSfxParams, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const str = (p: ResolvedSfxParams, k: string, d: string): string => (typeof p[k] === 'string' ? (p[k] as string) : d);

/** Metal partial ratios (inharmonic, sword/axe/anvil-like). */
const METAL = [1, 1.52, 2.27, 2.98, 4.1] as const;
const ANVIL = [1, 2.37, 3.86, 5.14, 6.7] as const;
const COIN = [1, 2.76, 5.4, 8.93] as const;

function looped(env: SfxEnv, when: number, level = 1): Voice {
  return new Voice(env, when, Infinity, level);
}

function oneShot(env: SfxEnv, when: number, seconds: number, level = 1): Voice {
  return new Voice(env, when, when + seconds, level);
}

/** A looping scatter buffer (rain droplets when bright, fire crackle otherwise). */
function scatterLoop(v: Voice, dest: AudioNode, when: number, perSecond: number, bright: boolean): void {
  const per = Math.max(4, Math.round(perSecond / 8) * 8);
  const buf = cachedBuffer(v.ctx, `scatter|${per}|${bright ? 1 : 0}`, (sr) => scatter(sr, 6, per, 'sfx', bright));
  const src = v.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(dest);
  src.start(when, v.env.rnd() * 5);
  v.track(src);
}

// ---------------------------------------------------------------------------------------------
// UI

function woodKnock(v: Voice, when: number, f: number, peak: number): void {
  burst(v, v.gain, when, { type: 'bandpass', freq: f * 2.2, q: 5, dur: 0.025, peak: peak * 0.8 });
  ping(v, v.gain, when, f, [1, 2.31, 3.9], [45, 70, 110], [1, 0.35, 0.12], peak * 0.6);
}

const uiClick: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 0.12);
  woodKnock(v, when, 1150 * env.rate * between(env, 0.97, 1.03), 0.9);
  return v;
};

const uiCoin: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 0.9);
  let t = when;
  const n = 2 + Math.floor(env.rnd() * 2);
  for (let i = 0; i < n; i++) {
    const f0 = (2300 + env.rnd() * 900) * env.rate;
    ping(v, v.gain, t, f0, COIN, [7, 10, 15, 22], [1, 0.5, 0.28, 0.14], 0.32);
    burst(v, v.gain, t, { type: 'highpass', freq: 5000, dur: 0.01, peak: 0.3 });
    t += 0.06 + env.rnd() * 0.07;
  }
  v.sendWet(v.gain, 0.15);
  return v;
};

const uiParchment: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 0.55);
  const amp = gainNode(v.ctx, 0, v.gain);
  const bp = biquad(v.ctx, 'bandpass', 3200 * env.rate, 0.6, amp);
  const hp = biquad(v.ctx, 'highpass', 1100, 0.7, bp);
  noiseSource(v, 'white', hp, when, when + 0.55);
  const g = amp.gain;
  g.setValueAtTime(0, when);
  let t = when;
  for (let i = 0; i < 9; i++) {
    t += 0.03 + env.rnd() * 0.035;
    g.linearRampToValueAtTime((0.2 + env.rnd() * 0.8) * 0.5, t);
  }
  g.linearRampToValueAtTime(0, t + 0.06);
  return v;
};

const uiConfirm: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 0.35);
  woodKnock(v, when, 620 * env.rate, 0.8);
  woodKnock(v, when + 0.11, 930 * env.rate, 0.9);
  return v;
};

const uiDeny: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 0.4);
  thump(v, v.gain, when, 170 * env.rate, 85 * env.rate, 0.18, 0.9);
  burst(v, v.gain, when, { colour: 'brown', type: 'lowpass', freq: 420, dur: 0.1, peak: 0.6 });
  return v;
};

// ---------------------------------------------------------------------------------------------
// Sea

const WAVES: Readonly<Record<WindStrength, { cut: number; depth: number; period: number; level: number; spray: number }>> = {
  calm: { cut: 360, depth: 180, period: 9, level: 0.4, spray: 0 },
  light: { cut: 560, depth: 320, period: 7.5, level: 0.5, spray: 0.04 },
  fresh: { cut: 850, depth: 520, period: 6.5, level: 0.6, spray: 0.12 },
  strong: { cut: 1300, depth: 760, period: 5.5, level: 0.7, spray: 0.25 },
  gale: { cut: 2000, depth: 1100, period: 4.5, level: 0.8, spray: 0.42 },
};

const seaWaves: SfxRenderer = (env, p, when) => {
  const w = WAVES[str(p, 'wind', 'light') as WindStrength] ?? WAVES.light;
  const v = looped(env, when);
  const period = w.period * between(env, 0.9, 1.1);
  // Swell body: brown noise through a breathing lowpass, its level surging with the swell.
  const swell = gainNode(v.ctx, w.level * 0.7, v.gain);
  lfo(v, swell.gain, 1 / period, w.level * 0.3, when);
  const lp = biquad(v.ctx, 'lowpass', w.cut, 0.5, swell);
  lfo(v, lp.frequency, 1 / period, w.depth, when);
  lfo(v, lp.frequency, 1 / (period * 1.618), w.depth * 0.45, when);
  noiseSource(v, 'brown', lp, when);
  // Hull-side wash.
  const wash = gainNode(v.ctx, w.level * 0.35, v.gain);
  lfo(v, wash.gain, 1 / (period * 0.77), w.level * 0.2, when);
  noiseSource(v, 'pink', biquad(v.ctx, 'bandpass', 420, 0.5, wash), when);
  // Whitecaps and spray in stronger winds.
  if (w.spray > 0) {
    const spray = gainNode(v.ctx, w.spray * 0.4, v.gain);
    lfo(v, spray.gain, 1 / (period * 0.7), w.spray * 0.35, when);
    noiseSource(v, 'white', biquad(v.ctx, 'highpass', 2600, 0.6, spray), when);
    v.sendWet(spray, 0.3);
  }
  return v;
};

const seaOars: SfxRenderer = (env, p, when) => {
  const v = looped(env, when);
  const spm = num(p, 'strokesPerMin', 24);
  const bed = gainNode(v.ctx, 0.12, v.gain);
  noiseSource(v, 'brown', biquad(v.ctx, 'lowpass', 320, 0.5, bed), when);
  v.setStream(
    everyEvent(when + 0.05, () => 60 / spm, env, (t) => {
      // Oar-port knock, the catch (thirty blades, smeared), then the wash.
      thump(v, v.gain, t, 190, 140, 0.05, 0.35);
      burst(v, v.gain, t, { type: 'bandpass', freq: 950, q: 4, dur: 0.02, peak: 0.25 });
      for (let k = 0; k < 3; k++) {
        burst(v, v.gain, t + 0.12 + (env.rnd() - 0.5) * 0.04, { type: 'bandpass', freq: 1150, freqEnd: 620, q: 0.8, dur: 0.22, peak: 0.28 });
      }
      burst(v, v.gain, t + 0.28, { colour: 'pink', type: 'lowpass', freq: 750, q: 0.5, dur: 0.6, peak: 0.3, attack: 0.18 });
    }),
  );
  return v;
};

const seaSailFlap: SfxRenderer = (env, p, when) => {
  const s = num(p, 'strength', 0.5);
  const v = oneShot(env, when, 1.5);
  const n = 3 + Math.round(s * 4);
  let t = when;
  for (let i = 0; i < n; i++) {
    burst(v, v.gain, t, { colour: 'pink', type: 'lowpass', freq: 650 + s * 900, q: 0.7, dur: between(env, 0.05, 0.11), peak: between(env, 0.45, 0.9) });
    thump(v, v.gain, t, 130, 70, 0.07, 0.25 + s * 0.2);
    t += between(env, 0.08, 0.16) * (1.2 - s * 0.4);
  }
  burst(v, v.gain, t + 0.05, { colour: 'brown', type: 'lowpass', freq: 320, dur: 0.3, peak: 0.6, attack: 0.04 });
  return v;
};

const seaHullCreak: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 1.7);
  for (let k = 0; k < 2; k++) {
    const start = when + k * between(env, 0.55, 0.8);
    const dur = k === 0 ? between(env, 0.7, 1.0) : between(env, 0.35, 0.55);
    const amp = gainNode(v.ctx, 0, v.gain);
    const res = biquad(v.ctx, 'bandpass', between(env, 600, 1100) * env.rate, 7, amp);
    const res2 = biquad(v.ctx, 'bandpass', 1700 * env.rate, 5, amp);
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = between(env, 26, 48);
    o.frequency.setValueAtTime(f0, start);
    o.frequency.linearRampToValueAtTime(f0 * between(env, 1.3, 1.9), start + dur * 0.6);
    o.frequency.linearRampToValueAtTime(f0 * between(env, 0.8, 1.1), start + dur);
    o.connect(res);
    o.connect(res2);
    o.start(start);
    o.stop(start + dur + 0.1);
    v.track(o);
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(0.9 - k * 0.3, start + 0.12);
    amp.gain.setTargetAtTime(0, start + dur - 0.1, 0.04);
  }
  return v;
};

const seaSplash: SfxRenderer = (env, p, when) => {
  const size = num(p, 'size', 0.5);
  const v = oneShot(env, when, 1.6);
  burst(v, v.gain, when, { type: 'lowpass', freq: 4200, freqEnd: 450, q: 0.6, dur: 0.35 + size * 0.5, peak: 0.6 + size * 0.4, attack: 0.01 });
  thump(v, v.gain, when, 100, 48, 0.22, 0.3 + size * 0.5);
  for (let i = 0; i < 6; i++) burst(v, v.gain, when + 0.18 + env.rnd() * 0.6, { type: 'bandpass', freq: between(env, 1800, 4200), q: 3, dur: 0.02, peak: 0.12 });
  v.sendWet(v.gain, 0.2);
  return v;
};

// ---------------------------------------------------------------------------------------------
// Weather

const weatherRain: SfxRenderer = (env, p, when) => {
  const i = num(p, 'intensity', 0.5);
  const v = looped(env, when);
  const hiss = gainNode(v.ctx, 0.12 + 0.45 * i, v.gain);
  noiseSource(v, 'pink', biquad(v.ctx, 'lowpass', 6500, 0.5, biquad(v.ctx, 'highpass', 900, 0.5, hiss)), when);
  scatterLoop(v, gainNode(v.ctx, 0.3 + 0.4 * i, v.gain), when, 30 + 300 * i, true);
  if (i > 0.4) noiseSource(v, 'brown', biquad(v.ctx, 'lowpass', 380, 0.5, gainNode(v.ctx, 0.35 * (i - 0.4), v.gain)), when);
  return v;
};

const weatherWind: SfxRenderer = (env, p, when) => {
  const s = num(p, 'strength', 0.5);
  const v = looped(env, when);
  const body = gainNode(v.ctx, 0.25 + 0.35 * s, v.gain);
  lfo(v, body.gain, between(env, 0.11, 0.15), 0.12 + 0.15 * s, when);
  lfo(v, body.gain, between(env, 0.05, 0.08), 0.08, when);
  const bp = biquad(v.ctx, 'bandpass', 320 + 520 * s, 0.8, body);
  lfo(v, bp.frequency, between(env, 0.09, 0.13), 180 + 380 * s, when);
  noiseSource(v, 'pink', bp, when);
  if (s > 0.35) {
    const whistle = gainNode(v.ctx, (s - 0.35) * 0.35, v.gain);
    lfo(v, whistle.gain, 0.17, (s - 0.35) * 0.25, when);
    const wbp = biquad(v.ctx, 'bandpass', 950 + 700 * s, 14, whistle);
    lfo(v, wbp.frequency, 0.21, 160, when);
    noiseSource(v, 'white', wbp, when);
  }
  return v;
};

const weatherThunder: SfxRenderer = (env, p, when) => {
  const d = num(p, 'distance', 0.4);
  const delay = d * 0.45;
  const v = oneShot(env, when, delay + 6.8);
  const t0 = when + delay;
  if (d < 0.6) {
    burst(v, v.gain, t0, { type: 'highpass', freq: 1400, dur: 0.16, peak: (0.6 - d) * 1.6 });
    burst(v, v.gain, t0 + 0.02, { colour: 'pink', type: 'lowpass', freq: 2500, dur: 0.25, peak: (0.6 - d) * 1.2 });
  }
  const amp = gainNode(v.ctx, 0, v.gain);
  noiseSource(v, 'brown', biquad(v.ctx, 'lowpass', 320 - 200 * d, 0.6, amp), t0, t0 + 6.6);
  const g = amp.gain;
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(1 - d * 0.4, t0 + 0.25 + d * 0.3);
  let t = t0 + 0.3 + d * 0.3;
  while (t < t0 + 4.6) {
    g.setTargetAtTime(between(env, 0.35, 1) * (1 - d * 0.4), t, 0.18);
    t += between(env, 0.45, 0.9);
  }
  g.setTargetAtTime(0, t, 0.5);
  v.sendWet(v.gain, 0.35);
  return v;
};

// ---------------------------------------------------------------------------------------------
// Battle

function metalBlow(v: Voice, t: number, peak: number): void {
  const env = v.env;
  ping(v, v.gain, t, between(env, 1300, 3100) * env.rate, METAL, [11, 14, 19, 24, 30], [1, 0.6, 0.45, 0.3, 0.2], 0.35 * peak);
  burst(v, v.gain, t, { type: 'highpass', freq: 3000, dur: 0.018, peak: 0.7 * peak });
  thump(v, v.gain, t, 210, 120, 0.05, 0.3 * peak);
}

const battleClash: SfxRenderer = (env, p, when) => {
  const count = Math.round(num(p, 'count', 3));
  const v = oneShot(env, when, 1.5);
  for (let i = 0; i < count; i++) metalBlow(v, when + (i === 0 ? 0 : env.rnd() * 0.9), between(env, 0.6, 1));
  v.sendWet(v.gain, 0.12);
  return v;
};

const battleShieldBash: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 0.7);
  thump(v, v.gain, when, 115 * env.rate, 55 * env.rate, 0.18, 1);
  burst(v, v.gain, when, { colour: 'brown', type: 'lowpass', freq: 600, dur: 0.14, peak: 0.8 });
  burst(v, v.gain, when, { colour: 'pink', type: 'bandpass', freq: 460, q: 2, dur: 0.08, peak: 0.7 });
  ping(v, v.gain, when + 0.01, 880 * env.rate, [1, 2.1, 3.3], [18, 25, 32], [0.5, 0.25, 0.12], 0.45);
  return v;
};

const battleArrowVolley: SfxRenderer = (env, p, when) => {
  const size = num(p, 'size', 0.5);
  const v = oneShot(env, when, 2.6);
  const n = 6 + Math.round(size * 24);
  for (let i = 0; i < n; i++) burst(v, v.gain, when + env.rnd() * 0.25, { type: 'bandpass', freq: 1500, q: 3, dur: 0.012, peak: 0.22 });
  for (let i = 0; i < Math.min(n, 8); i++) {
    burst(v, v.gain, when + 0.1 + env.rnd() * 0.2, { type: 'bandpass', freq: between(env, 2300, 3000), freqEnd: between(env, 900, 1300), q: 9, dur: between(env, 0.8, 1.1), peak: 0.12 + size * 0.06, attack: 0.25 });
  }
  for (let i = 0; i < n; i++) {
    const t = when + 1.2 + env.rnd() * 0.7;
    if (env.rnd() < 0.4) burst(v, v.gain, t, { colour: 'pink', type: 'bandpass', freq: 700, q: 3, dur: 0.04, peak: 0.3 });
    else burst(v, v.gain, t, { colour: 'brown', type: 'lowpass', freq: between(env, 500, 1100), dur: 0.05, peak: 0.35 });
  }
  return v;
};

const battleFire: SfxRenderer = (env, p, when) => {
  const size = num(p, 'size', 0.5);
  const v = looped(env, when);
  const roar = gainNode(v.ctx, 0.22 + 0.42 * size, v.gain);
  lfo(v, roar.gain, between(env, 0.6, 0.8), 0.08 + 0.1 * size, when);
  lfo(v, roar.gain, between(env, 2.1, 2.6), 0.05, when);
  const lp = biquad(v.ctx, 'lowpass', 300 + 500 * size, 0.7, roar);
  lfo(v, lp.frequency, 0.3, 120, when);
  noiseSource(v, 'brown', lp, when);
  scatterLoop(v, gainNode(v.ctx, 0.3 + 0.5 * size, v.gain), when, 8 + 30 * size, false);
  noiseSource(v, 'white', biquad(v.ctx, 'highpass', 4200, 0.7, gainNode(v.ctx, 0.04 * size, v.gain)), when);
  return v;
};

const battleSeaFire: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 3.3);
  // Siphon hiss and pressurised whoosh, then clinging flame on the water.
  burst(v, v.gain, when, { type: 'highpass', freq: 3200, dur: 0.45, peak: 0.35, attack: 0.05 });
  burst(v, v.gain, when + 0.05, { colour: 'pink', type: 'bandpass', freq: 260, freqEnd: 2600, q: 1.2, dur: 0.45, peak: 1, attack: 0.3 });
  const roar = gainNode(v.ctx, 0, v.gain);
  noiseSource(v, 'brown', biquad(v.ctx, 'lowpass', 720, 0.7, roar), when + 0.3, when + 3.3);
  roar.gain.setValueAtTime(0, when + 0.3);
  roar.gain.linearRampToValueAtTime(0.8, when + 0.6);
  roar.gain.setTargetAtTime(0, when + 1.8, 0.45);
  const crackle = gainNode(v.ctx, 0, v.gain);
  scatterLoop(v, crackle, when + 0.4, 30, false);
  crackle.gain.setValueAtTime(0, when + 0.4);
  crackle.gain.linearRampToValueAtTime(0.6, when + 0.7);
  crackle.gain.setTargetAtTime(0, when + 2, 0.4);
  v.sendWet(v.gain, 0.2);
  return v;
};

/** Horn-call figures: [semitones above the base, start (s), length (s)]. */
export const HORN_CALLS = {
  muster: [[0, 0, 2.8]],
  charge: [
    [0, 0, 0.42],
    [3, 0.58, 0.42],
    [7, 1.16, 1.5],
  ],
  retreat: [
    [7, 0, 0.9],
    [0, 1.05, 1.7],
  ],
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>;

const battleWarHorn: SfxRenderer = (env, p, when) => {
  const call = HORN_CALLS[str(p, 'call', 'muster') as keyof typeof HORN_CALLS] ?? HORN_CALLS.muster;
  let end = when;
  for (const [, at, len] of call) end = Math.max(end, when + at + len);
  const v = oneShot(env, when, end - when + 0.8);
  const base = 45 + Math.round(12 * Math.log2(env.rate || 1));
  for (const [semi, at, len] of call) {
    playInstrumentNote({ ctx: v.ctx, out: v.gain }, 'horn', base + semi, when + at, len, 0.95);
    playInstrumentNote({ ctx: v.ctx, out: v.gain }, 'horn', base + semi - 12, when + at, len, 0.55);
  }
  v.sendWet(v.gain, 0.45);
  return v;
};

/** Crowd voices per culture: vowel, mean pitch, chant rate (shouts/s; 0 = sustained roar), ululation. */
export const CROWDS: Readonly<Record<CultureId, { vowel: Vowel; pitch: number; chant: number; ululate: number; rise: number }>> = {
  skarn: { vowel: 'o', pitch: 125, chant: 0, ululate: 0, rise: 3 },
  hvarn: { vowel: 'a', pitch: 112, chant: 1.6, ululate: 0, rise: 1 },
  eyjar: { vowel: 'e', pitch: 140, chant: 0, ululate: 0, rise: 5 },
  albric: { vowel: 'a', pitch: 130, chant: 0, ululate: 0, rise: 2 },
  cael: { vowel: 'i', pitch: 165, chant: 0, ululate: 7, rise: 4 },
  corvani: { vowel: 'a', pitch: 135, chant: 1.2, ululate: 0, rise: 2 },
  velkar: { vowel: 'o', pitch: 120, chant: 1, ululate: 0, rise: 1 },
  kurgai: { vowel: 'i', pitch: 175, chant: 0, ululate: 8, rise: 6 },
  saraleonese: { vowel: 'e', pitch: 124, chant: 0.8, ululate: 0, rise: 0 },
  isafolder: { vowel: 'u', pitch: 108, chant: 0, ululate: 0, rise: 2 },
  rime: { vowel: 'a', pitch: 150, chant: 2.4, ululate: 0, rise: 3 },
};

function crowd(env: SfxEnv, p: ResolvedSfxParams, when: number, voices: number, dur: number): SfxVoice {
  const spec = CROWDS[str(p, 'culture', 'skarn') as CultureId] ?? CROWDS.skarn;
  const v = oneShot(env, when, dur + 0.6);
  const amp = gainNode(v.ctx, 0, v.gain);
  const bank = formantBank(v.ctx, spec.vowel, 3.5, amp);
  const end = when + dur + 0.5;
  for (let i = 0; i < voices; i++) {
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    const f = spec.pitch * between(env, 0.78, 1.35) * env.rate;
    const start = when + env.rnd() * 0.15;
    o.frequency.setValueAtTime(f, start);
    o.frequency.linearRampToValueAtTime(f * 2 ** (spec.rise / 12), start + dur * 0.45);
    o.frequency.linearRampToValueAtTime(f * 2 ** ((spec.rise - 2) / 12), start + dur);
    o.detune.value = (env.rnd() - 0.5) * 30;
    const vg = gainNode(v.ctx, 1 / Math.sqrt(voices), bank);
    o.connect(vg);
    o.start(start);
    o.stop(end);
    v.track(o);
  }
  noiseSource(v, 'pink', biquad(v.ctx, 'bandpass', 1100, 0.7, gainNode(v.ctx, 0.12, amp)), when, end);
  const g = amp.gain;
  const peak = 0.5;
  if (spec.chant > 0) {
    // Rhythmic shouts.
    g.setValueAtTime(0, when);
    const step = 1 / spec.chant;
    for (let t = 0; t < dur - 0.1; t += step) {
      g.setTargetAtTime(peak, when + t, 0.015);
      g.setTargetAtTime(peak * 0.08, when + t + 0.1, 0.08);
    }
    g.setTargetAtTime(0, when + dur, 0.1);
  } else {
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + 0.35);
    g.setTargetAtTime(peak * 0.8, when + 0.4, 0.5);
    g.setTargetAtTime(0, when + dur - 0.3, 0.25);
  }
  if (spec.ululate > 0) lfo(v, amp.gain, spec.ululate, peak * 0.4, when, end);
  if (spec.vowel !== 'a') glideVowel(bank, 'a', when + dur * 0.5, dur * 0.4);
  v.sendWet(v.gain, 0.25);
  return v;
}

const battleCrowdRoar: SfxRenderer = (env, p, when) => crowd(env, p, when, 6 + Math.round(num(p, 'size', 0.6) * 10), 3.2);
const battleWarCry: SfxRenderer = (env, p, when) => crowd(env, p, when, 4, 1.4);

// ---------------------------------------------------------------------------------------------
// Duel

const duelImpact: SfxRenderer = (env, p, when) => {
  const v = oneShot(env, when, 0.9);
  const m = str(p, 'material', 'metal');
  if (m === 'wood') {
    thump(v, v.gain, when, 150 * env.rate, 80 * env.rate, 0.1, 0.8);
    burst(v, v.gain, when, { colour: 'pink', type: 'bandpass', freq: 650, q: 2.5, dur: 0.09, peak: 1 });
    ping(v, v.gain, when, 380 * env.rate, [1, 2.4], [30, 45], [0.4, 0.2], 0.6);
  } else if (m === 'flesh') {
    thump(v, v.gain, when, 90 * env.rate, 45 * env.rate, 0.16, 1);
    burst(v, v.gain, when, { colour: 'brown', type: 'lowpass', freq: 360, dur: 0.12, peak: 0.8 });
    burst(v, v.gain, when, { colour: 'pink', type: 'lowpass', freq: 900, dur: 0.05, peak: 0.3 });
  } else {
    ping(v, v.gain, when, between(env, 1700, 2400) * env.rate, METAL, [5, 7, 9, 13, 18], [1, 0.6, 0.45, 0.3, 0.2], 0.45);
    burst(v, v.gain, when, { type: 'highpass', freq: 2500, dur: 0.025, peak: 0.8 });
    thump(v, v.gain, when, 220, 140, 0.05, 0.4);
  }
  v.sendWet(v.gain, 0.1);
  return v;
};

const duelGrunt: SfxRenderer = (env, p, when) => {
  const effort = num(p, 'effort', 0.5);
  const dur = 0.16 + effort * 0.16;
  const v = oneShot(env, when, dur + 0.3);
  const amp = gainNode(v.ctx, 0, v.gain);
  const bank = formantBank(v.ctx, 'a', 3, amp);
  const o = v.ctx.createOscillator();
  o.type = 'sawtooth';
  const f = (110 + effort * 40) * env.rate * between(env, 0.94, 1.06);
  o.frequency.setValueAtTime(f, when);
  o.frequency.linearRampToValueAtTime(f * 0.78, when + dur);
  o.connect(bank);
  o.start(when);
  o.stop(when + dur + 0.2);
  v.track(o);
  glideVowel(bank, 'u', when + dur * 0.4, dur * 0.5);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.7, when + 0.03);
  amp.gain.setTargetAtTime(0, when + dur, 0.04);
  burst(v, v.gain, when, { colour: 'pink', type: 'bandpass', freq: 1200, q: 0.8, dur: dur * 0.8, peak: 0.15, attack: 0.02 });
  return v;
};

// ---------------------------------------------------------------------------------------------
// Town ambience

const VOWELS: readonly Vowel[] = ['a', 'e', 'i', 'o', 'u'];

/** Babbling voices (market murmur, hall chatter): saw voices through gliding vowel formants. */
function babble(v: Voice, when: number, o: { voices: number; lo: number; hi: number; lowpass: number; level: number }): (from: number, until: number) => void {
  const env = v.env;
  const mix = biquad(v.ctx, 'lowpass', o.lowpass, 0.5, gainNode(v.ctx, o.level, v.gain));
  const voices = Array.from({ length: o.voices }, () => {
    const amp = gainNode(v.ctx, 0, mix);
    const bank = formantBank(v.ctx, VOWELS[Math.floor(env.rnd() * VOWELS.length)] ?? 'a', 2.6, amp);
    const osc = v.ctx.createOscillator();
    osc.type = 'sawtooth';
    const f = between(env, o.lo, o.hi) * env.rate;
    osc.frequency.value = f;
    osc.connect(bank);
    osc.start(when);
    v.track(osc);
    return { amp, bank, osc, f, next: when + env.rnd() * 0.5 };
  });
  return (_from, until) => {
    for (const vc of voices) {
      while (vc.next < until) {
        const t = vc.next;
        const pause = env.rnd() < 0.18;
        const syl = pause ? between(env, 0.25, 0.9) : between(env, 0.11, 0.28);
        vc.amp.gain.setTargetAtTime(pause ? 0 : between(env, 0.15, 0.6), t, 0.03);
        if (!pause) {
          glideVowel(vc.bank, VOWELS[Math.floor(env.rnd() * VOWELS.length)] ?? 'a', t, syl * 0.6);
          vc.osc.frequency.setTargetAtTime(vc.f * between(env, 0.88, 1.15), t, syl / 2);
        }
        vc.next = t + syl;
      }
    }
  };
}

function combine(...streams: ((from: number, until: number) => void)[]): (from: number, until: number) => void {
  return (from, until) => {
    for (const s of streams) s(from, until);
  };
}

const townMarket: SfxRenderer = (env, _p, when) => {
  const v = looped(env, when);
  noiseSource(v, 'pink', biquad(v.ctx, 'lowpass', 1500, 0.5, gainNode(v.ctx, 0.05, v.gain)), when);
  const talk = babble(v, when, { voices: 5, lo: 105, hi: 230, lowpass: 3000, level: 0.4 });
  const carts = everyEvent(when + between(env, 3, 8), (e) => between(e, 9, 18), env, (t) => {
    burst(v, v.gain, t, { colour: 'brown', type: 'lowpass', freq: 220, dur: 1.4, peak: 0.25, attack: 0.5 });
    for (let k = 0; k < 6; k++) burst(v, v.gain, t + 0.3 + k * 0.22, { colour: 'pink', type: 'bandpass', freq: 500, q: 3, dur: 0.03, peak: 0.08 });
  });
  const coins = everyEvent(when + between(env, 1, 4), (e) => between(e, 3, 7), env, (t) => {
    ping(v, v.gain, t, between(env, 2400, 3200), COIN, [8, 11, 16, 22], [1, 0.5, 0.25, 0.12], 0.08);
  });
  v.setStream(combine(talk, carts, coins));
  v.sendWet(v.gain, 0.15);
  return v;
};

const townSmithy: SfxRenderer = (env, _p, when) => {
  const v = looped(env, when);
  const forge = gainNode(v.ctx, 0.16, v.gain);
  lfo(v, forge.gain, 0.23, 0.05, when);
  noiseSource(v, 'brown', biquad(v.ctx, 'lowpass', 260, 0.6, forge), when);
  const hammer = everyEvent(when + 0.3, (e) => between(e, 2.2, 3.2), env, (t) => {
    const f0 = 1350 * between(env, 0.96, 1.04) * env.rate;
    for (let k = 0; k < 3; k++) {
      const peak = k === 2 ? 0.35 : 0.55;
      ping(v, v.gain, t + k * 0.32, f0 * (k === 2 ? 1.06 : 1), ANVIL, [3.5, 5, 7, 9, 12], [1, 0.6, 0.4, 0.25, 0.12], peak * 0.5);
      burst(v, v.gain, t + k * 0.32, { type: 'highpass', freq: 2000, dur: 0.015, peak: peak * 0.5 });
    }
  });
  const bellows = everyEvent(when + between(env, 1.5, 4), (e) => between(e, 5, 8), env, (t) => {
    burst(v, v.gain, t, { colour: 'pink', type: 'lowpass', freq: 520, dur: 0.7, peak: 0.25, attack: 0.4 });
  });
  v.setStream(combine(hammer, bellows));
  v.sendWet(v.gain, 0.2);
  return v;
};

const townHallChatter: SfxRenderer = (env, _p, when) => {
  const v = looped(env, when);
  scatterLoop(v, gainNode(v.ctx, 0.12, v.gain), when, 10, false);
  const talk = babble(v, when, { voices: 6, lo: 92, hi: 185, lowpass: 1900, level: 0.45 });
  const laughs = everyEvent(when + between(env, 2, 6), (e) => between(e, 5, 10), env, (t) => {
    const amp = gainNode(v.ctx, 0, v.gain);
    const bank = formantBank(v.ctx, 'a', 2.8, amp);
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    const f = between(env, 170, 260);
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.8);
    o.connect(bank);
    o.start(t);
    o.stop(t + 1);
    v.track(o);
    amp.gain.setValueAtTime(0, t);
    for (let k = 0; k < 4; k++) {
      amp.gain.setTargetAtTime(0.35, t + k * 0.16, 0.012);
      amp.gain.setTargetAtTime(0, t + k * 0.16 + 0.07, 0.03);
    }
  });
  const cups = everyEvent(when + between(env, 1, 3), (e) => between(e, 3, 7), env, (t) => {
    ping(v, v.gain, t, between(env, 2900, 3800), [1, 2.6, 4.1], [25, 40, 55], [1, 0.4, 0.2], 0.12);
  });
  v.setStream(combine(talk, laughs, cups));
  v.sendWet(v.gain, 0.3);
  return v;
};

const townGulls: SfxRenderer = (env, _p, when) => {
  const v = looped(env, when);
  const surf = gainNode(v.ctx, 0.07, v.gain);
  lfo(v, surf.gain, 0.12, 0.03, when);
  noiseSource(v, 'pink', biquad(v.ctx, 'lowpass', 650, 0.5, surf), when);
  v.setStream(
    everyEvent(when + between(env, 0.3, 1.5), (e) => between(e, 1.5, 5), env, (t) => {
      const pan = v.ctx.createStereoPanner();
      pan.pan.value = between(env, -0.8, 0.8);
      pan.connect(v.gain);
      const amp = gainNode(v.ctx, 0, pan);
      const bp = biquad(v.ctx, 'bandpass', 2100, 1.5, amp);
      const notes = 2 + Math.floor(env.rnd() * 3);
      const level = between(env, 0.12, 0.25);
      for (let k = 0; k < notes; k++) {
        const s = t + k * between(env, 0.28, 0.4);
        const o = v.ctx.createOscillator();
        o.type = 'triangle';
        const f = between(env, 1550, 1850) * env.rate;
        o.frequency.setValueAtTime(f, s);
        o.frequency.exponentialRampToValueAtTime(f * 1.45, s + 0.06);
        o.frequency.exponentialRampToValueAtTime(f * 0.78, s + 0.28);
        o.connect(bp);
        o.start(s);
        o.stop(s + 0.32);
        v.track(o);
        amp.gain.setValueAtTime(0, s);
        amp.gain.linearRampToValueAtTime(level, s + 0.03);
        amp.gain.setTargetAtTime(0, s + 0.2, 0.03);
      }
      lfo(v, amp.gain, 27, level * 0.3, t, t + notes * 0.4 + 0.3, 'square');
    }),
  );
  return v;
};

const townChurchBell: SfxRenderer = (env, p, when) => {
  const tolls = Math.round(num(p, 'tolls', 3));
  const v = oneShot(env, when, (tolls - 1) * 2.4 + 6.2);
  for (let k = 0; k < tolls; k++) playBell({ ctx: v.ctx, out: v.gain }, 330 * env.rate, when + k * 2.4, 0.6, 6);
  v.sendWet(v.gain, 0.45);
  return v;
};

// ---------------------------------------------------------------------------------------------
// Animals

const animalWolfHowl: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 3.8);
  const amp = gainNode(v.ctx, 0, biquad(v.ctx, 'lowpass', 2300, 0.6, v.gain));
  const o = v.ctx.createOscillator();
  o.type = 'triangle';
  const f = between(env, 310, 350) * env.rate;
  o.frequency.setValueAtTime(f, when);
  o.frequency.exponentialRampToValueAtTime(f * 1.9, when + 0.7);
  o.frequency.linearRampToValueAtTime(f * 2, when + 1.6);
  o.frequency.exponentialRampToValueAtTime(f * 1.3, when + 3.2);
  o.connect(amp);
  const h = v.ctx.createOscillator();
  h.frequency.setValueAtTime(f * 2, when);
  h.frequency.exponentialRampToValueAtTime(f * 3.8, when + 0.7);
  h.frequency.linearRampToValueAtTime(f * 4, when + 1.6);
  h.frequency.exponentialRampToValueAtTime(f * 2.6, when + 3.2);
  h.connect(gainNode(v.ctx, 0.15, amp));
  for (const n of [o, h]) {
    n.start(when);
    n.stop(when + 3.6);
    v.track(n);
  }
  lfo(v, o.detune, 5, 14, when + 0.8, when + 3.4);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.45, when + 0.35);
  amp.gain.setTargetAtTime(0, when + 2.9, 0.15);
  v.sendWet(v.gain, 0.6);
  return v;
};

const animalRaven: SfxRenderer = (env, _p, when) => {
  const v = oneShot(env, when, 1.4);
  const n = 2 + Math.floor(env.rnd() * 2);
  for (let k = 0; k < n; k++) {
    const t = when + k * between(env, 0.3, 0.4);
    const amp = gainNode(v.ctx, 0, v.gain);
    const bp = biquad(v.ctx, 'bandpass', 1300 * env.rate, 2.5, amp);
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    const f = between(env, 470, 560) * env.rate;
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 0.88, t + 0.24);
    o.connect(bp);
    o.start(t);
    o.stop(t + 0.3);
    v.track(o);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.5, t + 0.02);
    amp.gain.setTargetAtTime(0, t + 0.18, 0.03);
    lfo(v, amp.gain, 55, 0.25, t, t + 0.3, 'square');
  }
  v.sendWet(v.gain, 0.4);
  return v;
};

/** Hoof patterns: cycle length (s) and hit offsets within the cycle. */
export const GAITS = {
  walk: { cycle: 1.1, hits: [0, 0.275, 0.55, 0.825] },
  trot: { cycle: 0.66, hits: [0, 0.015, 0.33, 0.345] },
  gallop: { cycle: 0.5, hits: [0, 0.08, 0.16] },
} as const;

const animalHoofbeats: SfxRenderer = (env, p, when) => {
  const gait = GAITS[str(p, 'pace', 'trot') as keyof typeof GAITS] ?? GAITS.trot;
  const v = looped(env, when);
  const horse = (offset: number, level: number) =>
    everyEvent(when + offset, () => gait.cycle * between(env, 0.97, 1.03), env, (t) => {
      for (const h of gait.hits) {
        const at = t + h + (env.rnd() - 0.5) * 0.01;
        thump(v, v.gain, at, 85, 55, 0.07, level * between(env, 0.7, 1));
        burst(v, v.gain, at, { colour: 'pink', type: 'lowpass', freq: 720, dur: 0.05, peak: level * 0.6 });
      }
    });
  v.setStream(combine(horse(0.02, 0.7), horse(0.02 + gait.cycle * 0.37, 0.4)));
  return v;
};

/** Every SFX id's placeholder renderer. */
export const SFX_SYNTHS: Readonly<Record<SfxId, SfxRenderer>> = {
  'ui.click': uiClick,
  'ui.coin': uiCoin,
  'ui.parchment': uiParchment,
  'ui.confirm': uiConfirm,
  'ui.deny': uiDeny,
  'sea.waves': seaWaves,
  'sea.oars': seaOars,
  'sea.sailFlap': seaSailFlap,
  'sea.hullCreak': seaHullCreak,
  'sea.splash': seaSplash,
  'weather.rain': weatherRain,
  'weather.wind': weatherWind,
  'weather.thunder': weatherThunder,
  'battle.clash': battleClash,
  'battle.shieldBash': battleShieldBash,
  'battle.arrowVolley': battleArrowVolley,
  'battle.fire': battleFire,
  'battle.seaFire': battleSeaFire,
  'battle.warHorn': battleWarHorn,
  'battle.crowdRoar': battleCrowdRoar,
  'battle.warCry': battleWarCry,
  'duel.impact': duelImpact,
  'duel.grunt': duelGrunt,
  'town.market': townMarket,
  'town.smithy': townSmithy,
  'town.hallChatter': townHallChatter,
  'town.gulls': townGulls,
  'town.churchBell': townChurchBell,
  'animal.wolfHowl': animalWolfHowl,
  'animal.raven': animalRaven,
  'animal.hoofbeats': animalHoofbeats,
};
