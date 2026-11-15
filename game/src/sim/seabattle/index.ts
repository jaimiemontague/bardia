/**
 * 'seabattle' sub-simulation (design §15, §31.2, §31.13).
 * Owns (src/sim/core/ownership.ts):
 *   effects: startSeaBattle (+ NEW autoResolveSeaBattle)
 *   commands: startSeaBattle, applySeaBattleResult
 *   pending kinds: seaBattle
 *   events: SeaBattleEnded
 *   state slices: subsims.seaBattle
 * Tunables: src/content/data/tunables/seabattle.json (ctx.tunables.seabattle).
 * Strings/assets: locales/en/seabattle.json, assets/manifest/seabattle.json (prefix 'seabattle.').
 *
 * Flow: another module applies `startSeaBattle` (e.g. encounters on "Attack"). With the player on a
 * side the effect stores the setup in `subsims.seaBattle` and raises the `seaBattle` decision (the
 * pre-battle screen: deck slider, fire arrows, fight or auto-resolve). `startSeaBattle {mode:'auto'}`
 * resolves at once (§15.5); `{mode:'fight'}` hands the battle to the engine (client, `engine.ts`) and
 * time stays stopped until `applySeaBattleResult` writes the outcome back through the owners'
 * effects and emits `SeaBattleEnded`. Battles without the player are auto-resolved immediately.
 */
import type { Content } from '@content/index';
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import type { SimContext, SimModule } from '@sim/core/module';
import { Rng, seedStringFrom } from '@sim/core/rng';
import type { GameState, SeaBattleResult, SeaBattleSetup } from '@sim/core/state';
import './types';
import { applyEffectsChecked, seaResultEffects, validateSeaResult } from './apply';
import { autoResolveSea } from './autoresolve';
import type { SeaEngineContent } from './engineTypes';
import {
  ApplySeaBattleResultCommandSchema,
  AutoResolveSeaBattleEffectSchema,
  StartSeaBattleCommandSchema,
  StartSeaBattleEffectSchema,
} from './schemas';
import { buildSeaSetup } from './setup';
import type { AutoResolveSeaBattleEffect, SeaSideKey, StartSeaBattleCommand } from './types';

export { SeaBattleEngine, replaySeaBattle, type SeaLogEntry } from './engine';
export { autoResolveSea, seaFleetPower, seaWinProbability, weatherGauge } from './autoresolve';
export { generateArena, TERRAIN } from './arena';
export { seaEventSfx, seaEventTextKey, SEA_EVENT_SFX } from './presentation';
export type * from './engineTypes';
export type * from './types';

/** Engine content from the full catalog. */
export function seaContent(content: Pick<Content, 'balance' | 'tunables'>): SeaEngineContent {
  return { balance: content.balance, tunables: content.tunables.seabattle };
}

function newSetup(draft: GameState, ctx: SimContext, e: AutoResolveSeaBattleEffect): SeaBattleSetup {
  const rng = ctx.rng('seabattle');
  return buildSeaSetup(draft, ctx.content, e, {
    id: ctx.newId('sea'),
    seed: seedStringFrom(rng),
    rng,
    newShipId: () => ctx.newId('shp'),
  });
}

function playerSide(setup: SeaBattleSetup): SeaSideKey | undefined {
  return setup.attacker.isPlayer ? 'attacker' : setup.defender.isPlayer ? 'defender' : undefined;
}

/** Auto-resolves a setup with its own seed (deterministic, independent of other streams). */
function autoResult(ctx: SimContext, setup: SeaBattleSetup): SeaBattleResult {
  return autoResolveSea(seaContent(ctx.content), setup, Rng.derive(setup.seed, 'autoresolve'));
}

