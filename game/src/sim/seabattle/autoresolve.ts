/**
 * Sea-battle auto-resolve (design §15.5, using the §31.11 win-probability and casualty model):
 *
 *   fleetPower = Σ crew × avg(atk_eff, def_eff) × morale/60 × (1 + 0.1 × archerShare)
 *                × windAdvantage(±10 %) × DreadBonus (drakkar +5 % each, cap +15 %)
 *                × galley ram / sea-fire multipliers × (1 − player penalty, §5.5)
 *   P(A wins) = r^2.2 / (r^2.2 + 1),  r = P_A / P_B
 *   loser casualties clamp(0.45 + 0.35 (1 − r′), 0.45, 0.8); winner clamp(0.08 + 0.30 r′, 0.05, 0.4)
 *
 * The weather gauge goes to the fleet that is faster in this wind (it chooses where to fight).
 * Ships lost, prizes, hull damage and captain fates follow tunables.seabattle.autoresolve.
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as SeaTunables } from '@content/schemas/tunables/seabattle';
import { clamp, dpow } from '@sim/core/dmath';
import type { RandomSource } from '@sim/core/rng';
import type { CharId, SeaBattleResult, SeaBattleSetup, SeaSideSetup, SeaShipSetup, ShipId } from '@sim/core/state';
import type { SeaEngineContent } from './engineTypes';
import { benchFactor, bestWindFactor, sailHpFactor } from './physics';
import { hasDrakkar, shipAtkEff, shipDefEff, sideCrew, sideStartMorale, sidesOf } from './rules';
import type { SeaCaptainFate, SeaShipOutcome, SeaSideKey } from './types';

/** Each factor of a side's fleet power (shown on the pre-battle screen). */
export interface SeaPowerBreakdown {
  crew: number;
  quality: number;
  morale: number;
  archerShare: number;
  wind: number;
  dread: number;
  galley: number;
  fire: number;
  penalty: number;
  power: number;
}

/** Fleet speed in knots in this wind: the slowest ship's best of rowing and sailing. */
export function fleetSpeedKn(balance: Balance, t: SeaTunables, side: SeaSideSetup, str: SeaBattleSetup['wind']['str']): number {
  let slowest = Infinity;
  const bw = bestWindFactor(balance, str);
  for (const s of side.ships) {
    const def = balance.ships[s.type];
    const rowers = Math.max(0, s.crew - s.archers - s.boarders);
    const row = def.rowKn * benchFactor(t, rowers, def.crewMax);
    const sail = def.sailKn * bw * sailHpFactor(t, s.sailHp, def.sail);
    slowest = Math.min(slowest, Math.max(row, sail));
  }
  return slowest === Infinity ? 0 : slowest;
}

/** Which side holds the weather gauge (faster by more than gaugeSpeedEdge), or null. */
export function weatherGauge(content: SeaEngineContent, setup: SeaBattleSetup): 0 | 1 | null {
  const [a, d] = sidesOf(setup);
  const va = fleetSpeedKn(content.balance, content.tunables, a, setup.wind.str);
  const vd = fleetSpeedKn(content.balance, content.tunables, d, setup.wind.str);
  const edge = 1 + content.tunables.autoresolve.gaugeSpeedEdge;
  if (va > vd * edge) return 0;
  if (vd > va * edge) return 1;
  return null;
}

