/**
 * Sea-lane graph (§8.1 "sea-lanes: the hint graph for AI and news"): nodes are ports; two ports are joined when
 * their water "catchments" touch. One multi-source geodesic flood from every port labels each water cell with its
 * nearest port; wherever two labels meet, the pair becomes a lane whose length is the flood distance through that
 * meeting point (a close upper bound of the true water distance). A sea-only flood gives lanes for every ship; a
 * second flood over karvi water (rivers, navigable lakes, portages) adds karvi-only lanes. Long lanes that a
 * two-leg detour nearly matches are pruned (build.lanes.pruneDetour). Cost: two O(cells) floods.
 */
import { CHAMFER_ORTHO, CellHeap, geodesicFlood, type FloodLink, type GeodesicResult } from './flood';
import { CELL_SEA, NAV_KARVI, type SeaLane, type SeaLaneGraph, type StaticWorld } from './model';

/** A lane-graph node: an id (settlement id) and the water cell its ships use. */
export interface LaneNode {
  id: string;
  cell: number;
}

/** What the lane builder reads from the world. */
export type LaneWorld = Pick<StaticWorld, 'width' | 'height' | 'cellKm' | 'geo' | 'nav' | 'kind' | 'portages'>;

interface Candidate {
  len: number;
  river: boolean;
  portages: number;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Per reached cell: did the path from its port use non-sea water, and how many portages? (memoized walk). */
function pathFlags(world: LaneWorld, flood: GeodesicResult): { river: Uint8Array; portages: Uint16Array } {
  const size = world.width * world.height;
  const river = new Uint8Array(size);
  const portages = new Uint16Array(size);
  const done = new Uint8Array(size);
  const stack: number[] = [];
  for (let start = 0; start < size; start++) {
    if (done[start] === 1 || flood.dist[start] === -1) continue;
    let c = start;
    while (c !== -1 && done[c] === 0) {
      stack.push(c);
      c = flood.from[c] as number;
    }
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const parent = flood.from[cell] as number;
      const own = world.kind[cell] !== CELL_SEA ? 1 : 0;
      if (parent === -1) {
        river[cell] = own;
        portages[cell] = 0;
      } else {
        river[cell] = own | (river[parent] as number) | (flood.viaLink[cell] !== -1 ? 1 : 0);
        portages[cell] = (portages[parent] as number) + (flood.viaLink[cell] !== -1 ? 1 : 0);
      }
      done[cell] = 1;
    }
  }
  return { river, portages };
}

function collectPairs(world: LaneWorld, flood: GeodesicResult, flags: { river: Uint8Array; portages: Uint16Array } | undefined, links: readonly FloodLink[]): Record<string, Candidate> {
  const W = world.width;
  const H = world.height;
  const out: Record<string, Candidate> = {};
  const { label, dist } = flood;
  const consider = (a: number, b: number, extra: number, extraPortages: number) => {
    const la = label[a] as number;
    const lb = label[b] as number;
    if (la < 0 || lb < 0 || la === lb) return;
    const len = (dist[a] as number) + (dist[b] as number) + extra;
    const key = pairKey(la, lb);
    const prev = out[key];
    if (prev !== undefined && prev.len <= len) return;
    out[key] = {
      len,
      river: flags === undefined ? false : flags.river[a] === 1 || flags.river[b] === 1 || extraPortages > 0,
      portages: flags === undefined ? 0 : (flags.portages[a] as number) + (flags.portages[b] as number) + extraPortages,
    };
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (label[c] === -1) continue;
      if (x + 1 < W) consider(c, c + 1, CHAMFER_ORTHO, 0);
      if (y + 1 < H) consider(c, c + W, CHAMFER_ORTHO, 0);
    }
  }
  for (const l of links) consider(l.a, l.b, Math.max(1, Math.round(l.cost)), 1);
  return out;
}

