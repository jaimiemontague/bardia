/**
 * `state.worldIndex`: the static geography digest other modules read (they cannot import the map engine).
 *
 *   settlements[id] = { geoId, provinceId, regionId, cell, port, portKind, seaZoneId, karviOnly, lanes }
 *   provinces[id]   = { geoId, regionId, kingdomId, homeland, colonized, neighbours, seaNeighbours, seaZones, … }
 *   kingdoms / regions / seaZones / homelandProvinceIds / provinceByGeoId / settlementByGeoId
 *
 * Lanes: the nearest settlements by nominal travel days. Sea days come from the map engine's sea-lane graph
 * (ports joined where their water catchments meet; nominal merchant pace, no wind), land days from one
 * multi-source Dijkstra over the land grid with the overland terrain speeds (§8.7), joining settlements whose
 * land catchments touch. Both graphs are then searched from every settlement; targets within
 * `index.laneHorizonDays` (and always the three nearest) are kept, up to `index.maxLanesPerSettlement`.
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as WorldTunables } from '@content/schemas/tunables/world';
import type { GameState, ProvinceId, SettlementId } from '@sim/core/state';
import { cellOfPos, type WorldData } from './data';
import { MinHeap } from './heap';
import {
  buildSeaLanes,
  CELL_LAND,
  CELL_SEA,
  DIR_DX,
  DIR_DY,
  DIR_LEN,
  NAV_KARVI,
  nearestCellWhere,
  nearestLandCell,
  ROAD_NONE,
  TERRAIN_FOREST,
  TERRAIN_HILLS,
  TERRAIN_MARSH,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAIN,
  type LaneNode,
  type StaticWorld,
} from './map';
import type { Lane, ProvinceGeo, SettlementGeo, WorldIndex } from './types';

/** Current index format version. */
export const WORLD_INDEX_VERSION = 1;

/** Harbour of a settlement. */
export interface PortInfo {
  port: number;
  kind: 'sea' | 'river' | null;
  zone: string | null;
  karviOnly: boolean;
}

const NO_PORT: PortInfo = { port: -1, kind: null, zone: null, karviOnly: false };

/**
 * The harbour of a settlement: the map engine's port for geography settlements, otherwise the nearest sea cell
 * of a sizeable sea (coastal) or the nearest navigable river/lake cell (river ports) within `radius`.
 */
export function settlementPort(data: WorldData, geoId: string, cell: number, coastal: boolean, riverPort: boolean, radius: number): PortInfo {
  const { sw } = data;
  const known = geoId !== '' && Object.hasOwn(sw.portOf, geoId) ? sw.ports[sw.portOf[geoId] as number] : undefined;
  if (known) {
    if (known.kind === 'sea') {
      return { port: known.cell, kind: 'sea', zone: known.zone >= 0 ? (data.zoneIds[known.zone] ?? null) : null, karviOnly: !known.seaReachable };
    }
    return { port: known.cell, kind: 'river', zone: null, karviOnly: true };
  }
  if (cell < 0) return NO_PORT;
  const minWater = sw.geo.build.minPortWaterCells;
  if (coastal) {
    let c = nearestCellWhere(sw.width, sw.height, cell, radius, (i) => sw.kind[i] === CELL_SEA && (sw.seaComponentSize[sw.seaComponent[i] as number] ?? 0) >= minWater);
    if (c < 0) c = nearestCellWhere(sw.width, sw.height, cell, radius, (i) => sw.kind[i] === CELL_SEA);
    if (c >= 0) {
      const z = sw.zoneOf[c] as number;
      return { port: c, kind: 'sea', zone: z >= 0 ? (data.zoneIds[z] ?? null) : null, karviOnly: sw.seaComponent[c] !== sw.referenceSeaComponent };
    }
  }
  if (riverPort || coastal) {
    const c = nearestCellWhere(sw.width, sw.height, cell, radius, (i) => sw.kind[i] !== CELL_SEA && ((sw.nav[i] as number) & NAV_KARVI) !== 0);
    if (c >= 0) return { port: c, kind: 'river', zone: null, karviOnly: true };
  }
  return NO_PORT;
}

