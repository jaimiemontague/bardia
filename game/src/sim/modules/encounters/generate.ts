/**
 * Who is sighted, and how often (design §8.6, §8.7, §31.4). The daily chance of a sighting at sea is the
 * zone's traffic (world geography) × `sea.trafficMult` × season × fog × hostile shores × fleet size × speed;
 * the kind is drawn from the zone's `encounterMix` (merchant, raider, patrol, fleet) shifted by season and
 * by hostile shores. Ashore, a land party on the march meets outlaws or the local lord's patrols.
 *
 * Everything here is pure apart from the `Rng` it is handed: the system and the tests call the same code.
 */
import type { Content } from '@content/index';
import { getGeography } from '@content/world';
import { baseState } from '@sim/core/context';
import { clamp } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { ArmyId, FactionId, Fleet, FleetId, GameState, GoodId, MapPos, SettlementId, ShipTypeId, TextVars } from '@sim/core/state';
import { season } from '@sim/core/time';
import {
  armyMen,
  bestAt,
  companions,
  encounterOptions,
  fleetKn,
  menTotal,
  moverOf,
  pct,
  safeDefault,
  shipsKn,
  standingWith,
  tollFor,
  tradeDealFor,
  zoneOf,
} from './rules';
import type { EncounterDecisionChoice, EncounterKind, EncounterOption, EncounterParty, EncounterPayloadExt, EncounterShip, EncounterStage } from './types';

type T = Content['tunables']['encounters'];
type SeaKind = 'merchant' | 'patrol' | 'raiders' | 'warfleet';
type LandKind = 'outlaws' | 'landPatrol';
const SEA: readonly SeaKind[] = ['merchant', 'patrol', 'raiders', 'warfleet'];
const LAND: readonly LandKind[] = ['outlaws', 'landPatrol'];

// ---------------------------------------------------------------------------------------------
// Geography.

interface ZoneInfo {
  name: string;
  traffic: number;
  exposure: string;
  mix: Record<SeaKind, number>;
}

let zoneCache: Record<string, ZoneInfo> | undefined;

/** Traffic, exposure and encounter mix of a sea zone (geography; `null` = the tunables' defaults). */
export function zoneInfo(t: T, zoneId: string | null): ZoneInfo {
  if (!zoneCache) {
    const out: Record<string, ZoneInfo> = {};
    for (const z of getGeography().seaZones) {
      out[z.id] = { name: z.name, traffic: z.traffic, exposure: z.exposure, mix: { merchant: z.encounterMix.merchant, patrol: z.encounterMix.patrol, raiders: z.encounterMix.raider, warfleet: z.encounterMix.fleet } };
    }
    zoneCache = out;
  }
  if (zoneId !== null && Object.hasOwn(zoneCache, zoneId)) return zoneCache[zoneId] as ZoneInfo;
  return { name: '', traffic: t.sea.defaultTraffic, exposure: 'coastal', mix: { ...t.sea.defaultMix } };
}

/** Settlements within `radius` cells of `pos`, nearest first: id, lord and squared distance. */
export function nearbySettlements(state: GameState, pos: MapPos, radius: number): { id: SettlementId; factionId: FactionId; d2: number }[] {
  // Positions never change: read them from the operation's base state (no proxies); new settlements from the draft.
  const base = baseState(state.settlements);
  const r2 = radius * radius;
  const out: { id: SettlementId; factionId: FactionId; d2: number }[] = [];
  for (const key of Reflect.ownKeys(state.settlements)) {
    if (typeof key !== 'string') continue;
    const id = key as SettlementId;
    const s = Object.hasOwn(base, id) ? base[id] : state.settlements[id];
    if (!s) continue;
    const d2 = (s.mapPos.x - pos.x) ** 2 + (s.mapPos.y - pos.y) ** 2;
    if (d2 > r2) continue;
    const live = state.settlements[id];
    if (live) out.push({ id, factionId: live.factionId, d2 });
  }
  return out.sort((a, b) => a.d2 - b.d2 || (a.id < b.id ? -1 : 1));
}

