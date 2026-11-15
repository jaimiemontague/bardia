/**
 * Map engine behaviour on the exact fixture geography (testing.ts): rasterisation, regions and provinces, ports,
 * sea and land A* (optimality against a brute-force Dijkstra), karvi rivers and portages, ice, cost hooks, the
 * sea-lane graph, determinism and the spatial validator.
 */
import { describe, expect, it } from 'vitest';
import { parseGeography } from '@content/world';
import {
  buildStaticWorld,
  CELL_LAKE,
  CELL_LAND,
  CELL_SEA,
  cellAt,
  cellCenter,
  cellIndex,
  cellXY,
  BUNDLED_LAND_SPEEDS,
  defaultPortageCost,
  findLandPath,
  findSeaPath,
  iceBlockedZones,
  isBeach,
  isCoastalLand,
  isNavigable,
  laneDaysFrom,
  laneRoute,
  nearestBeachCell,
  nearestCoast,
  nearestLandCell,
  nearestNavigableCell,
  nearestSeaCell,
  portOf,
  provinceAt,
  regionAt,
  RIVER_NAVIGABLE,
  ROAD_IMPERIAL,
  seaZoneAt,
  TERRAIN_FOREST,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAIN,
  terrainAt,
  validateGeographyFull,
  validateWorld,
  zoneDirectionCost,
  angleOffWind,
  type GridPath,
  type LandSpeeds,
  type SeaPathOptions,
  type StaticWorld,
} from './index';
import { makeTestGeography, testRawGeography } from './testing';

/** The bundled §8.7 speeds with impassable mountains (the bundled table makes them very slow). */
const NO_MOUNTAINS: LandSpeeds = { ...BUNDLED_LAND_SPEEDS, mountain: 0 };

const geo = makeTestGeography();
const world = buildStaticWorld(geo);
const W = world.width;
const at = (x: number, y: number): number => y * W + x;

// ---------------------------------------------------------------------------------------------
// Reference shortest paths (plain Dijkstra with the same move rules as the A* under test).

function dijkstra(size: number, from: number, to: number, neighbours: (c: number, visit: (n: number, cost: number) => void) => void): number {
  const dist = new Float64Array(size).fill(Infinity);
  const done = new Uint8Array(size);
  dist[from] = 0;
  // Simple binary heap of [d, cell].
  const heap: [number, number][] = [[0, from]];
  const push = (d: number, c: number) => {
    heap.push([d, c]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= d) break;
      [heap[p], heap[i]] = [heap[i] as [number, number], heap[p] as [number, number]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0]) m = l;
        if (r < heap.length && (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i] as [number, number], heap[m] as [number, number]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, c] = pop();
    if (done[c] === 1) continue;
    done[c] = 1;
    if (c === to) return d;
    neighbours(c, (n, cost) => {
      const nd = d + cost;
      if (nd < (dist[n] as number)) {
        dist[n] = nd;
        push(nd, n);
      }
    });
  }
  return Infinity;
}

function gridNeighbours(w: StaticWorld, c: number, passable: (i: number) => boolean, stepCost: (n: number, len: number) => number, visit: (n: number, cost: number) => void): void {
  const x = c % w.width;
  const y = (c - x) / w.width;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
      const n = ny * w.width + nx;
      if (!passable(n)) continue;
      if (dx !== 0 && dy !== 0 && (!passable(c + dx) || !passable(c + dy * w.width))) continue;
      visit(n, stepCost(n, dx !== 0 && dy !== 0 ? Math.SQRT2 : 1));
    }
  }
}

function referenceSeaCost(w: StaticWorld, from: number, to: number, karvi: boolean): number {
  const bit = karvi ? 2 : 1;
  const passable = (i: number) => ((w.nav[i] as number) & bit) !== 0;
  const portageCost = defaultPortageCost(w);
  return dijkstra(w.size, from, to, (c, visit) => {
    gridNeighbours(w, c, passable, (_n, len) => len, visit);
    if (karvi && (w.portageAt[c] as number) >= 0) {
      const p = w.portages[w.portageAt[c] as number];
      if (p !== undefined && p.valid) visit(p.fromCell === c ? p.toCell : p.fromCell, portageCost);
    }
  });
}

