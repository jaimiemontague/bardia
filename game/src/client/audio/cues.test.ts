import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@sim/core/events';
import { clientAudioFromSettings, NARRATION_SPEED_FACTORS, patchFromClientSettings } from './settingsBridge';
import { cuesForEvents, type CueState } from './simCues';
import { DEFAULT_AUDIO_SETTINGS, mergeAudioSettings } from './settings';
import { encodeWav } from './wav';

const state: CueState = { player: { factionId: 'fac_1', rulerId: 'chr_1', expeditionFleetId: 'flt_9' } };
const ev = (type: string, fields: Record<string, unknown> = {}) => ({ type, ...fields }) as unknown as SimEvent;

describe('sim-event audio cues', () => {
  it('stingers only for the player’s house', () => {
    expect(cuesForEvents([ev('Birth', { childId: 'chr_5', factionId: 'fac_1', twin: false })], state)).toEqual([{ kind: 'stinger', id: 'birth' }]);
    expect(cuesForEvents([ev('Birth', { childId: 'chr_6', factionId: 'fac_2', twin: false })], state)).toEqual([]);
    expect(cuesForEvents([ev('Death', { charId: 'chr_7', factionId: 'fac_3', wasPlayerRuler: false })], state)).toEqual([]);
    expect(cuesForEvents([ev('Death', { charId: 'chr_1', wasPlayerRuler: true })], state)).toEqual([{ kind: 'stinger', id: 'death' }]);
    expect(cuesForEvents([ev('OmenRead', { factionId: 'fac_1' })], state)).toEqual([{ kind: 'stinger', id: 'omen' }]);
  });

  it('one stinger per batch, the most significant', () => {
    const cues = cuesForEvents([ev('OmenRead', { factionId: 'fac_1' }), ev('Death', { factionId: 'fac_1' }), ev('Birth', { factionId: 'fac_1' })], state);
    expect(cues).toEqual([{ kind: 'stinger', id: 'death' }]);
  });

  it('victory or defeat from the player’s side of a battle', () => {
    expect(cuesForEvents([ev('BattleEnded', { playerSide: 'attacker', result: { winner: 'attacker' } })], state)).toEqual([{ kind: 'stinger', id: 'victory' }]);
    expect(cuesForEvents([ev('BattleEnded', { playerSide: 'attacker', result: { winner: 'defender' } })], state)).toEqual([{ kind: 'stinger', id: 'defeat' }]);
    expect(cuesForEvents([ev('BattleEnded', { result: { winner: 'defender' } })], state)).toEqual([]);
    expect(cuesForEvents([ev('BattleEnded', { playerSide: 'defender', result: { winner: 'none' } })], state)).toEqual([]);
  });

  it('thunder when a storm hits the player’s fleet; nothing for unknown events', () => {
    expect(cuesForEvents([ev('StormHit', { fleetId: 'flt_9' })], state)).toEqual([{ kind: 'sfx', id: 'weather.thunder', params: { distance: 0.15 } }]);
    expect(cuesForEvents([ev('StormHit', { fleetId: 'flt_2' }), ev('SomethingNew')], state)).toEqual([]);
  });
});

describe('settings bridge', () => {
  it('maps the shared 0–100 volumes, narration and narration speed', () => {
    const patch = patchFromClientSettings({ audio: { master: 80, music: 70, sfx: 100, ambience: 0, voice: 50, narration: false }, accessibility: { narrationSpeed: 'fast' } });
    expect(patch).toEqual({ volumes: { master: 0.8, music: 0.7, sfx: 1, ambience: 0, voice: 0.5 }, narration: false, narrationSpeed: NARRATION_SPEED_FACTORS.fast });
  });

  it('round-trips the shared fields', () => {
    const shared = { master: 33, music: 66, sfx: 99, ambience: 12, voice: 1, narration: true };
    const s = mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, patchFromClientSettings({ audio: shared }));
    expect(clientAudioFromSettings(s)).toEqual(shared);
  });
});

describe('WAV encoding', () => {
  it('writes a valid 16-bit PCM header and clamps samples', () => {
    const l = new Float32Array([0, 1, -1, 2]);
    const r = new Float32Array([0.5, -0.5, 0, Number.NaN]);
    const wav = encodeWav([l, r], 22050);
    const v = new DataView(wav.buffer);
    const str = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(wav.length).toBe(44 + 16);
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4), s(5), s(6), s(7)]).toEqual([0, 16384, 32767, -16384, -32768, 0, 32767, 0]);
  });
});
