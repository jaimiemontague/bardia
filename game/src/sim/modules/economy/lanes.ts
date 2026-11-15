/**
 * The trade-lane graph between markets (design §11.2 "AI merchant flows move goods along the
 * sea-lane graph"; §11.4 trade routes). Lanes come from the world module's `state.worldIndex`
 * (read defensively: the module may store them as settlement-id pairs or as the map engine's
 * SeaLaneGraph with node indices and geography ids). Markets no sea lane reaches — and every market
 * when no lanes are published yet — are linked by a deterministic proximity fallback: each coastal
 * market to its nearest coastal neighbours, inland ones overland to their nearest markets.
 *
 * Graphs are memoized by a key over the nodes and lanes (pure function of its inputs), so the
 * monthly pass rebuilds nothing while the map is unchanged.
 */
import type { Content } from '@content/index';
import type { MapPos, SettlementId } from '@sim/core/state';
import { isSafeRecordKey } from '@sim/core/keys';
import { distance, isRecord } from './realm';

/** One lane between two graph nodes. */
export interface Lane {
  a: number;
  b: number;
  /** Nominal travel days. */
  days: number;
  /** An overland link (dearer per day for merchants). */
  land: boolean;
}

/** Lanes between market nodes. */
export interface LaneGraph {
  nodes: readonly SettlementId[];
  index: Readonly<Record<string, number>>;
  lanes: readonly Lane[];
  /** Node → indices into `lanes`. */
  adjacency: readonly (readonly number[])[];
}

/** What the graph builder needs to know about a market node. */
export interface LaneNode {
  id: SettlementId;
  pos: MapPos;
  coastal: boolean;
}

interface RawLane {
  a: unknown;
  b: unknown;
  days: unknown;
  km: unknown;
}

function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

type LaneSource = { lanes: unknown[]; nodes: unknown[]; idMap: Record<string, unknown> };

/** One-slot cache of the parsed source by world-index identity (the index is immutable once built). */
let sourceMemo: { wi: unknown; source: LaneSource | undefined; serial: number } | undefined;
let sourceSerial = 0;

/** The parsed lane source of a world index and a serial number that changes when the index object does. */
function cachedLaneSource(worldIndex: unknown): { source: LaneSource | undefined; serial: number } {
  if (sourceMemo && sourceMemo.wi === worldIndex) return sourceMemo;
  sourceMemo = { wi: worldIndex, source: worldLaneSource(worldIndex), serial: ++sourceSerial };
  return sourceMemo;
}

/** Pulls lane, node and id-map candidates out of a world index of unknown shape. */
function worldLaneSource(worldIndex: unknown): LaneSource | undefined {
  if (!isRecord(worldIndex)) return undefined;
  // The world module's shape: settlements[id].lanes = [{ to, seaDays, landDays }] (state.worldIndex).
  const perSettlement = worldIndex.settlements;
  if (isRecord(perSettlement)) {
    const flat: { a: string; b: string; days: number; land: boolean }[] = [];
    for (const id of Object.keys(perSettlement)) {
      const g = perSettlement[id];
      if (!isRecord(g) || !Array.isArray(g.lanes)) continue;
      for (const l of g.lanes) {
        if (!isRecord(l) || typeof l.to !== 'string' || l.to <= id) continue; // each pair once
        const sea = typeof l.seaDays === 'number' && Number.isFinite(l.seaDays) ? l.seaDays : Infinity;
        const land = typeof l.landDays === 'number' && Number.isFinite(l.landDays) ? l.landDays : Infinity;
        const days = Math.min(sea, land);
        if (Number.isFinite(days)) flat.push({ a: id, b: l.to, days, land: land < sea });
      }
    }
    if (flat.length > 0) return { lanes: flat, nodes: [], idMap: {} };
  }
  let lanes: unknown[] | undefined;
  let nodes: unknown[] | undefined;
  for (const key of ['lanes', 'seaLanes', 'laneGraph', 'tradeLanes']) {
    const v = worldIndex[key];
    if (Array.isArray(v)) {
      lanes = v;
      break;
    }
    if (isRecord(v) && Array.isArray(v.lanes)) {
      lanes = v.lanes;
      nodes = asArray(v.nodes);
      break;
    }
  }
  if (!lanes) return undefined;
  nodes ??= asArray(worldIndex.laneNodes) ?? asArray(worldIndex.nodes) ?? [];
  let idMap: Record<string, unknown> = {};
  for (const key of ['settlementIds', 'settlementByGeoId', 'geoToSettlement', 'settlementsByGeo']) {
    const v = worldIndex[key];
    if (isRecord(v)) {
      idMap = v;
      break;
    }
  }
  return { lanes, nodes, idMap };
}

function laneKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

let memoKey: string | undefined;
let memoGraph: LaneGraph | undefined;

/**
 * The lane graph over `nodes` (market settlements in a deterministic order). `worldIndex` is the
 * world module's `state.worldIndex` (any shape; ignored when it publishes no usable lanes).
 */
