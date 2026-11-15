/**
 * Reactions to other modules' domain events (ARCHITECTURE §11). Payloads are read DEFENSIVELY —
 * the battle/duel/sea-battle modules declare their own event shapes, and this module never imports
 * their code — so unknown or missing fields are simply ignored.
 *
 *  - BattleEnded: XP from `result.xp` (raw; Wits and the lieutenant rate are applied here), leader
 *    fates from `result.leaderFates` (wounded / seriouslyWounded (+ injury roll) / mortallyWounded /
 *    captured / dead), else `result.playerFate` and `result.chief`.
 *  - DuelEnded (and a sea battle's `captainDuel`): XP for the winner (50 + 10 × loser level unless
 *    the result carries `xp`), `injuries`, and the loser's fate (killed / captured; Gentle Mode turns
 *    the player's death in a duel into capture).
 *  - StandingChanged: the ruler's Honor/Dread title variant is refreshed.
 *
 * The duel and sea-battle modules apply their character consequences themselves through this
 * module's ops and leave the XP to people; this pass is then a safety net. Every change goes
 * through idempotent primitives (a reported death of someone already dead, a capture by the same
 * captor, or the same wound twice change nothing), and an injury already on the character — or
 * already given in this operation by the event's owner — is not applied again.
 */
import type { SimContext } from '@sim/core/module';
import type { Character, FactionId, GameState, SettlementId } from '@sim/core/state';
import { captureCharacter } from './captivity';
import { killCharacter } from './death';
import { applyInjury, rollAndApplyInjury, WOUND_ORDER, woundCharacter } from './health';
import { grantXp, refreshTitle } from './progression';
import { charOf } from './util';

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function factionOf(state: GameState, v: unknown): FactionId | undefined {
  const id = str(v);
  return id !== undefined && Object.hasOwn(state.factions, id) ? (id as FactionId) : undefined;
}

/** Grants each entry of an `xp` record (charId → base XP). */
function grantXpRecord(draft: GameState, ctx: SimContext, xp: unknown, source: string): void {
  const r = rec(xp);
  if (!r) return;
  for (const [id, amount] of Object.entries(r)) {
    const c = charOf(draft, id);
    if (c && typeof amount === 'number' && Number.isFinite(amount) && amount > 0) grantXp(draft, ctx, c, amount, source);
  }
}

/** True if this operation already gave the character an injury (the event's owner applied it). */
function injuredThisOperation(ctx: SimContext, id: string): boolean {
  for (const e of ctx.events) {
    if (e.type === 'CharacterWounded' && e.charId === id && e.injury !== undefined) return true;
    if (e.type === 'TraitGained' && e.charId === id && e.source === 'injury') return true;
  }
  return false;
}

/** True if the injury's lasting effect is already on the character (so reporting it twice changes nothing). */
function injuryPresent(c: Character, id: string, ctx: SimContext): boolean {
  const row = ctx.balance.health.injuryTable.find((r) => r.id === id);
  if (!row) return c.traits.includes(id);
  if (row.trait !== undefined) return c.traits.includes(row.trait);
  if (row.wound !== undefined) return WOUND_ORDER[c.health.wound] >= WOUND_ORDER[row.wound];
  if (row.days !== undefined) return c.health.injuries.some((i) => i.id === row.id && (i.untilHour ?? Infinity) > ctx.hour);
  return true;
}

/** Where a captor holds someone taken at `site` (the site if the captor owns it, else its court). */
function holdAt(state: GameState, captor: FactionId, site: SettlementId | undefined): SettlementId | undefined {
  if (site !== undefined && state.settlements[site]?.factionId === captor) return site;
  return undefined;
}

function applyFate(
  draft: GameState,
  ctx: SimContext,
  c: Character,
  fate: string,
  captor: FactionId | undefined,
  site: SettlementId | undefined,
  cause: string,
): void {
  if (!c.alive) return;
  switch (fate) {
    case 'wounded':
      woundCharacter(draft, ctx, c, 'minor', cause);
      break;
    case 'seriouslyWounded':
      woundCharacter(draft, ctx, c, 'serious', cause);
      if (!injuredThisOperation(ctx, c.id)) rollAndApplyInjury(draft, ctx, c, cause);
      break;
    case 'mortallyWounded':
      woundCharacter(draft, ctx, c, 'mortal', cause);
      break;
    case 'captured':
      if (captor !== undefined && captor !== c.factionId) {
        const at = holdAt(draft, captor, site);
        captureCharacter(draft, ctx, c, captor, { cause, ...(at !== undefined ? { at } : {}) });
      }
      break;
    case 'dead':
    case 'killed':
      killCharacter(draft, ctx, c, cause, captor !== undefined ? { byFactionId: captor } : {});
      break;
    default:
      break;
  }
}

