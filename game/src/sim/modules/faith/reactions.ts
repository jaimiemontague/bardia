/**
 * Reactions to other modules' events (ARCHITECTURE.md §11): deeds that move Favor/Piety, Faith
 * Wrath from settlement fates, omens spent by battles and duels, and Lantern contact.
 *
 * These events are declared by their owners (battle, duel, seabattle, settlements, people, weather,
 * quests, diplomacy, world, …) and this module must not import their runtime code — nor, to keep
 * its own verification independent of their progress, their types. So every handler reads its
 * payload DEFENSIVELY by name (`str`, `rec`, `numOf` below) and does nothing when a field it needs
 * is missing. The fields read are listed per handler; an owner that names them differently only
 * loses the faith consequence, never crashes the game.
 */
import type { SimContext } from '@sim/core/module';
import type { CharId, FactionId, GameState, GodId, SettlementId } from '@sim/core/state';
import { GOD_IDS } from '@content/schemas/ids';
import { applyDeed } from './favor';
import { ensureFaithState, isLanternFaith } from './state';
import { changeFaithWrath, fateKind, fateWrath } from './wrath';
import type { OmenActivity } from './types';

/** A foreign event seen as a plain record (its `type` plus whatever its owner put in it). */
export type LooseEvent = Readonly<Record<string, unknown>>;
/** A reaction over a foreign event. */
export type LooseReaction = (draft: GameState, event: LooseEvent, ctx: SimContext) => void;

type Rec = Readonly<Record<string, unknown>>;

/** `v` if it is a non-empty string. */
export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
/** `v` if it is a finite number. */
export function numOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** `v` if it is a plain (non-array) object. */
export function rec(v: unknown): Rec | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function factionIdOf(v: unknown): FactionId | undefined {
  const s = str(v);
  return s !== undefined && s.startsWith('fac_') ? (s as FactionId) : undefined;
}
function charIdOf(v: unknown): CharId | undefined {
  const s = str(v);
  return s !== undefined && s.startsWith('chr_') ? (s as CharId) : undefined;
}
function settlementIdOf(v: unknown): SettlementId | undefined {
  const s = str(v);
  return s !== undefined && s.startsWith('set_') ? (s as SettlementId) : undefined;
}
function godOf(v: unknown): GodId | undefined {
  const s = str(v);
  return s !== undefined && (GOD_IDS as readonly string[]).includes(s) ? (s as GodId) : undefined;
}

/** The faction a character serves (rulers included). */
function factionOfChar(state: GameState, charId: CharId | undefined): FactionId | undefined {
  if (charId === undefined) return undefined;
  const c = Object.hasOwn(state.characters, charId) ? state.characters[charId] : undefined;
  if (!c) return undefined;
  if (c.factionId !== undefined) return c.factionId;
  if (charId === state.player.rulerId) return state.player.factionId;
  return c.role?.factionId;
}

/** Removes the player's reading for an activity when readings are spent on use. */
function spendOmen(draft: GameState, ctx: SimContext, activity: OmenActivity): void {
  if (!ctx.tunables.faith.omens.consumeOnUse[activity]) return;
  const omens = draft.player.house.omens;
  if (omens && Object.hasOwn(omens, activity)) delete omens[activity];
}

/** Attacker/defender faction ids of a battle-like event (top-level fields, else `setup.<side>.factionId`). */
function sides(e: LooseEvent): { attacker?: FactionId; defender?: FactionId } {
  const setup = rec(e['setup']);
  const attacker = factionIdOf(e['attackerFactionId']) ?? factionIdOf(rec(setup?.['attacker'])?.['factionId']);
  const defender = factionIdOf(e['defenderFactionId']) ?? factionIdOf(rec(setup?.['defender'])?.['factionId']);
  const out: { attacker?: FactionId; defender?: FactionId } = {};
  if (attacker !== undefined) out.attacker = attacker;
  if (defender !== undefined) out.defender = defender;
  return out;
}

/** 'attacker' | 'defender' | undefined from `result.winner` (or a top-level `winner`). */
function winnerSide(e: LooseEvent): 'attacker' | 'defender' | undefined {
  const w = str(rec(e['result'])?.['winner']) ?? str(e['winner']);
  return w === 'attacker' || w === 'defender' ? w : undefined;
}

/**
 * BattleEnded { kind, attackerFactionId, defenderFactionId, settlementId?, playerSide?, result: { winner, buildingsBurned } }:
 * the winner's house earns `battleWon` (Valgrim); a defender who held its own settlement earns
 * `holdingDefended` (Dunnar); an attacker whose fires burned buildings earns `hallBurned` (Skell).
 * A battle the player fought spends the player's battle omen.
 */