/** Writes a result back (effects), tells the player, and emits SeaBattleEnded. */
function applyResult(draft: GameState, ctx: SimContext, setup: SeaBattleSetup, result: SeaBattleResult): void {
  const effects = seaResultEffects(draft, ctx.balance, setup, result);
  const unapplied = applyEffectsChecked(ctx, effects);
  const ps = playerSide(setup);
  if (ps !== undefined) {
    const enemy: SeaSideKey = ps === 'attacker' ? 'defender' : 'attacker';
    const enemySetup = enemy === 'attacker' ? setup.attacker : setup.defender;
    const ownSetup = ps === 'attacker' ? setup.attacker : setup.defender;
    const enemyIds: string[] = enemySetup.ships.map((s) => s.shipId);
    const ownIds: string[] = ownSetup.ships.map((s) => s.shipId);
    const lostOwn = result.crewLost.find((c) => c.side === ps);
    const vars = {
      taken: result.shipsCaptured.filter((id) => enemyIds.includes(id)).length,
      sunk: result.shipsSunk.filter((id) => enemyIds.includes(id)).length,
      lostShips: [...result.shipsSunk, ...result.shipsCaptured].filter((id) => ownIds.includes(id)).length,
      killed: lostOwn?.killed ?? 0,
      enemyShips: enemySetup.ships.length,
    };
    const outcome = result.winner === ps ? 'victory' : result.winner === 'none' ? 'draw' : 'defeat';
    const key = outcome === 'defeat' && result.retreated ? 'seabattle.notify.escaped' : `seabattle.notify.${outcome}`;
    ctx.notify(key, { priority: outcome === 'victory' ? 'normal' : 'high', vars });
    ctx.chronicle({
      kind: 'seaBattle',
      textKey: `seabattle.chronicle.${outcome}`,
      importance: clamp(1 + Math.floor((vars.taken + vars.sunk + vars.lostShips) / 2), 1, 5),
      vars,
      refs: [setup.id],
    });
  }
  const ended: Parameters<SimContext['emit']>[0] = {
    type: 'SeaBattleEnded',
    seaBattleId: setup.id,
    origin: setup.origin ?? 'unknown',
    attackerFactionId: setup.attacker.factionId,
    defenderFactionId: setup.defender.factionId,
    result,
    setup,
    unapplied,
  };
  if (ps !== undefined) ended.playerSide = ps;
  ctx.emit(ended);
}

/** Applies the pre-battle choices (deck slider, fire arrows) to the player's side. */
function applyDeck(setup: SeaBattleSetup, cmd: StartSeaBattleCommand): void {
  const side = setup.attacker.isPlayer ? setup.attacker : setup.defender.isPlayer ? setup.defender : undefined;
  if (!side) return;
  if (cmd.deckShares) {
    for (const s of side.ships) {
      const archers = clamp(Math.round(cmd.deckShares.archers * s.crew), 0, s.crew);
      s.archers = archers;
      s.boarders = clamp(Math.round(cmd.deckShares.boarders * s.crew), 0, s.crew - archers);
    }
  }
  for (const d of cmd.deck ?? []) {
    const s = side.ships.find((x) => x.shipId === d.shipId);
    if (!s) throw new CommandError('unknownShip', `${d.shipId} is not one of your ships in this battle`);
    s.archers = clamp(d.archers, 0, s.crew);
    s.boarders = clamp(d.boarders, 0, s.crew - s.archers);
  }
  if (cmd.fireArrows !== undefined) side.fireArrows = cmd.fireArrows;
}

/**
 * Auto-resolves a freshly built setup and applies it. A player battle is kept in the slot (the
 * client shows its report) unless another sea battle of the player's is still open there.
 */
function resolveNow(draft: GameState, ctx: SimContext, setup: SeaBattleSetup): void {
  const result = autoResult(ctx, setup);
  const slot = draft.subsims.seaBattle;
  if (playerSide(setup) !== undefined && (!slot || slot.status === 'resolved')) {
    draft.subsims.seaBattle = { id: setup.id, status: 'resolved', startedHour: ctx.hour, setup, result };
  }
  applyResult(draft, ctx, setup, result);
}

function resolveOurPending(draft: GameState, ctx: SimContext, seaBattleId: string): void {
  const p = draft.pending;
  if (p && p.kind === 'seaBattle' && p.payload.seaBattleId === seaBattleId) ctx.resolvePending(p.id);
}

