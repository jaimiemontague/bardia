// @vitest-environment jsdom
/** The Smithy on the §20 layout: two big cards (armour, weapons), one button each, the reckoning in Details. */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { useGame } from '../../app/gameStore';
import { resetClientState } from '../../testing/clientTestKit';
import { Smithy } from './index';

function state(): GameState {
  return useGame.getState().state as GameState;
}

beforeEach(() => {
  resetClientState();
  act(() => useGame.getState().attach(GameSession.newGame({ seed: 'slice-1' })));
});
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('the Smithy', () => {
  it('shows what the men carry, the next step in words, its cost and one button per card', () => {
    render(<Smithy state={state()} onClose={() => {}} />);
    const armour = screen.getByTestId('smithy-armour');
    expect(armour.textContent).toMatch(/Your men wear/);
    expect(armour.textContent).toMatch(/Hide and wood/);
    expect(armour.textContent).toMatch(/Next: Leather and iron caps/);
    expect(armour.textContent).toMatch(/Every man defends \d+% better/);
    expect(screen.getByTestId('smithy-weapons').textContent).toMatch(/Every man strikes \d+% harder/);
    expect(screen.getByTestId('smithy-cost-armour').textContent).toMatch(/[\d,]+ silver/);
    expect(armour.querySelectorAll('button')).toHaveLength(1);
    // At most one gold button on the screen.
    expect(screen.getByTestId('smithy').querySelectorAll('.btn-primary').length).toBeLessThanOrEqual(1);
    // The breakdown and the table of tiers wait behind Details.
    expect(screen.getByTestId('smithy-details-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('smithy-tiers').querySelectorAll('tbody tr').length).toBeGreaterThan(4);
    expect(screen.getByTestId('smithy-tiers').querySelectorAll('thead th')).toHaveLength(4);
  });

  it('a disabled upgrade says why', () => {
    const poor = structuredClone(state()) as GameState;
    (poor.factions[poor.player.factionId] as { treasury: number }).treasury = 0;
    render(<Smithy state={poor} onClose={() => {}} />);
    const button = screen.getByTestId('upgrade-armour') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('upgrade-armour-why').textContent).toMatch(/treasury cannot pay/);
  });
});