/** §15.5 fleet power of one side. */
export function seaFleetPower(content: SeaEngineContent, setup: SeaBattleSetup, sideIdx: 0 | 1, gauge: 0 | 1 | null): SeaPowerBreakdown {
  const { balance, tunables: t } = content;
  const side = sidesOf(setup)[sideIdx];
  const crew = sideCrew(side);
  let q = 0;
  let archers = 0;
  let galleyCrew = 0;
  let seaFireCrew = 0;
  let drakkarCrew = 0;
  const seaFireCulture = side.culture !== undefined && t.fire.seaFireCultures.includes(side.culture);
  for (const s of side.ships) {
    q += s.crew * (shipAtkEff(balance, side, s) + shipDefEff(balance, side, s)) * 0.5;
    archers += s.archers;
    if (s.type === 'drakkar') drakkarCrew += s.crew;
    if (s.type === 'galley') {
      galleyCrew += s.crew;
      if (seaFireCulture) seaFireCrew += s.crew;
    }
  }
  const quality = crew > 0 ? q / crew : 0;
  const morale = sideStartMorale(balance, setup, sideIdx) / balance.autoresolve.moraleDivisor;
  const archerShare = crew > 0 ? archers / crew : 0;
  const archerMult = 1 + balance.seaBattle.autoresolve.archerShareBonus * archerShare;
  const wa = balance.seaBattle.autoresolve.windAdvantage;
  const wind = gauge === null ? 1 : gauge === sideIdx ? 1 + wa : 1 - wa;
  const drakkars = side.ships.filter((s) => s.type === 'drakkar').length;
  const dread = 1 + Math.min(t.autoresolve.dreadCap, drakkars * balance.ships.drakkar.dread) / 100;
  const galleyShare = crew > 0 ? galleyCrew / crew : 0;
  const seaFireShare = crew > 0 ? seaFireCrew / crew : 0;
  const drakkarShare = crew > 0 ? drakkarCrew / crew : 0;
  const galley =
    (1 + (t.autoresolve.galleyRamMult - 1) * galleyShare) *
    (1 + (t.autoresolve.seaFireMult - 1) * seaFireShare) *
    (1 + (t.autoresolve.drakkarMult - 1) * drakkarShare);
  const penalty = side.isPlayer ? 1 - (side.playerPenalty ?? 0) : 1;
  const fire = side.hasPitch && (side.pitchT ?? t.archery.defaultPitchT) >= t.archery.pitchPerVolleyT && side.fireArrows !== false ? t.autoresolve.fireArrowsMult : 1;
  const power = crew * quality * morale * archerMult * wind * dread * galley * fire * penalty;
  return { crew, quality, morale, archerShare: archerMult, wind, dread, galley, fire, penalty, power };
}

/** Win probability of the attacker (§31.11) and both powers. */
export function seaWinProbability(content: SeaEngineContent, setup: SeaBattleSetup): { pAttacker: number; attacker: SeaPowerBreakdown; defender: SeaPowerBreakdown } {
  const gauge = weatherGauge(content, setup);
  const attacker = seaFleetPower(content, setup, 0, gauge);
  const defender = seaFleetPower(content, setup, 1, gauge);
  const k = content.tunables.autoresolve.ratioSharpness;
  const pa = attacker.power;
  const pd = defender.power;
  // Sharpen the ratio (pa/pd)^k without changing the §31.11 curve itself.
  const pAttacker = k === 1 || pa <= 0 || pd <= 0 ? winProbability(content.balance, pa, pd) : winProbability(content.balance, dpow(pa / pd, k), 1);
  return { pAttacker, attacker, defender };
}

/** r^k / (r^k + 1) with the balance exponent; guards empty sides. */
export function winProbability(balance: Balance, pa: number, pd: number): number {
  if (pa <= 0 && pd <= 0) return 0.5;
  if (pd <= 0) return 1;
  if (pa <= 0) return 0;
  const rk = dpow(pa / pd, balance.autoresolve.exponent);
  return rk / (rk + 1);
}

/**
 * Resolves a sea battle without the engine. Draws: the winner, which loser ships are lost (weakest
 * first), prizes vs sunk, the winner's own loss above winnerShipLossAt, prize hulls and captain fates.
 */
