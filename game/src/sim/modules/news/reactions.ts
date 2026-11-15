/**
 * News from world events (design §19.3: "each world event creates a news item"). Reactions to other
 * modules' domain events (settlement fates, deaths, battles, pacts, marriages, successions and
 * crownings, storms, captures, revolts, relics …).
 *
 * The events are declared by their owners (settlements, people, battle, seabattle, duel, diplomacy,
 * weather, holdings, quests). To keep this module's verification independent of their progress, the
 * payloads are read DEFENSIVELY by name and a missing field only drops the news item — it never
 * throws. The fields read are documented per handler. A kind missing from `tunables.news.kinds` is
 * never created (that is how a kind is switched off).
 */
import type { SimContext } from '@sim/core/module';
import type { CharId, FactionId, GameState, MapPos, SettlementId, SiteId } from '@sim/core/state';
import { importanceFromThresholds, toImportance } from './formulas';
import { createNews, factionList, nearestSettlement } from './store';
import type { NewsSpec } from './types';

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
function idOf<T extends string>(prefix: string, ...values: unknown[]): T | undefined {
  for (const v of values) {
    const s = str(v);
    if (s !== undefined && s.startsWith(prefix)) return s as T;
  }
  return undefined;
}
const factionIdOf = (...v: unknown[]) => idOf<FactionId>('fac_', ...v);
const charIdOf = (...v: unknown[]) => idOf<CharId>('chr_', ...v);
const settlementIdOf = (...v: unknown[]) => idOf<SettlementId>('set_', ...v);
const siteIdOf = (...v: unknown[]) => idOf<SiteId>('site_', ...v);

function settlementName(state: GameState, id: SettlementId | undefined): string {
  return id !== undefined && Object.hasOwn(state.settlements, id) ? (state.settlements[id]?.name ?? '') : '';
}
function factionName(state: GameState, id: FactionId | undefined): string {
  return id !== undefined && Object.hasOwn(state.factions, id) ? (state.factions[id]?.name ?? '') : '';
}
function charName(state: GameState, id: CharId | undefined): string {
  return id !== undefined && Object.hasOwn(state.characters, id) ? (state.characters[id]?.name ?? '') : '';
}
/** The faction a character serves (rulers included). */
function factionOfChar(state: GameState, id: CharId | undefined): FactionId | undefined {
  if (id === undefined || !Object.hasOwn(state.characters, id)) return undefined;
  const c = state.characters[id];
  if (!c) return undefined;
  if (id === state.player.rulerId) return state.player.factionId;
  return c.factionId ?? c.role?.factionId;
}
/** The faction `id` rules, if any. */
function factionRuledBy(state: GameState, id: CharId | undefined): FactionId | undefined {
  if (id === undefined) return undefined;
  if (id === state.player.rulerId) return state.player.factionId;
  const own = factionOfChar(state, id);
  if (own !== undefined && state.factions[own]?.rulerId === id) return own;
  return undefined;
}
/** A faction's seat: the player's capital, else its first holding. */
function capitalOf(state: GameState, id: FactionId | undefined): SettlementId | undefined {
  if (id === undefined) return undefined;
  if (id === state.player.factionId && Object.hasOwn(state.settlements, state.player.capitalId)) return state.player.capitalId;
  const f = Object.hasOwn(state.factions, id) ? state.factions[id] : undefined;
  return f?.holdingIds.find((h) => Object.hasOwn(state.settlements, h));
}
function posOfFleet(state: GameState, fleetId: unknown): MapPos | undefined {
  const id = idOf<`flt_${string}`>('flt_', fleetId);
  const f = id !== undefined && Object.hasOwn(state.fleets, id) ? state.fleets[id] : undefined;
  return f ? { x: f.pos.x, y: f.pos.y } : undefined;
}
/** Where a character is: their settlement, the settlement nearest their fleet/army, or their faction's seat. */
function placeOfChar(state: GameState, id: CharId | undefined): SettlementId | undefined {
  if (id === undefined || !Object.hasOwn(state.characters, id)) return undefined;
  const loc = state.characters[id]?.location;
  if (loc) {
    if (loc.kind === 'settlement' && Object.hasOwn(state.settlements, loc.id)) return loc.id;
    if (loc.kind === 'captive' && Object.hasOwn(state.settlements, loc.at)) return loc.at;
    if (loc.kind === 'fleet') {
      const p = posOfFleet(state, loc.id);
      if (p) return nearestSettlement(state, p);
    }
    if (loc.kind === 'army' && Object.hasOwn(state.armies, loc.id)) {
      const a = state.armies[loc.id];
      if (a) return nearestSettlement(state, a.pos);
    }
  }
  return capitalOf(state, factionOfChar(state, id));
}
function siteSettlement(state: GameState, siteId: SiteId | undefined): SettlementId | undefined {
  const site = siteId !== undefined && Object.hasOwn(state.sites, siteId) ? state.sites[siteId] : undefined;
  return site ? nearestSettlement(state, site.mapPos) : undefined;
}
function tierBonus(ctx: SimContext, state: GameState, id: SettlementId | undefined): number {
  const tier = id !== undefined ? state.settlements[id]?.tier : undefined;
  const t = ctx.tunables.news.tierImportance;
  return tier !== undefined && Object.hasOwn(t, tier) ? (t[tier] ?? 0) : 0;
}
function rulerImportance(ctx: SimContext, state: GameState, factionId: FactionId | undefined, fallback: number): number {
  const kind = factionId !== undefined ? state.factions[factionId]?.kind : undefined;
  const table = ctx.tunables.news.factionKindImportance;
  return kind !== undefined && Object.hasOwn(table, kind) ? (table[kind] ?? fallback) : fallback;
}
function kindImportance(ctx: SimContext, kind: string): number | undefined {
  const k = ctx.tunables.news.kinds;
  return Object.hasOwn(k, kind) ? k[kind]?.importance : undefined;
}
function refsOf(...ids: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (id !== undefined && id.length > 0 && !out.includes(id)) out.push(id);
  return out;
}
function emit(draft: GameState, ctx: SimContext, spec: NewsSpec): void {
  if (!Object.hasOwn(ctx.tunables.news.kinds, spec.kind)) return;
  if (spec.originId === undefined && spec.pos === undefined) return;
  createNews(draft, ctx, spec);
}
/** 'attacker' | 'defender' | 'none' from `result.winner` (or a top-level `winner`). */
function victorOf(e: LooseEvent): 'attacker' | 'defender' | 'none' {
  const w = str(rec(e['result'])?.['winner']) ?? str(e['winner']);
  return w === 'attacker' || w === 'defender' ? w : 'none';
}