function referenceLandCost(w: StaticWorld, from: number, to: number, speeds: LandSpeeds): number {
  const speed = (i: number): number => {
    if (w.kind[i] !== CELL_LAND) return 0;
    const t = w.terrain[i] as number;
    const base = [speeds.plain, speeds.forest, speeds.hills, speeds.mountain ?? 0, speeds.marsh][t] ?? 0;
    return w.road[i] !== 0 && base > 0 ? Math.max(base, speeds.road) : base;
  };
  return dijkstra(w.size, from, to, (c, visit) => gridNeighbours(w, c, (i) => speed(i) > 0, (n, len) => len / speed(n), visit));
}

/** Checks the structural invariants of a grid path. */
function expectValidPath(w: StaticWorld, path: GridPath, passable: (i: number) => boolean, allowJump: (a: number, b: number) => boolean = () => false): void {
  for (const c of path.cells) expect(passable(c)).toBe(true);
  for (let k = 1; k < path.cells.length; k++) {
    const a = path.cells[k - 1] as number;
    const b = path.cells[k] as number;
    const [ax, ay] = cellXY(w, a);
    const [bx, by] = cellXY(w, b);
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      expect(allowJump(a, b)).toBe(true);
      continue;
    }
    expect(dx !== 0 || dy !== 0).toBe(true);
    if (dx !== 0 && dy !== 0) {
      // No corner cutting.
      expect(passable(a + dx)).toBe(true);
      expect(passable(a + dy * w.width)).toBe(true);
    }
  }
}

