/**
 * The network news travels along (design §19.3: "the sea-lane and road graph"): settlements linked
 * by travel-days. Built from state only (module folders may not import the world module's code):
 *
 *   1. `state.worldIndex` (owned by the world module), read structurally when present: an array of
 *      links `{ a, b, days }` under `links` (preferred) or `lanes` (a sea-lane graph). Endpoints may be
 *      settlement ids ('set_…'), indices into `worldIndex.nodes`, or geography ids mapped through
 *      `worldIndex.settlementByGeoId` / `worldIndex.settlementIds` (a record). Overland links from (2)
 *      are added so inland settlements are reached, and a settlement no world link touches keeps
 *      all of its fallback links.
 *   2. Otherwise a positional fallback: every settlement links to its nearest neighbours (by sea when
 *      both are coastal, else overland; tunables.news.network), plus minimum-spanning-tree bridges so
 *      that separate clusters still hear of each other.
 *
 * The network is NOT stored in GameState: it is rebuilt from the settlements (and worldIndex) and
 * memoized, keyed by object identity first and by a positional signature second.
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as NewsTunables } from '@content/schemas/tunables/news';
import { baseState } from '@sim/core/context';
import type { GameState, Settlement, SettlementId } from '@sim/core/state';

/** A settlement-to-settlement link (undirected). */
export interface NewsLink {
  a: SettlementId;
  b: SettlementId;
  days: number;
}

/** The compiled network: settlement ids and a compressed adjacency (CSR). */
export interface NewsNetwork {
  /** Node index → settlement id. */
  readonly ids: readonly SettlementId[];
  /** Settlement id → node index (plain record; own keys only). */
  readonly index: Readonly<Record<string, number>>;
  /** Neighbours of node n are `to[start[n] .. start[n+1]-1]` with lengths `days[…]`. */
  readonly start: Int32Array;
  readonly to: Int32Array;
  readonly days: Float64Array;
  /** 'world' when built from state.worldIndex links, else 'fallback'. */
  readonly source: 'world' | 'fallback';
}

interface NodeInfo {
  id: SettlementId;
  x: number;
  y: number;
  coastal: boolean;
}

type NetworkTunables = NewsTunables['network'];

/** Parameters of the positional fallback. */
export interface FallbackParams extends NetworkTunables {
  landKmPerDay: number;
  cellKm: number;
}

/** Fallback parameters from content. */
export function fallbackParams(balance: Balance, tunables: NewsTunables): FallbackParams {
  return { ...tunables.network, landKmPerDay: balance.overland.kmPerDay, cellKm: balance.sailing.cellKm };
}

/** Travel-days between two settlements in the positional fallback (sea when both are coastal). */
export function fallbackDays(a: NodeInfo, b: NodeInfo, p: FallbackParams, seaAllowed = true): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const km = Math.sqrt(dx * dx + dy * dy) * p.cellKm;
  let days = (km * p.landDetour) / p.landKmPerDay;
  if (seaAllowed && a.coastal && b.coastal) days = Math.min(days, (km * p.seaDetour) / p.seaKmPerDay);
  return Math.max(p.minEdgeDays, days);
}

function nodesOf(settlements: Readonly<Record<string, Settlement>>): NodeInfo[] {
  const out: NodeInfo[] = [];
  for (const id of Object.keys(settlements)) {
    const s = settlements[id];
    if (!s || !s.mapPos || !Number.isFinite(s.mapPos.x) || !Number.isFinite(s.mapPos.y)) continue;
    out.push({ id: id as SettlementId, x: s.mapPos.x, y: s.mapPos.y, coastal: s.coastal === true });
  }
  return out;
}

/**
 * Positional fallback links: each node's `neighbours` nearest (≤ maxEdgeDays) plus the edges of a
 * minimum spanning tree no longer than `bridgeMaxDays`. With `seaAllowed = false` only overland
 * links are produced. O(n²) time, O(n) memory.
 */