/**
 * SettlementFate { settlementId, fate (or choice), byFactionId? (actorFactionId, attackerFactionId,
 * by), previousFactionId? (fromFactionId) }: §16.3 fates through `tunables.news.fates`. An event
 * without an actor is the player's own aftermath choice.
 */
function onSettlementFate(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const settlementId = settlementIdOf(e['settlementId']);
  const fate = str(e['fate']) ?? str(e['choice']);
  if (settlementId === undefined || fate === undefined || !Object.hasOwn(draft.settlements, settlementId)) return;
  const fates = ctx.tunables.news.fates;
  const kind = Object.hasOwn(fates, fate) ? fates[fate] : undefined;
  if (kind === undefined) return;
  const actor = factionIdOf(e['byFactionId'], e['actorFactionId'], e['attackerFactionId'], e['by']) ?? draft.player.factionId;
  const owner = factionIdOf(e['previousFactionId'], e['fromFactionId'], e['ownerFactionId']) ?? draft.settlements[settlementId]?.factionId;
  const importance = (kindImportance(ctx, kind) ?? 2) + tierBonus(ctx, draft, settlementId);
  emit(draft, ctx, {
    kind,
    originId: settlementId,
    importance,
    facts: { settlement: settlementName(draft, settlementId), faction: factionName(draft, owner), attacker: factionName(draft, actor) || 'none', fate },
    factionIds: factionList(actor, owner),
    refs: refsOf(settlementId, actor, owner),
    dedupeKey: `fate:${settlementId}:${draft.time.hour}`,
  });
}

/**
 * Death { charId, cause, factionId?, rulerOf?, wasPlayerRuler, byFactionId?, killerId? }: a ruler's
 * death (importance by the faction's kind).
 */
