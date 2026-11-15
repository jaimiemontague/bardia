/**
 * Duel consequences (design §14.9, §22.5, §14.10). Pure: given the setup, the fight's summary, the
 * player's decision and a random source, decides the loser's fate, the injury rolls, Renown, Honor,
 * Dread, opinion and XP, and lists the effects to apply. index.ts applies them through the
 * owning modules' effect ops (people: woundCharacter/addTrait/kill/capture; core: standings).
 *
 * | Outcome                       | Effects                                                         |
 * |-------------------------------|-----------------------------------------------------------------|
 * | Win, spare (yield accepted)   | Renown +, Honor +5 (not for a mere first-blood bout); kin opinion + |
 * | Win, capture                  | Renown +; the foe is taken for ransom (battle, boarding, Nemesis, guardians, storylets) |
 * | Win, kill                     | Renown ++ (×killRenownMult); Dread +; kin opinion − (blood-feud storylets react to DuelEnded) |
 * | Lose, spared                  | Renown −; injury roll; possible capture                         |
 * | Lose, lethal                  | Only in duels to the death: death (Gentle Mode: the player character is captured instead) |
 *
 * `Duel Renown = 10 + 5 × the opponent's tier` (commoner 0, hersir 1, jarl 2, king 3, Nemesis 4).
 * Every fought (or auto-resolved) duel except practice wounds the loser at least `outcome.loserWound`
 * and rolls the §22.5 injury table for it; the winner rolls with `health.duelWinnerInjuryChance`
 * (scaled by the HP it lost in fought duels when `outcome.winnerInjuryHpScaled`).
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as DuelTunables } from '@content/schemas/tunables/duel';
import { clamp } from '@sim/core/dmath';
import type { EffectData } from '@sim/core/effects';
import type { RandomSource } from '@sim/core/rng';
import type { CharId, DuelResult, DuelSetup, FactionId, SettlementId, WoundState } from '@sim/core/state';
import type { DuelChoice, DuelFightSummary, DuelLoserFate, DuelMode, DuelSide } from './types';

/** A row of the §22.5 injury table. */
export type InjuryRow = Balance['health']['injuryTable'][number];

/** Rolls d100 on the §22.5 injury table (one draw). */
export function rollInjury(balance: Balance, rng: RandomSource): InjuryRow {
  const d = rng.int(1, 100);
  const table = balance.health.injuryTable;
  for (const row of table) if (d <= row.max) return row;
  return table[table.length - 1] as InjuryRow;
}

/** The world facts the outcome needs (looked up by the module from GameState). */
export interface OutcomeWorld {
  playerRulerId: CharId | undefined;
  playerFactionId: FactionId | undefined;
  /** Factions of the two fighters (undefined: no house). */
  factionOf: { a: FactionId | undefined; b: FactionId | undefined };
  /** Where a captive of each side would be held (the winner's settlement or capital), if known. */
  captiveAt: { a: SettlementId | undefined; b: SettlementId | undefined };
}

/** Everything decided for one finished duel. */
export interface DuelOutcome {
  result: DuelResult;
  winnerSide: DuelSide;
  loserSide: DuelSide;
  /** Effects owned by other modules (people) and the core standings, in application order. */
  effects: EffectData[];
  /** Chronicle and notification for duels of the player's house (null for NPC duels). */
  chronicle: { textKey: string; importance: number; vars: Record<string, string | number>; refs: string[] } | null;
  notify: { key: string; priority: 'normal' | 'high'; vars: Record<string, string | number> } | null;
}

/** Why a player decision is not allowed (null when it is). */
export function choiceProblem(setup: DuelSetup, tunables: DuelTunables, world: OutcomeWorld, winner: DuelSide, reason: DuelFightSummary['reason'] | 'auto', choice: DuelChoice): string | null {
  if (choice === 'spare') return null;
  if (setup.origin === 'practice') return 'practice bouts end without killing or captives';
  if (choice === 'kill') {
    if (setup.stakes !== 'death') return 'only a duel to the death may end in a killing';
    if (reason !== 'down' && reason !== 'auto') return 'quarter was granted (or the foe left the square); the foe cannot be killed';
    return null;
  }
  if (!canCapture(setup, tunables, world, winner)) return 'captives cannot be taken in this duel';
  return null;
}

function canCapture(setup: DuelSetup, tunables: DuelTunables, world: OutcomeWorld, winner: DuelSide): boolean {
  const origin = setup.origin ?? 'other';
  return tunables.outcome.captureOrigins.includes(origin) && world.factionOf[winner] !== undefined;
}

