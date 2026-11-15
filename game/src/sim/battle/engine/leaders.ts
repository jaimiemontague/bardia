/**
 * Named leaders in battle: lieutenant risk on rout or wipe-out (§12.5), the chief and his
 * bodyguard (§13.6), player-character safety (§31.10) and duels triggered by Challenge.
 */
import { clamp, dsigmoid } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { CharId } from '@sim/core/state';
import type { BattleDuelRecord, BattleLeaderFate } from '../types';
import { emit } from './events';
import { onField } from './geometry';
import type { BattleState, BSquad, DuelRequest, SideIdx } from './types';

const TERMINAL: readonly BattleLeaderFate[] = ['captured', 'dead'];
const SEVERITY: Record<BattleLeaderFate, number> = { fine: 0, wounded: 1, seriouslyWounded: 2, mortallyWounded: 3, captured: 4, dead: 5 };

/** Records a leader's fate (a terminal fate — captured, dead — is final; otherwise the worse one wins). */
export function setFate(state: BattleState, id: CharId, fate: BattleLeaderFate): void {
  const cur = state.leaderFates[id];
  if (cur !== undefined && TERMINAL.includes(cur)) return;
  if (cur === undefined || TERMINAL.includes(fate) || SEVERITY[fate] > SEVERITY[cur]) state.leaderFates[id] = fate;
}

/** Changes the morale of every squad on the field of a side. */
export function sideMorale(state: BattleState, side: SideIdx, delta: number): void {
  for (const s of state.squads) if (s.side === side && onField(s)) s.morale = clamp(s.morale + delta, 0, 100);
}

/** The side's chief was killed, captured or beaten in a duel (−40 to his side, + to the other). */
export function chiefDefeated(state: BattleState, side: SideIdx, how: 'killed' | 'captured' | 'defeated'): void {
  const sd = state.sides[side];
  if (sd.chiefFate !== 'fine') return;
  sd.chiefFate = how;
  sideMorale(state, side, state.data.b.morale.enemyChiefKilled);
  sideMorale(state, (1 - side) as SideIdx, state.data.t.chiefKilledEnemyBonus);
  const chief = sd.chiefIdx >= 0 ? state.squads[sd.chiefIdx] : undefined;
  emit(state, how === 'captured' ? 'chiefCaptured' : 'chiefKilled', { side, ...(chief ? { squad: chief } : {}) });
}

/** A squad's named leader is gone (dead, captured or carried off); the sergeant takes over. */
export function leaderLost(state: BattleState, s: BSquad, fate: BattleLeaderFate): void {
  if (!s.leaderPresent) return;
  s.leaderPresent = false;
  setFate(state, s.leaderId, fate);
  if (s.men > 0 && onField(s)) s.morale = clamp(s.morale + state.data.b.morale.leaderKilled, 0, 100);
  emit(state, 'leaderDown', { squad: s, vars: { fate } });
  if (s.isChief) chiefDefeated(state, s.side, fate === 'dead' ? 'killed' : fate === 'captured' ? 'captured' : 'defeated');
}

/**
 * §12.5: a lieutenant whose squad is wiped out or routs has a 20% chance to die, 30% to be wounded
 * and 10% to be captured (rolled once per battle). The chief whose bodyguard is wiped out is killed
 * or captured. The player is handled by `playerDown`.
 */
export function leaderRisk(state: BattleState, s: BSquad, destroyed: boolean): void {
  if (s.unnamed || !s.leaderPresent || s.isPlayer) return;
  if (destroyed && s.isChief) {
    const killed = state.rng.chance(state.data.t.chiefDestroyedKilledShare);
    leaderLost(state, s, killed ? 'dead' : 'captured');
    return;
  }
  if (s.routedOnce && !destroyed) return;
  const risk = state.data.balance.squads.lieutenantRisk;
  const r = state.rng.float();
  if (r < risk.die) leaderLost(state, s, 'dead');
  else if (r < risk.die + risk.wounded) setFate(state, s.leaderId, 'wounded');
  else if (r < risk.die + risk.wounded + risk.captured) leaderLost(state, s, 'captured');
}

/**
 * §31.10 at 0 HP: carried off (serious wound, 15% mortal) when a friendly non-routing squad is
 * within 10 tiles; otherwise captured (60%) or killed (40%; never in Gentle Mode).
 */
