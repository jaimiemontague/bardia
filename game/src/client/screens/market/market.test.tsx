// @vitest-environment jsdom
/**
 * The home Market against the full module registry: one good at a time through the two-sided slider between
 * the house storehouse and the town's market (the treasury pays and is paid; every limit is the economy's own
 * quote), "Sell all loot" and "Buy provisions for the next voyage" with their confirm steps, where else a good
 * sells best, and trade routes (set and end one with a knarr).
 */
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { createShip } from '@sim/core/factory';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { deserialize, serialize } from '@sim/index';
import { nextVoyageRations } from './quickDeals';
import { useGame } from '../../app/gameStore';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import { knownMarkets, maxBuy, priceSignal } from '../settlement/knownMarkets';
import { HomeMarket, screen as descriptor } from './index';
import { freeKnarrs } from './routes';

function state(): GameState {
  return useGame.getState().state as GameState;
}

/** A session whose house owns an idle knarr in the capital's harbour. */
function withKnarr(seed: string): ReturnType<typeof GameSession.newGame> {
  const env = deserialize(GameSession.newGame({ seed }).save());
  const st = structuredClone(env.state);
  const ship = createShip(st, { content: getContent() }, { type: 'knarr', ownerId: st.player.factionId });
  ship.dockedAt = st.player.capitalId;
  // Make sure one foreign harbour with a market is known (visited), so a route has somewhere to go.
  const home = st.settlements[st.player.capitalId]!;
  const port = Object.values(st.settlements)
    .filter((s) => s.coastal && s.factionId !== st.player.factionId && st.markets[s.id] !== undefined && s.tier !== 'hamlet')
    .sort((a, b) => (a.mapPos.x - home.mapPos.x) ** 2 + (a.mapPos.y - home.mapPos.y) ** 2 - ((b.mapPos.x - home.mapPos.x) ** 2 + (b.mapPos.y - home.mapPos.y) ** 2))[0]!;
  st.knowledge!.visited[port.id] = 0;
  return GameSession.load(serialize(st));
}

/** A session whose storehouse (and, optionally, treasury) are set as given. */
function withStores(seed: string, goods: Record<string, number>, rations?: number, treasury?: number): ReturnType<typeof GameSession.newGame> {
  const st = structuredClone(deserialize(GameSession.newGame({ seed }).save()).state);
  st.storehouse = { goods: { ...goods }, rations: rations ?? st.storehouse?.rations ?? 0 };
  if (treasury !== undefined) st.factions[st.player.factionId]!.treasury = treasury;
  return GameSession.load(serialize(st));
}

const treasury = () => state().factions[state().player.factionId]?.treasury ?? 0;

function Live(): ReactElement | null {
  const st = useGame((s) => s.state);
  return st ? <HomeMarket state={st} onClose={() => {}} /> : null;
}

