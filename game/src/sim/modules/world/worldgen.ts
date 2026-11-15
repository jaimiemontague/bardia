/**
 * World generation (design §4.5, §5.1 step 8, §8.1, §9.2–§9.4, §10.1, §17.1, §18.2; ARCHITECTURE §15).
 *
 * The map is the same every campaign; the seed varies the people and the politics:
 *   1. provinces from the geography pack (plus one neutral province per neutral region with settlements);
 *   2. the player's starting jarldom (option `startProvinceId`, else a non-royal homeland province of the
 *      player's culture, preferring a harbour capital);
 *   3. factions per realm (tunables.world.politics): a ruler holding the royal seat, and either every province
 *      (petty kingdoms, Corvani realms, the empire) or jarls/clans/cities in the other provinces, some sworn
 *      to the ruler; unclaimed colonized provinces get their own small factions; neutral ground its own;
 *   4. ruling houses (houses.ts) with parents, siblings, spouses (some from other houses: kinship) and children;
 *   5. settlements: population by tier and culture, prosperity, silver, garrisons by the tier ratio and the
 *      culture's unit mix, walls (§9.3 with burhs, river forts, Eyjar −1, old imperial stone walls),
 *      starting buildings, equipment tiers, leaders (the ruler at the seat, adult kin, or a local leader);
 *   6. treasuries from months of tax income.
 * Politics between factions (politics.ts), the player's re-homing, family and the Rival (player.ts) and the
 * start knowledge (startKnowledge.ts) follow. All draws use the world module's streams.
 */
import type { CultureId, FaithId, SettlementTierId } from '@content/schemas/ids';
import type { KingdomDef, ProvinceDef, SettlementDef } from '@content/world';
import { clamp } from '@sim/core/dmath';
import { createFaction, createProvince, createSettlement, PLACEHOLDER_HOME_FLAG } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { Rng } from '@sim/core/rng';
import type { CharId, EconomyStateId, Faction, FactionId, FactionKind, GameState, ProvinceId, Settlement, SettlementId } from '@sim/core/state';
import { cellOfPos, type WorldData } from './data';
import { adultKin, ageAt, generateHouse, generatePerson, type House } from './houses';

/** Stream for world-generation draws (factories use world:factory / world:names). */
export const GEN_STREAM = 'world:gen';

type Tun = SimContext['tunables']['world'];
type PoliticsRule = Tun['politics']['defaultRule'];

const ECONOMY_LADDER: readonly EconomyStateId[] = ['ruined', 'destitute', 'poor', 'fair', 'thriving'];

/** What world generation produced (consumed by politics, the player's re-homing and tests). */
export interface Generated {
  /** Geography province id → state province id. */
  provinceOf: Record<string, ProvinceId>;
  /** Geography province id → owning faction (the player's for the start province). */
  ownerOf: Record<string, FactionId>;
  /** Realm (geography kingdom id) → seat faction. */
  seatOf: Record<string, FactionId>;
  /** Faction → its ruling house (AI factions only). */
  houses: Record<FactionId, House>;
  /** Factions in creation order (AI factions only). */
  factionIds: FactionId[];
  /** Neutral factions (Thingey). */
  neutralIds: FactionId[];
  /** The player's starting province (geography id). */
  startProvince: string;
  /** Faction → region id of its home province. */
  regionOf: Record<FactionId, string>;
}

/** The rule for a realm: default ← region ← realm. */
export function ruleFor(t: Tun, regionId: string, kingdomId: string | null): PoliticsRule {
  const region = Object.hasOwn(t.politics.regions, regionId) ? t.politics.regions[regionId] : undefined;
  const realm = kingdomId !== null && Object.hasOwn(t.politics.kingdoms, kingdomId) ? t.politics.kingdoms[kingdomId] : undefined;
  return { ...t.politics.defaultRule, ...(region ?? {}), ...(realm ?? {}) } as PoliticsRule;
}