function onBattleEnded(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const { attacker, defender } = sides(e);
  const player = draft.player.factionId;
  const won = winnerSide(e);
  const winner = won === 'attacker' ? attacker : won === 'defender' ? defender : undefined;
  if (winner !== undefined) {
    applyDeed(draft, ctx, winner, 'battleWon');
    const settlementId = settlementIdOf(e['settlementId']) ?? settlementIdOf(rec(e['setup'])?.['settlementId']);
    const held = settlementId !== undefined && draft.settlements[settlementId]?.factionId === defender;
    if (won === 'defender' && (held || str(e['kind']) === 'defense')) applyDeed(draft, ctx, winner, 'holdingDefended');
  }
  const burned = numOf(rec(e['result'])?.['buildingsBurned']) ?? 0;
  if (burned > 0 && attacker !== undefined && won === 'attacker') applyDeed(draft, ctx, attacker, 'hallBurned');
  const playerSide = str(e['playerSide']);
  if (playerSide !== undefined || attacker === player || defender === player) spendOmen(draft, ctx, 'battle');
}

/** SeaBattleEnded { attackerFactionId?/setup.attacker.factionId, …, result: { winner } }: `seaBattleWon`; spends the battle omen. */
function onSeaBattleEnded(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const { attacker, defender } = sides(e);
  const won = winnerSide(e);
  const winner = won === 'attacker' ? attacker : won === 'defender' ? defender : undefined;
  if (winner !== undefined) applyDeed(draft, ctx, winner, 'seaBattleWon');
  const player = draft.player.factionId;
  if (str(e['playerSide']) !== undefined || attacker === player || defender === player) spendOmen(draft, ctx, 'battle');
}

/**
 * DuelEnded { winnerId | result.winnerId, setup.arena | arena, setup.a/b.charId }: the winner's house
 * earns `holmgangWon` (holmgang arena) or `duelWon` (Eidr). A duel the player's ruler fought spends
 * the duel omen.
 */
function onDuelEnded(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const result = rec(e['result']);
  const setup = rec(e['setup']);
  const winnerId = charIdOf(e['winnerId']) ?? charIdOf(result?.['winnerId']);
  const arena = str(e['arena']) ?? str(setup?.['arena']);
  const winnerFaction = factionOfChar(draft, winnerId);
  if (winnerFaction !== undefined) applyDeed(draft, ctx, winnerFaction, arena === 'holmgang' ? 'holmgangWon' : 'duelWon');
  const fighters = [winnerId, charIdOf(e['loserId']), charIdOf(rec(setup?.['a'])?.['charId']), charIdOf(rec(setup?.['b'])?.['charId'])];
  if (fighters.includes(draft.player.rulerId)) spendOmen(draft, ctx, 'duel');
}

/** StormHit { fleetId, severity }: a fleet that weathers a storm earns `stormSurvived` (Saltha), scaled by severity. */
function onStormHit(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  if (e['sunk'] === true || e['lost'] === true) return;
  const fleetId = str(e['fleetId']);
  if (fleetId === undefined || !fleetId.startsWith('flt_')) return;
  const fleet = Object.hasOwn(draft.fleets, fleetId) ? draft.fleets[fleetId as `flt_${string}`] : undefined;
  if (!fleet || fleet.shipIds.length === 0) return;
  const severity = str(e['severity']);
  const scales = ctx.tunables.faith.favor.stormSeverityScale;
  const scale = severity === 'minor' ? scales.minor : severity === 'severe' ? scales.severe : scales.moderate;
  applyDeed(draft, ctx, fleet.ownerId, 'stormSurvived', { scale });
}

/** Marriage { any chr_ ids at the top level or in arrays }: each spouse's house earns `marriage` (Fjorna) once. */
function onMarriage(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const ids: CharId[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (k === 'type') continue;
    if (Array.isArray(v)) for (const x of v) { const c = charIdOf(x); if (c) ids.push(c); }
    else { const c = charIdOf(v); if (c) ids.push(c); }
  }
  const factions: FactionId[] = [];
  for (const id of ids) {
    const f = factionOfChar(draft, id);
    if (f !== undefined && !factions.includes(f)) factions.push(f);
  }
  for (const f of factions) applyDeed(draft, ctx, f, 'marriage');
}

/** Death { charId, cause? }: the dead's house gives a proper funeral (`properFuneral`, the Gray Queen) unless no body came home. */
function onDeath(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const charId = charIdOf(e['charId']) ?? charIdOf(e['characterId']);
  const cause = str(e['cause']);
  if (cause !== undefined && ctx.tunables.faith.favor.noFuneralCauses.includes(cause)) return;
  const f = factionOfChar(draft, charId);
  if (f !== undefined) applyDeed(draft, ctx, f, 'properFuneral');
}

/** RelicFound { relicId, god?, factionId?/finderFactionId? }: the relic's god +balance `favor.relic` (default: the player). */
function onRelicFound(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const f = factionIdOf(e['factionId']) ?? factionIdOf(e['finderFactionId']) ?? factionIdOf(e['holderId']) ?? draft.player.factionId;
  const god = godOf(e['god']);
  applyDeed(draft, ctx, f, 'relicFound', god !== undefined ? { god } : {});
}

