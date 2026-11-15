// @vitest-environment jsdom
/**
 * The Expedition Planner (ARCHITECTURE §20 layout) and the house storehouse: rations load from the storehouse;
 * a plan that needs more shows the shortfall with one button that buys it from the capital's market, after
 * which Launch is allowed. The men and the provisions are two-sided transfers whose sides update live; trade
 * silver, the numbers and the steward's notes sit behind Details; the steward says one sentence.
 */
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { GameSession } from '@sim/game';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import { deserialize, serialize } from '@sim/index';
import type { GameState } from '@sim/core/state';
import { useGame } from '../../app/gameStore';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import { ExpeditionPlanner } from './index';
import { unitName } from './names';

function state(): GameState {
  return useGame.getState().state as GameState;
}

function Live(): ReactElement | null {
  const st = useGame((s) => s.state);
  return st ? <ExpeditionPlanner state={st} onClose={() => {}} /> : null;
}

/** A new game whose storehouse holds `rations` rations (and no goods), with a 30-day plan to repeat. */
function withRations(seed: string, rations: number): ReturnType<typeof GameSession.newGame> {
  const st = structuredClone(deserialize(GameSession.newGame({ seed }).save()).state);
  st.storehouse = { goods: {}, rations };
  st.expeditions = { version: 1, starving: {}, landParties: {}, ...st.expeditions, lastPlan: suggestPlan(st, getContent(), 30, { ignoreStores: true }) };
  return GameSession.load(serialize(st));
}

const digits = (id: string) => Number((screen.getByTestId(id).textContent ?? '').replace(/\D/g, ''));

