/**
 * Builds a BattleSetup from GameState for the `startBattle` effect (§13.2–§13.4, §12.3): squads
 * from fleets (men + leader + lieutenants), armies (their squads), settlement garrisons (plus
 * militia behind walls), explicit squads and relic-site guardians; equipment tiers; named leaders'
 * battle numbers (skills, trait/feat modifier bags, gear and relics); omens and weather read
 * defensively from other modules' state; the place's map template, map seed, walls, loot and the
 * raid timer. Reads state only; never writes it. Deterministic in (state, content, effect, ids).
 *
 * Squads (§12.3): the player's side has one squad per named leader present (the player first,
 * then lieutenants by Command), up to 8, each of ONE unit type and at most 20 + 6 × Command men
 * (max 80); men no leader can take stay with the ships. Sides without named leaders (AI forces, a
 * garrison whose lord is away) form squads under unnamed sergeants, sized so they fit the squad
 * limit; an AI chief leads his best unit as his bodyguard.
 */
import type { Content } from '@content/index';
import type { BattleTemplateId } from '@content/schemas/tunables/battle';
import { EffectError } from '@sim/core/effects';
import { hashString32 } from '@sim/core/rng';
import type {
  BattleId,
  BattleKind,
  BattleSetup,
  BattleWeather,
  Character,
  CharId,
  CultureId,
  FactionId,
  FleetId,
  FormationId,
  GameState,
  OmenId,
  Settlement,
  SideSetup,
  Site,
  Squad,
  UnitTypeId,
  WindStrength,
} from '@sim/core/state';
import { battleData, isKnownUnit, squadCap, unitOf, type BattleData } from './data';
import type { BattleLeaderInfo, BattleLootPool, BattleSideKey, BattleSideRef, SquadSourceShare, StartBattleEffect } from './types';
import { splitBy } from './util';

/** Battle kinds fought at a settlement (its garrison, walls, loot and guard plan). */
export const SETTLEMENT_BATTLE_KINDS: readonly string[] = ['raid', 'assault', 'cloister', 'fortress', 'defense'];
/** Kinds fought away from settlements whose map comes from `templateByKind`. */
const OPEN_KINDS: readonly string[] = ['field', 'ambush', 'beach', 'sortie'];
const WIND_KEYS: readonly WindStrength[] = ['calm', 'light', 'fresh', 'strong', 'gale'];

/** Ids the effect gets from the operation context. */
export interface BattleSetupIds {
  id: BattleId;
  /** Engine seed (`seedStringFrom(ctx.rng('battle'))`). */
  seed: string;
}

/** Men of one unit type available to a side, with where they came from (in order). */
export interface UnitPool {
  unit: UnitTypeId;
  men: number;
  sources: SquadSourceShare[];
}

interface Gathered {
  key: BattleSideKey;
  ref: BattleSideRef;
  factionId: FactionId;
  culture: CultureId;
  isPlayer: boolean;
  armourTier: number;
  weaponTier: number;
  pool: UnitPool[];
  /** Squads that keep their own leaders (armies, explicit squads). */
  fixed: Squad[];
  /** Named leaders free to lead squads from the pool (ordered). */
  leaders: CharId[];
  chiefId?: CharId;
  fleetIds: FleetId[];
  settlement?: Settlement;
  moraleMods: number;
}

// ---------------------------------------------------------------------------------------------
// Loose reads of other modules' state (never imported; shapes checked at runtime).

type Loose = Record<string, unknown>;
function rec(v: unknown): Loose | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Loose) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The battle omen in force for the player (faith: `player.house.omens.battle`) or a faction. */
export function omenInForce(state: GameState, factionId: FactionId): OmenId | undefined {
  const holder = factionId === state.player.factionId ? rec(state.player.house) : rec(state.factions[factionId]);
  const reading = rec(rec(holder?.omens)?.battle);
  const omen = str(reading?.omen);
  const until = num(reading?.untilHour);
  if (omen === undefined || (until !== undefined && state.time.hour >= until)) return undefined;
  return omen === 'ill' || omen === 'uncertain' || omen === 'fair' || omen === 'blessed' ? omen : undefined;
}

/** True when the faction holds a relic whose id (`rel_<key>`) or definition id is in `keys`. */
export function factionHoldsRelic(state: GameState, factionId: FactionId, keys: readonly string[]): boolean {
  if (keys.length === 0) return false;
  for (const id of Object.keys(state.relics)) {
    const r = rec(state.relics[id as keyof typeof state.relics]);
    if (!r || r.holder !== factionId) continue;
    const bare = id.startsWith('rel_') ? id.slice(4) : id;
    const def = str(r.defId) ?? str(r.relicId) ?? str(r.def);
    if (keys.includes(bare) || (def !== undefined && keys.includes(def))) return true;
  }
  return false;
}

