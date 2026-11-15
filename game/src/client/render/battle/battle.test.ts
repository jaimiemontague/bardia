import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { BattleEngine } from '@sim/battle/index';
import { makeTestSetup } from '@sim/battle/testing';
import { clampBattleCamera, fitBattleScale, toScreen, toWorld, zoomAround } from './camera';
import { footprintCorners, lerpAngle, pickStructure, unitShape } from './geometry';
import { hash01, rasterizeGround } from './ground';

const content = getContent();

describe('battle camera', () => {
  const view = { width: 1600, height: 1000 };
  it('round-trips world and screen points and fits the map', () => {
    const cam = { x: 48, y: 36, scale: fitBattleScale(view, 96, 72) };
    const [sx, sy] = toScreen(cam, view, 10, 20);
    const [wx, wy] = toWorld(cam, view, sx, sy);
    expect(wx).toBeCloseTo(10);
    expect(wy).toBeCloseTo(20);
    expect(96 * cam.scale).toBeLessThanOrEqual(1600);
    expect(72 * cam.scale).toBeLessThanOrEqual(1000);
  });
  it('zooms around the cursor and clamps', () => {
    const cam = { x: 48, y: 36, scale: 12 };
    const z = zoomAround(cam, view, 2, 400, 300, 96, 72);
    const before = toWorld(cam, view, 400, 300);
    const after = toWorld(z, view, 400, 300);
    expect(after[0]).toBeCloseTo(before[0], 0);
    expect(after[1]).toBeCloseTo(before[1], 0);
    const far = clampBattleCamera({ x: -500, y: 900, scale: 30 }, view, 96, 72);
    expect(far.x).toBeGreaterThan(0);
    expect(far.y).toBeLessThan(80);
  });
});

describe('battle geometry', () => {
  it('builds oriented footprints and interpolates angles the short way', () => {
    const pts = footprintCorners(10, 10, 0, 2, 1);
    expect(pts).toHaveLength(8);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
  });
  it('knows unit silhouettes', () => {
    expect(unitShape(content, 'archers')).toBe('archer');
    expect(unitShape(content, 'horsemen')).toBe('horse');
    expect(unitShape(content, 'greatBear')).toBe('beast');
    expect(unitShape(content, 'monks')).toBe('civilian');
    expect(unitShape(content, 'nope')).toBe('foot');
  });
  it('picks buildings, gates and loot under a point', () => {
    const e = BattleEngine.create(makeTestSetup(content, { kind: 'assault', template: 'town', fortTier: 2, seed: 'pick' }), content);
    const snap = e.snapshot(null);
    const b = snap.buildings[0]!;
    expect(pickStructure(e.state.map, snap.buildings, snap.gates, snap.caches, b.x + 0.5, b.y + 0.5)).toEqual({ kind: 'building', id: b.id });
    const g = snap.gates[0]!;
    expect(pickStructure(e.state.map, snap.buildings, snap.gates, snap.caches, g.x + 0.5, g.y + 0.5)).toEqual({ kind: 'gate', id: g.id });
    expect(pickStructure(e.state.map, snap.buildings, snap.gates, [{ id: 'c9', x: 3, y: 3, value: 10, dropped: true, treasury: false }], 3.2, 3.1)).toEqual({ kind: 'cache', id: 'c9' });
  });
});

describe('battle ground raster', () => {
  it('is deterministic and fully opaque', () => {
    const e = BattleEngine.create(makeTestSetup(content, { kind: 'raid', seed: 'ground' }), content);
    const a = rasterizeGround(e.state.map, 4);
    const b = rasterizeGround(e.state.map, 4);
    expect(a.length).toBe(e.state.map.w * 4 * e.state.map.h * 4 * 4);
    expect(a).toEqual(b);
    for (let i = 3; i < a.length; i += 4 * 97) expect(a[i]).toBe(255);
    expect(hash01(3, 4)).toBe(hash01(3, 4));
    expect(hash01(3, 4)).toBeGreaterThanOrEqual(0);
    expect(hash01(3, 4)).toBeLessThan(1);
  });
});
