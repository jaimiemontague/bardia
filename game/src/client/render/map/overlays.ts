/**
 * Map modes (§8.10) as pluggable overlays (pure data builders): political, relations, economy, intel age, trade
 * routes and faith. Each builder turns the scene, the state and the static world into per-province fills (drawn as
 * watercolour washes that strengthen along realm borders), owner keys for realm borders, polylines and a legend
 * whose every colour carries a glyph (§25.7). Colours come from the colour-blind-aware palette.
 *
 * Register another mode with `registerMapMode` (the HUD lists `mapModes()`).
 */
import type { EconomyStateId, FaithId } from '@content/schemas/ids';
import type { Faction, GameState, IntelRecord, Relation } from '@sim/core/state';
import { buildSeaLanes, findSeaPath, nearestNavigableCell, type LaneNode, type SeaLaneGraph, type StaticWorld } from '@sim/modules/world/map/index';
import { decimate, smoothPolyline } from './geometry';
import { CHART, hexColor, mix, type MapPalette } from './colors';
import { factionColor, tierRank } from './scene';
import type { LegendGlyph, LegendItem, MapModeId, MapScene, OverlayData, OverlayLine, ProvinceFill, SettlementMarker, Vec2 } from './types';

/** Inputs of every map-mode builder. */
export interface OverlayInput {
  world: StaticWorld;
  scene: MapScene;
  state: GameState | null;
  palette: MapPalette;
}

export interface MapModeDef {
  id: MapModeId | (string & {});
  /** Locale key of the mode's name. */
  labelKey: string;
  /** Glyph shown on the mode button. */
  icon: 'crown' | 'family' | 'silver' | 'eye' | 'ship' | 'feather' | (string & {});
  build(input: OverlayInput): OverlayData;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------------------------
// Province ownership.

/** Owner of each province: `f:<factionId>` from GameState settlements, else `k:<kingdomId>` from the geography. */
export interface ProvinceOwnership {
  owner: (string | null)[];
  /** Settlements standing in each province (index = geo province index). */
  settlements: SettlementMarker[][];
  /** Name per owner key. */
  names: Record<string, string>;
  /** Banner colour per owner key. */
  colors: Record<string, number>;
  /** Owner key of the player's house (null when none). */
  playerKey: string | null;
}

/** Works out who holds each province (pure). */
export function provinceOwnership(input: OverlayInput): ProvinceOwnership {
  const { world, scene, state, palette } = input;
  const n = world.geo.provinces.length;
  const settlements: SettlementMarker[][] = Array.from({ length: n }, () => []);
  for (const s of scene.settlements) if (s.provinceIndex >= 0 && s.provinceIndex < n) settlements[s.provinceIndex]!.push(s);
  const factions: Record<string, Faction> = isRecord(state?.factions) ? state!.factions : {};
  const playerKey = scene.playerFactionId ? `f:${scene.playerFactionId}` : null;
  const owner: (string | null)[] = [];
  const names: Record<string, string> = {};
  const colors: Record<string, number> = {};
  const cb = palette.mode !== 'none';
  world.geo.provinces.forEach((p, i) => {
    const held = settlements[i]!.filter((s) => s.factionId !== undefined && !s.synthetic);
    if (held.length > 0) {
      const seat = held.find((s) => s.isProvinceCapital) ?? [...held].sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0]!;
      const fid = seat.factionId!;
      const key = `f:${fid}`;
      owner.push(key);
      if (!Object.hasOwn(names, key)) {
        const f = Object.hasOwn(factions, fid) ? factions[fid] : undefined;
        names[key] = f?.name ?? fid;
        colors[key] = fid === scene.playerFactionId ? CHART.gold : factionColor(f ?? { id: fid }, palette, scene.playerFactionId);
      }
      return;
    }
    if (p.kingdomId && Object.hasOwn(world.index.kingdom, p.kingdomId)) {
      const ki = world.index.kingdom[p.kingdomId]!;
      const k = world.geo.kingdoms[ki]!;
      const key = `k:${k.id}`;
      owner.push(key);
      if (!Object.hasOwn(names, key)) {
        names[key] = k.name;
        colors[key] = cb ? (palette.factions[ki % palette.factions.length] ?? palette.neutral) : hexColor(k.color);
      }
      return;
    }
    owner.push(null);
  });
  return { owner, settlements, names, colors, playerKey };
}