export function fallbackLinks(nodes: readonly NodeInfo[], p: FallbackParams, seaAllowed = true): NewsLink[] {
  const n = nodes.length;
  const links: NewsLink[] = [];
  if (n < 2) return links;
  const k = Math.min(p.neighbours, n - 1);
  const bestIdx = new Int32Array(k);
  const bestDays = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const a = nodes[i] as NodeInfo;
    let filled = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = fallbackDays(a, nodes[j] as NodeInfo, p, seaAllowed);
      if (filled < k) {
        let pos = filled++;
        while (pos > 0 && (bestDays[pos - 1] as number) > d) {
          bestDays[pos] = bestDays[pos - 1] as number;
          bestIdx[pos] = bestIdx[pos - 1] as number;
          pos--;
        }
        bestDays[pos] = d;
        bestIdx[pos] = j;
      } else if (d < (bestDays[k - 1] as number)) {
        let pos = k - 1;
        while (pos > 0 && (bestDays[pos - 1] as number) > d) {
          bestDays[pos] = bestDays[pos - 1] as number;
          bestIdx[pos] = bestIdx[pos - 1] as number;
          pos--;
        }
        bestDays[pos] = d;
        bestIdx[pos] = j;
      }
    }
    for (let m = 0; m < filled; m++) {
      const d = bestDays[m] as number;
      if (d <= p.maxEdgeDays) links.push({ a: a.id, b: (nodes[bestIdx[m] as number] as NodeInfo).id, days: d });
    }
  }
  // Prim's minimum spanning tree over the complete graph: bridges between clusters.
  const inTree = new Uint8Array(n);
  const dist = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  dist[0] = 0;
  for (let step = 0; step < n; step++) {
    let u = -1;
    let best = Infinity;
    for (let v = 0; v < n; v++) {
      if (!inTree[v] && (dist[v] as number) < best) {
        best = dist[v] as number;
        u = v;
      }
    }
    if (u < 0) break;
    inTree[u] = 1;
    const pu = parent[u] as number;
    if (pu >= 0 && best <= p.bridgeMaxDays) links.push({ a: (nodes[pu] as NodeInfo).id, b: (nodes[u] as NodeInfo).id, days: best });
    const nu = nodes[u] as NodeInfo;
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = fallbackDays(nu, nodes[v] as NodeInfo, p, seaAllowed);
      if (d < (dist[v] as number)) {
        dist[v] = d;
        parent[v] = u;
      }
    }
  }
  return links;
}

type Rec = Readonly<Record<string, unknown>>;
function rec(v: unknown): Rec | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

/**
 * Links read from `state.worldIndex` (see the file header for the accepted shapes), or undefined
 * when it provides none. Links whose endpoints do not resolve to settlements, or whose length is not
 * a positive finite number, are skipped.
 */
export function worldIndexLinks(worldIndex: unknown, settlements: Readonly<Record<string, unknown>>): NewsLink[] | undefined {
  const wi = rec(worldIndex);
  if (!wi) return undefined;
  // The world module's shape: settlements[id].lanes = [{ to, seaDays, landDays }] (state.worldIndex).
  const perSettlement = rec(wi['settlements']);
  if (perSettlement) {
    const out: NewsLink[] = [];
    for (const id of Object.keys(perSettlement)) {
      const g = rec(perSettlement[id]);
      if (!g || !Array.isArray(g['lanes']) || !Object.hasOwn(settlements, id)) continue;
      for (const entry of g['lanes'] as unknown[]) {
        const l = rec(entry);
        const to = l?.['to'];
        if (!l || typeof to !== 'string' || to <= id || !Object.hasOwn(settlements, to)) continue;
        const sea = typeof l['seaDays'] === 'number' && Number.isFinite(l['seaDays']) ? (l['seaDays'] as number) : Infinity;
        const land = typeof l['landDays'] === 'number' && Number.isFinite(l['landDays']) ? (l['landDays'] as number) : Infinity;
        const days = Math.min(sea, land);
        if (Number.isFinite(days) && days > 0) out.push({ a: id as SettlementId, b: to as SettlementId, days });
      }
    }
    if (out.length > 0) return out;
  }
  const lanesRec = rec(wi['lanes']);
  const raw = Array.isArray(wi['links']) ? wi['links'] : Array.isArray(wi['lanes']) ? wi['lanes'] : Array.isArray(lanesRec?.['lanes']) ? lanesRec?.['lanes'] : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const nodes = Array.isArray(wi['nodes']) ? (wi['nodes'] as unknown[]) : Array.isArray(lanesRec?.['nodes']) ? (lanesRec?.['nodes'] as unknown[]) : undefined;
  const geoMap = rec(wi['settlementByGeoId']) ?? rec(wi['settlementIds']);
  const resolve = (end: unknown, depth = 0): SettlementId | undefined => {
    if (typeof end === 'number' && Number.isInteger(end) && nodes && depth === 0) return resolve(nodes[end], 1);
    if (typeof end !== 'string' || end.length === 0) return undefined;
    if (end.startsWith('set_')) return Object.hasOwn(settlements, end) ? (end as SettlementId) : undefined;
    const mapped = geoMap && Object.hasOwn(geoMap, end) ? geoMap[end] : undefined;
    return typeof mapped === 'string' && mapped.startsWith('set_') && Object.hasOwn(settlements, mapped) ? (mapped as SettlementId) : undefined;
  };
  const out: NewsLink[] = [];
  for (const entry of raw) {
    const l = rec(entry);
    if (!l) continue;
    const a = resolve(l['a']);
    const b = resolve(l['b']);
    const days = l['days'];
    if (a === undefined || b === undefined || a === b || typeof days !== 'number' || !Number.isFinite(days) || days <= 0) continue;
    out.push({ a, b, days });
  }
  return out.length > 0 ? out : undefined;
}