/** Share of the settlements near `pos` held by lords hostile to the player, and those lords. */
export function hostileShores(state: GameState, t: T, near: readonly { factionId: FactionId }[]): { share: number; hostile: FactionId[] } {
  const player = state.player.factionId;
  let n = 0;
  let bad = 0;
  const hostile: FactionId[] = [];
  for (const s of near) {
    if (s.factionId === player) continue;
    n++;
    if (standingWith(state, t, s.factionId).hostile) {
      bad++;
      if (!hostile.includes(s.factionId)) hostile.push(s.factionId);
    }
  }
  return { share: n > 0 ? bad / n : 0, hostile };
}

// ---------------------------------------------------------------------------------------------
// How often.

/** Inputs and result of the daily sea roll (exported for tests and the codex). */
export interface SeaChance {
  p: number;
  zoneId: string | null;
  traffic: number;
  hostileShare: number;
  fog: boolean;
  sizeMult: number;
  speedMult: number;
}

/** The daily chance that the expedition sights something at sea (§31.4 × the module's tunables). */
export function seaChance(state: GameState, content: Content, fleet: Fleet, hostileShare: number): SeaChance {
  const t = content.tunables.encounters;
  const zoneId = zoneOf(fleet);
  const info = zoneInfo(t, zoneId);
  const fog = zoneId !== null && Object.hasOwn(state.weather.zones, zoneId) ? state.weather.zones[zoneId]?.fog === true : false;
  const ships = fleet.shipIds.length;
  const sizeMult = Math.min(t.sea.sizeMultMax, 1 + t.sea.sizePerExtraShip * Math.max(0, ships - 1));
  const kn = fleetKn(state, content.balance, fleet);
  const speedMult = clamp(t.sea.refKn / Math.max(0.5, kn), t.sea.speedMult[0], t.sea.speedMult[1]);
  const p = info.traffic * t.sea.trafficMult * t.sea.seasonMult[season(state.time.hour)] * (fog ? t.sea.fogMult : 1) * (1 + t.sea.hostileShoreSlope * hostileShare) * sizeMult * speedMult;
  return { p: Math.min(t.maxPerDay, p), zoneId, traffic: info.traffic, hostileShare, fog, sizeMult, speedMult };
}

/** The daily chance for a land party (marching or camped, in whose land). */
export function landChance(state: GameState, content: Content, marching: boolean, landOwner: FactionId | undefined): number {
  const t = content.tunables.encounters;
  let p = t.land.basePerDay * t.land.seasonMult[season(state.time.hour)] * (marching ? 1 : t.land.idleMult);
  if (landOwner === state.player.factionId) p *= t.land.ownLandMult;
  else if (landOwner !== undefined && standingWith(state, t, landOwner).hostile) p *= t.land.hostileMult;
  return Math.min(t.maxPerDay, p);
}

// ---------------------------------------------------------------------------------------------
// Who.

function uniq<X extends string>(xs: readonly X[]): X[] {
  const out: X[] = [];
  for (const x of xs) if (!out.includes(x)) out.push(x);
  return out;
}

/** A lord that can put ships or spears in the field: not the player, not the Church, not neutral ground (the Thingey). */
export function canField(state: GameState, id: FactionId): boolean {
  if (id === state.player.factionId) return false;
  const f = state.factions[id] as (GameState['factions'][FactionId] & { neutral?: boolean }) | undefined;
  return f !== undefined && f.kind !== 'church' && f.neutral !== true;
}

function nonPlayerFactions(state: GameState): FactionId[] {
  return (Object.keys(state.factions) as FactionId[]).filter((id) => canField(state, id)).sort();
}

