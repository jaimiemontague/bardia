/**
 * 'duel' sub-simulation (design §14, §22.5 injuries, ADR-003).
 * Owns (src/sim/core/ownership.ts):
 *   effects: startDuel
 *   commands: startDuel, applyDuelResult
 *   pending kinds: duel
 *   events: DuelEnded (+ DuelDeclined, module-internal)
 *   state slices: subsims.duel (+ subsims.duelQueue)
 * Tunables: src/content/data/tunables/duel.json (ctx.tunables.duel); §31 tables: balance.duel / balance.weapons.
 * Strings: src/content/locales/en/duel.json (prefix 'duel.').
 *
 * Flow:
 *   1. `startDuel` effect (battle Challenge, boarding captain, tavern challenge, Thing holmgang, the
 *      Nemesis, relic guardians, storylets) builds a DuelSetup with fighter profiles. A duel of the
 *      player's house goes into `subsims.duel` (or the queue) and raises the `duel` decision; a duel
 *      between two NPCs is auto-resolved at once (DuelEnded only).
 *   2. `startDuel` command: choose the weapon and the mode. `auto` resolves now (§14.8); `decline`
 *      (tavern-style challenges) costs a little Renown; `realtime`/`assisted` mark the duel running —
 *      the decision stays pending (time stays stopped) while the client runs the pure engines
 *      (engine.ts at 60 Hz, assisted.ts) from `setup` alone.
 *   3. `applyDuelResult` command: the client hands back the fight summary and the player's
 *      spare/capture/kill decision; the §14.9 consequences are applied (people ops for wounds,
 *      traits, death and capture; core standings) and DuelEnded is emitted.
 */
import { CommandError } from '@sim/core/commands';
import { EffectError, type EffectData } from '@sim/core/effects';
import type { SimContext, SimModule } from '@sim/core/module';
import { seedStringFrom } from '@sim/core/rng';
import type { DuelId, DuelSetup, GameState } from '@sim/core/state';
import { autoResolveDuel } from './autoresolve';
import { choiceProblem, decideOutcome, type OutcomeWorld } from './outcome';
import { ApplyDuelResultCommandSchema, StartDuelCommandSchema, StartDuelEffectSchema } from './schemas';
import { buildDuelSetup, captiveSettlement, characterOf, computeProfiles, factionOfCharacter, resolveRef } from './setup';
import { allowedWeapons, type DuelContent } from './stats';
import './types';
import type { DuelChoice, DuelFightSummary, DuelMode, DuelSide, DuelSlot } from './types';

export { autoResolveDuel, duelWinProbability } from './autoresolve';
export { AssistedDuel, choiceCategory, tellAccuracy } from './assisted';
export type { AssistedAct, AssistedEvent, AssistedExchangeReport, AssistedFighterView, AssistedOptions, AssistedPrompt } from './assisted';
export { skilledDifficulty } from './ai';
export { DuelEngine } from './engine';
export type { DuelAction, DuelEngineOptions, DuelFighterView, DuelFx, DuelGlyphView, DuelInput, DuelRenderState } from './engine';
export { glyphKind, glyphShowFraction, otherSide } from './glyph';
export { choiceProblem, decideOutcome, rollInjury } from './outcome';
export { buildDuelSetup, computeProfiles, omenNervePct, playerSideOf, renownTier } from './setup';
export {
  allowedWeapons,
  buildProfile,
  defaultWeapon,
  duelHpMax,
  duelRating,
  duelShieldMax,
  duelStaminaMax,
  effectiveStats,
  nervePct,
  parryWindowMs,
  profileFromCharacter,
  strikeDamage,
  windupSpeedMult,
} from './stats';

/** The content slice the duel code reads, from a SimContext. */
export function duelContent(ctx: Pick<SimContext, 'balance' | 'content' | 'tunables'>): DuelContent {
  return { balance: ctx.balance, traits: ctx.content.traits, feats: ctx.content.feats, cultures: ctx.content.cultures, tunables: ctx.tunables };
}

function outcomeWorld(state: GameState, ctx: SimContext, setup: DuelSetup): OutcomeWorld {
  const a = characterOf(state, setup.a.charId);
  const b = characterOf(state, setup.b.charId);
  return {
    playerRulerId: state.player.rulerId,
    playerFactionId: state.player.factionId,
    factionOf: { a: a ? factionOfCharacter(state, a) : undefined, b: b ? factionOfCharacter(state, b) : undefined },
    captiveAt: { a: a ? captiveSettlement(state, a) : undefined, b: b ? captiveSettlement(state, b) : undefined },
  };
}

