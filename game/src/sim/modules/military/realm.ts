/**
 * Pure read helpers over GameState used throughout the military module and by the client:
 * modifier sums (culture bonuses, traits, feats), effective skills, building tiers and effects,
 * realm membership, capitals, kin, war status and distances. None of them mutates state; all read
 * other modules' data defensively (fields may be missing while those modules are mid-work or in
 * old saves).
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { clamp } from '@sim/core/dmath';
import { isSafeRecordKey } from '@sim/core/keys';
import type { Character, CharId, FactionId, GameState, MapPos, Settlement, SettlementId, SkillId } from '@sim/core/state';

/** Own-property read of a numeric record entry (0 when absent or not finite). */
export function recNum(record: Readonly<Record<string, number>> | undefined, key: string): number {
  if (record === undefined || !isSafeRecordKey(key) || !Object.hasOwn(record, key)) return 0;
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Σ of a modifier key over a character's traits and feats (unknown ids are ignored). */
export function charModifier(content: Content, char: Character | undefined, key: string): number {
  if (!char) return 0;
  let sum = 0;
  for (const t of char.traits) {
    const def = Object.hasOwn(content.traits, t) ? content.traits[t] : undefined;
    if (def) sum += recNum(def.modifiers, key);
  }
  for (const f of char.feats) {
    const def = Object.hasOwn(content.feats, f) ? content.feats[f] : undefined;
    if (def) sum += recNum(def.modifiers, key);
  }
  return sum;
}

/**
 * Σ of a modifier key that applies to a whole realm: the faction culture's bonuses plus the
 * ruler's traits and feats (e.g. `ship.costPct`, `unit.archers.bountyPct`, `loyalty.lieutenants`).
 */
export function realmModifier(state: GameState, content: Content, factionId: FactionId, key: string): number {
  const faction = state.factions[factionId];
  if (!faction) return 0;
  let sum = 0;
  const culture = Object.hasOwn(content.cultures, faction.culture) ? content.cultures[faction.culture] : undefined;
  if (culture) for (const bonus of culture.bonuses) sum += recNum(bonus.modifiers, key);
  sum += charModifier(content, state.characters[faction.rulerId], key);
  return sum;
}

/** A character's skill including `skill.<id>` trait and feat modifiers, clamped to [0, skillMax]. */
export function effectiveSkill(content: Content, char: Character | undefined, skill: SkillId): number {
  if (!char) return 0;
  const base = recNum(char.skills, skill);
  return clamp(base + charModifier(content, char, `skill.${skill}`), 0, content.balance.character.skillMax);
}

/** Tier of a building in a settlement (0 when not built). */
export function buildingTier(settlement: Settlement | undefined, buildingId: string): number {
  if (!settlement) return 0;
  return Math.max(0, Math.floor(recNum(settlement.buildings, buildingId)));
}

/** The effects bag of a building tier, or undefined when the tier does not exist. */
export function buildingTierEffects(
  balance: Balance,
  buildingId: string,
  tier: number,
): Readonly<Record<string, number | string[] | boolean>> | undefined {
  if (!Object.hasOwn(balance.buildings, buildingId)) return undefined;
  const def = balance.buildings[buildingId as keyof Balance['buildings']];
  return def.tiers.find((t) => t.tier === tier)?.effects;
}

/** A numeric building effect at a tier (0 when absent). */
export function buildingNumber(balance: Balance, buildingId: string, tier: number, key: string): number {
  const effects = buildingTierEffects(balance, buildingId, tier);
  if (!effects || !Object.hasOwn(effects, key)) return 0;
  const v = effects[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A string-list building effect at a tier (empty when absent). */
export function buildingList(balance: Balance, buildingId: string, tier: number, key: string): readonly string[] {
  const effects = buildingTierEffects(balance, buildingId, tier);
  if (!effects || !Object.hasOwn(effects, key)) return [];
  const v = effects[key];
  return Array.isArray(v) ? v : [];
}

/** The faction's capital: the player's capital for the player, else the first holding. */
export function factionCapitalId(state: GameState, factionId: FactionId | undefined): SettlementId | undefined {
  if (factionId === undefined) return undefined;
  if (factionId === state.player.factionId && state.settlements[state.player.capitalId]) return state.player.capitalId;
  const faction = state.factions[factionId];
  if (!faction) return undefined;
  for (const id of faction.holdingIds) if (state.settlements[id]) return id;
  return undefined;
}

/** The settlement if it is a holding (has HoldingState) of `factionId`. */
export function holdingOf(state: GameState, settlementId: SettlementId, factionId: FactionId): Settlement | undefined {
  const s = state.settlements[settlementId];
  if (!s || s.factionId !== factionId || !s.holding) return undefined;
  return s;
}

/** Ids of every settlement with HoldingState owned by `factionId`, in faction holding order. */
export function holdingIdsOf(state: GameState, factionId: FactionId): SettlementId[] {
  const faction = state.factions[factionId];
  if (!faction) return [];
  const out: SettlementId[] = [];
  for (const id of faction.holdingIds) {
    const s = state.settlements[id];
    if (s && s.holding && s.factionId === factionId) out.push(id);
  }
  return out;
}

/** Straight-line distance in map cells. */
export function distance(a: MapPos, b: MapPos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** True if `charId` is close kin of the ruler `rulerId` (spouse, parent, child or sibling). */
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

/** True if the faction is at war with anyone (a relation with stance 'war'). */
export function isAtWar(state: GameState, factionId: FactionId): boolean {
  for (const key in state.relations) {
    const rel = state.relations[key];
    if (rel && rel.stance === 'war' && (rel.a === factionId || rel.b === factionId)) return true;
  }
  return false;
}

/** Σ Favor over the player's gods (the Old Ways pantheon), ignoring malformed entries. */
export function oldWaysFavor(state: GameState): number {
  const favor = state.player.house.favor as Readonly<Record<string, number>> | undefined;
  if (!favor) return 0;
  let sum = 0;
  for (const god of Object.keys(favor)) sum += recNum(favor, god);
  return sum;
}

/** The ruler character of a faction. */
export function rulerOf(state: GameState, factionId: FactionId): Character | undefined {
  const f = state.factions[factionId];
  return f ? state.characters[f.rulerId] : undefined;
}

/** Rounds to 2 decimals (veterancy averages stay short and deterministic in saves). */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
