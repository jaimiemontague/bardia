/**
 * Real-time clock (design §7.2, §29.4): converts wall-clock milliseconds into whole game hours for
 * `session.advance(hours)`. At 1× one game day passes in MS_PER_DAY_AT_1X real milliseconds
 * (≈ 4 s while sailing); 2× and 4× scale it. Fractions carry over between frames, so the long-run
 * rate is exact regardless of frame rate, and a frame hitch (tab in background, GC pause) is capped
 * so the game never lurches forward by days.
 */
import { HOURS_PER_DAY } from '@sim/core/time';

/** Time-control speeds on the map (pause is separate). */
export const TIME_SPEEDS = [1, 2, 4] as const;
export type TimeSpeed = (typeof TIME_SPEEDS)[number];

/** Real milliseconds per game day at 1× (§7.2: "1 game day ≈ 4 s"). */
export const MS_PER_DAY_AT_1X = 4000;
/** Longest frame the clock honours (ms); longer gaps (background tabs) are clipped. */
export const MAX_FRAME_MS = 250;
/** Upper bound of hours handed to one advance call. */
export const MAX_HOURS_PER_STEP = 24;

/** Game hours per real millisecond at 1×. */
export const HOURS_PER_MS_AT_1X = HOURS_PER_DAY / MS_PER_DAY_AT_1X;
/** Tolerance for floating-point error when summing frame fractions (2.4 h × 40 frames = 95.999…). */
const HOUR_EPSILON = 1e-6;

export class RealtimeClock {
  private acc = 0;

  /** Fractional game hours accumulated but not yet advanced. */
  get pendingFraction(): number {
    return this.acc;
  }

  /**
   * Feeds `dtMs` of wall-clock time at `speed`; returns the whole hours to advance now (0 or more).
   * Call `reset()` when time is paused or stopped so no stale fraction is carried.
   */
  tick(dtMs: number, speed: TimeSpeed): number {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
    const dt = Math.min(dtMs, MAX_FRAME_MS);
    this.acc += dt * speed * HOURS_PER_MS_AT_1X;
    const whole = Math.min(Math.floor(this.acc + HOUR_EPSILON), MAX_HOURS_PER_STEP);
    this.acc = Math.max(0, this.acc - whole);
    if (this.acc >= MAX_HOURS_PER_STEP) this.acc = 0;
    return whole;
  }

  /** Drops any carried fraction. */
  reset(): void {
    this.acc = 0;
  }
}

/** The next faster/slower speed (clamped). */
export function stepSpeed(speed: TimeSpeed, dir: 1 | -1): TimeSpeed {
  const i = TIME_SPEEDS.indexOf(speed);
  const j = Math.max(0, Math.min(TIME_SPEEDS.length - 1, i + dir));
  return TIME_SPEEDS[j] as TimeSpeed;
}