/** Culture of a province's people (province default, its realm's, its region's, else skarn). */
function provinceCulture(data: WorldData, def: ProvinceDef): CultureId {
  if (def.culture !== null) return def.culture;
  const k = def.kingdomId !== null ? data.geo.kingdoms.find((x) => x.id === def.kingdomId) : undefined;
  if (k) return k.culture;
  const r = data.geo.regions.find((x) => x.id === def.regionId);
  return r?.culture ?? 'skarn';
}

function provinceFaith(data: WorldData, ctx: SimContext, def: ProvinceDef): FaithId {
  if (def.faith !== null) return def.faith;
  const k = def.kingdomId !== null ? data.geo.kingdoms.find((x) => x.id === def.kingdomId) : undefined;
  if (k) return k.faith;
  const r = data.geo.regions.find((x) => x.id === def.regionId);
  return r?.faith ?? ctx.content.cultures[provinceCulture(data, def)].faith;
}

/** Geography settlements of a province, its capital first (by name), then pack order. */
function settlementsOf(data: WorldData, provinceGeoId: string): SettlementDef[] {
  const def = data.provinceDefs[provinceGeoId];
  const list = data.geo.settlements.filter((s) => s.provinceId === provinceGeoId);
  const cap = def?.capital ?? null;
  return [...list.filter((s) => s.name === cap), ...list.filter((s) => s.name !== cap)];
}

/** Is a province a usable player start for a culture (§5.1: homeland, colonized, not a royal seat)? */
export function isEligibleStart(data: WorldData, def: ProvinceDef | undefined, culture: CultureId): boolean {
  if (!def || !def.homeland || !def.colonized || def.kingdomId === null) return false;
  if (Object.hasOwn(data.seatProvinces, def.id)) return false;
  const k = data.geo.kingdoms.find((x) => x.id === def.kingdomId);
  return k !== undefined && k.culture === culture && settlementsOf(data, def.id).length > 0;
}

/** The player's starting province: the requested one if eligible, else a sensible default (§5.1 step 8). */
export function chooseStartProvince(data: WorldData, t: Tun, culture: CultureId, requested: string | undefined, rng: Rng): string {
  if (requested !== undefined && isEligibleStart(data, data.provinceDefs[requested], culture)) return requested;
  let candidates = data.geo.provinces.filter((p) => isEligibleStart(data, p, culture));
  if (candidates.length === 0) candidates = data.geo.provinces.filter((p) => p.homeland && p.colonized && !Object.hasOwn(data.seatProvinces, p.id) && settlementsOf(data, p.id).length > 0);
  if (candidates.length === 0) throw new Error('world: no province can host the player');
  if (t.player.preferHarbour) {
    const harbour = candidates.filter((p) => settlementsOf(data, p.id)[0]?.coastal === true);
    if (harbour.length > 0) candidates = harbour;
  }
  return rng.pick(candidates).id;
}

function drawRange(rng: Rng, r: readonly [number, number]): number {
  return r[0] === r[1] ? r[0] : rng.int(r[0], r[1]);
}

/** Population of a settlement: lo + (hi − lo) × u^skew; province capitals lean to the top of the range. */
function drawPop(ctx: SimContext, rng: Rng, culture: CultureId, tier: SettlementTierId, provinceCapital: boolean): number {
  const t = ctx.tunables.world.worldgen;
  const byCulture = Object.hasOwn(t.popByCulture, culture) ? t.popByCulture[culture] : undefined;
  const range = byCulture !== undefined && Object.hasOwn(byCulture, tier) ? (byCulture[tier] as [number, number]) : ctx.balance.settlementTiers[tier].pop;
  let u = rng.float() ** t.popSkew;
  if (provinceCapital && tier !== 'capital') u = t.provinceCapitalPopBoost + (1 - t.provinceCapitalPopBoost) * u;
  return Math.round(range[0] + (range[1] - range[0]) * u);
}