function legendForOwners(o: ProvinceOwnership, world: StaticWorld, max = 12): LegendItem[] {
  const area: Record<string, number> = {};
  o.owner.forEach((k, i) => {
    if (k) area[k] = (area[k] ?? 0) + (world.provinces[i]?.landCells ?? 0);
  });
  const keys = Object.keys(area).sort((a, b) => (a === o.playerKey ? -1 : b === o.playerKey ? 1 : (area[b] ?? 0) - (area[a] ?? 0) || (a < b ? -1 : 1)));
  const items: LegendItem[] = keys.slice(0, max).map((k) => ({ label: o.names[k] ?? k, color: o.colors[k] ?? CHART.border, glyph: k === o.playerKey ? 'crown' : 'square' }));
  if (keys.length > max) items.push({ labelKey: 'map.legend.others', vars: { count: keys.length - max }, color: CHART.border, glyph: 'none' });
  if (o.owner.some((k) => k === null)) items.push({ labelKey: 'map.legend.unclaimed', color: CHART.inkSoft, glyph: 'hatch' });
  return items;
}

function baseData(mode: MapModeId, world: StaticWorld, o: ProvinceOwnership): Omit<OverlayData, 'provinceFill' | 'legend'> {
  const ownerColor: Record<string, number> = { ...o.colors };
  return { mode, provinceOwner: o.owner, ownerColor, lines: [], wash: 0.5 };
}

// ---------------------------------------------------------------------------------------------
// Political.

/** Political mode: each realm in its banner colour, the player's in gold. */
export function buildPolitical(input: OverlayInput): OverlayData {
  const o = provinceOwnership(input);
  const fill = o.owner.map((k): ProvinceFill | null => (k ? { color: o.colors[k] ?? CHART.border, alpha: k === o.playerKey ? 0.5 : 0.42 } : { color: CHART.inkSoft, alpha: 0.12, hatch: true }));
  return { ...baseData('political', input.world, o), provinceFill: fill, legend: legendForOwners(o, input.world), wash: 0.8 };
}

// ---------------------------------------------------------------------------------------------
// Relations.

export const STANCE_ORDER = ['own', 'allied', 'friendly', 'neutral', 'hostile', 'war'] as const;
export type StanceBucket = (typeof STANCE_ORDER)[number];

const STANCE_GLYPH: Readonly<Record<StanceBucket, LegendGlyph>> = { own: 'crown', allied: 'ring', friendly: 'dot', neutral: 'square', hostile: 'triangle', war: 'cross' };

/** Colour of each relations bucket in a palette. */
export function stanceColor(b: StanceBucket, p: MapPalette): number {
  switch (b) {
    case 'own':
      return CHART.gold;
    case 'allied':
      return p.info;
    case 'friendly':
      return p.good;
    case 'neutral':
      return p.neutral;
    case 'hostile':
      return p.warn;
    case 'war':
      return p.bad;
  }
}

/** The relation record between two actors (key = sorted `a|b`). */
export function relationBetween(state: GameState | null, a: string, b: string): Relation | undefined {
  if (!state || !isRecord(state.relations) || a === b) return undefined;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  return Object.hasOwn(state.relations, key) ? state.relations[key] : undefined;
}