function onDeath(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const charId = charIdOf(e['charId']);
  if (charId === undefined) return;
  let faction = factionIdOf(e['rulerOf']);
  if (faction === undefined && e['wasPlayerRuler'] === true) faction = draft.player.factionId;
  if (faction === undefined) faction = factionRuledBy(draft, charId);
  if (faction === undefined) {
    const f = factionIdOf(e['factionId']);
    if (f !== undefined && draft.factions[f]?.rulerId === charId) faction = f;
  }
  if (faction === undefined) return;
  const killer = charIdOf(e['killerId']);
  const byFaction = factionIdOf(e['byFactionId']) ?? factionOfChar(draft, killer);
  emit(draft, ctx, {
    kind: 'rulerDied',
    originId: placeOfChar(draft, charId) ?? capitalOf(draft, faction),
    importance: rulerImportance(ctx, draft, faction, kindImportance(ctx, 'rulerDied') ?? 3),
    facts: { name: charName(draft, charId), faction: factionName(draft, faction), cause: str(e['cause']) ?? 'unknown', killer: charName(draft, killer) || 'none' },
    factionIds: factionList(faction, byFaction),
    refs: refsOf(charId, faction, killer),
    dedupeKey: `death:${charId}`,
  });
}

/**
 * BattleEnded { battleId, kind, settlementId?, siteId?, attackerFactionId, defenderFactionId,
 * result: { winner, casualties: [{ side, killed }], chief: { killed } } }: importance by the men
 * killed (`battleKilled` thresholds), +1 when a chief fell.
 */
function onBattleEnded(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const setup = rec(e['setup']);
  const attacker = factionIdOf(e['attackerFactionId'], rec(setup?.['attacker'])?.['factionId']);
  const defender = factionIdOf(e['defenderFactionId'], rec(setup?.['defender'])?.['factionId']);
  if (attacker === undefined && defender === undefined) return;
  const result = rec(e['result']);
  let attackerLost = 0;
  let defenderLost = 0;
  const casualties = Array.isArray(result?.['casualties']) ? (result?.['casualties'] as unknown[]) : [];
  for (const c of casualties) {
    const row = rec(c);
    const killed = numOf(row?.['killed']) ?? 0;
    if (row?.['side'] === 'attacker') attackerLost += killed;
    else if (row?.['side'] === 'defender') defenderLost += killed;
  }
  const killed = attackerLost + defenderLost;
  const chiefKilled = rec(result?.['chief'])?.['killed'] === true;
  const settlementId = settlementIdOf(e['settlementId'], setup?.['settlementId']);
  const siteId = siteIdOf(e['siteId'], setup?.['siteId']);
  const originId =
    (settlementId !== undefined && Object.hasOwn(draft.settlements, settlementId) ? settlementId : undefined) ??
    siteSettlement(draft, siteId) ??
    capitalOf(draft, defender) ??
    capitalOf(draft, attacker);
  const siteName = siteId !== undefined ? (draft.sites[siteId]?.name ?? '') : '';
  emit(draft, ctx, {
    kind: 'battle',
    originId,
    importance: importanceFromThresholds(killed, ctx.tunables.news.battleKilled) + (chiefKilled ? 1 : 0),
    facts: {
      place: settlementName(draft, settlementId) || siteName || settlementName(draft, originId),
      attacker: factionName(draft, attacker),
      defender: factionName(draft, defender),
      victor: victorOf(e),
      killed,
      attackerLost,
      defenderLost,
      battleKind: str(e['kind']) ?? 'field',
    },
    factionIds: factionList(attacker, defender),
    refs: refsOf(originId, attacker, defender),
    dedupeKey: str(e['battleId']) !== undefined ? `battle:${str(e['battleId'])}` : undefined,
  });
}

/**
 * SeaBattleEnded { seaBattleId, attackerFactionId, defenderFactionId, setup: { attacker: { fleetId },
 * defender: { fleetId } }, result: { winner, shipsSunk[], shipsCaptured[], crewLost: [{ killed }] } }:
 * importance by ships sunk or taken (`seaBattleShips`).
 */
