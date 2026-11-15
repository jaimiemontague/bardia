/**
 * Grappling and boarding (design §15.2, §31.13).
 *
 * - Ships within 8 m (hull to hull) at a relative speed under 1 m/s can grapple.
 * - While the lines are being made fast (tunables.boarding.grappleSetupS) the grappled ship may try
 *   to cut free: a contest every cutFreeIntervalS with P = clamp(base × free / (free + holders)).
 * - Then the auto-resolved deck fight: deckPower = crewOnDeck × (atk_eff + def_eff) × morale/60 ×
 *   (drakkar ? 1.1 : 1); three rounds, casualties per round = 0.12 × enemyPower/ownPower × ownMen
 *   clamped to 5–35 %; after round 3 the side with the most power remaining wins.
 * - When the player's ship and an enemy ship with a named captain fought, the engine pauses in
 *   'duelRequested' for the optional captain duel (§14.1) before the outcome is applied.
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as SeaTunables } from '@content/schemas/tunables/seabattle';
import { clamp, dsigmoid } from '@sim/core/dmath';
import { Rng } from '@sim/core/rng';
import type { DuelId, DuelResult, DuelSetup } from '@sim/core/state';
import { applyCasualties, breakGrapple, capture, changeMorale, strike } from './combat';
import type { Grapple, SeaShip, SeaWorld } from './engineTypes';
import type { SeaDuelRequest } from './types';
import { crewOf, hullGap, relativeSpeed } from './physics';

/** One side of a deck fight. */
export interface DeckSide {
  men: number;
  atkEff: number;
  defEff: number;
  morale: number;
  drakkar: boolean;
}

/** §31.13 deck power. */
export function deckPower(b: Balance['boarding'], s: DeckSide): number {
  if (s.men <= 0) return 0;
  return s.men * (s.atkEff + s.defEff) * (s.morale / b.moraleDivisor) * (s.drakkar ? b.drakkarMult : 1);
}

/** §31.13 casualties of one round for the side with `ownMen` and `ownPower`. */
export function deckRoundLosses(b: Balance['boarding'], ownMen: number, ownPower: number, enemyPower: number): number {
  if (ownMen <= 0) return 0;
  if (ownPower <= 0) return ownMen * b.maxPct;
  const raw = b.casualtyK * (enemyPower / ownPower) * ownMen;
  return clamp(raw, b.minPct * ownMen, b.maxPct * ownMen);
}

export interface DeckFightRound {
  attackerPower: number;
  defenderPower: number;
  attackerLoss: number;
  defenderLoss: number;
}

export interface DeckFightOutcome {
  rounds: DeckFightRound[];
  attackerWon: boolean;
  attackerMen: number;
  defenderMen: number;
  attackerPower: number;
  defenderPower: number;
}

/**
 * The whole §31.13 deck fight resolved at once (used by auto-resolve, tools and tests; the engine
 * plays the same rounds over time). `startMen` per side feeds the §31.10 loss-morale rule.
 */
export function resolveDeckFight(balance: Balance, attacker: DeckSide, defender: DeckSide, startMen?: { attacker: number; defender: number }): DeckFightOutcome {
  const b = balance.boarding;
  const a = { ...attacker };
  const d = { ...defender };
  const rounds: DeckFightRound[] = [];
  const lossMorale = balance.battle.morale.lossesMult;
  for (let r = 0; r < b.rounds; r++) {
    const pa = deckPower(b, a);
    const pd = deckPower(b, d);
    const la = deckRoundLosses(b, a.men, pa, pd);
    const ld = deckRoundLosses(b, d.men, pd, pa);
    rounds.push({ attackerPower: pa, defenderPower: pd, attackerLoss: la, defenderLoss: ld });
    a.men = Math.max(0, a.men - la);
    d.men = Math.max(0, d.men - ld);
    if (startMen) {
      if (startMen.attacker > 0) a.morale = clamp(a.morale + (lossMorale * la) / startMen.attacker, 0, 100);
      if (startMen.defender > 0) d.morale = clamp(d.morale + (lossMorale * ld) / startMen.defender, 0, 100);
    }
  }
  const pa = deckPower(b, a);
  const pd = deckPower(b, d);
  return { rounds, attackerWon: pa > pd, attackerMen: a.men, defenderMen: d.men, attackerPower: pa, defenderPower: pd };
}