/** An enemy lord with ships in these waters, else the house's Rival, else anyone at war with the house. */
function enemyLord(state: GameState, t: T, hostileNear: readonly FactionId[]): FactionId | undefined {
  const fieldable = hostileNear.filter((f) => canField(state, f));
  const atWar = fieldable.filter((f) => standingWith(state, t, f).war);
  if (atWar.length > 0) return atWar[0];
  if (fieldable.length > 0) return fieldable[0];
  const nemesis = state.player.nemesis;
  if (nemesis && !nemesis.ended && Object.hasOwn(state.factions, nemesis.factionId)) return nemesis.factionId;
  for (const id of nonPlayerFactions(state)) if (standingWith(state, t, id).war) return id;
  return undefined;
}

/** Sea-raiders sail under no banner, but every crew comes from somewhere: a petty jarl's coast nearby, else any. */
function raiderHome(state: GameState, rng: RandomSource, near: readonly { factionId: FactionId }[]): FactionId | undefined {
  const small = (id: FactionId) => {
    const k = state.factions[id]?.kind;
    return k === 'jarldom' || k === 'petty' || (k as string) === 'clan';
  };
  const local = uniq(near.map((s) => s.factionId)).filter((f) => canField(state, f) && small(f)).sort();
  if (local.length > 0) return rng.pick(local);
  const all = nonPlayerFactions(state);
  const smalls = all.filter(small);
  const pool = smalls.length > 0 ? smalls : all;
  return pool.length > 0 ? rng.pick(pool) : undefined;
}

/** A trader's home port lord: one of the coasts nearby, else anyone. */
function merchantLord(state: GameState, rng: RandomSource, near: readonly { factionId: FactionId }[]): FactionId | undefined {
  const local = uniq(near.map((s) => s.factionId)).filter((f) => canField(state, f)).sort();
  if (local.length > 0) return rng.pick(local);
  const all = nonPlayerFactions(state);
  return all.length > 0 ? rng.pick(all) : undefined;
}

/** The lord of the nearest foreign settlement (whose waters or land these are), if it is near enough. */
function localLord(state: GameState, near: readonly { factionId: FactionId }[]): FactionId | undefined {
  const first = near.find((s) => (state.factions[s.factionId] as { neutral?: boolean } | undefined)?.neutral !== true);
  if (!first || !canField(state, first.factionId)) return undefined;
  return first.factionId;
}

/** Draws what is sighted at sea; null when nothing fits (no lord to patrol, no enemy to send a fleet). */
export function pickSeaKind(state: GameState, t: T, rng: RandomSource, zoneId: string | null, hostileShare: number, lords: { patrol?: FactionId; enemy?: FactionId; raiders?: FactionId; merchant?: FactionId }): SeaKind | null {
  const info = zoneInfo(t, zoneId);
  const s = season(state.time.hour);
  const weight = (k: SeaKind): number => {
    if (k === 'patrol' && lords.patrol === undefined) return 0;
    if (k === 'warfleet' && lords.enemy === undefined) return 0;
    if (k === 'raiders' && lords.raiders === undefined) return 0;
    if (k === 'merchant' && lords.merchant === undefined) return 0;
    return info.mix[k] * t.sea.seasonKindMult[s][k] * (1 + t.sea.hostileKindSlope[k] * hostileShare);
  };
  return rng.weighted(SEA, weight) ?? null;
}

/** Draws what a land party meets. */
export function pickLandKind(t: T, rng: RandomSource, lord: FactionId | undefined): LandKind | null {
  return rng.weighted(LAND, (k) => (k === 'landPatrol' && lord === undefined ? 0 : t.land.kindWeights[k])) ?? null;
}

// ---------------------------------------------------------------------------------------------
// How many, in what.

function splitUnits(units: Readonly<Record<string, number>>, men: number): Record<string, number> {
  const keys = Object.keys(units).filter((u) => (units[u] ?? 0) > 0);
  const total = keys.reduce((a, u) => a + (units[u] ?? 0), 0);
  const out: Record<string, number> = {};
  if (keys.length === 0 || total <= 0) return { bondi: men };
  let left = men;
  keys.forEach((u, i) => {
    const n = i === keys.length - 1 ? left : Math.min(left, Math.round((men * (units[u] ?? 0)) / total));
    if (n > 0) out[u] = n;
    left -= n;
  });
  return out;
}

