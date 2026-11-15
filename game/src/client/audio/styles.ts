/**
 * Style sheets for the procedural placeholder score: one per music state (§28.1). A style fixes the
 * mode, tonic, tempo, meter, phrase structure and the instrument layers (§28.1 palette: lyre, frame
 * drums, bone flute, horns, bowed strings, voices). The composer turns a style + seed into notes.
 *
 * Layers carry an intensity window (`from`..`full`) and, for the battle tracks, the stem they belong
 * to, so the same data drives the placeholder's adaptive mix and documents the final stems' split.
 */
import type { MusicState, StemLevel } from './catalog';
import type { ModeId, PitchName } from './theory';

/** Melodic and harmonic instruments of the placeholder synth. */
export type InstrumentId = 'lyre' | 'harp' | 'oud' | 'strings' | 'fiddle' | 'flute' | 'horn' | 'drone' | 'choir' | 'hum';
/** Frame-drum family hits (pre-rendered samples). */
export type DrumHit = 'boom' | 'war' | 'slap' | 'tap' | 'shaker' | 'clap';

/** One note of a fixed figure (theme or horn call): scale degree, start pulse, length in pulses. */
export interface FigureNote {
  readonly d: number;
  readonly at: number;
  readonly len: number;
}

interface LayerBase {
  /** Unique within the style (names the layer's gain node). */
  readonly id: string;
  /** Mix level 0..1. */
  readonly gain: number;
  /** Intensity at which the layer starts to fade in (default 0: always on). */
  readonly from?: number;
  /** Intensity at which the layer reaches full gain (default `from`). */
  readonly full?: number;
  /** Final-file stem this layer belongs to (battle tracks). */
  readonly stem?: StemLevel;
}

/** Pedal tone (tonic, optionally with the fifth) re-struck every phrase. */
export interface DroneLayer extends LayerBase {
  readonly kind: 'drone';
  readonly instrument: 'drone';
  readonly octave: number;
  readonly fifth: boolean;
}
/** Sustained chord tones following the progression. */
export interface PadLayer extends LayerBase {
  readonly kind: 'pad';
  readonly instrument: 'strings' | 'choir';
  readonly octave: number;
  /** Re-voice every `span` bars (1, 2 or 4). */
  readonly span: number;
}
/** Plucked chord arpeggios. */
export interface ArpLayer extends LayerBase {
  readonly kind: 'arp';
  readonly instrument: 'lyre' | 'harp' | 'oud';
  readonly octave: number;
  readonly pattern: 'up' | 'updown' | 'pendulum' | 'broken';
  /** Pulses per note. */
  readonly every: number;
  /** Probability that a non-downbeat note sounds. */
  readonly density: number;
}
/** A generated melodic line (or the style's theme on selected phrases). */
export interface MelodyLayer extends LayerBase {
  readonly kind: 'melody';
  readonly instrument: InstrumentId;
  readonly octave: number;
  /** Allowed scale-degree range relative to the layer octave's tonic. */
  readonly range: readonly [number, number];
  /** 0..1: preference for short notes. */
  readonly density: number;
  /** Probability that a (non-cadence) note becomes a rest. */
  readonly rest: number;
  /** Which phrases the layer plays. */
  readonly phrases: 'all' | 'even' | 'odd';
  /** Play the style's theme instead of a generated line. */
  readonly theme?: boolean;
}
/** A repeating per-bar figure (ostinato or bass) written as cells; see composer `CELL_DEGREES`. */
export interface PatternLayer extends LayerBase {
  readonly kind: 'pattern';
  readonly instrument: InstrumentId;
  readonly octave: number;
  /** One character per pulse (repeated to fill the bar). */
  readonly cells: string;
  /** Degrees relative to the current chord root, or to the tonic. */
  readonly follow: 'chord' | 'tonic';
}
/** A fixed horn call (or fanfare) at the start of every `everyPhrases`-th phrase. */
export interface CallLayer extends LayerBase {
  readonly kind: 'call';
  readonly instrument: 'horn' | 'flute' | 'choir';
  readonly octave: number;
  readonly figure: readonly FigureNote[];
  readonly everyPhrases: number;
}
/** Frame drums: one pattern per bar (chosen per phrase), busier patterns at high intensity, fills. */
export interface DrumLayer extends LayerBase {
  readonly kind: 'drums';
  /** One character per pulse; see composer `DRUM_CHARS`. */
  readonly patterns: readonly string[];
  readonly busy?: readonly string[];
  /** Fill the second half of each phrase's last bar. */
  readonly fills: boolean;
}

