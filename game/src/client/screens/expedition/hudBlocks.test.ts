/**
 * The HUD greys out orders that cannot succeed (no ship afloat, no crew, no one to lead, home iced in) and
 * keeps "Sail home" open for a fleet that can no longer sail (the survivors come home as lost).
 */
import { getContent } from '@content/index';
import type { CharId, FleetId, GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import { inDraft } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { hudBlocks, hudNextStep, knownOverland, marchNextStep, marchTargetOf, whereWords } from './hud';

function atSea(change?: (d: GameState) => void): GameState {
  const s = GameSession.newGame({ seed: 'slice-1' });
  const r = s.dispatch({ type: 'launchExpedition', ...suggestPlan(s.getState(), getContent(), 30) });
  if (r.error) throw new Error(r.error.code);
  if (!change) return s.getState();
  return inDraft(s.getState(), s.env, (d) => change(d)).state;
}

const fleetOf = (d: GameState) => d.fleets[d.player.expeditionFleetId as FleetId];
const open = { homeIced: false, atHome: false };

describe('expedition HUD order gates', () => {
  it('a sound fleet can take every order', () => {
    expect(hudBlocks(atSea(), open)).toEqual({ lost: false });
  });

  it('no ship afloat: no course, no landfall; Sail home brings the survivors back', () => {
    const st = atSea((d) => {
      const f = fleetOf(d);
      if (f) f.shipIds = [];
    });
    const b = hudBlocks(st, { homeIced: true, atHome: false });
    expect(b).toEqual({ lost: true, sail: 'noShips', landfall: 'noShips' });
    expect(hudNextStep({ block: b.sail, ashore: false, homeward: false, sailing: false, iced: false, foodDays: 9, cargoTons: 0 })).toBe('noShips');
  });

  it('no crew aboard: the same', () => {
    const st = atSea((d) => {
      const f = fleetOf(d);
      if (f) f.men = {};
    });
    expect(hudBlocks(st, open)).toEqual({ lost: true, sail: 'noCrew', landfall: 'noCrew' });
  });

  it('no one left to lead: no new course, but Sail home stays open', () => {
    const st = atSea((d) => {
      const f = fleetOf(d);
      for (const id of [f?.leaderId, ...(f?.lieutenantIds ?? [])] as CharId[]) {
        const c = d.characters[id];
        if (c) c.alive = false;
      }
    });
    expect(hudBlocks(st, open)).toEqual({ lost: false, sail: 'noLeader', landfall: 'noLeader' });
  });

  it('steering says how to stop; where the fleet lies is said in words', () => {
    const base = { ashore: false, homeward: false, iced: false, foodDays: 20, cargoTons: 0 };
    expect(hudNextStep({ ...base, sailing: true, steered: true })).toBe('steering');
    expect(hudNextStep({ ...base, sailing: true })).toBe('sailing');
    const st = atSea();
    const home = st.settlements[st.player.capitalId];
    const at = home?.mapPos ?? { x: 0, y: 0 };
    expect(whereWords(st, at, { ashore: false, docked: true })).toEqual({ key: 'harbour', vars: { place: home?.name } });
    expect(whereWords(st, at, { ashore: false, docked: false })).toEqual({ key: 'near', vars: { place: home?.name } });
    expect(whereWords(st, { x: -500, y: -500 }, { ashore: false, docked: false, zoneName: 'the Whale-Road' })).toEqual({ key: 'zone', vars: { zone: 'the Whale-Road' } });
    expect(whereWords(st, { x: -500, y: -500 }, { ashore: false, docked: false }).key).toBe('open');
  });

  it('home iced in: Sail home waits for the thaw, unless the fleet already lies at home', () => {
    const st = atSea();
    expect(hudBlocks(st, { homeIced: true, atHome: false }).home).toBe('homeIced');
    expect(hudBlocks(st, { homeIced: true, atHome: true }).home).toBeUndefined();
  });
});

describe('the march helm', () => {
  function marching(change?: (d: GameState) => void): GameState {
    const s = GameSession.newGame({ seed: 'slice-1' });
    const r = s.dispatch({ type: 'launchExpedition', ...suggestPlan(s.getState(), getContent(), 30, { travel: 'land' }) });
    if (r.error) throw new Error(r.error.code);
    if (!change) return s.getState();
    return inDraft(s.getState(), s.env, (d) => change(d)).state;
  }

  it('a sound march takes every order; with no man left March home brings the leaders back', () => {
    expect(hudBlocks(marching(), open)).toEqual({ lost: false });
    const st = marching((d) => {
      for (const a of Object.values(d.armies)) if (a.ownerId === d.player.factionId) for (const sq of a.squads) sq.men = 0;
    });
    expect(hudBlocks(st, open).lost).toBe(true);
    expect(marchNextStep({ block: 'noMen', homeward: false, routed: false, steered: true, foodDays: 9, cargoTons: 0 })).toBe('noMen');
  });

  it('says the next step in order of need', () => {
    const base = { homeward: false, routed: false, steered: false, foodDays: 9, cargoTons: 0 };
    expect(marchNextStep(base)).toBe('pick');
    expect(marchNextStep({ ...base, steered: true })).toBe('steering');
    expect(marchNextStep({ ...base, routed: true })).toBe('routed');
    expect(marchNextStep({ ...base, routed: true, homeward: true })).toBe('homeward');
    expect(marchNextStep({ ...base, foodDays: 2 })).toBe('lowFood');
    expect(marchNextStep({ ...base, cargoTons: 1 })).toBe('after');
    expect(marchNextStep({ ...base, block: 'noLeader', steered: true })).toBe('noLeader');
  });

  it('sends the war-band to a settlement, a site or a spot of land, never to sea', () => {
    expect(marchTargetOf({ kind: 'land', pos: [3, 4], cell: 0, provinceId: null, regionId: null })).toEqual({ x: 3, y: 4 });
    expect(marchTargetOf({ kind: 'sea', pos: [3, 4], cell: 0, zoneId: null })).toBeNull();
    expect(marchTargetOf({ kind: 'settlement', key: 'k', name: 'N', settlementId: 'set_1' as never, pos: [1, 1], cell: 0 })).toEqual({ settlementId: 'set_1' });
    expect(marchTargetOf(null)).toBeNull();
  });

  it('lists known places on the same land only', () => {
    const st = marching();
    const fid = st.player.expeditionFleetId as FleetId;
    const pos = st.fleets[fid]?.pos as { x: number; y: number };
    for (const id of knownOverland(st, pos)) expect(st.settlements[id]?.factionId).not.toBe(st.player.factionId);
  });
});
