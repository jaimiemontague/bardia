import { describe, expect, it } from 'vitest';
import { MANIFEST_FRAGMENTS } from '@content/assets/index';
import { missingLocaleKeys } from '@content/locales/index';
import type { SeaEvent } from './engineTypes';
import { SEA_EVENT_SFX, SEA_LOG_KEYS, seaEventSfx, seaEventTextKey } from './presentation';

const manifest = MANIFEST_FRAGMENTS.seabattle as Record<string, unknown>;

describe('presentation ids', () => {
  it('every log key has an English string', () => {
    expect(missingLocaleKeys([...SEA_LOG_KEYS])).toEqual([]);
  });

  it('every notification, chronicle, order, status and arena key has an English string', () => {
    const keys = [
      ...['victory', 'defeat', 'escaped', 'draw'].map((k) => `seabattle.notify.${k}`),
      ...['victory', 'defeat', 'draw'].map((k) => `seabattle.chronicle.${k}`),
      ...['follow', 'attack', 'screen', 'hold', 'board', 'move', 'shoot', 'withdraw', 'retreat'].map((k) => `seabattle.order.${k}`),
      ...['active', 'struck', 'captured', 'sunk', 'burned', 'fled'].map((k) => `seabattle.status.${k}`),
      ...['openSea', 'coastal', 'skerries', 'strait', 'fjord', 'river'].map((k) => `seabattle.arena.${k}`),
      ...['running', 'broadReach', 'beamReach', 'closeHauled', 'inIrons'].map((k) => `seabattle.pointOfSail.${k}`),
    ];
    expect(missingLocaleKeys(keys)).toEqual([]);
  });

  it('every sound cue exists in the seabattle asset manifest', () => {
    const ids = new Set([...Object.values(SEA_EVENT_SFX).filter((x): x is string => x !== null), 'seabattle.sfx.fireVolley']);
    for (const id of ids) expect(Object.hasOwn(manifest, id)).toBe(true);
  });

  it('maps event variants to their own keys and cues', () => {
    const e = (x: SeaEvent): SeaEvent => x;
    expect(seaEventTextKey(e({ t: 0, kind: 'volley', from: 0, to: 1, hits: 2, fire: true }))).toBe('seabattle.log.fireVolley');
    expect(seaEventSfx(e({ t: 0, kind: 'volley', from: 0, to: 1, hits: 2, fire: true }))).toBe('seabattle.sfx.fireVolley');
    expect(seaEventTextKey(e({ t: 0, kind: 'sunk', ship: 1, burned: true }))).toBe('seabattle.log.burned');
    expect(seaEventTextKey(e({ t: 0, kind: 'ended', winner: 'none' }))).toBe('seabattle.log.ended.none');
    expect(SEA_LOG_KEYS).toContain(seaEventTextKey(e({ t: 0, kind: 'duelResolved', playerWon: null })));
  });
});