/** Wind and rain at the place: its sea zone in state.weather (read defensively), else the default. */
export function weatherAt(state: GameState, data: BattleData, places: readonly unknown[], override: Partial<BattleWeather> | undefined, night: boolean): BattleWeather {
  const t = data.t;
  let windDir = t.defaultWind.dir;
  let windStr = t.windStrength[t.defaultWind.str];
  let rain = false;
  const zones = rec(rec(state.weather)?.zones);
  let zone: Loose | undefined;
  let pos: Loose | undefined;
  for (const raw of places) {
    const place = rec(raw);
    if (!place) continue;
    pos ??= rec(place.mapPos) ?? rec(place.pos);
    const zoneId = str(place.seaZoneId) ?? str(place.zoneId) ?? str(place.seaZone);
    if (!zone && zones && zoneId !== undefined && Object.hasOwn(zones, zoneId)) zone = rec(zones[zoneId]);
  }
  if (zone) {
    windDir = num(zone.windDir) ?? windDir;
    const s = str(zone.windStr);
    if (s !== undefined && (WIND_KEYS as readonly string[]).includes(s)) windStr = t.windStrength[s as WindStrength];
    if (zone.rain === true) rain = true;
  }
  const px = num(pos?.x);
  const py = num(pos?.y);
  const storms = rec(state.weather)?.storms;
  if (px !== undefined && py !== undefined && Array.isArray(storms)) {
    for (const raw of storms) {
      const c = rec(raw);
      const cp = rec(c?.pos);
      const r = num(c?.radius) ?? 0;
      const cx = num(cp?.x);
      const cy = num(cp?.y);
      if (cx === undefined || cy === undefined) continue;
      if ((cx - px) * (cx - px) + (cy - py) * (cy - py) <= r * r) rain = true;
    }
  }
  return {
    windDir: override?.windDir ?? windDir,
    windStr: override?.windStr ?? windStr,
    rain: override?.rain ?? rain,
    night: override?.night ?? night,
  };
}

// ---------------------------------------------------------------------------------------------
// Leaders

function modifierSum(content: Content, c: Character, key: string): number {
  let v = 0;
  for (const id of c.traits) {
    const m = (content.traits as Record<string, { modifiers: Record<string, number> } | undefined>)[id]?.modifiers;
    if (m && typeof m[key] === 'number') v += m[key];
  }
  for (const id of c.feats) {
    const m = (content.feats as Record<string, { modifiers: Record<string, number> } | undefined>)[id]?.modifiers;
    if (m && typeof m[key] === 'number') v += m[key];
  }
  return v;
}

function cultureModifier(content: Content, culture: string, key: string): number {
  const def = (content.cultures as Record<string, { bonuses: { modifiers: Record<string, number> }[] } | undefined>)[culture];
  let v = 0;
  for (const b of def?.bonuses ?? []) if (typeof b.modifiers[key] === 'number') v += b.modifiers[key];
  return v;
}

/** A character able to fight: alive, free, not dying. */
export function canLead(state: GameState, id: CharId | undefined): id is CharId {
  if (id === undefined) return false;
  const c = state.characters[id];
  return c !== undefined && c.alive && c.location.kind !== 'captive' && c.health.wound !== 'mortal';
}

/** True when a settlement's lord is at home (or nowhere in particular) to lead its defence. */
function isHome(state: GameState, id: CharId, settlementId: string): boolean {
  const c = state.characters[id];
  if (!c) return false;
  return c.location.kind === 'none' || (c.location.kind === 'settlement' && c.location.id === settlementId);
}

/** The battle numbers of a named leader (§31.8/§31.10 inputs). */
export function leaderInfoOf(state: GameState, content: Content, data: BattleData, id: CharId, role: BattleLeaderInfo['role']): BattleLeaderInfo {
  const c = state.characters[id]!;
  const skill = (k: string) => Math.max(0, (c.skills as Record<string, number | undefined>)[k] ?? 0) + modifierSum(content, c, `skill.${k}`);
  const items = c.items ?? [];
  return {
    name: c.byname !== undefined ? `${c.name} ${c.byname}` : c.name,
    command: skill('command'),
    melee: skill('melee'),
    archery: skill('archery'),
    wildcraft: skill('wildcraft'),
    moraleMod: modifierSum(content, c, 'morale.ownSquad'),
    defPct: modifierSum(content, c, 'squad.ownDefPct'),
    hpPct: Math.max(1, Math.min(100, c.health.hpPct)),
    isPlayer: id === state.player.rulerId,
    acceptsChallenge: c.traits.some((tr) => data.t.challenge.acceptTraits.includes(tr)),
    warHorn: items.some((it) => data.t.warHornItems.includes(it)),
    role,
  };
}