/** Relations mode: every realm by its stance towards the player's house. */
export function buildRelations(input: OverlayInput): OverlayData {
  const o = provinceOwnership(input);
  const player = input.scene.playerFactionId;
  let known = 0;
  const fill = o.owner.map((k): ProvinceFill | null => {
    if (!k) return null;
    if (k === o.playerKey) return { color: stanceColor('own', input.palette), alpha: 0.5 };
    if (!player || !k.startsWith('f:')) return { color: CHART.inkSoft, alpha: 0.1, hatch: true };
    const rel = relationBetween(input.state, player, k.slice(2));
    const stance = rel?.stance;
    const bucket: StanceBucket = stance === 'war' || stance === 'hostile' || stance === 'friendly' || stance === 'allied' ? stance : 'neutral';
    known++;
    return { color: stanceColor(bucket, input.palette), alpha: 0.46 };
  });
  const legend: LegendItem[] = STANCE_ORDER.map((b) => ({ labelKey: `map.stance.${b}`, color: stanceColor(b, input.palette), glyph: STANCE_GLYPH[b] }));
  legend.push({ labelKey: 'map.legend.unknown', color: CHART.inkSoft, glyph: 'hatch' });
  return { ...baseData('relations', input.world, o), provinceFill: fill, legend, wash: 0.6, ...(known === 0 ? { noteKey: 'map.legend.note.noRelations' } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Economy.

export const ECONOMY_ORDER: readonly EconomyStateId[] = ['ruined', 'destitute', 'poor', 'fair', 'thriving'];
const ECONOMY_GLYPH: Readonly<Record<EconomyStateId, LegendGlyph>> = { ruined: 'cross', destitute: 'triangle', poor: 'square', fair: 'dot', thriving: 'star' };

/** Sequential economy colours (bad → good) from the palette. */
export function economyColor(e: EconomyStateId, p: MapPalette): number {
  switch (e) {
    case 'ruined':
      return p.bad;
    case 'destitute':
      return mix(p.bad, p.warn, 0.55);
    case 'poor':
      return p.warn;
    case 'fair':
      return mix(p.warn, p.good, 0.55);
    case 'thriving':
      return p.good;
  }
}

/** Economy mode: each province by the state of its leading settlement's economy (from GameState). */
export function buildEconomy(input: OverlayInput): OverlayData {
  const o = provinceOwnership(input);
  let any = false;
  const fill = o.settlements.map((list): ProvinceFill | null => {
    const known = list.filter((s) => s.economy !== undefined);
    if (known.length === 0) return list.length > 0 ? { color: CHART.inkSoft, alpha: 0.1, hatch: true } : null;
    any = true;
    const lead = known.find((s) => s.isProvinceCapital) ?? [...known].sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0]!;
    return { color: economyColor(lead.economy!, input.palette), alpha: 0.48 };
  });
  const legend: LegendItem[] = ECONOMY_ORDER.map((e) => ({ labelKey: `map.economy.${e}`, color: economyColor(e, input.palette), glyph: ECONOMY_GLYPH[e] }));
  legend.push({ labelKey: 'map.legend.noData', color: CHART.inkSoft, glyph: 'hatch' });
  return { ...baseData('economy', input.world, o), provinceFill: fill, legend, wash: 0.35, ...(any ? {} : { noteKey: 'map.legend.note.noEconomy' }) };
}

// ---------------------------------------------------------------------------------------------
// Intel age.

export const INTEL_BINS = ['own', 'fresh', 'recent', 'stale', 'old'] as const;
export type IntelBin = (typeof INTEL_BINS)[number];
/** Upper bounds (days) of the fresh / recent / stale bins (§20.4: intel ages). */
export const INTEL_AGE_DAYS = { fresh: 30, recent: 90, stale: 365 } as const;

const INTEL_GLYPH: Readonly<Record<IntelBin, LegendGlyph>> = { own: 'crown', fresh: 'eye', recent: 'dot', stale: 'triangle', old: 'cross' };

export function intelColor(b: IntelBin, p: MapPalette): number {
  switch (b) {
    case 'own':
      return CHART.gold;
    case 'fresh':
      return p.good;
    case 'recent':
      return p.info;
    case 'stale':
      return p.warn;
    case 'old':
      return p.bad;
  }
}

/** The hour of the freshest fact in an intel record, or null. */
export function freshestFactHour(rec: IntelRecord | undefined): number | null {
  if (!rec || !isRecord(rec.facts)) return null;
  let best: number | null = null;
  for (const list of Object.values(rec.facts)) {
    if (!Array.isArray(list)) continue;
    for (const f of list) if (isRecord(f) && typeof f.hour === 'number' && (best === null || f.hour > best)) best = f.hour;
  }
  return best;
}

/** Bin of an intel age in days. */
export function intelBin(ageDays: number): Exclude<IntelBin, 'own'> {
  if (ageDays <= INTEL_AGE_DAYS.fresh) return 'fresh';
  if (ageDays <= INTEL_AGE_DAYS.recent) return 'recent';
  if (ageDays <= INTEL_AGE_DAYS.stale) return 'stale';
  return 'old';
}

/** Intel-age mode: how old the player's freshest intel on each province is. */
export function buildIntelAge(input: OverlayInput): OverlayData {
  const o = provinceOwnership(input);
  const player = input.scene.playerFactionId;
  const intel = isRecord(input.state?.intel) ? input.state!.intel : {};
  let any = false;
  const fill = o.settlements.map((list, i): ProvinceFill | null => {
    if (o.owner[i] !== null && o.owner[i] === o.playerKey) return { color: intelColor('own', input.palette), alpha: 0.45 };
    if (!player) return null;
    let best: number | null = null;
    for (const s of list) {
      if (!s.settlementId) continue;
      const key = `${player}|${s.settlementId}`;
      const h = freshestFactHour(Object.hasOwn(intel, key) ? intel[key] : undefined);
      if (h !== null && (best === null || h > best)) best = h;
    }
    if (best === null) return list.length > 0 ? { color: CHART.inkSoft, alpha: 0.1, hatch: true } : null;
    any = true;
    return { color: intelColor(intelBin((input.scene.hour - best) / 24), input.palette), alpha: 0.46 };
  });
  const legend: LegendItem[] = INTEL_BINS.map((b): LegendItem => {
    const vars: Record<string, number> = b === 'own' ? {} : { days: b === 'old' ? INTEL_AGE_DAYS.stale : INTEL_AGE_DAYS[b] };
    return { labelKey: `map.intel.${b}`, vars, color: intelColor(b, input.palette), glyph: INTEL_GLYPH[b] };
  });
  legend.push({ labelKey: 'map.legend.noIntel', color: CHART.inkSoft, glyph: 'hatch' });
  return { ...baseData('intelAge', input.world, o), provinceFill: fill, legend, wash: 0.3, ...(any ? {} : { noteKey: 'map.legend.note.noIntel' }) };
}

// ---------------------------------------------------------------------------------------------
// Trade routes.

interface LaneCache {
  world: StaticWorld;
  key: string;
  graph: SeaLaneGraph;
  cells: number[];
  paths: (Vec2[] | null)[] | null;
}
let laneCache: LaneCache | null = null;

/**
 * The sea-lane hint graph: the static world's (ports of authored settlements) or, while the region packs are still
 * empty, provisional lanes between the coastal settlements on the chart (planned capitals included). Memoized.
 */
export function laneGraph(world: StaticWorld, settlements: readonly SettlementMarker[]): { graph: SeaLaneGraph; cells: number[] } {
  if (world.lanes.nodes.length > 0) {
    if (!laneCache || laneCache.world !== world || laneCache.key !== '*') laneCache = { world, key: '*', graph: world.lanes, cells: world.ports.map((p) => p.cell), paths: null };
    return { graph: laneCache.graph, cells: laneCache.cells };
  }
  const nodes: LaneNode[] = [];
  for (const s of settlements) {
    if (!s.coastal || s.cell < 0) continue;
    const cell = nearestNavigableCell(world, s.cell, false, 4);
    if (cell >= 0) nodes.push({ id: s.key, cell });
  }
  const key = nodes.map((n) => `${n.id}@${n.cell}`).join(',');
  if (laneCache && laneCache.world === world && laneCache.key === key) return { graph: laneCache.graph, cells: laneCache.cells };
  const graph = buildSeaLanes(world, nodes);
  laneCache = { world, key, graph, cells: nodes.map((n) => n.cell), paths: null };
  return { graph, cells: laneCache.cells };
}

/**
 * Water paths of the lanes (sea A*; karvi lanes may use rivers and portages), smoothed for drawing. Computed once per
 * lane graph (≈1–2 ms per lane) and memoized; a lane without a path falls back to null.
 */
export function lanePaths(world: StaticWorld, settlements: readonly SettlementMarker[]): { graph: SeaLaneGraph; paths: (Vec2[] | null)[] } {
  const { graph, cells } = laneGraph(world, settlements);
  const cache = laneCache!;
  if (cache.paths) return { graph, paths: cache.paths };
  const paths = graph.lanes.map((lane): Vec2[] | null => {
    const a = cells[lane.a];
    const b = cells[lane.b];
    if (a === undefined || b === undefined) return null;
    const path = findSeaPath(world, a, b, { karvi: lane.karviOnly, heuristicWeight: 1.4, maxExpansions: 200_000 });
    if (!path || path.cells.length < 2) return null;
    const flat: number[] = [];
    for (const c of path.cells) flat.push((c % world.width) + 0.5, Math.floor(c / world.width) + 0.5);
    const smooth = smoothPolyline(decimate(flat, 2.5), 2);
    const pts: Vec2[] = [];
    for (let i = 0; i < smooth.length; i += 2) pts.push([smooth[i]!, smooth[i + 1]!]);
    return pts;
  });
  cache.paths = paths;
  return { graph, paths };
}

/** Trade-routes mode: the sea lanes (hints for merchants, news and AI) and the player's trade fleets' routes. */
export function buildTradeRoutes(input: OverlayInput): OverlayData {
  const o = provinceOwnership(input);
  const { world } = input;
  const { graph, paths } = lanePaths(world, input.scene.settlements);
  const lines: OverlayLine[] = [];
  graph.lanes.forEach((lane, i) => {
    const pts = paths[i];
    if (!pts) return;
    lines.push({ points: pts, color: lane.karviOnly ? CHART.river : CHART.seaInk, width: lane.karviOnly ? 1.5 : 1.7, alpha: 0.62, dash: lane.karviOnly ? 'dotted' : 'dashed' });
  });
  for (const f of input.scene.fleets) {
    if (!f.isPlayer || f.intent !== 'trade' || f.route.length === 0) continue;
    lines.push({ points: [f.pos, ...f.route], color: CHART.gold, width: 3, alpha: 0.9 });
  }
  const fill = o.owner.map((k): ProvinceFill | null => (k === o.playerKey && k !== null ? { color: CHART.gold, alpha: 0.22 } : null));
  const legend: LegendItem[] = [
    { labelKey: 'map.trade.seaLane', color: CHART.seaInk, glyph: 'none', line: 'dashed' },
    { labelKey: 'map.trade.riverLane', color: CHART.river, glyph: 'none', line: 'dotted' },
    { labelKey: 'map.trade.yourRoute', color: CHART.gold, glyph: 'none', line: 'solid' },
  ];
  return { ...baseData('tradeRoutes', world, o), provinceFill: fill, lines, legend, wash: 0, ...(graph.lanes.length === 0 ? { noteKey: 'map.legend.note.noLanes' } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Faith.

export const FAITH_ORDER: readonly FaithId[] = ['oldways', 'lantern', 'goldenLantern', 'riverSpirits', 'highSky'];
const FAITH_GLYPH: Readonly<Record<FaithId, LegendGlyph>> = { oldways: 'triangle', lantern: 'diamond', goldenLantern: 'star', riverSpirits: 'wave', highSky: 'ring' };
const FAITH_SLOT: Readonly<Record<FaithId, number>> = { oldways: 5, lantern: 1, goldenLantern: 2, riverSpirits: 6, highSky: 4 };

export function faithColor(f: FaithId, p: MapPalette): number {
  return p.factions[FAITH_SLOT[f]] ?? p.neutral;
}

/** Faith mode: the prevailing faith of each province (its settlements, else the geography's default). */
export function buildFaith(input: OverlayInput): OverlayData {
  const o = provinceOwnership(input);
  const fill = input.world.geo.provinces.map((p, i): ProvinceFill | null => {
    const count: Partial<Record<FaithId, number>> = {};
    for (const s of o.settlements[i] ?? []) count[s.faith] = (count[s.faith] ?? 0) + 1 + tierRank(s.tier);
    let best: FaithId | null = null;
    for (const f of FAITH_ORDER) if ((count[f] ?? 0) > 0 && (best === null || (count[f] ?? 0) > (count[best] ?? 0))) best = f;
    const faith = best ?? p.faith;
    return faith ? { color: faithColor(faith, input.palette), alpha: 0.44 } : null;
  });
  const legend: LegendItem[] = FAITH_ORDER.map((f) => ({ labelKey: `map.faith.${f}`, color: faithColor(f, input.palette), glyph: FAITH_GLYPH[f] }));
  return { ...baseData('faith', input.world, o), provinceFill: fill, legend, wash: 0.4 };
}

// ---------------------------------------------------------------------------------------------
// Registry.

const MODES: MapModeDef[] = [
  { id: 'political', labelKey: 'map.mode.political', icon: 'crown', build: buildPolitical },
  { id: 'relations', labelKey: 'map.mode.relations', icon: 'family', build: buildRelations },
  { id: 'economy', labelKey: 'map.mode.economy', icon: 'silver', build: buildEconomy },
  { id: 'intelAge', labelKey: 'map.mode.intelAge', icon: 'eye', build: buildIntelAge },
  { id: 'tradeRoutes', labelKey: 'map.mode.tradeRoutes', icon: 'ship', build: buildTradeRoutes },
  { id: 'faith', labelKey: 'map.mode.faith', icon: 'feather', build: buildFaith },
];

/** The registered map modes, in HUD order. */
export function mapModes(): readonly MapModeDef[] {
  return MODES;
}

/** Adds (or replaces) a map mode. */
export function registerMapMode(def: MapModeDef): void {
  const i = MODES.findIndex((m) => m.id === def.id);
  if (i >= 0) MODES[i] = def;
  else MODES.push(def);
}

/** Builds the overlay data of a mode (unknown ids fall back to political). */
export function buildOverlay(mode: string, input: OverlayInput): OverlayData {
  const def = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  return def.build(input);
}
