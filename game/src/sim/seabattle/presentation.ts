/**
 * Ids the client needs to present engine events: an asset-manifest sfx id per event kind
 * (src/content/assets/manifest/seabattle.json) and the HUD log line key (locales/en/seabattle.json).
 * The sim never contains English: the client formats `seabattle.log.<kind>` with the event's fields.
 */
import type { SeaEvent, SeaEventKind } from './engineTypes';

/** Sound cue per event kind (null = silent). */
export const SEA_EVENT_SFX: Readonly<Record<SeaEventKind, string | null>> = {
  volley: 'seabattle.sfx.volley',
  ignite: 'seabattle.sfx.ignite',
  douseStarted: 'seabattle.sfx.douse',
  extinguished: 'seabattle.sfx.extinguished',
  douseFailed: null,
  sailDestroyed: 'seabattle.sfx.sailTorn',
  ram: 'seabattle.sfx.ram',
  seaFire: 'seabattle.sfx.seaFire',
  collision: 'seabattle.sfx.collision',
  grounded: 'seabattle.sfx.grounded',
  grapple: 'seabattle.sfx.grapple',
  cutFree: 'seabattle.sfx.cutFree',
  cutFailed: null,
  boardingRound: 'seabattle.sfx.deckClash',
  boardingWon: 'seabattle.sfx.deckWon',
  struck: 'seabattle.sfx.struck',
  captured: 'seabattle.sfx.deckWon',
  sunk: 'seabattle.sfx.sink',
  fled: null,
  routed: 'seabattle.sfx.routed',
  rallied: null,
  flagshipLost: 'seabattle.sfx.flagshipLost',
  transfer: null,
  retreat: 'seabattle.sfx.retreatHorn',
  duelRequested: 'seabattle.sfx.challenge',
  duelResolved: null,
  ended: 'seabattle.sfx.ended',
};

/** Fire volleys use their own cue. */
export function seaEventSfx(e: SeaEvent): string | null {
  if (e.kind === 'volley') return e.fire ? 'seabattle.sfx.fireVolley' : SEA_EVENT_SFX.volley;
  return SEA_EVENT_SFX[e.kind];
}

/** Locale key of the HUD log line for an event (variants for fire arrows, burned ships, etc.). */
export function seaEventTextKey(e: SeaEvent): string {
  switch (e.kind) {
    case 'volley':
      return e.fire ? 'seabattle.log.fireVolley' : 'seabattle.log.volley';
    case 'ignite':
      return e.part === 'hull' ? 'seabattle.log.igniteHull' : 'seabattle.log.igniteSail';
    case 'sunk':
      return e.burned ? 'seabattle.log.burned' : 'seabattle.log.sunk';
    case 'grounded':
      return e.rock ? 'seabattle.log.rock' : 'seabattle.log.grounded';
    case 'boardingWon':
      return e.attackerWon ? 'seabattle.log.boardingWon' : 'seabattle.log.boardingRepelled';
    case 'duelResolved':
      return e.playerWon === null ? 'seabattle.log.duelDeclined' : e.playerWon ? 'seabattle.log.duelWon' : 'seabattle.log.duelLost';
    case 'ended':
      return `seabattle.log.ended.${e.winner}`;
    default:
      return `seabattle.log.${e.kind}`;
  }
}

/** Every log key the presentation layer can produce (tests check each has an English string). */
export const SEA_LOG_KEYS: readonly string[] = [
  'seabattle.log.volley',
  'seabattle.log.fireVolley',
  'seabattle.log.igniteSail',
  'seabattle.log.igniteHull',
  'seabattle.log.douseStarted',
  'seabattle.log.extinguished',
  'seabattle.log.douseFailed',
  'seabattle.log.sailDestroyed',
  'seabattle.log.ram',
  'seabattle.log.seaFire',
  'seabattle.log.collision',
  'seabattle.log.grounded',
  'seabattle.log.rock',
  'seabattle.log.grapple',
  'seabattle.log.cutFree',
  'seabattle.log.cutFailed',
  'seabattle.log.boardingRound',
  'seabattle.log.boardingWon',
  'seabattle.log.boardingRepelled',
  'seabattle.log.struck',
  'seabattle.log.captured',
  'seabattle.log.sunk',
  'seabattle.log.burned',
  'seabattle.log.fled',
  'seabattle.log.routed',
  'seabattle.log.rallied',
  'seabattle.log.flagshipLost',
  'seabattle.log.transfer',
  'seabattle.log.retreat',
  'seabattle.log.duelRequested',
  'seabattle.log.duelDeclined',
  'seabattle.log.duelWon',
  'seabattle.log.duelLost',
  'seabattle.log.ended.attacker',
  'seabattle.log.ended.defender',
  'seabattle.log.ended.none',
];