function onSeaBattleEnded(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const setup = rec(e['setup']);
  const attacker = factionIdOf(e['attackerFactionId'], rec(setup?.['attacker'])?.['factionId']);
  const defender = factionIdOf(e['defenderFactionId'], rec(setup?.['defender'])?.['factionId']);
  if (attacker === undefined && defender === undefined) return;
  const result = rec(e['result']);
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const ships = len(result?.['shipsSunk']) + len(result?.['shipsCaptured']);
  let killed = 0;
  for (const c of Array.isArray(result?.['crewLost']) ? (result?.['crewLost'] as unknown[]) : []) killed += numOf(rec(c)?.['killed']) ?? 0;
  const pos = posOfFleet(draft, rec(setup?.['defender'])?.['fleetId']) ?? posOfFleet(draft, rec(setup?.['attacker'])?.['fleetId']);
  const originId = (pos ? nearestSettlement(draft, pos) : undefined) ?? capitalOf(draft, defender) ?? capitalOf(draft, attacker);
  emit(draft, ctx, {
    kind: 'seaBattle',
    originId,
    importance: importanceFromThresholds(ships, ctx.tunables.news.seaBattleShips),
    facts: { place: settlementName(draft, originId), attacker: factionName(draft, attacker), defender: factionName(draft, defender), victor: victorOf(e), ships, killed },
    factionIds: factionList(attacker, defender),
    refs: refsOf(originId, attacker, defender),
    dedupeKey: str(e['seaBattleId']) !== undefined ? `sea:${str(e['seaBattleId'])}` : undefined,
  });
}

/**
 * DuelEnded { duelId, winnerId, loserId, setup: { arena }, result: { loserFate } }: news when a ruler
 * fought, someone died, or it was a holmgang (+1 for a ruler, +1 for a death).
 */
function onDuelEnded(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const winner = charIdOf(e['winnerId'], rec(e['result'])?.['winnerId']);
  const loser = charIdOf(e['loserId']);
  if (winner === undefined || loser === undefined) return;
  const fate = str(rec(e['result'])?.['loserFate']) ?? 'yielded';
  const arena = str(rec(e['setup'])?.['arena']) ?? 'field';
  const rulers = [factionRuledBy(draft, winner), factionRuledBy(draft, loser)].filter((f) => f !== undefined);
  const killed = fate === 'killed';
  if (rulers.length === 0 && !killed && arena !== 'holmgang') return;
  const wf = factionOfChar(draft, winner);
  const lf = factionOfChar(draft, loser);
  emit(draft, ctx, {
    kind: 'duelFought',
    originId: placeOfChar(draft, winner) ?? placeOfChar(draft, loser),
    importance: (kindImportance(ctx, 'duelFought') ?? 1) + (rulers.length > 0 ? 1 : 0) + (killed ? 1 : 0),
    facts: { winner: charName(draft, winner), loser: charName(draft, loser), fate, arena },
    factionIds: factionList(wf, lf),
    refs: refsOf(winner, loser),
    dedupeKey: str(e['duelId']) !== undefined ? `duel:${str(e['duelId'])}` : undefined,
  });
}

function pactParties(e: LooseEvent): [FactionId | undefined, FactionId | undefined] {
  const a = factionIdOf(e['a'], e['factionA'], e['aId'], e['fromFactionId'], e['factionId'], e['proposerId']);
  const b = factionIdOf(e['b'], e['factionB'], e['bId'], e['toFactionId'], e['otherFactionId'], e['targetId']);
  return [a, b];
}
function pactKindOf(e: LooseEvent): string {
  return str(e['kind']) ?? str(e['pact']) ?? str(e['pactKind']) ?? str(rec(e['pact'])?.['kind']) ?? 'treaty';
}

/** PactSigned { a, b (factionA/factionB, fromFactionId/toFactionId …), kind (pact, pactKind) }: proclaimed. */
function onPactSigned(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const [a, b] = pactParties(e);
  if (a === undefined || b === undefined) return;
  const pact = pactKindOf(e);
  const table = ctx.tunables.news.pactImportance;
  emit(draft, ctx, {
    kind: 'pactSigned',
    originId: capitalOf(draft, a) ?? capitalOf(draft, b),
    importance: Object.hasOwn(table, pact) ? (table[pact] ?? 2) : (kindImportance(ctx, 'pactSigned') ?? 2),
    facts: { a: factionName(draft, a), b: factionName(draft, b), pact },
    factionIds: factionList(a, b),
    refs: refsOf(a, b),
    dedupeKey: `pact:${a < b ? `${a}|${b}` : `${b}|${a}`}:${pact}:${draft.time.hour}`,
  });
}