export type LayerSpec = DroneLayer | PadLayer | ArpLayer | MelodyLayer | PatternLayer | CallLayer | DrumLayer;

export interface MusicStyle {
  readonly id: MusicState;
  readonly mode: ModeId;
  readonly tonic: PitchName;
  /** Octave of the reference tonic (layer octaves are relative to it). */
  readonly octave: number;
  /** Beats per minute (the beat is a quarter, or a dotted quarter when `sub` is 3). */
  readonly bpm: number;
  readonly beats: number;
  /** Pulses per beat (2 = eighths, 3 = compound triplets, 4 = sixteenths). */
  readonly sub: number;
  readonly phraseBars: number;
  readonly chordBars: number;
  /** Override of the mode's progression list. */
  readonly progressions?: readonly (readonly number[])[];
  /** Fixed theme (scale degrees from the layer octave's tonic), spanning one phrase. */
  readonly theme?: readonly FigureNote[];
  /** Reverb send 0..1 (hall, church, cave). */
  readonly reverb: number;
  /** Crossfade time into this state (s). */
  readonly crossfadeS: number;
  /** Overall level 0..1. */
  readonly gain: number;
  readonly layers: readonly LayerSpec[];
}

/** Pulses per bar. */
export function barPulses(style: MusicStyle): number {
  return style.beats * style.sub;
}

/** Seconds per pulse. */
export function pulseSeconds(style: MusicStyle): number {
  return 60 / style.bpm / style.sub;
}

/** Seconds per bar. */
export function barSeconds(style: MusicStyle): number {
  return barPulses(style) * pulseSeconds(style);
}

/** Gain multiplier of a layer at an intensity (smoothstep between `from` and `full`). */
export function layerIntensityGain(layer: LayerSpec, intensity: number): number {
  const from = layer.from ?? 0;
  const full = layer.full ?? from;
  if (intensity >= full) return 1;
  if (intensity < from) return 0;
  const t = (intensity - from) / Math.max(1e-6, full - from);
  return t * t * (3 - 2 * t);
}

/** The main theme (D dorian on the horn; reused in mixolydian for the coronation). 4 bars of 8 pulses. */
export const MAIN_THEME: readonly FigureNote[] = [
  { d: 0, at: 0, len: 3 },
  { d: 1, at: 3, len: 1 },
  { d: 2, at: 4, len: 2 },
  { d: 4, at: 6, len: 2 },
  { d: 3, at: 8, len: 4 },
  { d: 2, at: 12, len: 2 },
  { d: 1, at: 14, len: 2 },
  { d: 0, at: 16, len: 2 },
  { d: 2, at: 18, len: 2 },
  { d: 4, at: 20, len: 2 },
  { d: 6, at: 22, len: 2 },
  { d: 4, at: 24, len: 2 },
  { d: 2, at: 26, len: 2 },
  { d: 0, at: 28, len: 4 },
];

const call = (...notes: [number, number, number][]): FigureNote[] => notes.map(([d, at, len]) => ({ d, at, len }));

