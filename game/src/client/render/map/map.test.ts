import { describe, expect, it } from 'vitest';
import { GameSession } from '@sim/index';
import { getStaticWorld } from '@sim/modules/world/map/index';
import { cameraLimits, clampCamera, fitScale, screenToWorld, worldToScreen, zoomAt, zoomBand } from './camera';
import { DEFAULT_PALETTE } from './colors';
import { declutterLabels, type LabelCandidate } from './declutter';
import { describeTarget } from './describe';
import { cellTarget, pickMarker, type ScreenMarker } from './hitTest';
import { knowledgeAt, readKnowledge } from './knowledge';
import { buildLabelDefs, labelVisible, settlementIconVisible } from './labels';
import { buildOverlay, mapModes, provinceOwnership } from './overlays';
import { buildMapScene } from './scene';
import { KNOW_CHARTED, KNOW_UNKNOWN, KNOW_VISITED, MAP_MODES } from './types';

const world = getStaticWorld();
const session = GameSession.newGame({ seed: 'map-test' });
const state = session.getState();

describe('camera', () => {
  const view = { width: 1600, height: 1000 };
  const lim = cameraLimits(view, world.width, world.height);

  it('maps world ↔ screen both ways and keeps the chart in view', () => {
    const cam = clampCamera({ x: 400, y: 300, scale: 4 }, view, lim);
    const [sx, sy] = worldToScreen(cam, view, [410, 305]);
    const [wx, wy] = screenToWorld(cam, view, sx, sy);
    expect(wx).toBeCloseTo(410);
    expect(wy).toBeCloseTo(305);
    const edge = clampCamera({ x: -100, y: -100, scale: 4 }, view, lim);
    expect(edge.x).toBeGreaterThanOrEqual(view.width / 2 / 4);
    expect(clampCamera({ x: 0, y: 0, scale: 0.0001 }, view, lim).scale).toBe(lim.minScale);
  });

  it('zooms about the pointer (the point under it stays put) and names the zoom bands', () => {
    const cam = clampCamera({ x: 400, y: 300, scale: 3 }, view, lim);
    const before = screenToWorld(cam, view, 500, 400);
    const after = screenToWorld(zoomAt(cam, view, lim, 1.5, 500, 400), view, 500, 400);
    expect(after[0]).toBeCloseTo(before[0], 4);
    expect(after[1]).toBeCloseTo(before[1], 4);
    expect(zoomBand(fitScale(view, world.width, world.height))).toBe('world');
    expect(zoomBand(5)).toBe('region');
    expect(zoomBand(12)).toBe('local');
  });
});

