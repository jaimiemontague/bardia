/**
 * Faith state helpers: the module's root slice, month counters, faith classification, house/faction
 * accessors, ruler modifiers and "where is the ruler" (seers, groves and churches are visited in
 * person). Pure functions over GameState; writes only touch faith-owned fields.
 */
import type { Content } from '@content/index';
import type { Tunables } from '@content/schemas/tunables/faith';
import { getRelation } from '@sim/core/factory';
import type { CharId, FactionId, FaithId, GameState, GodId, Hour, SettlementId } from '@sim/core/state';
import { dayIndex, DAYS_PER_MONTH } from '@sim/core/time';
import type { FaithState, MonthCounter } from './types';

/** The faith whose houses keep Favor with the gods (§4.4). */
export const OLD_WAYS: FaithId = 'oldways';

/** Absolute month index of an hour (month 0 = Icebreak 812). */
export function monthOf(hour: Hour): number {
  return Math.floor(dayIndex(hour) / DAYS_PER_MONTH);
}

/** A fresh faith slice. */
export function emptyFaithState(): FaithState {
  return { offerings: {}, alms: {}, deeds: {}, tended: {}, seerReadHour: {}, wrathLevel: 0 };
}

/** The faith slice, created when missing (saves made before the module existed, foreign test states). */
export function ensureFaithState(draft: GameState): FaithState {
  if (!draft.faith) draft.faith = emptyFaithState();
  return draft.faith;
}

/** Count recorded for `key` this month (0 when the counter belongs to an earlier month). */
export function monthCount(table: Readonly<Record<FactionId, MonthCounter>>, factionId: FactionId, key: string, month: number): number {
  const c = Object.hasOwn(table, factionId) ? table[factionId] : undefined;
  if (!c || c.month !== month || !Object.hasOwn(c.counts, key)) return 0;
  return c.counts[key] ?? 0;
}

/** Increments the month counter for `key` (resetting a stale month) and returns the new count. */
export function bumpMonthCount(table: Record<FactionId, MonthCounter>, factionId: FactionId, key: string, month: number): number {
  let c = Object.hasOwn(table, factionId) ? table[factionId] : undefined;
  if (!c || c.month !== month) {
    c = { month, counts: {} };
    table[factionId] = c;
  }
  const next = (Object.hasOwn(c.counts, key) ? (c.counts[key] ?? 0) : 0) + 1;
  c.counts[key] = next;
  return next;
}

/** Drops counters of earlier months (keeps the slice small). */
export function pruneMonthCounters(table: Record<FactionId, MonthCounter>, month: number): void {
  for (const id of Object.keys(table) as FactionId[]) {
    if (table[id]?.month !== month) delete table[id];
  }
}

/** True for the Lantern and its rites (tunables `wrath.lanternFaiths`). */
export function isLanternFaith(t: Tunables, faith: FaithId | undefined): boolean {
  return faith !== undefined && t.wrath.lanternFaiths.includes(faith);
}

/** The faith of a faction's ruling house (the player's house faith for the player). */
export function faithOf(state: GameState, factionId: FactionId): FaithId | undefined {
  if (factionId === state.player.factionId) return state.player.house.faith;
  return state.factions[factionId]?.faith;
}

/** Favor record of a faction: the player's house, or an Old Ways AI faction (undefined otherwise). */
export function favorOf(state: GameState, factionId: FactionId): Readonly<Record<GodId, number>> | undefined {
  if (factionId === state.player.factionId) return state.player.house.favor;
  return state.factions[factionId]?.favor;
}

/** The ruler of a faction (the player's ruler for the player), if alive. */
export function rulerOf(state: GameState, factionId: FactionId): CharId | undefined {
  const id = factionId === state.player.factionId ? state.player.rulerId : state.factions[factionId]?.rulerId;
  if (id === undefined) return undefined;
  const c = Object.hasOwn(state.characters, id) ? state.characters[id] : undefined;
  return c && c.alive ? id : undefined;
}

