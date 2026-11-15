/**
 * Which music state a screen asks for (`useMusicState`), as pure functions so the choices are testable
 * without rendering. Screens that are not listed here ask for nothing and keep whatever was playing
 * (the ledger over the hall, the game menu over a battle).
 *
 *   menus ............ mainTheme (the new-saga wizard: newSaga)
 *   home village ..... the homeland's hall theme (homeSkarn / homeHvarn / homeEyjar)
 *   rooms ............ greatHall, longhouse, smithy, shipyard, market, mead-hall (one of three per
 *                      visit), seer and grove: delve
 *   voyage ........... sailingCalm at sea, expedition on a march, settlement while inside a town;
 *                      the sea chart from the hall: worldMap; the planner: expedition
 *   battles .......... battleShieldwall, or battleRaid for raids; battleSea at sea; victory / funeral
 *                      on the result scene
 *   occasions ........ funeral for the succession card, the fallen house and a lost expedition
 *
 * Client-only presentation: nothing here reads or changes simulation randomness.
 */
import type { CultureId } from '@content/schemas/ids';
import type { BattleKind, GameState } from '@sim/core/state';
import { homeHallState, type MusicState } from './catalog';

/** The music of a menu page (outside a campaign). */
export function menuMusic(pageId: string): MusicState {
  return pageId === 'newSaga' ? 'newSaga' : 'mainTheme';
}

/** The home village's music: the homeland culture's hall theme (Skarn when unknown). */
export function hubMusic(culture: CultureId | string | undefined): MusicState {
  return culture ? homeHallState(culture as CultureId) : 'homeSkarn';
}

/** Battle kinds fought to the raid score (fast assaults on the unready) rather than the shield wall. */
const RAID_KINDS: ReadonlySet<BattleKind> = new Set<BattleKind>(['raid', 'cloister', 'ambush']);

/** The music of a land battle. */
export function battleMusic(kind: BattleKind | string | undefined): MusicState {
  return kind !== undefined && RAID_KINDS.has(kind as BattleKind) ? 'battleRaid' : 'battleShieldwall';
}

/**
 * The music of a battle's result scene: victory, or the funeral music for a defeat, a retreat or an
 * escape. A draw (no victor) asks for nothing, so the fight's music plays on.
 */
export function outcomeMusic(outcome: string): MusicState | undefined {
  if (outcome === 'victory') return 'victory';
  if (outcome === 'defeat' || outcome === 'retreat' || outcome === 'escaped') return 'funeral';
  return undefined;
}

/** The music of the expedition scene: inside a settlement, on a march, or at sea. */
export function voyageMusic(state: GameState | null | undefined): MusicState {
  if (!state) return 'sailingCalm';
  if (state.settlementsState?.inside !== undefined) return 'settlement';
  const id = state.player.expeditionFleetId;
  const fleet = id !== undefined ? state.fleets[id] : undefined;
  return fleet?.overland ? 'expedition' : 'sailingCalm';
}

/** The three mead-hall moods, and how often each is played. */
const MEAD_HALL_MOODS: readonly (readonly [MusicState, number])[] = [
  ['meadHallRowdy', 0.45],
  ['meadHallWarm', 0.4],
  ['meadHallLament', 0.15],
];

/** One mead-hall mood for a roll in [0, 1) (a visit rolls once, when the hall opens). */
export function meadHallMusic(roll: number): MusicState {
  let acc = 0;
  for (const [state, weight] of MEAD_HALL_MOODS) {
    acc += weight;
    if (roll < acc) return state;
  }
  return 'meadHallRowdy';
}

/** Event pictures that set the music while their card is up (the decision card, the critical alert). */
const EVENT_MUSIC: Readonly<Record<string, MusicState>> = {
  'people.illus.succession': 'funeral',
  'people.illus.houseFallen': 'funeral',
};

/** The music of an event card with this illustration, if it has one. */
export function eventMusic(illustration: string | null | undefined): MusicState | undefined {
  return illustration ? EVENT_MUSIC[illustration] : undefined;
}
