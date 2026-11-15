// @vitest-environment jsdom
/**
 * The home Mead-hall against the full module registry: the hall's four big choices at home (news, travellers'
 * talk, a round, sellswords) answered in the result area, the latest news beside them, sellswords as cards with
 * the reason one cannot be hired, and what travellers told (Other places).
 */
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { hireIssues, lieutenantCapacity, sellswordOffers } from '@sim/modules/military/lieutenants';
import { useGame } from '../../app/gameStore';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import { tavernBlock, tavernCost } from '../settlement/meadHall';
import { HomeMeadHall, screen as descriptor } from './index';

function state(): GameState {
  return useGame.getState().state as GameState;
}

beforeEach(() => {
  resetClientState();
  act(() => useGame.getState().attach(GameSession.newGame({ seed: 'hall-1' })));
});
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

function Live(): ReactElement | null {
  const st = useGame((s) => s.state);
  return st ? <HomeMeadHall state={st} onClose={() => {}} /> : null;
}

describe('the home Mead-hall', () => {
  it('is the building.meadHall route', () => {
    expect(descriptor.route).toBe('building.meadHall');
    expect(descriptor.layout).toBe('overlay');
  });

  it('asks for news, talks to travellers and buys a round at home', () => {
    const cap = state().player.capitalId;
    expect(tavernBlock(state(), getContent(), cap, 'anyNews')).toBeUndefined();
    render(<Live />);
    // At most four big choices; the drink is not offered.
    expect(screen.getByTestId('meadhall').querySelectorAll('.choice').length).toBe(4);
    expect(screen.queryByTestId('tavern-drink')).toBeNull();
    expect(screen.queryByTestId('tavern-result')).toBeNull();
    act(() => fireEvent.click(screen.getByTestId('tavern-anyNews')));
    expect(screen.getByTestId('tavern-result').textContent).toMatch(/keeper/i);
    expect(screen.getByTestId('keeper-news')).toBeTruthy();
    act(() => fireEvent.click(screen.getByTestId('tavern-travellers')));
    expect(screen.getByTestId('tavern-result').textContent).toMatch(/travellers/i);
    const renown = state().player.house.renown;
    const treasury = state().factions[state().player.factionId]?.treasury ?? 0;
    act(() => fireEvent.click(screen.getByTestId('tavern-buyRound')));
    expect(state().factions[state().player.factionId]?.treasury).toBe(treasury - tavernCost(state(), getContent(), cap, 'buyRound'));
    expect(state().player.house.renown).toBeGreaterThan(renown);
    expect(screen.getByTestId('tavern-result').textContent).toMatch(/Renown/);
    // What the travellers said shows under Other places.
    fireEvent.click(screen.getByTestId('hall-places-toggle'));
    expect(screen.getByTestId('intel-panel').querySelectorAll('[data-testid^="intel-set_"]').length).toBeGreaterThan(0);
    expect(screen.getByTestId('maps-empty')).toBeTruthy();
  });

  it('shows the latest news beside the choices', () => {
    render(<Live />);
    expect(screen.getByTestId('news-log')).toBeTruthy();
    expect(screen.getByTestId('news-empty').textContent).toMatch(/No news/);
  });

  it('lists sellswords as cards and says why one cannot be hired', () => {
    const cap = state().player.capitalId;
    const offers = sellswordOffers(state(), getContent(), cap);
    render(<Live />);
    expect(screen.queryByTestId('sellswords')).toBeNull();
    fireEvent.click(screen.getByTestId('hall-sellswords'));
    if (offers.length === 0) {
      expect(screen.getByTestId('sellswords-empty')).toBeTruthy();
      return;
    }
    const issues = hireIssues(state(), getContent(), { settlementId: cap, offer: 0 }).issues;
    const hire = screen.getByTestId('hire-0') as HTMLButtonElement;
    expect(hire.disabled).toBe(issues.length > 0);
    const full = lieutenantCapacity(state(), getContent(), state().player.factionId).free <= 0;
    // A full hall is said once, above the cards; any other reason is on the card.
    if (full) expect(screen.getByTestId('sellswords-room').textContent).toMatch(/no room/);
    if (issues.some((i) => i !== 'capacity')) expect(screen.getByTestId('hire-0-why').textContent?.length).toBeGreaterThan(5);
    if (issues.length === 0) {
      act(() => fireEvent.click(hire));
      expect(sellswordOffers(state(), getContent(), cap)[0]?.hired).toBe(true);
    }
  });

  it('every string it asked for exists', () => {
    expect(missingKeysSeen().filter((k) => /^(economy|settlements|news|intel|military)\./.test(k))).toEqual([]);
  });
});