/** Per-cell overland speed factor (0 = impassable): terrain, roads at least the road speed (§8.7). */
export function landSpeedGrid(sw: StaticWorld, balance: Balance): Float32Array {
  const t = balance.overland.terrain;
  const bySpeed: number[] = [];
  bySpeed[TERRAIN_PLAIN] = t.plain;
  bySpeed[TERRAIN_FOREST] = t.forest;
  bySpeed[TERRAIN_HILLS] = t.hills;
  bySpeed[TERRAIN_MOUNTAIN] = t.mountain ?? 0;
  bySpeed[TERRAIN_MARSH] = t.marsh;
  const out = new Float32Array(sw.size);
  for (let i = 0; i < sw.size; i++) {
    if (sw.kind[i] !== CELL_LAND) continue;
    let s = bySpeed[sw.terrain[i] as number] ?? t.plain;
    if (sw.road[i] !== ROAD_NONE && t.road > s) s = t.road;
    out[i] = s;
  }
  return out;
}

interface Edge {
  to: number;
  days: number;
  karvi: boolean;
}

/** Land catchment graph between settlement land cells: edges whose land catchments touch, in days. */
function landGraph(sw: StaticWorld, speed: Float32Array, cells: readonly number[], kmPerDay: number): Edge[][] {
  const W = sw.width;
  const H = sw.height;
  const size = sw.size;
  const dist = new Float64Array(size).fill(Infinity);
  const label = new Int32Array(size).fill(-1);
  const heap = new MinHeap(4096);
  cells.forEach((c, i) => {
    if (c < 0 || (speed[c] as number) <= 0) return;
    if (label[c] !== -1) return; // two settlements on one cell: the first carries it
    dist[c] = 0;
    label[c] = i;
    heap.push(0, c);
  });
  while (heap.size > 0) {
    const d = heap.peekKey();
    const c = heap.pop();
    if (d > (dist[c] as number)) continue;
    const x = c % W;
    const y = (c - x) / W;
    const sc = speed[c] as number;
    for (let dir = 0; dir < 8; dir++) {
      const nx = x + (DIR_DX[dir] as number);
      const ny = y + (DIR_DY[dir] as number);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      const sn = speed[n] as number;
      if (sn <= 0) continue;
      if ((dir & 1) === 1 && ((speed[y * W + nx] as number) <= 0 || (speed[ny * W + x] as number) <= 0)) continue;
      const nd = d + ((DIR_LEN[dir] as number) * 2) / (sc + sn);
      if (nd < (dist[n] as number)) {
        dist[n] = nd;
        label[n] = label[c] as number;
        heap.push(nd, n);
      }
    }
  }
  const best: Record<string, number> = {};
  for (let c = 0; c < size; c++) {
    const la = label[c] as number;
    if (la < 0) continue;
    const x = c % W;
    const consider = (n: number) => {
      const lb = label[n] as number;
      if (lb < 0 || lb === la) return;
      const step = 2 / ((speed[c] as number) + (speed[n] as number));
      const len = (dist[c] as number) + (dist[n] as number) + step;
      const key = la < lb ? `${la},${lb}` : `${lb},${la}`;
      const prev = best[key];
      if (prev === undefined || len < prev) best[key] = len;
    };
    if (x + 1 < W) consider(c + 1);
    if (c + W < size) consider(c + W);
  }
  const adj: Edge[][] = cells.map(() => []);
  for (const key of Object.keys(best).sort()) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    const days = ((best[key] as number) * sw.cellKm) / kmPerDay;
    (adj[a] as Edge[]).push({ to: b, days, karvi: false });
    (adj[b] as Edge[]).push({ to: a, days, karvi: false });
  }
  // Settlements sharing a cell with an earlier one join it at zero cost.
  cells.forEach((c, i) => {
    if (c < 0) return;
    const carrier = label[c] as number;
    if (carrier >= 0 && carrier !== i) {
      (adj[carrier] as Edge[]).push({ to: i, days: 0, karvi: false });
      (adj[i] as Edge[]).push({ to: carrier, days: 0, karvi: false });
    }
  });
  return adj;
}

/** Dijkstra over a small settlement graph; `allowKarvi` admits karvi-only edges. */
function graphDays(adj: readonly Edge[][], from: number, allowKarvi: boolean): Float64Array {
  const days = new Float64Array(adj.length).fill(Infinity);
  days[from] = 0;
  const heap = new MinHeap(64);
  heap.push(0, from);
  while (heap.size > 0) {
    const d = heap.peekKey();
    const u = heap.pop();
    if (d > (days[u] as number)) continue;
    for (const e of adj[u] as Edge[]) {
      if (e.karvi && !allowKarvi) continue;
      const nd = d + e.days;
      if (nd < (days[e.to] as number)) {
        days[e.to] = nd;
        heap.push(nd, e.to);
      }
    }
  }
  return days;
}

const round1 = (d: number): number => Math.round(d * 10) / 10;