/** Cut-free chance of one attempt. */
export function cutFreeChance(t: SeaTunables, freeMen: number, holders: number): number {
  const b = t.boarding;
  if (freeMen <= 0) return b.cutFreeMin;
  return clamp((b.cutFreeBase * freeMen) / (freeMen + Math.max(0, holders)), b.cutFreeMin, b.cutFreeMax);
}

/** Men of a ship that fight on deck as the boarding side or the defending side. */
export function deckMen(t: SeaTunables, s: SeaShip, attacking: boolean): number {
  const share = attacking ? t.boarding.attackerShare : t.boarding.defenderShare;
  return s.boarders * share.boarders + s.archers * share.archers + s.rowers * share.rowers;
}

/** Deck side of an engine ship. */
export function deckSideOf(w: SeaWorld, s: SeaShip, attacking: boolean): DeckSide {
  return { men: deckMen(w.t, s, attacking), atkEff: s.atkEff, defEff: s.defEff, morale: s.morale, drakkar: s.drakkar };
}

/** Deck-power ratio of `s` boarding `target` (≥ tunables.ai.boardAdvantage → worth boarding). */
export function boardingAdvantage(w: SeaWorld, s: SeaShip, target: SeaShip): number {
  const b = w.balance.boarding;
  const own = deckPower(b, deckSideOf(w, s, true));
  const theirs = deckPower(b, deckSideOf(w, target, false));
  if (theirs <= 0) return own > 0 ? 99 : 0;
  return own / theirs;
}

/** Whether `s` can throw grapnels at `target` right now. */
export function canGrapple(w: SeaWorld, s: SeaShip, target: SeaShip): boolean {
  if (s.status !== 'active' || s.grapple >= 0 || s.regrappleCd > 0 || s.groundedS > 0) return false;
  if (target.side === s.side || target.grapple >= 0) return false;
  if (target.status !== 'active' && target.status !== 'struck') return false;
  if (deckMen(w.t, s, true) < 1) return false;
  const g = w.balance.seaBattle.grapple;
  return hullGap(w, s, target) <= g.rangeM && relativeSpeed(s, target) < g.maxRelSpeed;
}

/**
 * Grapples `target`. A struck ship is simply taken; a merchant crew strikes at once; otherwise the
 * lines go across and the cut-free window opens. Returns false when the grapple is not possible.
 */
export function tryGrapple(w: SeaWorld, s: SeaShip, target: SeaShip): boolean {
  if (!canGrapple(w, s, target)) return false;
  w.events.push({ t: w.timeS, kind: 'grapple', from: s.idx, to: target.idx });
  if (target.status === 'struck') {
    capture(w, target, s.side);
    s.prizes += 1;
    return true;
  }
  if (w.sides[target.side].role === 'merchant' && w.t.boarding.merchantStrikesWhenGrappled && target.controller !== 'player') {
    strike(w, target);
    capture(w, target, s.side);
    s.prizes += 1;
    return true;
  }
  const g: Grapple = {
    a: s.idx,
    d: target.idx,
    phase: 'lashing',
    t: 0,
    cutT: w.t.boarding.cutFreeIntervalS,
    cutRequested: false,
    round: 0,
    roundT: 0,
    aStartMen: crewOf(s),
    dStartMen: crewOf(target),
    done: false,
  };
  const gi = w.grapples.length;
  w.grapples.push(g);
  s.grapple = gi;
  target.grapple = gi;
  s.throttle = 0;
  target.throttle = 0;
  return true;
}

/** Does the grappled ship want to cut the lines (AI / subordinate captains)? */
function wantsCutFree(w: SeaWorld, a: SeaShip, d: SeaShip): boolean {
  if (d.controller === 'player') return false;
  const b = w.balance.boarding;
  const pa = deckPower(b, deckSideOf(w, a, true));
  const pd = deckPower(b, deckSideOf(w, d, false));
  return pd < pa * w.t.ai.cutFreeBelowRatio;
}

