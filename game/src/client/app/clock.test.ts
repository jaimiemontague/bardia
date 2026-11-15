import { describe, expect, it } from 'vitest';
import { HOURS_PER_MS_AT_1X, MAX_FRAME_MS, MAX_HOURS_PER_STEP, MS_PER_DAY_AT_1X, RealtimeClock, stepSpeed } from './clock';

describe('RealtimeClock (§7.2: 1× = one game day ≈ 4 s)', () => {
  it('turns 4 s of wall-clock time at 1× into exactly one day, at any frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const clock = new RealtimeClock();
      const frame = 1000 / fps;
      let hours = 0;
      for (let ms = 0; ms < MS_PER_DAY_AT_1X - 1e-6; ms += frame) hours += clock.tick(frame, 1);
      expect(hours + clock.pendingFraction).toBeCloseTo(24, 6);
      expect(hours).toBeGreaterThanOrEqual(23);
    }
  });

  it('scales with speed: 2× and 4× pass two and four days in 4 s', () => {
    for (const speed of [2, 4] as const) {
      const clock = new RealtimeClock();
      let hours = 0;
      for (let i = 0; i < 240; i++) hours += clock.tick(1000 / 60, speed);
      expect(hours + clock.pendingFraction).toBeCloseTo(24 * speed, 6);
    }
  });

  it('does not lose an hour to floating-point error at exact boundaries', () => {
    for (const [frame, speed] of [[100, 4], [100, 2], [1000 / 60, 1], [1000 / 30, 4]] as const) {
      const clock = new RealtimeClock();
      let hours = 0;
      const frames = Math.round(MS_PER_DAY_AT_1X / frame);
      for (let i = 0; i < frames; i++) hours += clock.tick(frame, speed);
      expect(hours, `${frame} ms at ${speed}×`).toBe(24 * speed);
    }
  });

  it('carries fractions between frames and returns whole hours only', () => {
    const clock = new RealtimeClock();
    const msPerHour = 1 / HOURS_PER_MS_AT_1X;
    expect(clock.tick(msPerHour * 0.6, 1)).toBe(0);
    expect(clock.tick(msPerHour * 0.6, 1)).toBe(1);
    expect(clock.pendingFraction).toBeCloseTo(0.2, 9);
  });

  it('clips long frames (background tab) and caps one step', () => {
    const clock = new RealtimeClock();
    const h = clock.tick(60_000, 4);
    expect(h).toBe(Math.min(MAX_HOURS_PER_STEP, Math.floor(MAX_FRAME_MS * 4 * HOURS_PER_MS_AT_1X)));
    expect(h).toBeLessThanOrEqual(MAX_HOURS_PER_STEP);
  });

  it('ignores invalid time and resets cleanly', () => {
    const clock = new RealtimeClock();
    expect(clock.tick(Number.NaN, 1)).toBe(0);
    expect(clock.tick(-5, 1)).toBe(0);
    clock.tick(100, 1);
    clock.reset();
    expect(clock.pendingFraction).toBe(0);
  });

  it('steps speeds within 1/2/4', () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(2, 1)).toBe(4);
    expect(stepSpeed(4, 1)).toBe(4);
    expect(stepSpeed(1, -1)).toBe(1);
    expect(stepSpeed(4, -1)).toBe(2);
  });
});