beforeEach(() => resetClientState());
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('the home Market', () => {
  it('is the building.market route', () => {
    expect(descriptor.route).toBe('building.market');
    expect(descriptor.layout).toBe('overlay');
  });

  it('buys into the storehouse and sells from it with the slider, the treasury paying and paid', () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'market-1' })));
    let closed = false;
    render(<Live />);
    expect(screen.getByTestId('home-stores').textContent).toMatch(/Storehouse/);
    expect(screen.queryByTestId('market-deal')).toBeNull();
    fireEvent.click(screen.getByTestId('market-row-salt'));
    expect(screen.getByTestId('market-deal').getAttribute('data-good')).toBe('salt');
    expect(screen.getByTestId('market-quote').getAttribute('data-side')).toBe('none');
    expect((screen.getByTestId('market-strike') as HTMLButtonElement).disabled).toBe(true);
    // Ten steps toward your own pile buy exactly one ton, whatever the market's stock.
    const handle = screen.getByTestId('market-slider-handle');
    for (let i = 0; i < 10; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(screen.getByTestId('market-quote').getAttribute('data-side')).toBe('buy');
    expect(screen.getByTestId('market-quote').textContent).toMatch(/Buy 1 t for [\d,]+ silver/);
    // A step back and forth lands on the same ton.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(screen.getByTestId('market-quote').textContent).toMatch(/Buy 1 t /);
    const before = treasury();
    act(() => fireEvent.click(screen.getByTestId('market-strike')));
    expect(state().storehouse?.goods.salt).toBe(1);
    expect(treasury()).toBeLessThan(before);
    expect(screen.getByTestId('held-salt').textContent).toMatch(/^1/);
    expect(screen.getByTestId('market-done').textContent).toMatch(/Bought 1 t/);
    // Sell it all back with the "Sell all" mark.
    const mid = treasury();
    fireEvent.click(screen.getByTestId('market-slider-mark-sellall'));
    expect(screen.getByTestId('market-quote').getAttribute('data-side')).toBe('sell');
    act(() => fireEvent.click(screen.getByTestId('market-strike')));
    expect(state().storehouse?.goods.salt).toBeUndefined();
    expect(treasury()).toBeGreaterThan(mid);
    cleanup();
    render(<HomeMarket state={state()} onClose={() => (closed = true)} />);
    fireEvent.click(screen.getByTestId('market-close'));
    expect(closed).toBe(true);
  });

  it('stops buying at what the treasury can pay, and says why', () => {
    act(() => useGame.getState().attach(withStores('market-1', {}, undefined, 50)));
    const limit = maxBuy(state(), getContent(), state().player.capitalId, 'iron', { kind: 'storehouse' });
    expect(limit.limit).toBe('silver');
    expect(limit.tons).toBeGreaterThan(0);
    render(<Live />);
    fireEvent.click(screen.getByTestId('market-row-iron'));
    fireEvent.click(screen.getByTestId('market-slider-mark-buymost'));
    expect(screen.getByTestId('market-slider-limit').textContent).toMatch(/silver/);
    expect(screen.getByTestId('market-quote').getAttribute('data-side')).toBe('buy');
    act(() => fireEvent.click(screen.getByTestId('market-strike')));
    expect(state().storehouse?.goods.iron).toBeCloseTo(limit.tons, 3);
    expect(treasury()).toBeGreaterThanOrEqual(0);
    expect(treasury()).toBeLessThan(50);
  });

  it('sells all loot after showing the total', () => {
    act(() => useGame.getState().attach(withStores('market-2', { furs: 2, amber: 1 })));
    render(<Live />);
    const sellAll = screen.getByTestId('sell-all') as HTMLButtonElement;
    expect(sellAll.disabled).toBe(false);
    fireEvent.click(sellAll);
    // The confirmation stands where the deal panel would.
    expect(screen.getByTestId('sell-all-panel')).toBeTruthy();
    const total = screen.getByTestId('sell-all-total').textContent ?? '';
    const silver = Number(total.replace(/[^0-9]/g, ''));
    expect(silver).toBeGreaterThan(0);
    const before = treasury();
    const rations = state().storehouse?.rations;
    act(() => fireEvent.click(screen.getByTestId('sell-all-confirm')));
    expect(treasury()).toBe(before + silver);
    expect(state().storehouse?.goods).toEqual({});
    expect(state().storehouse?.rations).toBe(rations);
    expect(screen.getByTestId('quick-result').textContent).toMatch(/treasury/);
    expect((screen.getByTestId('sell-all') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('sell-all-why').textContent).toMatch(/no loot/i);
  });

  it('buys provisions for the next voyage', () => {
    act(() => useGame.getState().attach(withStores('market-1', {}, 0)));
    const need = nextVoyageRations(state(), getContent());
    expect(need).toBeGreaterThan(0);
    render(<Live />);
    fireEvent.click(screen.getByTestId('buy-provisions'));
    act(() => fireEvent.click(screen.getByTestId('buy-provisions-confirm')));
    expect(state().storehouse?.rations ?? 0).toBeGreaterThanOrEqual(need);
    expect((screen.getByTestId('buy-provisions') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('buy-provisions-why').textContent).toMatch(/holds/);
  });

  it('says where else the chosen good sells best', () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'market-1' })));
    const known = knownMarkets(state(), getContent(), state().player.capitalId);
    render(<HomeMarket state={state()} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('market-row-salt'));
    fireEvent.click(screen.getByTestId('market-elsewhere-toggle'));
    if (known.length === 0) expect(screen.getByTestId('known-empty')).toBeTruthy();
    else expect(screen.getByTestId('known-markets').querySelectorAll('p').length).toBe(2);
    expect(priceSignal(getContent(), 'salt', 1)).toBe('cheap');
    expect(priceSignal(getContent(), 'salt', 10_000)).toBe('dear');
  });

  it('says why no route can be opened without a knarr', () => {
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'market-1' })));
    if (freeKnarrs(state(), getContent()).length > 0) return;
    render(<HomeMarket state={state()} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('market-view-routes'));
    expect(screen.getByTestId('routes-empty')).toBeTruthy();
    expect((screen.getByTestId('route-set') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('route-why').textContent).toMatch(/knarr/i);
    fireEvent.click(screen.getByTestId('market-view-goods'));
    expect(screen.getByTestId('market')).toBeTruthy();
  });

  it('sends a knarr on a trade route and ends it', () => {
    act(() => useGame.getState().attach(withKnarr('market-3')));
    expect(freeKnarrs(state(), getContent()).length).toBe(1);
    render(<Live />);
    fireEvent.click(screen.getByTestId('market-view-routes'));
    expect((screen.getByTestId('route-to') as HTMLSelectElement).disabled).toBe(false);
    const set = screen.getByTestId('route-set') as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    expect(screen.getByTestId('route-why').textContent).toMatch(/good/i);
    fireEvent.click(screen.getByTestId('route-out-salt'));
    expect(set.disabled).toBe(false);
    act(() => fireEvent.click(set));
    const routes = Object.values(state().economy?.routes ?? {});
    expect(routes).toHaveLength(1);
    const id = routes[0]!.id;
    act(() => fireEvent.click(screen.getByTestId(`route-clear-${id}`)));
    expect(Object.keys(state().economy?.routes ?? {})).toHaveLength(0);
  });

  it('every string it asked for exists', () => {
    expect(missingKeysSeen().filter((k) => /^(economy|settlements|news|intel)\./.test(k))).toEqual([]);
  });
});