/** The styles of the §28.1 states; the owner's further tracks borrow one of these below. */
const CORE_STYLES = {
  mainTheme: {
    id: 'mainTheme', mode: 'dorian', tonic: 'D', octave: 3, bpm: 72, beats: 4, sub: 2, phraseBars: 4, chordBars: 1,
    progressions: [[0, 6, 3, 0], [0, 3, 6, 0]], theme: MAIN_THEME, reverb: 0.45, crossfadeS: 4, gain: 0.9,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.32 },
      { id: 'pad', kind: 'pad', instrument: 'strings', octave: 0, span: 1, gain: 0.28 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 0, pattern: 'pendulum', every: 1, density: 0.85, gain: 0.42 },
      { id: 'horn', kind: 'melody', instrument: 'horn', octave: 1, range: [0, 9], density: 0.4, rest: 0.15, phrases: 'even', theme: true, gain: 0.42 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [2, 11], density: 0.5, rest: 0.2, phrases: 'odd', gain: 0.34 },
      { id: 'choir', kind: 'pad', instrument: 'choir', octave: 1, span: 2, gain: 0.14 },
      { id: 'drums', kind: 'drums', patterns: ['B...b.t.', 'B.t.b.tt'], fills: true, gain: 0.42 },
    ],
  },
  homeSkarn: {
    id: 'homeSkarn', mode: 'aeolian', tonic: 'E', octave: 3, bpm: 80, beats: 4, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.35, crossfadeS: 3, gain: 0.85,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.28 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 0, pattern: 'up', every: 1, density: 0.8, gain: 0.46 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [0, 10], density: 0.55, rest: 0.2, phrases: 'even', gain: 0.38 },
      { id: 'lead', kind: 'melody', instrument: 'lyre', octave: 1, range: [0, 9], density: 0.6, rest: 0.15, phrases: 'odd', gain: 0.4 },
      { id: 'hum', kind: 'pad', instrument: 'choir', octave: 0, span: 2, gain: 0.16 },
      { id: 'drums', kind: 'drums', patterns: ['B.t.b.t.', 'B.ttb.t.'], fills: true, gain: 0.38 },
    ],
  },
  homeHvarn: {
    id: 'homeHvarn', mode: 'dorian', tonic: 'A', octave: 2, bpm: 66, beats: 3, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.4, crossfadeS: 3, gain: 0.85,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: 0, fifth: true, gain: 0.28 },
      { id: 'pad', kind: 'pad', instrument: 'strings', octave: 1, span: 1, gain: 0.32 },
      { id: 'fiddle', kind: 'melody', instrument: 'fiddle', octave: 2, range: [0, 9], density: 0.45, rest: 0.15, phrases: 'all', gain: 0.42 },
      { id: 'harp', kind: 'arp', instrument: 'harp', octave: 1, pattern: 'updown', every: 1, density: 0.6, gain: 0.34 },
      { id: 'drums', kind: 'drums', patterns: ['B.t.t.', 'B.s.t.'], fills: false, gain: 0.28 },
    ],
  },
  homeEyjar: {
    id: 'homeEyjar', mode: 'mixolydian', tonic: 'G', octave: 3, bpm: 72, beats: 2, sub: 3, phraseBars: 4, chordBars: 1,
    reverb: 0.3, crossfadeS: 3, gain: 0.85,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: false, gain: 0.24 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 0, pattern: 'broken', every: 1, density: 0.75, gain: 0.44 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [0, 10], density: 0.6, rest: 0.15, phrases: 'all', gain: 0.4 },
      { id: 'hum', kind: 'pad', instrument: 'choir', octave: 0, span: 2, gain: 0.14 },
      { id: 'drums', kind: 'drums', patterns: ['B.tS.t', 'B.ts.t'], busy: ['BttSts'], fills: true, gain: 0.44 },
    ],
  },
  sailingCalm: {
    id: 'sailingCalm', mode: 'mixolydian', tonic: 'D', octave: 3, bpm: 54, beats: 2, sub: 3, phraseBars: 8, chordBars: 2,
    reverb: 0.5, crossfadeS: 5, gain: 0.8,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.3 },
      { id: 'pad', kind: 'pad', instrument: 'strings', octave: 0, span: 2, gain: 0.3 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 1, pattern: 'updown', every: 1, density: 0.55, gain: 0.34 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [2, 11], density: 0.35, rest: 0.3, phrases: 'even', gain: 0.32 },
      { id: 'choir', kind: 'pad', instrument: 'choir', octave: 1, span: 4, gain: 0.14 },
      { id: 'drums', kind: 'drums', patterns: ['B.....', 'B..t..'], fills: false, gain: 0.32 },
    ],
  },
  sailingStorm: {
    id: 'sailingStorm', mode: 'aeolian', tonic: 'C', octave: 3, bpm: 126, beats: 4, sub: 4, phraseBars: 4, chordBars: 1,
    reverb: 0.3, crossfadeS: 2.5, gain: 0.9,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.34 },
      { id: 'ostinato', kind: 'pattern', instrument: 'strings', octave: 0, cells: '1.1.1.1.1.1.8.5.', follow: 'chord', gain: 0.36 },
      { id: 'choir', kind: 'pad', instrument: 'choir', octave: 1, span: 1, gain: 0.18 },
      { id: 'horn', kind: 'call', instrument: 'horn', octave: 0, figure: call([0, 0, 8], [4, 8, 8], [7, 16, 16]), everyPhrases: 2, gain: 0.42 },
      { id: 'drums', kind: 'drums', patterns: ['W..tW.t.w..tWtS.'], busy: ['WttSWtTSWttSWTSS'], fills: true, gain: 0.52 },
    ],
  },
  albrennCael: {
    id: 'albrennCael', mode: 'dorian', tonic: 'G', octave: 3, bpm: 66, beats: 2, sub: 3, phraseBars: 8, chordBars: 2,
    reverb: 0.55, crossfadeS: 4, gain: 0.85,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.24 },
      { id: 'harp', kind: 'arp', instrument: 'harp', octave: 0, pattern: 'up', every: 1, density: 0.8, gain: 0.42 },
      { id: 'chant', kind: 'pad', instrument: 'choir', octave: 0, span: 2, gain: 0.28 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [0, 10], density: 0.5, rest: 0.2, phrases: 'odd', gain: 0.36 },
      { id: 'fiddle', kind: 'melody', instrument: 'fiddle', octave: 1, range: [0, 9], density: 0.4, rest: 0.2, phrases: 'even', gain: 0.32 },
      { id: 'drums', kind: 'drums', patterns: ['b..t..'], fills: false, gain: 0.22 },
    ],
  },
  corvaine: {
    id: 'corvaine', mode: 'mixolydian', tonic: 'A', octave: 3, bpm: 96, beats: 3, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.4, crossfadeS: 3, gain: 0.85,
    layers: [
      { id: 'bass', kind: 'pattern', instrument: 'lyre', octave: -1, cells: '1.5.8.', follow: 'chord', gain: 0.34 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 0, pattern: 'pendulum', every: 1, density: 0.7, gain: 0.36 },
      { id: 'fiddle', kind: 'melody', instrument: 'fiddle', octave: 1, range: [0, 9], density: 0.55, rest: 0.15, phrases: 'all', gain: 0.4 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 2, range: [0, 7], density: 0.5, rest: 0.25, phrases: 'odd', gain: 0.28 },
      { id: 'drums', kind: 'drums', patterns: ['B.k.k.'], busy: ['B.kSk.'], fills: true, gain: 0.34 },
    ],
  },
  velkarSaraleon: {
    id: 'velkarSaraleon', mode: 'phrygian', tonic: 'D', octave: 3, bpm: 92, beats: 4, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.45, crossfadeS: 3, gain: 0.85,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.34 },
      { id: 'oud', kind: 'arp', instrument: 'oud', octave: 0, pattern: 'broken', every: 1, density: 0.7, gain: 0.44 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [0, 9], density: 0.6, rest: 0.1, phrases: 'all', gain: 0.38 },
      { id: 'pad', kind: 'pad', instrument: 'strings', octave: 0, span: 2, gain: 0.2 },
      { id: 'drums', kind: 'drums', patterns: ['B..tS.t.', 'B.ttS.t.'], busy: ['BttSStSt'], fills: true, gain: 0.44 },
    ],
  },
  meadHallRowdy: {
    id: 'meadHallRowdy', mode: 'mixolydian', tonic: 'G', octave: 3, bpm: 112, beats: 2, sub: 3, phraseBars: 4, chordBars: 1,
    reverb: 0.3, crossfadeS: 2.5, gain: 0.85,
    layers: [
      { id: 'bass', kind: 'pattern', instrument: 'lyre', octave: -1, cells: '1..5..', follow: 'chord', gain: 0.34 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 0, pattern: 'up', every: 1, density: 0.95, gain: 0.38 },
      { id: 'fiddle', kind: 'melody', instrument: 'fiddle', octave: 1, range: [0, 10], density: 0.85, rest: 0.05, phrases: 'all', gain: 0.42 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 2, range: [0, 7], density: 0.75, rest: 0.1, phrases: 'odd', gain: 0.28 },
      { id: 'drums', kind: 'drums', patterns: ['B.tS.t', 'B.tC.t'], busy: ['BttStt'], fills: true, gain: 0.48 },
    ],
  },
  meadHallLament: {
    id: 'meadHallLament', mode: 'dorian', tonic: 'E', octave: 3, bpm: 58, beats: 3, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.38, crossfadeS: 3, gain: 0.8,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: false, gain: 0.18 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 0, pattern: 'up', every: 2, density: 0.9, gain: 0.44 },
      { id: 'voice', kind: 'melody', instrument: 'hum', octave: 1, range: [0, 8], density: 0.35, rest: 0.25, phrases: 'all', gain: 0.4 },
    ],
  },
  battleShieldwall: {
    id: 'battleShieldwall', mode: 'aeolian', tonic: 'D', octave: 2, bpm: 100, beats: 4, sub: 4, phraseBars: 4, chordBars: 1,
    reverb: 0.3, crossfadeS: 1.5, gain: 0.95,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: 1, fifth: true, gain: 0.34, stem: 'low' },
      { id: 'war', kind: 'drums', patterns: ['W.......w.......', 'W...w...W...w...'], fills: false, gain: 0.6, stem: 'low' },
      { id: 'ostinato', kind: 'pattern', instrument: 'strings', octave: 1, cells: '1.1.1.1.5.5.6.5.', follow: 'chord', gain: 0.38, from: 0.3, full: 0.5, stem: 'mid' },
      { id: 'slaps', kind: 'drums', patterns: ['....S.......S.t.', '....S...t...S.tt'], fills: true, gain: 0.42, from: 0.3, full: 0.5, stem: 'mid' },
      { id: 'choir', kind: 'pad', instrument: 'choir', octave: 2, span: 1, gain: 0.2, from: 0.35, full: 0.6, stem: 'mid' },
      { id: 'horn', kind: 'call', instrument: 'horn', octave: 1, figure: call([0, 0, 12], [4, 16, 8], [3, 24, 8], [0, 32, 24]), everyPhrases: 1, gain: 0.44, from: 0.62, full: 0.8, stem: 'high' },
      { id: 'drive', kind: 'drums', patterns: ['WttSWtTSWttSWTSS', 'WttSWttSWtTSWTTS'], fills: true, gain: 0.4, from: 0.66, full: 0.85, stem: 'high' },
      { id: 'lead', kind: 'melody', instrument: 'fiddle', octave: 2, range: [0, 9], density: 0.6, rest: 0.2, phrases: 'odd', gain: 0.3, from: 0.7, full: 0.9, stem: 'high' },
    ],
  },
  battleRaid: {
    id: 'battleRaid', mode: 'phrygian', tonic: 'E', octave: 2, bpm: 132, beats: 4, sub: 4, phraseBars: 4, chordBars: 1,
    reverb: 0.28, crossfadeS: 1.2, gain: 0.95,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: 1, fifth: true, gain: 0.32, stem: 'low' },
      { id: 'war', kind: 'drums', patterns: ['W..tW..tW..tWttt', 'W..tW..tW.ttW.t.'], fills: false, gain: 0.56, stem: 'low' },
      { id: 'ostinato', kind: 'pattern', instrument: 'strings', octave: 1, cells: '1.8.1.8.5.8.5.8.', follow: 'chord', gain: 0.36, from: 0.3, full: 0.5, stem: 'mid' },
      { id: 'pad', kind: 'pad', instrument: 'choir', octave: 2, span: 2, gain: 0.18, from: 0.35, full: 0.6, stem: 'mid' },
      { id: 'horn', kind: 'call', instrument: 'horn', octave: 1, figure: call([0, 0, 4], [2, 6, 4], [4, 12, 12]), everyPhrases: 1, gain: 0.44, from: 0.6, full: 0.8, stem: 'high' },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 2, range: [0, 9], density: 0.75, rest: 0.15, phrases: 'all', gain: 0.3, from: 0.68, full: 0.9, stem: 'high' },
      { id: 'drive', kind: 'drums', patterns: ['SttSSttSSttSSTTS'], busy: ['STTSSTTSSTTSSTSS'], fills: true, gain: 0.38, from: 0.66, full: 0.85, stem: 'high' },
    ],
  },
  duel: {
    id: 'duel', mode: 'phrygian', tonic: 'E', octave: 2, bpm: 112, beats: 4, sub: 2, phraseBars: 4, chordBars: 2,
    progressions: [[0, 1], [0, 0], [0, 6]], reverb: 0.3, crossfadeS: 1.5, gain: 0.9,
    layers: [
      { id: 'heart', kind: 'drums', patterns: ['B.b.....', 'B.b...t.'], busy: ['B.b.t.tt'], fills: true, gain: 0.5 },
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: 0, fifth: false, gain: 0.3 },
      { id: 'ostinato', kind: 'pattern', instrument: 'strings', octave: 1, cells: '1-.11-.2', follow: 'tonic', gain: 0.34 },
      { id: 'fiddle', kind: 'melody', instrument: 'fiddle', octave: 2, range: [0, 8], density: 0.3, rest: 0.4, phrases: 'all', gain: 0.28, from: 0.4, full: 0.7 },
    ],
  },
  delve: {
    id: 'delve', mode: 'aeolian', tonic: 'B', octave: 2, bpm: 52, beats: 4, sub: 2, phraseBars: 8, chordBars: 2,
    progressions: [[0, 5, 0, 1], [0, 1, 5, 0]], reverb: 0.7, crossfadeS: 5, gain: 0.8,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: 0, fifth: false, gain: 0.3 },
      { id: 'breath', kind: 'pad', instrument: 'choir', octave: 1, span: 2, gain: 0.18 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 2, range: [0, 8], density: 0.25, rest: 0.45, phrases: 'all', gain: 0.28 },
      { id: 'harp', kind: 'pattern', instrument: 'harp', octave: 1, cells: '1..5..3.', follow: 'chord', gain: 0.24 },
      { id: 'drums', kind: 'drums', patterns: ['b.......', '........'], fills: false, gain: 0.2 },
    ],
  },
  allthing: {
    id: 'allthing', mode: 'dorian', tonic: 'C', octave: 3, bpm: 76, beats: 4, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.35, crossfadeS: 3, gain: 0.85,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.24 },
      { id: 'pad', kind: 'pad', instrument: 'strings', octave: 0, span: 1, gain: 0.3 },
      { id: 'horn', kind: 'call', instrument: 'horn', octave: 0, figure: call([0, 0, 4], [4, 4, 4], [7, 8, 8]), everyPhrases: 2, gain: 0.42 },
      { id: 'lyre', kind: 'melody', instrument: 'lyre', octave: 1, range: [0, 9], density: 0.5, rest: 0.15, phrases: 'all', gain: 0.36 },
      { id: 'drums', kind: 'drums', patterns: ['B...B.t.', 'B..tB.t.'], fills: true, gain: 0.46 },
    ],
  },
  funeral: {
    id: 'funeral', mode: 'aeolian', tonic: 'D', octave: 3, bpm: 48, beats: 3, sub: 2, phraseBars: 4, chordBars: 1,
    reverb: 0.6, crossfadeS: 5, gain: 0.8,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.34 },
      { id: 'choir', kind: 'pad', instrument: 'choir', octave: 0, span: 1, gain: 0.32 },
      { id: 'horn', kind: 'melody', instrument: 'horn', octave: 0, range: [0, 7], density: 0.3, rest: 0.3, phrases: 'even', gain: 0.34 },
      { id: 'flute', kind: 'melody', instrument: 'flute', octave: 1, range: [0, 8], density: 0.3, rest: 0.3, phrases: 'odd', gain: 0.26 },
      { id: 'toll', kind: 'drums', patterns: ['B.....'], fills: false, gain: 0.34 },
    ],
  },
  coronation: {
    id: 'coronation', mode: 'mixolydian', tonic: 'D', octave: 3, bpm: 88, beats: 4, sub: 2, phraseBars: 4, chordBars: 1,
    progressions: [[0, 6, 3, 0], [0, 3, 6, 4]], theme: MAIN_THEME, reverb: 0.5, crossfadeS: 3, gain: 0.9,
    layers: [
      { id: 'drone', kind: 'drone', instrument: 'drone', octave: -1, fifth: true, gain: 0.24 },
      { id: 'fanfare', kind: 'call', instrument: 'horn', octave: 0, figure: call([0, 0, 2], [4, 2, 2], [7, 4, 4], [7, 8, 2], [8, 10, 2], [9, 12, 4]), everyPhrases: 2, gain: 0.44 },
      { id: 'theme', kind: 'melody', instrument: 'horn', octave: 1, range: [0, 9], density: 0.4, rest: 0.1, phrases: 'odd', theme: true, gain: 0.4 },
      { id: 'pad', kind: 'pad', instrument: 'strings', octave: 0, span: 1, gain: 0.3 },
      { id: 'choir', kind: 'pad', instrument: 'choir', octave: 1, span: 2, gain: 0.24 },
      { id: 'lyre', kind: 'arp', instrument: 'lyre', octave: 1, pattern: 'up', every: 1, density: 0.7, gain: 0.32 },
      { id: 'drums', kind: 'drums', patterns: ['B.tSB.tS', 'B.ttB.tS'], fills: true, gain: 0.48 },
    ],
  },
} satisfies Partial<Record<MusicState, MusicStyle>>;