/** Advances every grapple: lashing and cut-free contests, then the three deck-fight rounds. */
export function updateGrapples(w: SeaWorld): void {
  const dt = w.dt;
  const tb = w.t.boarding;
  for (const g of w.grapples) {
    if (g.done) continue;
    const a = w.ships[g.a]!;
    const d = w.ships[g.d]!;
    if (a.status !== 'active' || (d.status !== 'active' && d.status !== 'struck')) {
      g.done = true;
      if (a.grapple >= 0 && w.grapples[a.grapple] === g) a.grapple = -1;
      if (d.grapple >= 0 && w.grapples[d.grapple] === g) d.grapple = -1;
      continue;
    }
    // Lashed hulls drift together.
    a.v *= 0.8;
    d.v *= 0.8;
    a.throttle = 0;
    d.throttle = 0;
    holdTogether(w, a, d);
    if (g.phase === 'lashing') {
      g.t += dt;
      g.cutT -= dt;
      if (g.cutT <= 1e-9) {
        g.cutT += tb.cutFreeIntervalS;
        const attempt = g.cutRequested || wantsCutFree(w, a, d);
        g.cutRequested = false;
        if (attempt) {
          const free = d.boarders + d.archers + d.rowers * 0.5;
          const p = cutFreeChance(w.t, free, a.boarders);
          if (w.rng.chance(p)) {
            breakGrapple(w, d);
            a.regrappleCd = tb.regrappleCooldownS;
            w.events.push({ t: w.timeS, kind: 'cutFree', ship: d.idx, from: a.idx });
            continue;
          }
          w.events.push({ t: w.timeS, kind: 'cutFailed', ship: d.idx, from: a.idx });
        }
      }
      if (g.t >= tb.grappleSetupS - 1e-9) {
        g.phase = 'fighting';
        g.roundT = 0;
        g.round = 0;
        g.aStartMen = crewOf(a);
        g.dStartMen = crewOf(d);
      }
      continue;
    }
    g.roundT += dt;
    if (g.roundT < tb.deckRoundS - 1e-9) continue;
    g.roundT -= tb.deckRoundS;
    g.round += 1;
    deckRound(w, g, a, d);
    if (g.round >= w.balance.boarding.rounds || deckMen(w.t, a, true) < 0.5 || deckMen(w.t, d, false) < 0.5) {
      finishDeckFight(w, g, a, d);
      if (w.status === 'duelRequested') return;
    }
  }
}

function holdTogether(w: SeaWorld, a: SeaShip, d: SeaShip): void {
  const gap = hullGap(w, a, d);
  const want = 1;
  if (gap <= want) return;
  // Pull the boarding ship toward the grappled one.
  const dx = d.x - a.x;
  const dy = d.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 1e-6) return;
  const pull = Math.min(gap - want, 0.5);
  a.x += (dx / dist) * pull;
  a.y += (dy / dist) * pull;
}

function deckRound(w: SeaWorld, g: Grapple, a: SeaShip, d: SeaShip): void {
  const b = w.balance.boarding;
  const tb = w.t.boarding;
  const sa = deckSideOf(w, a, true);
  const sd = deckSideOf(w, d, false);
  const pa = deckPower(b, sa);
  const pd = deckPower(b, sd);
  // §31.8 random factor on each side's losses (the fortunes of a deck fight).
  const [lo, hi] = w.balance.battle.randRange;
  const la = Math.min(sa.men, deckRoundLosses(b, sa.men, pa, pd) * w.rng.range(lo, hi));
  const ld = Math.min(sd.men, deckRoundLosses(b, sd.men, pd, pa) * w.rng.range(lo, hi));
  applyCasualties(w, a, la, tb.attackerShare);
  applyCasualties(w, d, ld, tb.defenderShare);
  w.events.push({ t: w.timeS, kind: 'boardingRound', attacker: a.idx, defender: d.idx, round: g.round, attackerLoss: la, defenderLoss: ld });
}