/** Deterministic pseudo-random sequence for picking test cells. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------

describe('rasterisation', () => {
  it('fills polygons by cell centres and cuts lakes into land', () => {
    expect(world.kind[at(20, 5)]).toBe(CELL_LAND);
    expect(world.kind[at(39, 34)]).toBe(CELL_LAND);
    expect(world.kind[at(19, 10)]).toBe(CELL_SEA);
    expect(world.kind[at(40, 10)]).toBe(CELL_SEA);
    expect(world.kind[at(30, 4)]).toBe(CELL_SEA);
    expect(world.kind[at(26, 14)]).toBe(CELL_LAKE);
    expect(world.kind[at(33, 19)]).toBe(CELL_LAKE);
    expect(world.kind[at(25, 14)]).toBe(CELL_LAND);
    let land = 0;
    let lake = 0;
    for (let i = 0; i < world.size; i++) {
      if (world.kind[i] === CELL_LAND) land++;
      else if (world.kind[i] === CELL_LAKE) lake++;
    }
    // Mainland 20×30 + islet 4×4, minus Mere 8×6 and Tarn 8×5.
    expect(lake).toBe(48 + 40);
    expect(land).toBe(600 + 16 - lake);
  });

  it('traces the navigable river and the road as 4-connected overlays', () => {
    for (let x = 34; x <= 39; x++) expect(world.river[at(x, 17)]).toBe(RIVER_NAVIGABLE);
    expect(world.river[at(33, 17)]).toBe(0); // lake cell
    for (let y = 6; y <= 33; y++) expect(world.road[at(22, y)]).toBe(ROAD_IMPERIAL);
    expect(isNavigable(world, at(36, 17), true)).toBe(true);
    expect(isNavigable(world, at(36, 17), false)).toBe(false);
  });

  it('computes exact coast distances', () => {
    expect(world.coastDist[at(20, 10)]).toBe(1);
    expect(world.coastDist[at(22, 10)]).toBe(3);
    expect(world.coastDist[at(17, 10)]).toBe(3); // sea → nearest land (x 20)
    expect(world.coastDist[at(30, 20)]).toBeCloseTo(10, 5);
  });

  it('assigns regions, provinces (Voronoi between anchors) and sea zones', () => {
    expect(regionAt(world, at(30, 8))?.id).toBe('testland');
    expect(regionAt(world, at(10, 17))?.id).toBe('isles');
    expect(provinceAt(world, at(25, 20))?.id).toBe('northMark');
    expect(provinceAt(world, at(25, 21))?.id).toBe('southMark');
    expect(provinceAt(world, at(10, 17))).toBeUndefined(); // neutral islet
    expect(provinceAt(world, at(5, 5))).toBeUndefined(); // sea
    expect(seaZoneAt(world, at(5, 5))?.id).toBe('westSea');
    expect(seaZoneAt(world, at(50, 20))?.id).toBe('eastSea');
    expect(seaZoneAt(world, at(35, 2))?.id).toBe('eastSea');
    const north = world.provinces[0];
    const south = world.provinces[1];
    expect(north?.neighbours).toEqual([1]);
    expect(south?.neighbours).toEqual([0]);
    expect(north?.seaZones).toEqual([0, 1]);
    expect((north?.landCells ?? 0) + (south?.landCells ?? 0)).toBe(600 - 88);
    expect(terrainAt(world, at(30, 8))).toBe('plain');
    expect(terrainAt(world, at(5, 5))).toBeUndefined();
  });

  it('finds ports: sea ports on the nearest sea cell, river ports on navigable inland water', () => {
    const west = portOf(world, 'westport');
    const east = portOf(world, 'eastport');
    const lake = portOf(world, 'lakeside');
    expect(west).toMatchObject({ kind: 'sea', cell: at(19, 10), seaReachable: true, karviReachable: true });
    expect(seaZoneAt(world, west?.cell ?? -1)?.id).toBe('westSea');
    expect(east).toMatchObject({ kind: 'sea', cell: at(40, 31), seaReachable: true });
    expect(lake).toMatchObject({ kind: 'river', cell: at(30, 14), zone: -1, seaReachable: false, karviReachable: true });
    expect(portOf(world, 'nowhere')).toBeUndefined();
  });

  it('records portage ends on navigable water', () => {
    expect(world.portages[0]).toMatchObject({ valid: true, fromCell: at(29, 19), toCell: at(28, 25) });
    expect(world.karviComponent[at(28, 26)]).toBe(world.referenceKarviComponent);
    expect(world.seaComponent[at(50, 20)]).toBe(world.referenceSeaComponent);
  });
});

describe('queries', () => {
  it('converts between points, cells and centres', () => {
    expect(cellAt(world, [20.9, 10.1])).toBe(at(20, 10));
    expect(cellAt(world, [-0.5, 3])).toBe(-1);
    expect(cellIndex(world, 60, 0)).toBe(-1);
    expect(cellXY(world, at(7, 9))).toEqual([7, 9]);
    expect(cellCenter(world, at(7, 9))).toEqual([7.5, 9.5]);
  });

  it('finds the nearest sea, land, beach and navigable cells', () => {
    expect(nearestSeaCell(world, at(22, 10))).toBe(at(19, 10));
    expect(nearestLandCell(world, at(17, 10))).toBe(at(20, 10));
    expect(isCoastalLand(world, at(20, 10))).toBe(true);
    expect(isBeach(world, at(21, 10))).toBe(false);
    expect(nearestBeachCell(world, at(17, 10))).toBe(at(20, 10));
    expect(nearestNavigableCell(world, at(37, 18), true)).toBe(at(37, 17));
    expect(nearestNavigableCell(world, at(30, 30), false, 3)).toBe(-1);
    expect(nearestCoast(world, [22.5, 10.5])).toEqual({ sea: at(19, 10), beach: at(20, 10), distance: 3 });
  });

  it('closes iced zones by calendar day', () => {
    expect(iceBlockedZones(world, 0, 1)).toEqual([false, true]);
    expect(iceBlockedZones(world, 0, 30)).toEqual([false, true]);
    expect(iceBlockedZones(world, 1, 1)).toEqual([false, false]);
  });

  it('measures the angle off the wind', () => {
    expect(angleOffWind(0, 6)).toBe(0); // heading north into a northerly
    expect(angleOffWind(0, 2)).toBe(180); // running south before it
    expect(angleOffWind(90, 6)).toBe(90);
    expect(angleOffWind(350, 7)).toBe(55);
  });
});

describe('sea paths', () => {
  const seaPassable = (i: number) => isNavigable(world, i, false);
  const karviPassable = (i: number) => isNavigable(world, i, true);

  it('sails around the mainland and never cuts a corner', () => {
    const path = findSeaPath(world, at(10, 25), at(50, 25));
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(path.cells[0]).toBe(at(10, 25));
    expect(path.cells[path.cells.length - 1]).toBe(at(50, 25));
    expectValidPath(world, path, seaPassable);
    expect(path.cost).toBeCloseTo(referenceSeaCost(world, at(10, 25), at(50, 25), false), 9);
    expect(path.km).toBeCloseTo(path.length * 5, 9);
    expect(path.portages).toEqual([]);
  });

  it('matches a brute-force Dijkstra for random pairs (with and without landmarks)', () => {
    const rnd = sequence(7);
    const sea: number[] = [];
    for (let i = 0; i < world.size; i++) if (world.kind[i] === CELL_SEA) sea.push(i);
    for (let k = 0; k < 40; k++) {
      const a = sea[Math.floor(rnd() * sea.length)] as number;
      const b = sea[Math.floor(rnd() * sea.length)] as number;
      const ref = referenceSeaCost(world, a, b, false);
      const withLm = findSeaPath(world, a, b);
      const noLm = findSeaPath(world, a, b, { landmarks: false });
      expect(withLm?.cost ?? Infinity).toBeCloseTo(ref, 9);
      expect(noLm?.cost ?? Infinity).toBeCloseTo(ref, 9);
    }
  });

  it('lets karvi up the river into the lake, and over the portage into the tarn', () => {
    const into = at(30, 16);
    expect(findSeaPath(world, at(50, 17), into)).toBeNull();
    const up = findSeaPath(world, at(50, 17), into, { karvi: true });
    expect(up).not.toBeNull();
    if (up !== null) {
      expectValidPath(world, up, karviPassable);
      expect(up.cells.some((c) => world.river[c] === RIVER_NAVIGABLE)).toBe(true);
      expect(up.cost).toBeCloseTo(referenceSeaCost(world, at(50, 17), into, true), 9);
    }
    const tarn = at(28, 28);
    const over = findSeaPath(world, at(50, 17), tarn, { karvi: true });
    expect(over?.portages).toEqual([0]);
    if (over !== null) {
      expectValidPath(world, over, karviPassable, (a, b) => world.portageAt[a] === 0 && world.portageAt[b] === 0);
      expect(over.cost).toBeCloseTo(referenceSeaCost(world, at(50, 17), tarn, true), 9);
    }
  });

  it('respects ice, cost hooks, cost fields, the shoal penalty and the expansion cap', () => {
    const west = at(10, 25);
    const east = at(50, 25);
    const ice = iceBlockedZones(world, 0, 5);
    expect(findSeaPath(world, west, east, { blockedZones: ice })).toBeNull();
    expect(findSeaPath(world, west, at(10, 2), { blockedZones: ice })).not.toBeNull();
    // Close the northern channel with a hook: the route must pass south of the mainland.
    const closeNorth: SeaPathOptions['cost'] = (to) => (cellXY(world, to)[1] < 5 ? Infinity : 1);
    const south = findSeaPath(world, at(10, 8), at(50, 8), { cost: closeNorth });
    expect(south?.cells.some((c) => cellXY(world, c)[1] >= 35)).toBe(true);
    // A cost field doubles every step.
    const field = new Float64Array(world.size).fill(2);
    const plain = findSeaPath(world, west, east);
    const doubled = findSeaPath(world, west, east, { costField: field });
    expect(doubled?.cost).toBeCloseTo((plain?.cost ?? 0) * 2, 9);
    // The shoal penalty makes coast-hugging dearer but never cheaper.
    const shoal = findSeaPath(world, west, east, { shoalPenalty: 3 });
    expect((shoal?.cost ?? 0) >= (plain?.cost ?? 0)).toBe(true);
    expect(findSeaPath(world, west, east, { maxExpansions: 5 })).toBeNull();
  });

  it('applies a per-zone directional (wind) table', () => {
    // Zone 0 (west): sailing east (dir 0) is cheap; every other heading is dear.
    const table = new Float64Array(world.seaZones.length * 8).fill(3);
    table[0] = 1;
    const hook = zoneDirectionCost(world, table);
    expect(hook(at(5, 5), at(4, 5), 0)).toBe(1);
    expect(hook(at(5, 5), at(4, 5), 4)).toBe(3);
    expect(hook(at(36, 17), at(37, 17), 4)).toBe(1); // river: fallback
    const path = findSeaPath(world, at(2, 25), at(15, 25), { cost: hook });
    expect(path?.cost).toBeCloseTo(13, 9);
  });

  it('rejects bad endpoints', () => {
    expect(findSeaPath(world, at(25, 10), at(5, 5))).toBeNull(); // land start
    expect(findSeaPath(world, -1, at(5, 5))).toBeNull();
    expect(findSeaPath(world, at(5, 5), world.size)).toBeNull();
    expect(findSeaPath(world, 1.5, at(5, 5))).toBeNull();
    const self = findSeaPath(world, at(5, 5), at(5, 5));
    expect(self).toMatchObject({ cells: [at(5, 5)], cost: 0, length: 0 });
  });

  it('is not re-entrant from a cost hook', () => {
    const hook: SeaPathOptions['cost'] = () => {
      findSeaPath(world, at(1, 1), at(2, 2));
      return 1;
    };
    expect(() => findSeaPath(world, at(10, 25), at(12, 25), { cost: hook })).toThrow(/re-entrant/);
    // The scratch is released afterwards.
    expect(findSeaPath(world, at(10, 25), at(12, 25))).not.toBeNull();
  });
});

describe('land paths', () => {
  /** A private copy of the fixture world whose terrain the test may paint. */
  function paintable(): StaticWorld {
    const w = buildStaticWorld(makeTestGeography());
    return w;
  }

  it('follows terrain speeds and roads optimally (brute-force check)', () => {
    const w = paintable();
    // A forest belt and a mountain wall with a gap.
    for (let y = 6; y < 34; y++) for (let x = 24; x < 26; x++) if (w.kind[at(x, y)] === CELL_LAND) w.terrain[at(x, y)] = TERRAIN_FOREST;
    for (let x = 20; x < 40; x++) if (x !== 37 && w.kind[at(x, 22)] === CELL_LAND) w.terrain[at(x, 22)] = TERRAIN_MOUNTAIN;
    const rnd = sequence(11);
    const land: number[] = [];
    for (let i = 0; i < w.size; i++) if (w.kind[i] === CELL_LAND && w.terrain[i] !== TERRAIN_MOUNTAIN && w.landComponent[i] === w.landComponent[at(30, 8)]) land.push(i);
    for (let k = 0; k < 30; k++) {
      const a = land[Math.floor(rnd() * land.length)] as number;
      const b = land[Math.floor(rnd() * land.length)] as number;
      const path = findLandPath(w, a, b, { speeds: NO_MOUNTAINS });
      const ref = referenceLandCost(w, a, b, NO_MOUNTAINS);
      expect(path?.cost ?? Infinity).toBeCloseTo(ref, 9);
      if (path !== null) {
        expectValidPath(w, path, (i) => w.kind[i] === CELL_LAND && w.terrain[i] !== TERRAIN_MOUNTAIN);
      }
    }
  });

  it('blocks mountains unless given a speed, and never crosses water', () => {
    const w = paintable();
    for (let x = 20; x < 40; x++) if (w.kind[at(x, 22)] === CELL_LAND) w.terrain[at(x, 22)] = TERRAIN_MOUNTAIN;
    const north = at(30, 8);
    const south = at(30, 32);
    expect(findLandPath(w, north, south, { speeds: NO_MOUNTAINS })).toBeNull();
    const slow = findLandPath(w, north, south, { speeds: { ...NO_MOUNTAINS, mountain: 0.2 } });
    expect(slow).not.toBeNull();
    expect(slow?.cells.some((c) => w.terrain[c] === TERRAIN_MOUNTAIN)).toBe(true);
    expect(findLandPath(w, north, at(10, 17))).toBeNull(); // the islet
    expect(findLandPath(w, north, at(30, 16))).toBeNull(); // a lake cell
  });

  it('prefers the road at road speed', () => {
    const w = paintable();
    const path = findLandPath(w, at(22, 6), at(22, 33));
    expect(path?.cells.every((c) => w.road[c] === ROAD_IMPERIAL)).toBe(true);
    expect(path?.cost).toBeCloseTo(27 / BUNDLED_LAND_SPEEDS.road, 9);
    expect(w.terrain[at(22, 20)]).toBe(TERRAIN_PLAIN);
  });
});

