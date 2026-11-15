// @vitest-environment jsdom
/** The Ledger on the §20 layout: the treasury large, a few lines in words, the month's result, rows in Details. */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { useGame } from '../../app/gameStore';
import { resetClientState } from '../../testing/clientTestKit';
import { Ledger } from './index';

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

describe('the Ledger', () => {
  it('before the first tally: the treasury, what the steward expects in a few lines, and every row behind Details', () => {
    render(<Ledger state={state()} onClose={() => {}} />);
    const treasury = Math.floor(state().factions[state().player.factionId]?.treasury ?? 0);
    expect(screen.getByTestId('ledger-treasury').textContent).toContain(`${treasury.toLocaleString('en')} silver`);
    expect(screen.getByTestId('ledger-in').textContent).toMatch(/Coming in this month/);
    expect(screen.getByTestId('ledger-out').textContent).toMatch(/Going out this month/);
    const lines = screen.getByTestId('ledger').querySelectorAll('.lg-line');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(screen.getByTestId('ledger-group-wages').textContent).toMatch(/Wages for your men/);
    expect(screen.getByTestId('ledger-net').textContent).toMatch(/This month (you stand to|should)/);
    expect(screen.getByTestId('ledger-details-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('ledger-table').textContent).toMatch(/Wages/);
  });

  it('after a month: what came in and went out last month', () => {
    const s = useGame.getState().session as unknown as GameSession;
    act(() => {
      for (let i = 0; i < 80 && !s.getState().economy?.lastReport; i++) {
        const st = s.getState();
        if (st.pending) {
          const answer = headlessCommand(st);
          if ('error' in answer) throw new Error(answer.error);
          s.dispatch(answer.command);
        } else s.advance(24 * 2);
      }
    });
    expect(state().economy?.lastReport).toBeTruthy();
    render(<Ledger state={state()} onClose={() => {}} />);
    expect(screen.getByTestId('ledger-in').textContent).toMatch(/Came in last month/);
    expect(screen.getByTestId('ledger-net').textContent).toMatch(/last month/);
  });
});