function drawEconomy(ctx: SimContext, rng: Rng, culture: CultureId, seat: boolean): EconomyStateId {
  const t = ctx.tunables.world.worldgen;
  const w = Object.hasOwn(t.economyByCulture, culture) ? (t.economyByCulture[culture] as typeof t.economy) : t.economy;
  let e = rng.weighted(ECONOMY_LADDER, (s) => w[s as keyof typeof w]) ?? 'fair';
  if (seat && ECONOMY_LADDER.indexOf(e) < ECONOMY_LADDER.indexOf(t.seatMinEconomy)) e = t.seatMinEconomy;
  return e;
}

/** Splits `total` men over a weighted unit mix (largest remainder; ties by unit id). Unknown units are skipped. */
export function splitGarrison(total: number, mix: Readonly<Record<string, number>>, units: Readonly<Record<string, unknown>>): Record<string, number> {
  const ids = Object.keys(mix)
    .filter((u) => Object.hasOwn(units, u) && (mix[u] ?? 0) > 0)
    .sort();
  const sum = ids.reduce((s, u) => s + (mix[u] ?? 0), 0);
  const out: Record<string, number> = {};
  const n = Math.max(0, Math.round(total));
  if (n === 0 || sum <= 0) return out;
  let given = 0;
  const rem: { u: string; f: number }[] = [];
  for (const u of ids) {
    const exact = (n * (mix[u] ?? 0)) / sum;
    const whole = Math.floor(exact);
    out[u] = whole;
    given += whole;
    rem.push({ u, f: exact - whole });
  }
  rem.sort((a, b) => b.f - a.f || (a.u < b.u ? -1 : 1));
  for (let i = 0; given < n && rem.length > 0; i = (i + 1) % rem.length) {
    const u = (rem[i] as { u: string }).u;
    out[u] = (out[u] ?? 0) + 1;
    given++;
  }
  for (const u of Object.keys(out)) if (out[u] === 0) delete out[u];
  return out;
}

function cultureModifier(ctx: SimContext, culture: CultureId, key: string): number {
  let sum = 0;
  for (const b of ctx.content.cultures[culture].bonuses) sum += b.modifiers[key] ?? 0;
  return sum;
}

/** Walls (§9.3): tier range, Albric burhs, Velkar river forts, Eyjar −1, old imperial stone walls. */
function drawFort(ctx: SimContext, rng: Rng, def: SettlementDef, imperialSeat: boolean): 0 | 1 | 2 | 3 | 4 {
  const t = ctx.tunables.world.worldgen;
  let tier = drawRange(rng, t.fortByTier[def.tier]);
  if (t.burhTiers.includes(def.tier)) tier += cultureModifier(ctx, def.culture, 'fort.townTierDelta');
  if (def.riverPort === true) tier += cultureModifier(ctx, def.culture, 'fort.riverTierDelta');
  tier += cultureModifier(ctx, def.culture, 'fort.startTierDelta');
  if (cultureModifier(ctx, def.culture, 'fort.oldStoneWalls') > 0 && t.stoneWallTiers.includes(def.tier)) {
    const chance = Object.hasOwn(t.stoneWallChance, def.culture) ? (t.stoneWallChance[def.culture] as number) : 0;
    if ((imperialSeat && t.empireSeatStoneWalls) || rng.chance(chance)) tier = 4;
  }
  if (def.tier === 'hamlet') tier = Math.min(tier, 1);
  return clamp(Math.round(tier), 0, 4) as 0 | 1 | 2 | 3 | 4;
}

function startBuildings(ctx: SimContext, def: SettlementDef, fortTier: number): Record<string, number> {
  const t = ctx.tunables.world.worldgen;
  const out: Record<string, number> = {};
  const harbour = def.coastal || def.riverPort === true;
  for (const [b, n] of Object.entries(t.buildingsByTier[def.tier])) {
    if (n <= 0 || !Object.hasOwn(ctx.balance.buildings, b)) continue;
    if (!harbour && t.harbourBuildings.includes(b)) continue;
    if (def.faith !== 'oldways' && t.oldWaysBuildings.includes(b)) continue;
    out[b] = n;
  }
  if (fortTier > 0) out['walls'] = fortTier;
  return out;
}

