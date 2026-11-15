/**
 * PLACEHOLDER auto-resolve (§13.9, §31.11). The dedicated auto-resolve agent replaces this file
 * (keeping the exported signatures: `autoResolveBattle`, `predictBattle`, `sidePower`) with the full
 * model and the ±10% parity harness against simulated battles (ADR-003).
 *
 * What it does now — the §31.11 formulas, applied directly:
 *   squadPower = men × (atk_eff + def_eff + 0.6 × rng_eff) × (moraleStart / 60)
 *   sidePower  = Σ squadPower × situational (walls, night raid ×1.25, defender in woods ×1.1, omen, player penalty)
 *   P(A wins)  = r^2.2 / (r^2.2 + 1), r = P_A / P_B
 *   casualties: loser clamp(0.45 + 0.35 (1 − r'), 0.45, 0.8), winner clamp(0.08 + 0.30 r', 0.05, 0.4),
 *               r' = P_loser / P_winner; 50% wounded; a routing loser has half its wounded captured.
 *   loot on a win: 0.75 × portable wealth (assaults), scaled by the raid ceiling for raids.
 * Named leaders on each side roll the §12.5 lieutenant risk (scaled by their side's losses); a
 * beaten chief is killed or captured by the same roll. Deterministic in (setup, content, rng).
 */
import type { Content } from '@content/index';
import { clamp, dpow } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { BattleResult, BattleSetup, CharId, SideSetup, Squad } from '@sim/core/state';
import { battleData, equipMult, fortDefMult, lootPoolValue, unitOf, type BattleData } from './data';
import { moraleStart, squadPower, winProbability } from './formulas';
import { casualtyRows, leaderXp, lootFromShare } from './results';
import type { BattleLeaderFate, BattleSideKey } from './types';
import { splitBy } from './util';

/** Battle kinds fought at a settlement's walls (the fort-ring multiplier applies to the defenders). */
const WALLED_KINDS: readonly string[] = ['raid', 'assault', 'cloister', 'fortress', 'defense'];
/** Kinds in which the loser's chief is at stake. */
const CHIEF_KINDS: readonly string[] = ['assault', 'fortress', 'cloister', 'defense', 'raid'];

/** Outcome band shown on the pre-battle screen (§13.4). */
export type OutcomeBand = 'decisive' | 'likely' | 'even' | 'risky' | 'hopeless';

/** The pre-battle prediction (§13.4, §13.9): power, win probability and casualty ranges. */
export interface BattlePrediction {
  /** Side the prediction is for (the player's side, else the attacker). */
  side: BattleSideKey;
  power: { attacker: number; defender: number };
  /** Chance that `side` wins. */
  winProbability: number;
  band: OutcomeBand;
  /** Expected casualty share of `side`'s men on a win and on a loss. */
  ownLossShare: { ifWin: number; ifLoss: number };
  enemyLossShare: { ifWin: number; ifLoss: number };
  /** Player penalty applied (§5.5), shown as "Auto-resolve: −5%". */
  playerPenalty: number;
}

function sideSetup(setup: BattleSetup, side: BattleSideKey): SideSetup {
  return side === 'attacker' ? setup.attacker : setup.defender;
}

function leaderCommand(setup: BattleSetup, sq: Squad): number {
  if (sq.unnamed === true) return 0;
  return setup.leaders?.[sq.leaderId]?.command ?? 0;
}

/** §31.11 power of one squad of a side. */
export function squadPowerOf(data: BattleData, setup: BattleSetup, side: BattleSideKey, sq: Squad): number {
  const b = data.b;
  const ss = sideSetup(setup, side);
  const enemy = sideSetup(setup, side === 'attacker' ? 'defender' : 'attacker');
  const u = unitOf(data, sq.unit);
  if (u.nonCombatant) return 0;
  const cmd = leaderCommand(setup, sq);
  const leader = sq.unnamed === true ? undefined : setup.leaders?.[sq.leaderId];
  const common = (1 + b.commandBonus * cmd) * (1 + b.veterancyBonus * sq.vetStars);
  const atk = u.atk * equipMult(data.balance, ss.weaponTier) * common;
  const def = u.def * equipMult(data.balance, ss.armourTier) * common;
  const rng = u.rangedAtk * equipMult(data.balance, ss.weaponTier) * (1 + b.ranged.leaderArcheryBonus * (leader?.archery ?? 0));
  const playerSide: BattleSideKey | null = setup.attacker.isPlayer ? 'attacker' : setup.defender.isPlayer ? 'defender' : null;
  const omenHere = setup.omen !== undefined && side === (playerSide ?? 'attacker');
  const morale = moraleStart(b, {
    base: u.morale,
    command: cmd,
    vetStars: sq.vetStars,
    ...(omenHere && setup.omen ? { omen: setup.omen } : {}),
    warHorn: leader?.warHorn === true,
    traitMod: leader?.moraleMod ?? 0,
    enemyDreadDrakkar: enemy.dreadDrakkar === true,
    extra: ss.moraleMods,
  });
  // A single beast fights as its hit points in "men" (the maul hits many).
  const men = u.single ? Math.max(1, u.hp / data.t.singleHpPerMan) : Math.max(0, sq.men);
  return squadPower(data.balance.autoresolve.rangedWeight, data.balance.autoresolve.moraleDivisor, men, atk, def, rng, Math.max(1, morale));
}

