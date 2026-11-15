/**
 * The playable slice end to end with the full registry: launch an expedition from the hall, sail to a
 * foreign coastal settlement, raid or assault it (auto-resolved battle), decide its fate, take the cargo,
 * sail home and stand down.
 */
import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import { checkInvariants } from '@sim/core/env';
import type { FleetId, GameState, PendingDecision, Settlement, SettlementId } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { describe, expect, it } from 'vitest';
import { suggestPlan } from '../expeditions/plan';
import { arrivalOptions } from './index';

type Session = ReturnType<typeof GameSession.newGame>;

function ok(s: Session, command: Command): ReturnType<Session['dispatch']> {
  const r = s.dispatch(command);
  if (r.error) throw new Error(`${command.type}: ${r.error.code} ${r.error.message}`);
  return r;
}

/** Foreign coastal settlements, nearest to the capital first. */
function targets(state: GameState): Settlement[] {
  const home = state.settlements[state.player.capitalId];
  if (!home) throw new Error('no capital');
  const d2 = (s: Settlement) => (s.mapPos.x - home.mapPos.x) ** 2 + (s.mapPos.y - home.mapPos.y) ** 2;
  return Object.values(state.settlements)
    .filter((s) => s.coastal && s.factionId !== state.player.factionId)
    .sort((a, b) => d2(a) - d2(b) || (a.id < b.id ? -1 : 1));
}

/** Answers other decisions headlessly and advances until a decision of `kind` (or `maxHours`). */
function advanceUntil(s: Session, kind: string | null, maxHours: number, until?: (st: GameState) => boolean): PendingDecision | null {
  let hours = 0;
  for (let guard = 0; hours < maxHours && guard < 500; guard++) {
    if (until?.(s.getState())) return null;
    const p = s.getState().pending;
    if (p) {
      if (p.kind === kind) return p;
      const h = headlessCommand(s.getState(), p);
      if (!('command' in h)) throw new Error(`headless: ${h.error}`);
      ok(s, h.command);
      continue;
    }
    hours += s.advance(Math.min(24, maxHours - hours)).hoursAdvanced;
  }
  return null;
}

/** A new game (seed 'slice-1': a southern start, open water) with the expedition launched and arrived at the nearest neighbour. */
function arrive(seed = 'slice-1'): { s: Session; fleetId: FleetId; target: SettlementId; arrival: PendingDecision } {
  const content = getContent();
  const s = GameSession.newGame({ seed });
  ok(s, { type: 'launchExpedition', ...suggestPlan(s.getState(), content, 30) });
  const fleetId = s.getState().player.expeditionFleetId as FleetId;
  let target: SettlementId | undefined;
  for (const t of targets(s.getState()))
    if (!s.dispatch({ type: 'setRoute', to: { settlementId: t.id } }).error) {
      target = t.id;
      break;
    }
  if (target === undefined) throw new Error('no reachable target');
  const arrival = advanceUntil(s, 'arrival', 24 * 40);
  if (!arrival) throw new Error('never arrived');
  return { s, fleetId, target, arrival };
}

function fight(s: Session, choice: 'raid' | 'assault'): void {
  ok(s, { type: 'resolveArrival', choice });
  const setup = s.getState().pending;
  expect(setup?.kind).toBe('battleSetup');
  ok(s, { type: 'startBattle', battleId: (setup?.payload as { battleId: string }).battleId, mode: 'auto' } as never);
}

