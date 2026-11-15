// @vitest-environment jsdom
/**
 * The Shipyard as a room: the slip with the Shipwright and the ships on the strand. The strand holds the ship
 * cards with one line of state in words (the hulls behind Details); the Shipwright the build flow (pick a kind,
 * one cost sentence, one gold button) and the slipway line; a route param opens either at once.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { repairCost, shipOrdersOf, shipsOf } from '@sim/modules/military';
import { App } from '../../app/App';
import { useGame } from '../../app/gameStore';
import { useNavigation } from '../../app/navigation';
import { buildRegistry } from '../../app/screenRegistry';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import * as hub from '../hub/index';
import * as shipyard from './index';
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
  it('is a room on the slip: the Shipwright and the ships on the strand, no panel until one is chosen', () => {
    render(<Shipyard state={state()} onClose={() => {}} />);
    expect(screen.getByTestId('interior-shipyard')).toBeTruthy();
    expect(screen.getByTestId('shipyard')).toBeTruthy();
    expect(screen.getByTestId('interior-person-shipwright').getAttribute('aria-label')).toBe('Speak with The Shipwright');
    expect(screen.getByTestId('interior-person-strand')).toBeTruthy();
    expect(screen.queryByTestId('interior-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('interior-person-strand'));
    expect(screen.getByTestId('shipyard-strand')).toBeTruthy();
    fireEvent.click(screen.getByTestId('interior-person-shipwright'));
    expect(screen.getByTestId('shipyard-work')).toBeTruthy();
    expect(screen.queryByTestId('shipyard-strand')).toBeNull();
  });

  it('the strand shows every ship as a card with its state in words, and the numbers only behind Details', () => {
    render(<Shipyard state={state()} initialPerson="strand" onClose={() => {}} />);
    const ships = shipsOf(state(), state().player.factionId);
    const cards = screen.getByTestId('shipyard-ships').querySelectorAll('[data-ship]');
    expect(cards).toHaveLength(ships.length);
    expect(cards[0]?.textContent).toMatch(/Sound/);
    expect(cards[0]?.querySelector('svg.ship-picture')).toBeTruthy();
    expect(screen.queryByTestId(`repair-${ships[0]?.id}`)).toBeNull();
    // Hull and sail numbers live in Details.
    expect(screen.getByTestId('shipyard-fleet-details-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('shipyard-fleet').querySelectorAll('tr[data-ship]')).toHaveLength(ships.length);
  });

  it('a damaged ship on the strand says what its repair costs and offers one button', () => {
    const real = state();
    const ship = shipsOf(real, real.player.factionId)[0]!;
    const hurt = structuredClone(real) as GameState;
    (hurt.ships[ship.id] as { hullHp: number }).hullHp = ship.hullHp - 20;
    render(<Shipyard state={hurt} initialPerson="strand" onClose={() => {}} />);
    const cost = repairCost(getContent().balance, hurt.ships[ship.id]!);
    expect(screen.getByTestId(`shipyard-ship-${ship.id}`).textContent).toContain(`Needs repair: ${cost} silver`);
    expect((screen.getByTestId(`repair-${ship.id}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('the Shipwright builds a ship in one flow: pick a kind, read one sentence, press the gold button', () => {
    const view = render(<Shipyard state={state()} initialPerson="shipwright" onClose={() => {}} />);
    expect(screen.getByTestId('shipyard-work').textContent).toMatch(/shipyard tier 1/);
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
    expect(screen.getByTestId('interior-panel').querySelectorAll('.btn-primary')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('shipyard-type-karvi'));
    expect(screen.getByTestId('shipyard-queue').textContent).toMatch(/slipways are empty/);
    act(() => fireEvent.click(screen.getByTestId('order-karvi')));
    expect(shipOrdersOf(state(), state().player.capitalId)).toHaveLength(1);
    view.rerender(<Shipyard state={state()} initialPerson="shipwright" onClose={() => {}} />);
    expect(screen.getByTestId('shipyard-queue').textContent).toMatch(/Karvi: ready /);
    expect(screen.getByTestId('shipyard-queue').querySelector('[role="meter"]')).toBeTruthy();
  });

  it('deep links: a person param opens that panel, and the open panel is kept in the route', () => {
    render(<App registry={buildRegistry({ hub, shipyard })} />);
    act(() => useNavigation.getState().open('building.shipyard', { person: 'strand' }));
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('strand');
    fireEvent.click(screen.getByTestId('interior-person-shipwright'));
    expect(useNavigation.getState().stack.at(-1)?.params).toEqual({ person: 'shipwright' });
    fireEvent.click(screen.getByTestId('interior-leave'));
    expect(useNavigation.getState().stack.at(-1)?.id).not.toBe('building.shipyard');
  });

  it('every string it asked for exists', () => {
    render(<Shipyard state={state()} initialPerson="shipwright" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('interior-person-strand'));
    expect(missingKeysSeen().filter((k) => /^(hub|military)\./.test(k))).toEqual([]);
  });
});