/** §31.11 side power with the situational multipliers. */
export function sidePower(data: BattleData, setup: BattleSetup, side: BattleSideKey): number {
  const a = data.balance.autoresolve;
  const ss = sideSetup(setup, side);
  let p = 0;
  for (const sq of ss.squads) p += squadPowerOf(data, setup, side, sq);
  if (side === 'defender' && WALLED_KINDS.includes(setup.kind) && (setup.fortTier ?? 0) > 0) p *= fortDefMult(data.balance, setup.fortTier ?? 0);
  if (side === 'attacker' && setup.approach === 'night') p *= a.situational.nightRaidAttacker;
  if (side === 'defender' && setup.mapTemplate === 'forest') p *= a.situational.defenderInWoods;
  const playerSide: BattleSideKey | null = setup.attacker.isPlayer ? 'attacker' : setup.defender.isPlayer ? 'defender' : null;
  if (setup.omen !== undefined && side === (playerSide ?? 'attacker')) p *= 1 + data.balance.omens.modifiers[setup.omen].moralePct;
  if (side === playerSide) p *= 1 - Math.max(0, setup.playerPenalty ?? 0);
  return p;
}

function shares(data: BattleData, pLoser: number, pWinner: number): { loser: number; winner: number } {
  const a = data.balance.autoresolve;
  const r = pWinner > 0 ? pLoser / pWinner : 0;
  return {
    loser: clamp(a.loser.base + a.loser.slope * (1 - r), a.loser.min, a.loser.max),
    winner: clamp(a.winner.base + a.winner.slope * r, a.winner.min, a.winner.max),
  };
}

/** The band for a win probability (balance.autoresolve.outcomeBands). */
export function outcomeBand(data: BattleData, p: number): OutcomeBand {
  const b = data.balance.autoresolve.outcomeBands;
  if (p >= b.decisive) return 'decisive';
  if (p >= b.likely) return 'likely';
  if (p >= b.even) return 'even';
  if (p >= b.risky) return 'risky';
  return 'hopeless';
}

/** Prediction for the pre-battle screen (no randomness). */
export function predictBattle(setup: BattleSetup, content: Content): BattlePrediction {
  const data = battleData(content);
  const pa = sidePower(data, setup, 'attacker');
  const pd = sidePower(data, setup, 'defender');
  const side: BattleSideKey = setup.defender.isPlayer ? 'defender' : 'attacker';
  const own = side === 'attacker' ? pa : pd;
  const other = side === 'attacker' ? pd : pa;
  const p = other > 0 ? winProbability(data.balance.autoresolve.exponent, own / other, dpow) : own > 0 ? 1 : 0.5;
  const win = shares(data, other, own);
  const loss = shares(data, own, other);
  return {
    side,
    power: { attacker: pa, defender: pd },
    winProbability: p,
    band: outcomeBand(data, p),
    ownLossShare: { ifWin: win.winner, ifLoss: loss.loser },
    enemyLossShare: { ifWin: win.loser, ifLoss: loss.winner },
    playerPenalty: setup.playerPenalty ?? 0,
  };
}

/** Rolls the §12.5 risk for a named leader; `scale` stretches the odds with the side's losses. */
function leaderRoll(data: BattleData, rng: RandomSource, scale: number): BattleLeaderFate {
  const risk = data.balance.squads.lieutenantRisk;
  const r = rng.float();
  if (r < risk.die * scale) return 'dead';
  if (r < (risk.die + risk.wounded) * scale) return 'wounded';
  if (r < (risk.die + risk.wounded + risk.captured) * scale) return 'captured';
  return 'fine';
}