/** Province geography for a state province backed by a geography province. */
function provinceGeo(data: WorldData, index: number, provinceByGeoId: Record<string, ProvinceId>, seaNeighbourCells: number): ProvinceGeo {
  const { sw, geo } = data;
  const info = sw.provinces[index];
  const def = geo.provinces[index];
  if (!info || !def) throw new RangeError(`worldIndex: province index ${index} out of range`);
  const neighbours: ProvinceId[] = [];
  for (const n of info.neighbours) {
    const id = geo.provinces[n]?.id;
    if (id !== undefined && Object.hasOwn(provinceByGeoId, id)) neighbours.push(provinceByGeoId[id] as ProvinceId);
  }
  const seaNeighbours: ProvinceId[] = [];
  const region = geo.regions.find((r) => r.id === def.regionId);
  sw.provinces.forEach((other) => {
    if (other.index === index || info.neighbours.includes(other.index)) return;
    const odef = geo.provinces[other.index];
    if (!odef) return;
    const oregion = geo.regions.find((r) => r.id === odef.regionId);
    const sameSide = odef.regionId === def.regionId || (region?.homeland === true && oregion?.homeland === true);
    if (!sameSide || !other.seaZones.some((z) => info.seaZones.includes(z))) return;
    const dx = other.centroid[0] - info.centroid[0];
    const dy = other.centroid[1] - info.centroid[1];
    if (dx * dx + dy * dy > seaNeighbourCells * seaNeighbourCells) return;
    if (Object.hasOwn(provinceByGeoId, odef.id)) seaNeighbours.push(provinceByGeoId[odef.id] as ProvinceId);
  });
  return {
    geoId: def.id,
    regionId: def.regionId,
    kingdomId: def.kingdomId,
    homeland: def.homeland,
    colonized: def.colonized,
    neighbours,
    seaNeighbours,
    seaZones: info.seaZones.map((z) => data.zoneIds[z] as string),
    coastal: info.coastCells > 0,
    anchor: { x: def.anchor[0], y: def.anchor[1] },
    tags: [...def.tags],
  };
}

/** Geography of one settlement without lanes. */
export function settlementGeo(state: GameState, data: WorldData, id: SettlementId, radius: number): SettlementGeo | undefined {
  const s = state.settlements[id];
  if (!s) return undefined;
  const { sw } = data;
  const geoId = s.geoId ?? '';
  const def = geoId !== '' && Object.hasOwn(data.settlementDefs, geoId) ? data.settlementDefs[geoId] : undefined;
  const cell = cellOfPos(sw, s.mapPos.x, s.mapPos.y);
  const port = settlementPort(data, geoId, cell, s.coastal, def?.riverPort === true || (!s.coastal && def === undefined), radius);
  const province = state.provinces[s.provinceId];
  return {
    geoId,
    provinceId: s.provinceId,
    regionId: province?.regionId ?? '',
    cell,
    port: port.port,
    portKind: port.kind,
    seaZoneId: port.zone,
    karviOnly: port.karviOnly,
    lanes: [],
  };
}