export const module: SimModule = {
  id: 'seabattle',
  order: 220,
  version: 1,
  effects: {
    startSeaBattle(draft, e, ctx) {
      const setup = newSetup(draft, ctx, e);
      const slot = draft.subsims.seaBattle;
      const busy = slot !== undefined && slot.status !== 'resolved';
      // Without the player, on request, or while another of the player's sea battles is still open
      // (one slot; rare: two starts in one operation), the battle is auto-resolved at once (§15.5).
      if (playerSide(setup) === undefined || e.mode === 'auto' || busy) {
        resolveNow(draft, ctx, setup);
        return;
      }
      draft.subsims.seaBattle = { id: setup.id, status: 'setup', startedHour: ctx.hour, setup };
      ctx.pend({ kind: 'seaBattle', payload: { seaBattleId: setup.id } });
    },
    autoResolveSeaBattle(draft, e, ctx) {
      resolveNow(draft, ctx, newSetup(draft, ctx, e));
    },
  },
  effectSchemas: {
    startSeaBattle: StartSeaBattleEffectSchema,
    autoResolveSeaBattle: AutoResolveSeaBattleEffectSchema,
  },
  handlers: {
    startSeaBattle(draft, cmd, ctx) {
      const slot = draft.subsims.seaBattle;
      if (!slot || slot.id !== cmd.seaBattleId) throw new CommandError('noSeaBattle', `No sea battle ${cmd.seaBattleId}`);
      if (slot.status !== 'setup') throw new CommandError('alreadyStarted', `Sea battle ${cmd.seaBattleId} is ${slot.status}`);
      applyDeck(slot.setup, cmd);
      if (cmd.mode === 'auto') {
        const setup = slot.setup;
        const result = autoResult(ctx, setup);
        slot.status = 'resolved';
        slot.result = result;
        applyResult(draft, ctx, setup, result);
        resolveOurPending(draft, ctx, slot.id);
        return;
      }
      slot.status = 'running';
      slot.setup.returnMode = draft.meta.mode === 'seaBattle' ? (slot.setup.returnMode ?? 'map') : draft.meta.mode;
      draft.meta.mode = 'seaBattle';
    },
    applySeaBattleResult(draft, cmd, ctx) {
      const slot = draft.subsims.seaBattle;
      if (!slot || slot.id !== cmd.seaBattleId) throw new CommandError('noSeaBattle', `No sea battle ${cmd.seaBattleId}`);
      if (slot.status !== 'running') throw new CommandError('notRunning', `Sea battle ${cmd.seaBattleId} is ${slot.status}`);
      const issues = validateSeaResult(slot.setup, cmd.result);
      if (issues.length > 0) throw new CommandError('invalidResult', issues.join('; '));
      const result = JSON.parse(JSON.stringify(cmd.result)) as SeaBattleResult;
      slot.status = 'resolved';
      slot.result = result;
      draft.meta.mode = slot.setup.returnMode ?? 'map';
      applyResult(draft, ctx, slot.setup, result);
      resolveOurPending(draft, ctx, slot.id);
    },
  },
  commandSchemas: {
    startSeaBattle: StartSeaBattleCommandSchema,
    applySeaBattleResult: ApplySeaBattleResultCommandSchema,
  },
  invariants(state) {
    return seaInvariants(state);
  },
};

/** Sea-battle invariants: the slot agrees with the pending decision, setups are sane. */
export function seaInvariants(state: GameState): string[] {
  const out: string[] = [];
  const slot = state.subsims.seaBattle;
  if (!slot) return out;
  const { setup } = slot;
  if (slot.id !== setup.id) out.push(`seaBattle slot id ${slot.id} != setup id ${setup.id}`);
  if (slot.status === 'setup' || slot.status === 'running') {
    const decisions = [state.pending, ...state.pendingQueue];
    if (!decisions.some((p) => p?.kind === 'seaBattle' && p.payload.seaBattleId === slot.id)) out.push(`sea battle ${slot.id} is ${slot.status} without a pending seaBattle decision`);
    if (slot.result !== undefined) out.push(`sea battle ${slot.id} has a result while ${slot.status}`);
  }
  if (slot.status === 'resolved' && slot.result === undefined) out.push(`sea battle ${slot.id} resolved without a result`);
  const seen: Record<string, true> = {};
  for (const side of [setup.attacker, setup.defender]) {
    for (const s of side.ships) {
      if (seen[s.shipId]) out.push(`sea battle ${slot.id}: ship ${s.shipId} on both sides or twice`);
      seen[s.shipId] = true;
      if (!(s.crew >= 0) || s.archers < 0 || s.boarders < 0 || s.archers + s.boarders > s.crew) out.push(`sea battle ${slot.id}: bad deck assignment on ${s.shipId}`);
    }
  }
  if (slot.result) out.push(...validateSeaResult(setup, slot.result).map((m) => `sea battle ${slot.id}: ${m}`));
  return out;
}