const WOUND_ORDER: readonly WoundState[] = ['none', 'minor', 'serious', 'mortal'];
function worse(a: WoundState, b: WoundState): WoundState {
  return WOUND_ORDER.indexOf(a) >= WOUND_ORDER.indexOf(b) ? a : b;
}

/** Effects for an injury row (and a minimum wound). Returns the effects and whether the row is a lasting injury. */
function injuryEffects(charId: CharId, row: InjuryRow | null, minWound: WoundState): EffectData[] {
  const out: EffectData[] = [];
  let wound: WoundState = minWound;
  let injury: string | undefined;
  if (row && row.id !== 'none') {
    if (row.wound !== undefined) {
      wound = worse(wound, row.wound);
      injury = row.id;
    } else if (row.skill !== undefined || row.attribute !== undefined) {
      wound = worse(wound, 'minor');
      injury = row.id;
    }
  }
  if (wound !== 'none') {
    const e: EffectData = { op: 'woundCharacter', charId, wound, cause: 'duel' };
    if (injury !== undefined) e['injury'] = injury;
    out.push(e);
  }
  if (row?.trait !== undefined) out.push({ op: 'addTrait', charId, trait: row.trait });
  return out;
}

/**
 * Decides the §14.9 consequences. Draws from `rng` in a fixed order: the loser's fate, the loser's
 * injury roll, the winner's injury chance, the winner's injury roll.
 */