/** Ships for `men`: as many hulls of the drawn type as the crews need. */
function shipsFor(content: Content, rng: RandomSource, types: readonly string[], men: number, minShips: number): EncounterShip[] {
  const known = types.filter((x) => Object.hasOwn(content.balance.ships, x));
  if (known.length === 0) return [];
  const type = rng.pick(known) as ShipTypeId;
  const def = (content.balance.ships as Record<string, { crewMax: number; crewMin: number }>)[type] as { crewMax: number; crewMin: number };
  const per = Math.max(def.crewMin, Math.floor(def.crewMax * 0.8));
  const count = Math.max(1, Math.min(men, Math.max(minShips, Math.ceil(men / per))));
  const out: EncounterShip[] = [];
  let left = men;
  for (let i = 0; i < count; i++) {
    const crew = i === count - 1 ? left : Math.min(left, Math.ceil(men / count));
    out.push({ type, crew: Math.max(1, crew) });
    left -= crew;
  }
  return out;
}

/** Draws the other party: a real fleet in sight, or a virtual crew sized against ours. */
export function drawParty(state: GameState, content: Content, rng: RandomSource, kind: EncounterKind, ourMen: number, factionId: FactionId | undefined, real?: Fleet): EncounterParty {
  const t = content.tunables.encounters;
  const k = t.kinds[kind];
  const faction = factionId !== undefined ? state.factions[factionId] : undefined;
  const pride = Math.round(rng.range(0, content.balance.encounters.toll.prideMax));
  if (real) {
    const types: ShipTypeId[] = [];
    const ships: EncounterShip[] = [];
    for (const id of real.shipIds) {
      const sh = state.ships[id];
      if (!sh) continue;
      types.push(sh.type);
      ships.push({ type: sh.type, crew: 0 });
    }
    const m = moverOf(state, real.id);
    const kn = m && m.sailKn > 0 ? Math.max(m.sailKn, m.rowKn) * (m.mult > 0 ? m.mult : 1) : shipsKn(content.balance, types);
    const captain = state.characters[real.leaderId];
    return {
      ...(factionId !== undefined ? { factionId } : {}),
      fleetId: real.id,
      ships,
      men: { ...real.men },
      silver: Math.max(0, Math.floor(real.silver)),
      cargo: { ...real.cargo },
      armourTier: faction?.armouryTier ?? k.tier,
      weaponTier: faction?.weaponTier ?? k.tier,
      morale: real.morale,
      seafaring: captain?.skills.seafaring ?? k.seafaring,
      wildcraft: captain?.skills.wildcraft ?? k.wildcraft,
      kn,
      pride,
    };
  }
  const men = Math.round(clamp(ourMen * rng.range(k.menShare[0], k.menShare[1]), k.minMen, k.maxMen));
  const ships = shipsFor(content, rng, k.ships, men, k.minShips);
  const cargo: Partial<Record<GoodId, number>> = {};
  const kinds = k.goods.length > 0 ? rng.int(k.goodsKinds[0], Math.max(k.goodsKinds[0], k.goodsKinds[1])) : 0;
  for (const g of rng.shuffle([...k.goods]).slice(0, kinds)) {
    if (!Object.hasOwn(content.balance.goods, g)) continue;
    cargo[g as GoodId] = Math.round(rng.range(k.goodsTons[0], k.goodsTons[1]) * 10) / 10;
  }
  const kn = ships.length > 0 ? shipsKn(content.balance, ships.map((s) => s.type)) * k.speedMult : 0;
  return {
    ...(factionId !== undefined ? { factionId } : {}),
    ships,
    men: splitUnits(k.units, men),
    silver: Math.round(rng.range(k.silver[0], k.silver[1])),
    cargo,
    // Crews at sea fight with their lord's armoury (the sea battle reads it from the faction); outlaws with their own.
    armourTier: kind === 'outlaws' ? k.tier : (faction?.armouryTier ?? k.tier),
    weaponTier: kind === 'outlaws' ? k.tier : (faction?.weaponTier ?? k.tier),
    morale: k.morale,
    seafaring: k.seafaring,
    wildcraft: k.wildcraft,
    kn: Math.round(kn * 100) / 100,
    pride,
  };
}

