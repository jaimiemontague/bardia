/**
 * The deterministic generative composer behind the placeholder score. `composeBar(style, seed, bar,
 * intensity)` returns the notes of one bar; it is a pure function of its arguments (random access:
 * bar N never depends on having generated bars 0..N−1), so the same seed always yields the same
 * note sequence (tested) and the engine can jump into any phrase.
 *
 * Structure: phrases of `phraseBars` bars; each phrase draws a modal progression and a melodic
 * motif from a phrase RNG (`<seed>|<state>|p<phrase>`); per-bar details (velocities, fills, rests)
 * come from a bar RNG (`<seed>|<state>|b<bar>`). Melodies follow an A A′ A cadence plan with chord
 * tones on strong pulses; drums pick a groove per phrase, a busier one at high intensity and add
 * fills at phrase ends.
 */
import { Rng } from '@sim/core/rng';
import { degreeToMidi, nearestChordTone, PROGRESSIONS, tonicMidi } from './theory';
import {
  barPulses,
  type ArpLayer,
  type CallLayer,
  type DrumHit,
  type DrumLayer,
  type InstrumentId,
  type LayerSpec,
  type MelodyLayer,
  type MusicStyle,
  type PadLayer,
  type PatternLayer,
  type DroneLayer,
} from './styles';

/** One scheduled note (times in integer pulses relative to the bar start). */
export interface NoteEvent {
  /** Layer id within the style. */
  readonly layer: string;
  readonly instrument: InstrumentId | 'drums';
  /** Start pulse within the bar. */
  readonly at: number;
  /** Length in pulses (≥ 1; may run past the bar end for sustained notes). */
  readonly len: number;
  /** MIDI note (0 for drums). */
  readonly midi: number;
  /** Velocity 0..1 (two decimals). */
  readonly vel: number;
  /** Drum sample (drums only). */
  readonly hit?: DrumHit;
  /** Timing humanisation in whole milliseconds. */
  readonly nudge: number;
}

/** Harmonic context of a bar. */
export interface BarContext {
  readonly bar: number;
  readonly phrase: number;
  readonly barInPhrase: number;
  /** Chord root (scale degree 0..6). */
  readonly chord: number;
  /** Index of the progression chosen for the phrase. */
  readonly progression: number;
}

const r2 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

function phraseRng(seed: string, style: MusicStyle, phrase: number, salt = ''): Rng {
  return new Rng(`${seed}|${style.id}|p${phrase}${salt}`);
}

function barRng(seed: string, style: MusicStyle, bar: number, salt: string): Rng {
  return new Rng(`${seed}|${style.id}|b${bar}|${salt}`);
}

function progressionsOf(style: MusicStyle): readonly (readonly number[])[] {
  return style.progressions ?? PROGRESSIONS[style.mode];
}

/** The harmonic context of a bar (pure). */
export function barContext(style: MusicStyle, seed: string, bar: number): BarContext {
  const b = Math.max(0, Math.floor(bar));
  const phrase = Math.floor(b / style.phraseBars);
  const barInPhrase = b - phrase * style.phraseBars;
  const progs = progressionsOf(style);
  const progression = progs.length > 1 ? phraseRng(seed, style, phrase, ':prog').int(0, progs.length - 1) : 0;
  const prog = progs[progression] ?? [0];
  const slot = Math.floor(barInPhrase / Math.max(1, style.chordBars)) % prog.length;
  return { bar: b, phrase, barInPhrase, chord: prog[slot] ?? 0, progression };
}

/** Reference MIDI of degree 0 for a layer octave. */
function layerTonic(style: MusicStyle, octave: number): number {
  return tonicMidi(style.tonic, style.octave + octave);
}

function midiOf(style: MusicStyle, octave: number, degree: number): number {
  return degreeToMidi(style.mode, layerTonic(style, octave), degree);
}

/** Chord root voiced close to the tonic (roots above the 4th drop an octave). */
function voicedRoot(chord: number): number {
  return chord >= 4 ? chord - 7 : chord;
}

function playsPhrase(filter: 'all' | 'even' | 'odd', phrase: number): boolean {
  return filter === 'all' || (filter === 'even' ? phrase % 2 === 0 : phrase % 2 === 1);
}

/**
 * The notes of one bar. `intensity` (0..1) selects busier drum grooves and denser fills; layer
 * gains by intensity are applied by the engine (`layerIntensityGain`).
 */
export function composeBar(style: MusicStyle, seed: string, bar: number, intensity = 0.5): NoteEvent[] {
  const ctx = barContext(style, seed, bar);
  const out: NoteEvent[] = [];
  for (const layer of style.layers) composeLayer(style, seed, ctx, layer, intensity, out);
  out.sort((a, b) => a.at - b.at || (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : a.midi - b.midi));
  return out;
}