/** Builds the whole index from the state's provinces and settlements (world generation, geography change). */
export function buildWorldIndex(state: GameState, data: WorldData, tun: WorldTunables, balance: Balance): WorldIndex {
  const { sw, geo } = data;
  const t = tun.index;
  const provinceByGeoId: Record<string, ProvinceId> = {};
  const settlementByGeoId: Record<string, SettlementId> = {};
  for (const [pid, p] of Object.entries(state.provinces) as [ProvinceId, (typeof state.provinces)[ProvinceId]][]) {
    if (p.geoId !== undefined && p.neutral !== true) provinceByGeoId[p.geoId] = pid;
  }
  for (const [sid, s] of Object.entries(state.settlements) as [SettlementId, (typeof state.settlements)[SettlementId]][]) {
    if (s.geoId !== undefined && s.geoId !== '') settlementByGeoId[s.geoId] = sid;
  }

  // Provinces.
  const provinces: Record<ProvinceId, ProvinceGeo> = {};
  for (const [pid, p] of Object.entries(state.provinces) as [ProvinceId, (typeof state.provinces)[ProvinceId]][]) {
    if (p.geoId === undefined) continue;
    if (p.neutral === true) {
      provinces[pid] = {
        geoId: p.geoId,
        regionId: p.regionId,
        kingdomId: null,
        homeland: false,
        colonized: true,
        neighbours: [],
        seaNeighbours: [],
        seaZones: [],
        coastal: true,
        anchor: { x: state.settlements[p.capitalId]?.mapPos.x ?? 0, y: state.settlements[p.capitalId]?.mapPos.y ?? 0 },
        tags: ['neutral'],
      };
      continue;
    }
    const index = sw.index.province[p.geoId];
    if (index === undefined) continue;
    provinces[pid] = provinceGeo(data, index, provinceByGeoId, t.seaNeighbourCells);
  }

  // Settlements and their harbours.
  const ids = Object.keys(state.settlements) as SettlementId[];
  const settlements: Record<SettlementId, SettlementGeo> = {};
  for (const id of ids) {
    const g = settlementGeo(state, data, id, t.portSearchRadius);
    if (g) settlements[id] = g;
  }
  for (const id of ids) {
    const g = settlements[id];
    if (g && g.seaZoneId !== null) {
      const p = provinces[g.provinceId];
      if (p && p.tags.includes('neutral') && !p.seaZones.includes(g.seaZoneId)) p.seaZones.push(g.seaZoneId);
    }
  }

  // Sea lanes between harbours.
  const seaNodes: LaneNode[] = [];
  const seaNodeOf: number[] = ids.map(() => -1);
  ids.forEach((id, i) => {
    const g = settlements[id];
    if (g && g.port >= 0) {
      seaNodeOf[i] = seaNodes.length;
      seaNodes.push({ id, cell: g.port });
    }
  });
  const lanes = buildSeaLanes(sw, seaNodes);
  const seaAdj: Edge[][] = seaNodes.map(() => []);
  for (const lane of lanes.lanes) {
    (seaAdj[lane.a] as Edge[]).push({ to: lane.b, days: lane.days, karvi: lane.karviOnly });
    (seaAdj[lane.b] as Edge[]).push({ to: lane.a, days: lane.days, karvi: lane.karviOnly });
  }
  const settlementOfSeaNode: number[] = [];
  seaNodeOf.forEach((node, i) => {
    if (node >= 0) settlementOfSeaNode[node] = i;
  });

  // Land catchments.
  const speed = landSpeedGrid(sw, balance);
  const landCells = ids.map((id) => {
    const g = settlements[id];
    if (!g) return -1;
    if (g.cell >= 0 && (speed[g.cell] as number) > 0) return g.cell;
    const c = nearestLandCell(sw, g.cell, 4);
    return c >= 0 && (speed[c] as number) > 0 ? c : -1;
  });
  const landAdj = landGraph(sw, speed, landCells, balance.overland.kmPerDay);

  // Lanes per settlement.
  const keepNearest = 3;
  ids.forEach((id, i) => {
    const g = settlements[id];
    if (!g) return;
    const sea = new Float64Array(ids.length).fill(Infinity);
    const karvi = new Float64Array(ids.length).fill(Infinity);
    const node = seaNodeOf[i] as number;
    if (node >= 0) {
      const plainDays = graphDays(seaAdj, node, false);
      const karviDays = graphDays(seaAdj, node, true);
      plainDays.forEach((d, n) => {
        const j = settlementOfSeaNode[n];
        if (j !== undefined) sea[j] = d;
      });
      karviDays.forEach((d, n) => {
        const j = settlementOfSeaNode[n];
        if (j !== undefined) karvi[j] = d;
      });
    }
    const land = landCells[i] !== -1 ? graphDays(landAdj, i, false) : new Float64Array(ids.length).fill(Infinity);
    const candidates: { j: number; best: number; lane: Lane }[] = [];
    for (let j = 0; j < ids.length; j++) {
      if (j === i) continue;
      const s = sea[j] as number;
      const k = karvi[j] as number;
      const l = land[j] as number;
      const seaFinite = Number.isFinite(s);
      const useKarvi = Number.isFinite(k) && (!seaFinite || k < s - 1e-9);
      const seaDays = useKarvi ? k : seaFinite ? s : Infinity;
      if (!Number.isFinite(seaDays) && !Number.isFinite(l)) continue;
      const lane: Lane = {
        to: ids[j] as SettlementId,
        seaDays: Number.isFinite(seaDays) ? round1(seaDays) : null,
        landDays: Number.isFinite(l) ? round1(l) : null,
      };
      if (useKarvi) lane.karvi = true;
      candidates.push({ j, best: Math.min(seaDays, l), lane });
    }
    candidates.sort((a, b) => a.best - b.best || a.j - b.j);
    const kept: Lane[] = [];
    for (const c of candidates) {
      if (kept.length >= t.maxLanesPerSettlement) break;
      if (c.best <= t.laneHorizonDays || kept.length < keepNearest) kept.push(c.lane);
    }
    g.lanes = kept;
  });

  // Realms, regions, sea zones.
  const kingdoms: WorldIndex['kingdoms'] = {};
  for (const k of geo.kingdoms) {
    const seat = provinceByGeoId[k.seatProvinceId];
    if (seat === undefined) continue;
    kingdoms[k.id] = {
      name: k.name,
      regionId: k.regionId,
      kind: k.kind,
      homeland: k.homeland,
      seatProvinceId: seat,
      provinceIds: geo.provinces.filter((p) => p.kingdomId === k.id && Object.hasOwn(provinceByGeoId, p.id)).map((p) => provinceByGeoId[p.id] as ProvinceId),
    };
  }
  for (const f of Object.values(state.factions)) {
    if (f.kingdomId !== undefined && Object.hasOwn(kingdoms, f.kingdomId)) {
      const k = kingdoms[f.kingdomId];
      if (k && state.provinces[k.seatProvinceId] && f.homeProvinceId === k.seatProvinceId) k.factionId = f.id;
    }
  }
  const regions: WorldIndex['regions'] = {};
  for (const r of geo.regions) regions[r.id] = { homeland: r.homeland, neutral: r.neutral, provinceIds: [] };
  for (const [pid, p] of Object.entries(provinces) as [ProvinceId, ProvinceGeo][]) {
    const r = regions[p.regionId];
    if (r) r.provinceIds.push(pid);
  }
  const seaZones: WorldIndex['seaZones'] = {};
  geo.seaZones.forEach((z, i) => {
    seaZones[z.id] = { name: z.name, exposure: z.exposure, cells: sw.seaZones[i]?.cells ?? 0, provinceIds: [] };
  });
  for (const [pid, p] of Object.entries(provinces) as [ProvinceId, ProvinceGeo][]) {
    for (const z of p.seaZones) seaZones[z]?.provinceIds.push(pid);
  }
  const homelandProvinceIds = (Object.entries(provinces) as [ProvinceId, ProvinceGeo][]).filter(([, p]) => p.homeland).map(([pid]) => pid);

  return {
    version: WORLD_INDEX_VERSION,
    fingerprint: data.fingerprint,
    width: sw.width,
    height: sw.height,
    cellKm: sw.cellKm,
    settlements,
    provinces,
    regions,
    kingdoms,
    seaZones,
    homelandProvinceIds,
    provinceByGeoId,
    settlementByGeoId,
  };
}