// ---------------------------------------------------------------------------------------------
// The card.

/** What a new encounter needs before its options are worked out. */
export interface EncounterSpec {
  id: string;
  kind: EncounterKind;
  stage: EncounterStage;
  fleetId: FleetId;
  armyId?: ArmyId;
  party: EncounterParty;
  /** Variant of the body text (1-based). */
  variant: number;
  /** Merchant: rations they can spare (drawn when sighted). */
  rationsOffered?: number;
}

/** The full payload of an encounter decision (generic-modal fields included). */
export type EncounterPayloadFull = EncounterPayloadExt & { fleetId: FleetId; otherFleetId?: FleetId; encounterKind: string };

const nameOf = (state: GameState, id: string | undefined): string => (id !== undefined ? (state.characters[id as never]?.name ?? '') : '');

/** Builds the payload: who they are, the safe default, the options with odds and the modal's buttons. */
export function composeEncounter(state: GameState, content: Content, spec: EncounterSpec, effects: { has(op: string): boolean }): EncounterPayloadFull {
  const t = content.tunables.encounters;
  const fleet = state.fleets[spec.fleetId];
  const domain: 'sea' | 'land' = spec.armyId !== undefined ? 'land' : 'sea';
  const party = spec.party;
  const standing = standingWith(state, t, party.factionId);
  const aggressive = spec.kind === 'raiders' || spec.kind === 'outlaws' || (spec.kind !== 'merchant' && standing.war) || (spec.kind === 'warfleet' && standing.hostile);
  const ids = companions(state, spec.fleetId, spec.armyId);
  const speech = bestAt(state, ids, 'speechcraft');
  const ourMen = domain === 'land' ? armyMen(state, spec.armyId) : menTotal(fleet?.men ?? {});
  const toll = tollFor(state, content, spec.kind, spec.fleetId, speech.skill, ourMen);
  const deal = spec.kind === 'merchant' ? tradeDealFor(state, content, spec.fleetId, speech.skill, spec.rationsOffered ?? 0) : null;
  const zoneId = fleet ? zoneOf(fleet) : null;
  const lookout = bestAt(state, ids, domain === 'land' ? 'wildcraft' : 'seafaring');
  const theirMen = menTotal(party.men);
  const vars: TextVars = {
    faction: party.factionId !== undefined ? (state.factions[party.factionId]?.name ?? '') : '',
    ships: party.ships.length,
    men: theirMen,
    ourMen,
    zone: zoneInfo(t, zoneId).name,
    hasZone: zoneInfo(t, zoneId).name !== '' ? 'yes' : 'no',
    lookout: nameOf(state, lookout.id),
    leader: nameOf(state, fleet?.leaderId),
    stronger: theirMen > ourMen * 1.2 ? 'more' : theirMen < ourMen * 0.8 ? 'fewer' : 'even',
    kind: spec.kind,
    peaceful: aggressive ? 'no' : 'yes',
  };
  const defaultChoice = safeDefault(spec.kind, aggressive, standing.war, spec.stage, domain);
  const ext: EncounterPayloadFull = {
    fleetId: spec.fleetId,
    ...(party.fleetId !== undefined ? { otherFleetId: party.fleetId } : {}),
    encounterKind: spec.kind,
    encounterId: spec.id,
    kind: spec.kind,
    stage: spec.stage,
    domain,
    ...(spec.armyId !== undefined ? { armyId: spec.armyId } : {}),
    zoneId,
    aggressive,
    atWar: standing.war,
    party,
    ...(deal ? { deal } : {}),
    toll: { silver: toll.silver, rations: toll.rations },
    variant: spec.variant,
    defaultChoice,
    titleKey: spec.stage === 'caught' ? `encounters.title.caught.${domain}` : `encounters.title.${spec.kind}`,
    key: spec.stage === 'caught' ? `encounters.caught.${domain}.${spec.variant}` : `encounters.sighted.${spec.kind}.${spec.variant}`,
    vars,
    options: [],
    choices: [],
  };
  refreshChoices(state, content, ext, effects);
  return ext;
}