function composeLayer(style: MusicStyle, seed: string, ctx: BarContext, layer: LayerSpec, intensity: number, out: NoteEvent[]): void {
  switch (layer.kind) {
    case 'drone':
      return drone(style, ctx, layer, out);
    case 'pad':
      return pad(style, seed, ctx, layer, out);
    case 'arp':
      return arp(style, seed, ctx, layer, out);
    case 'melody':
      return melody(style, seed, ctx, layer, out);
    case 'pattern':
      return pattern(style, seed, ctx, layer, out);
    case 'call':
      return hornCall(style, ctx, layer, out);
    case 'drums':
      return drums(style, seed, ctx, layer, intensity, out);
  }
}

function drone(style: MusicStyle, ctx: BarContext, layer: DroneLayer, out: NoteEvent[]): void {
  if (ctx.barInPhrase !== 0) return;
  const len = style.phraseBars * barPulses(style) + style.sub; // overlap into the next phrase
  out.push({ layer: layer.id, instrument: 'drone', at: 0, len, midi: midiOf(style, layer.octave, 0), vel: 0.7, nudge: 0 });
  if (layer.fifth) out.push({ layer: layer.id, instrument: 'drone', at: 0, len, midi: midiOf(style, layer.octave, 4), vel: 0.5, nudge: 0 });
}

function pad(style: MusicStyle, seed: string, ctx: BarContext, layer: PadLayer, out: NoteEvent[]): void {
  const span = Math.max(1, layer.span);
  if (ctx.barInPhrase % span !== 0) return;
  const rng = barRng(seed, style, ctx.bar, layer.id);
  const root = voicedRoot(ctx.chord);
  const len = span * barPulses(style);
  // Open voicing: root, fifth, tenth (third an octave up) — a fuller bowed/sung sound than a close triad.
  for (const d of [root, root + 4, root + 9]) {
    out.push({ layer: layer.id, instrument: layer.instrument, at: 0, len, midi: midiOf(style, layer.octave, d), vel: r2(0.5 + rng.range(0, 0.1)), nudge: 0 });
  }
}

const ARP_SEQ: Readonly<Record<ArpLayer['pattern'], readonly number[]>> = {
  up: [0, 1, 2, 3],
  updown: [0, 1, 2, 3, 4, 3, 2, 1],
  pendulum: [0, 2, 1, 3, 1, 2],
  broken: [],
};

function arp(style: MusicStyle, seed: string, ctx: BarContext, layer: ArpLayer, out: NoteEvent[]): void {
  const rng = barRng(seed, style, ctx.bar, layer.id);
  const root = voicedRoot(ctx.chord);
  const tones = [root, root + 2, root + 4, root + 7, root + 9];
  const seq = ARP_SEQ[layer.pattern];
  const step = Math.max(1, layer.every);
  const pulses = barPulses(style);
  let i = 0;
  for (let at = 0; at < pulses; at += step, i++) {
    if (at !== 0 && !rng.chance(layer.density)) continue;
    const idx = layer.pattern === 'broken' ? rng.int(0, tones.length - 1) : (seq[i % seq.length] as number);
    const accent = at % style.sub === 0 ? 0.12 : 0;
    out.push({
      layer: layer.id,
      instrument: layer.instrument,
      at,
      len: step * 3,
      midi: midiOf(style, layer.octave, tones[idx] as number),
      vel: r2(0.55 + accent + rng.range(-0.06, 0.06)),
      nudge: at === 0 ? 0 : rng.int(-6, 6),
    });
  }
}

/** Rhythm vocabulary per pulses-per-beat: each cell fills one beat (lengths in pulses). */
const BEAT_CELLS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [[2], [1, 1]],
  3: [[3], [2, 1], [1, 1, 1], [1, 2]],
  4: [[4], [2, 2], [2, 1, 1], [1, 1, 2], [3, 1]],
};

/** A one-bar rhythm (lengths in pulses summing to the bar), biased short by `density`. */
function barRhythm(style: MusicStyle, rng: Rng, density: number): number[] {
  const cells = BEAT_CELLS[style.sub] ?? [[style.sub]];
  const out: number[] = [];
  let b = 0;
  while (b < style.beats) {
    // Occasionally tie two beats into one long note (fewer at high density).
    if (b + 1 < style.beats && rng.chance(0.35 * (1 - density))) {
      out.push(style.sub * 2);
      b += 2;
      continue;
    }
    const short = cells.length > 1 && rng.chance(density);
    const pick = (short ? cells[1 + rng.int(0, cells.length - 2)] : cells[0]) ?? [style.sub];
    out.push(...pick);
    b += 1;
  }
  return out;
}

function clampDeg(d: number, range: readonly [number, number]): number {
  return Math.min(range[1], Math.max(range[0], d));
}

