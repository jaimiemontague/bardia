/**
 * 'battle' sub-simulation (design §13, §31.8–§31.11, §16.1–§16.2; ADR-003 real-time with pause).
 * Owns (src/sim/core/ownership.ts):
 *   effects: startBattle
 *   commands: startBattle, applyBattleResult
 *   pending kinds: battleSetup
 *   events: BattleStarted, BattleEnded
 *   state slices: subsims.battle
 * Tunables: src/content/data/tunables/battle.json (ctx.tunables.battle; schemas/tunables/battle.ts).
 * Strings/assets: locales/en/battle.json, assets/manifest/battle.json (prefix 'battle.').
 * Gate: npm run verify:module -- battle
 *
 * Flow: another module applies `startBattle {kind, attacker, defender, settlementId?, siteId?,
 * approach?, timerS?, origin}`. The effect gathers both sides from GameState (setup.ts). With the
 * player on a side it stores the setup in `subsims.battle` and raises the `battleSetup` decision
 * (the pre-battle screen: intel, approach, Groups, predicted outcome). The `startBattle` command
 * confirms it: `mode: 'auto'` resolves at once (autoresolve.ts); `mode: 'fight'` hands the setup to
 * the tactical engine (engine/, run by the client: `BattleEngine.create(setup, content)`), and time
 * stays stopped until `applyBattleResult` writes the outcome back through the owners' effects
 * (apply.ts) and emits `BattleEnded`. Battles without the player are auto-resolved at once.
 *
 * The tactical engine is pure TS outside Immer (fixed 20 Hz step, own Rng from `setup.seed`):
 * engine/engine.ts is the client API (orders, advance, snapshot, duel hand-off, replays).
 * Seams for the next agents: `autoresolve.ts` (auto-resolve + parity) and `ai/` (battle AI).
 */
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import type { SimContext, SimModule } from '@sim/core/module';
import { Rng, seedStringFrom } from '@sim/core/rng';
import type { BattleResult, BattleSetup, GameState } from '@sim/core/state';
import './types';
import { applyEffectsChecked, battleResultEffects, validateBattleResult } from './apply';
import { autoResolveBattle } from './autoresolve';
import { applyGroups, groupsIssues } from './groups';
import { ApplyBattleResultCommandSchema, AutoResolveBattleEffectSchema, StartBattleCommandSchema, StartBattleEffectSchema } from './schemas';
import { buildBattleSetup, canNightRaid } from './setup';
import type { BattleSideKey } from './types';
import { jsonCopy } from './util';

export { BattleEngine, replayBattle, type BattleSpeed } from './engine/engine';
export type { BattleRenderState, SquadView, BuildingView, GateView, CacheView, ProjectileView, FigureView } from './engine/snapshot';
export type { BattleOrder, BattleEngineEvent, BattleEngineEventKind, BattleReplay, DuelRequest, EndState, EngineStatus, BattleAiFactory, BattleAiController } from './engine/types';
export type { DuelOutcome } from './engine/leaders';
export { autoResolveBattle, predictBattle, type BattlePrediction, type OutcomeBand } from './autoresolve';
export { battleResultEffects, validateBattleResult } from './apply';
export { buildBattleSetup, canNightRaid } from './setup';
export { groupsIssues, applyGroups } from './groups';
export { generateBattleMap } from './map/generate';
export { validateBattleMap } from './map/validate';
export { ABILITY_IDS, type AbilityId } from './data';
export type * from './types';

/** The side the player fights on, if any. */
export function playerSideOf(setup: BattleSetup): BattleSideKey | undefined {
  return setup.attacker.isPlayer ? 'attacker' : setup.defender.isPlayer ? 'defender' : undefined;
}

/** Auto-resolves a setup with its own seed (deterministic, independent of other streams). */
function autoResult(ctx: SimContext, setup: BattleSetup): BattleResult {
  return autoResolveBattle(setup, ctx.content, Rng.derive(setup.seed, 'autoresolve'));
}

function emitStarted(ctx: SimContext, setup: BattleSetup, mode: 'fight' | 'auto'): void {
  const e: Parameters<SimContext['emit']>[0] = {
    type: 'BattleStarted',
    battleId: setup.id,
    kind: setup.kind,
    origin: setup.origin ?? 'unknown',
    attackerFactionId: setup.attacker.factionId,
    defenderFactionId: setup.defender.factionId,
    mode,
  };
  if (setup.settlementId !== undefined) e.settlementId = setup.settlementId;
  if (setup.siteId !== undefined) e.siteId = setup.siteId;
  const ps = playerSideOf(setup);
  if (ps !== undefined) e.playerSide = ps;
  ctx.emit(e);
}