function finishDeckFight(w: SeaWorld, g: Grapple, a: SeaShip, d: SeaShip): void {
  const b = w.balance.boarding;
  const pa = deckPower(b, deckSideOf(w, a, true));
  const pd = deckPower(b, deckSideOf(w, d, false));
  const attackerWon = pa > pd;
  // Captain duel hand-off: the player's ship against an enemy ship with a named captain.
  if (w.offerDuels && w.playerCharId !== undefined && w.playerShip >= 0) {
    const playerShip = w.playerShip === a.idx ? a : w.playerShip === d.idx ? d : undefined;
    const enemy = playerShip === a ? d : playerShip === d ? a : undefined;
    if (playerShip && enemy && enemy.captainId !== undefined && w.captainFates[enemy.captainId] !== 'dead') {
      const playerWonDeck = playerShip === a ? attackerWon : !attackerWon;
      w.duelCount += 1;
      const setup = captainDuelSetup(w, playerShip, enemy);
      w.duel = { playerShip: playerShip.idx, enemyShip: enemy.idx, playerCharId: w.playerCharId, enemyCaptainId: enemy.captainId, playerWonDeck, setup };
      w.pendingBoarding = { grapple: g, attackerWonDeck: attackerWon };
      w.status = 'duelRequested';
      w.events.push({ t: w.timeS, kind: 'duelRequested', playerShip: playerShip.idx, enemyShip: enemy.idx });
      return;
    }
  }
  applyBoardingOutcome(w, g, a, d, attackerWon);
}

/**
 * A captain duel settled without the duel scene: §14.8's logistic odds (balance.duel.autoK) on a
 * rating the battle knows (gear tiers, the side's Command, +3 for the side that won the deck fight),
 * drawn from the duel's own seed so it is deterministic and independent of the battle's stream. The
 * loser's fate follows the stakes (yield: taken; death: killed; first blood: spared).
 */
export function autoCaptainDuel(w: SeaWorld, req: SeaDuelRequest): DuelResult {
  const playerSide = w.ships[req.playerShip]?.side ?? (w.playerSide === -1 ? 0 : w.playerSide);
  const ps = w.sides[playerSide].setup;
  const es = w.sides[playerSide === 0 ? 1 : 0].setup;
  const rate = (gear: { armourTier: number; weaponTier: number }, command: number | undefined, wonDeck: boolean) =>
    3 * (gear.weaponTier - 1) + 3 * (gear.armourTier - 1) + (command ?? 0) + (wonDeck ? 3 : 0);
  const rP = rate(req.setup.a, ps.command, req.playerWonDeck);
  const rE = rate(req.setup.b, es.command, !req.playerWonDeck);
  const rng = Rng.derive(req.setup.seed, 'autoCaptainDuel');
  const playerWins = rng.float() < dsigmoid(w.balance.duel.autoK * (rP - rE));
  const stakes = req.setup.stakes;
  return {
    winnerId: playerWins ? req.playerCharId : req.enemyCaptainId,
    loserFate: stakes === 'death' ? 'killed' : stakes === 'firstBlood' ? 'spared' : 'yielded',
    injuries: [],
    renown: playerWins ? w.balance.duel.renown.base : 0,
    autoResolved: true,
  };
}

/** The DuelSetup handed to the duel engine for a captain duel on deck. */
function captainDuelSetup(w: SeaWorld, playerShip: SeaShip, enemy: SeaShip): DuelSetup {
  const ps = w.sides[playerShip.side].setup;
  const es = w.sides[enemy.side].setup;
  return {
    id: `duel_${w.setup.id}_${w.duelCount}` as DuelId,
    a: { charId: w.playerCharId!, weapon: ps.captainWeapon ?? 'axe', armourTier: ps.armourTier, weaponTier: ps.weaponTier },
    b: { charId: enemy.captainId!, weapon: es.captainWeapon ?? 'axe', armourTier: es.armourTier, weaponTier: es.weaponTier },
    arena: 'deck',
    stakes: w.t.boarding.duelStakes,
    assisted: w.setup.duelAssist === true,
    seed: `${w.setup.seed}|duel|${w.duelCount}`,
  };
}

/**
 * Applies a finished deck fight: the defender loses → taken as a prize; the attacker loses → the
 * boarders are thrown back (a crew below surrenderCrewPct strikes to the defender instead).
 */