function melody(style: MusicStyle, seed: string, ctx: BarContext, layer: MelodyLayer, out: NoteEvent[]): void {
  if (!playsPhrase(layer.phrases, ctx.phrase)) return;
  if (layer.theme && style.theme) return theme(style, seed, ctx, layer, out);
  const pulses = barPulses(style);
  const last = ctx.barInPhrase === style.phraseBars - 1;
  const prng = phraseRng(seed, style, ctx.phrase, `:${layer.id}`);
  // Phrase motif: rhythm A, its variation A′, and a contour of steps reused across the phrase.
  const rhythmA = barRhythm(style, prng, layer.density);
  const rhythmB = barRhythm(style, prng, layer.density);
  const contour = Array.from({ length: 12 }, () => prng.pick([-2, -1, -1, 1, 1, 2, 0]));
  const startDeg = clampDeg(prng.pick([0, 2, 4, 7]), layer.range);
  const rng = barRng(seed, style, ctx.bar, layer.id);

  if (last) {
    // Cadence: a short pickup and a long chord tone landing on the tonic at the phrase end.
    const target = clampDeg(nearestChordTone(startDeg, 0), layer.range);
    const pickup = Math.max(1, Math.floor(pulses / 4));
    const approach = clampDeg(target + (rng.chance(0.5) ? 1 : 2), layer.range);
    out.push({ layer: layer.id, instrument: layer.instrument, at: 0, len: pickup, midi: midiOf(style, layer.octave, approach), vel: r2(0.6 + rng.range(-0.05, 0.05)), nudge: 0 });
    out.push({ layer: layer.id, instrument: layer.instrument, at: pickup, len: pulses - pickup, midi: midiOf(style, layer.octave, target), vel: r2(0.66 + rng.range(-0.05, 0.05)), nudge: 0 });
    return;
  }

  const rhythm = ctx.barInPhrase % 2 === 0 ? rhythmA : rhythmB;
  let deg = clampDeg(nearestChordTone(startDeg + (ctx.barInPhrase % 2 === 0 ? 0 : contour[0]!), ctx.chord), layer.range);
  let at = 0;
  rhythm.forEach((len, i) => {
    const strong = at % style.sub === 0 && (at / style.sub) % 2 === 0;
    if (i > 0) {
      deg += contour[(i + ctx.barInPhrase) % contour.length]!;
      if (deg > layer.range[1]) deg -= 2;
      if (deg < layer.range[0]) deg += 2;
      if (strong) deg = nearestChordTone(deg, ctx.chord);
      deg = clampDeg(deg, layer.range);
    }
    const rest = i > 0 && rng.chance(layer.rest);
    if (!rest) {
      out.push({
        layer: layer.id,
        instrument: layer.instrument,
        at,
        len,
        midi: midiOf(style, layer.octave, deg),
        vel: r2((strong ? 0.66 : 0.56) + rng.range(-0.06, 0.06)),
        nudge: at === 0 ? 0 : rng.int(-8, 8),
      });
    }
    at += len;
  });
}

function theme(style: MusicStyle, seed: string, ctx: BarContext, layer: MelodyLayer, out: NoteEvent[]): void {
  const notes = style.theme ?? [];
  const pulses = barPulses(style);
  const lo = ctx.barInPhrase * pulses;
  const hi = lo + pulses;
  const rng = barRng(seed, style, ctx.bar, layer.id);
  // From the second statement on, ornament some long notes with an upper neighbour.
  const ornament = ctx.phrase >= 2;
  for (const n of notes) {
    if (n.at < lo || n.at >= hi) continue;
    const at = n.at - lo;
    const vel = r2(0.66 + (at === 0 ? 0.06 : 0) + rng.range(-0.04, 0.04));
    if (ornament && n.len >= 4 && rng.chance(0.5)) {
      const half = Math.floor(n.len / 2);
      out.push({ layer: layer.id, instrument: layer.instrument, at, len: half, midi: midiOf(style, layer.octave, n.d), vel, nudge: 0 });
      out.push({ layer: layer.id, instrument: layer.instrument, at: at + half, len: n.len - half, midi: midiOf(style, layer.octave, n.d + 1), vel: r2(vel - 0.08), nudge: 0 });
    } else {
      out.push({ layer: layer.id, instrument: layer.instrument, at, len: n.len, midi: midiOf(style, layer.octave, n.d), vel, nudge: 0 });
    }
  }
}

/** Pattern cell → scale degrees above the reference ('l' is the fifth below). */
export const CELL_DEGREES: Readonly<Record<string, number>> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, l: -3 };

