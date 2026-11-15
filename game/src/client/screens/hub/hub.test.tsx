// @vitest-environment jsdom
/**
 * The Home Hall and its war-side buildings against the full module registry: the layout table, the Counsel
 * and the First Voyage (ice and thaw from the weather module), the hub screen and its hotspots, the Great
 * hall as a room (its three people, the Muster, deep links), the Shipyard, the Smithy's smith, and the planner's
 * "why Launch is disabled".
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { shipOrdersOf } from '@sim/modules/military';
import { App } from '../../app/App';
import { useGame } from '../../app/gameStore';
import { useNavigation } from '../../app/navigation';
import { buildRegistry } from '../../app/screenRegistry';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import { ExpeditionPlanner } from '../expedition/index';
import { harbourIce } from '../expedition/seaIce';
import * as greatHall from '../greatHall/index';
import { GreatHall } from '../greatHall/index';
import { Shipyard } from '../shipyard/index';
import { Smithy } from '../smithy/index';
import { computeCounsel, firstVoyage, nextVoyageStep } from './counsel';
import * as hub from './index';
import { VillageScene } from './VillageScene';
import { VIEW_H, VIEW_W, VILLAGE, spotTier } from './village';
import { ExpeditionHud, hudNextStep } from '../expedition/hud';
import { suggestPlan } from '@sim/modules/expeditions/plan';

/** A seed whose capital lies on iced northern waters at the start (1 Icebreak), and one on open water. */
const ICED_SEED = 'a';
const OPEN_SEED = 'slice-1';
const OWN_PREFIXES = ['hub.', 'military.ui.', 'expeditions.planner.', 'expeditions.hud.'];

function state(): GameState {
  return useGame.getState().state as GameState;
}

function start(seed: string): void {
  act(() => useGame.getState().attach(GameSession.newGame({ seed })));
}

beforeEach(() => {
  resetClientState();
});
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('the village layout table', () => {
  it('places all eight buildings and their labels inside the picture, each label on or just above its own building', () => {
    expect(VILLAGE.map((s) => s.id).sort()).toEqual([
      'greatHall',
      'grove',
      'longhouse',
      'market',
      'meadHall',
      'seer',
      'shipyard',
      'smithy',
    ]);
    for (const s of VILLAGE) {
      expect(s.labelX).toBeGreaterThan(0);
      expect(s.labelX).toBeLessThan(VIEW_W);
      expect(s.labelY).toBeGreaterThan(0);
      expect(s.labelY).toBeLessThan(VIEW_H);
      // Horizontally over the building, vertically between just above its roof and its ground line.
      expect(Math.abs(s.labelX - s.x)).toBeLessThanOrEqual(s.w / 2);
      expect(s.labelY).toBeGreaterThanOrEqual(s.y - s.h - 50);
      expect(s.labelY).toBeLessThanOrEqual(s.y);
    }
  });
});

describe('the village picture', () => {
  it('draws a tier-0 building as an empty plot, the longhouse always standing, and ice on the water', () => {
    expect(spotTier({ market: 0, hall: 2 }, VILLAGE.find((s) => s.id === 'market') ?? VILLAGE[0]!)).toBe(0);
    expect(spotTier({ hall: 2 }, VILLAGE.find((s) => s.id === 'greatHall') ?? VILLAGE[0]!)).toBe(2);
    expect(spotTier({}, VILLAGE.find((s) => s.id === 'longhouse') ?? VILLAGE[0]!)).toBe(1);
    const tiers = {
      greatHall: 2,
      longhouse: 1,
      meadHall: 1,
      smithy: 1,
      shipyard: 1,
      market: 0,
      seer: 1,
      grove: 1,
    };
    const { container } = render(
      <VillageScene
        model={{ tiers, ships: [{ id: 'shp_1', type: 'drakkar' }], building: true, fortTier: 1, iced: true }}
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector('[data-building-id="market"]')?.getAttribute('data-tier')).toBe('0');
    expect(screen.getByTestId('hub-ice')).toBeTruthy();
    expect(screen.getByTestId('hub-ships').getAttribute('data-count')).toBe('1');
  });
});

