/**
 * End conditions per battle kind (§13.2) and the BattleResult (§13.8): raid timer and extraction,
 * chief killed or captured, the keep or reliquary taken, the barrow breached, surrender, rout,
 * retreat, wipe-out and the time limit. Results carry casualties per squad and per source
 * container, leader fates, loot, buildings burned and XP.
 */
import type { BattleResult, CharId } from '@sim/core/state';
import { casualtyRows, leaderXp, lootFromShare } from '../results';
import type { BattleLeaderFate, BattleSideKey } from '../types';
import { emit } from './events';
import { gapToPoint, onField } from './geometry';
import { orderRetreat } from './orders';
import type { BattleState, BSquad, EndState, SideIdx } from './types';
import { SIDE_KEYS } from './types';

const CHIEF_WIN_KINDS: readonly string[] = ['assault', 'fortress', 'cloister'];
const SURRENDER_KINDS: readonly string[] = ['raid', 'assault', 'fortress', 'cloister', 'defense'];

function present(s: BSquad): boolean {
  return s.status === 'active' || s.status === 'asleep' || s.status === 'routing' || s.status === 'reserve';
}
function standing(s: BSquad): boolean {
  return (s.status === 'active' || s.status === 'asleep' || s.status === 'reserve') && !s.unit.nonCombatant;
}

/** Ends the battle and builds the result. */
export function finish(state: BattleState, winner: EndState['winner'], reason: EndState['reason'], opts: { retreated?: boolean; surrendered?: boolean } = {}): void {
  if (state.end) return;
  state.end = { winner, reason, retreated: opts.retreated === true, surrendered: opts.surrendered === true, tick: state.tick };
  if (opts.surrendered) {
    for (const s of state.squads)
      if (s.side === 1 && present(s)) {
        s.surrenderedMen += s.men;
        s.status = 'surrendered';
      }
  }
  state.status = 'ended';
  emit(state, 'ended', { vars: { winner, reason } });
  state.result = buildResult(state);
}

function objectivePoint(state: BattleState): [number, number] | null {
  const o = state.map.objective;
  if (o.kind !== 'none') return [o.x, o.y];
  const keep = state.buildings.find((b) => b.isKeep);
  return keep ? [keep.doorX + 0.5, keep.doorY + 0.5] : null;
}

/** Attackers hold the point uncontested (no defender able to fight within the radius). */
function holdingPoint(state: BattleState, x: number, y: number): boolean {
  const r = state.data.t.keepRadiusTiles;
  let attackers = false;
  for (const s of state.squads) {
    if (!onField(s) || s.status === 'routing') continue;
    if (gapToPoint(s, x, y) > r) continue;
    if (s.side === 1 && !s.unit.nonCombatant) return false;
    if (s.side === 0) attackers = true;
  }
  return attackers;
}