// ---------------------------------------------------------------------------------------------
// Pools and squads

function poolAdd(pool: UnitPool[], unit: UnitTypeId, men: number, src: Omit<SquadSourceShare, 'men'>): void {
  const n = Math.max(0, Math.floor(men));
  if (n <= 0) return;
  let p = pool.find((x) => x.unit === unit);
  if (!p) {
    p = { unit, men: 0, sources: [] };
    pool.push(p);
  }
  p.men += n;
  const same = p.sources.find((s) => s.kind === src.kind && s.id === src.id);
  if (same) same.men += n;
  else p.sources.push({ ...src, men: n });
}

/** Takes `n` men from a pool entry, consuming its sources in order; returns the shares taken. */
export function poolTake(p: UnitPool, n: number): SquadSourceShare[] {
  const out: SquadSourceShare[] = [];
  let left = Math.min(n, p.men);
  for (const s of p.sources) {
    if (left <= 0) break;
    const k = Math.min(left, s.men);
    if (k <= 0) continue;
    s.men -= k;
    left -= k;
    out.push(s.id !== undefined ? { kind: s.kind, id: s.id, men: k } : { kind: s.kind, men: k });
  }
  const took = out.reduce((a, s) => a + s.men, 0);
  p.men -= took;
  return out;
}

function defaultFormation(data: BattleData, unit: UnitTypeId): FormationId {
  return unitOf(data, unit).formations[0] ?? 'line';
}

/** Unit strength used to give a chief (or the player) the best men. */
function strength(data: BattleData, unit: UnitTypeId): number {
  const u = unitOf(data, unit);
  return u.atk + u.def + u.rangedAtk * 0.6;
}

/**
 * The player's default Groups layout (§12.3 "Default" button): leaders in order each take the unit
 * with the most men left (the first leader takes the strongest unit as a bodyguard), up to their cap.
 */
export function assignLeaders(data: BattleData, leaders: readonly { id: CharId; command: number }[], pool: UnitPool[]): Squad[] {
  const squads: Squad[] = [];
  leaders.forEach((l, k) => {
    const open = pool.filter((p) => p.men > 0);
    if (open.length === 0) return;
    let pick = open[0]!;
    for (const p of open) {
      const better = k === 0 ? strength(data, p.unit) > strength(data, pick.unit) : p.men > pick.men;
      if (better) pick = p;
    }
    const cap = squadCap(data.balance, l.command, unitOf(data, pick.unit));
    const sources = poolTake(pick, cap);
    const men = sources.reduce((a, s) => a + s.men, 0);
    if (men > 0) squads.push({ leaderId: l.id, unit: pick.unit, men, vetStars: 0, formation: defaultFormation(data, pick.unit), sources });
  });
  return squads;
}

/**
 * Squads under unnamed sergeants for the whole pool, sized from `enemySquadMen` up to the squad
 * cap so that at most `slots` squads form (the weakest units are left out if even that is not
 * enough). `leaderRef` is the id squads are booked under.
 */
export function sergeantSquads(data: BattleData, pool: UnitPool[], slots: number, leaderRef: CharId): Squad[] {
  const open = pool.filter((p) => p.men > 0).sort((a, b) => strength(data, b.unit) - strength(data, a.unit) || b.men - a.men || (a.unit < b.unit ? -1 : 1));
  if (open.length === 0 || slots <= 0) return [];
  const maxCap = data.balance.squads.maxCap;
  const capOf = (p: UnitPool) => {
    const u = unitOf(data, p.unit);
    return u.single ? 1 : u.maxPerSquad > 0 ? Math.min(u.maxPerSquad, maxCap) : maxCap;
  };
  let size = data.t.enemySquadMen;
  const count = (sz: number) => open.reduce((a, p) => a + Math.ceil(p.men / Math.min(sz, capOf(p))), 0);
  while (count(size) > slots && size < maxCap) size = Math.min(maxCap, size + 5);
  const squads: Squad[] = [];
  for (const p of open) {
    const u = unitOf(data, p.unit);
    const each = Math.min(size, capOf(p));
    const n = u.single ? p.men : Math.ceil(p.men / each);
    const sizes = u.single ? new Array<number>(n).fill(1) : splitBy(p.men, new Array<number>(n).fill(1));
    for (const men of sizes) {
      if (squads.length >= slots) break;
      const sources = poolTake(p, men);
      squads.push({ leaderId: leaderRef, unit: p.unit, men: u.single ? 1 : men, vetStars: 0, formation: defaultFormation(data, p.unit), sources, unnamed: true });
    }
  }
  return squads;
}