describe('the Counsel and the First Voyage', () => {
  it('on iced home waters: says so first, offers the wait to the thaw, and the wait opens the sea', () => {
    start(ICED_SEED);
    const content = getContent();
    const ice = harbourIce(state());
    expect(ice.iced).toBe(true);
    expect(ice.daysToThaw).toBe(30);
    const lines = computeCounsel(state(), content, { unreadImportant: 0 });
    expect(lines[0]?.id).toBe('iced');
    expect(lines[0]?.action).toEqual({
      kind: 'wait',
      days: 30,
      labelKey: 'hub.counsel.waitThaw',
      vars: { days: 30 },
    });
    expect(lines.some((l) => l.id === 'plan')).toBe(false);
    const steps = firstVoyage(state());
    expect(steps[nextVoyageStep(steps)]?.id).toBe('thaw');

    act(() => void useGame.getState().dispatch({ type: 'wait', days: 30 }));
    while (state().pending)
      act(
        () =>
          void useGame.getState().dispatch({ type: 'acknowledge', pendingId: state().pending?.id as never }),
      );
    expect(harbourIce(state()).iced).toBe(false);
    const after = computeCounsel(state(), content, { unreadImportant: 2 });
    expect(after[0]?.id).toBe('unread');
    expect(
      after.some(
        (l) => l.id === 'plan' && l.action?.kind === 'route' && l.action.route === 'expeditionPlanner',
      ),
    ).toBe(true);
    expect(firstVoyage(state())[0]?.done).toBe(true);
  });

  it('on open water: plan an expedition, idle silver, the calendar', () => {
    start(OPEN_SEED);
    const lines = computeCounsel(state(), getContent(), { unreadImportant: 0 });
    const ids = lines.map((l) => l.id);
    expect(ids[0]).toBe('plan');
    expect(ids).toContain('idleSilver');
    expect(ids.filter((id) => id.startsWith('annual-'))).toHaveLength(3);
    const steps = firstVoyage(state());
    expect(steps.map((s) => s.id)).toEqual(['thaw', 'muster', 'plan', 'sail', 'deed', 'home']);
    expect(steps[0]?.done).toBe(true);
    expect(steps[2]?.done).toBe(false);
  });
});

describe('the hub screen', () => {
  it('replaces the placeholder, shows the panorama with eight hotspots and opens a building route', () => {
    start(ICED_SEED);
    const registry = buildRegistry({ hub });
    expect(registry.forMode('hub')?.id).toBe('hub');
    render(<App registry={registry} />);
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.getByTestId('hub-capital')).toBeTruthy();
    for (const s of VILLAGE) expect(screen.getByTestId(`hotspot-${s.id}`).tagName).toBe('BUTTON');
    // The player's two ships lie on the strand.
    expect(screen.getByTestId('hub-ships').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('hub-sea-state').textContent).toMatch(/Iced in/);
    fireEvent.click(screen.getByTestId('hotspot-smithy'));
    expect(useNavigation.getState().stack.at(-1)?.id).toBe('building.smithy');
    // The Counsel's thaw button waits out the ice.
    fireEvent.click(screen.getByTestId('counsel-iced'));
    expect(state().time.hour).toBeGreaterThan(0);
  });
});

