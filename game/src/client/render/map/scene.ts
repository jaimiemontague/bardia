/**
 * The map scene (pure): what the chart shows, extracted from the frozen GameState and the geography pack.
 *
 * Read defensively: the world, weather and expeditions modules are being built in parallel, so every slice may be
 * empty or carry fields this code does not know yet. Settlements come from GameState (positions in cells) merged
 * with the geography pack's settlements, plus — while the region packs are still being authored — each colonized
 * province's planned capital at its anchor (marked `synthetic`, an authoring aid that disappears as soon as a real
 * settlement stands within a few leagues).
 */
import { icePeriodCovers, type SettlementDef } from '@content/world';
import type { CultureId, FaithId, SettlementTierId } from '@content/schemas/ids';
import { season, toCalendar } from '@sim/core/time';
import type { Army, Faction, Fleet, GameState, Settlement, StormCell } from '@sim/core/state';
import { CELL_SEA, type StaticWorld } from '@sim/modules/world/map/index';
import { CHART, DEFAULT_PALETTE, type MapPalette } from './colors';
import { knowledgeAt } from './knowledge';
import {
  KNOW_UNKNOWN,
  type BandMarker,
  type FleetIconKind,
  type FleetMarker,
  type MapScene,
  type SettlementMarker,
  type SiteMarker,
  type StormMarker,
  type StormSeverity,
  type Vec2,
  type WindSample,
} from './types';

export interface SceneOptions {
  palette?: MapPalette;
  /** Knowledge levels (null: everything charted). Hides other houses' fleets and storms over unknown waters. */
  knowledge?: Uint8Array | null;
  /** Dev "reveal map": show every fleet and every geography site. */
  revealAll?: boolean;
  /** Show planned province capitals not yet authored as settlements (default true). */
  plannedCapitals?: boolean;
  /** Nominal fleet speed for ETA estimates (default: the geography's lanes.nominalKmPerDay). */
  kmPerDay?: number;
}

const TIER_RANK: Readonly<Record<SettlementTierId, number>> = {
  hamlet: 0,
  village: 1,
  cloister: 1,
  templeStead: 1,
  fortress: 2,
  town: 2,
  emporium: 3,
  city: 3,
  capital: 4,
};