describe('sea lanes', () => {
  it('joins every port with nominal travel days, karvi-only through rivers', () => {
    const g = world.lanes;
    expect(g.nodes).toEqual(['westport', 'eastport', 'lakeside']);
    const westEast = g.lanes.find((l) => l.a === 0 && l.b === 1);
    expect(westEast).toBeDefined();
    expect(westEast?.karviOnly).toBe(false);
    expect(westEast?.days).toBeCloseTo((westEast?.km ?? 0) / 100, 9);
    const toLake = g.lanes.filter((l) => l.b === 2 || l.a === 2);
    expect(toLake.length).toBeGreaterThan(0);
    expect(toLake.every((l) => l.karviOnly)).toBe(true);
    const days = laneDaysFrom(g, 0);
    expect(days[1]).toBeGreaterThan(0);
    expect(days[2]).toBe(Infinity);
    const karviDays = laneDaysFrom(g, 0, true);
    expect(Number.isFinite(karviDays[2])).toBe(true);
    const route = laneRoute(g, 0, 2, true);
    expect(route?.nodes[0]).toBe(0);
    expect(route?.nodes[route.nodes.length - 1]).toBe(2);
    expect(route?.days).toBeCloseTo(karviDays[2] as number, 9);
    expect(laneRoute(g, 0, 2, false)).toBeNull();
    // The lane length approximates the true water distance (flood distance ≥ chamfer shortest path).
    const sea = findSeaPath(world, portOf(world, 'westport')?.cell ?? -1, portOf(world, 'eastport')?.cell ?? -1);
    expect((westEast?.cells ?? 0) >= (sea?.length ?? Infinity) * 0.98).toBe(true);
    expect((westEast?.cells ?? 0) <= (sea?.length ?? 0) * 1.1).toBe(true);
  });
});