function equipment(ctx: SimContext, culture: CultureId, tier: SettlementTierId): [number, number] {
  const t = ctx.tunables.world.worldgen;
  const base = Object.hasOwn(t.equipmentByCulture, culture) ? (t.equipmentByCulture[culture] as [number, number]) : t.equipmentDefault;
  const bonus = Object.hasOwn(t.equipmentTierBonus, tier) ? (t.equipmentTierBonus[tier] as number) : 0;
  return [clamp(base[0] + bonus, 1, 5), clamp(base[1] + bonus, 1, 5)];
}

/** Garrison of a geography settlement. */
function drawGarrison(ctx: SimContext, rng: Rng, culture: CultureId, tier: SettlementTierId, pop: number, seat: boolean): Record<string, number> {
  const t = ctx.tunables.world.worldgen;
  const row = ctx.balance.settlementTiers[tier] as { garrisonRatio?: number; garrisonFixed?: [number, number] };
  let total: number;
  if (row.garrisonFixed !== undefined) total = drawRange(rng, row.garrisonFixed);
  else total = Math.round(pop * (row.garrisonRatio ?? 0) * (seat ? t.seatGarrisonMult : 1) * rng.range(0.85, 1.15));
  const mix = Object.hasOwn(t.garrisonMixByTier, tier) ? t.garrisonMixByTier[tier] : Object.hasOwn(t.garrisonMix, culture) ? t.garrisonMix[culture] : { bondi: 1 };
  return splitGarrison(total, mix ?? { bondi: 1 }, ctx.balance.units);
}

/** Monthly tax income of a faction's holdings at the fair rate (§11.5), for the starting treasury. */
export function monthlyTaxEstimate(state: GameState, ctx: SimContext, factionId: FactionId): number {
  const e = ctx.balance.economy;
  let sum = 0;
  for (const sid of state.factions[factionId]?.holdingIds ?? []) {
    const s = state.settlements[sid];
    if (!s) continue;
    sum += s.pop * e.taxPerCapita * e.taxMult.fair * (e.prosperity[s.economy] ?? 1);
  }
  return sum;
}

/** Creates a faction for a ruling house (ruler role and faction links set). */
function houseFaction(draft: GameState, ctx: SimContext, house: House, o: { kind: FactionKind; name: string; colorIndex: number; kingdomId?: string; homeProvinceId: ProvinceId; liegeId?: FactionId; armour: number; weapons: number }): Faction {
  const f = createFaction(draft, ctx, {
    culture: house.culture,
    faith: house.faith,
    kind: o.kind,
    name: o.name,
    rulerId: house.rulerId,
    colorIndex: o.colorIndex,
    armouryTier: o.armour,
    weaponTier: o.weapons,
    ...(o.liegeId !== undefined ? { liegeId: o.liegeId } : {}),
  });
  if (o.kingdomId !== undefined) f.kingdomId = o.kingdomId;
  f.homeProvinceId = o.homeProvinceId;
  house.factionId = f.id;
  for (const id of house.members) {
    const c = draft.characters[id];
    if (c) c.factionId = f.id;
  }
  if (o.liegeId !== undefined) {
    const liege = draft.factions[o.liegeId];
    if (liege && !liege.vassalIds.includes(f.id)) liege.vassalIds.push(f.id);
  }
  return f;
}

/** Spouse candidates for a new house: earlier houses of the same faith within reach of `pos`. */
function nearbyHouses(houses: readonly House[], faith: FaithId, pos: { x: number; y: number }, maxCells: number): House[] {
  return houses.filter((h) => h.faith === faith && h.pos !== undefined && (h.pos.x - pos.x) ** 2 + (h.pos.y - pos.y) ** 2 <= maxCells * maxCells);
}

