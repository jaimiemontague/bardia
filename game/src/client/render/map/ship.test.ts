/** The ship art, the gliding motion and the follow camera (pure parts of the chart view). */
import { describe, expect, it } from 'vitest';
import { cameraLimits, worldToScreen, type Camera } from './camera';
import { followCamera, MotionTracker } from './motion';
import { bannerBearerShapes, longshipShapes, shipLength, shipPose, smallShipShapes, wakeShapes, type Shape } from './shipArt';

function bounds(shapes: readonly Shape[]): { w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    const pts = s.kind === 'circle' ? [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r] : s.pts;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i] as number);
      x1 = Math.max(x1, pts[i] as number);
      y0 = Math.min(y0, pts[i + 1] as number);
      y1 = Math.max(y1, pts[i + 1] as number);
    }
  }
  return { w: x1 - x0, h: y1 - y0 };
}

describe('ship pose', () => {
  it('faces east or west by the heading and tilts at most 30°', () => {
    expect(shipPose(90).facing).toBe(1);
    expect(Math.abs(shipPose(90).rotation)).toBeLessThan(1e-9);
    expect(shipPose(270).facing).toBe(-1);
    expect(Math.abs(shipPose(270).rotation)).toBeLessThan(1e-9);
    expect(shipPose(45).rotation).toBeCloseTo(-Math.PI / 6, 6); // north-east: bow up, clamped
    expect(shipPose(135).rotation).toBeCloseTo(Math.PI / 6, 6);
    // Due north keeps the facing it had (no flicker).
    expect(shipPose(0, -1).facing).toBe(-1);
    expect(shipPose(0, 1).facing).toBe(1);
    expect(shipPose(null, -1)).toEqual({ facing: -1, rotation: 0 });
  });
});

describe('ship art', () => {
  it('the longship is at least 30 px long at every zoom, larger when zoomed in', () => {
    expect(shipLength(1.2)).toBeGreaterThanOrEqual(34);
    expect(shipLength(11)).toBeGreaterThan(shipLength(4.6));
    for (const scale of [1, 2, 4.6, 11, 18]) {
      const L = shipLength(scale);
      const b = bounds(longshipShapes(100, 100, { length: L, pose: shipPose(90), color: 0x335577, rowing: false, phase: 0 }));
      expect(b.w).toBeGreaterThanOrEqual(30);
      expect(b.h).toBeGreaterThan(L * 0.7); // the sail stands above the hull
    }
  });

  it('has a hull, a striped sail, shields along the rail, and oars only when rowing', () => {
    const still = longshipShapes(0, 0, { length: 60, pose: shipPose(90), color: 0x335577, rowing: false, phase: 0 });
    const rowing = longshipShapes(0, 0, { length: 60, pose: shipPose(90), color: 0x335577, rowing: true, phase: 0.3 });
    expect(still.filter((s) => s.kind === 'circle').length).toBeGreaterThanOrEqual(7);
    const sailColors = new Set(still.filter((s) => s.kind === 'poly' && s.fill !== undefined).map((s) => (s as { fill: number }).fill));
    expect(sailColors.has(0xa8261c)).toBe(true);
    expect(rowing.filter((s) => s.kind === 'line').length - still.filter((s) => s.kind === 'line').length).toBe(7);
    for (const s of rowing) if (s.kind !== 'circle') for (const v of s.pts) expect(Number.isFinite(v)).toBe(true);
  });

  it('mirrors for a westward heading', () => {
    const east = longshipShapes(0, 0, { length: 60, pose: shipPose(90), color: 1, rowing: false, phase: 0 });
    const west = longshipShapes(0, 0, { length: 60, pose: shipPose(270), color: 1, rowing: false, phase: 0 });
    const prowX = (shapes: Shape[]) => Math.max(...shapes.filter((s) => s.kind === 'poly').flatMap((s) => (s as { pts: number[] }).pts.filter((_, i) => i % 2 === 0)));
    const sternX = (shapes: Shape[]) => Math.min(...shapes.filter((s) => s.kind === 'poly').flatMap((s) => (s as { pts: number[] }).pts.filter((_, i) => i % 2 === 0)));
    expect(prowX(east)).toBeCloseTo(-sternX(west), 6);
  });

  it('other houses get a smaller ship; a wake trails behind; the war-band has a banner', () => {
    expect(bounds(smallShipShapes(0, 0, 24, shipPose(90), 0x884422)).w).toBeGreaterThan(20);
    const wake = wakeShapes(0, 0, 40, [1, 0], 1);
    expect(wake.length).toBe(3);
    for (const s of wake) if (s.kind === 'line') expect(Math.max(...s.pts.filter((_, i) => i % 2 === 0))).toBeLessThan(0);
    expect(wakeShapes(0, 0, 40, [0, 0], 1)).toEqual([]);
    expect(bounds(bannerBearerShapes(0, 0, 30, 0x884422, 1, 0)).h).toBeGreaterThanOrEqual(30);
  });
});

describe('motion', () => {
  it('glides from one hourly position to the next over the time an hour took', () => {
    const m = new MotionTracker();
    m.update('flt_1', [10, 10], 0);
    m.update('flt_1', [10, 10], 160);
    m.update('flt_1', [12, 10], 200);
    expect(m.sample('flt_1', 200)?.pos).toEqual([10, 10]);
    const mid = m.sample('flt_1', 300)?.pos as [number, number];
    expect(mid[0]).toBeGreaterThan(10);
    expect(mid[0]).toBeLessThan(12);
    expect(m.sample('flt_1', 2000)?.pos).toEqual([12, 10]);
    expect(m.sample('flt_1', 300)?.heading).toBeCloseTo(90, 6);
    expect(m.active(300)).toBe(true);
    expect(m.active(10_000)).toBe(false);
    expect(m.sample('flt_1', 10_000)?.moving).toBe(0);
  });

  it('snaps long jumps and forgets what is gone', () => {
    const m = new MotionTracker();
    m.update('a', [0, 0], 0);
    m.update('a', [100, 0], 100);
    expect(m.sample('a', 100)?.pos).toEqual([100, 0]);
    m.retain([]);
    expect(m.sample('a', 200)).toBeUndefined();
  });
});

describe('follow camera', () => {
  const view = { width: 1000, height: 600 };
  const lim = cameraLimits(view, 800, 600);
  const cam: Camera = { x: 400, y: 300, scale: 4 };

  it('does not move while the ship is inside the dead zone, and keeps the zoom when it does', () => {
    expect(followCamera(cam, view, lim, [405, 302])).toBe(cam);
    const next = followCamera(cam, view, lim, [520, 300]);
    expect(next.scale).toBe(4);
    expect(next.x).toBeGreaterThan(400);
    const [sx] = worldToScreen(next, view, [520, 300]);
    expect(sx).toBeCloseTo(500 + 500 * 0.3, 6);
  });
});