export function autoResolveSea(content: SeaEngineContent, setup: SeaBattleSetup, rng: RandomSource): SeaBattleResult {
  const { balance, tunables: t } = content;
  const ar = balance.autoresolve;
  const tar = t.autoresolve;
  const { pAttacker, attacker, defender } = seaWinProbability(content, setup);
  const winnerIdx: 0 | 1 = rng.float() < pAttacker ? 0 : 1;
  const loserIdx: 0 | 1 = winnerIdx === 0 ? 1 : 0;
  const powers = [attacker.power, defender.power];
  const pw = powers[winnerIdx] as number;
  const pl = powers[loserIdx] as number;
  const rPrime = pw > 0 ? pl / pw : 1;
  const loserShare = clamp(ar.loser.base + ar.loser.slope * (1 - rPrime), ar.loser.min, ar.loser.max);
  const winnerShare = clamp(ar.winner.base + ar.winner.slope * rPrime, ar.winner.min, ar.winner.max);
  const sides = sidesOf(setup);
  const keys: [SeaSideKey, SeaSideKey] = ['attacker', 'defender'];
  const outcomes: SeaShipOutcome[] = [];
  const shipsSunk: ShipId[] = [];
  const shipsCaptured: ShipId[] = [];
  const shipsFled: ShipId[] = [];
  const capturedBy: Record<string, SeaSideKey> = {};
  const captainFates: Record<string, SeaCaptainFate> = {};
  const crewLost: SeaBattleResult['crewLost'] = [];
  const crewCaptives = { attacker: 0, defender: 0 };
  let playerFate: SeaCaptainFate | undefined;
  let surrendered = false;

  for (const idx of [0, 1] as const) {
    const side = sides[idx];
    const isWinner = idx === winnerIdx;
    const share = isWinner ? winnerShare : loserShare;
    const merchant = side.role === 'merchant';
    const n = side.ships.length;
    // Which ships are lost: the loser loses a share of its ships (weakest first, at least one);
    // the winner loses one only after heavy casualties.
    let lost = 0;
    if (!isWinner) lost = clamp(Math.round(tar.shipLossPerCasualty * share * n), 1, n);
    else if (share > tar.winnerShipLossAt && n > 1) lost = 1;
    const order = side.ships
      .map((s, i) => ({ i, key: s.hullHp / balance.ships[s.type].hull + rng.float() * 0.25 + (i === 0 ? 0.5 : 0) }))
      .sort((x, y) => x.key - y.key || x.i - y.i);
    const lostIdx: number[] = order.slice(0, lost).map((o) => o.i);
    const crew = sideCrew(side);
    let captured = 0;
    let lostCrewOnShips = 0;
    side.ships.forEach((s, i) => {
      const def = balance.ships[s.type];
      if (lostIdx.includes(i)) {
        const prize = !isWinner && (merchant || rng.chance(tar.captureShare));
        if (prize) {
          shipsCaptured.push(s.shipId);
          capturedBy[s.shipId] = keys[winnerIdx];
          captured += s.crew * (1 - share);
          surrendered = surrendered || merchant;
          outcomes.push({ shipId: s.shipId, side: keys[idx], status: 'captured', hullHp: Math.round(rng.range(tar.prizeHullShare[0], tar.prizeHullShare[1]) * def.hull), sailHp: Math.round(s.sailHp * 0.6), crew: 0, capturedBy: keys[winnerIdx] });
        } else {
          shipsSunk.push(s.shipId);
          outcomes.push({ shipId: s.shipId, side: keys[idx], status: 'sunk', hullHp: 0, sailHp: 0, crew: 0 });
        }
        lostCrewOnShips += s.crew;
      } else {
        const hull = Math.max(1, Math.round(s.hullHp - tar.hullDamagePerCasualty * share * def.hull));
        const sail = Math.max(0, Math.round(s.sailHp - tar.hullDamagePerCasualty * share * 0.5 * def.sail));
        const status = isWinner ? 'active' : 'fled';
        if (!isWinner) shipsFled.push(s.shipId);
        outcomes.push({ shipId: s.shipId, side: keys[idx], status, hullHp: hull, sailHp: sail, crew: Math.round(s.crew * (1 - share)) });
      }
    });
    const casualties = crew * share;
    let killed = casualties * (1 - ar.woundedShare);
    let wounded = casualties * ar.woundedShare;
    // A routing loser has half its wounded captured (§31.11).
    if (!isWinner && lost < n) {
      const taken = wounded * ar.routingCapturedShare;
      wounded -= taken;
      captured += taken;
    }
    // Crews of sunk ships that were not counted in casualties drown or are picked up.
    const sunkExtra = Math.max(0, lostCrewOnShips * (1 - share) - captured);
    if (!isWinner && sunkExtra > 0) killed += sunkExtra * (1 - t.sinking.swimSurvival);
    const capturedInt = Math.round(captured);
    const killedInt = Math.min(crew, Math.round(killed));
    const woundedInt = Math.min(crew - killedInt, Math.round(wounded));
    const capturedFinal = Math.min(crew - killedInt - woundedInt, capturedInt);
    crewLost.push({ side: keys[idx], killed: killedInt, wounded: woundedInt, captured: capturedFinal });
    crewCaptives[keys[idx]] = capturedFinal;

    // Captains: the flagship (index 0) carries the side's captain.
    const flagLost = lostIdx.includes(0);
    const flagCaptured = flagLost && side.ships[0] !== undefined && shipsCaptured.includes(side.ships[0].shipId);
    const ids: CharId[] = [];
    if (side.captainId !== undefined) ids.push(side.captainId);
    if (side.isPlayer && setup.playerCharId !== undefined && !ids.includes(setup.playerCharId)) ids.push(setup.playerCharId);
    for (const id of ids) {
      const gentle = setup.gentleMode === true && id === setup.playerCharId;
      let fate: SeaCaptainFate = 'fine';
      if (flagCaptured) fate = !gentle && rng.chance(t.boarding.captainDeckKillChance * share) ? 'dead' : 'captured';
      else if (flagLost) fate = n > lost ? (rng.chance(t.sinking.playerWoundOnTransfer) ? 'wounded' : 'fine') : gentle || rng.chance(t.sinking.captainSurvival) ? 'wounded' : 'dead';
      else if (rng.chance(share * 0.5)) fate = 'wounded';
      captainFates[id] = fate;
      if (id === setup.playerCharId) playerFate = fate;
    }
  }

  const closeness = 1 - Math.abs(pAttacker - 0.5) * 2;
  const durationS = Math.round(tar.durationS[0] + (tar.durationS[1] - tar.durationS[0]) * closeness);
  const xp: Record<string, number> = {};
  for (const idx of [0, 1] as const) {
    const side = sides[idx];
    const enemyLost = outcomes.filter((o) => o.side !== keys[idx] && (o.status === 'sunk' || o.status === 'captured')).length;
    const gain = t.xp.base + (idx === winnerIdx ? t.xp.win : 0) + t.xp.perShip * enemyLost;
    if (side.captainId !== undefined) xp[side.captainId] = gain;
    if (side.isPlayer && setup.playerCharId !== undefined) xp[setup.playerCharId] = gain;
  }
  const result: SeaBattleResult = {
    winner: keys[winnerIdx],
    retreated: shipsFled.length > 0,
    shipsSunk,
    shipsCaptured,
    crewLost,
    durationS,
    xp,
    autoResolved: true,
    shipsBurned: [],
    shipsFled,
    capturedBy,
    ships: outcomes,
    captainFates,
    pitchUsedT: { attacker: 0, defender: 0 },
    surrendered,
    crewCaptives: { attacker: crewCaptives.attacker, defender: crewCaptives.defender },
  };
  if (playerFate !== undefined) result.playerFate = playerFate;
  return result;
}

/** Ships of a side in a stable order (for tools). */
export function shipsOf(setup: SeaBattleSetup, side: 0 | 1): readonly SeaShipSetup[] {
  return sidesOf(setup)[side].ships;
}

/** True when the side carries a drakkar (re-exported for the HUD). */
export { hasDrakkar };