describe('labels and declutter', () => {
  it('never places two labels on top of each other, the most important first', () => {
    const cands: LabelCandidate[] = [
      { id: 'a', x: 100, y: 100, width: 80, height: 14, priority: 1 },
      { id: 'b', x: 110, y: 102, width: 80, height: 14, priority: 5 },
      { id: 'c', x: 400, y: 100, width: 80, height: 14, priority: 1 },
    ];
    const placed = declutterLabels(cands, { width: 800, height: 600 });
    expect(placed.map((p) => p.id)).toContain('b');
    expect(placed.map((p) => p.id)).toContain('c');
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i]!;
        const q = placed[j]!;
        const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('shows regions far out, provinces and villages only closer', () => {
    const scene = buildMapScene(world, state, {});
    const defs = buildLabelDefs(world, scene);
    const region = defs.find((d) => d.kind === 'region');
    const province = defs.find((d) => d.kind === 'province');
    expect(region && labelVisible(region, 'world')).toBe(true);
    expect(province && labelVisible(province, 'world')).toBe(false);
    expect(province && labelVisible(province, 'region')).toBe(true);
    expect(settlementIconVisible('village', 'world', false)).toBe(false);
    expect(settlementIconVisible('village', 'world', true)).toBe(true);
    expect(settlementIconVisible('capital', 'world', false)).toBe(true);
  });
});

describe('knowledge and scene', () => {
  it("decodes the world module's run-length knowledge: home charted and visited, far seas unknown", () => {
    const levels = readKnowledge(world, state);
    expect(levels).not.toBeNull();
    const cap = state.settlements[state.player.capitalId];
    const cell = Math.floor(cap?.mapPos.y ?? 0) * world.width + Math.floor(cap?.mapPos.x ?? 0);
    expect(knowledgeAt(levels, cell)).toBe(KNOW_VISITED);
    const far = Object.values(state.settlements).find((s) => s.culture === 'saraleonese');
    const farCell = Math.floor(far?.mapPos.y ?? 0) * world.width + Math.floor(far?.mapPos.x ?? 0);
    expect(knowledgeAt(levels, farCell)).toBe(KNOW_UNKNOWN);
    const charted = Array.from(levels ?? []).filter((v) => v === KNOW_CHARTED).length;
    expect(charted).toBeGreaterThan(10_000);
  });

  it('builds the scene from the game: every settlement, the player home, the focus', () => {
    const scene = buildMapScene(world, state, {});
    const real = scene.settlements.filter((s) => s.settlementId !== undefined);
    expect(real.length).toBe(Object.keys(state.settlements).length);
    const home = scene.settlements.find((s) => s.isHome);
    expect(home?.settlementId).toBe(state.player.capitalId);
    expect(scene.focus).not.toBeNull();
    expect(scene.winds.length).toBe(world.geo.seaZones.length);
  });
});

describe('overlays', () => {
  const scene = buildMapScene(world, state, {});
  const input = { world, scene, state, palette: DEFAULT_PALETTE };

  it('every map mode builds per-province fills and a legend', () => {
    expect(mapModes().map((m) => m.id)).toEqual([...MAP_MODES]);
    for (const mode of MAP_MODES) {
      const o = buildOverlay(mode, input);
      expect(o.mode).toBe(mode);
      expect(o.provinceFill).toHaveLength(world.geo.provinces.length);
      expect(o.provinceOwner).toHaveLength(world.geo.provinces.length);
      expect(o.legend.length).toBeGreaterThan(0);
    }
  });

  it("political ownership follows the game: the player's province is theirs", () => {
    const own = provinceOwnership(input);
    const cap = state.settlements[state.player.capitalId];
    const geoId = state.provinces[cap?.provinceId as never]?.geoId as string;
    const index = world.index.province[geoId] as number;
    expect(own.owner[index]).toBe(own.playerKey);
  });
});

describe('hit testing and tooltips', () => {
  it('picks the nearest marker, preferring fleets, else the cell under the pointer', () => {
    const settlement: ScreenMarker = { target: { kind: 'settlement', key: 's:1', name: 'A', pos: [1, 1], cell: 801 }, x: 100, y: 100, r: 10, priority: 2 };
    const fleet: ScreenMarker = { target: { kind: 'fleet', fleetId: 'flt_1', pos: [1, 1], cell: 801 }, x: 104, y: 100, r: 10, priority: 3 };
    expect(pickMarker([settlement, fleet], 102, 100)?.target.kind).toBe('fleet');
    expect(pickMarker([settlement], 300, 300)).toBeNull();
    const sea = cellTarget(world, [5.5, 5.5]);
    expect(sea?.kind).toBe('sea');
  });

  it('describes a settlement under the pointer', () => {
    const scene = buildMapScene(world, state, {});
    const home = scene.settlements.find((s) => s.isHome);
    if (!home) throw new Error('no home');
    const tip = describeTarget({ kind: 'settlement', key: home.key, name: home.name, ...(home.settlementId ? { settlementId: home.settlementId } : {}), pos: home.pos, cell: home.cell }, { world, scene, state });
    expect(tip?.title).toBe(home.name);
    expect(tip?.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(tip)).not.toMatch(/map\.[a-z]+\.[a-zA-Z]+/); // every key has an English string
  });
});