/** Evaluates the end conditions for this tick. */
export function checkEnd(state: BattleState): void {
  if (state.end) return;
  const t = state.data.t;
  const dt = state.dt;
  const kind = state.setup.kind;
  const [A, D] = state.sides;

  if (kind === 'raid') {
    const remaining = state.raidTimerS - state.timeS;
    if (!state.raidWarned && remaining <= t.raid.warnBeforeS) {
      state.raidWarned = true;
      emit(state, 'raidTimerWarning', { value: Math.max(0, Math.round(remaining)) });
    }
    if (remaining <= 0 && !A.retreatForced) {
      A.retreatForced = true;
      A.retreatAll = true;
      emit(state, 'raidTimerExpired', { side: 0 });
      for (const s of state.squads) if (s.side === 0 && s.status === 'active') orderRetreat(state, s);
    }
  }

  // The chief.
  if (CHIEF_WIN_KINDS.includes(kind) && (D.chiefFate === 'killed' || D.chiefFate === 'captured')) {
    finish(state, 'attacker', 'chief');
    return;
  }
  if (kind === 'defense' && (A.chiefFate === 'killed' || A.chiefFate === 'captured')) {
    finish(state, 'defender', 'chief');
    return;
  }

  // Objectives: the keep (fortress, ruined towers and halls), the barrow or cave mouth.
  const obj = state.map.objective;
  if (kind === 'fortress' || (kind === 'guardian' && obj.kind !== 'none')) {
    const p = objectivePoint(state);
    if (p && holdingPoint(state, p[0], p[1])) state.objectiveHoldT += dt;
    else state.objectiveHoldT = Math.max(0, state.objectiveHoldT - dt);
    if (state.objectiveHoldT >= t.keepHoldS) {
      if (kind === 'fortress' || obj.kind === 'keep') {
        emit(state, 'objectiveTaken', { side: 0 });
        finish(state, 'attacker', 'objective');
        return;
      }
      if (!state.objectiveBreached) {
        state.objectiveBreached = true;
        emit(state, 'objectiveTaken', { side: 0 });
      }
    }
  }
  if (kind === 'cloister' && state.objectiveBreached) {
    finish(state, 'attacker', 'objective');
    return;
  }

  // Surrender: the chief is a captive and his side has broken.
  let standingD = 0;
  let presentD = 0;
  let standingA = 0;
  let presentA = 0;
  let escapedA = 0;
  for (const s of state.squads) {
    if (s.side === 0) {
      if (present(s)) presentA++;
      if (standing(s)) standingA++;
      if (s.status === 'escaped') escapedA++;
    } else {
      if (present(s) && !s.unit.nonCombatant) presentD++;
      if (standing(s)) standingD++;
    }
  }
  if (SURRENDER_KINDS.includes(kind) && D.chiefFate === 'captured' && standingD === 0 && presentD > 0) {
    finish(state, 'attacker', 'surrender', { surrendered: true });
    return;
  }

  // Attackers gone from the field.
  if (presentA === 0) {
    const defendersBroken = standingD === 0;
    // A raid succeeds when the raiders get away after the horns, with loot, or from a broken foe.
    if (kind === 'raid' && escapedA > 0 && (A.retreatForced || defendersBroken || A.lootSecured > 0)) finish(state, 'attacker', A.retreatForced ? 'raidTimer' : 'extracted');
    else finish(state, 'defender', A.retreatAll || escapedA > 0 ? 'retreat' : 'destroyed', { retreated: A.retreatAll || escapedA > 0 });
    return;
  }
  // Defenders gone or all fleeing.
  if (presentD === 0 && !state.squads.some((s) => s.side === 1 && s.status === 'reserve')) {
    if (D.retreatAll) finish(state, 'attacker', 'retreat', { retreated: true });
    else finish(state, 'attacker', 'rout');
    return;
  }
  D.defeatedT = standingD === 0 ? D.defeatedT + dt : 0;
  A.defeatedT = standingA === 0 && !A.retreatAll ? A.defeatedT + dt : 0;
  if (D.defeatedT >= t.endGraceS && !(kind === 'raid' && A.retreatForced)) {
    finish(state, 'attacker', 'rout');
    return;
  }
  if (A.defeatedT >= t.endGraceS) {
    finish(state, 'defender', 'rout');
    return;
  }
  // Stalemate: nobody has struck a blow for a long while (raids run on their timer instead).
  if (kind !== 'raid') {
    let quiet = Infinity;
    for (const s of state.squads) if (s.status === 'active' || s.status === 'asleep') quiet = Math.min(quiet, s.quietT);
    if (quiet >= t.stalemateS) {
      finish(state, stalemateWinner(state), 'timeout');
      return;
    }
  }
  if (state.timeS >= t.maxDurationS) finish(state, stalemateWinner(state), 'timeout');
}

/** Kinds in which the defenders only have to hold their ground. */
const HOLD_KINDS: readonly string[] = ['assault', 'cloister', 'fortress', 'defense', 'beach', 'sortie', 'guardian'];

/**
 * Who has the field when a battle stalls: a side standing with at least `stalemateEdge` × the
 * other's men; otherwise the defenders where they only had to hold, else nobody.
 */
function stalemateWinner(state: BattleState): EndState['winner'] {
  const men: [number, number] = [0, 0];
  for (const s of state.squads) if (standing(s) && s.status !== 'reserve') men[s.side] += s.men;
  const edge = state.data.t.stalemateEdge;
  if (men[0] >= edge * Math.max(1, men[1])) return 'attacker';
  if (men[1] >= edge * Math.max(1, men[0])) return 'defender';
  return HOLD_KINDS.includes(state.setup.kind) ? 'defender' : 'none';
}