/** Builds the lane graph for the given nodes (usually the ports). Deterministic for a given node order. */
export function buildSeaLanes(world: LaneWorld, nodes: readonly LaneNode[]): SeaLaneGraph {
  const size = world.width * world.height;
  const params = world.geo.build.lanes;
  const cellsPerDay = params.nominalKmPerDay / world.cellKm;
  const lanes: SeaLane[] = [];
  const graph: SeaLaneGraph = { nodes: nodes.map((n) => n.id), lanes, adjacency: nodes.map(() => []) };
  if (nodes.length < 2) return graph;

  // Nodes sharing a cell: the first is the carrier; the others join it with a zero-length lane.
  const carrierAt: Record<string, number> = {};
  const sources: number[] = [];
  const labels: number[] = [];
  const raw: { a: number; b: number; c: Candidate; karviOnly: boolean }[] = [];
  nodes.forEach((n, i) => {
    if (n.cell < 0 || n.cell >= size) return;
    const key = String(n.cell);
    const carrier = carrierAt[key];
    if (carrier !== undefined) raw.push({ a: carrier, b: i, c: { len: 0, river: world.kind[n.cell] !== CELL_SEA, portages: 0 }, karviOnly: world.kind[n.cell] !== CELL_SEA });
    else {
      carrierAt[key] = i;
      sources.push(n.cell);
      labels.push(i);
    }
  });

  // Sea-only flood (every ship).
  const seaMask = new Uint8Array(size);
  for (let i = 0; i < size; i++) seaMask[i] = world.kind[i] === CELL_SEA ? 1 : 0;
  const seaFlood = geodesicFlood(world.width, world.height, seaMask, sources, labels);
  const seaPairs = collectPairs(world, seaFlood, undefined, []);

  // Karvi flood: rivers, navigable lakes and portages.
  const karviMask = new Uint8Array(size);
  for (let i = 0; i < size; i++) karviMask[i] = ((world.nav[i] as number) & NAV_KARVI) !== 0 ? 1 : 0;
  const links: FloodLink[] = world.portages
    .filter((p) => p.valid)
    .map((p) => ({ a: p.fromCell, b: p.toCell, cost: params.portageDays * cellsPerDay * CHAMFER_ORTHO, tag: p.index }));
  const karviFlood = geodesicFlood(world.width, world.height, karviMask, sources, labels, links);
  const karviPairs = collectPairs(world, karviFlood, pathFlags(world, karviFlood), links);

  for (const key of Object.keys(seaPairs).sort()) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    raw.push({ a, b, c: seaPairs[key] as Candidate, karviOnly: false });
  }
  for (const key of Object.keys(karviPairs).sort()) {
    const k = karviPairs[key] as Candidate;
    const s = seaPairs[key];
    const [a, b] = key.split(',').map(Number) as [number, number];
    if (k.river) {
      if (s === undefined || k.len < s.len * 0.85) raw.push({ a, b, c: k, karviOnly: true });
    } else if (s === undefined) raw.push({ a, b, c: k, karviOnly: false });
  }

  // Prune long lanes that a two-leg detour (of compatible vessels) nearly matches.
  const order = raw.map((_, i) => i).sort((i, j) => {
    const ri = raw[i] as (typeof raw)[number];
    const rj = raw[j] as (typeof raw)[number];
    return rj.c.len - ri.c.len || ri.a - rj.a || ri.b - rj.b || Number(ri.karviOnly) - Number(rj.karviOnly);
  });
  const alive = raw.map(() => true);
  const best: Record<string, { len: number; karviOnly: boolean }[]> = {};
  raw.forEach((r) => (best[pairKey(r.a, r.b)] ??= []).push({ len: r.c.len, karviOnly: r.karviOnly }));
  const adj: number[][] = nodes.map(() => []);
  raw.forEach((r, i) => {
    (adj[r.a] as number[]).push(i);
    (adj[r.b] as number[]).push(i);
  });
  const legLen = (u: number, v: number, allowKarvi: boolean): number => {
    let m = Infinity;
    for (const li of adj[u] as number[]) {
      if (!alive[li]) continue;
      const r = raw[li] as (typeof raw)[number];
      if ((r.a === v || r.b === v) && (allowKarvi || !r.karviOnly) && r.c.len < m) m = r.c.len;
    }
    return m;
  };
  for (const li of order) {
    const r = raw[li] as (typeof raw)[number];
    if (r.c.len === 0) continue;
    const allowKarvi = r.karviOnly;
    const limit = params.pruneDetour * r.c.len;
    for (const lj of adj[r.a] as number[]) {
      if (lj === li || !alive[lj]) continue;
      const leg = raw[lj] as (typeof raw)[number];
      if (leg.karviOnly && !allowKarvi) continue;
      if (leg.c.len >= r.c.len) continue;
      const c = leg.a === r.a ? leg.b : leg.a;
      if (c === r.b) continue;
      const second = legLen(c, r.b, allowKarvi);
      if (second < r.c.len && leg.c.len + second <= limit) {
        alive[li] = false;
        break;
      }
    }
  }

  const kept = raw.filter((_, i) => alive[i]).sort((p, q) => p.a - q.a || p.b - q.b || Number(p.karviOnly) - Number(q.karviOnly));
  for (const r of kept) {
    const a = Math.min(r.a, r.b);
    const b = Math.max(r.a, r.b);
    const cells = r.c.len / CHAMFER_ORTHO;
    const km = cells * world.cellKm;
    const lane: SeaLane = {
      index: lanes.length,
      a,
      b,
      cells,
      km,
      days: km / params.nominalKmPerDay + r.c.portages * params.portageDays,
      karviOnly: r.karviOnly,
      portages: r.c.portages,
    };
    lanes.push(lane);
    (graph.adjacency[a] as number[]).push(lane.index);
    (graph.adjacency[b] as number[]).push(lane.index);
  }
  return graph;
}