/** Writes a result back (effects), tells the player, and emits BattleEnded. */
function applyResult(draft: GameState, ctx: SimContext, setup: BattleSetup, result: BattleResult): void {
  const { effects, lootApplied } = battleResultEffects(draft, ctx.content, setup, result);
  const unapplied = applyEffectsChecked(ctx, effects);
  const ps = playerSideOf(setup);
  if (ps !== undefined) {
    const enemy: BattleSideKey = ps === 'attacker' ? 'defender' : 'attacker';
    const lost = (side: BattleSideKey) => result.casualties.filter((c) => c.side === side).reduce((a, c) => a + c.killed, 0);
    const place = setup.settlementId !== undefined ? (draft.settlements[setup.settlementId]?.name ?? '') : '';
    const vars = { kind: setup.kind, place, hasPlace: place !== '' ? 'yes' : 'no', killed: lost(ps), enemyKilled: lost(enemy), loot: Math.round(result.lootValue), burned: result.buildingsBurned };
    const outcome = result.winner === ps ? 'victory' : result.winner === 'none' ? 'draw' : result.retreated ? 'retreat' : 'defeat';
    ctx.notify(`battle.notify.${outcome}`, { priority: outcome === 'victory' ? 'normal' : 'high', vars });
    ctx.chronicle({
      kind: 'battle',
      textKey: `battle.chronicle.${outcome}`,
      importance: clamp(1 + Math.floor((vars.killed + vars.enemyKilled) / 40) + (result.chief.killed || result.chief.captured ? 1 : 0), 1, 5),
      vars,
      refs: [setup.id, ...(setup.settlementId !== undefined ? [setup.settlementId] : []), ...(setup.siteId !== undefined ? [setup.siteId] : [])],
    });
  }
  const ended: Parameters<SimContext['emit']>[0] = {
    type: 'BattleEnded',
    battleId: setup.id,
    kind: setup.kind,
    origin: setup.origin ?? 'unknown',
    attackerFactionId: setup.attacker.factionId,
    defenderFactionId: setup.defender.factionId,
    result,
    setup,
    lootApplied,
    unapplied,
  };
  if (setup.settlementId !== undefined) ended.settlementId = setup.settlementId;
  if (setup.siteId !== undefined) ended.siteId = setup.siteId;
  if (ps !== undefined) ended.playerSide = ps;
  ctx.emit(ended);
}

function resolveOurPending(draft: GameState, ctx: SimContext, battleId: string): void {
  const p = draft.pending;
  if (p && p.kind === 'battleSetup' && p.payload.battleId === battleId) ctx.resolvePending(p.id);
}

