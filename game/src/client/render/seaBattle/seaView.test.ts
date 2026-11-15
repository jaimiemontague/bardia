/** The sea view's pure parts: the camera, the baked sea and the hull shapes. */
import { describe, expect, it } from 'vitest';
import { clampSeaCamera, easeCamera, frameRect, MAX_SCALE, minSeaScale, shipInflation, toScreen, toWorld, zoomAround } from './camera';
import { forwardOf, halfBeam, hullKind, hullOutline } from './ships';
import { bakeSeaPixels } from './water';

const view = { width: 1600, height: 1000 };
const insets = { top: 70, bottom: 150, left: 20, right: 20 };

describe('camera', () => {
  it('round-trips screen and world points', () => {
    const cam = { x: 900, y: 700, scale: 2.5 };
    const [sx, sy] = toScreen(cam, view, 1000, 650);
    const [wx, wy] = toWorld(cam, view, sx, sy);
    expect(wx).toBeCloseTo(1000, 6);
    expect(wy).toBeCloseTo(650, 6);
  });

  it('keeps the zoom in range and the point under the cursor fixed', () => {
    const cam = { x: 1000, y: 1000, scale: 2 };
    const z = zoomAround(cam, view, 1.5, 300, 200, 2000);
    expect(z.scale).toBeCloseTo(3, 6);
    const before = toWorld(cam, view, 300, 200);
    const after = toWorld(z, view, 300, 200);
    expect(after[0]).toBeCloseTo(before[0], 4);
    expect(after[1]).toBeCloseTo(before[1], 4);
    expect(clampSeaCamera({ x: 0, y: 0, scale: 100 }, view, 2000).scale).toBe(MAX_SCALE);
    expect(clampSeaCamera({ x: 0, y: 0, scale: 0.01 }, view, 2000).scale).toBeCloseTo(minSeaScale(view, 2000), 6);
  });

  it('frames a rectangle in the free part of the screen, never tighter than its minimum', () => {
    const cam = frameRect(view, insets, 400, 900, 1200, 1100, 2000);
    const [ax] = toScreen(cam, view, 400, 1000);
    const [bx] = toScreen(cam, view, 1200, 1000);
    expect(ax).toBeGreaterThanOrEqual(insets.left - 1);
    expect(bx).toBeLessThanOrEqual(view.width - insets.right + 1);
    const tight = frameRect(view, insets, 1000, 1000, 1001, 1001, 2000, 4.5, 260);
    expect(tight.scale).toBeLessThanOrEqual(4.5);
  });

  it('eases toward a target and arrives', () => {
    let cam = { x: 0, y: 0, scale: 1 };
    const target = { x: 100, y: 50, scale: 4 };
    for (let i = 0; i < 300; i++) cam = easeCamera(cam, target, 1 / 30);
    expect(cam.x).toBeCloseTo(100, 1);
    expect(cam.scale).toBeCloseTo(4, 2);
  });

  it('draws ships larger than life only when zoomed out', () => {
    expect(shipInflation(10)).toBe(1);
    expect(shipInflation(1)).toBeGreaterThan(3);
  });
});

describe('hulls', () => {
  it('knows the hull kinds and their shapes', () => {
    expect(hullKind('knarr')).toBe('knarr');
    expect(hullKind('galley')).toBe('galley');
    expect(hullKind('drakkar')).toBe('longship');
    // Widest amidships, pointed at the ends.
    expect(halfBeam('longship', 4, 0)).toBeCloseTo(2, 6);
    expect(halfBeam('longship', 4, 1)).toBeCloseTo(0, 6);
    expect(halfBeam('knarr', 4, 0.6)).toBeGreaterThan(halfBeam('longship', 4, 0.6));
    const pts = hullOutline('longship', 20, 4);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(10, 6);
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(-10, 6);
  });

  it('turns compass headings into screen directions', () => {
    const [nx, ny] = forwardOf(0);
    expect(nx).toBeCloseTo(0, 6);
    expect(ny).toBeCloseTo(-1, 6);
    const [ex, ey] = forwardOf(90);
    expect(ex).toBeCloseTo(1, 6);
    expect(ey).toBeCloseTo(0, 6);
  });
});

describe('the baked sea', () => {
  it('paints land green or sand, water blue, and fills every pixel', () => {
    const w = 6;
    const h = 6;
    const terrain = new Uint8Array(w * h);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) terrain[y * w + x] = 2;
    const img = bakeSeaPixels({ w, h, terrain }, 4);
    expect(img.width).toBe(24);
    expect(img.data.length).toBe(24 * 24 * 4);
    const at = (x: number, y: number) => [img.data[(y * 24 + x) * 4]!, img.data[(y * 24 + x) * 4 + 1]!, img.data[(y * 24 + x) * 4 + 2]!, img.data[(y * 24 + x) * 4 + 3]!];
    const water = at(1, 1);
    const land = at(20, 20);
    expect(water[2]!).toBeGreaterThan(water[0]!); // blue over red
    expect(land[1]!).toBeGreaterThan(land[2]!); // green over blue
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255);
  });
});
