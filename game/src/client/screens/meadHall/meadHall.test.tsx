// @vitest-environment jsdom
/**
 * The home Mead-hall against the full module registry, as a room with three people: the Hall-keeper (news and a
 * round, the latest news, other places), the Travellers (what is said of the ports nearby) and the Sellswords
 * (fighters for hire as cards with the reason one cannot be hired); deep links open a person's panel.
 */
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { hireIssues, lieutenantCapacity, sellswordOffers } from '@sim/modules/military/lieutenants';
import { App } from '../../app/App';
import { useGame } from '../../app/gameStore';
import { useNavigation } from '../../app/navigation';
import { buildRegistry } from '../../app/screenRegistry';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import * as hub from '../hub/index';
import { tavernBlock, tavernCost } from '../settlement/meadHall';
import * as meadHall from './index';
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
  it('is the building.meadHall route, a room with the Hall-keeper, the Travellers and the Sellswords', () => {
    expect(descriptor.route).toBe('building.meadHall');
    expect(descriptor.layout).toBe('overlay');
    render(<Live />);
    expect(screen.getByTestId('interior-meadHall')).toBeTruthy();
    expect(screen.getByTestId('home-meadhall')).toBeTruthy();
    for (const p of ['keeper', 'travellers', 'sellswords']) expect(screen.getByTestId(`interior-person-${p}`).tagName).toBe('BUTTON');
    expect(screen.queryByTestId('interior-panel')).toBeNull();
  });

  it('the keeper gives news and sells a round; the travellers talk of other places', () => {
    const cap = state().player.capitalId;
    expect(tavernBlock(state(), getContent(), cap, 'anyNews')).toBeUndefined();
    render(<Live />);
    fireEvent.click(screen.getByTestId('interior-person-keeper'));
    // His two choices; the drink is not offered.
    expect(screen.getByTestId('meadhall').querySelectorAll('.choice').length).toBe(2);
    expect(screen.queryByTestId('tavern-drink')).toBeNull();
    expect(screen.queryByTestId('tavern-travellers')).toBeNull();
    expect(screen.queryByTestId('tavern-result')).toBeNull();
    act(() => fireEvent.click(screen.getByTestId('tavern-anyNews')));
    expect(screen.getByTestId('tavern-result').textContent).toMatch(/keeper/i);
    expect(screen.getByTestId('keeper-news')).toBeTruthy();
    const renown = state().player.house.renown;
    const treasury = state().factions[state().player.factionId]?.treasury ?? 0;
    act(() => fireEvent.click(screen.getByTestId('tavern-buyRound')));
    expect(state().factions[state().player.factionId]?.treasury).toBe(treasury - tavernCost(state(), getContent(), cap, 'buyRound'));
    expect(state().player.house.renown).toBeGreaterThan(renown);
    expect(screen.getByTestId('tavern-result').textContent).toMatch(/Renown/);

    fireEvent.click(screen.getByTestId('interior-person-travellers'));
    expect(screen.getByTestId('meadhall').querySelectorAll('.choice').length).toBe(1);
    act(() => fireEvent.click(screen.getByTestId('tavern-travellers')));
    expect(screen.getByTestId('tavern-result').textContent).toMatch(/travellers/i);
    // What the travellers said shows under Other places, with them and with the keeper.
    fireEvent.click(screen.getByTestId('hall-places-toggle'));
    expect(screen.getByTestId('intel-panel').querySelectorAll('[data-testid^="intel-set_"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('interior-person-keeper'));
    fireEvent.click(screen.getByTestId('hall-places-toggle'));
    expect(screen.getByTestId('intel-panel').querySelectorAll('[data-testid^="intel-set_"]').length).toBeGreaterThan(0);
    expect(screen.getByTestId('maps-empty')).toBeTruthy();
  });

  it('the keeper keeps the latest news', () => {
    render(<HomeMeadHall state={state()} initialPerson="keeper" onClose={() => {}} />);
    expect(screen.getByTestId('news-log')).toBeTruthy();
    expect(screen.getByTestId('news-empty').textContent).toMatch(/No news/);
  });

  it('the sellswords show themselves as cards and say why one cannot be hired', () => {
    const cap = state().player.capitalId;
    const offers = sellswordOffers(state(), getContent(), cap);
    render(<Live />);
    expect(screen.queryByTestId('sellswords')).toBeNull();
    fireEvent.click(screen.getByTestId('interior-person-sellswords'));
    expect(screen.getByTestId('meadhall-sellswords')).toBeTruthy();
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

  it('deep links: a person param opens that panel', () => {
    render(<App registry={buildRegistry({ hub, meadHall })} />);
    act(() => useNavigation.getState().open('building.meadHall', { person: 'sellswords' }));
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('sellswords');
    fireEvent.click(screen.getByTestId('interior-person-travellers'));
    expect(useNavigation.getState().stack.at(-1)?.params).toEqual({ person: 'travellers' });
  });

  it('every string it asked for exists', () => {
    render(<Live />);
    for (const p of ['keeper', 'travellers', 'sellswords']) fireEvent.click(screen.getByTestId(`interior-person-${p}`));
    expect(missingKeysSeen().filter((k) => /^(hub|economy|settlements|news|intel|military)\./.test(k))).toEqual([]);
  });
});