function gather(state: GameState, content: Content, data: BattleData, ref: BattleSideRef, key: BattleSideKey): Gathered {
  const what = `startBattle.${key}`;
  const fleet = ref.fleetId !== undefined ? state.fleets[ref.fleetId] : undefined;
  if (ref.fleetId !== undefined && !fleet) throw new EffectError(`${what}: unknown fleet ${ref.fleetId}`);
  const army = ref.armyId !== undefined ? state.armies[ref.armyId] : undefined;
  if (ref.armyId !== undefined && !army) throw new EffectError(`${what}: unknown army ${ref.armyId}`);
  const settlement = ref.settlementId !== undefined ? state.settlements[ref.settlementId] : undefined;
  if (ref.settlementId !== undefined && !settlement) throw new EffectError(`${what}: unknown settlement ${ref.settlementId}`);
  const factionId = ref.factionId ?? fleet?.ownerId ?? army?.ownerId ?? settlement?.factionId ?? (data.t.wildFactionId as FactionId);
  const faction = state.factions[factionId];
  const culture = (ref.culture ?? settlement?.culture ?? faction?.culture ?? 'skarn') as CultureId;
  const isPlayer = ref.isPlayer ?? factionId === state.player.factionId;
  const garrisonOnly = settlement !== undefined && !fleet && !army;
  const armourTier = ref.armourTier ?? (garrisonOnly ? settlement.armourTier : faction?.armouryTier) ?? 1;
  const weaponTier = ref.weaponTier ?? (garrisonOnly ? settlement.weaponTier : faction?.weaponTier) ?? 1;

  const pool: UnitPool[] = [];
  // Unit ids the battle does not know (a mod's or a future module's) stay out of the fight.
  const addRecord = (men: Record<string, number>, src: Omit<SquadSourceShare, 'men'>) => {
    for (const unit of Object.keys(men)) if (isKnownUnit(content, unit)) poolAdd(pool, unit, men[unit] ?? 0, src);
  };
  if (fleet) addRecord(fleet.men, { kind: 'fleet', id: fleet.id });
  if (settlement) addRecord(settlement.garrison, { kind: 'settlement', id: settlement.id });

  const fixed: Squad[] = [];
  if (army) {
    for (const sq of army.squads) {
      if (!isKnownUnit(content, sq.unit) || sq.men <= 0) continue;
      const leads = canLead(state, sq.leaderId) && sq.unnamed !== true;
      const s: Squad = { leaderId: sq.leaderId, unit: sq.unit, men: Math.floor(sq.men), vetStars: sq.vetStars, formation: sq.formation, sources: [{ kind: 'army', id: army.id, men: Math.floor(sq.men) }] };
      if (!leads) s.unnamed = true;
      fixed.push(s);
    }
  }
  for (const sq of ref.squads ?? []) {
    if (!isKnownUnit(content, sq.unit)) throw new EffectError(`${what}: unknown unit ${sq.unit}`);
    const given = sq.sources ?? [];
    const consistent = given.length > 0 && given.reduce((a, x) => a + x.men, 0) === sq.men;
    const s: Squad = { ...sq, sources: consistent ? given.map((x) => ({ ...x })) : [{ kind: 'explicit', men: sq.men }] };
    if (!canLead(state, sq.leaderId)) s.unnamed = true;
    fixed.push(s);
  }

  // Named leaders present.
  const named: CharId[] = [];
  const push = (id: CharId | undefined) => {
    if (canLead(state, id) && !named.includes(id)) named.push(id);
  };
  if (ref.characterIds) for (const id of ref.characterIds) push(id);
  else {
    push(fleet?.leaderId);
    for (const id of fleet?.lieutenantIds ?? []) push(id);
    push(army?.leaderId);
    if (garrisonOnly && isHome(state, settlement.leaderId, settlement.id)) push(settlement.leaderId);
  }
  const leadingFixed = fixed.filter((s) => s.unnamed !== true).map((s) => s.leaderId);
  const leaders = named.filter((id) => !leadingFixed.includes(id));

  let chiefId: CharId | undefined = ref.chiefId;
  if (chiefId === undefined) {
    const defending = key === 'defender';
    const lord = settlement && isHome(state, settlement.leaderId, settlement.id) ? settlement.leaderId : undefined;
    const main = settlement && defending ? (lord ?? army?.leaderId ?? fleet?.leaderId) : (army?.leaderId ?? fleet?.leaderId);
    // The player's own side has a chief only when it defends (the attacker's chief is their target).
    if (!isPlayer || defending) chiefId = canLead(state, main) ? main : (named[0] ?? leadingFixed[0]);
  }
  if (chiefId !== undefined && !canLead(state, chiefId)) chiefId = undefined;

  const g: Gathered = {
    key,
    ref,
    factionId,
    culture,
    isPlayer,
    armourTier,
    weaponTier,
    pool,
    fixed,
    leaders,
    fleetIds: fleet ? [fleet.id] : [],
    moraleMods: ref.moraleMods ?? 0,
  };
  if (chiefId !== undefined) g.chiefId = chiefId;
  if (settlement) g.settlement = settlement;
  return g;
}

