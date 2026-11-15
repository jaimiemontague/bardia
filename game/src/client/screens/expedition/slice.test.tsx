// @vitest-environment jsdom
/**
 * The expedition-loop screens against the full module registry: plan and launch at the hall, give the fleet
 * its orders, answer the Arrival Card, the battle setup and the Aftermath, visit the hub, and read the ledger.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import type { FleetId, GameState, SettlementId } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import { useGame } from '../../app/gameStore';
import { useNavigation } from '../../app/navigation';
import { buildRegistry } from '../../app/screenRegistry';
import { missingKeysSeen } from '../../i18n/index';
import { DecisionHost } from '../../shell/DecisionHost';
import { resetClientState } from '../../testing/clientTestKit';
import { battleResultScreen } from '../battle/ResultScene';
import * as battleSetup from '../battleSetup/index';
import { Ledger } from '../ledger/index';
import * as settlement from '../settlement/index';
import { CargoPanel, SettlementHub } from '../settlement/hub';
import { ExpeditionHud } from './hud';
import { ExpeditionPlanner } from './index';

const registry = buildRegistry({ battleSetup, settlement });
const OWN_PREFIXES = ['expeditions.', 'settlements.', 'battle.setup', 'battle.result', 'economy.ui', 'economy.good'];

function state(): GameState {
  return useGame.getState().state as GameState;
}

function nearestTarget(st: GameState): SettlementId {
  const home = st.settlements[st.player.capitalId];
  const d2 = (x: number, y: number) => (x - (home?.mapPos.x ?? 0)) ** 2 + (y - (home?.mapPos.y ?? 0)) ** 2;
  const t = Object.values(st.settlements)
    .filter((s) => s.coastal && s.factionId !== st.player.factionId)
    .sort((a, b) => d2(a.mapPos.x, a.mapPos.y) - d2(b.mapPos.x, b.mapPos.y))[0];
  return t?.id as SettlementId;
}

function advanceToPending(maxDays = 30): void {
  for (let d = 0; d < maxDays && !state().pending; d++) act(() => void useGame.getState().advanceHours(24));
}

beforeEach(() => {
  resetClientState();
  act(() => useGame.getState().attach(GameSession.newGame({ seed: 'slice-1' })));
});
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('the expedition loop on screen', () => {
  it('musters and launches from the planner', () => {
    let closed = false;
    render(<ExpeditionPlanner state={state()} onClose={() => (closed = true)} />);
    expect(screen.getByTestId('planner-summary').textContent).toMatch(/men/);
    const launch = screen.getByTestId('planner-launch') as HTMLButtonElement;
    expect(launch.disabled).toBe(false);
    act(() => fireEvent.click(launch));
    expect(closed).toBe(true);
    expect(state().player.expeditionFleetId).toBeDefined();
    expect(state().meta.mode).toBe('map');
  });

  it('blocks a launch the steward would refuse and says why', () => {
    render(<ExpeditionPlanner state={state()} onClose={() => {}} />);
    // Deselect every ship: no ships, no launch.
    for (const b of screen.getAllByTestId(/^planner-ship-/)) act(() => fireEvent.click(b));
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('planner-issues').querySelector('[data-code="noShips"]')).not.toBeNull();
  });

  it('sails, raids through the Arrival Card and the battle setup, and loads the cargo', () => {
    act(() => void useGame.getState().dispatch({ type: 'launchExpedition', ...suggest() }));
    const target = nearestTarget(state());
    const s = state().settlements[target];
    // "Sail for" on the selection card.
    const { unmount } = render(
      <ExpeditionHud
        state={state()}
        selected={{
          kind: 'settlement',
          key: target,
          name: s?.name ?? '',
          settlementId: target,
          pos: [s?.mapPos.x ?? 0, s?.mapPos.y ?? 0],
          cell: 0,
        }}
      />,
    );
    act(() => fireEvent.click(screen.getByTestId('order-sail-here')));
    expect(state().fleets[state().player.expeditionFleetId as FleetId]?.route.length).toBeGreaterThan(0);
    unmount();

    advanceToPending();
    expect(state().pending?.kind).toBe('arrival');
    const host = render(<DecisionHost registry={registry} />);
    expect(screen.getByTestId('arrival-card')).toBeTruthy();
    expect((screen.getByTestId('choose-besiege') as HTMLButtonElement).disabled).toBe(true);
    act(() => fireEvent.click(screen.getByTestId('choose-raid')));
    host.rerender(<DecisionHost registry={registry} />);
    expect(screen.getByTestId('battle-setup')).toBeTruthy();
    expect(screen.getByTestId('battle-odds').getAttribute('data-band')).toBeTruthy();
    expect((screen.getByTestId('battle-fight') as HTMLButtonElement).disabled).toBe(true);
    act(() => fireEvent.click(screen.getByTestId('battle-auto')));
    expect(state().settlements[target]?.lastFate?.fate).toBe('raid');
    host.unmount();

    // The captains' outcome as its own painted scene, then on.
    const top = useNavigation.getState().stack.at(-1);
    expect(top?.id).toBe('battleResult');
    const Result = battleResultScreen.component;
    const result = render(<Result params={top?.params ?? {}} close={() => useNavigation.getState().back()} />);
    const outcome = screen.getByTestId('battle-outcome').getAttribute('data-outcome') ?? '';
    expect(outcome).toMatch(/^(victory|defeat|retreat|draw)$/);
    expect(screen.getByTestId('battle-summary').getAttribute('data-asset')).toMatch(/^battle\.scene\./);
    act(() => fireEvent.click(screen.getByTestId('decision-choice-continue')));
    expect(useNavigation.getState().stack.some((r) => r.id === 'battleResult')).toBe(false);
    result.unmount();

    // Answer whatever followed (a storylet), then the Cargo screen.
    while (state().pending) act(() => void useGame.getState().dispatch(headless()));
    const cargo = render(<CargoPanel state={state()} />);
    expect(screen.getByTestId('cargo-panel')).toBeTruthy();
    act(() => fireEvent.click(screen.getByTestId('cargo-done')));
    expect(state().settlementsState?.loot).toBeUndefined();
    cargo.unmount();
  });

  it('assaults and decides the fate on the Aftermath screen', () => {
    act(() => void useGame.getState().dispatch({ type: 'launchExpedition', ...suggest() }));
    const target = nearestTarget(state());
    act(() => void useGame.getState().dispatch({ type: 'setRoute', to: { settlementId: target } }));
    advanceToPending();
    act(() => void useGame.getState().dispatch({ type: 'resolveArrival', choice: 'assault' }));
    act(
      () =>
        void useGame
          .getState()
          .dispatch({
            type: 'startBattle',
            battleId: (state().pending?.payload as { battleId: string }).battleId,
            mode: 'auto',
          } as never),
    );
    expect(state().pending?.kind).toBe('aftermath');
    render(<DecisionHost registry={registry} />);
    expect(screen.getByTestId('aftermath')).toBeTruthy();
    expect((screen.getByTestId('choose-liberate') as HTMLButtonElement).disabled).toBe(true);
    act(() => fireEvent.click(screen.getByTestId('choose-spare')));
    expect(state().settlements[target]?.lastFate?.fate).toBe('spare');
  });

  it('enters as a guest: mead-hall and leaving', () => {
    act(() => void useGame.getState().dispatch({ type: 'launchExpedition', ...suggest() }));
    act(
      () =>
        void useGame.getState().dispatch({ type: 'setRoute', to: { settlementId: nearestTarget(state()) } }),
    );
    advanceToPending();
    act(() => void useGame.getState().dispatch({ type: 'resolveArrival', choice: 'enter' }));
    const hub = render(<SettlementHub state={state()} />);
    expect(screen.getByTestId('settlement-hub')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /mead-hall/i }));
    act(() => fireEvent.click(screen.getByTestId('tavern-anyNews')));
    act(() => fireEvent.click(screen.getByTestId('hub-leave')));
    expect(state().settlementsState?.inside).toBeUndefined();
    hub.unmount();
  });

  it('shows the ledger', () => {
    render(<Ledger state={state()} onClose={() => {}} />);
    expect(screen.getByTestId('ledger-net')).toBeTruthy();
    expect(screen.getByTestId('ledger').textContent).toMatch(/Wages/);
  });

  it('every string the loop screens asked for exists', () => {
    expect(missingKeysSeen().filter((k) => OWN_PREFIXES.some((p) => k.startsWith(p)))).toEqual([]);
  });
});

function suggest() {
  return suggestPlan(state(), getContent(), 30);
}

function headless(): Command {
  const h = headlessCommand(state());
  if (!('command' in h)) throw new Error(h.error);
  return h.command;
}