/** Builds the BattleResult of a finished (or just-stopped) battle. */
export function buildResult(state: BattleState): BattleResult {
  const end = state.end ?? { winner: 'none' as const, reason: 'timeout' as const, retreated: false, surrendered: false, tick: state.tick };
  const bal = state.data.balance;
  const t = state.data.t;
  const loser: BattleSideKey | null = end.winner === 'attacker' ? 'defender' : end.winner === 'defender' ? 'attacker' : null;

  const rows = casualtyRows(
    state.squads.map((s) => ({
      side: SIDE_KEYS[s.side],
      leaderId: s.leaderId,
      unit: s.unitId,
      startMen: s.startMen,
      lost: s.lost,
      surrendered: s.surrenderedMen,
      sources: s.sources,
    })),
    bal.battle.woundedShare,
    bal.autoresolve.routingCapturedShare,
    loser,
  );

  // Leader fates: every named leader present, 'fine' unless something happened.
  const leaderFates: Record<string, BattleLeaderFate> = {};
  for (const s of state.squads) if (!s.unnamed) leaderFates[s.leaderId] = state.leaderFates[s.leaderId] ?? 'fine';
  for (const [id, f] of Object.entries(state.leaderFates)) leaderFates[id] = f;

  // The enemy chief from the player's point of view (the defender's chief when no player fights).
  const playerSide: SideIdx | -1 = state.setup.attacker.isPlayer ? 0 : state.setup.defender.isPlayer ? 1 : -1;
  const chiefSide = state.sides[playerSide === 1 ? 0 : 1];
  const chief = { killed: chiefSide.chiefFate === 'killed', captured: chiefSide.chiefFate === 'captured' };

  let playerFate: BattleResult['playerFate'];
  const playerSquad = state.squads.find((s) => s.isPlayer);
  if (playerSquad) {
    const f = leaderFates[playerSquad.leaderId] ?? 'fine';
    playerFate = f === 'dead' ? 'dead' : f === 'captured' ? 'captured' : f === 'fine' ? 'fine' : 'wounded';
  }

  // Loot: what reached the extraction zone always counts; a victory adds what is still carried and,
  // unless the raid ended on the timer (the raiders sailed), every cache still standing.
  let secured = state.sides[0].lootSecured;
  if (end.winner === 'attacker') {
    for (const s of state.squads) if (s.side === 0 && present(s)) secured += s.loot;
    if (end.reason !== 'raidTimer' && end.reason !== 'extracted') for (const c of state.caches) secured += Math.max(0, c.value);
  }
  secured = Math.min(secured, state.lootTotal);
  const share = state.portableValue > 0 ? secured / state.portableValue : 0;
  const { lootSilver, lootGoods } = lootFromShare(state.setup.loot, share);

  // XP for every named leader who lived (§22.1).
  const xp: Record<CharId, number> = {};
  for (const s of state.squads) {
    if (s.unnamed) continue;
    if (leaderFates[s.leaderId] === 'dead') continue;
    const key = SIDE_KEYS[s.side];
    const won = end.winner === key;
    const v = leaderXp(bal, t, won, rows.lostBySide[key === 'attacker' ? 'defender' : 'attacker'], key === 'attacker' ? secured : 0);
    xp[s.leaderId] = Math.max(xp[s.leaderId] ?? 0, v);
  }

  const result: BattleResult = {
    winner: end.winner,
    retreated: end.retreated,
    casualties: rows.casualties,
    chief,
    lootValue: Math.round(secured),
    lootGoods,
    buildingsBurned: state.buildingsBurned,
    durationS: Math.round(state.timeS * 100) / 100,
    xp,
    autoResolved: false,
    squadLosses: rows.squadLosses,
    leaderFates,
    surrendered: end.surrendered,
    lootSilver,
    lootBurnedShare: state.lootTotal > 0 ? Math.min(1, Math.round((state.lootBurned / state.lootTotal) * 1000) / 1000) : 0,
    duels: state.duels.map((d) => ({ ...d })),
  };
  const pitch = { attacker: Math.round(state.sides[0].pitchUsed * 100) / 100, defender: Math.round(state.sides[1].pitchUsed * 100) / 100 };
  if (pitch.attacker > 0 || pitch.defender > 0) result.pitchUsedT = pitch;
  if (playerFate !== undefined) result.playerFate = playerFate;
  return result;
}