beforeEach(() => resetClientState());
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('the planner and the storehouse', () => {
  it('provisions the first voyage from the storehouse without buying', () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'slice-1' })));
    render(<Live />);
    expect(screen.getByTestId('planner-stores').textContent).toMatch(/storehouse/i);
    expect(screen.queryByTestId('planner-shortfall')).toBeNull();
    const before = state().storehouse?.rations ?? 0;
    const launch = screen.getByTestId('planner-launch') as HTMLButtonElement;
    expect(launch.disabled).toBe(false);
    act(() => fireEvent.click(launch));
    const fleet = state().fleets[state().player.expeditionFleetId as never];
    expect(fleet?.rations).toBeGreaterThan(0);
    expect(state().storehouse?.rations).toBe(before - (fleet?.rations ?? 0));
  });

  it('shows a shortfall and buys it from the market in one click', () => {
    act(() => useGame.getState().attach(withRations('slice-1', 0)));
    render(<Live />);
    expect(screen.getByTestId('planner-rations-left').textContent).toBe('0');
    // Repeat the last plan (30 days of rations): the empty storehouse is short of all of them.
    fireEvent.click(screen.getByTestId('planner-repeat'));
    expect(screen.getByTestId('planner-shortfall').textContent).toMatch(/short of/);
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(true);
    const need = state().expeditions?.lastPlan?.rations ?? 0;
    const before = state().factions[state().player.factionId]?.treasury ?? 0;
    act(() => fireEvent.click(screen.getByTestId('planner-buy-shortfall')));
    expect(state().storehouse?.rations ?? 0).toBeGreaterThanOrEqual(need);
    expect(state().factions[state().player.factionId]?.treasury ?? 0).toBeLessThan(before);
    expect(screen.queryByTestId('planner-shortfall')).toBeNull();
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('moves men and provisions between the town and the ships, and both sides follow', () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'slice-1' })));
    render(<Live />);
    const garrison = state().settlements[state().player.capitalId]?.garrison ?? {};
    const unit = Object.keys(garrison).find((u) => (garrison[u] ?? 0) > 0) as string;
    const have = garrison[unit] ?? 0;
    const men = screen.getByRole('slider', { name: unitName(getContent(), unit) });
    // End keeps every one of them at home; ArrowLeft sends one aboard.
    fireEvent.keyDown(men, { key: 'End' });
    expect(digits(`planner-men-${unit}-right`)).toBe(0);
    expect(digits(`planner-men-${unit}-left`)).toBe(have);
    fireEvent.keyDown(men, { key: 'ArrowLeft' });
    expect(digits(`planner-men-${unit}-right`)).toBe(1);
    expect(digits(`planner-men-${unit}-left`)).toBe(have - 1);
    expect(screen.getByTestId('planner-summary').textContent).toMatch(/men/);

    // Provisions: None empties the holds, Quick muster refills them, the arrow keys move ten at a time.
    fireEvent.click(screen.getByTestId('planner-rations-mark-none'));
    expect(screen.getByTestId('planner-rations-right').textContent).toBe('0');
    expect(screen.getByTestId('planner-rations').textContent).toMatch(/No food for the crew/);
    fireEvent.click(screen.getByTestId('planner-suggest'));
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(false);
    const rations = screen.getByRole('slider', { name: 'Rations' });
    const aboard = digits('planner-rations-right');
    const stored = digits('planner-rations-left');
    fireEvent.keyDown(rations, { key: 'ArrowRight' });
    expect(digits('planner-rations-right')).toBe(aboard - 10);
    expect(digits('planner-rations-left')).toBe(stored + 10);
  });

  it("keeps trade silver and the steward's list behind Details, and says the one problem", () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'slice-1' })));
    render(<Live />);
    const toggle = screen.getByTestId('planner-details-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('planner-silver').closest('[hidden]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('planner-silver').closest('[hidden]')).toBeNull();
    fireEvent.keyDown(screen.getByRole('slider', { name: /Silver for trading/ }), { key: 'ArrowLeft' });
    expect(screen.getByTestId('planner-silver-right').textContent).toBe('10');
    // Without ships nothing can sail, and the steward says why in one sentence.
    for (const b of screen.getAllByTestId(/^planner-ship-/)) act(() => fireEvent.click(b));
    expect(screen.getByTestId('planner-blocked').textContent).toMatch(/Not yet: Choose at least one ship/);
    expect(screen.getByTestId('planner-issues').querySelector('[data-code="noShips"]')).not.toBeNull();
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers March overland beside Launch: no ships, food the men carry, and it sets out while the harbour is iced in', () => {
    const st0 = structuredClone(deserialize(GameSession.newGame({ seed: 'slice-1' }).save()).state);
    const zone = st0.worldIndex?.settlements[st0.player.capitalId]?.seaZoneId;
    if (zone) st0.weather.zones[zone] = { ...(st0.weather.zones[zone] as object), ice: true } as never;
    act(() => useGame.getState().attach(GameSession.load(serialize(st0))));
    render(<Live />);
    // Set sail is the default; the iced harbour stops it and the steward says the roads are open.
    expect(screen.getByTestId('planner-travel-sea').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('planner-iced').textContent).toMatch(/March overland/);
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId(/^planner-ship-/).length).toBeGreaterThan(0);
    // March overland: the ships go, the men may all go, the food is what they carry.
    act(() => fireEvent.click(screen.getByTestId('planner-travel-land')));
    expect(screen.getByTestId('planner-travel-land').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryAllByTestId(/^planner-ship-/)).toHaveLength(0);
    expect(screen.getByTestId('planner-on-foot').textContent).toMatch(/No ships/);
    expect(screen.getByTestId('planner-summary').textContent).toMatch(/march/);
    expect(screen.getByTestId('planner-rations').textContent).toMatch(/Carried/);
    const launch = screen.getByTestId('planner-launch') as HTMLButtonElement;
    expect(launch.textContent).toMatch(/March out/);
    expect(launch.disabled).toBe(false);
    expect(screen.queryByTestId('planner-blocked')).toBeNull();
    expect(screen.queryByTestId('planner-iced')).toBeNull();
    act(() => fireEvent.click(launch));
    const fleet = state().fleets[state().player.expeditionFleetId as never];
    expect(fleet?.overland).toBeDefined();
    expect(fleet?.shipIds).toEqual([]);
    expect(state().meta.mode).toBe('map');
  });

  it('switching back to Set sail restores the ships', () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'slice-1' })));
    render(<Live />);
    act(() => fireEvent.click(screen.getByTestId('planner-travel-land')));
    act(() => fireEvent.click(screen.getByTestId('planner-travel-sea')));
    expect(screen.getAllByTestId(/^planner-ship-/).some((b) => b.getAttribute('aria-pressed') === 'true' || b.className.includes('selected') || b.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(screen.getByTestId('planner-launch').textContent).toMatch(/Launch/);
  });

  it('every string it asked for exists', () => {
    expect(missingKeysSeen().filter((k) => /^(expeditions|economy|hub|ui)\./.test(k))).toEqual([]);
  });
});