/**
 * Adds a settlement founded during play (colonies) to the index: its harbour and straight-line lane estimates
 * to indexed settlements within the horizon. Returns false if it was already indexed or does not exist.
 */
export function indexNewSettlement(
  draft: GameState,
  data: WorldData,
  tun: WorldTunables,
  balance: Balance,
  id: SettlementId,
  /** Plain views of the settlements and the index (callers indexing many settlements pass one snapshot). */
  view: { settlements: GameState['settlements']; index: WorldIndex['settlements'] } = { settlements: draft.settlements, index: draft.worldIndex?.settlements ?? {} },
): boolean {
  const idx = draft.worldIndex;
  if (!idx || Object.hasOwn(idx.settlements, id)) return false;
  const g = settlementGeo(draft, data, id, tun.index.portSearchRadius);
  if (!g) return false;
  const { sw } = data;
  const t = tun.index;
  const s = view.settlements[id];
  if (!s) return false;
  const comp = g.cell >= 0 ? (sw.landComponent[g.cell] as number) : -1;
  const lanes: { best: number; lane: Lane }[] = [];
  for (const [otherId, other] of Object.entries(view.index) as [SettlementId, SettlementGeo][]) {
    const os = view.settlements[otherId];
    if (!os) continue;
    const dx = os.mapPos.x - s.mapPos.x;
    const dy = os.mapPos.y - s.mapPos.y;
    const km = Math.sqrt(dx * dx + dy * dy) * sw.cellKm * t.fallbackDetour;
    const seaDays = g.port >= 0 && other.port >= 0 ? km / t.fallbackKmPerDay : Infinity;
    const landDays = comp >= 0 && other.cell >= 0 && sw.landComponent[other.cell] === comp ? km / balance.overland.kmPerDay : Infinity;
    const best = Math.min(seaDays, landDays);
    if (!Number.isFinite(best) || best > t.laneHorizonDays) continue;
    lanes.push({
      best,
      lane: { to: otherId, seaDays: Number.isFinite(seaDays) ? round1(seaDays) : null, landDays: Number.isFinite(landDays) ? round1(landDays) : null },
    });
  }
  lanes.sort((a, b) => a.best - b.best || (a.lane.to < b.lane.to ? -1 : 1));
  g.lanes = lanes.slice(0, t.maxLanesPerSettlement).map((l) => l.lane);
  idx.settlements[id] = g;
  if (g.geoId !== '') idx.settlementByGeoId[g.geoId] = id;
  return true;
}