export function decideOutcome(args: {
  setup: DuelSetup;
  fight: DuelFightSummary;
  mode: DuelMode;
  choice: DuelChoice | undefined;
  balance: Balance;
  tunables: DuelTunables;
  world: OutcomeWorld;
  rng: RandomSource;
}): DuelOutcome {
  const { setup, fight, mode, balance, tunables, world, rng } = args;
  const profiles = setup.profiles;
  if (!profiles) throw new RangeError(`duel ${setup.id}: setup has no fighter profiles`);
  const out = tunables.outcome;
  const origin = setup.origin ?? 'other';
  const practice = origin === 'practice';
  const winnerSide = fight.winner;
  const loserSide: DuelSide = winnerSide === 'a' ? 'b' : 'a';
  const winner = profiles[winnerSide];
  const loser = profiles[loserSide];
  const playerSide = setup.playerSide ?? null;
  const playerWon = playerSide !== null && playerSide === winnerSide;
  const reason = mode === 'auto' ? 'auto' : fight.reason;
  const toTheDeath = setup.stakes === 'death' && (reason === 'down' || reason === 'auto');
  const capturable = !practice && canCapture(setup, tunables, world, winnerSide);

  // --- The loser's fate.
  let fate: DuelLoserFate;
  const letGo: DuelLoserFate = fight.reason === 'yield' ? 'yielded' : 'spared';
  if (practice) {
    fate = 'spared';
  } else if (playerWon) {
    let choice = args.choice ?? 'spare';
    if (choiceProblem(setup, tunables, world, winnerSide, reason, choice) !== null) choice = 'spare';
    fate = choice === 'kill' ? 'killed' : choice === 'capture' ? 'captured' : letGo;
  } else if (toTheDeath && !rng.chance(winner.mercy)) {
    fate = 'killed';
  } else {
    fate = capturable && rng.chance(winner.captureChance) ? 'captured' : letGo;
  }
  // Gentle Mode (§5.1, §14.9): the player character is captured rather than killed.
  if (fate === 'killed' && setup.gentle && loser.charId === world.playerRulerId) fate = capturable ? 'captured' : 'spared';

  // --- Injuries (§22.5); none in practice, none for the dead loser.
  const effects: EffectData[] = [];
  const injuries: DuelResult['injuries'] = [];
  if (!practice) {
    if (fate !== 'killed') {
      const row = rollInjury(balance, rng);
      if (row.id !== 'none') injuries.push({ charId: loser.charId, injury: row.id });
      effects.push(...injuryEffects(loser.charId, row, out.loserWound));
    }
    let chance = balance.health.duelWinnerInjuryChance;
    if (mode !== 'auto' && out.winnerInjuryHpScaled) {
      const winnerHp = winnerSide === 'a' ? fight.hpPct.a : fight.hpPct.b;
      chance *= clamp(2 * (1 - winnerHp / 100), 0, 1);
    }
    if (rng.chance(chance)) {
      const row = rollInjury(balance, rng);
      if (row.id !== 'none') {
        injuries.push({ charId: winner.charId, injury: row.id });
        effects.push(...injuryEffects(winner.charId, row, 'none'));
      }
    }
  }

  // --- Death and captivity (people).
  if (fate === 'killed') effects.push({ op: 'kill', charId: loser.charId, cause: 'duel', killerId: winner.charId });
  if (fate === 'captured') {
    const captor = world.factionOf[winnerSide];
    if (captor !== undefined) {
      const e: EffectData = { op: 'capture', charId: loser.charId, captorFactionId: captor };
      const at = world.captiveAt[winnerSide];
      if (at !== undefined) e['at'] = at;
      effects.push(e);
    }
  }

  // --- Standings of the player's house (§14.9, §14.10).
  let renown = 0;
  let honor = 0;
  let dread = 0;
  let tauntsPaid = 0;
  if (playerSide !== null && !practice) {
    const opponentSide: DuelSide = playerSide === 'a' ? 'b' : 'a';
    const tier = setup.tiers?.[opponentSide] ?? 0;
    const duelRenown = balance.duel.renown.base + balance.duel.renown.perTier * tier;
    const championMult = setup.champion ? out.championRenownMult : 1;
    if (playerWon) {
      tauntsPaid = Math.min(fight.tauntsLanded[playerSide], out.tauntBonusMax);
      renown = duelRenown * (fate === 'killed' ? out.killRenownMult : 1) * championMult + tauntsPaid * balance.duel.moves.taunt.renownOnWin;
      if ((fate === 'spared' || fate === 'yielded') && setup.stakes !== 'firstBlood') honor = balance.duel.spareHonor;
      if (fate === 'killed') dread = out.killDread;
    } else {
      renown = -duelRenown * out.loseRenownMult * championMult;
    }
    renown = Math.round(renown);
    if (renown !== 0) effects.push({ op: 'changeRenown', amount: renown });
    if (honor !== 0) effects.push({ op: 'changeHonor', amount: honor });
    if (dread !== 0) effects.push({ op: 'changeDread', amount: dread });
    const foeFaction = world.factionOf[opponentSide];
    if (playerWon && foeFaction !== undefined && world.playerFactionId !== undefined && foeFaction !== world.playerFactionId) {
      if (fate === 'killed' && out.killOpinion !== 0) {
        effects.push({ op: 'changeOpinion', a: world.playerFactionId, b: foeFaction, amount: out.killOpinion, reason: 'duelKilled' });
      } else if ((fate === 'spared' || fate === 'yielded') && out.spareOpinion !== 0) {
        effects.push({ op: 'changeOpinion', a: world.playerFactionId, b: foeFaction, amount: out.spareOpinion, reason: 'duelSpared' });
      }
    }
  }

  // --- XP (§22.1: 50 + 10 × the opponent's level; practice: a little for both). People awards it.
  const xp: Record<CharId, number> = {};
  if (practice) {
    xp[winner.charId] = out.practiceXp;
    xp[loser.charId] = out.practiceXp;
  } else {
    xp[winner.charId] = balance.xp.sources.duelWinBase + balance.xp.sources.duelWinPerLevel * loser.level;
  }

  const result: DuelResult = {
    winnerId: winner.charId,
    loserFate: fate,
    injuries,
    renown,
    autoResolved: mode === 'auto',
    loserId: loser.charId,
    reason,
    mode,
    durationS: fight.durationS,
    xp,
    honor,
    dread,
    tauntsPaid,
  };

  let chronicle: DuelOutcome['chronicle'] = null;
  let notify: DuelOutcome['notify'] = null;
  if (playerSide !== null) {
    const mine = profiles[playerSide];
    const theirs = profiles[playerSide === 'a' ? 'b' : 'a'];
    const vars = { fighter: mine.name, opponent: theirs.name, winner: winner.name, loser: loser.name, origin, renown };
    if (!practice) {
      chronicle = {
        textKey: `duel.chronicle.${playerWon ? 'won' : 'lost'}.${fate}`,
        importance: out.chronicleImportance + (fate === 'killed' || fate === 'captured' ? 1 : 0),
        vars,
        refs: [profiles.a.charId, profiles.b.charId],
      };
    }
    notify = {
      key: practice ? 'duel.notify.practice' : `duel.notify.${playerWon ? 'won' : 'lost'}.${fate}`,
      priority: !playerWon && (fate === 'killed' || fate === 'captured') ? 'high' : 'normal',
      vars,
    };
  }
  return { result, winnerSide, loserSide, effects, chronicle, notify };
}