/** Σ of a dotted modifier over a character's traits and feats (e.g. 'omen.shiftChance'). */
export function characterModifier(state: GameState, content: Content, charId: CharId | undefined, key: string): number {
  if (charId === undefined) return 0;
  const c = Object.hasOwn(state.characters, charId) ? state.characters[charId] : undefined;
  if (!c) return 0;
  let sum = 0;
  for (const t of c.traits) {
    const def = Object.hasOwn(content.traits, t) ? content.traits[t] : undefined;
    if (def && Object.hasOwn(def.modifiers, key)) sum += def.modifiers[key] ?? 0;
  }
  for (const f of c.feats) {
    const def = Object.hasOwn(content.feats, f) ? content.feats[f] : undefined;
    if (def && Object.hasOwn(def.modifiers, key)) sum += def.modifiers[key] ?? 0;
  }
  return sum;
}

/** Gain multiplier from a ruler's `favor.gainPct` / `piety.gainPct` modifiers (Pious +20 %, Skeptic −20 %). */
export function gainMultiplier(state: GameState, content: Content, factionId: FactionId, key: 'favor.gainPct' | 'piety.gainPct'): number {
  return Math.max(0, 1 + characterModifier(state, content, rulerOf(state, factionId), key) / 100);
}

/**
 * The settlement a character is at: in it, or with a fleet/army that is docked, beached or landed
 * within `omens.fleetAtSettlementRadius` cells of it (nearest wins; ties by id order).
 */
export function presentAt(state: GameState, t: Tunables, charId: CharId): SettlementId | undefined {
  const c = Object.hasOwn(state.characters, charId) ? state.characters[charId] : undefined;
  if (!c || !c.alive) return undefined;
  const loc = c.location;
  if (loc.kind === 'settlement') return Object.hasOwn(state.settlements, loc.id) ? loc.id : undefined;
  let pos: { x: number; y: number } | undefined;
  if (loc.kind === 'fleet') {
    const fleet = Object.hasOwn(state.fleets, loc.id) ? state.fleets[loc.id] : undefined;
    if (fleet && fleet.mode !== 'sailing') pos = fleet.pos;
  } else if (loc.kind === 'army') {
    const army = Object.hasOwn(state.armies, loc.id) ? state.armies[loc.id] : undefined;
    if (army) pos = army.pos;
  }
  if (!pos) return undefined;
  const r = t.omens.fleetAtSettlementRadius;
  let best: SettlementId | undefined;
  let bestD = r * r;
  for (const s of Object.values(state.settlements)) {
    const dx = s.mapPos.x - pos.x;
    const dy = s.mapPos.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best === undefined)) {
      best = s.id;
      bestD = d;
    }
  }
  return best;
}

/** True when the faction is at war with the settlement's owner (its seers and groves are closed). */
export function hostileTo(state: GameState, factionId: FactionId, settlementId: SettlementId): boolean {
  const s = state.settlements[settlementId];
  if (!s || s.factionId === factionId) return false;
  return getRelation(state, factionId, s.factionId)?.stance === 'war';
}

/** Every Lantern faction (other than the player's), in id order of insertion. */
export function lanternFactionIds(state: GameState, t: Tunables): FactionId[] {
  const out: FactionId[] = [];
  for (const f of Object.values(state.factions)) {
    if (f.id !== state.player.factionId && isLanternFaith(t, f.faith)) out.push(f.id);
  }
  return out;
}

/** The player's holdings (settlements with a holding owned by the player's faction). */
export function playerHoldingIds(state: GameState): SettlementId[] {
  const out: SettlementId[] = [];
  const faction = state.factions[state.player.factionId];
  const ids = faction ? faction.holdingIds : [];
  for (const id of ids) {
    const s = state.settlements[id];
    if (s && s.holding && s.factionId === state.player.factionId) out.push(id);
  }
  if (out.length === 0) {
    const cap = state.settlements[state.player.capitalId];
    if (cap && cap.holding && cap.factionId === state.player.factionId) out.push(cap.id);
  }
  return out;
}
