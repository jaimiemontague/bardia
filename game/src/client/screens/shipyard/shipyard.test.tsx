// @vitest-environment jsdom
/**
 * The Shipyard on the §20 layout: ship cards with one line of state in words, the build flow (pick a kind,
 * one cost sentence, one gold button), the slipway line, and the numbers behind Details.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { repairCost, shipOrdersOf, shipsOf } from '@sim/modules/military';
import { useGame } from '../../app/gameStore';
import { resetClientState } from '../../testing/clientTestKit';
import { Shipyard } from './index';

const OPEN_SEED = 'slice-1';

function state(): GameState {
  return useGame.getState().state as GameState;
}

beforeEach(() => {
  resetClientState();
  act(() => useGame.getState().attach(GameSession.newGame({ seed: OPEN_SEED })));
});
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('the Shipyard', () => {
  it('shows every ship as a card with its state in words, and the numbers only behind Details', () => {
    render(<Shipyard state={state()} onClose={() => {}} />);
    const ships = shipsOf(state(), state().player.factionId);
    const cards = screen.getByTestId('shipyard-ships').querySelectorAll('[data-ship]');
    expect(cards).toHaveLength(ships.length);
    expect(cards[0]?.textContent).toMatch(/Sound/);
    expect(cards[0]?.querySelector('svg.ship-picture')).toBeTruthy();
    expect(screen.queryByTestId(`repair-${ships[0]?.id}`)).toBeNull();
    // Hull and sail numbers live in Details.
    expect(screen.getByTestId('shipyard-details-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('shipyard-fleet').querySelectorAll('tr[data-ship]')).toHaveLength(ships.length);
  });

  it('a damaged ship says what its repair costs and offers one button', () => {
    const real = state();
    const ship = shipsOf(real, real.player.factionId)[0]!;
    const hurt = structuredClone(real) as GameState;
    (hurt.ships[ship.id] as { hullHp: number }).hullHp = ship.hullHp - 20;
    render(<Shipyard state={hurt} onClose={() => {}} />);
    const cost = repairCost(getContent().balance, hurt.ships[ship.id]!);
    expect(screen.getByTestId(`shipyard-ship-${ship.id}`).textContent).toContain(`Needs repair: ${cost} silver`);
    expect((screen.getByTestId(`repair-${ship.id}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('builds a ship in one flow: pick a kind, read one sentence, press the gold button', () => {
    const view = render(<Shipyard state={state()} onClose={() => {}} />);
    // A kind the yard is too small for is closed and says why.
    expect(screen.getByTestId('shipyard-type-drakkar').textContent).toMatch(/Needs a shipyard of tier 3/);
    expect((screen.getByTestId('shipyard-type-drakkar') as HTMLButtonElement).disabled).toBe(true);
    // The first open kind is chosen; picking another changes the sentence and the button.
    expect(screen.getByTestId('shipyard-type-karvi').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shipyard-cost').textContent).toMatch(/^A Karvi costs [\d,]+ silver and takes \d+ days to build, ready \d/);
    fireEvent.click(screen.getByTestId('shipyard-type-knarr'));
    expect(screen.getByTestId('shipyard-cost').textContent).toMatch(/^A Knarr costs/);
    expect(screen.getByTestId('order-knarr').textContent).toBe('Build a Knarr');
    expect(screen.queryByTestId('order-karvi')).toBeNull();
    fireEvent.click(screen.getByTestId('shipyard-type-karvi'));
    expect(screen.getByTestId('shipyard-queue').textContent).toMatch(/slipways are empty/);
    act(() => fireEvent.click(screen.getByTestId('order-karvi')));
    expect(shipOrdersOf(state(), state().player.capitalId)).toHaveLength(1);
    view.rerender(<Shipyard state={state()} onClose={() => {}} />);
    expect(screen.getByTestId('shipyard-queue').textContent).toMatch(/Karvi: ready /);
    expect(screen.getByTestId('shipyard-queue').querySelector('[role="meter"]')).toBeTruthy();
  });
});