function siteOf(state: GameState, e: StartBattleEffect): Site | undefined {
  if (e.siteId === undefined) return undefined;
  const site = state.sites[e.siteId];
  if (!site) throw new EffectError(`startBattle: unknown site ${e.siteId}`);
  return site;
}

/** The map template for a battle (§13.3). */
export function templateFor(data: BattleData, e: Pick<StartBattleEffect, 'kind' | 'mapTemplate'>, settlement: Settlement | undefined, site: Site | undefined, mapSeed: string): BattleTemplateId {
  const t = data.t;
  if (e.mapTemplate !== undefined && Object.hasOwn(t.templates, e.mapTemplate)) return e.mapTemplate as BattleTemplateId;
  const kind: string = e.kind;
  if (kind === 'guardian' && site) return t.templateBySiteKind[site.kind] ?? t.templateByKind.guardian ?? 'caveMouth';
  if (kind === 'field' && !settlement) {
    const total = t.fieldTemplates.reduce((a, [, w]) => a + w, 0);
    let r = (hashString32(`${mapSeed}|template`) / 4294967296) * total;
    for (const [tpl, w] of t.fieldTemplates) {
      if (r < w) return tpl;
      r -= w;
    }
    return t.fieldTemplates[0]![0];
  }
  if (OPEN_KINDS.includes(kind)) return t.templateByKind[kind] ?? 'field';
  if (kind === 'cloister') return 'cloister';
  if (kind === 'fortress') return 'fortress';
  if (settlement) return t.templateByTier[settlement.tier] ?? 'village';
  return t.templateByKind[kind] ?? 'field';
}

/** Portable wealth of a settlement (§11.6): its silver and the portable share of its market stock. */
export function settlementLoot(state: GameState, content: Content, s: Settlement): BattleLootPool {
  const share = content.balance.loot.goodsPortableShare;
  const goods: BattleLootPool['goods'] = {};
  const stock = state.markets[s.id]?.stock ?? {};
  for (const good of Object.keys(stock) as (keyof typeof stock)[]) {
    const tons = stock[good] ?? 0;
    if (tons > 0) goods[good] = Math.round(tons * share * 100) / 100;
  }
  return { silver: Math.max(0, Math.floor(s.silver)), goods };
}