/** PactBroken { a, b, kind, brokenBy (breakerId, byFactionId) }: importance + `pactBrokenBonus`. */
function onPactBroken(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const [a, b] = pactParties(e);
  if (a === undefined || b === undefined) return;
  const pact = pactKindOf(e);
  const breaker = factionIdOf(e['brokenBy'], e['breakerId'], e['byFactionId']) ?? a;
  const victim = breaker === a ? b : a;
  const table = ctx.tunables.news.pactImportance;
  const base = Object.hasOwn(table, pact) ? (table[pact] ?? 2) : (kindImportance(ctx, 'pactBroken') ?? 3);
  emit(draft, ctx, {
    kind: 'pactBroken',
    originId: capitalOf(draft, victim) ?? capitalOf(draft, breaker),
    importance: base + ctx.tunables.news.pactBrokenBonus,
    facts: { a: factionName(draft, a), b: factionName(draft, b), pact, breaker: factionName(draft, breaker) },
    factionIds: factionList(a, b),
    refs: refsOf(breaker, victim),
    dedupeKey: `pactBroken:${a < b ? `${a}|${b}` : `${b}|${a}`}:${pact}:${draft.time.hour}`,
  });
}

/** Marriage { aId, bId, factionAId?, factionBId? }: a marriage within a ruling house (+1 when a ruler weds). */
function onMarriage(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const a = charIdOf(e['aId']);
  const b = charIdOf(e['bId']);
  if (a === undefined || b === undefined) return;
  const fa = factionIdOf(e['factionAId']) ?? factionOfChar(draft, a);
  const fb = factionIdOf(e['factionBId']) ?? factionOfChar(draft, b);
  if (fa === undefined && fb === undefined) return;
  const ruler = factionRuledBy(draft, a) !== undefined || factionRuledBy(draft, b) !== undefined;
  emit(draft, ctx, {
    kind: 'marriage',
    originId: placeOfChar(draft, a) ?? placeOfChar(draft, b),
    importance: (kindImportance(ctx, 'marriage') ?? 2) + (ruler ? 1 : 0),
    facts: { a: charName(draft, a), b: charName(draft, b), factionA: factionName(draft, fa) || 'none', factionB: factionName(draft, fb) || 'none' },
    factionIds: factionList(fa, fb),
    refs: refsOf(a, b, fa, fb),
    dedupeKey: `marriage:${a < b ? `${a}|${b}` : `${b}|${a}`}`,
  });
}

/** SuccessionOccurred { factionId, deceasedId, heirId }: a new ruler takes the high seat (proclaimed). */
function onSuccession(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const faction = factionIdOf(e['factionId']);
  const heir = charIdOf(e['heirId']);
  if (faction === undefined || heir === undefined) return;
  const deceased = charIdOf(e['deceasedId']);
  emit(draft, ctx, {
    kind: 'succession',
    originId: capitalOf(draft, faction) ?? placeOfChar(draft, heir),
    importance: rulerImportance(ctx, draft, faction, kindImportance(ctx, 'succession') ?? 3),
    facts: { heir: charName(draft, heir), deceased: charName(draft, deceased) || 'none', faction: factionName(draft, faction) },
    factionIds: factionList(faction),
    refs: refsOf(faction, heir, deceased),
    dedupeKey: `succession:${faction}:${heir}`,
  });
}

/** TitleChanged { charId, titleKey, previousKey? }: a crowning when the new title names a king or queen. */
function onTitleChanged(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const charId = charIdOf(e['charId']);
  const title = str(e['titleKey']);
  if (charId === undefined || title === undefined) return;
  const words = ctx.tunables.news.crownTitleWords;
  const crowned = (key: string | undefined) => key !== undefined && words.some((w) => key.includes(w));
  if (!crowned(title) || crowned(str(e['previousKey']))) return;
  const faction = factionRuledBy(draft, charId) ?? factionOfChar(draft, charId);
  emit(draft, ctx, {
    kind: 'crowned',
    originId: capitalOf(draft, faction) ?? placeOfChar(draft, charId),
    facts: { name: charName(draft, charId), faction: factionName(draft, faction), title },
    factionIds: factionList(faction),
    refs: refsOf(charId, faction),
    dedupeKey: `crowned:${charId}:${title}`,
  });
}