export function playerDown(state: BattleState, s: BSquad): void {
  if (!s.isPlayer || !s.leaderPresent) return;
  const ps = state.data.b.playerSafety;
  const r2 = ps.carryRadiusTiles * ps.carryRadiusTiles;
  let carried = false;
  for (const o of state.squads) {
    if (o.side !== s.side || o.status !== 'active' || o.men <= 0) continue;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    if (dx * dx + dy * dy <= r2) {
      carried = true;
      break;
    }
  }
  let fate: BattleLeaderFate;
  if (carried) fate = state.rng.chance(ps.carriedMortalChance) ? 'mortallyWounded' : 'seriouslyWounded';
  else if (state.setup.gentleMode === true) fate = 'captured';
  else fate = state.rng.chance(ps.capturedShare / (ps.capturedShare + ps.deathShare)) ? 'captured' : 'dead';
  s.playerHp = 0;
  emit(state, 'playerDown', { squad: s, vars: { fate } });
  leaderLost(state, s, fate);
}

/** Wounds the player from losses in their own squad (3% per man lost, 10–25 HP × armour). */
export function playerLosses(state: BattleState, s: BSquad, menLost: number): void {
  if (!s.isPlayer || !s.leaderPresent) return;
  const ps = state.data.b.playerSafety;
  const tier = state.sides[s.side].armourTier;
  const red = Math.max(0, 1 - state.data.t.armourReductionPerTier * Math.max(0, tier - 1));
  for (let k = 0; k < menLost && s.leaderPresent; k++) {
    if (!state.rng.chance(ps.woundChancePerManLost)) continue;
    const hp = state.rng.range(ps.woundHp[0], ps.woundHp[1]) * red;
    s.playerHp = Math.max(0, s.playerHp - hp);
    setFate(state, s.leaderId, 'wounded');
    emit(state, 'playerWounded', { squad: s, value: Math.round(s.playerHp) });
    if (!s.playerWarned && s.playerHp > 0 && s.playerHp <= ps.warnHpPct * 100) {
      s.playerWarned = true;
      emit(state, 'lifeThread', { squad: s });
    }
    if (s.playerHp <= 0) playerDown(state, s);
  }
}

/** Duel outcome fed back by the client (or the placeholder auto-resolve). */
export interface DuelOutcome {
  winnerId: CharId;
  loserFate: BattleDuelRecord['loserFate'];
}

/** Applies a duel's outcome and resumes the battle. */
export function resolveDuel(state: BattleState, outcome: DuelOutcome): string | null {
  const req = state.duel;
  if (!req || state.status !== 'duelRequested') return 'noDuel';
  if (outcome.winnerId !== req.challengerId && outcome.winnerId !== req.chiefId) return 'badWinner';
  const challenger = state.squads.find((s) => s.id === req.challengerSquad);
  const chief = state.squads.find((s) => s.id === req.chiefSquad);
  const chiefLost = outcome.winnerId === req.challengerId;
  const loser = chiefLost ? chief : challenger;
  const loserId = chiefLost ? req.chiefId : req.challengerId;
  const record: BattleDuelRecord = { challengerId: req.challengerId, chiefId: req.chiefId, winnerId: outcome.winnerId, loserFate: outcome.loserFate };
  state.duels.push(record);
  if (loser) {
    if (outcome.loserFate === 'killed') leaderLost(state, loser, 'dead');
    else if (outcome.loserFate === 'captured' || outcome.loserFate === 'yielded') leaderLost(state, loser, 'captured');
    else {
      setFate(state, loserId, 'wounded');
      sideMorale(state, loser.side, state.data.t.challenge.yieldedMorale);
      if (loser.isChief) chiefDefeated(state, loser.side, 'defeated');
    }
  }
  state.duel = null;
  state.status = 'running';
  emit(state, 'duelResolved', { side: chiefLost ? (1 - (chief?.side ?? 1)) as SideIdx : (chief?.side ?? 1), vars: { fate: outcome.loserFate } });
  return null;
}

/**
 * Placeholder duel auto-resolve (the duel module owns the real one; the client feeds its outcome
 * back with `resolveDuel`): a logistic over the difference of melee + command/4 + health.
 */
export function autoDuelOutcome(state: BattleState, req: DuelRequest, rng: RandomSource): DuelOutcome {
  const lc = state.setup.leaders?.[req.challengerId];
  const lk = state.setup.leaders?.[req.chiefId];
  const rate = (l: typeof lc) => (l ? l.melee + l.command * 0.25 + (l.hpPct / 100) * 2 : 3);
  const c = state.data.t.challenge;
  const diff = rate(lc) - rate(lk);
  const p = dsigmoid(c.ratingK * diff);
  const winnerIsChallenger = rng.float() < p;
  const r = rng.float();
  const loserFate: BattleDuelRecord['loserFate'] = r < c.killedShare ? 'killed' : r < c.killedShare + c.capturedShare ? 'captured' : r < c.killedShare + c.capturedShare + c.yieldedShare ? 'yielded' : 'spared';
  return { winnerId: winnerIsChallenger ? req.challengerId : req.chiefId, loserFate };
}

