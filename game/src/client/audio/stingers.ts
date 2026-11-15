/**
 * Stingers (§28.1 "stingers for omens, births and deaths"): short fixed cues laid over the current
 * music, which dips while they sound. Written as scale-degree figures so they sit in their own
 * mode; rendered by the same instruments as the score.
 */
import type { StingerId } from './catalog';
import type { DrumHit, InstrumentId } from './styles';
import { degreeToMidi, tonicMidi, type ModeId, type PitchName } from './theory';
import type { NoteEvent } from './composer';

interface StingerNote {
  readonly i: InstrumentId;
  /** Scale degree from the stinger tonic. */
  readonly d: number;
  readonly at: number;
  readonly len: number;
  readonly vel: number;
  /** Octave offset from the stinger octave. */
  readonly o?: number;
}

interface StingerHit {
  readonly hit: DrumHit;
  readonly at: number;
  readonly vel: number;
}

export interface StingerDef {
  readonly id: StingerId;
  readonly mode: ModeId;
  readonly tonic: PitchName;
  readonly octave: number;
  readonly bpm: number;
  /** Pulses per beat. */
  readonly sub: number;
  /** Reverb send 0..1. */
  readonly reverb: number;
  /** How far the music dips while the stinger sounds (dB). */
  readonly duckDb: number;
  readonly notes: readonly StingerNote[];
  readonly hits: readonly StingerHit[];
}