/** AcclamationResult { winnerId (charId, kingId, acclaimedId), factionId? (winnerFactionId), success? }: a High King acclaimed. */
function onAcclamation(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  if (e['success'] === false || e['acclaimed'] === false) return;
  const winner = charIdOf(e['winnerId'], e['charId'], e['kingId'], e['acclaimedId'], e['candidateId']);
  const faction = factionIdOf(e['winnerFactionId'], e['factionId']) ?? factionRuledBy(draft, winner) ?? factionOfChar(draft, winner);
  if (winner === undefined && faction === undefined) return;
  emit(draft, ctx, {
    kind: 'acclamation',
    originId: capitalOf(draft, faction) ?? placeOfChar(draft, winner) ?? capitalOf(draft, draft.player.factionId),
    facts: { name: charName(draft, winner) || factionName(draft, faction), faction: factionName(draft, faction) },
    factionIds: factionList(faction),
    refs: refsOf(winner, faction),
    dedupeKey: `acclamation:${draft.time.hour}`,
  });
}

/** StormHit { fleetId, severity, shipsLost? (shipsSunk, sunkShipIds[], lostShipIds[]) }: ships lost to a storm. */
function onStormHit(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined);
  const ships = numOf(e['shipsLost']) ?? numOf(e['shipsSunk']) ?? len(e['sunkShipIds']) ?? len(e['lostShipIds']) ?? 0;
  if (ships < ctx.tunables.news.stormMinShipsLost) return;
  const fleetId = str(e['fleetId']);
  const pos = posOfFleet(draft, fleetId) ?? (rec(e['pos']) && numOf(rec(e['pos'])?.['x']) !== undefined ? { x: numOf(rec(e['pos'])?.['x']) ?? 0, y: numOf(rec(e['pos'])?.['y']) ?? 0 } : undefined);
  if (!pos) return;
  const owner = factionIdOf(e['ownerId'], e['factionId']) ?? (fleetId !== undefined && fleetId.startsWith('flt_') ? draft.fleets[fleetId as `flt_${string}`]?.ownerId : undefined);
  const originId = nearestSettlement(draft, pos);
  emit(draft, ctx, {
    kind: 'stormWreck',
    originId,
    importance: (kindImportance(ctx, 'stormWreck') ?? 1) + (ships >= 3 ? 1 : 0),
    facts: { place: settlementName(draft, originId), ships, faction: factionName(draft, owner) || 'none', severity: str(e['severity']) ?? 'moderate' },
    factionIds: factionList(owner),
    refs: refsOf(originId, owner),
  });
}

/** HoldingCaptured { settlementId, byFactionId (attackerFactionId), fromFactionId? }. */
function onHoldingCaptured(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const settlementId = settlementIdOf(e['settlementId'], e['holdingId']);
  if (settlementId === undefined || !Object.hasOwn(draft.settlements, settlementId)) return;
  const attacker = factionIdOf(e['byFactionId'], e['attackerFactionId'], e['captorFactionId']);
  const owner = factionIdOf(e['fromFactionId'], e['previousFactionId'], e['factionId']);
  emit(draft, ctx, {
    kind: 'holdingCaptured',
    originId: settlementId,
    importance: (kindImportance(ctx, 'holdingCaptured') ?? 3) + tierBonus(ctx, draft, settlementId),
    facts: { settlement: settlementName(draft, settlementId), attacker: factionName(draft, attacker) || 'none', faction: factionName(draft, owner) || 'none' },
    factionIds: factionList(attacker, owner),
    refs: refsOf(settlementId, attacker, owner),
    dedupeKey: `captured:${settlementId}:${draft.time.hour}`,
  });
}

/** RevoltStarted { settlementId (holdingId), factionId?, pretenderId? }. */
function onRevolt(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const settlementId = settlementIdOf(e['settlementId'], e['holdingId']);
  if (settlementId === undefined || !Object.hasOwn(draft.settlements, settlementId)) return;
  const faction = factionIdOf(e['factionId']) ?? draft.settlements[settlementId]?.factionId;
  const pretender = charIdOf(e['pretenderId']);
  emit(draft, ctx, {
    kind: 'revolt',
    originId: settlementId,
    importance: (kindImportance(ctx, 'revolt') ?? 2) + tierBonus(ctx, draft, settlementId),
    facts: { settlement: settlementName(draft, settlementId), faction: factionName(draft, faction), pretender: charName(draft, pretender) || 'none' },
    factionIds: factionList(faction),
    refs: refsOf(settlementId, faction, pretender),
    dedupeKey: `revolt:${settlementId}:${draft.time.hour}`,
  });
}

