// @vitest-environment jsdom
/**
 * The arrival scene against the full module registry: sail to the nearest foreign settlement, the cue
 * ("Land!") holds the choices back, then the scene shows the place by tier with its options (the old
 * Arrival Card's test ids), Enter opens the visit scene (market, mead-hall, back to the ships). Also the
 * option planning and every tier's sample scene.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { GameState, PendingDecision, SettlementId } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import type { ArrivalChoice, DecisionOption } from '@sim/modules/settlements/types';
import { useGame } from '../../app/gameStore';
import { manifestEntry } from '../../assets/index';
import { buildRegistry } from '../../app/screenRegistry';
import { DecisionHost } from '../../shell/DecisionHost';
import { resetClientState } from '../../testing/clientTestKit';
import { galleryVariant, SCENE_VARIANTS, SceneVariant } from '../encounterScene/gallery';
import * as settlement from '../settlement/index';
import { SettlementHub } from '../settlement/hub';
import * as arrivalScene from './index';
import { arrivalAssetId, arrivalView, isScarred, LAND_ARRIVAL, planArrival, roundPop } from './model';

const registry = buildRegistry({ settlement, arrivalScene });

function state(): GameState {
  return useGame.getState().state as GameState;
}

function nearestTarget(st: GameState): SettlementId {
  const home = st.settlements[st.player.capitalId];
  const d2 = (x: number, y: number) => (x - (home?.mapPos.x ?? 0)) ** 2 + (y - (home?.mapPos.y ?? 0)) ** 2;
  return Object.values(st.settlements)
    .filter((s) => s.coastal && s.factionId !== st.player.factionId)
    .sort((a, b) => d2(a.mapPos.x, a.mapPos.y) - d2(b.mapPos.x, b.mapPos.y))[0]?.id as SettlementId;
}

const opt = (id: ArrivalChoice, available = true): DecisionOption<ArrivalChoice> => ({ id, available, ...(available ? {} : { reasonKey: 'settlements.reason.atWar' }) });

afterEach(() => cleanup());

describe('planning the options', () => {
  it('keeps three open options and Sail on in view, everything else behind More', () => {
    const { inView, more } = planArrival(['enter', 'parley', 'trade', 'raid', 'assault', 'besiege', 'leave'].map((id) => opt(id as ArrivalChoice, id !== 'besiege')));
    expect(inView.map((o) => o.id)).toEqual(['enter', 'raid', 'assault', 'leave']);
    expect(more.map((o) => o.id)).toEqual(['trade', 'parley', 'besiege']);
  });

  it('at war: enter and trade are closed, parley takes their place', () => {
    const { inView, more } = planArrival([opt('enter', false), opt('parley'), opt('trade', false), opt('raid'), opt('assault'), opt('besiege', false), opt('leave')]);
    expect(inView.map((o) => o.id)).toEqual(['parley', 'raid', 'assault', 'leave']);
    expect(more.every((o) => !o.available)).toBe(true);
  });

  it('rounds the head-count like a traveller', () => {
    expect(roundPop(37)).toBe(40);
    expect(roundPop(1437)).toBe(1400);
  });

  it('picks the land’s own painting for the lands that have one, the kind’s painting in the north', () => {
    const at = (tier: string, culture: string, overland = false, scarred = false) => arrivalAssetId({ tier, culture, overland, scarred });
    expect(at('town', 'albric')).toBe('settlements.scene.arrival.town.west');
    expect(at('city', 'cael')).toBe('settlements.scene.arrival.town.west');
    expect(at('village', 'corvani')).toBe('settlements.scene.arrival.city.south');
    expect(at('capital', 'velkar')).toBe('settlements.scene.arrival.fortress.east');
    expect(at('emporium', 'saraleonese')).toBe('settlements.scene.arrival.town.sun');
    expect(at('hamlet', 'kurgai')).toBe('settlements.scene.arrival.village.steppe');
    for (const culture of ['skarn', 'hvarn', 'eyjar', 'isafolder', 'rime']) expect(at('town', culture)).toBe('settlements.scene.arrival.town');
    // Overland, raided and cloister arrivals keep their own paintings in every land.
    expect(at('city', 'corvani', true)).toBe('settlements.scene.overland');
    expect(at('city', 'corvani', false, true)).toBe('settlements.scene.arrival.raided');
    expect(at('cloister', 'albric')).toBe('settlements.scene.arrival.cloister');
    // Every id it can name is in the manifest.
    for (const id of Object.values(LAND_ARRIVAL)) expect(manifestEntry(id)?.kind).toBe('image');
  });

  it('paints every tier from the gallery with the Arrival Card test ids', () => {
    for (const name of SCENE_VARIANTS.filter((n) => n.startsWith('arrival-'))) {
      const v = galleryVariant(name);
      const { unmount } = render(<SceneVariant name={name} cue={false} />);
      const card = screen.getByTestId('arrival-card');
      if (v?.kind === 'arrival') expect(card.getAttribute('data-tier')).toBe(v.view.settlement.tier);
      expect(screen.getByTestId('choose-leave')).toBeTruthy();
      expect(screen.getByTestId('option-leave')).toBeTruthy();
      unmount();
    }
  });
});

describe('arriving at a settlement', () => {
  beforeEach(() => {
    resetClientState();
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'scene-arrival-1' })));
  });
  afterEach(() => act(() => useGame.getState().quit()));

  function sailToArrival(): void {
    act(() => void useGame.getState().dispatch({ type: 'launchExpedition', ...suggestPlan(state(), getContent(), 30) }));
    act(() => void useGame.getState().dispatch({ type: 'setRoute', to: { settlementId: nearestTarget(state()) } }));
    for (let d = 0; d < 30 && !state().pending; d++) act(() => void useGame.getState().advanceHours(24));
    expect(state().pending?.kind).toBe('arrival');
  }

  it('cues, then shows the place, then Enter opens the visit scene', () => {
    sailToArrival();
    expect(registry.forPending('arrival')?.id).toBe('arrivalScene');
    const host = render(<DecisionHost registry={registry} />);
    expect(screen.getByTestId('pending-arrival')).toBeTruthy();
    expect(screen.getByTestId('scene-cue').textContent).toMatch(/Land!|Rooftops|Home waters/);
    expect(screen.queryByTestId('arrival-card')).toBeNull();
    fireEvent.click(screen.getByTestId('scene-cue'));
    const card = screen.getByTestId('arrival-card');
    const s = state().settlements[(state().pending?.payload as { settlementId: SettlementId }).settlementId];
    expect(card.textContent).toContain(s?.name ?? '?');
    expect((screen.getByTestId('choose-besiege') as HTMLButtonElement).disabled).toBe(true);
    act(() => fireEvent.click(screen.getByTestId('choose-enter')));
    expect(state().settlementsState?.inside).toBeDefined();
    host.unmount();

    const hub = render(<SettlementHub state={state()} />);
    expect(screen.getByTestId('settlement-hub')).toBeTruthy();
    expect(screen.getByTestId('visit-picture')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /mead-hall/i }));
    expect(screen.getByTestId('visit-panel-meadHall')).toBeTruthy();
    act(() => fireEvent.click(screen.getByTestId('tavern-anyNews')));
    fireEvent.click(screen.getByTestId('visit-close'));
    expect(screen.queryByTestId('visit-panel-meadHall')).toBeNull();
    act(() => fireEvent.click(screen.getByTestId('hub-leave')));
    expect(state().settlementsState?.inside).toBeUndefined();
    hub.unmount();
  });

  it('reads the place from the state, and falls back to the generic modal for an unknown one', () => {
    sailToArrival();
    const pending = state().pending as PendingDecision;
    const v = arrivalView(state(), pending);
    expect(v?.picture.view).toBe('sea');
    expect(v?.assetId).toMatch(/^settlements\.scene\.arrival\./);
    expect(isScarred(state(), v!.settlement)).toBe(false);
    expect(arrivalView(state(), { ...pending, payload: { ...(pending.payload as object), settlementId: 'set_nowhere' } } as PendingDecision)).toBeNull();
  });
});
