// @vitest-environment jsdom
/** The Smithy as a room: the smith, and behind him the §20 layout: two big cards, one button each, Details. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('enters the work-shelter; clicking the smith opens everything the Smithy offers', () => {
    render(<Smithy state={state()} onClose={() => {}} />);
    expect(screen.getByTestId('interior-smithy')).toBeTruthy();
    expect(screen.getByTestId('smithy')).toBeTruthy();
    expect(screen.queryByTestId('smithy-armour')).toBeNull();
    fireEvent.click(screen.getByTestId('interior-person-smith'));
    expect(screen.getByTestId('interior-panel').textContent).toContain('The Smith');
    expect(screen.getByTestId('smithy-work')).toBeTruthy();
  });

  it('shows what the men carry, the next step in words, its cost and one button per card', () => {
    render(<Smithy state={state()} initialPerson="smith" onClose={() => {}} />);
    const armour = screen.getByTestId('smithy-armour');
    expect(armour.textContent).toMatch(/Your men wear/);
    expect(armour.textContent).toMatch(/Hide and wood/);
    expect(armour.textContent).toMatch(/Next: Leather and iron caps/);
    expect(armour.textContent).toMatch(/Every man defends \d+% better/);
    expect(screen.getByTestId('smithy-weapons').textContent).toMatch(/Every man strikes \d+% harder/);
    expect(screen.getByTestId('smithy-cost-armour').textContent).toMatch(/[\d,]+ silver/);
    expect(armour.querySelectorAll('button')).toHaveLength(1);
    // At most one gold button on the screen.
    expect(screen.getByTestId('interior-panel').querySelectorAll('.btn-primary').length).toBeLessThanOrEqual(1);
    // The breakdown and the table of tiers wait behind Details.
    expect(screen.getByTestId('smithy-details-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('smithy-tiers').querySelectorAll('tbody tr').length).toBeGreaterThan(4);
    expect(screen.getByTestId('smithy-tiers').querySelectorAll('thead th')).toHaveLength(4);
  });

  it('a disabled upgrade says why', () => {
    const poor = structuredClone(state()) as GameState;
    (poor.factions[poor.player.factionId] as { treasury: number }).treasury = 0;
    render(<Smithy state={poor} initialPerson="smith" onClose={() => {}} />);
    const button = screen.getByTestId('upgrade-armour') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('upgrade-armour-why').textContent).toMatch(/treasury cannot pay/);
  });
});