describe('the playable slice (launch → raid → home)', () => {
  it('suggests a crewed plan even when the hall is short of men', () => {
    const content = getContent();
    const s = GameSession.newGame({ seed: 'slice-1' });
    const plan = suggestPlan(s.getState(), content, 30);
    let men = 0;
    for (const n of Object.values(plan.men)) men += n ?? 0;
    let crewMin = 0;
    for (const id of plan.shipIds) crewMin += content.balance.ships[s.getState().ships[id]?.type ?? 'snekkja']?.crewMin ?? 0;
    expect(plan.shipIds.length).toBeGreaterThan(0);
    expect(men).toBeGreaterThanOrEqual(crewMin);
    expect(plan.rations).toBeGreaterThanOrEqual(men * 30);
  });

  it('raids a neighbour, loads cargo and brings the loot home', () => {
    const { s, fleetId, target, arrival } = arrive();
    const start = s.getState();
    const faction = start.player.factionId;
    const payload = arrival.payload as { settlementId: SettlementId; options: { id: string; available: boolean }[]; choices: unknown[] };
    expect(payload.settlementId).toBe(target);
    expect(payload.options.map((o) => o.id)).toEqual(['enter', 'parley', 'trade', 'raid', 'assault', 'besiege', 'leave']);
    expect(payload.options.find((o) => o.id === 'raid')?.available).toBe(true);
    expect(payload.choices).toHaveLength(7);

    fight(s, 'raid');
    const after = s.getState();
    expect(after.settlements[target]?.lastFate?.fate).toBe('raid');
    expect(after.settlementsState?.loot).toMatchObject({ settlementId: target, fleetId });
    const silver = after.fleets[fleetId]?.silver ?? 0;
    expect(silver).toBeGreaterThan(0);
    expect(checkInvariants(after, s.env)).toEqual([]);

    // The Cargo screen: whatever is left in the market can be loaded (up to the holds).
    const left = Object.entries(after.markets[target]?.stock ?? {}).find(([g, v]) => g !== 'rations' && (v ?? 0) > 0.05);
    if (left) {
      const [good] = left;
      const had = after.fleets[fleetId]?.cargo[good as never] ?? 0;
      ok(s, { type: 'loadCargo', take: { [good]: 0.05 } } as never);
      expect(s.getState().fleets[fleetId]?.cargo[good as never]).toBeCloseTo(had + 0.05, 3);
    }

    const treasury = s.getState().factions[faction]?.treasury ?? 0;
    const men = Object.values(s.getState().fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
    const garrison = Object.values(s.getState().settlements[start.player.capitalId]?.garrison ?? {}).reduce((a, b) => a + b, 0);
    ok(s, { type: 'returnHome' });
    advanceUntil(s, null, 24 * 40, (st) => st.player.expeditionFleetId === undefined);
    const end = s.getState();
    expect(end.player.expeditionFleetId).toBeUndefined();
    expect(end.fleets[fleetId]).toBeUndefined();
    expect(end.meta.mode).toBe('hub');
    expect(end.settlementsState?.loot).toBeUndefined();
    expect(end.factions[faction]?.treasury ?? 0).toBeGreaterThanOrEqual(treasury + silver - 200); // wages may fall due on the way
    expect(Object.values(end.settlements[start.player.capitalId]?.garrison ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(garrison + men - 5);
    expect(checkInvariants(end, s.env)).toEqual([]);
  });

  it('assaults a neighbour and annexes it with a governor and a garrison', () => {
    const { s, target } = arrive();
    const before = s.getState().settlements[target] as Settlement;
    fight(s, 'assault');
    const p = s.getState().pending;
    expect(p?.kind).toBe('aftermath');
    const options = (p?.payload as { options: { id: string; available: boolean }[] }).options;
    expect(options.find((o) => o.id === 'annex')?.available).toBe(true);
    expect(options.find((o) => o.id === 'liberate')?.available).toBe(false);

    const r = ok(s, { type: 'chooseAftermath', fate: 'annex' });
    const after = s.getState();
    const t = after.settlements[target] as Settlement;
    expect(t.factionId).toBe(after.player.factionId);
    expect(t.holding?.governorId).toBeDefined();
    expect(after.characters[t.holding?.governorId as never]?.role?.kind).toBe('governor');
    expect(Object.values(t.garrison).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(20);
    expect(after.factions[after.player.factionId]?.holdingIds).toContain(target);
    expect(after.factions[before.factionId]?.holdingIds ?? []).not.toContain(target);
    const rel = Object.values(after.relations).find((x) => [x.a, x.b].includes(before.factionId) && [x.a, x.b].includes(after.player.factionId));
    expect(rel?.stance).toBe('war');
    expect(r.events.find((e) => e.type === 'SettlementFate')).toMatchObject({ fate: 'annex', previousFactionId: before.factionId });
    expect(checkInvariants(after, s.env)).toEqual([]);
  });

  it('sacks a town: people lost, prosperity ruined, devastated for years', () => {
    const { s, target } = arrive();
    const before = s.getState().settlements[target] as Settlement;
    fight(s, 'assault');
    expect(headlessCommand(s.getState())).toEqual({ command: { type: 'chooseAftermath', fate: 'spare' } });
    ok(s, { type: 'chooseAftermath', fate: 'sackAndBurn' });
    const t = s.getState().settlements[target] as Settlement;
    expect(t.pop).toBeLessThan(before.pop * 0.65);
    expect(t.economy).toBe('ruined');
    expect(t.devastationUntil ?? 0).toBeGreaterThan(s.getState().time.hour + 4 * 8640);
    expect(t.lastFate?.fate).toBe('sackAndBurn');
    expect(checkInvariants(s.getState(), s.env)).toEqual([]);
  });

  it('carries off the leader as a captive', () => {
    const { s, target } = arrive();
    fight(s, 'assault');
    // (the battle may have killed the old leader; the one in charge now is taken)
    const leaderId = s.getState().settlements[target]?.leaderId;
    ok(s, { type: 'chooseAftermath', fate: 'takeCaptives' });
    expect(s.getState().characters[leaderId as never]?.location.kind).toBe('captive');
  });

  it('enters as a guest, hears the news in the mead-hall and leaves', () => {
    const { s, target } = arrive();
    ok(s, { type: 'resolveArrival', choice: 'enter' });
    expect(s.getState().settlementsState?.inside).toBe(target);
    ok(s, { type: 'tavernAction', settlementId: target, action: 'anyNews' });
    ok(s, { type: 'tavernAction', settlementId: target, action: 'travellers' });
    const renown = s.getState().factions[s.getState().player.factionId];
    ok(s, { type: 'tavernAction', settlementId: target, action: 'buyRound' });
    expect(s.getState().factions[s.getState().player.factionId]).not.toBe(renown);
    ok(s, { type: 'leaveSettlement' });
    expect(s.getState().settlementsState?.inside).toBeUndefined();
    expect(s.dispatch({ type: 'tavernAction', settlementId: target, action: 'drink' }).error?.code).toBe('notInside');
  });

  it('refuses unavailable choices and answers nothing without a decision', () => {
    const { s, target } = arrive();
    expect(headlessCommand(s.getState())).toEqual({ command: { type: 'resolveArrival', choice: 'leave' } });
    expect(s.dispatch({ type: 'resolveArrival', choice: 'besiege' }).error?.code).toBe('unavailable');
    ok(s, { type: 'resolveArrival', choice: 'leave' });
    expect(s.dispatch({ type: 'resolveArrival', choice: 'raid' }).error?.code).toBe('noArrival');
    expect(s.dispatch({ type: 'chooseAftermath', fate: 'spare' }).error?.code).toBe('noAftermath');
    // At war, a guest's welcome is gone.
    const state = s.getState();
    const owner = state.settlements[target]?.factionId as string;
    const warState = { ...state, relations: { ...state.relations, x: { a: owner, b: state.player.factionId, opinion: -50, modifiers: [], stance: 'war', pacts: [], grievances: 0 } } } as unknown as GameState;
    const key = Object.keys(state.relations).find((k) => {
      const r = state.relations[k];
      return r && [r.a, r.b].includes(owner) && [r.a, r.b].includes(state.player.factionId);
    });
    const patched = key ? ({ ...state, relations: { ...state.relations, [key]: { ...state.relations[key], stance: 'war' } } } as GameState) : warState;
    const opts = arrivalOptions(patched, getContent(), target, state.player.expeditionFleetId);
    if (key) expect(opts.find((o) => o.id === 'enter')).toMatchObject({ available: false, reasonKey: 'settlements.reason.atWar' });
  });

  it('a northern start is iced in for the first weeks and says so', () => {
    const content = getContent();
    const s = GameSession.newGame({ seed: 'slice-2' });
    ok(s, { type: 'launchExpedition', ...suggestPlan(s.getState(), content, 30) });
    const t = targets(s.getState())[0] as Settlement;
    expect(s.dispatch({ type: 'setRoute', to: { settlementId: t.id } }).error?.code).toBe('route.iced');
  });
});