export const STINGER_DEFS: Readonly<Record<StingerId, StingerDef>> = {
  omen: {
    id: 'omen', mode: 'phrygian', tonic: 'E', octave: 3, bpm: 60, sub: 2, reverb: 0.75, duckDb: -10,
    notes: [
      { i: 'drone', d: 0, at: 0, len: 12, vel: 0.7, o: -1 },
      { i: 'choir', d: 0, at: 0, len: 10, vel: 0.5 },
      { i: 'choir', d: 1, at: 2, len: 8, vel: 0.42 },
      { i: 'flute', d: 7, at: 2, len: 3, vel: 0.6 },
      { i: 'flute', d: 8, at: 5, len: 5, vel: 0.62 },
    ],
    hits: [{ hit: 'boom', at: 0, vel: 0.8 }, { hit: 'boom', at: 8, vel: 0.5 }],
  },
  birth: {
    id: 'birth', mode: 'mixolydian', tonic: 'G', octave: 3, bpm: 96, sub: 2, reverb: 0.5, duckDb: -8,
    notes: [
      { i: 'harp', d: 0, at: 0, len: 6, vel: 0.62 },
      { i: 'harp', d: 2, at: 1, len: 6, vel: 0.6 },
      { i: 'harp', d: 4, at: 2, len: 6, vel: 0.62 },
      { i: 'harp', d: 7, at: 3, len: 6, vel: 0.64 },
      { i: 'harp', d: 9, at: 4, len: 6, vel: 0.62 },
      { i: 'harp', d: 11, at: 5, len: 8, vel: 0.66 },
      { i: 'flute', d: 9, at: 6, len: 3, vel: 0.55, o: 1 },
      { i: 'flute', d: 7, at: 9, len: 6, vel: 0.6, o: 1 },
      { i: 'strings', d: 0, at: 4, len: 12, vel: 0.45 },
      { i: 'strings', d: 4, at: 4, len: 12, vel: 0.4 },
    ],
    hits: [{ hit: 'shaker', at: 6, vel: 0.4 }],
  },
  death: {
    id: 'death', mode: 'aeolian', tonic: 'D', octave: 2, bpm: 52, sub: 2, reverb: 0.65, duckDb: -12,
    notes: [
      { i: 'horn', d: 0, at: 0, len: 4, vel: 0.65, o: 1 },
      { i: 'horn', d: 4, at: 4, len: 2, vel: 0.62, o: 1 },
      { i: 'horn', d: 3, at: 6, len: 2, vel: 0.6, o: 1 },
      { i: 'horn', d: 0, at: 8, len: 8, vel: 0.58, o: 1 },
      { i: 'choir', d: 0, at: 0, len: 16, vel: 0.45, o: 1 },
      { i: 'choir', d: 2, at: 0, len: 16, vel: 0.38, o: 1 },
      { i: 'drone', d: 0, at: 0, len: 16, vel: 0.6 },
    ],
    hits: [{ hit: 'boom', at: 0, vel: 0.9 }, { hit: 'boom', at: 4, vel: 0.7 }, { hit: 'boom', at: 8, vel: 0.55 }],
  },
  victory: {
    id: 'victory', mode: 'mixolydian', tonic: 'D', octave: 3, bpm: 104, sub: 2, reverb: 0.45, duckDb: -10,
    notes: [
      { i: 'horn', d: 0, at: 0, len: 2, vel: 0.72 },
      { i: 'horn', d: 4, at: 2, len: 2, vel: 0.72 },
      { i: 'horn', d: 7, at: 4, len: 4, vel: 0.78 },
      { i: 'horn', d: 6, at: 8, len: 1, vel: 0.66 },
      { i: 'horn', d: 7, at: 9, len: 7, vel: 0.8 },
      { i: 'strings', d: 0, at: 4, len: 12, vel: 0.5 },
      { i: 'strings', d: 4, at: 4, len: 12, vel: 0.45 },
      { i: 'choir', d: 7, at: 8, len: 8, vel: 0.4 },
    ],
    hits: [{ hit: 'boom', at: 0, vel: 0.9 }, { hit: 'slap', at: 2, vel: 0.7 }, { hit: 'boom', at: 4, vel: 0.9 }, { hit: 'boom', at: 9, vel: 1 }],
  },
  defeat: {
    id: 'defeat', mode: 'aeolian', tonic: 'A', octave: 2, bpm: 56, sub: 2, reverb: 0.6, duckDb: -12,
    notes: [
      { i: 'strings', d: 4, at: 0, len: 3, vel: 0.55, o: 1 },
      { i: 'strings', d: 3, at: 3, len: 3, vel: 0.52, o: 1 },
      { i: 'strings', d: 2, at: 6, len: 3, vel: 0.5, o: 1 },
      { i: 'strings', d: 0, at: 9, len: 7, vel: 0.5, o: 1 },
      { i: 'drone', d: 0, at: 0, len: 16, vel: 0.55 },
      { i: 'horn', d: 0, at: 9, len: 7, vel: 0.5, o: 1 },
    ],
    hits: [{ hit: 'war', at: 0, vel: 0.8 }, { hit: 'boom', at: 9, vel: 0.6 }],
  },
  relicFound: {
    id: 'relicFound', mode: 'dorian', tonic: 'E', octave: 3, bpm: 80, sub: 2, reverb: 0.7, duckDb: -8,
    notes: [
      { i: 'harp', d: 0, at: 0, len: 8, vel: 0.55 },
      { i: 'harp', d: 4, at: 1, len: 8, vel: 0.52 },
      { i: 'harp', d: 7, at: 2, len: 8, vel: 0.55 },
      { i: 'harp', d: 9, at: 3, len: 8, vel: 0.52 },
      { i: 'harp', d: 11, at: 4, len: 8, vel: 0.55 },
      { i: 'harp', d: 14, at: 5, len: 10, vel: 0.58 },
      { i: 'choir', d: 0, at: 2, len: 12, vel: 0.42, o: 1 },
      { i: 'choir', d: 4, at: 2, len: 12, vel: 0.36, o: 1 },
      { i: 'flute', d: 11, at: 8, len: 6, vel: 0.5, o: 1 },
    ],
    hits: [{ hit: 'shaker', at: 0, vel: 0.35 }, { hit: 'boom', at: 0, vel: 0.5 }],
  },
};

/** Seconds per pulse of a stinger. */
export function stingerPulseSeconds(def: StingerDef): number {
  return 60 / def.bpm / def.sub;
}

/** Total length of a stinger in seconds (last note end). */
export function stingerSeconds(def: StingerDef): number {
  let end = 0;
  for (const n of def.notes) end = Math.max(end, n.at + n.len);
  for (const h of def.hits) end = Math.max(end, h.at + 1);
  return end * stingerPulseSeconds(def);
}

/** A stinger as note events (pulse times from its start). */
export function stingerEvents(id: StingerId): NoteEvent[] {
  const def = STINGER_DEFS[id];
  const out: NoteEvent[] = [];
  for (const n of def.notes) {
    const tonic = tonicMidi(def.tonic, def.octave + (n.o ?? 0));
    out.push({ layer: 'stinger', instrument: n.i, at: n.at, len: n.len, midi: degreeToMidi(def.mode, tonic, n.d), vel: n.vel, nudge: 0 });
  }
  for (const h of def.hits) out.push({ layer: 'stinger', instrument: 'drums', at: h.at, len: 1, midi: 0, vel: h.vel, hit: h.hit, nudge: 0 });
  out.sort((a, b) => a.at - b.at);
  return out;
}