const SPOUSE_REACH_CELLS = 220;

/**
 * Steps 1, 3–6 of world generation (the player's province is left to the player's faction; player.ts
 * re-homes the placeholder onto it). Returns what later steps need.
 */
export function generatePolities(draft: GameState, ctx: SimContext, data: WorldData, startProvince: string): Generated {
  const t = ctx.tunables.world;
  const wg = t.worldgen;
  const rng = ctx.rng(GEN_STREAM);
  const { geo } = data;
  const playerFaction = draft.player.factionId;
  const out: Generated = { provinceOf: {}, ownerOf: {}, seatOf: {}, houses: {}, factionIds: [], neutralIds: [], startProvince, regionOf: {} };
  const regionOfProvince: Record<string, string> = {};

  // 1. Provinces.
  for (const def of geo.provinces) {
    const p = createProvince(draft, { name: def.name, regionId: def.regionId, homeland: def.homeland, ...(def.kingdomId !== null ? { kingdomId: def.kingdomId } : {}) });
    p.geoId = def.id;
    out.provinceOf[def.id] = p.id;
    regionOfProvince[p.id] = def.regionId;
  }
  const neutralProvince: Record<string, ProvinceId> = {};
  const orphanSettlements = geo.settlements.filter((s) => s.provinceId === null);
  for (const region of geo.regions.filter((r) => r.neutral)) {
    const mine = orphanSettlements.filter((s) => nearestNeutralRegion(data, s) === region.id);
    if (mine.length === 0) continue;
    const p = createProvince(draft, { name: region.name, regionId: region.id, homeland: false });
    p.geoId = region.id;
    p.neutral = true;
    neutralProvince[region.id] = p.id;
  }

  // 3–4. Realms, their rulers and members.
  const houses: House[] = [];
  const firstHouseOfRegion: Record<string, House> = {};
  let color = 1;
  const anchorOf = (geoId: string) => {
    const d = data.provinceDefs[geoId];
    return { x: d?.anchor[0] ?? 0, y: d?.anchor[1] ?? 0 };
  };
  const addHouse = (h: House, pos: { x: number; y: number }) => {
    h.pos = pos;
    houses.push(h);
  };
  for (const k of geo.kingdoms) {
    const rule = ruleFor(t, k.regionId, k.id);
    const seatDef = data.provinceDefs[k.seatProvinceId];
    if (!seatDef || !Object.hasOwn(out.provinceOf, seatDef.id)) continue;
    const seatPos = anchorOf(seatDef.id);
    const sibling = rule.siblingRulers ? firstHouseOfRegion[k.regionId] : undefined;
    const house = generateHouse(draft, ctx, rng, {
      culture: k.culture,
      faith: k.faith,
      rulerAge: drawRange(rng, rule.rulerAge),
      ...(sibling !== undefined ? { siblingOf: sibling } : {}),
      spouseCandidates: nearbyHouses(houses, k.faith, seatPos, SPOUSE_REACH_CELLS),
    });
    addHouse(house, seatPos);
    firstHouseOfRegion[k.regionId] ??= house;
    const [armour, weapons] = equipment(ctx, k.culture, 'town');
    const seat = houseFaction(draft, ctx, house, { kind: rule.seatKind as FactionKind, name: k.name, colorIndex: color++, kingdomId: k.id, homeProvinceId: out.provinceOf[seatDef.id] as ProvinceId, armour, weapons });
    out.seatOf[k.id] = seat.id;
    out.houses[seat.id] = house;
    out.factionIds.push(seat.id);
    out.regionOf[seat.id] = k.regionId;
    out.ownerOf[seatDef.id] = seat.id;
    for (const def of geo.provinces) {
      if (def.kingdomId !== k.id || def.id === seatDef.id || !def.colonized) continue;
      if (def.id === startProvince) {
        out.ownerOf[def.id] = playerFaction;
        continue;
      }
      if (rule.holdAll) {
        out.ownerOf[def.id] = seat.id;
        continue;
      }
      const member = memberFaction(draft, ctx, rng, data, def, rule.memberKind as FactionKind, k, houses, color++, out, rule, seat.id);
      out.ownerOf[def.id] = member;
    }
  }
  // Unclaimed colonized provinces (Rimewild posts, Isafold settlers).
  for (const def of geo.provinces) {
    if (def.kingdomId !== null || !def.colonized || Object.hasOwn(out.ownerOf, def.id)) continue;
    if (def.id === startProvince) {
      out.ownerOf[def.id] = playerFaction;
      continue;
    }
    if (settlementsOf(data, def.id).length === 0 && !wg.synthesizeMissingCapitals) continue;
    const rule = ruleFor(t, def.regionId, null);
    out.ownerOf[def.id] = memberFaction(draft, ctx, rng, data, def, rule.unclaimedKind as FactionKind, undefined, houses, color++, out, rule, undefined);
  }
  // Neutral ground.
  for (const [regionId, pid] of Object.entries(neutralProvince)) {
    const first = orphanSettlements.find((s) => nearestNeutralRegion(data, s) === regionId);
    if (!first) continue;
    const ruler = generatePerson(draft, ctx, rng, { culture: first.culture, faith: first.faith, age: rng.int(40, 65), profile: 'leader', personality: true });
    const region = geo.regions.find((r) => r.id === regionId);
    const f = createFaction(draft, ctx, { culture: first.culture, faith: first.faith, kind: t.politics.neutralKind as FactionKind, name: region?.name ?? regionId, rulerId: ruler.id, colorIndex: 0 });
    f.neutral = true;
    f.homeProvinceId = pid;
    out.neutralIds.push(f.id);
    out.regionOf[f.id] = regionId;
    out.ownerOf[regionId] = f.id;
    out.houses[f.id] = { factionId: f.id, culture: first.culture, faith: first.faith, rulerId: ruler.id, fatherId: ruler.id, motherId: ruler.id, childIds: [], siblingIds: [], members: [], kinFactions: [] };
  }

  // 5. Settlements.
  const imperialSeats: Record<string, true> = {};
  for (const k of geo.kingdoms) if (k.kind === 'empire') imperialSeats[k.seatProvinceId] = true;
  for (const def of geo.provinces) {
    const owner = out.ownerOf[def.id];
    const pid = out.provinceOf[def.id];
    if (owner === undefined || pid === undefined) continue;
    let defs = settlementsOf(data, def.id);
    if (defs.length === 0 && wg.synthesizeMissingCapitals && def.colonized) defs = [synthesizedCapital(data, ctx, def)];
    defs.forEach((sdef, i) => {
      placeSettlement(draft, ctx, rng, data, sdef, pid, owner, i === 0, Object.hasOwn(data.seatProvinces, def.id) && i === 0, Object.hasOwn(imperialSeats, def.id) && i === 0, out);
    });
  }
  for (const s of orphanSettlements) {
    const regionId = nearestNeutralRegion(data, s);
    const pid = neutralProvince[regionId];
    const owner = out.ownerOf[regionId];
    if (pid === undefined || owner === undefined) continue;
    const first = draft.provinces[pid]?.settlementIds.length === 0;
    placeSettlement(draft, ctx, rng, data, s, pid, owner, first, false, false, out);
  }

  // Leaders: the ruler governs the seat; adult kin, then local leaders, the rest.
  for (const fid of [...out.factionIds, ...out.neutralIds]) assignLeaders(draft, ctx, rng, fid, out.houses[fid]);

  // 6. Treasuries.
  for (const fid of [...out.factionIds, ...out.neutralIds]) {
    const f = draft.factions[fid];
    if (!f) continue;
    f.treasury = Math.round(monthlyTaxEstimate(draft, ctx, fid) * rng.range(wg.treasuryMonths[0], wg.treasuryMonths[1]));
  }
  return out;
}