/** Is this the current pending `duel` decision for `duelId`? */
function isCurrentDecision(state: GameState, duelId: DuelId): boolean {
  const p = state.pending;
  return p !== null && p.kind === 'duel' && p.payload.duelId === duelId;
}

function resolveDecision(state: GameState, ctx: SimContext, duelId: DuelId): void {
  const p = state.pending;
  if (p !== null && p.kind === 'duel' && p.payload.duelId === duelId) ctx.resolvePending(p.id);
}

/** Applies the §14.9 consequences of a finished fight and emits DuelEnded. */
function finalize(state: GameState, ctx: SimContext, setup: DuelSetup, fight: DuelFightSummary, mode: DuelMode, choice: DuelChoice | undefined, entry?: DuelSlot): void {
  const outcome = decideOutcome({
    setup,
    fight,
    mode,
    choice,
    balance: ctx.balance,
    tunables: ctx.tunables.duel,
    world: outcomeWorld(state, ctx, setup),
    rng: ctx.rng('duel:outcome'),
  });
  if (entry) {
    entry.result = outcome.result;
    entry.status = 'resolved';
  }
  // People ops (wounds, traits, death, captivity) are skipped when the people module is not loaded
  // (subset runs); core standings are always present.
  const effects = outcome.effects.filter((e: EffectData) => ctx.env.effects.has(e.op));
  ctx.applyEffects(effects);
  if (outcome.chronicle) ctx.chronicle({ kind: 'duel', ...outcome.chronicle });
  if (outcome.notify) {
    const playerSide = setup.playerSide ?? 'a';
    const opponent = setup[playerSide === 'a' ? 'b' : 'a'].charId;
    ctx.notify(outcome.notify.key, { priority: outcome.notify.priority, vars: outcome.notify.vars, link: { kind: 'character', id: opponent } });
  }
  const event: Parameters<SimContext['emit']>[0] = {
    type: 'DuelEnded',
    duelId: setup.id,
    origin: setup.origin ?? 'other',
    playerSide: setup.playerSide ?? null,
    winnerId: outcome.result.winnerId,
    loserId: setup[outcome.loserSide].charId,
    setup,
    result: outcome.result,
  };
  if (setup.ref !== undefined) event.ref = setup.ref;
  ctx.emit(event);
}

/** Finds a duel by id in the slot or the queue; a queued duel is moved into the (free) slot. */
function takeEntry(state: GameState, duelId: DuelId): DuelSlot | undefined {
  const slot = state.subsims.duel;
  if (slot && slot.id === duelId) return slot;
  const queue = state.subsims.duelQueue;
  const index = queue ? queue.findIndex((e) => e.id === duelId) : -1;
  if (!queue || index < 0) return undefined;
  if (slot && slot.status !== 'resolved') throw new CommandError('slotBusy', `Duel ${slot.id} is still being fought`);
  const [entry] = queue.splice(index, 1);
  if (queue.length === 0) delete state.subsims.duelQueue;
  state.subsims.duel = entry;
  return state.subsims.duel;
}

function fighterAlive(state: GameState, charId: DuelSetup['a']['charId']): boolean {
  return characterOf(state, charId)?.alive === true;
}

function cancel(state: GameState, ctx: SimContext, entry: DuelSlot): void {
  entry.status = 'resolved';
  resolveDecision(state, ctx, entry.setup.id);
  ctx.notify('duel.notify.cancelled', { priority: 'normal', vars: {} });
}