/** LegendLearned { factionId? }: `legendLearned` (Valgrim; default: the player). */
function onLegendLearned(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  applyDeed(draft, ctx, factionIdOf(e['factionId']) ?? draft.player.factionId, 'legendLearned');
}

/** FeastHeld { factionId?, kind? }: a harvest feast pleases Fjorna (`harvestFeast`), any other Dunnar (`feastHeld`). */
function onFeastHeld(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const f = factionIdOf(e['factionId']) ?? draft.player.factionId;
  applyDeed(draft, ctx, f, str(e['kind']) === 'harvest' ? 'harvestFeast' : 'feastHeld');
}

/** WeregildPaid { payerFactionId? | factionId? }: `weregildPaid` (Eidr). */
function onWeregildPaid(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const f = factionIdOf(e['payerFactionId']) ?? factionIdOf(e['factionId']);
  if (f !== undefined) applyDeed(draft, ctx, f, 'weregildPaid');
}

/** PactBroken { brokenBy | breakerId | byFactionId }: the oath-breaker's house suffers `oathBroken` (Eidr −10). */
function onPactBroken(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const f = factionIdOf(e['brokenBy']) ?? factionIdOf(e['breakerId']) ?? factionIdOf(e['byFactionId']);
  if (f !== undefined) applyDeed(draft, ctx, f, 'oathBroken');
}

/**
 * SettlementFate { settlementId, fate, byFactionId?, clergy? }: the §16.3 Faith Wrath column for the
 * player's fates (an event without an actor is the player's own aftermath choice); `hallBurned`
 * (Skell) for burning fates; `templeSteadRaided` (all gods) for violence at an Old Ways temple-stead.
 */
function onSettlementFate(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const settlementId = settlementIdOf(e['settlementId']);
  const fate = str(e['fate']) ?? str(e['choice']);
  if (settlementId === undefined || fate === undefined) return;
  const settlement = draft.settlements[settlementId];
  if (!settlement) return;
  const actor =
    factionIdOf(e['byFactionId']) ?? factionIdOf(e['actorFactionId']) ?? factionIdOf(e['attackerFactionId']) ?? factionIdOf(e['by']) ?? draft.player.factionId;
  const t = ctx.tunables.faith;
  const kind = fateKind(t, fate);
  if (actor === draft.player.factionId) {
    const wrath = fateWrath(ctx, settlement, fate, e['clergy'] === true, draft.time.hour);
    if (wrath !== 0) {
      const applied = changeFaithWrath(draft, ctx, wrath);
      if (applied !== 0) {
        ctx.notify('faith.wrath.raised', { priority: 'normal', vars: { settlement: settlement.name, amount: applied }, link: { kind: 'settlement', id: settlementId } });
      }
    }
  }
  if (kind === 'burn') applyDeed(draft, ctx, actor, 'hallBurned');
  if (kind !== undefined && kind !== 'annex' && settlement.tier === 'templeStead' && settlement.faith === 'oldways') {
    applyDeed(draft, ctx, actor, 'templeSteadRaided');
  }
}

/** Arrived { fleetId?, settlementId }: a player fleet arriving at a Lantern settlement is Lantern contact (trade, §17.7). */
function onArrived(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const settlementId = settlementIdOf(e['settlementId']);
  if (settlementId === undefined) return;
  const s = draft.settlements[settlementId];
  if (!s || !isLanternFaith(ctx.tunables.faith, s.faith)) return;
  const fleetId = str(e['fleetId']);
  const fleet = fleetId !== undefined && Object.hasOwn(draft.fleets, fleetId) ? draft.fleets[fleetId as `flt_${string}`] : undefined;
  const ownerId = fleet?.ownerId ?? factionIdOf(e['factionId']);
  if (ownerId === draft.player.factionId) ensureFaithState(draft).lanternContactHour = draft.time.hour;
}

/** EnvoyArrived { fromFactionId }: hosting a Lantern envoy is Lantern contact (§17.7). */
function onEnvoyArrived(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const from = factionIdOf(e['fromFactionId']) ?? factionIdOf(e['factionId']);
  if (from === undefined) return;
  const toFaction = factionIdOf(e['toFactionId']);
  if (toFaction !== undefined && toFaction !== draft.player.factionId) return;
  if (isLanternFaith(ctx.tunables.faith, draft.factions[from]?.faith)) ensureFaithState(draft).lanternContactHour = draft.time.hour;
}

/** Event name → defensive reaction. */
export const LOOSE_REACTIONS: Readonly<Record<string, LooseReaction>> = {
  BattleEnded: onBattleEnded,
  SeaBattleEnded: onSeaBattleEnded,
  DuelEnded: onDuelEnded,
  StormHit: onStormHit,
  Marriage: onMarriage,
  Death: onDeath,
  RelicFound: onRelicFound,
  LegendLearned: onLegendLearned,
  FeastHeld: onFeastHeld,
  WeregildPaid: onWeregildPaid,
  PactBroken: onPactBroken,
  SettlementFate: onSettlementFate,
  Arrived: onArrived,
  EnvoyArrived: onEnvoyArrived,
};