/** The neutral region a province-less settlement belongs to (nearest neutral region label). */
function nearestNeutralRegion(data: WorldData, s: SettlementDef): string {
  let best = '';
  let bestD = Infinity;
  for (const r of data.geo.regions) {
    if (!r.neutral) continue;
    const d = (r.label[0] - s.pos[0]) ** 2 + (r.label[1] - s.pos[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  return best;
}

/** A capital for a colonized province the region packs left empty (named after the province, at its anchor). */
function synthesizedCapital(data: WorldData, ctx: SimContext, def: ProvinceDef): SettlementDef {
  const wg = ctx.tunables.world.worldgen;
  const seat = Object.hasOwn(data.seatProvinces, def.id);
  const cell = cellOfPos(data.sw, def.anchor[0], def.anchor[1]);
  const coastal = (data.sw.coastDist[cell] ?? 99) <= data.geo.build.coastalMaxCells;
  return {
    id: `${def.id}Capital`,
    name: def.capital ?? def.name,
    provinceId: def.id,
    tier: seat ? wg.synthesizedSeatTier : wg.synthesizedTier,
    culture: provinceCulture(data, def),
    faith: provinceFaith(data, ctx, def),
    pos: [def.anchor[0], def.anchor[1]],
    coastal,
  };
}

/** Creates a member faction (jarl, clan, city …) for a province, with its house. */
function memberFaction(
  draft: GameState,
  ctx: SimContext,
  rng: Rng,
  data: WorldData,
  def: ProvinceDef,
  kind: FactionKind,
  realm: KingdomDef | undefined,
  houses: House[],
  colorIndex: number,
  out: Generated,
  rule: PoliticsRule,
  seatId: FactionId | undefined,
): FactionId {
  const culture = realm?.culture ?? provinceCulture(data, def);
  const faith = realm?.faith ?? provinceFaith(data, ctx, def);
  const pos = { x: def.anchor[0], y: def.anchor[1] };
  const house = generateHouse(draft, ctx, rng, {
    culture,
    faith,
    rulerAge: drawRange(rng, rule.rulerAge),
    spouseCandidates: nearbyHouses(houses, faith, pos, SPOUSE_REACH_CELLS),
  });
  house.pos = pos;
  houses.push(house);
  const sworn = seatId !== undefined && rng.chance(rule.swornChance);
  const [armour, weapons] = equipment(ctx, culture, 'village');
  const f = houseFaction(draft, ctx, house, {
    kind,
    name: def.name,
    colorIndex,
    ...(realm !== undefined ? { kingdomId: realm.id } : {}),
    homeProvinceId: out.provinceOf[def.id] as ProvinceId,
    ...(sworn && seatId !== undefined ? { liegeId: seatId } : {}),
    armour,
    weapons,
  });
  out.houses[f.id] = house;
  out.factionIds.push(f.id);
  out.regionOf[f.id] = def.regionId;
  return f.id;
}

/** Creates one settlement from its geography definition. */
function placeSettlement(
  draft: GameState,
  ctx: SimContext,
  rng: Rng,
  data: WorldData,
  def: SettlementDef,
  provinceId: ProvinceId,
  factionId: FactionId,
  provinceCapital: boolean,
  seat: boolean,
  imperialSeat: boolean,
  out: Generated,
): Settlement {
  const pop = drawPop(ctx, rng, def.culture, def.tier, provinceCapital);
  const economy = drawEconomy(ctx, rng, def.culture, seat);
  const silverRange = ctx.balance.settlementTiers[def.tier].silver;
  const silver = Math.round(rng.range(silverRange[0], silverRange[1]) * (ctx.balance.economy.prosperity[economy] ?? 1));
  const fortTier = drawFort(ctx, rng, def, imperialSeat);
  const [armourTier, weaponTier] = equipment(ctx, def.culture, def.tier);
  const garrison = drawGarrison(ctx, rng, def.culture, def.tier, pop, seat);
  // A placeholder leader id is replaced in assignLeaders (createSettlement would otherwise make one now,
  // drawing names in settlement order rather than house order).
  const holder = out.houses[factionId]?.rulerId ?? draft.factions[factionId]?.rulerId ?? draft.player.rulerId;
  const s = createSettlement(draft, ctx, {
    culture: def.culture,
    faith: def.faith,
    provinceId,
    factionId,
    leaderId: holder,
    tier: def.tier,
    pop,
    mapPos: { x: def.pos[0], y: def.pos[1] },
    name: def.name,
    economy,
    silver,
    garrison,
    fortTier,
    armourTier,
    weaponTier,
    buildings: startBuildings(ctx, def, fortTier),
    coastal: def.coastal,
    isCapital: provinceCapital,
  });
  s.geoId = def.id;
  return s;
}

/** Leaders of a faction's settlements: the ruler at the seat, adult kin as governors, then local leaders. */
export function assignLeaders(draft: GameState, ctx: SimContext, rng: Rng, factionId: FactionId, house: House | undefined): void {
  const f = draft.factions[factionId];
  if (!f) return;
  const wg = ctx.tunables.world.worldgen;
  const ruler = draft.characters[f.rulerId];
  const homeCapital = f.homeProvinceId !== undefined ? draft.provinces[f.homeProvinceId]?.capitalId : undefined;
  const seatId = homeCapital !== undefined && f.holdingIds.includes(homeCapital) ? homeCapital : f.holdingIds[0];
  const kin = house !== undefined && wg.family.kinGovernors ? adultKin(draft, house, ctx.hour, ctx.balance.character.adultAge).filter((id) => id !== f.rulerId) : [];
  // Court: living house members without another place live at the seat.
  if (house && seatId !== undefined) {
    for (const id of [house.rulerId, ...house.members]) {
      const c = draft.characters[id];
      if (c?.alive && c.location.kind === 'none') c.location = { kind: 'settlement', id: seatId };
    }
  }
  for (const sid of f.holdingIds) {
    const s = draft.settlements[sid];
    if (!s) continue;
    if (sid === seatId && ruler) {
      s.leaderId = ruler.id;
      ruler.location = { kind: 'settlement', id: sid };
      ruler.role = { kind: 'ruler', holdingId: sid, factionId };
      continue;
    }
    const governor = s.tier !== 'hamlet' && s.tier !== 'cloister' ? kin.shift() : undefined;
    if (governor !== undefined) {
      const c = draft.characters[governor];
      if (c) {
        s.leaderId = governor;
        c.location = { kind: 'settlement', id: sid };
        c.role = { kind: 'governor', holdingId: sid, factionId };
        continue;
      }
    }
    const age = rng.int(ctx.balance.defaults.leaderAge[0], ctx.balance.defaults.leaderAge[1]);
    const leader = generatePerson(draft, ctx, rng, { culture: s.culture, faith: s.faith, age, profile: 'leader', factionId, personality: true });
    leader.location = { kind: 'settlement', id: sid };
    leader.role = { kind: 'npc', holdingId: sid, factionId };
    s.leaderId = leader.id;
  }
}

/** Ids of the AI rulers older than `minAge` (Rival candidates). */
export function rulersOfAge(draft: GameState, ids: readonly FactionId[], minAge: number, now: number): FactionId[] {
  return ids.filter((id) => {
    const r = draft.characters[draft.factions[id]?.rulerId as CharId];
    return r !== undefined && r.alive && ageAt(r, now) >= minAge;
  });
}

/** The settlement flagged as the placeholder home (core lifecycle), if still present. */
export function placeholderHome(draft: GameState): SettlementId | undefined {
  const v = draft.flags[PLACEHOLDER_HOME_FLAG];
  return typeof v === 'string' && Object.hasOwn(draft.settlements, v) ? (v as SettlementId) : undefined;
}
