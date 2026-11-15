import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import { checkInvariants } from '@sim/core/env';
import type { FleetId, GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { describe, expect, it } from 'vitest';
import { leadersAtHolding, planShortfall, rationsAvailable, shipsAtHolding, suggestPlan, validateExpedition } from './plan';

type Session = ReturnType<typeof GameSession.newGame>;
const content = getContent();

function ok(s: Session, command: Command): ReturnType<Session['dispatch']> {
  const r = s.dispatch(command);
  if (r.error) throw new Error(`${command.type}: ${r.error.code} ${r.error.message}`);
  return r;
}

function launched(seed = 'slice-1'): { s: Session; fleetId: FleetId } {
  const s = GameSession.newGame({ seed });
  ok(s, { type: 'launchExpedition', ...suggestPlan(s.getState(), content, 30) });
  return { s, fleetId: s.getState().player.expeditionFleetId as FleetId };
}

const codes = (state: GameState, plan: Parameters<typeof validateExpedition>[2]) => validateExpedition(state, content, plan).issues.map((i) => i.code);

describe('expedition planning', () => {
  const state = GameSession.newGame({ seed: 'slice-1' }).getState();
  const cap = state.player.capitalId;

  it('lists the ships, leaders and food a holding can send', () => {
    expect(shipsAtHolding(state, cap).length).toBeGreaterThan(0);
    const leaders = leadersAtHolding(state, cap, content.balance.character.adultAge, state.time.hour);
    expect(leaders[0]).toBe(state.player.rulerId);
    // At the capital the rations come from the house storehouse (economy), seeded for a first voyage.
    expect(rationsAvailable(state, cap)).toBe(state.storehouse?.rations);
    expect(rationsAvailable(state, cap)).toBeGreaterThanOrEqual(suggestPlan(state, content, 30, { ignoreStores: true }).rations);
  });

  it('loads cargo only from the storehouse, and names the shortfall', () => {
    const plan = suggestPlan(state, content, 30);
    expect(codes(state, { ...plan, cargo: { salt: 1 } })).toContain('notInStores');
    const short = planShortfall(state, { ...plan, rations: rationsAvailable(state, cap) + 500, cargo: { salt: 1 } });
    expect(short.rations).toBe(500);
    expect(short.goods).toEqual({ salt: 1 });
  });

  it('validates inline: leaders, ships, crews, food, holds and silver', () => {
    expect(codes(state, { leaderIds: [], shipIds: [], men: {}, rations: 0 })).toEqual(expect.arrayContaining(['noLeader', 'noShips']));
    const plan = suggestPlan(state, content, 30);
    expect(validateExpedition(state, content, plan).ok).toBe(true);
    const unit = Object.keys(plan.men)[0] as string;
    expect(codes(state, { ...plan, men: { ...plan.men, [unit]: 9999 } })).toEqual(expect.arrayContaining(['notEnoughMen', 'overcrowded']));
    expect(codes(state, { ...plan, men: {} })).toContain('undermanned');
    expect(codes(state, { ...plan, rations: 10 ** 9 })).toEqual(expect.arrayContaining(['notEnoughFood']));
    expect(codes(state, { ...plan, cargo: { rations: 1 } })).toContain('rationsAsCargo');
    expect(codes(state, { ...plan, silver: 10 ** 9 })).toContain('notEnoughSilver');
    expect(codes(state, { ...plan, leaderIds: [...plan.leaderIds, plan.leaderIds[0] as never] })).toContain('duplicateLeader');
    const short = validateExpedition(state, content, { ...plan, rations: 10 });
    expect(short.ok).toBe(true);
    expect(short.issues.find((i) => i.code === 'shortRations')?.severity).toBe('warning');
  });

  it('planExpedition keeps the plan for "Repeat last" without moving anything', () => {
    const s = GameSession.newGame({ seed: 'slice-1' });
    const plan = suggestPlan(s.getState(), content, 30);
    const garrison = s.getState().settlements[cap]?.garrison;
    ok(s, { type: 'planExpedition', ...plan });
    expect(s.getState().expeditions?.lastPlan).toEqual(plan);
    expect(s.getState().settlements[cap]?.garrison).toEqual(garrison);
  });
});

describe('an expedition at sea', () => {
  it('launches: ships, men, leaders and rations leave the holding as one fleet', () => {
    const s = GameSession.newGame({ seed: 'slice-1' });
    const before = s.getState();
    const plan = suggestPlan(before, content, 30);
    const r = ok(s, { type: 'launchExpedition', ...plan });
    const st = s.getState();
    const fleet = st.fleets[st.player.expeditionFleetId as FleetId];
    expect([...(fleet?.shipIds ?? [])].sort()).toEqual([...plan.shipIds].sort());
    expect(fleet?.rations).toBe(plan.rations);
    // Rations leave the storehouse; the population's food stores keep their meaning.
    expect(st.storehouse?.rations).toBe((before.storehouse?.rations ?? 0) - plan.rations);
    expect(st.settlements[st.player.capitalId]?.holding?.foodMonths).toBe(before.settlements[before.player.capitalId]?.holding?.foodMonths);
    expect(st.markets[st.player.capitalId]?.stock).toEqual(before.markets[before.player.capitalId]?.stock);
    expect(fleet?.men).toEqual(plan.men);
    expect(fleet?.leaderId).toBe(plan.leaderIds[0]);
    for (const id of plan.shipIds) expect(st.ships[id]?.dockedAt).toBeUndefined();
    expect(st.characters[st.player.rulerId]?.location).toEqual({ kind: 'fleet', id: fleet?.id });
    expect(st.meta.mode).toBe('map');
    expect(r.events.find((e) => e.type === 'ExpeditionLaunched')).toBeDefined();
    expect(s.dispatch({ type: 'launchExpedition', ...plan }).error?.code).toBe('alreadyAtSea');
    expect(checkInvariants(st, s.env)).toEqual([]);
  });

  it('eats a ration per man per day and starves when they run out', () => {
    const { s, fleetId } = launched();
    const men = Object.values(s.getState().fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
    const r0 = s.getState().fleets[fleetId]?.rations ?? 0;
    s.advance(24);
    expect(r0 - (s.getState().fleets[fleetId]?.rations ?? 0)).toBeLessThanOrEqual(Math.ceil(men * content.balance.food.rationsPerManPerDay));
    // An expedition that sails without food starves from the first day.
    const s2 = GameSession.newGame({ seed: 'slice-1' });
    ok(s2, { type: 'launchExpedition', ...suggestPlan(s2.getState(), content, 30), rations: 0 });
    const f2 = s2.getState().player.expeditionFleetId as FleetId;
    // (docked at home the crews eat from the hall's stores: sail for somewhere far)
    const home = s2.getState().settlements[s2.getState().player.capitalId];
    const far = Object.values(s2.getState().settlements)
      .filter((x) => x.coastal && x.factionId !== s2.getState().player.factionId)
      .sort((a, b) => (b.mapPos.x - (home?.mapPos.x ?? 0)) ** 2 + (b.mapPos.y - (home?.mapPos.y ?? 0)) ** 2 - ((a.mapPos.x - (home?.mapPos.x ?? 0)) ** 2 + (a.mapPos.y - (home?.mapPos.y ?? 0)) ** 2))
      .find((x) => !s2.dispatch({ type: 'setRoute', to: { settlementId: x.id } }).error);
    expect(far).toBeDefined();
    let starving = 0;
    for (let h = 0; h < 72; ) {
      const p = s2.getState().pending;
      if (p) {
        const c = headlessCommand(s2.getState(), p);
        if (!('command' in c)) break;
        ok(s2, c.command);
        continue;
      }
      const r = s2.advance(24);
      h += r.hoursAdvanced;
      starving += r.events.filter((e) => e.type === 'FleetStarving').length;
    }
    expect(starving).toBeGreaterThan(0);
    expect(s2.getState().expeditions?.starving[f2]).toBeGreaterThan(0);
  });

  it('lands a party (ship-guard stays) and takes it back aboard', () => {
    const { s, fleetId } = launched();
    const men0 = Object.values(s.getState().fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
    const r = ok(s, { type: 'makeLandfall' });
    const landed = r.events.find((e) => e.type === 'LandfallMade') as { armyId: string; men: number } | undefined;
    expect(landed).toBeDefined();
    const st = s.getState();
    expect(st.fleets[fleetId]?.mode).toBe('landed');
    const guard = Object.values(st.fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
    expect(guard).toBeGreaterThanOrEqual(content.balance.overland.shipGuardPerShip * (st.fleets[fleetId]?.shipIds.length ?? 0));
    expect(guard + (landed?.men ?? 0)).toBe(men0);
    expect(s.dispatch({ type: 'makeLandfall' }).error?.code).toBe('partyAshore');
    ok(s, { type: 'returnToShips' });
    const back = s.getState();
    expect(Object.values(back.fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0)).toBe(men0);
    expect(back.armies[landed?.armyId as never]).toBeUndefined();
    expect(back.characters[back.player.rulerId]?.location).toEqual({ kind: 'fleet', id: fleetId });
    expect(checkInvariants(back, s.env)).toEqual([]);
  });

  it('returnHome stands the expedition down at the capital', () => {
    const { s, fleetId } = launched();
    const cap = s.getState().player.capitalId;
    const garrison0 = Object.values(s.getState().settlements[cap]?.garrison ?? {}).reduce((a, b) => a + b, 0);
    const men = Object.values(s.getState().fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
    const stores0 = s.getState().storehouse?.rations ?? 0;
    // Goods aboard (bought from the home market into the docked fleet): they must land in the storehouse.
    ok(s, { type: 'trade', settlementId: cap, fleetId, buy: { furs: 2 } });
    ok(s, { type: 'returnHome' });
    for (let i = 0; i < 20 && s.getState().player.expeditionFleetId !== undefined; i++) {
      const r = s.advance(24);
      if (r.pending) break;
    }
    const st = s.getState();
    expect(st.player.expeditionFleetId).toBeUndefined();
    expect(st.fleets[fleetId]).toBeUndefined();
    expect(Object.values(st.settlements[cap]?.garrison ?? {}).reduce((a, b) => a + b, 0)).toBe(garrison0 + men);
    expect(st.meta.mode).toBe('hub');
    // Leftover rations and the cargo go back to the storehouse, never into the market.
    expect(st.storehouse?.rations ?? 0).toBeGreaterThan(stores0);
    expect(st.storehouse?.goods.furs).toBe(2);

    expect(checkInvariants(st, s.env)).toEqual([]);
  });
});