/** Compiles undirected links over `ids` into a CSR network (duplicate pairs keep the shortest link). */
export function compileNetwork(ids: readonly SettlementId[], links: readonly NewsLink[], source: NewsNetwork['source']): NewsNetwork {
  const index: Record<string, number> = {};
  ids.forEach((id, i) => {
    index[id] = i;
  });
  const n = ids.length;
  // Collect directed half-edges, keeping the shortest per ordered pair.
  const best: Record<string, number> = {};
  const pairs: [number, number][] = [];
  for (const l of links) {
    const a = Object.hasOwn(index, l.a) ? index[l.a] : undefined;
    const b = Object.hasOwn(index, l.b) ? index[l.b] : undefined;
    if (a === undefined || b === undefined || a === b) continue;
    for (const [u, v] of [
      [a, b],
      [b, a],
    ] as const) {
      const key = `${u}:${v}`;
      const prev = Object.hasOwn(best, key) ? best[key] : undefined;
      if (prev === undefined) {
        best[key] = l.days;
        pairs.push([u, v]);
      } else if (l.days < prev) best[key] = l.days;
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const start = new Int32Array(n + 1);
  for (const [u] of pairs) start[u + 1] = (start[u + 1] as number) + 1;
  for (let i = 0; i < n; i++) start[i + 1] = (start[i + 1] as number) + (start[i] as number);
  const to = new Int32Array(pairs.length);
  const days = new Float64Array(pairs.length);
  pairs.forEach(([u, v], e) => {
    to[e] = v;
    days[e] = best[`${u}:${v}`] as number;
  });
  return { ids: [...ids], index, start, to, days, source };
}

/** Builds the network for a settlements table (and optional worldIndex), unmemoized. */
export function buildNewsNetwork(settlements: Readonly<Record<string, Settlement>>, worldIndex: unknown, p: FallbackParams): NewsNetwork {
  const nodes = nodesOf(settlements);
  const ids = nodes.map((n) => n.id);
  const world = worldIndexLinks(worldIndex, settlements);
  if (!world) return compileNetwork(ids, fallbackLinks(nodes, p, true), 'fallback');
  const touched: Record<string, true> = {};
  for (const l of world) {
    touched[l.a] = true;
    touched[l.b] = true;
  }
  const links: NewsLink[] = [...world, ...fallbackLinks(nodes, p, false)];
  const isolated = nodes.filter((n) => !Object.hasOwn(touched, n.id));
  if (isolated.length > 0) {
    for (const l of fallbackLinks(nodes, p, true)) if (!Object.hasOwn(touched, l.a) || !Object.hasOwn(touched, l.b)) links.push(l);
  }
  return compileNetwork(ids, links, 'world');
}

function signatureOf(settlements: Readonly<Record<string, Settlement>>): string {
  let sig = '';
  for (const id of Object.keys(settlements)) {
    const s = settlements[id];
    if (!s || !s.mapPos) continue;
    sig += `${id}@${s.mapPos.x},${s.mapPos.y}${s.coastal ? 'c' : ''};`;
  }
  return sig;
}

interface CacheEntry {
  settlementsRef: unknown;
  worldRef: unknown;
  paramsKey: string;
  signature: string;
  net: NewsNetwork;
}
let cache: CacheEntry | undefined;

/**
 * The (memoized) news network for a state or draft. Reads the settlements and worldIndex as they
 * were when the current operation began (`baseState`), so a settlement founded mid-operation joins
 * the network in the next operation.
 */
export function newsNetworkOf(state: GameState, balance: Balance, tunables: NewsTunables): NewsNetwork {
  const settlements = baseState(state.settlements) as Readonly<Record<string, Settlement>>;
  const worldIndex = baseState((state as unknown as { worldIndex?: unknown }).worldIndex);
  const p = fallbackParams(balance, tunables);
  const paramsKey = JSON.stringify(p);
  if (cache && cache.settlementsRef === settlements && cache.worldRef === worldIndex && cache.paramsKey === paramsKey) return cache.net;
  const signature = signatureOf(settlements);
  if (cache && cache.signature === signature && cache.worldRef === worldIndex && cache.paramsKey === paramsKey) {
    cache.settlementsRef = settlements;
    return cache.net;
  }
  const net = buildNewsNetwork(settlements, worldIndex, p);
  cache = { settlementsRef: settlements, worldRef: worldIndex, paramsKey, signature, net };
  return net;
}

/** Drops the memoized network (tests). */
export function clearNewsNetworkCache(): void {
  cache = undefined;
}

/** Shortest travel-days from one settlement to every node (Dijkstra; Infinity = unreachable). */
export function travelDaysFrom(net: NewsNetwork, from: SettlementId): Float64Array {
  const n = net.ids.length;
  const dist = new Float64Array(n).fill(Infinity);
  const src = Object.hasOwn(net.index, from) ? net.index[from] : undefined;
  if (src === undefined) return dist;
  const done = new Uint8Array(n);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let v = 0; v < n; v++) {
      if (!done[v] && (dist[v] as number) < best) {
        best = dist[v] as number;
        u = v;
      }
    }
    if (u < 0) break;
    done[u] = 1;
    for (let e = net.start[u] as number; e < (net.start[u + 1] as number); e++) {
      const v = net.to[e] as number;
      const d = best + (net.days[e] as number);
      if (d < (dist[v] as number)) dist[v] = d;
    }
  }
  return dist;
}