/** A placeholder style for a further track: a core style under a new id, with optional tweaks. */
function like(base: MusicStyle, id: MusicState, patch: Partial<Omit<MusicStyle, 'id'>> = {}): MusicStyle {
  return { ...base, ...patch, id };
}

/** Every music state's style. */
export const MUSIC_STYLES: Readonly<Record<MusicState, MusicStyle>> = {
  ...CORE_STYLES,
  newSaga: like(CORE_STYLES.mainTheme, 'newSaga', { bpm: 66 }),
  worldMap: like(CORE_STYLES.albrennCael, 'worldMap'),
  greatHall: like(CORE_STYLES.homeSkarn, 'greatHall', { bpm: 76 }),
  longhouse: like(CORE_STYLES.homeEyjar, 'longhouse', { bpm: 66 }),
  smithy: like(CORE_STYLES.homeHvarn, 'smithy', { bpm: 72 }),
  shipyard: like(CORE_STYLES.homeEyjar, 'shipyard'),
  market: like(CORE_STYLES.velkarSaraleon, 'market'),
  meadHallWarm: like(CORE_STYLES.meadHallLament, 'meadHallWarm', { bpm: 72 }),
  // A sea battle is one full track (no intensity stems), so the raid score loses its stem tags.
  battleSea: like(CORE_STYLES.battleRaid, 'battleSea', { bpm: 120, layers: CORE_STYLES.battleRaid.layers.map((l) => ({ ...l, stem: undefined })) }),
  arrival: like(CORE_STYLES.mainTheme, 'arrival', { bpm: 66 }),
  expedition: like(CORE_STYLES.sailingCalm, 'expedition', { bpm: 60 }),
  victory: like(CORE_STYLES.coronation, 'victory'),
  chronicle: like(CORE_STYLES.mainTheme, 'chronicle', { bpm: 60 }),
  wedding: like(CORE_STYLES.homeEyjar, 'wedding', { bpm: 80 }),
  birth: like(CORE_STYLES.meadHallLament, 'birth', { bpm: 64 }),
  settlement: like(CORE_STYLES.homeSkarn, 'settlement', { bpm: 72 }),
  affairs: like(CORE_STYLES.allthing, 'affairs', { bpm: 70 }),
};