export function buildLaneGraph(content: Content, nodes: readonly LaneNode[], worldIndex: unknown): LaneGraph {
  const t = content.tunables.economy.flows.fallback;
  const index: Record<string, number> = {};
  nodes.forEach((n, i) => {
    index[n.id] = i;
  });
  const { source, serial } = cachedLaneSource(worldIndex);
  // Memo key: nodes + the published lane source (by identity serial) + the fallback tunables.
  let key = `${t.neighbours}|${t.maxCells}|${t.landNeighbours}|${t.landMaxCells}|${t.seaDetour}|${t.landDetour}|${t.cellKm}|${t.seaKmPerDay}|${t.landKmPerDay};S${source ? serial : 0};`;
  for (const n of nodes) key += `${n.id}:${n.pos.x}:${n.pos.y}:${n.coastal ? 1 : 0},`;
  if (memoKey === key && memoGraph) return memoGraph;

  const best: Record<string, Lane> = {};
  const order: string[] = [];
  const add = (a: number, b: number, days: number, land: boolean) => {
    if (a === b || a < 0 || b < 0 || !(days >= 0)) return;
    const k = laneKey(a, b);
    const prev = best[k];
    if (prev === undefined) {
      best[k] = { a: Math.min(a, b), b: Math.max(a, b), days: Math.max(0.25, days), land };
      order.push(k);
    } else if (days < prev.days) {
      best[k] = { ...prev, days: Math.max(0.25, days), land };
    }
  };

  const connected = new Array<boolean>(nodes.length).fill(false);
  if (source) {
    const resolve = (x: unknown, depth = 0): number => {
      if (typeof x === 'number' && Number.isInteger(x) && depth === 0) return resolve(source.nodes[x], 1);
      if (typeof x !== 'string' || !isSafeRecordKey(x)) return -1;
      if (Object.hasOwn(index, x)) return index[x] as number;
      const mapped = Object.hasOwn(source.idMap, x) ? source.idMap[x] : undefined;
      return typeof mapped === 'string' && Object.hasOwn(index, mapped) ? (index[mapped] as number) : -1;
    };
    for (const raw of source.lanes) {
      if (!isRecord(raw)) continue;
      const lane: RawLane = { a: raw.a ?? raw.from, b: raw.b ?? raw.to, days: raw.days, km: raw.km };
      const a = resolve(lane.a);
      const b = resolve(lane.b);
      if (a < 0 || b < 0) continue;
      let days = typeof lane.days === 'number' && Number.isFinite(lane.days) ? lane.days : NaN;
      if (!Number.isFinite(days) && typeof lane.km === 'number' && Number.isFinite(lane.km)) days = lane.km / t.seaKmPerDay;
      const na = nodes[a];
      const nb = nodes[b];
      if (!Number.isFinite(days) && na && nb) days = (distance(na.pos, nb.pos) * t.seaDetour * t.cellKm) / t.seaKmPerDay;
      add(a, b, days, raw.land === true);
      connected[a] = true;
      connected[b] = true;
    }
  }

  const n = nodes.length;
  // Coastal fallback: every coastal market when the world publishes no lanes, else the coastal
  // markets its lanes miss (a new colony): nearest coastal neighbours.
  const byWorld = connected.slice();
  const worldHasLanes = order.length > 0;
  for (let i = 0; i < n; i++) {
    const ni = nodes[i] as LaneNode;
    if (!ni.coastal || (worldHasLanes && byWorld[i])) continue;
    const near = nearest(nodes, i, t.neighbours, t.maxCells, (j) => (nodes[j] as LaneNode).coastal);
    for (const [j, d] of near) {
      add(i, j, (d * t.seaDetour * t.cellKm) / t.seaKmPerDay, false);
      connected[i] = true;
      connected[j] = true;
    }
  }
  // Overland links for inland markets and any market still unconnected.
  for (let i = 0; i < n; i++) {
    const ni = nodes[i] as LaneNode;
    if (ni.coastal && connected[i]) continue;
    const near = nearest(nodes, i, t.landNeighbours, t.landMaxCells, () => true);
    for (const [j, d] of near) add(i, j, (d * t.landDetour * t.cellKm) / t.landKmPerDay, true);
  }

  const lanes = order.map((k) => best[k] as Lane);
  const adjacency: number[][] = nodes.map(() => []);
  lanes.forEach((lane, li) => {
    adjacency[lane.a]?.push(li);
    adjacency[lane.b]?.push(li);
  });
  memoGraph = { nodes: nodes.map((x) => x.id), index, lanes, adjacency };
  memoKey = key;
  return memoGraph;
}

/** The `k` nearest nodes to `i` within `maxCells` that pass `ok` (ties broken by index). */
function nearest(nodes: readonly LaneNode[], i: number, k: number, maxCells: number, ok: (j: number) => boolean): [number, number][] {
  if (k <= 0) return [];
  const self = nodes[i] as LaneNode;
  const found: [number, number][] = [];
  for (let j = 0; j < nodes.length; j++) {
    if (j === i || !ok(j)) continue;
    const d = distance(self.pos, (nodes[j] as LaneNode).pos);
    if (d > maxCells) continue;
    // Insertion into a short sorted list.
    let p = found.length;
    while (p > 0 && ((found[p - 1] as [number, number])[1] > d || ((found[p - 1] as [number, number])[1] === d && (found[p - 1] as [number, number])[0] > j))) p--;
    if (p >= k) continue;
    found.splice(p, 0, [j, d]);
    if (found.length > k) found.pop();
  }
  return found;
}

/**
 * Shortest travel days between two nodes over the lanes (Dijkstra, O(n²) — used by trade-route
 * commands and the monthly route pass, never per good). Infinity when unreachable.
 */
export function laneDays(graph: LaneGraph, from: number, to: number): number {
  const n = graph.nodes.length;
  if (from < 0 || to < 0 || from >= n || to >= n) return Infinity;
  if (from === to) return 0;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = dist[i] as number;
      if (done[i] === 0 && d < best) {
        best = d;
        u = i;
      }
    }
    if (u < 0) break;
    if (u === to) return best;
    done[u] = 1;
    for (const li of graph.adjacency[u] ?? []) {
      const lane = graph.lanes[li] as Lane;
      const v = lane.a === u ? lane.b : lane.a;
      const nd = best + lane.days;
      if (nd < (dist[v] as number)) dist[v] = nd;
    }
  }
  return dist[to] as number;
}
