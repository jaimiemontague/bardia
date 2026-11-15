/**
 * Low-level map geometry: scanline fill, 4-connected tracing, the exact distance transform, fractal coasts that
 * keep shared edges shared, the geodesic flood, component labelling, the cell heap and the value noise.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Point } from '@content/world';
import { CellHeap, components4, geodesicFlood } from './flood';
import { distanceTransform, fillPolygon, fractalize, pointInPolygon, subdivide, traceSegment, warpPoints } from './geometry';
import { fbm, hash2, hashString, valueNoise } from './noise';

describe('fillPolygon', () => {
  it('fills exactly the cells whose centres are inside', () => {
    const cells: string[] = [];
    fillPolygon([1, 1, 4, 1, 4, 3, 1, 3], 10, 10, (y, x0, x1) => {
      for (let x = x0; x < x1; x++) cells.push(`${x},${y}`);
    });
    expect(cells.sort()).toEqual(['1,1', '1,2', '2,1', '2,2', '3,1', '3,2']);
  });

  it('agrees with point-in-polygon for random rings (even-odd)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 })), { minLength: 3, maxLength: 9 }), (raw) => {
        const ring: Point[] = raw.map(([x, y]) => [x / 10 + 0.013, y / 10 + 0.029]);
        const flat = ring.flat();
        const inside = new Uint8Array(24 * 24);
        fillPolygon(flat, 24, 24, (y, x0, x1) => {
          for (let x = x0; x < x1; x++) inside[y * 24 + x] = 1;
        });
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) expect(inside[y * 24 + x] === 1).toBe(pointInPolygon(x + 0.5, y + 0.5, ring));
      }),
      { numRuns: 60, seed: 42 },
    );
  });

  it('clips to the grid', () => {
    let count = 0;
    fillPolygon([-5, -5, 15, -5, 15, 15, -5, 15], 8, 6, (_y, x0, x1) => (count += x1 - x0));
    expect(count).toBe(48);
  });
});

describe('traceSegment', () => {
  it('visits a 4-connected chain from the start cell to the end cell', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 19.99, noNaN: true }), fc.double({ min: 0, max: 19.99, noNaN: true }), fc.double({ min: 0, max: 19.99, noNaN: true }), fc.double({ min: 0, max: 19.99, noNaN: true }), (x0, y0, x1, y1) => {
        const visited: [number, number][] = [];
        traceSegment(x0, y0, x1, y1, 20, 20, (x, y) => visited.push([x, y]));
        expect(visited[0]).toEqual([Math.floor(x0), Math.floor(y0)]);
        expect(visited[visited.length - 1]).toEqual([Math.floor(x1), Math.floor(y1)]);
        for (let k = 1; k < visited.length; k++) {
          const a = visited[k - 1] as [number, number];
          const b = visited[k] as [number, number];
          expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1);
        }
      }),
      { numRuns: 200, seed: 7 },
    );
  });
});

describe('distanceTransform', () => {
  it('equals brute-force Euclidean distance between cell centres', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 15 * 12 - 1 }), { minLength: 1, maxLength: 6 }), (features) => {
        const set = new Uint8Array(15 * 12);
        for (const f of features) set[f] = 1;
        const d = distanceTransform(15, 12, (i) => set[i] === 1);
        for (let i = 0; i < 15 * 12; i++) {
          let best = Infinity;
          for (const f of features) best = Math.min(best, Math.sqrt(((i % 15) - (f % 15)) ** 2 + (Math.floor(i / 15) - Math.floor(f / 15)) ** 2));
          expect(d[i]).toBeCloseTo(best, 4);
        }
      }),
      { numRuns: 40, seed: 3 },
    );
  });

  it('marks grids without features as far', () => {
    const d = distanceTransform(4, 4, () => false);
    expect(Array.from(d).every((v) => v >= 1e9)).toBe(true);
  });
});

describe('fractal coasts and warps', () => {
  it('displace a shared edge identically in both rings and never move vertices', () => {
    const a: Point[] = [[0, 0], [30, 0], [30, 30], [0, 30]];
    const b: Point[] = [[30, 0], [60, 0], [60, 30], [30, 30]]; // shares the edge x = 30, reversed
    const fa = fractalize(a, true, 0.3, 1.4, 99);
    const fb = fractalize(b, true, 0.3, 1.4, 99);
    for (const [i, v] of a.entries()) expect([fa.points[(fa.vertexAt[i] as number) * 2], fa.points[(fa.vertexAt[i] as number) * 2 + 1]]).toEqual(v);
    // Points of a's edge (30,0)→(30,30) and of b's edge (30,30)→(30,0), compared as sets.
    const edge = (f: { points: number[]; vertexAt: number[] }, from: number, to: number): string[] => {
      const out: string[] = [];
      for (let k = f.vertexAt[from] as number; k <= (f.vertexAt[to] as number); k++) out.push(`${(f.points[k * 2] as number).toFixed(9)},${(f.points[k * 2 + 1] as number).toFixed(9)}`);
      return out.sort();
    };
    const ea = edge(fa, 1, 2);
    // In b the shared edge is the closing edge (vertex 3 → vertex 0).
    const closing: string[] = [];
    for (let k = fb.vertexAt[3] as number; k < fb.points.length / 2; k++) closing.push(`${(fb.points[k * 2] as number).toFixed(9)},${(fb.points[k * 2 + 1] as number).toFixed(9)}`);
    const eb = [...closing, `${(30).toFixed(9)},${(0).toFixed(9)}`].sort();
    expect(ea.length).toBeGreaterThan(4);
    expect(ea).toEqual(eb);
  });

  it('subdivide keeps the original vertices and caps segment length', () => {
    const s = subdivide([[0, 0], [10, 0], [10, 3]], false, 1);
    expect(s.vertexAt).toEqual([0, 10, 13]);
    for (let k = 2; k < s.points.length; k += 2) {
      const dx = (s.points[k] as number) - (s.points[k - 2] as number);
      const dy = (s.points[k + 1] as number) - (s.points[k - 1] as number);
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('warps coincident points identically and is a no-op at amplitude 0', () => {
    const pts = [5, 5, 7, 2, 5, 5];
    warpPoints(pts, 1, 2, { amplitude: 3, wavelength: 10, octaves: 3, persistence: 0.5 });
    expect([pts[0], pts[1]]).toEqual([pts[4], pts[5]]);
    const still = [5, 5];
    warpPoints(still, 1, 2, { amplitude: 0, wavelength: 10, octaves: 3, persistence: 0.5 });
    expect(still).toEqual([5, 5]);
  });
});

describe('noise', () => {
  it('is deterministic, bounded and seed-dependent', () => {
    expect(hashString('bardia')).toBe(hashString('bardia'));
    expect(hashString('bardia')).not.toBe(hashString('bardiA'));
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * 0.11, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const f = fbm(i * 1.3, i * 0.7, 9, 20, 5, 0.5);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(valueNoise(2, 3, 9)).toBe(hash2(2, 3, 9) / 4294967296);
    expect(fbm(10.5, 3.25, 1, 16, 4, 0.5)).not.toBe(fbm(10.5, 3.25, 2, 16, 4, 0.5));
  });
});

describe('geodesicFlood', () => {
  /** Brute-force chamfer Dijkstra (5 orthogonal, 7 diagonal, no corner cutting). */
  function bruteForce(w: number, h: number, passable: Uint8Array, sources: number[]): Int32Array {
    const dist = new Int32Array(w * h).fill(-1);
    const done = new Uint8Array(w * h);
    for (const s of sources) if (passable[s] === 1) dist[s] = 0;
    for (;;) {
      let c = -1;
      for (let i = 0; i < w * h; i++) if (done[i] === 0 && (dist[i] as number) >= 0 && (c === -1 || (dist[i] as number) < (dist[c] as number))) c = i;
      if (c === -1) break;
      done[c] = 1;
      const x = c % w;
      const y = Math.floor(c / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (passable[n] !== 1) continue;
          if (dx !== 0 && dy !== 0 && (passable[y * w + nx] !== 1 || passable[ny * w + x] !== 1)) continue;
          const nd = (dist[c] as number) + (dx !== 0 && dy !== 0 ? 7 : 5);
          if (dist[n] === -1 || nd < (dist[n] as number)) dist[n] = nd;
        }
      }
    }
    return dist;
  }

  it('matches a brute-force chamfer Dijkstra and labels each cell by its nearest source', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 144, maxLength: 144 }), fc.array(fc.integer({ min: 0, max: 143 }), { minLength: 1, maxLength: 3 }), (open, sources) => {
        const passable = Uint8Array.from(open.map((o) => (o ? 1 : 0)));
        const r = geodesicFlood(12, 12, passable, sources, sources.map((_, i) => i));
        const ref = bruteForce(12, 12, passable, sources);
        expect(Array.from(r.dist)).toEqual(Array.from(ref));
        for (let i = 0; i < 144; i++) {
          if ((r.dist[i] as number) < 0) {
            expect(r.label[i]).toBe(-1);
            continue;
          }
          // The label is a source at exactly that distance.
          const own = bruteForce(12, 12, passable, [sources[r.label[i] as number] as number]);
          expect(own[i]).toBe(r.dist[i]);
        }
      }),
      { numRuns: 40, seed: 5 },
    );
  });

  it('crosses links and records their tags', () => {
    const passable = new Uint8Array(10).fill(1);
    passable[5] = 0; // a wall splits 0–4 from 6–9
    const r = geodesicFlood(10, 1, passable, [0], [0], [{ a: 4, b: 6, cost: 12, tag: 3 }]);
    expect(r.dist[4]).toBe(20);
    expect(r.dist[6]).toBe(32);
    expect(r.viaLink[6]).toBe(3);
    expect(r.from[6]).toBe(4);
    expect(r.dist[5]).toBe(-1);
  });
});

describe('components4 and CellHeap', () => {
  it('labels 4-connected components in scan order', () => {
    // ##.
    // .#.
    // ..#   → diagonal contact does not connect
    const member = [1, 1, 0, 0, 1, 0, 0, 0, 1];
    const { id, sizes } = components4(3, 3, (i) => member[i] === 1);
    expect(Array.from(id)).toEqual([0, 0, -1, -1, 0, -1, -1, -1, 1]);
    expect(sizes).toEqual([3, 1]);
  });

  it('pops keys in ascending order (ties: smaller cell first)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 1000 })), { maxLength: 300 }), (items) => {
        const heap = new CellHeap(2);
        for (const [k, v] of items) heap.push(k, v);
        const out: [number, number][] = [];
        while (heap.size > 0) {
          const k = heap.peekKey();
          out.push([k, heap.pop()]);
        }
        const sorted = [...items].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        expect(out).toEqual(sorted);
      }),
      { numRuns: 100, seed: 11 },
    );
  });
});