export function applyBoardingOutcome(w: SeaWorld, g: Grapple, a: SeaShip, d: SeaShip, attackerWon: boolean, rollCaptains = true): void {
  const tb = w.t.boarding;
  g.done = true;
  if (attackerWon) {
    w.events.push({ t: w.timeS, kind: 'boardingWon', winner: a.idx, loser: d.idx, attackerWon: true });
    if (rollCaptains) captainFallsOrIsTaken(w, d, g.dStartMen);
    capture(w, d, a.side);
    a.prizes += 1;
    a.grapple = -1;
  } else {
    w.events.push({ t: w.timeS, kind: 'boardingWon', winner: d.idx, loser: a.idx, attackerWon: false });
    breakGrapple(w, a);
    a.regrappleCd = tb.regrappleCooldownS;
    if (crewOf(a) < tb.surrenderCrewPct * a.startCrew) {
      if (rollCaptains) captainFallsOrIsTaken(w, a, g.aStartMen);
      strike(w, a);
      capture(w, a, d.side);
      d.prizes += 1;
    } else {
      a.backOffS = w.t.ram.backOffS;
      a.backOffDir = -1;
      changeMorale(w, a, -5);
    }
  }
}

/** A captain on the losing deck may fall (chance × share of his crew lost) before the ship is taken. */
function captainFallsOrIsTaken(w: SeaWorld, s: SeaShip, startMen: number): void {
  const id = s.captainId;
  if (id === undefined || w.captainFates[id] === 'dead') return;
  const lostShare = startMen > 0 ? clamp(1 - crewOf(s) / startMen, 0, 1) : 1;
  const gentle = w.setup.gentleMode === true && id === w.playerCharId;
  if (!gentle && w.rng.chance(w.t.boarding.captainDeckKillChance * lostShare)) {
    w.captainFates[id] = 'dead';
    if (id === w.playerCharId) w.playerShip = -1;
  }
}

/**
 * Resolves the paused captain duel. `result` null = the player declined: the deck fight stands.
 * Otherwise the duel decides the boarding: the winner's crew takes (or holds) the deck.
 */
export function resolveCaptainDuel(w: SeaWorld, result: DuelResult | null): void {
  const req = w.duel;
  const pending = w.pendingBoarding;
  if (w.status !== 'duelRequested' || !req || !pending) throw new Error('seabattle: no captain duel is pending');
  w.duel = null;
  w.pendingBoarding = null;
  w.status = 'running';
  const g = pending.grapple;
  const a = w.ships[g.a]!;
  const d = w.ships[g.d]!;
  if (result === null) {
    w.events.push({ t: w.timeS, kind: 'duelResolved', playerWon: null });
    applyBoardingOutcome(w, g, a, d, pending.attackerWonDeck);
    return;
  }
  w.captainDuel = result;
  const playerWon = result.winnerId === req.playerCharId;
  w.events.push({ t: w.timeS, kind: 'duelResolved', playerWon });
  const loserId = playerWon ? req.enemyCaptainId : req.playerCharId;
  const fate = result.loserFate === 'killed' ? 'dead' : result.loserFate === 'spared' && !playerWon ? 'wounded' : 'captured';
  for (const inj of result.injuries) if (w.captainFates[inj.charId] === 'fine') w.captainFates[inj.charId] = 'wounded';
  const playerShip = w.ships[req.playerShip]!;
  const enemy = w.ships[req.enemyShip]!;
  if (playerWon) {
    // The enemy crew loses heart: their ship is taken whichever side boarded. The captain's fate is
    // the duel's, so he is taken off the ship before the prize crew counts its captives.
    w.captainFates[loserId] = fate;
    enemy.captainId = undefined;
    g.done = true;
    breakGrapple(w, enemy);
    w.events.push({ t: w.timeS, kind: 'boardingWon', winner: playerShip.idx, loser: enemy.idx, attackerWon: playerShip === a });
    capture(w, enemy, playerShip.side);
    playerShip.prizes += 1;
    return;
  }
  // The player lost the duel: thrown back from their deck, or our own deck is taken.
  w.captainFates[loserId] = fate;
  if (fate === 'dead' || fate === 'captured') w.playerShip = -1;
  applyBoardingOutcome(w, g, a, d, playerShip !== a, false);
  if (w.playerShip < 0) {
    const side = w.sides[playerShip.side];
    if (!side.retreating) {
      side.retreating = true;
      side.retreatS = 0;
      for (const t of w.ships) if (t.side === playerShip.side && t.controller === 'player') t.controller = 'orders';
      w.events.push({ t: w.timeS, kind: 'retreat', side: playerShip.side });
    }
  }
}
