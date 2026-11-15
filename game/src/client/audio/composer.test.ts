import { describe, expect, it } from 'vitest';
import { MUSIC_STATES } from './catalog';
import { barContext, BUSY_INTENSITY, composeBar, composeSpan } from './composer';
import { barPulses, layerIntensityGain, MUSIC_STYLES } from './styles';
import { degreeToMidi, MODES, nearestChordTone, PITCH_CLASSES, PROGRESSIONS, tonicMidi } from './theory';

describe('theory', () => {
  it('maps scale degrees to MIDI across octaves (negative degrees too)', () => {
    const d4 = tonicMidi('D', 4);
    expect(d4).toBe(62);
    expect(degreeToMidi('dorian', d4, 0)).toBe(62);
    expect(degreeToMidi('dorian', d4, 2)).toBe(65); // F
    expect(degreeToMidi('dorian', d4, 7)).toBe(74);
    expect(degreeToMidi('dorian', d4, -1)).toBe(60); // C below
    expect(degreeToMidi('aeolian', d4, -7)).toBe(50);
  });

  it('finds the nearest chord tone', () => {
    expect(nearestChordTone(1, 0)).toBe(0);
    expect(nearestChordTone(3, 0)).toBe(2);
    expect(nearestChordTone(4, 0)).toBe(4);
    expect(nearestChordTone(5, 3)).toBe(5);
  });

  it('has progressions starting on the tonic for every mode', () => {
    for (const progs of Object.values(PROGRESSIONS)) for (const p of progs) expect(p[0]).toBe(0);
  });
});

describe('composer determinism', () => {
  it('same seed → identical note sequence for every state', () => {
    for (const s of MUSIC_STATES) {
      const a = composeSpan(MUSIC_STYLES[s], 'saga-1', 0, 12, 0.5);
      const b = composeSpan(MUSIC_STYLES[s], 'saga-1', 0, 12, 0.5);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it('different seeds give different music', () => {
    const a = composeSpan(MUSIC_STYLES.homeSkarn, 'seed-a', 0, 16);
    const b = composeSpan(MUSIC_STYLES.homeSkarn, 'seed-b', 0, 16);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('is random access: a bar does not depend on the bars before it', () => {
    const style = MUSIC_STYLES.sailingStorm;
    const whole = composeSpan(style, 'x', 0, 10).filter((n) => n.bar >= 6);
    const tail = composeSpan(style, 'x', 6, 4);
    expect(tail).toEqual(whole);
  });

  it('opens the main theme with the horn motif (D dorian, D–E–F–A)', () => {
    const horn = composeBar(MUSIC_STYLES.mainTheme, 'any', 0).filter((n) => n.layer === 'horn');
    expect(horn.map((n) => n.midi)).toEqual([62, 64, 65, 69]);
    expect(horn.map((n) => n.at)).toEqual([0, 3, 4, 6]);
  });
});

describe('composer invariants', () => {
  it('notes start inside their bar, have positive lengths, sane pitches and velocities', () => {
    for (const s of MUSIC_STATES) {
      const style = MUSIC_STYLES[s];
      const pulses = barPulses(style);
      for (let bar = 0; bar < 24; bar++) {
        for (const n of composeBar(style, 'inv', bar, (bar % 5) / 4)) {
          expect(n.at).toBeGreaterThanOrEqual(0);
          expect(n.at).toBeLessThan(pulses);
          expect(n.len).toBeGreaterThanOrEqual(1);
          expect(n.vel).toBeGreaterThanOrEqual(0);
          expect(n.vel).toBeLessThanOrEqual(1);
          expect(Number.isInteger(n.nudge)).toBe(true);
          expect(Math.abs(n.nudge)).toBeLessThanOrEqual(10);
          if (n.instrument === 'drums') expect(n.hit).toBeDefined();
          else {
            expect(n.midi).toBeGreaterThanOrEqual(24);
            expect(n.midi).toBeLessThanOrEqual(108);
          }
        }
      }
    }
  });

  it('keeps every pitched note in the style’s mode', () => {
    for (const s of MUSIC_STATES) {
      const style = MUSIC_STYLES[s];
      const tonicPc = PITCH_CLASSES[style.tonic];
      const allowed = new Set(MODES[style.mode].map((st) => (tonicPc + st) % 12));
      for (const n of composeSpan(style, 'modal', 0, 16)) {
        if (n.instrument === 'drums') continue;
        expect(allowed.has(n.midi % 12), `${s}: ${n.layer} midi ${n.midi}`).toBe(true);
      }
    }
  });

  it('chord progressions follow the phrase structure', () => {
    const style = MUSIC_STYLES.homeHvarn;
    for (let bar = 0; bar < 16; bar++) {
      const c = barContext(style, 's', bar);
      expect(c.phrase).toBe(Math.floor(bar / style.phraseBars));
      expect(c.chord).toBeGreaterThanOrEqual(0);
      expect(c.chord).toBeLessThan(7);
    }
    expect(barContext(style, 's', 0).chord).toBe(0);
  });

  it('switches drum grooves to the busy set at high intensity', () => {
    const style = MUSIC_STYLES.velkarSaraleon;
    const drums = (i: number) => composeSpan(style, 'g', 0, 4, i).filter((n) => n.instrument === 'drums').length;
    expect(drums(BUSY_INTENSITY + 0.1)).toBeGreaterThan(drums(0.2));
  });

  it('fades battle stems in by intensity windows', () => {
    const style = MUSIC_STYLES.battleShieldwall;
    const horn = style.layers.find((l) => l.id === 'horn');
    expect(horn).toBeDefined();
    if (!horn) return;
    expect(layerIntensityGain(horn, 0.2)).toBe(0);
    expect(layerIntensityGain(horn, 0.9)).toBe(1);
    const mid = layerIntensityGain(horn, 0.71);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const low = style.layers.filter((l) => l.stem === 'low');
    for (const l of low) expect(layerIntensityGain(l, 0)).toBe(1);
  });
});