export const module: SimModule = {
  id: 'battle',
  order: 200,
  version: 1,
  effects: {
    startBattle(draft, e, ctx) {
      const rng = ctx.rng('battle');
      const setup = buildBattleSetup(draft, ctx.content, e, { id: ctx.newId('bat'), seed: seedStringFrom(rng) });
      if (playerSideOf(setup) === undefined) {
        emitStarted(ctx, setup, 'auto');
        applyResult(draft, ctx, setup, autoResult(ctx, setup));
        return;
      }
      const slot = draft.subsims.battle;
      if (slot && slot.status !== 'resolved') throw new EffectError(`startBattle: battle ${slot.id} is still unresolved`);
      draft.subsims.battle = { id: setup.id, status: 'setup', startedHour: ctx.hour, setup };
      ctx.pend({ kind: 'battleSetup', payload: { battleId: setup.id } });
    },
    autoResolveBattle(draft, e, ctx) {
      const rng = ctx.rng('battle');
      const setup = buildBattleSetup(draft, ctx.content, e, { id: ctx.newId('bat'), seed: seedStringFrom(rng) });
      emitStarted(ctx, setup, 'auto');
      applyResult(draft, ctx, setup, autoResult(ctx, setup));
    },
  },
  effectSchemas: { startBattle: StartBattleEffectSchema, autoResolveBattle: AutoResolveBattleEffectSchema },
  handlers: {
    startBattle(draft, cmd, ctx) {
      const slot = draft.subsims.battle;
      if (!slot || slot.id !== cmd.battleId) throw new CommandError('noBattle', `No battle ${cmd.battleId}`);
      if (slot.status !== 'setup') throw new CommandError('alreadyStarted', `Battle ${cmd.battleId} is ${slot.status}`);
      const setup = slot.setup;
      if (cmd.approach !== undefined && cmd.approach !== setup.approach) {
        if (cmd.approach === 'night' && !canNightRaid(setup, ctx.content)) throw new CommandError('nightRaidUnavailable', 'A night raid needs Wolf-coats or a leader with Wildcraft 5');
        setup.approach = cmd.approach;
        setup.weather.night = cmd.approach === 'night';
      }
      if (cmd.squads !== undefined) {
        const issues = groupsIssues(setup, cmd.squads, ctx.content);
        if (issues.length > 0) throw new CommandError('badGroups', issues.join('; '));
        applyGroups(setup, cmd.squads, ctx.content);
        if (playerSideOf(setup) === 'attacker' && setup.attacker.squads.length === 0) throw new CommandError('badGroups', 'No squads to fight with');
      }
      if (cmd.mode === 'auto') {
        emitStarted(ctx, setup, 'auto');
        const result = autoResult(ctx, setup);
        slot.status = 'resolved';
        slot.result = result;
        applyResult(draft, ctx, setup, result);
        resolveOurPending(draft, ctx, slot.id);
        return;
      }
      slot.status = 'running';
      setup.returnMode = draft.meta.mode === 'battle' ? (setup.returnMode ?? 'map') : draft.meta.mode;
      draft.meta.mode = 'battle';
      emitStarted(ctx, setup, 'fight');
    },
    applyBattleResult(draft, cmd, ctx) {
      const slot = draft.subsims.battle;
      if (!slot || slot.id !== cmd.battleId) throw new CommandError('noBattle', `No battle ${cmd.battleId}`);
      if (slot.status !== 'running') throw new CommandError('notRunning', `Battle ${cmd.battleId} is ${slot.status}`);
      const result = jsonCopy(cmd.result);
      const issues = validateBattleResult(slot.setup, result, ctx.content);
      if (issues.length > 0) throw new CommandError('invalidResult', issues.join('; '));
      slot.status = 'resolved';
      slot.result = result;
      draft.meta.mode = slot.setup.returnMode ?? 'map';
      applyResult(draft, ctx, slot.setup, result);
      resolveOurPending(draft, ctx, slot.id);
    },
  },
  commandSchemas: {
    startBattle: StartBattleCommandSchema,
    applyBattleResult: ApplyBattleResultCommandSchema,
  },
  invariants(state) {
    return battleInvariants(state);
  },
};

/** Battle invariants: the slot agrees with the pending decision; setups are sane. */
export function battleInvariants(state: GameState): string[] {
  const out: string[] = [];
  const slot = state.subsims.battle;
  if (!slot) return out;
  const { setup } = slot;
  if (slot.id !== setup.id) out.push(`battle slot id ${slot.id} != setup id ${setup.id}`);
  if (slot.status === 'setup' || slot.status === 'running') {
    const decisions = [state.pending, ...state.pendingQueue];
    if (!decisions.some((p) => p?.kind === 'battleSetup' && p.payload.battleId === slot.id)) out.push(`battle ${slot.id} is ${slot.status} without a pending battleSetup decision`);
    if (slot.result !== undefined) out.push(`battle ${slot.id} has a result while ${slot.status}`);
  }
  if (slot.status === 'resolved' && slot.result === undefined) out.push(`battle ${slot.id} resolved without a result`);
  if (setup.attacker.isPlayer && setup.defender.isPlayer) out.push(`battle ${slot.id}: the player is on both sides`);
  for (const [key, side] of [
    ['attacker', setup.attacker],
    ['defender', setup.defender],
  ] as const) {
    const named: string[] = [];
    for (const sq of side.squads) {
      if (!(sq.men >= 1) || !Number.isInteger(sq.men)) out.push(`battle ${slot.id}: ${key} squad of ${sq.unit} has ${sq.men} men`);
      const fromSources = (sq.sources ?? []).reduce((a, s) => a + s.men, 0);
      if (sq.sources && sq.sources.length > 0 && fromSources !== sq.men) out.push(`battle ${slot.id}: ${key} squad of ${sq.unit} sources ${fromSources} != men ${sq.men}`);
      if (sq.unnamed !== true) {
        if (named.includes(sq.leaderId)) out.push(`battle ${slot.id}: ${sq.leaderId} leads two ${key} squads`);
        named.push(sq.leaderId);
      }
    }
    if (side.isPlayer && side.squads.length > 8) out.push(`battle ${slot.id}: the player has ${side.squads.length} squads`);
  }
  if (slot.result) {
    for (const c of slot.result.casualties) if (c.killed < 0 || c.wounded < 0 || c.captured < 0) out.push(`battle ${slot.id}: negative casualties`);
  }
  return out;
}