export const module: SimModule = {
  id: 'duel',
  order: 210,
  version: 1,

  init() {
    // Nothing to create: the duel slot is optional and filled by the startDuel effect.
  },

  migrate() {
    // v1 is the first version.
  },

  effects: {
    startDuel(draft, e, ctx) {
      const refs = { a: resolveRef(draft, e.a), b: resolveRef(draft, e.b) };
      if (refs.a.charId === refs.b.charId) throw new EffectError(`startDuel: a fighter cannot duel itself (${refs.a.charId})`);
      for (const side of ['a', 'b'] as const) {
        const ch = characterOf(draft, refs[side].charId);
        if (!ch) throw new EffectError(`startDuel: unknown character ${refs[side].charId}`);
        if (!ch.alive) throw new EffectError(`startDuel: ${ch.id} is dead`);
      }
      const id = ctx.newId('duel');
      const seed = seedStringFrom(ctx.rng('duel'));
      const content = duelContent(ctx);
      const setup = buildDuelSetup(draft, content, e, refs, id, seed);
      if (setup.playerSide === null || setup.playerSide === undefined) {
        // Two NPCs: auto-resolved at once (§14.8).
        setup.mode = 'auto';
        const auto = autoResolveDuel(setup, ctx.balance, ctx.rng('duel:auto'));
        finalize(draft, ctx, setup, auto.summary, 'auto', undefined);
        return;
      }
      const entry: DuelSlot = { id, status: 'setup', startedHour: ctx.hour, setup };
      const slot = draft.subsims.duel;
      if (!slot || slot.status === 'resolved') draft.subsims.duel = entry;
      else (draft.subsims.duelQueue ??= []).push(entry);
      const side: DuelSide = setup.playerSide;
      ctx.pend({
        kind: 'duel',
        payload: {
          duelId: id,
          origin: e.origin,
          stakes: setup.stakes,
          lethal: setup.lethal ?? false,
          declinable: setup.declinable ?? false,
          fighterId: setup[side].charId,
          opponentId: setup[side === 'a' ? 'b' : 'a'].charId,
        },
      });
    },
  },
  effectSchemas: { startDuel: StartDuelEffectSchema },

  handlers: {
    startDuel(draft, cmd, ctx) {
      if (!isCurrentDecision(draft, cmd.duelId)) throw new CommandError('notPending', `Duel ${cmd.duelId} is not the pending decision`);
      const entry = takeEntry(draft, cmd.duelId);
      if (!entry) throw new CommandError('unknownDuel', `No duel ${cmd.duelId}`);
      if (entry.status !== 'setup') throw new CommandError('alreadyStarted', `Duel ${cmd.duelId} has already started`);
      const setup = entry.setup;
      const playerSide = setup.playerSide;
      if (playerSide === null || playerSide === undefined) throw new CommandError('notPlayerDuel', `Duel ${cmd.duelId} is not the player's`);
      if (!fighterAlive(draft, setup.a.charId) || !fighterAlive(draft, setup.b.charId)) {
        cancel(draft, ctx, entry);
        return;
      }
      if (cmd.mode === 'decline') {
        if (!setup.declinable) throw new CommandError('notDeclinable', 'This duel cannot be declined');
        const origin = setup.origin ?? 'other';
        const table = ctx.tunables.duel.outcome.declineRenown;
        const renown = Object.hasOwn(table, origin) ? (table[origin] ?? 0) : 0;
        if (renown !== 0) ctx.applyEffects([{ op: 'changeRenown', amount: renown }]);
        entry.status = 'resolved';
        const event: Parameters<SimContext['emit']>[0] = {
          type: 'DuelDeclined',
          duelId: setup.id,
          origin,
          declinerId: setup[playerSide].charId,
          challengerId: setup[playerSide === 'a' ? 'b' : 'a'].charId,
          renown,
        };
        if (setup.ref !== undefined) event.ref = setup.ref;
        ctx.emit(event);
        ctx.notify('duel.notify.declined', { priority: 'normal', vars: { renown } });
        resolveDecision(draft, ctx, setup.id);
        return;
      }
      if (cmd.weapon !== undefined) {
        const mine = setup[playerSide];
        if (!allowedWeapons(ctx.balance, mine.weaponTier).includes(cmd.weapon)) {
          throw new CommandError('weaponNotAllowed', `Weapon '${cmd.weapon}' needs weapon tier ${ctx.balance.weapons[cmd.weapon].minWeaponTier}`);
        }
        mine.weapon = cmd.weapon;
      }
      if (cmd.mode === 'realtime' && setup.champion && !ctx.tunables.duel.outcome.championRealtime) {
        throw new CommandError('championRealtime', 'A champion fights in Assisted Mode or is auto-resolved (§14.1)');
      }
      if (cmd.onWin !== undefined && cmd.mode !== 'auto') throw new CommandError('onWinAutoOnly', 'onWin applies to auto-resolved duels only');
      setup.mode = cmd.mode;
      setup.assisted = cmd.mode === 'assisted';
      setup.profiles = computeProfiles(draft, duelContent(ctx), setup);
      if (cmd.mode === 'auto') {
        const auto = autoResolveDuel(setup, ctx.balance, ctx.rng('duel:auto'));
        finalize(draft, ctx, setup, auto.summary, 'auto', cmd.onWin, entry);
        resolveDecision(draft, ctx, setup.id);
        return;
      }
      entry.status = 'running';
    },

    applyDuelResult(draft, cmd, ctx) {
      const entry = draft.subsims.duel;
      if (!entry || entry.id !== cmd.duelId) throw new CommandError('unknownDuel', `Duel ${cmd.duelId} is not in the duel slot`);
      if (entry.status !== 'running') throw new CommandError('notRunning', `Duel ${cmd.duelId} is not being fought`);
      const setup = entry.setup;
      const mode = setup.mode ?? 'realtime';
      if (mode === 'auto') throw new CommandError('notRunning', `Duel ${cmd.duelId} was auto-resolved`);
      const fight = cmd.outcome;
      if (fight.reason === 'firstBlood' && setup.stakes !== 'firstBlood') throw new CommandError('invalidOutcome', 'First blood ends only duels to first blood');
      if (fight.reason === 'ringOut' && !ctx.tunables.duel.arenas[setup.arena].ringOut) throw new CommandError('invalidOutcome', `The ${setup.arena} arena has no boundary to leave`);
      if (!fighterAlive(draft, setup.a.charId) || !fighterAlive(draft, setup.b.charId)) {
        cancel(draft, ctx, entry);
        return;
      }
      const playerWon = setup.playerSide === fight.winner;
      if (playerWon && cmd.choice !== undefined) {
        const problem = choiceProblem(setup, ctx.tunables.duel, outcomeWorld(draft, ctx, setup), fight.winner, fight.reason, cmd.choice);
        if (problem !== null) throw new CommandError('invalidChoice', problem);
      }
      finalize(draft, ctx, setup, fight, mode, playerWon ? cmd.choice : undefined, entry);
      resolveDecision(draft, ctx, setup.id);
    },
  },
  commandSchemas: { startDuel: StartDuelCommandSchema, applyDuelResult: ApplyDuelResultCommandSchema },

  invariants(state: GameState): string[] {
    const out: string[] = [];
    const decisions = [state.pending, ...state.pendingQueue].filter((p) => p !== null && p.kind === 'duel');
    const hasDecision = (id: DuelId) => decisions.some((p) => p?.kind === 'duel' && p.payload.duelId === id);
    const check = (entry: DuelSlot, where: string) => {
      const s = entry.setup;
      if (entry.id !== s.id) out.push(`${where}: slot id ${entry.id} != setup id ${s.id}`);
      if (s.a.charId === s.b.charId) out.push(`${where}: ${s.id} pits ${s.a.charId} against itself`);
      if (!s.profiles) out.push(`${where}: ${s.id} has no profiles`);
      else {
        for (const side of ['a', 'b'] as const) {
          const p = s.profiles[side];
          if (!(p.hpMax > 0) || !(p.hpStart > 0) || p.hpStart > p.hpMax + 1e-9) out.push(`${where}: ${s.id}.${side} bad HP ${p.hpStart}/${p.hpMax}`);
          if (!(p.staminaMax > 0) || p.shieldMax < 0 || p.shields < 0) out.push(`${where}: ${s.id}.${side} bad bars`);
          if (p.charId !== s[side].charId) out.push(`${where}: ${s.id}.${side} profile is for ${p.charId}`);
        }
      }
      if (entry.status !== 'resolved' && !hasDecision(s.id)) out.push(`${where}: ${s.id} is ${entry.status} without a pending duel decision`);
      if (entry.result) {
        const r = entry.result;
        if (r.winnerId !== s.a.charId && r.winnerId !== s.b.charId) out.push(`${where}: ${s.id} winner ${r.winnerId} is not a fighter`);
        if (r.loserFate === 'killed' && s.stakes !== 'death') out.push(`${where}: ${s.id} killed a fighter in a duel to ${s.stakes}`);
        if (!Number.isFinite(r.renown)) out.push(`${where}: ${s.id} renown ${r.renown}`);
      }
    };
    const slot = state.subsims.duel;
    if (slot) check(slot, 'subsims.duel');
    for (const q of state.subsims.duelQueue ?? []) {
      check(q, 'subsims.duelQueue');
      if (q.status !== 'setup') out.push(`subsims.duelQueue: ${q.id} is ${q.status}`);
    }
    for (const p of decisions) {
      if (p?.kind !== 'duel') continue;
      const id = p.payload.duelId;
      const known = slot?.id === id || (state.subsims.duelQueue ?? []).some((q) => q.id === id);
      if (!known) out.push(`pending duel decision ${p.id} names unknown duel ${id}`);
    }
    return out;
  },
};
