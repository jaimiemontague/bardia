/**
 * Minimal modal music theory for the procedural placeholder score: diatonic modes, scale-degree
 * arithmetic and MIDI ↔ frequency. Everything here is integer arithmetic so note sequences are
 * exactly reproducible (only `midiToHz` produces floats, and it is used at playback time).
 */

/** Semitone steps of the diatonic modes used by the score (§28.1 palette: modal folk). */
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const satisfies Record<string, readonly number[]>;
export type ModeId = keyof typeof MODES;

/** Pitch classes by name (sharps only). */
export const PITCH_CLASSES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 } as const;
export type PitchName = keyof typeof PITCH_CLASSES;

/** Floor division that works for negatives. */
function fdiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * MIDI note of a scale degree. `degree` counts scale steps from the tonic (0 = tonic, 7 = the
 * tonic an octave up, −1 = the step below); `tonicMidi` is the tonic's MIDI note.
 */
export function degreeToMidi(mode: ModeId, tonicMidi: number, degree: number): number {
  const steps = MODES[mode];
  const oct = fdiv(degree, 7);
  const idx = degree - oct * 7;
  return tonicMidi + oct * 12 + (steps[idx] as number);
}

/** MIDI note of a tonic name in an octave (C4 = 60). */
export function tonicMidi(name: PitchName, octave: number): number {
  return 12 * (octave + 1) + PITCH_CLASSES[name];
}

/** Equal-tempered frequency of a MIDI note (A4 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Scale degrees (relative to the tonic) of the triad built on `root` (a scale degree). */
export function triad(root: number): [number, number, number] {
  return [root, root + 2, root + 4];
}

/** True if `degree` is a tone of the triad on `root` (any octave). */
export function isChordTone(degree: number, root: number): boolean {
  const d = (((degree - root) % 7) + 7) % 7;
  return d === 0 || d === 2 || d === 4;
}

/** The chord tone of the triad on `root` nearest to `degree` (ties resolve downward). */
export function nearestChordTone(degree: number, root: number): number {
  for (let delta = 0; delta < 4; delta++) {
    if (isChordTone(degree - delta, root)) return degree - delta;
    if (isChordTone(degree + delta, root)) return degree + delta;
  }
  return degree;
}

/**
 * Idiomatic modal progressions (chord roots as scale degrees, one chord per harmonic slot).
 * Dorian leans on i–IV, mixolydian on I–♭VII–IV, aeolian on i–♭VI–♭VII, phrygian on i–♭II.
 */
export const PROGRESSIONS: Readonly<Record<ModeId, readonly (readonly number[])[]>> = {
  ionian: [
    [0, 3, 4, 0],
    [0, 5, 3, 4],
    [0, 3, 0, 4],
  ],
  dorian: [
    [0, 3, 0, 3],
    [0, 6, 3, 0],
    [0, 3, 6, 0],
    [0, 2, 3, 0],
  ],
  phrygian: [
    [0, 1, 0, 1],
    [0, 1, 6, 0],
    [0, 6, 5, 1],
  ],
  mixolydian: [
    [0, 6, 3, 0],
    [0, 6, 0, 6],
    [0, 3, 6, 0],
    [0, 4, 6, 0],
  ],
  aeolian: [
    [0, 5, 6, 0],
    [0, 6, 5, 6],
    [0, 3, 5, 6],
    [0, 5, 3, 4],
  ],
};