/** Resolves a battle at once (§13.9). */
export function autoResolveBattle(setup: BattleSetup, content: Content, rng: RandomSource): BattleResult {
  const data = battleData(content);
  const bal = data.balance;
  const pa = sidePower(data, setup, 'attacker');
  const pd = sidePower(data, setup, 'defender');
  const pA = pd > 0 ? winProbability(bal.autoresolve.exponent, pa / pd, dpow) : pa > 0 ? 1 : 0.5;
  const winner: BattleSideKey = rng.float() < pA ? 'attacker' : 'defender';
  const loser: BattleSideKey = winner === 'attacker' ? 'defender' : 'attacker';
  const sh = shares(data, winner === 'attacker' ? pd : pa, winner === 'attacker' ? pa : pd);

  // Casualties per squad: the side's share of its fighting men, spread over its squads by size.
  const inputs: Parameters<typeof casualtyRows>[0][number][] = [];
  for (const side of ['attacker', 'defender'] as const) {
    const ss = sideSetup(setup, side);
    const share = side === winner ? sh.winner : sh.loser;
    const men = ss.squads.map((sq) => (unitOf(data, sq.unit).single ? 1 : Math.max(0, Math.floor(sq.men))));
    const total = men.reduce((a, m) => a + m, 0);
    const lost = splitBy(Math.round(total * share), men).map((v, i) => Math.min(v, men[i]!));
    ss.squads.forEach((sq, i) => {
      const nonCombatant = unitOf(data, sq.unit).nonCombatant;
      inputs.push({
        side,
        leaderId: sq.leaderId,
        unit: sq.unit,
        startMen: men[i]!,
        lost: nonCombatant ? 0 : lost[i]!,
        surrendered: nonCombatant && side === loser ? men[i]! : 0,
        sources: sq.sources ?? [],
      });
    });
  }
  const rows = casualtyRows(inputs, bal.autoresolve.woundedShare, bal.autoresolve.routingCapturedShare, loser);

  // Leaders.
  const leaderFates: Record<string, BattleLeaderFate> = {};
  const chiefOf = (side: BattleSideKey): CharId | undefined => sideSetup(setup, side).chiefId;
  for (const side of ['attacker', 'defender'] as const) {
    const scale = side === winner ? sh.winner / Math.max(1e-9, sh.loser) : 1;
    for (const sq of sideSetup(setup, side).squads) {
      if (sq.unnamed === true || Object.hasOwn(leaderFates, sq.leaderId)) continue;
      let fate = leaderRoll(data, rng, scale);
      // §12.5: the risk is for squads that are cut down or rout; the side that holds the field takes no captives
      // from its own ranks — a winner's bad roll is a wound.
      if (side === winner && fate === 'captured') fate = 'wounded';
      const info = setup.leaders?.[sq.leaderId];
      if (info?.isPlayer === true && fate === 'dead' && setup.gentleMode === true) fate = 'captured';
      leaderFates[sq.leaderId] = fate;
    }
  }
  const enemyChiefSide: BattleSideKey = setup.defender.isPlayer ? 'attacker' : 'defender';
  const enemyChief = chiefOf(enemyChiefSide);
  let chief = { killed: false, captured: false };
  if (enemyChief !== undefined && enemyChiefSide === loser && CHIEF_KINDS.includes(setup.kind)) {
    const f = leaderFates[enemyChief] ?? 'fine';
    chief = { killed: f === 'dead', captured: f === 'captured' };
  } else if (enemyChief !== undefined && Object.hasOwn(leaderFates, enemyChief) && (leaderFates[enemyChief] === 'dead' || leaderFates[enemyChief] === 'captured')) {
    // A winning chief is never lost in the placeholder model.
    leaderFates[enemyChief] = 'wounded';
  }

  // Loot: a share of the place's portable wealth on an attacker's victory.
  let lootValue = 0;
  let loot = lootFromShare(undefined, 0);
  const ceiling = setup.lootCeiling ?? 0;
  if (winner === 'attacker' && ceiling > 0) {
    const share = setup.kind === 'raid' ? ceiling * (bal.autoresolve.assaultLootShare / bal.autoresolve.manualLootMax) : Math.min(ceiling, bal.autoresolve.assaultLootShare);
    loot = lootFromShare(setup.loot, share);
    lootValue = Math.round(lootPoolValue(bal, setup.loot) * share);
  }

  const xp: Record<CharId, number> = {};
  for (const side of ['attacker', 'defender'] as const) {
    for (const sq of sideSetup(setup, side).squads) {
      if (sq.unnamed === true || leaderFates[sq.leaderId] === 'dead') continue;
      const v = leaderXp(bal, data.t, side === winner, rows.lostBySide[side === 'attacker' ? 'defender' : 'attacker'], side === 'attacker' ? lootValue : 0);
      xp[sq.leaderId] = Math.max(xp[sq.leaderId] ?? 0, v);
    }
  }

  const playerSquad = [...setup.attacker.squads, ...setup.defender.squads].find((sq) => sq.unnamed !== true && setup.leaders?.[sq.leaderId]?.isPlayer === true);
  const closeness = 1 - Math.abs(pA - 0.5) * 2;
  const result: BattleResult = {
    winner,
    retreated: false,
    casualties: rows.casualties,
    chief,
    lootValue,
    lootGoods: loot.lootGoods,
    buildingsBurned: 0,
    durationS: Math.round(90 + 360 * closeness),
    xp,
    autoResolved: true,
    squadLosses: rows.squadLosses,
    leaderFates,
    surrendered: false,
    lootSilver: loot.lootSilver,
    lootBurnedShare: 0,
    duels: [],
  };
  if (playerSquad) {
    const f = leaderFates[playerSquad.leaderId] ?? 'fine';
    result.playerFate = f === 'dead' ? 'dead' : f === 'captured' ? 'captured' : f === 'fine' ? 'fine' : 'wounded';
  }
  return result;
}