/** Builds the setup for a `startBattle` effect (throws EffectError for bad references). */
export function buildBattleSetup(state: GameState, content: Content, e: StartBattleEffect, ids: BattleSetupIds): BattleSetup {
  const data = battleData(content);
  const b = data.b;
  const t = data.t;
  const kind: BattleKind = e.kind;
  const settlementId = e.settlementId ?? e.defender.settlementId ?? e.attacker.settlementId;
  const settlement = settlementId !== undefined ? state.settlements[settlementId] : undefined;
  if (settlementId !== undefined && !settlement) throw new EffectError(`startBattle: unknown settlement ${settlementId}`);
  const site = siteOf(state, e);
  const atSettlement = settlement !== undefined && SETTLEMENT_BATTLE_KINDS.includes(kind);
  // A settlement battle whose defenders the caller left open is fought by the place's garrison.
  const d0 = e.defender;
  const openDefence = atSettlement && settlement && d0.fleetId === undefined && d0.armyId === undefined && d0.settlementId === undefined && (d0.squads ?? []).length === 0;
  const defRef: BattleSideRef = openDefence && settlement && (d0.factionId === undefined || d0.factionId === settlement.factionId) ? { ...d0, settlementId: settlement.id } : d0;
  const A = gather(state, content, data, e.attacker, 'attacker');
  const D = gather(state, content, data, defRef, 'defender');
  if (A.isPlayer && D.isPlayer) throw new EffectError('startBattle: the player cannot fight both sides');
  const fortBase = e.fortTier ?? (atSettlement && settlement ? settlement.fortTier : 0);
  const shield = atSettlement && settlement && factionHoldsRelic(state, settlement.factionId, t.weepingShieldRelics) ? 1 : 0;
  const fortTier = Math.min(4, fortBase + (fortBase > 0 ? shield : 0)) as 0 | 1 | 2 | 3 | 4;

  // Militia: 10% of the people stand to the walls (§13.2).
  if (atSettlement && settlement && fortTier >= 1 && t.militiaKinds.includes(kind) && settlement.pop > 0) {
    const unit = t.militiaUnitByCulture[settlement.culture] ?? t.defaultMilitiaUnit;
    const men = Math.round(settlement.pop * b.militiaPopShare);
    if (isKnownUnit(content, unit) && men > 0) poolAdd(D.pool, unit, men, { kind: 'explicit', id: settlement.id });
  }
  // Guardians of a relic site (§13.2) when the caller gave none.
  if (kind === 'guardian' && site && D.pool.length === 0 && D.fixed.length === 0) {
    for (const [unit, men] of t.guardiansBySiteKind[site.kind] ?? []) {
      if (isKnownUnit(content, unit)) D.fixed.push({ leaderId: 'chr_guardian', unit, men, vetStars: 0, formation: defaultFormation(data, unit), sources: [{ kind: 'explicit', men }], unnamed: true });
    }
  }

  const leaders: Record<string, BattleLeaderInfo> = {};
  const sides: [SideSetup, SideSetup] = [A, D].map((g): SideSetup => {
    const max = g.isPlayer ? b.maxPlayerSquads : b.maxEnemySquads;
    const ordered = [...g.leaders].sort((x, y) => {
      const px = x === state.player.rulerId ? 0 : x === g.chiefId ? 1 : 2;
      const py = y === state.player.rulerId ? 0 : y === g.chiefId ? 1 : 2;
      if (px !== py) return px - py;
      const cx = state.characters[x]?.skills.command ?? 0;
      const cy = state.characters[y]?.skills.command ?? 0;
      return cy - cx || (x < y ? -1 : x > y ? 1 : 0);
    });
    const fixed = g.fixed.slice(0, max);
    const slots = max - fixed.length;
    const assigned = assignLeaders(
      data,
      ordered.slice(0, Math.max(0, slots)).map((id) => ({ id, command: leaderInfoOf(state, content, data, id, 'leader').command })),
      g.pool,
    );
    const ref: CharId = g.chiefId ?? ordered[0] ?? fixed[0]?.leaderId ?? 'chr_none';
    // Men no leader took: the player's spare crews stay with the ships, but a garrison and its militia
    // fight under their sergeants; every other side forms sergeant squads from all its men.
    let rest = g.pool;
    if (g.isPlayer && assigned.length > 0) {
      rest = [];
      for (const p of g.pool) for (const src of p.sources) if (src.men > 0 && src.kind !== 'fleet') poolAdd(rest, p.unit, src.men, src.id !== undefined ? { kind: src.kind, id: src.id } : { kind: src.kind });
    }
    const sergeants = sergeantSquads(data, rest, slots - assigned.length, ref);
    if (rest !== g.pool) for (const p of g.pool) for (const src of p.sources) if (src.kind !== 'fleet') src.men = 0;
    for (const p of g.pool) p.men = p.sources.reduce((a, x) => a + x.men, 0);
    const squads = [...fixed, ...assigned, ...sergeants];
    for (const sq of squads) {
      if (sq.unnamed === true || Object.hasOwn(leaders, sq.leaderId) || !canLead(state, sq.leaderId)) continue;
      const role: BattleLeaderInfo['role'] = sq.leaderId === state.player.rulerId ? 'player' : sq.leaderId === g.chiefId ? 'chief' : g.isPlayer ? 'lieutenant' : 'leader';
      leaders[sq.leaderId] = leaderInfoOf(state, content, data, sq.leaderId, role);
    }
    // The chief stands with his bodyguard: if he leads no squad, he takes the strongest one.
    if (g.chiefId !== undefined && !squads.some((s) => s.leaderId === g.chiefId && s.unnamed !== true)) {
      const guard = squads.filter((s) => s.unnamed === true).sort((x, y) => strength(data, y.unit) - strength(data, x.unit) || y.men - x.men)[0];
      if (guard) {
        guard.leaderId = g.chiefId;
        delete guard.unnamed;
        leaders[g.chiefId] = leaderInfoOf(state, content, data, g.chiefId, g.chiefId === state.player.rulerId ? 'player' : 'chief');
      }
    }
    // What the Groups screen may re-assign (the player's side).
    const available: Record<UnitTypeId, number> = {};
    const pools: NonNullable<SideSetup['pools']> = [];
    if (g.isPlayer) {
      for (const sq of squads) {
        if (sq.sources?.some((s) => s.kind === 'army' || s.kind === 'explicit')) continue;
        available[sq.unit] = (available[sq.unit] ?? 0) + sq.men;
      }
      for (const p of g.pool) if (p.men > 0) available[p.unit] = (available[p.unit] ?? 0) + p.men;
      const byKey: Record<string, NonNullable<SideSetup['pools']>[number]> = {};
      const addPool = (s: SquadSourceShare, unit: UnitTypeId) => {
        if (s.kind !== 'fleet' && s.kind !== 'settlement') return;
        const k = `${s.kind}|${s.id ?? ''}`;
        let entry = byKey[k];
        if (!entry) {
          entry = s.id !== undefined ? { kind: s.kind, id: s.id, men: {} } : { kind: s.kind, men: {} };
          byKey[k] = entry;
          pools.push(entry);
        }
        entry.men[unit] = (entry.men[unit] ?? 0) + s.men;
      };
      for (const sq of squads) for (const s of sq.sources ?? []) addPool(s, sq.unit);
      for (const p of g.pool) for (const s of p.sources) if (s.men > 0) addPool(s, p.unit);
    }
    const ss: SideSetup = {
      factionId: g.factionId,
      squads,
      armourTier: g.armourTier,
      weaponTier: g.weaponTier,
      moraleMods: g.moraleMods + (factionHoldsRelic(state, g.factionId, t.warHornItems) ? b.morale.warHorn : 0),
      isPlayer: g.isPlayer,
      culture: g.culture,
      hasRam: g.ref.hasRam === true,
      hasPitch: g.ref.hasPitch ?? g.fleetIds.some((id) => (state.fleets[id]?.cargo.pitch ?? 0) > 0),
      ladders: g.ref.ladders === true,
    };
    if (g.chiefId !== undefined) ss.chiefId = g.chiefId;
    // Fire arrows burn the pitch in the side's holds (counted when the caller did not decide).
    if (g.ref.hasPitch === undefined && g.fleetIds.length > 0) ss.pitchT = Math.round(g.fleetIds.reduce((a, id) => a + Math.max(0, state.fleets[id]?.cargo.pitch ?? 0), 0) * 100) / 100;
    if (g.ref.fleetId !== undefined) ss.fleetId = g.ref.fleetId;
    if (g.ref.armyId !== undefined) ss.armyId = g.ref.armyId;
    if (g.settlement) ss.settlementId = g.settlement.id;
    let fireSpread = 0;
    for (const sq of squads) if (sq.unnamed !== true && canLead(state, sq.leaderId)) fireSpread = Math.max(fireSpread, modifierSum(content, state.characters[sq.leaderId]!, 'fire.spreadPct'));
    if (fireSpread !== 0) ss.fireSpreadPct = fireSpread;
    if (factionHoldsRelic(state, g.factionId, t.emberCloakItems) || squads.some((sq) => sq.unnamed !== true && (state.characters[sq.leaderId]?.items ?? []).some((it) => t.emberCloakItems.includes(it)))) ss.emberCloak = true;
    const cav = cultureModifier(content, g.culture, 'battle.cavalryMoralePct');
    if (cav !== 0) ss.cavalryMoralePct = cav;
    if (g.isPlayer && state.player.house.dread >= b.morale.dreadDrakkarMin && g.fleetIds.some((id) => (state.fleets[id]?.shipIds ?? []).some((sid) => state.ships[sid]?.type === 'drakkar'))) ss.dreadDrakkar = true;
    if (g.isPlayer) {
      ss.available = available;
      ss.pools = pools;
      ss.leaderIds = [...ordered, ...fixed.filter((s) => s.unnamed !== true).map((s) => s.leaderId)].filter((id, i, a) => a.indexOf(id) === i);
      for (const id of ss.leaderIds) if (!Object.hasOwn(leaders, id)) leaders[id] = leaderInfoOf(state, content, data, id, id === state.player.rulerId ? 'player' : 'lieutenant');
    }
    return ss;
  }) as [SideSetup, SideSetup];
  const [attacker, defender] = sides;

  const mapSeed = `${state.meta.seed}|${settlementId ?? e.siteId ?? ids.id}`;
  const approach = e.approach ?? 'dawn';
  const places: unknown[] = [settlement, site, ...A.fleetIds.map((id) => state.fleets[id]), ...D.fleetIds.map((id) => state.fleets[id])];
  const template = templateFor(data, e, atSettlement ? settlement : undefined, site, mapSeed);
  const playerSide: BattleSideKey | null = attacker.isPlayer ? 'attacker' : defender.isPlayer ? 'defender' : null;
  const omenFaction = playerSide === 'defender' ? defender.factionId : attacker.factionId;
  const omen = e.omen ?? omenInForce(state, omenFaction);
  const difficulty = state.meta.difficulty;
  const setup: BattleSetup = {
    id: ids.id,
    kind,
    mapTemplate: template,
    seed: ids.seed,
    approach,
    attacker,
    defender,
    weather: weatherAt(state, data, places, e.weather, approach === 'night'),
    origin: e.origin,
    mapSeed,
    culture: (settlement?.culture ?? defender.culture ?? 'skarn') as CultureId,
    fortTier,
    leaders,
    difficulty,
    gentleMode: state.meta.options.gentleMode,
    playerPenalty: playerSide !== null && !state.meta.options.autoResolveFair ? (content.balance.autoresolve.playerPenalty[difficulty] ?? 0) : 0,
    coastal: e.coastal ?? (A.fleetIds.length > 0 && (settlement?.coastal ?? true)),
  };
  if (settlementId !== undefined) setup.settlementId = settlementId;
  if (e.siteId !== undefined) setup.siteId = e.siteId;
  if (site) setup.siteKind = site.kind;
  if (omen !== undefined) setup.omen = omen;
  if (settlement && atSettlement) {
    setup.settlementTier = settlement.tier;
    if (fortTier >= 4 && cultureModifier(content, settlement.culture, 'fort.oldStoneWalls') > 0) setup.oldStoneWalls = true;
    if (settlement.faith === 'lantern' || settlement.faith === 'goldenLantern' || Object.hasOwn(settlement.buildings, 'church')) setup.church = true;
    setup.loot = e.loot ?? settlementLoot(state, content, settlement);
    setup.lootCeiling = kind === 'raid' ? content.balance.loot.raidMaxShare : content.balance.loot.assaultMaxShare;
    // Monks carry the treasure away (§13.2 cloister raid).
    if (kind === 'cloister' || settlement.tier === 'cloister') {
      const m = t.monks;
      const men = Math.max(m.count[0], Math.min(m.count[1], Math.round(settlement.pop * m.popShare)));
      if (isKnownUnit(content, m.unit) && men > 0 && defender.squads.length < b.maxEnemySquads) {
        defender.squads.push({ leaderId: defender.chiefId ?? 'chr_none', unit: m.unit, men, vetStars: 0, formation: defaultFormation(data, m.unit), sources: [{ kind: 'explicit', men }], unnamed: true });
      }
    }
  } else if (e.loot) {
    setup.loot = e.loot;
    setup.lootCeiling = content.balance.loot.assaultMaxShare;
  }
  if (kind === 'raid') {
    const [lo, hi] = b.raidTimerS;
    const tierTimer = settlement ? t.raid.timerByTier[settlement.tier] : undefined;
    setup.timerS = Math.min(hi, Math.max(lo, e.timerS ?? tierTimer ?? lo));
  } else if (e.timerS !== undefined) setup.timerS = e.timerS;
  if (attacker.squads.length === 0) throw new EffectError('startBattle: the attackers have no men');
  if (defender.squads.length === 0) throw new EffectError('startBattle: the defenders have no men');
  return setup;
}

/** True when the player's party may choose a Night Raid (§13.4: Wolf-coats, or Wildcraft ≥ 5). */
export function canNightRaid(setup: BattleSetup, content: Content): boolean {
  const side = setup.attacker.isPlayer ? setup.attacker : setup.defender.isPlayer ? setup.defender : setup.attacker;
  const min = content.balance.battle.nightRaidWildcraftMin;
  for (const sq of side.squads) {
    if (unitOf(battleData(content), sq.unit).abilities.includes('hide')) return true;
    const l = sq.unnamed === true ? undefined : setup.leaders?.[sq.leaderId];
    if (l && l.wildcraft >= min) return true;
  }
  for (const id of side.leaderIds ?? []) if ((setup.leaders?.[id]?.wildcraft ?? 0) >= min) return true;
  return false;
}