/** Importance rank of a settlement tier (labels, declutter, province ownership). */
export function tierRank(tier: SettlementTierId): number {
  return TIER_RANK[tier] ?? 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finitePos(p: unknown): Vec2 | null {
  if (!isRecord(p)) return null;
  const x = p.x;
  const y = p.y;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function cellOf(world: StaticWorld, p: Vec2): number {
  const x = Math.floor(p[0]);
  const y = Math.floor(p[1]);
  return x < 0 || y < 0 || x >= world.width || y >= world.height ? -1 : y * world.width + x;
}

/** True when a position plausibly marks a real place on the chart (on land, or a coast within 3 cells). */
function onChart(world: StaticWorld, p: Vec2): boolean {
  const c = cellOf(world, p);
  if (c < 0) return false;
  return world.kind[c] !== CELL_SEA || world.coastDist[c]! <= 3;
}

function values<T>(rec: unknown): T[] {
  return isRecord(rec) ? (Object.values(rec) as T[]) : [];
}

/** Banner colour of a faction: its colour index into the palette, else a stable hash of its id. */
export function factionColor(f: Pick<Faction, 'id' | 'colorIndex'> | undefined, palette: MapPalette, playerFactionId: string | null): number {
  if (!f) return palette.neutral;
  if (f.id === playerFactionId) return CHART.rubric;
  const n = palette.factions.length;
  if (typeof f.colorIndex === 'number' && Number.isFinite(f.colorIndex)) return palette.factions[((Math.floor(f.colorIndex) % n) + n) % n] ?? palette.neutral;
  let h = 0;
  for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) >>> 0;
  return palette.factions[h % n] ?? palette.neutral;
}

/** Compass bearing (0 = north, 90 = east) from a to b (y grows southward), or null for a zero vector. */
export function bearing(a: Vec2, b: Vec2): number | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Cumulative days to each waypoint at `kmPerDay` (cells × cellKm). */
export function routeLegDays(pos: Vec2, route: readonly Vec2[], cellKm: number, kmPerDay: number): number[] {
  const out: number[] = [];
  let prev = pos;
  let km = 0;
  for (const p of route) {
    km += Math.hypot(p[0] - prev[0], p[1] - prev[1]) * cellKm;
    out.push(kmPerDay > 0 ? km / kmPerDay : Infinity);
    prev = p;
  }
  return out;
}

const INTENT_ICON: Readonly<Record<string, FleetIconKind>> = {
  trade: 'merchant',
  transfer: 'merchant',
  raid: 'raider',
  patrol: 'patrol',
  expedition: 'war',
  envoy: 'envoy',
  muster: 'muster',
  colony: 'colony',
};

/** Icon kind for a fleet (own fleets show the expedition longship). */
export function fleetIconKind(fleet: Pick<Fleet, 'intent'>, isPlayer: boolean): FleetIconKind {
  if (isPlayer) return 'expedition';
  return (fleet.intent && INTENT_ICON[fleet.intent]) || 'patrol';
}

function stormSeverity(v: unknown): StormSeverity {
  return v === 'minor' || v === 'severe' ? v : 'moderate';
}

/** Storm markers with forecast styling and a 12/24/48 h track. */
export function stormMarkers(storms: readonly StormCell[], hour: number): StormMarker[] {
  const out: StormMarker[] = [];
  for (const s of storms) {
    if (!isRecord(s)) continue;
    const pos = finitePos(s.pos);
    if (!pos) continue;
    const vel = finitePos(s.velocity) ?? [0, 0];
    const until = typeof s.untilHour === 'number' ? s.untilHour : hour + 48;
    if (until < hour) continue;
    const rec = s as unknown as Record<string, unknown>;
    const start = [rec.startHour, rec.fromHour, rec.formsAtHour, rec.arrivesHour].find((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const hoursAhead = start !== undefined && start > hour ? start - hour : 0;
    const forecast = rec.forecast === true || hoursAhead > 0;
    const track: Vec2[] = [];
    for (const h of [12, 24, 48]) {
      if (hour + h > until) break;
      track.push([pos[0] + vel[0] * h, pos[1] + vel[1] * h]);
    }
    out.push({
      id: typeof s.id === 'string' ? s.id : `storm${out.length}`,
      pos,
      radius: typeof s.radius === 'number' && s.radius > 0 ? s.radius : 6,
      severity: stormSeverity(s.severity),
      velocity: vel,
      untilHour: until,
      forecast,
      hoursAhead,
      track,
    });
  }
  return out;
}

/** Wind per sea zone: live weather when the weather module provides it, else the zone's seasonal prevailing wind. */
export function windSamples(world: StaticWorld, state: Pick<GameState, 'weather'> | null, hour: number): WindSample[] {
  const zones = isRecord(state?.weather) && isRecord(state?.weather.zones) ? state!.weather.zones : {};
  const s = season(hour);
  const cal = toCalendar(hour);
  return world.geo.seaZones.map((z, i) => {
    const live = Object.hasOwn(zones, z.id) ? zones[z.id] : undefined;
    if (isRecord(live) && typeof live.windDir === 'number') {
      return { zoneIndex: i, fromDeg: ((live.windDir % 360) + 360) % 360, strength: live.windStr ?? 'fresh', fog: live.fog === true, ice: live.ice === true, source: 'live' } satisfies WindSample;
    }
    const w = z.winds[s];
    const ice = z.ice.some((p) => icePeriodCovers(p, cal.monthIndex, cal.day));
    return { zoneIndex: i, fromDeg: w.fromDeg, strength: w.strength, fog: false, ice, source: 'prevailing' } satisfies WindSample;
  });
}

function geoSettlementMarker(world: StaticWorld, def: SettlementDef): SettlementMarker {
  const cell = cellOf(world, def.pos);
  const prov = def.provinceId && Object.hasOwn(world.index.province, def.provinceId) ? world.geo.provinces[world.index.province[def.provinceId]!] : undefined;
  return {
    key: `g:${def.id}`,
    name: def.name,
    tier: def.tier,
    culture: def.culture,
    faith: def.faith,
    pos: def.pos,
    cell,
    provinceIndex: cell >= 0 ? world.provinceOf[cell]! : -1,
    geoId: def.id,
    isPlayer: false,
    isHome: false,
    isProvinceCapital: prov?.capital !== null && prov?.capital !== undefined && prov.capital.toLowerCase() === def.name.toLowerCase(),
    coastal: def.coastal,
    synthetic: false,
  };
}

/** Builds the scene. Pure; `state` may be null (geography only). */
export function buildMapScene(world: StaticWorld, state: GameState | null, opts: SceneOptions = {}): MapScene {
  const palette = opts.palette ?? DEFAULT_PALETTE;
  const hour = typeof state?.time?.hour === 'number' ? state.time.hour : 0;
  const playerFactionId = state?.player?.factionId ?? null;
  const knowledge = opts.knowledge ?? null;
  const reveal = opts.revealAll === true;
  const factions: Record<string, Faction> = isRecord(state?.factions) ? state!.factions : {};
  const placeholder = state?.flags?.placeholderHome;

  // --- Settlements.
  const settlements: SettlementMarker[] = [];
  const geoByName: Record<string, SettlementDef> = {};
  for (const d of world.geo.settlements) geoByName[d.name.toLowerCase()] = d;
  const usedGeo: Record<string, true> = {};
  for (const s of values<Settlement>(state?.settlements)) {
    if (!isRecord(s) || typeof s.id !== 'string') continue;
    if (s.id === placeholder) continue;
    const pos = finitePos(s.mapPos);
    if (!pos || !onChart(world, pos)) continue;
    const cell = cellOf(world, pos);
    let geo = geoByName[String(s.name).toLowerCase()];
    if (!geo) geo = world.geo.settlements.find((d) => Math.abs(d.pos[0] - pos[0]) <= 1 && Math.abs(d.pos[1] - pos[1]) <= 1);
    if (geo) usedGeo[geo.id] = true;
    const province = state?.provinces && Object.hasOwn(state.provinces, s.provinceId) ? state.provinces[s.provinceId] : undefined;
    settlements.push({
      key: `s:${s.id}`,
      name: s.name,
      tier: s.tier,
      culture: s.culture,
      faith: s.faith,
      pos,
      cell,
      provinceIndex: world.provinceOf[cell]!,
      settlementId: s.id,
      ...(geo ? { geoId: geo.id } : {}),
      factionId: s.factionId,
      economy: s.economy,
      isPlayer: playerFactionId !== null && s.factionId === playerFactionId,
      isHome: state?.player?.capitalId === s.id,
      isProvinceCapital: province?.capitalId === s.id || (geo ? geoSettlementMarker(world, geo).isProvinceCapital : false),
      coastal: s.coastal === true,
      synthetic: false,
    });
  }
  for (const d of world.geo.settlements) {
    if (usedGeo[d.id]) continue;
    settlements.push(geoSettlementMarker(world, d));
  }
  if (opts.plannedCapitals !== false) {
    const names: Record<string, true> = {};
    for (const s of settlements) names[s.name.toLowerCase()] = true;
    const seatProvinces: Record<string, true> = {};
    for (const k of world.geo.kingdoms) seatProvinces[k.seatProvinceId] = true;
    world.geo.provinces.forEach((p, i) => {
      if (!p.capital || !p.colonized || names[p.capital.toLowerCase()]) return;
      const near = settlements.some((s) => Math.abs(s.pos[0] - p.anchor[0]) <= 3 && Math.abs(s.pos[1] - p.anchor[1]) <= 3);
      if (near) return;
      const region = world.geo.regions[world.provinces[i]?.regionIndex ?? -1];
      const culture: CultureId = p.culture ?? region?.culture ?? 'skarn';
      const faith: FaithId = p.faith ?? region?.faith ?? 'oldways';
      const cell = cellOf(world, p.anchor);
      settlements.push({
        key: `c:${p.id}`,
        name: p.capital,
        tier: seatProvinces[p.id] ? 'capital' : 'town',
        culture,
        faith,
        pos: p.anchor,
        cell,
        provinceIndex: i,
        geoId: p.id,
        isPlayer: false,
        isHome: false,
        isProvinceCapital: true,
        coastal: cell >= 0 && world.coastDist[cell]! <= 3,
        synthetic: true,
      });
    });
  }
  settlements.sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || (a.key < b.key ? -1 : 1));

  // --- Sites.
  const sites: SiteMarker[] = [];
  const usedSite: Record<string, true> = {};
  for (const s of values<GameState['sites'][keyof GameState['sites']]>(state?.sites)) {
    if (!isRecord(s) || typeof s.id !== 'string') continue;
    if (!s.revealed && !reveal) continue;
    const pos = finitePos(s.mapPos);
    if (!pos || cellOf(world, pos) < 0) continue;
    const geo = world.geo.sites.find((d) => d.name === s.name || (Math.abs(d.pos[0] - pos[0]) <= 1 && Math.abs(d.pos[1] - pos[1]) <= 1));
    if (geo) usedSite[geo.id] = true;
    sites.push({ key: `s:${s.id}`, name: s.name, kind: s.kind, pos, cell: cellOf(world, pos), siteId: s.id, ...(geo ? { geoId: geo.id } : {}), cleared: s.cleared === true });
  }
  if (reveal) {
    for (const d of world.geo.sites) {
      if (usedSite[d.id]) continue;
      sites.push({ key: `g:${d.id}`, name: d.name, kind: d.kind, pos: d.pos, cell: cellOf(world, d.pos), geoId: d.id, cleared: false });
    }
  }

  // --- Fleets.
  const kmPerDay = opts.kmPerDay ?? world.geo.build.lanes.nominalKmPerDay;
  const fleets: FleetMarker[] = [];
  const expeditionId = state?.player?.expeditionFleetId;
  for (const f of values<Fleet>(state?.fleets)) {
    if (!isRecord(f) || typeof f.id !== 'string') continue;
    // Docked fleets lie in harbour out of sight; the player's own expedition always shows (it sets out from there).
    if (f.mode === 'docked' && expeditionId !== f.id) continue;
    // A march's baggage (no ships) travels with its war-band, which is drawn instead.
    if ((f as unknown as Record<string, unknown>).overland !== undefined) continue;
    const pos = finitePos(f.pos);
    if (!pos) continue;
    const cell = cellOf(world, pos);
    if (cell < 0) continue;
    const isPlayer = playerFactionId !== null && f.ownerId === playerFactionId;
    if (!isPlayer && !reveal && knowledgeAt(knowledge, cell) === KNOW_UNKNOWN) continue;
    const route: Vec2[] = Array.isArray(f.route) ? f.route.map(finitePos).filter((p): p is Vec2 => p !== null) : [];
    const next = route.find((p) => Math.hypot(p[0] - pos[0], p[1] - pos[1]) > 0.25);
    const rec = f as unknown as Record<string, unknown>;
    const heading = next ? bearing(pos, next) : typeof rec.heading === 'number' ? rec.heading : null;
    const speed = typeof rec.speedKmPerDay === 'number' && rec.speedKmPerDay > 0 ? rec.speedKmPerDay : kmPerDay;
    const men = isRecord(f.men) ? Object.values(f.men).reduce<number>((a, n) => a + (typeof n === 'number' ? n : 0), 0) : 0;
    fleets.push({
      id: f.id,
      ownerId: f.ownerId,
      isPlayer,
      isExpedition: expeditionId === f.id,
      pos,
      heading,
      route,
      legDays: routeLegDays(pos, route, world.cellKm, speed),
      mode: f.mode,
      ...(f.intent ? { intent: f.intent } : {}),
      ships: Array.isArray(f.shipIds) ? f.shipIds.length : 0,
      men,
      kind: fleetIconKind(f, isPlayer),
      color: factionColor(factions[f.ownerId] ?? { id: f.ownerId }, palette, playerFactionId),
      rowing: rec.rowing === true,
      steered: typeof rec.steer === 'string',
    });
  }
  fleets.sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer) || (a.id < b.id ? -1 : 1));

  // --- The player's war-bands ashore.
  const bands: BandMarker[] = [];
  for (const a of values<Army>(state?.armies)) {
    if (!isRecord(a) || typeof a.id !== 'string' || playerFactionId === null || a.ownerId !== playerFactionId) continue;
    const pos = finitePos(a.pos);
    if (!pos || cellOf(world, pos) < 0) continue;
    const route: Vec2[] = Array.isArray(a.route) ? a.route.map(finitePos).filter((p): p is Vec2 => p !== null) : [];
    const next = route.find((p) => Math.hypot(p[0] - pos[0], p[1] - pos[1]) > 0.25);
    const squads = Array.isArray(a.squads) ? a.squads : [];
    const rec = a as unknown as Record<string, unknown>;
    bands.push({
      id: a.id,
      isPlayer: true,
      pos,
      heading: next ? bearing(pos, next) : null,
      steered: typeof rec.steer === 'string',
      men: squads.reduce<number>((n, sq) => n + (isRecord(sq) && typeof sq.men === 'number' ? sq.men : 0), 0),
      color: factionColor(factions[a.ownerId] ?? { id: a.ownerId }, palette, playerFactionId),
    });
  }
  bands.sort((a, b) => (a.id < b.id ? -1 : 1));

  // --- Weather.
  const rawStorms = isRecord(state?.weather) && Array.isArray(state?.weather.storms) ? state!.weather.storms : [];
  const storms = stormMarkers(rawStorms, hour).filter((s) => reveal || knowledgeAt(knowledge, cellOf(world, s.pos)) !== KNOW_UNKNOWN || !knowledge);
  const winds = windSamples(world, state, hour);

  // --- Focus.
  const expedition = fleets.find((f) => f.isExpedition) ?? fleets.find((f) => f.isPlayer);
  const home = settlements.find((s) => s.isHome);
  const partyOf = typeof expeditionId === 'string' ? expeditionId : expedition?.id;
  const ashore = partyOf !== undefined ? bands.find((b) => isRecord(state?.expeditions) && (state?.expeditions?.landParties as Record<string, string> | undefined)?.[b.id] === partyOf) : undefined;
  const focus: Vec2 | null = ashore?.pos ?? expedition?.pos ?? home?.pos ?? null;

  return { hour, playerFactionId, settlements, sites, fleets, bands, storms, winds, focus };
}