/** BattleEnded (owner: battle). */
export function onBattleEnded(draft: GameState, event: unknown, ctx: SimContext): void {
  const e = rec(event);
  const result = rec(e?.result);
  if (!e || !result) return;
  grantXpRecord(draft, ctx, result.xp, 'battle');
  const setup = rec(e.setup);
  const attacker = factionOf(draft, e.attackerFactionId) ?? factionOf(draft, rec(setup?.attacker)?.factionId);
  const defender = factionOf(draft, e.defenderFactionId) ?? factionOf(draft, rec(setup?.defender)?.factionId);
  const site = str(e.settlementId) as SettlementId | undefined;
  const captorFor = (c: Character): FactionId | undefined => {
    if (c.factionId !== undefined && c.factionId === attacker) return defender;
    if (c.factionId !== undefined && c.factionId === defender) return attacker;
    return undefined;
  };
  const handled: string[] = [];
  const fates = rec(result.leaderFates);
  if (fates) {
    for (const [id, fate] of Object.entries(fates)) {
      const c = charOf(draft, id);
      if (!c || typeof fate !== 'string') continue;
      handled.push(id);
      applyFate(draft, ctx, c, fate, captorFor(c), site, 'battle');
    }
  }
  const ruler = charOf(draft, draft.player.rulerId);
  const playerFate = str(result.playerFate);
  if (ruler && playerFate !== undefined && !handled.includes(ruler.id)) {
    handled.push(ruler.id);
    applyFate(draft, ctx, ruler, playerFate, captorFor(ruler), site, 'battle');
  }
  const chief = rec(result.chief);
  if (chief && (chief.killed === true || chief.captured === true)) {
    const playerSide = str(e.playerSide);
    const enemySide = rec(playerSide === 'defender' ? setup?.attacker : setup?.defender);
    const chiefChar = charOf(draft, str(enemySide?.chiefId));
    if (chiefChar && !handled.includes(chiefChar.id)) applyFate(draft, ctx, chiefChar, chief.killed === true ? 'dead' : 'captured', captorFor(chiefChar), site, 'battle');
  }
}

/** Applies a duel result (DuelEnded, or a sea battle's captainDuel). */
export function applyDuelResult(draft: GameState, ctx: SimContext, result: Rec, setup: Rec | undefined, cause: string): void {
  const winner = charOf(draft, str(result.winnerId));
  if (!winner) return;
  let loser = charOf(draft, str(result.loserId));
  if (!loser && setup) {
    const a = charOf(draft, str(rec(setup.a)?.charId));
    const b = charOf(draft, str(rec(setup.b)?.charId));
    loser = a && a.id !== winner.id ? a : b && b.id !== winner.id ? b : undefined;
  }
  if (rec(result.xp)) grantXpRecord(draft, ctx, result.xp, 'duel');
  else {
    const s = ctx.balance.xp.sources;
    grantXp(draft, ctx, winner, s.duelWinBase + s.duelWinPerLevel * (loser?.level ?? 1), 'duel');
  }
  if (Array.isArray(result.injuries)) {
    for (const raw of result.injuries) {
      const inj = rec(raw);
      const c = charOf(draft, str(inj?.charId));
      const id = str(inj?.injury);
      if (!c || id === undefined) continue;
      const known = ctx.balance.health.injuryTable.some((r) => r.id === id) || Object.hasOwn(ctx.content.traits, id);
      if (known && !injuryPresent(c, id, ctx)) applyInjury(draft, ctx, c, id, cause);
    }
  }
  if (!loser?.alive) return;
  const fate = str(result.loserFate);
  const captor = winner.factionId !== undefined && winner.factionId !== loser.factionId ? winner.factionId : undefined;
  if (fate === 'killed') {
    const gentleSaves = draft.meta.options.gentleMode && loser.id === draft.player.rulerId && captor !== undefined;
    if (gentleSaves) captureCharacter(draft, ctx, loser, captor, { cause });
    else killCharacter(draft, ctx, loser, cause, { killerId: winner.id, ...(captor !== undefined ? { byFactionId: captor } : {}) });
  } else if (fate === 'captured' && captor !== undefined) {
    captureCharacter(draft, ctx, loser, captor, { cause });
  }
}

/** DuelEnded (owner: duel). */
export function onDuelEnded(draft: GameState, event: unknown, ctx: SimContext): void {
  const e = rec(event);
  if (!e) return;
  const result = rec(e.result) ?? (str(e.winnerId) !== undefined ? e : undefined);
  if (result) applyDuelResult(draft, ctx, result, rec(e.setup), 'duel');
}

/** SeaBattleEnded (owner: seabattle). */
export function onSeaBattleEnded(draft: GameState, event: unknown, ctx: SimContext): void {
  const e = rec(event);
  const result = rec(e?.result);
  if (!result) return;
  grantXpRecord(draft, ctx, result.xp, 'seaBattle');
  const duel = rec(result.captainDuel);
  if (duel) applyDuelResult(draft, ctx, duel, undefined, 'duel');
}

/** StandingChanged (core): the ruler's title may change with Honor, Dread or Renown. */
export function onStandingChanged(draft: GameState, event: unknown, ctx: SimContext): void {
  const stat = str(rec(event)?.stat);
  if (stat !== 'honor' && stat !== 'dread' && stat !== 'renown') return;
  const ruler = charOf(draft, draft.player.rulerId);
  if (ruler) refreshTitle(draft, ctx, ruler);
}