describe('the Great hall', () => {
  it('is a room: the Hirdmaster summarises the realm and opens the planner, the Steward the ledger, the Lawspeaker affairs', () => {
    start(OPEN_SEED);
    render(<GreatHall state={state()} onClose={() => {}} />);
    expect(screen.getByTestId('interior-greatHall')).toBeTruthy();
    expect(screen.getByTestId('great-hall')).toBeTruthy();
    expect(screen.queryByTestId('interior-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('interior-person-hirdmaster'));
    expect(screen.getByTestId('great-hall-realm').textContent).toMatch(/The treasury holds 2,000 silver/);
    // Five lines in words; the rest behind Details.
    expect(screen.getByTestId('great-hall-details-toggle').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId('hall-planner'));
    expect(useNavigation.getState().stack.at(-1)?.id).toBe('expeditionPlanner');
    fireEvent.click(screen.getByTestId('interior-person-steward'));
    expect(screen.getByTestId('great-hall-steward').textContent).toMatch(/2,000 silver/);
    expect(screen.getByTestId('steward-month').textContent).toMatch(/This month/);
    expect(screen.getByTestId('interior-panel').querySelectorAll('.btn-primary')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('hall-ledger'));
    expect(useNavigation.getState().stack.at(-1)?.id).toBe('ledger');
    fireEvent.click(screen.getByTestId('interior-person-lawspeaker'));
    fireEvent.click(screen.getByTestId('hall-affairs'));
    expect(useNavigation.getState().stack.at(-1)?.id).toBe('affairs');
  });

  it('deep links: the muster route and the Counsel open the Hirdmaster on the muster, a person param opens that panel', () => {
    start(OPEN_SEED);
    const lines = computeCounsel(state(), getContent(), { unreadImportant: 0 });
    const steps = firstVoyage(state());
    expect(steps.find((s) => s.id === 'muster')?.action).toEqual({ kind: 'route', route: 'building.greatHall', params: { person: 'hirdmaster', view: 'muster' }, labelKey: 'hub.action.muster' });
    for (const l of lines) if (l.action?.kind === 'route') expect(l.action.route).not.toBe('muster');
    render(<App registry={buildRegistry({ hub, greatHall })} />);
    act(() => useNavigation.getState().open('building.greatHall', { person: 'hirdmaster', view: 'muster' }));
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('hirdmaster');
    expect(screen.getByTestId('muster')).toBeTruthy();
    act(() => void useNavigation.getState().back());
    act(() => useNavigation.getState().open('muster'));
    expect(screen.getByTestId('muster')).toBeTruthy();
    act(() => void useNavigation.getState().back());
    act(() => useNavigation.getState().open('building.greatHall', { person: 'steward' }));
    expect(screen.getByTestId('great-hall-steward')).toBeTruthy();
  });

  it('musters men through the military module', () => {
    start(OPEN_SEED);
    const before = state().factions[state().player.factionId]?.treasury ?? 0;
    const view = render(<GreatHall state={state()} initialTab="muster" onClose={() => {}} />);
    const go = screen.getByTestId('muster-go') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    // One decision: the kind (Bondi is chosen first), then the farms against the war-arrow.
    expect(screen.getByTestId('muster-kind-bondi').getAttribute('aria-pressed')).toBe('true');
    const handle = within(screen.getByTestId('muster-bondi')).getByRole('slider');
    const farms = Number(screen.getByTestId('muster-bondi-left').textContent?.replace(/\D/g, ''));
    for (let i = 0; i < 12; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(screen.getByTestId('muster-bondi-right').textContent).toBe('12');
    expect(Number(screen.getByTestId('muster-bondi-left').textContent?.replace(/\D/g, ''))).toBe(farms - 12);
    expect(screen.getByTestId('muster-summary').textContent).toMatch(/12 men for/);
    expect(screen.getByTestId('muster-kind-bondi').textContent).toContain('12');
    expect((screen.getByTestId('muster-go') as HTMLButtonElement).disabled).toBe(false);
    act(() => fireEvent.click(screen.getByTestId('muster-go')));
    expect(state().military?.musters).toHaveLength(1);
    expect(state().factions[state().player.factionId]?.treasury).toBeLessThan(before);
    // The cooldown now blocks a second war-arrow, and the screen says why.
    view.rerender(<GreatHall state={state()} initialTab="muster" onClose={() => {}} />);
    expect(screen.getByTestId('muster-why').textContent).toMatch(/Too soon/);
  });
});

describe('the Shipyard and the Smithy', () => {
  it('lists the fleet on the strand, and the Shipwright orders a ship the yard can build and says why others cannot be built', () => {
    start(OPEN_SEED);
    const view = render(<Shipyard state={state()} initialPerson="strand" onClose={() => {}} />);
    expect(screen.getByTestId('shipyard-fleet').querySelectorAll('tr[data-ship]')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('interior-person-shipwright'));
    const drakkar = screen.getByTestId('shipyard-orders').querySelector('[data-ship-type="drakkar"]');
    expect(drakkar?.textContent).toMatch(/Needs a shipyard of tier 3/);
    act(() => fireEvent.click(screen.getByTestId('order-karvi')));
    expect(shipOrdersOf(state(), state().player.capitalId)).toHaveLength(1);
    view.rerender(<Shipyard state={state()} initialPerson="strand" onClose={() => {}} />);
    expect(screen.getByTestId('shipyard-queue').textContent).toMatch(/ready/);
  });

  it('the Counsel and the checklist send the player to the Shipwright and the Merchant', () => {
    start(OPEN_SEED);
    const steps = firstVoyage(state());
    expect(steps.find((s) => s.id === 'home')?.action).toEqual({ kind: 'route', route: 'building.market', params: { person: 'merchant' }, labelKey: 'hub.action.market' });
    const lines = computeCounsel(state(), getContent(), { unreadImportant: 0 });
    for (const l of lines) {
      if (l.action?.kind === 'route' && l.action.route === 'building.shipyard') expect(l.action.params).toEqual({ person: 'shipwright' });
      if (l.action?.kind === 'route' && l.action.route === 'building.market') expect(l.action.params).toEqual({ person: 'merchant' });
    }
    // An order on the slipways is one such line.
    act(() => void useGame.getState().dispatch({ type: 'queueShip', holdingId: state().player.capitalId, shipType: 'karvi' }));
    const building = computeCounsel(state(), getContent(), { unreadImportant: 0 }).find((l) => l.id === 'shipBuilding');
    expect(building?.action).toEqual({ kind: 'route', route: 'building.shipyard', params: { person: 'shipwright' }, labelKey: 'hub.action.shipyard' });
  });

  it('shows the armoury and the next tier with its cost or the reason it is out of reach', () => {
    start(OPEN_SEED);
    render(<Smithy state={state()} initialPerson="smith" onClose={() => {}} />);
    expect(screen.getByTestId('smithy-armour').textContent).toMatch(/Hide and wood/);
    expect(screen.getByTestId('smithy-tiers').querySelectorAll('tbody tr').length).toBeGreaterThan(4);
    const button = screen.getByTestId('upgrade-weapons') as HTMLButtonElement;
    if (button.disabled)
      expect(screen.getByTestId('upgrade-weapons-why').textContent?.length).toBeGreaterThan(0);
    else {
      act(() => fireEvent.click(button));
      expect(state().factions[state().player.factionId]?.weaponTier).toBe(2);
    }
  });
});

describe('the planner and the HUD', () => {
  it('disables Launch while the harbour is iced, says why, and waits for the thaw in one click', () => {
    start(ICED_SEED);
    const view = render(<ExpeditionPlanner state={state()} onClose={() => {}} />);
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('planner-iced').textContent).toMatch(/Ice locks the harbour/);
    act(() => fireEvent.click(screen.getByTestId('planner-wait-thaw')));
    while (state().pending)
      act(
        () =>
          void useGame.getState().dispatch({ type: 'acknowledge', pendingId: state().pending?.id as never }),
      );
    view.rerender(<ExpeditionPlanner state={state()} onClose={() => {}} />);
    expect(screen.queryByTestId('planner-iced')).toBeNull();
    expect((screen.getByTestId('planner-launch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the HUD says what to do next at sea', () => {
    expect(
      hudNextStep({
        ashore: false,
        homeward: false,
        sailing: false,
        iced: false,
        foodDays: 20,
        cargoTons: 0,
      }),
    ).toBe('pick');
    expect(
      hudNextStep({ ashore: false, homeward: false, sailing: true, iced: false, foodDays: 20, cargoTons: 0 }),
    ).toBe('sailing');
    expect(
      hudNextStep({ ashore: false, homeward: false, sailing: false, iced: true, foodDays: 20, cargoTons: 0 }),
    ).toBe('iced');
    expect(
      hudNextStep({
        ashore: false,
        homeward: false,
        sailing: false,
        iced: false,
        foodDays: 20,
        cargoTons: 3,
      }),
    ).toBe('after');
    start(OPEN_SEED);
    act(
      () =>
        void useGame
          .getState()
          .dispatch({ type: 'launchExpedition', ...suggestPlan(state(), getContent(), 30) }),
    );
    render(<ExpeditionHud state={state()} selected={null} />);
    expect(screen.getByTestId('expedition-next').getAttribute('data-step')).toBe('pick');
    expect(screen.getByTestId('expedition-next').textContent).toMatch(/Sail/);
  });

  it('every string these screens asked for exists', () => {
    expect(missingKeysSeen().filter((k) => OWN_PREFIXES.some((p) => k.startsWith(p)))).toEqual([]);
  });
});
