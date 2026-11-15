/**
 * Pure read helpers over GameState used by the economy module and the client: numeric record reads,
 * modifier sums (culture bonuses, traits, feats), effective skills, kin, war and pact checks, crowns,
 * building tiers and province tags. Other modules' data is read defensively: their fields may be
 * missing while those modules are mid-work or in old saves, and this module never imports another
 * module folder's runtime code.
 */
import type { Content } from '@content/index';
import { getGeography } from '@content/world';
import { clamp } from '@sim/core/dmath';
import { getRelation } from '@sim/core/factory';
import { isSafeRecordKey } from '@sim/core/keys';
import type {
  Character,
  CharId,
  CultureId,
  FactionId,
  GameState,
  MapPos,
  PactKind,
  Province,
  ProvinceId,
  Settlement,
  SettlementId,
  SkillId,
} from '@sim/core/state';

/** True for a plain (non-array, non-null) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Own-property read of a numeric record entry (0 when absent or not finite). */
export function recNum(record: Readonly<Partial<Record<string, number>>> | undefined, key: string): number {
  if (record === undefined || !isSafeRecordKey(key) || !Object.hasOwn(record, key)) return 0;
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Own-property read with a default (for multiplier tables). */
export function recOr(record: Readonly<Partial<Record<string, number>>> | undefined, key: string, fallback: number): number {
  if (record === undefined || !isSafeRecordKey(key) || !Object.hasOwn(record, key)) return fallback;
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Own-property lookup in a record of objects. */
export function recGet<T>(record: Readonly<Partial<Record<string, T>>> | undefined, key: string): T | undefined {
  if (record === undefined || !isSafeRecordKey(key) || !Object.hasOwn(record, key)) return undefined;
  return record[key];
}

/** Rounds to `decimals` places (deterministic: plain multiply/round/divide). */
export function roundTo(x: number, decimals: number): number {
  const f = POW10[decimals] ?? 1;
  return Math.round(x * f) / f;
}
const POW10 = [1, 10, 100, 1000, 10000, 100000, 1000000];

/** Straight-line distance between two map positions (cells). */
export function distance(a: MapPos, b: MapPos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Σ of a modifier key over a character's traits and feats (unknown ids are ignored). */
export function charModifier(content: Content, char: Character | undefined, key: string): number {
  if (!char) return 0;
  let sum = 0;
  for (const t of char.traits) {
    const def = recGet(content.traits, t);
    if (def) sum += recNum(def.modifiers, key);
  }
  for (const f of char.feats) {
    const def = recGet(content.feats, f);
    if (def) sum += recNum(def.modifiers, key);
  }
  return sum;
}

/** Σ of a modifier key over a culture's bonuses. */
export function cultureModifier(content: Content, culture: CultureId | undefined, key: string): number {
  if (culture === undefined) return 0;
  const def = recGet(content.cultures, culture);
  if (!def) return 0;
  let sum = 0;
  for (const bonus of def.bonuses) sum += recNum(bonus.modifiers, key);
  return sum;
}

/** A character's skill including `skill.<id>` trait and feat modifiers, clamped to [0, skillMax]. */
export function effectiveSkill(content: Content, char: Character | undefined, skill: SkillId): number {
  if (!char) return 0;
  const base = recNum(char.skills, skill);
  return clamp(base + charModifier(content, char, `skill.${skill}`), 0, content.balance.character.skillMax);
}

/**
 * Kin of a ruler (no lieutenant wage, §12.5): spouse, child, parent or sibling. Mirrors the
 * military module's rule so both modules agree on who is kin.
 */
export function isKinOf(state: GameState, charId: CharId, rulerId: CharId): boolean {
  if (charId === rulerId) return false;
  const c = state.characters[charId];
  const r = state.characters[rulerId];
  if (!c || !r) return false;
  const rf = r.family;
  const cf = c.family;
  if (rf.spouseIds.includes(charId) || rf.childIds.includes(charId)) return true;
  if (rf.fatherId === charId || rf.motherId === charId) return true;
  if (cf.fatherId !== undefined && cf.fatherId === rf.fatherId) return true;
  if (cf.motherId !== undefined && cf.motherId === rf.motherId) return true;
  return false;
}

/** True if a and b (factions) are at war (relation stance 'war'). */
export function atWar(state: GameState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  return getRelation(state, a, b)?.stance === 'war';
}

/** True if a and b have a pact of `kind` that has not expired. */
export function hasPact(state: GameState, a: string, b: string, kind: PactKind, hour: number): boolean {
  if (a === b) return false;
  const rel = getRelation(state, a, b);
  if (!rel) return false;
  for (const p of rel.pacts) if (p.kind === kind && (p.untilHour === undefined || p.untilHour > hour)) return true;
  return false;
}

/** True if the faction is at war with anyone. */
export function atWarWithAnyone(state: GameState, factionId: FactionId): boolean {
  for (const key in state.relations) {
    const rel = state.relations[key];
    if (rel && rel.stance === 'war' && (rel.a === factionId || rel.b === factionId)) return true;
  }
  return false;
}

/** Number of crowns the player holds (`<prefix><kingdomId>` flags, the military module's convention). */
export function crownCount(state: GameState, prefix: string): number {
  let n = 0;
  for (const key of Object.keys(state.flags)) {
    if (!key.startsWith(prefix)) continue;
    const v = state.flags[key];
    if (v !== false && v !== 0 && v !== '') n += 1;
  }
  return n;
}

/** True if the player holds the crown of `kingdomId`. */
export function holdsCrown(state: GameState, prefix: string, kingdomId: string | undefined): boolean {
  if (kingdomId === undefined) return false;
  const key = `${prefix}${kingdomId}`;
  if (!isSafeRecordKey(key) || !Object.hasOwn(state.flags, key)) return false;
  const v = state.flags[key];
  return v !== false && v !== 0 && v !== '';
}

/** Tier of a building in a settlement (0 when not built). */
export function buildingTier(settlement: Settlement | undefined, buildingId: string): number {
  if (!settlement) return 0;
  return Math.max(0, Math.floor(recNum(settlement.buildings, buildingId)));
}

/** The upkeep of a building at a tier (§10.4), 0 when the building or tier is unknown. */
export function buildingUpkeep(content: Content, buildingId: string, tier: number): number {
  if (tier <= 0 || !Object.hasOwn(content.balance.buildings, buildingId)) return 0;
  const def = content.balance.buildings[buildingId as keyof Content['balance']['buildings']];
  return def.tiers.find((t) => t.tier === tier)?.upkeep ?? 0;
}

/** A numeric building effect at a tier (0 when absent). */
export function buildingEffect(content: Content, buildingId: string, tier: number, key: string): number {
  if (tier <= 0 || !Object.hasOwn(content.balance.buildings, buildingId)) return 0;
  const def = content.balance.buildings[buildingId as keyof Content['balance']['buildings']];
  const effects = def.tiers.find((t) => t.tier === tier)?.effects;
  if (!effects || !Object.hasOwn(effects, key)) return 0;
  const v = effects[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Whether a settlement has a market the player can trade at (§9.2 tier rule, or a Market building). */
export function hasTradeMarket(content: Content, settlement: Settlement | undefined): boolean {
  if (!settlement) return false;
  const tier = recGet(content.balance.settlementTiers, settlement.tier);
  return (tier?.market ?? false) || buildingTier(settlement, 'market') >= 1;
}

/** The player's (or a faction's) capital: the ruler's holding, else the first holding. */
export function factionCapitalId(state: GameState, factionId: FactionId): SettlementId | undefined {
  if (factionId === state.player.factionId && state.settlements[state.player.capitalId]) return state.player.capitalId;
  const faction = state.factions[factionId];
  if (!faction) return undefined;
  const ruler = state.characters[faction.rulerId];
  const held = ruler?.role?.holdingId;
  if (held !== undefined && state.settlements[held]?.factionId === factionId) return held;
  for (const id of faction.holdingIds) if (state.settlements[id]?.factionId === factionId) return id;
  return undefined;
}

/** True if the settlement's harbour is blockaded (this module's blockades, or a flag another module sets on the settlement). */
export function isBlockaded(state: GameState, settlementId: SettlementId, hour: number): boolean {
  const until = state.economy?.blockades[settlementId];
  if (until !== undefined && until > hour) return true;
  const s = state.settlements[settlementId] as (Settlement & Record<string, unknown>) | undefined;
  if (!s) return false;
  if (s.blockaded === true) return true;
  const other = s.blockadedUntil;
  return typeof other === 'number' && other > hour;
}

/** True if the settlement is under siege (the settlements module's `siege` field, read defensively). */
export function isBesieged(settlement: Settlement | undefined): boolean {
  if (!settlement) return false;
  const siege = (settlement as Settlement & Record<string, unknown>).siege;
  return siege !== undefined && siege !== null && siege !== false;
}

// ---------------------------------------------------------------------------------------------
// Province tags (§32.1: straits, iron, furs …)

let geoTagsByName: Record<string, readonly string[]> | undefined;
let geoTagsById: Record<string, readonly string[]> | undefined;

function loadGeoTags(): void {
  if (geoTagsByName !== undefined) return;
  const byName: Record<string, readonly string[]> = {};
  const byId: Record<string, readonly string[]> = {};
  try {
    for (const p of getGeography().provinces) {
      if (isSafeRecordKey(p.name)) byName[p.name] = p.tags;
      if (isSafeRecordKey(p.id)) byId[p.id] = p.tags;
    }
  } catch {
    // The geography pack is mid-edit or invalid: no tags until it loads.
  }
  geoTagsByName = byName;
  geoTagsById = byId;
}

const NO_TAGS: readonly string[] = [];

/**
 * Gameplay tags of a province: `province.tags` when the world module provides them, else the
 * geography pack's tags found by the province's geography id (`geoId`/`defId`) or name.
 */
export function provinceTags(province: Province | undefined): readonly string[] {
  if (!province) return NO_TAGS;
  const extra = province as Province & Record<string, unknown>;
  const own = extra.tags;
  if (Array.isArray(own)) return own.filter((t): t is string => typeof t === 'string');
  loadGeoTags();
  for (const key of ['geoId', 'defId']) {
    const id = extra[key];
    if (typeof id === 'string') {
      const tags = recGet(geoTagsById, id);
      if (tags) return tags;
    }
  }
  return recGet(geoTagsByName, province.name) ?? NO_TAGS;
}

/** Tags of every province, computed once per pass. */
export function provinceTagTable(provinces: Readonly<Record<ProvinceId, Province>>): Record<ProvinceId, readonly string[]> {
  const out: Record<ProvinceId, readonly string[]> = {};
  for (const id of Object.keys(provinces) as ProvinceId[]) out[id] = provinceTags(provinces[id]);
  return out;
}

/** A stable 32-bit FNV-1a hash of a string (merchant greed and other per-entity constants). */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