function pattern(style: MusicStyle, seed: string, ctx: BarContext, layer: PatternLayer, out: NoteEvent[]): void {
  const cells = layer.cells.length > 0 ? layer.cells : '1';
  const pulses = barPulses(style);
  const ref = layer.follow === 'chord' ? voicedRoot(ctx.chord) : 0;
  const rng = barRng(seed, style, ctx.bar, layer.id);
  let open: { at: number; len: number; deg: number; vel: number } | undefined;
  const flush = () => {
    if (!open) return;
    out.push({ layer: layer.id, instrument: layer.instrument, at: open.at, len: open.len, midi: midiOf(style, layer.octave, open.deg), vel: open.vel, nudge: 0 });
    open = undefined;
  };
  for (let at = 0; at < pulses; at++) {
    const c = cells[at % cells.length] as string;
    if (c === '-') {
      if (open) open.len += 1;
      continue;
    }
    flush();
    const d = CELL_DEGREES[c];
    if (d === undefined) continue; // '.' or unknown: rest
    const accent = at % style.sub === 0 ? 0.1 : 0;
    open = { at, len: 1, deg: ref + d, vel: r2(0.52 + accent + rng.range(-0.05, 0.05)) };
  }
  flush();
}

function hornCall(style: MusicStyle, ctx: BarContext, layer: CallLayer, out: NoteEvent[]): void {
  if (ctx.phrase % Math.max(1, layer.everyPhrases) !== 0) return;
  const pulses = barPulses(style);
  const lo = ctx.barInPhrase * pulses;
  const hi = lo + pulses;
  for (const n of layer.figure) {
    if (n.at < lo || n.at >= hi) continue;
    out.push({ layer: layer.id, instrument: layer.instrument, at: n.at - lo, len: n.len, midi: midiOf(style, layer.octave, n.d), vel: n.at === 0 ? 0.78 : 0.7, nudge: 0 });
  }
}

/** Drum pattern characters: hit and velocity ('.' is a rest). */
export const DRUM_CHARS: Readonly<Record<string, readonly [DrumHit, number]>> = {
  B: ['boom', 1],
  b: ['boom', 0.6],
  W: ['war', 1],
  w: ['war', 0.65],
  S: ['slap', 0.9],
  s: ['slap', 0.55],
  T: ['tap', 0.7],
  t: ['tap', 0.42],
  K: ['shaker', 0.7],
  k: ['shaker', 0.45],
  C: ['clap', 0.8],
  c: ['clap', 0.5],
};

/** Intensity at or above which a drum layer switches to its busy grooves. */
export const BUSY_INTENSITY = 0.66;

function drums(style: MusicStyle, seed: string, ctx: BarContext, layer: DrumLayer, intensity: number, out: NoteEvent[]): void {
  const pulses = barPulses(style);
  const pool = intensity >= BUSY_INTENSITY && layer.busy && layer.busy.length > 0 ? layer.busy : layer.patterns;
  if (pool.length === 0) return;
  const choice = pool.length > 1 ? phraseRng(seed, style, ctx.phrase, `:${layer.id}:groove`).int(0, pool.length - 1) : 0;
  const groove = pool[choice] as string;
  const rng = barRng(seed, style, ctx.bar, layer.id);
  const fill = layer.fills && ctx.barInPhrase === style.phraseBars - 1;
  const fillFrom = Math.floor(pulses / 2);
  const fillP = 0.35 + 0.4 * Math.min(1, Math.max(0, intensity));
  for (let at = 0; at < pulses; at++) {
    const c = groove.length > 0 ? (groove[at % groove.length] as string) : '.';
    let spec = DRUM_CHARS[c];
    if (!spec && fill && at >= fillFrom && rng.chance(fillP)) {
      // Fills crescendo toward the bar line, alternating slap and tap.
      const t = (at - fillFrom) / Math.max(1, pulses - fillFrom);
      spec = [at % 2 === 0 ? 'slap' : 'tap', 0.45 + 0.4 * t];
    }
    if (!spec) continue;
    out.push({
      layer: layer.id,
      instrument: 'drums',
      at,
      len: 1,
      midi: 0,
      vel: r2(spec[1] + rng.range(-0.06, 0.06)),
      hit: spec[0],
      nudge: at === 0 ? 0 : rng.int(-5, 5),
    });
  }
}

/** Notes of `bars` consecutive bars starting at `fromBar`, with absolute pulse times (tests, tools). */
export function composeSpan(style: MusicStyle, seed: string, fromBar: number, bars: number, intensity = 0.5): (NoteEvent & { bar: number; abs: number })[] {
  const pulses = barPulses(style);
  const out: (NoteEvent & { bar: number; abs: number })[] = [];
  for (let b = fromBar; b < fromBar + bars; b++) {
    for (const n of composeBar(style, seed, b, intensity)) out.push({ ...n, bar: b, abs: b * pulses + n.at });
  }
  return out;
}