/** RelicFound { relicId, factionId (finderFactionId, holderId), siteId? }. */
function onRelicFound(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const faction = factionIdOf(e['factionId'], e['finderFactionId'], e['holderId']) ?? draft.player.factionId;
  const relicId = str(e['relicId']) ?? 'unknown';
  const siteId = siteIdOf(e['siteId']);
  emit(draft, ctx, {
    kind: 'relicFound',
    originId: siteSettlement(draft, siteId) ?? capitalOf(draft, faction),
    facts: { faction: factionName(draft, faction), relic: relicId },
    factionIds: factionList(faction),
    refs: refsOf(faction, relicId, siteId),
    dedupeKey: `relic:${relicId}:${faction}`,
  });
}

/** HouseFallsSilent { factionId, deceasedId }. */
function onHouseFallen(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const faction = factionIdOf(e['factionId']);
  if (faction === undefined) return;
  const deceased = charIdOf(e['deceasedId']);
  emit(draft, ctx, {
    kind: 'houseFallen',
    originId: capitalOf(draft, faction) ?? placeOfChar(draft, deceased),
    facts: { faction: factionName(draft, faction), name: charName(draft, deceased) || 'none' },
    factionIds: factionList(faction),
    refs: refsOf(faction, deceased),
    dedupeKey: `fallen:${faction}`,
  });
}

/** CaptureStarted { charId, byFactionId, at }: a ruler taken captive. */
function onCaptureStarted(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const charId = charIdOf(e['charId']);
  const faction = factionRuledBy(draft, charId);
  if (charId === undefined || faction === undefined) return;
  const captor = factionIdOf(e['byFactionId']);
  const at = settlementIdOf(e['at']);
  const originId = at !== undefined && Object.hasOwn(draft.settlements, at) ? at : placeOfChar(draft, charId);
  emit(draft, ctx, {
    kind: 'rulerCaptured',
    originId,
    importance: Math.max(kindImportance(ctx, 'rulerCaptured') ?? 3, rulerImportance(ctx, draft, faction, 3) - 1),
    facts: { name: charName(draft, charId), faction: factionName(draft, faction), captor: factionName(draft, captor) || 'none', place: settlementName(draft, originId) },
    factionIds: factionList(faction, captor),
    refs: refsOf(charId, faction, captor),
    dedupeKey: `capture:${charId}:${draft.time.hour}`,
  });
}

/** Birth { childId, motherId?, fatherId?, factionId? }: a child born to a ruler. */
function onBirth(draft: GameState, e: LooseEvent, ctx: SimContext): void {
  const child = charIdOf(e['childId']);
  const mother = charIdOf(e['motherId']);
  const father = charIdOf(e['fatherId']);
  const parent = factionRuledBy(draft, father) !== undefined ? father : factionRuledBy(draft, mother) !== undefined ? mother : undefined;
  if (child === undefined || parent === undefined) return;
  const faction = factionRuledBy(draft, parent);
  emit(draft, ctx, {
    kind: 'heirBorn',
    originId: placeOfChar(draft, mother ?? parent) ?? capitalOf(draft, faction),
    importance: toImportance((kindImportance(ctx, 'heirBorn') ?? 1) + (rulerImportance(ctx, draft, faction, 2) >= 4 ? 1 : 0)),
    facts: { parent: charName(draft, parent), faction: factionName(draft, faction), twin: e['twin'] === true ? 'yes' : 'no' },
    factionIds: factionList(faction),
    refs: refsOf(child, parent, faction),
    dedupeKey: `birth:${child}`,
  });
}

/** Event name → loose reaction. Wired into SimModule.reactions in index.ts. */
export const NEWS_REACTIONS: Readonly<Record<string, LooseReaction>> = {
  SettlementFate: onSettlementFate,
  Death: onDeath,
  BattleEnded: onBattleEnded,
  SeaBattleEnded: onSeaBattleEnded,
  DuelEnded: onDuelEnded,
  PactSigned: onPactSigned,
  PactBroken: onPactBroken,
  Marriage: onMarriage,
  SuccessionOccurred: onSuccession,
  TitleChanged: onTitleChanged,
  AcclamationResult: onAcclamation,
  StormHit: onStormHit,
  HoldingCaptured: onHoldingCaptured,
  RevoltStarted: onRevolt,
  RelicFound: onRelicFound,
  HouseFallsSilent: onHouseFallen,
  CaptureStarted: onCaptureStarted,
  Birth: onBirth,
};
