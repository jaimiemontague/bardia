/**
 * Smooth motion on the chart (pure). The simulation moves fleets and war-bands in whole game hours; the chart draws
 * them gliding: each new position is reached linearly over the time the last hour took on screen, so the drawn
 * speed matches the real one and the drawing lags by at most one update. Also the soft follow camera: the camera
 * moves only when the followed thing leaves a dead zone around the middle of the view, keeping the player's zoom.
 */
import { clampCamera, worldToScreen, type Camera, type CameraLimits, type Viewport } from './camera';
import type { Vec2 } from './types';

interface Track {
  from: Vec2;
  to: Vec2;
  t0: number;
  dur: number;
  lastUpdate: number;
  /** Last known compass bearing (degrees) while moving. */
  heading: number | null;
  /** Last time the position changed (ms), for the wake and the oars. */
  movedAt: number;
  /** Screen-independent unit vector of the last move. */
  dir: Vec2;
}

/** A drawn position. */
export interface MotionSample {
  pos: Vec2;
  /** Compass bearing of the last move (or the marker's own heading), null when never seen moving. */
  heading: number | null;
  /** Direction of the last move (unit vector in cells), [0, 0] when unknown. */
  dir: Vec2;
  /** 1 while gliding, fading to 0 within `restMs` of the last move (drives the wake). */
  moving: number;
}

/** Jumps longer than this (cells) are not animated (a new voyage, a load, a homecoming). */
const SNAP_CELLS = 25;
const MIN_MS = 60;
const MAX_MS = 600;

function bearingOf(dx: number, dy: number): number | null {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  const d = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (d + 360) % 360;
}

export class MotionTracker {
  private tracks: Record<string, Track> = {};
  /** How long the wake lingers after the last move (ms). */
  restMs = 700;

  /** Feeds the latest simulated position of `id` at time `now` (ms). `heading` is the marker's own (route) bearing. */
  update(id: string, pos: Vec2, now: number, heading: number | null = null): void {
    const t = this.tracks[id];
    if (!t) {
      this.tracks[id] = { from: pos, to: pos, t0: now, dur: 0, lastUpdate: now, heading, movedAt: -Infinity, dir: [0, 0] };
      return;
    }
    if (pos[0] === t.to[0] && pos[1] === t.to[1]) {
      if (heading !== null) t.heading = heading;
      return;
    }
    const cur = this.sample(id, now)?.pos ?? t.to;
    const dx = pos[0] - t.to[0];
    const dy = pos[1] - t.to[1];
    const dist = Math.hypot(dx, dy);
    const dur = Math.max(MIN_MS, Math.min(MAX_MS, now - t.lastUpdate));
    t.from = dist > SNAP_CELLS ? pos : cur;
    t.to = pos;
    t.t0 = now;
    t.dur = dist > SNAP_CELLS ? 0 : dur;
    t.lastUpdate = now;
    if (dist <= SNAP_CELLS) {
      t.movedAt = now;
      t.dir = [dx / dist, dy / dist];
      t.heading = heading ?? bearingOf(dx, dy) ?? t.heading;
    } else if (heading !== null) t.heading = heading;
  }

  /** The drawn position of `id` at `now` (undefined when never seen). */
  sample(id: string, now: number): MotionSample | undefined {
    const t = this.tracks[id];
    if (!t) return undefined;
    const k = t.dur <= 0 ? 1 : Math.max(0, Math.min(1, (now - t.t0) / t.dur));
    const pos: Vec2 = [t.from[0] + (t.to[0] - t.from[0]) * k, t.from[1] + (t.to[1] - t.from[1]) * k];
    const since = now - t.movedAt;
    const glide = k < 1 ? 1 : 0;
    const moving = Math.max(glide, since < t.dur + this.restMs ? 1 - Math.max(0, since - t.dur) / this.restMs : 0);
    return { pos, heading: t.heading, dir: t.dir, moving: Math.max(0, Math.min(1, moving)) };
  }

  /** True while anything is still gliding or its wake fading (the view keeps redrawing). */
  active(now: number): boolean {
    for (const id of Object.keys(this.tracks)) {
      const t = this.tracks[id] as Track;
      if (now - t.t0 < t.dur || now - t.movedAt < t.dur + this.restMs) return true;
    }
    return false;
  }

  /** Forgets everything not in `ids`. */
  retain(ids: readonly string[]): void {
    const keep: Record<string, Track> = {};
    for (const id of ids) {
      const t = this.tracks[id];
      if (t) keep[id] = t;
    }
    this.tracks = keep;
  }
}

/**
 * The follow camera: when `target` lies outside the dead zone (`zone` × the view's half-size around the middle),
 * the camera moves just enough to bring it back to the zone's edge. The zoom is never changed.
 */
export function followCamera(cam: Camera, view: Viewport, lim: CameraLimits, target: Vec2, zone = 0.3): Camera {
  const [sx, sy] = worldToScreen(cam, view, target);
  const hx = (view.width / 2) * zone;
  const hy = (view.height / 2) * zone;
  const cx = view.width / 2;
  const cy = view.height / 2;
  let dx = 0;
  let dy = 0;
  if (sx < cx - hx) dx = sx - (cx - hx);
  else if (sx > cx + hx) dx = sx - (cx + hx);
  if (sy < cy - hy) dy = sy - (cy - hy);
  else if (sy > cy + hy) dy = sy - (cy + hy);
  if (dx === 0 && dy === 0) return cam;
  return clampCamera({ x: cam.x + dx / cam.scale, y: cam.y + dy / cam.scale, scale: cam.scale }, view, lim);
}