/** A route through the lane graph. */
export interface LaneRoute {
  /** Node indices from start to goal. */
  nodes: number[];
  /** Lane indices used, in order. */
  lanes: number[];
  days: number;
  km: number;
}

/**
 * Nominal travel days from one node to every node over the lane graph (Infinity if unreachable). `karvi`
 * allows karvi-only lanes.
 */
export function laneDaysFrom(graph: SeaLaneGraph, from: number, karvi = false): Float64Array {
  const n = graph.nodes.length;
  const days = new Float64Array(n).fill(Infinity);
  if (from < 0 || from >= n) return days;
  const heap = new CellHeap(64);
  days[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const d = heap.peekKey();
    const u = heap.pop();
    if (d > (days[u] as number)) continue;
    for (const li of graph.adjacency[u] as number[]) {
      const lane = graph.lanes[li] as SeaLane;
      if (lane.karviOnly && !karvi) continue;
      const v = lane.a === u ? lane.b : lane.a;
      const nd = d + lane.days;
      if (nd < (days[v] as number)) {
        days[v] = nd;
        heap.push(nd, v);
      }
    }
  }
  return days;
}

/** Shortest (fewest nominal days) lane route between two nodes, or null. */
export function laneRoute(graph: SeaLaneGraph, from: number, to: number, karvi = false): LaneRoute | null {
  const n = graph.nodes.length;
  if (from < 0 || to < 0 || from >= n || to >= n) return null;
  const days = new Float64Array(n).fill(Infinity);
  const viaLane = new Int32Array(n).fill(-1);
  const heap = new CellHeap(64);
  days[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const d = heap.peekKey();
    const u = heap.pop();
    if (d > (days[u] as number)) continue;
    if (u === to) break;
    for (const li of graph.adjacency[u] as number[]) {
      const lane = graph.lanes[li] as SeaLane;
      if (lane.karviOnly && !karvi) continue;
      const v = lane.a === u ? lane.b : lane.a;
      const nd = d + lane.days;
      if (nd < (days[v] as number)) {
        days[v] = nd;
        viaLane[v] = li;
        heap.push(nd, v);
      }
    }
  }
  if (!Number.isFinite(days[to] as number)) return null;
  const nodes: number[] = [to];
  const used: number[] = [];
  let km = 0;
  for (let v = to; v !== from; ) {
    const li = viaLane[v] as number;
    const lane = graph.lanes[li] as SeaLane;
    used.push(li);
    km += lane.km;
    v = lane.a === v ? lane.b : lane.a;
    nodes.push(v);
  }
  nodes.reverse();
  used.reverse();
  return { nodes, lanes: used, days: days[to] as number, km };
}