/** Recomputes the options and the modal's buttons of a payload (after a command changed the state). */
export function refreshChoices(state: GameState, content: Content, p: EncounterPayloadFull, effects: { has(op: string): boolean }): void {
  p.options = encounterOptions(state, content, p, effects);
  p.choices = p.options.map((o, i) => toChoice(state, o, i === 0));
}

const DANGER: readonly string[] = ['attack', 'fight', 'demandToll'];

/** One button of the generic decision modal. */
export function toChoice(state: GameState, o: EncounterOption, first: boolean): EncounterDecisionChoice {
  const vars: TextVars = { who: nameOf(state, o.whoId), hasWho: o.whoId !== undefined ? 'yes' : 'no', pct: pct(o.chance), ...(o.vars ?? {}) };
  if (o.reason !== undefined) vars['reason'] = o.reason;
  return {
    id: o.id,
    labelKey: o.available ? `encounters.choice.${o.id}` : `encounters.choice.${o.id}.off`,
    vars,
    command: { type: 'resolveEncounter', choice: o.id } as never,
    tone: DANGER.includes(o.id) ? 'danger' : first ? 'primary' : 'secondary',
    ...(o.available ? { previewKey: `encounters.preview.${o.id}` } : { disabled: true, previewKey: `encounters.reason.${o.reason ?? 'unavailable'}` }),
  };
}

/** The other party's real fleets in sight of ours (§8.6 visible encounters), nearest first. */
export function fleetsInSight(state: GameState, fleet: Fleet, radius: number, met: Readonly<Record<string, number>>, hour: number): Fleet[] {
  const out: { f: Fleet; d2: number }[] = [];
  const r2 = radius * radius;
  for (const key of Reflect.ownKeys(state.fleets)) {
    if (typeof key !== 'string' || key === fleet.id) continue;
    const f = state.fleets[key as FleetId];
    if (!f || f.ownerId === state.player.factionId || f.mode !== 'sailing' || f.shipIds.length === 0) continue;
    if (Object.hasOwn(met, f.id) && (met[f.id] ?? 0) > hour) continue;
    const d2 = (f.pos.x - fleet.pos.x) ** 2 + (f.pos.y - fleet.pos.y) ** 2;
    if (d2 <= r2) out.push({ f, d2 });
  }
  return out.sort((a, b) => a.d2 - b.d2 || (a.f.id < b.f.id ? -1 : 1)).map((x) => x.f);
}

/** §31.4 sight radius in cells (leagues): (2 + 0.5 × Seafaring + lookout) × (fog or night ? 0.5 : 1). */
export function sightRadius(state: GameState, content: Content, fleet: Fleet, fog: boolean): number {
  const e = content.balance.encounters;
  const ids = companions(state, fleet.id);
  const sea = bestAt(state, ids, 'seafaring').skill;
  let lookout = 0;
  for (const id of ids) {
    const c = state.characters[id];
    if (!c) continue;
    if (c.traits.some((tr) => (content.traits as Record<string, { flags?: string[] } | undefined>)[tr]?.flags?.includes('lookout') === true)) lookout = e.lookoutTrait;
  }
  return (e.sightBase + e.sightPerSeafaring * sea + lookout) * (fog ? e.fogNightMult : 1);
}

export { enemyLord, localLord, merchantLord, raiderHome };
export type { LandKind, SeaKind };