describe('determinism', () => {
  it('builds identical worlds from equal geographies', () => {
    const a = buildStaticWorld(makeTestGeography());
    const b = buildStaticWorld(makeTestGeography());
    for (const key of ['kind', 'terrain', 'elevation', 'road', 'river', 'riverOf', 'lakeOf', 'regionOf', 'provinceOf', 'zoneOf', 'coastDist', 'nav', 'karviComponent'] as const) {
      expect(Array.from(a[key])).toEqual(Array.from(b[key]));
    }
    expect(JSON.stringify(a.ports)).toBe(JSON.stringify(b.ports));
    expect(JSON.stringify(a.lanes)).toBe(JSON.stringify(b.lanes));
    expect(JSON.stringify(a.provinces)).toBe(JSON.stringify(b.provinces));
  });
});

describe('spatial validation', () => {
  it('accepts the fixture', () => {
    const { report } = validateGeographyFull(geo);
    expect(report.errors).toEqual([]);
  });

  it('reports misplaced settlements, sites, anchors and broken water', () => {
    const raw = testRawGeography();
    const packs = raw.packs as unknown as Record<string, { provinces: { anchor: number[] }[]; settlements: Record<string, unknown>[]; sites: Record<string, unknown>[] }>;
    const home = packs.homelands as (typeof packs)['homelands'];
    (home.settlements[0] as Record<string, unknown>).pos = [15.5, 10.5]; // in the sea
    (home.settlements[1] as Record<string, unknown>).provinceId = 'northMark'; // wrong province
    (home.settlements[2] as Record<string, unknown>).pos = [30.5, 10.5]; // too far from the lake for a river port
    home.settlements.push({ id: 'inland', name: 'Inland', provinceId: 'southMark', tier: 'village', culture: 'skarn', faith: 'oldways', pos: [20.5, 30.5], coastal: false });
    home.sites.push({ id: 'drowned', name: 'the Drowned Hall', kind: 'wreck', pos: [5.5, 30.5] });
    (home.provinces[1] as { anchors?: number[][] }).anchors = [[45.5, 30.5]];
    const base = raw.base as { portages: { from: number[] }[] };
    (base.portages[0] as { from: number[] }).from = [35.5, 9.5]; // no water within 4 cells
    const g = parseGeography(raw);
    const w = buildStaticWorld(g);
    const { errors } = validateWorld(w);
    const text = errors.join('\n');
    expect(text).toMatch(/settlement 'westport' .*in the sea/);
    expect(text).toMatch(/settlement 'eastport' .*lies in 'southMark', not 'northMark'/);
    expect(text).toMatch(/settlement 'lakeside' .*no navigable river\/lake cell/);
    expect(text).toMatch(/settlement 'inland' .*flagged inland but only 1\.0 cells from the sea/);
    expect(text).toMatch(/site 'drowned' .*out to sea/);
    expect(text).toMatch(/province 'southMark': extra anchor \[45\.5, 30\.5\] is in the sea/);
    expect(text).toMatch(/portage 'drag'/);
  });
});
