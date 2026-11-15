import { describe, expect, it } from 'vitest';
import type { GameState } from '@sim/core/state';
import { MUSIC_STATES } from './catalog';
import { FINAL_TRACK_SECONDS, musicTrackPath } from './manifestSpec';
import { battleMusic, eventMusic, hubMusic, meadHallMusic, menuMusic, outcomeMusic, voyageMusic } from './screenMusic';

describe('screen music', () => {
  it('menus play the main theme, the new-saga wizard its own track', () => {
    expect(menuMusic('mainMenu')).toBe('mainTheme');
    expect(menuMusic('options')).toBe('mainTheme');
    expect(menuMusic('newSaga')).toBe('newSaga');
  });

  it('the home village plays the homeland hall theme', () => {
    expect(hubMusic('skarn')).toBe('homeSkarn');
    expect(hubMusic('hvarn')).toBe('homeHvarn');
    expect(hubMusic('eyjar')).toBe('homeEyjar');
    expect(hubMusic(undefined)).toBe('homeSkarn');
  });

  it('raids get the raid score, other fights the shield wall', () => {
    expect(battleMusic('raid')).toBe('battleRaid');
    expect(battleMusic('cloister')).toBe('battleRaid');
    expect(battleMusic('field')).toBe('battleShieldwall');
    expect(battleMusic(undefined)).toBe('battleShieldwall');
  });

  it('results: victory, a loss mourned, a draw keeps the fight music', () => {
    expect(outcomeMusic('victory')).toBe('victory');
    for (const o of ['defeat', 'retreat', 'escaped']) expect(outcomeMusic(o)).toBe('funeral');
    expect(outcomeMusic('draw')).toBeUndefined();
  });

  it('the voyage: at sea, on a march, inside a town', () => {
    const at = (overland: boolean, inside?: string) =>
      ({ player: { expeditionFleetId: 'f1' }, fleets: { f1: overland ? { overland: {} } : {} }, ...(inside ? { settlementsState: { inside } } : {}) }) as unknown as GameState;
    expect(voyageMusic(at(false))).toBe('sailingCalm');
    expect(voyageMusic(at(true))).toBe('expedition');
    expect(voyageMusic(at(false, 's1'))).toBe('settlement');
    expect(voyageMusic(null)).toBe('sailingCalm');
  });

  it('the mead-hall rolls one of three moods', () => {
    expect(meadHallMusic(0)).toBe('meadHallRowdy');
    expect(meadHallMusic(0.5)).toBe('meadHallWarm');
    expect(meadHallMusic(0.95)).toBe('meadHallLament');
    expect(meadHallMusic(0.999999)).toBe('meadHallLament');
  });

  it('event cards: the succession and the fallen house are mourned', () => {
    expect(eventMusic('people.illus.succession')).toBe('funeral');
    expect(eventMusic('people.illus.houseFallen')).toBe('funeral');
    expect(eventMusic('people.illus.captivity')).toBeUndefined();
    expect(eventMusic(null)).toBeUndefined();
  });

  it('every state a screen asks for has a delivered final track', () => {
    const asked = new Set([
      menuMusic('mainMenu'),
      menuMusic('newSaga'),
      hubMusic('skarn'),
      hubMusic('hvarn'),
      hubMusic('eyjar'),
      battleMusic('raid'),
      battleMusic('field'),
      'battleSea',
      'victory',
      'funeral',
      'sailingCalm',
      'expedition',
      'settlement',
      'worldMap',
      'arrival',
      'greatHall',
      'longhouse',
      'smithy',
      'shipyard',
      'market',
      'meadHallRowdy',
      'meadHallWarm',
      'meadHallLament',
      'delve',
      'affairs',
      'chronicle',
    ] as const);
    for (const s of asked) {
      expect(MUSIC_STATES).toContain(s);
      expect(FINAL_TRACK_SECONDS[s], `${s} (${musicTrackPath(s)})`).toBeGreaterThan(0);
    }
  });
});
