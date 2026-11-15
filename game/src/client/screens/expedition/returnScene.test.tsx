// @vitest-environment jsdom
/**
 * The end of a voyage: which scene a batch of sim events calls for, the watcher on the event bus against the
 * full module registry (launch, sail home, the homecoming opens), and the scene itself (homecoming by sea and
 * on the march, the lost expedition taking its critical alert away).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { SimEvent } from '@sim/core/events';
import type { GameState } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import { useGame } from '../../app/gameStore';
import { useNotifications } from '../../app/notifications';
import { missingKeysSeen } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import { ReturnScene, returnAsset, returnSceneFor, watchExpeditionReturns, type ReturnParams } from './returnScene';

function state(): GameState {
  return useGame.getState().state as GameState;
}

const ev = (type: string, fields: Record<string, unknown>): SimEvent => ({ type, ...fields }) as unknown as SimEvent;

afterEach(() => cleanup());

describe('which scene the events call for', () => {
  const st = { settlements: { set_1: { name: 'Myrhavn' } } } as unknown as GameState;
  const seen = { fleetId: 'flt_7', overland: false };

  it('a homecoming of the player’s fleet, with the goods in tons', () => {
    const p = returnSceneFor([ev('ExpeditionReturned', { fleetId: 'flt_7', atId: 'set_1', silver: 120, goods: { furs: 1.25, iron: 2 }, men: 38 })], st, seen);
    expect(p).toEqual({ kind: 'home', overland: false, place: 'Myrhavn', men: 38, silver: 120, tons: 3.3, cause: '', menLost: 0 });
  });

  it('a loss wins over the homecoming reported in the same batch', () => {
    const p = returnSceneFor(
      [ev('ExpeditionReturned', { fleetId: 'flt_7', atId: 'set_1', silver: 0, goods: {}, men: 0 }), ev('ExpeditionLost', { fleetId: 'flt_7', cause: 'shipsLost', atId: 'set_1', survivors: 9, menLost: 4, silverLost: 50, tonsLost: 2 })],
      st,
      { fleetId: 'flt_7', overland: true },
    );
    expect(p).toMatchObject({ kind: 'lost', overland: true, men: 9, menLost: 4, silver: 50, cause: 'shipsLost' });
  });

  it('ignores other fleets, and everything while no expedition was out', () => {
    expect(returnSceneFor([ev('ExpeditionReturned', { fleetId: 'flt_9', atId: 'set_1', silver: 0, goods: {}, men: 3 })], st, seen)).toBeNull();
    expect(returnSceneFor([ev('ExpeditionReturned', { fleetId: 'flt_7', atId: 'set_1', silver: 0, goods: {}, men: 3 })], st, { fleetId: undefined, overland: false })).toBeNull();
  });

  it('paints a march home from the rise, and every loss in the rain', () => {
    expect(returnAsset({ kind: 'home', overland: false })).toBe('expeditions.scene.homecoming');
    expect(returnAsset({ kind: 'home', overland: true })).toBe('settlements.scene.overland');
    expect(returnAsset({ kind: 'lost', overland: true })).toBe('expeditions.scene.lost');
  });
});

describe('coming home in a running saga', () => {
  beforeEach(() => {
    resetClientState();
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'return-scene-1' })));
  });
  afterEach(() => act(() => useGame.getState().quit()));

  it('opens the homecoming when the fleet stands down in the hall', () => {
    const opened: ReturnParams[] = [];
    const off = watchExpeditionReturns((p) => opened.push(p));
    try {
      act(() => void useGame.getState().dispatch({ type: 'launchExpedition', ...suggestPlan(state(), getContent(), 30) }));
      expect(state().player.expeditionFleetId).toBeDefined();
      act(() => void useGame.getState().dispatch({ type: 'returnHome' }));
      for (let h = 0; h < 24 * 20 && state().player.expeditionFleetId !== undefined; h += 24) {
        if (state().pending) break;
        act(() => void useGame.getState().advanceHours(24));
      }
      expect(state().player.expeditionFleetId).toBeUndefined();
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ kind: 'home', overland: false });
      expect(opened[0]?.men).toBeGreaterThan(0);
      expect(opened[0]?.place).toBe(state().settlements[state().player.capitalId]?.name);
    } finally {
      off();
    }
  });
});

describe('the scene', () => {
  const home: ReturnParams = { kind: 'home', overland: false, place: 'Myrhavn', men: 38, silver: 120, tons: 3.5, cause: '', menLost: 0 };

  it('a homecoming: the painting, the men and what they brought, one way on', () => {
    let closed = false;
    render(<ReturnScene params={{ ...home }} close={() => (closed = true)} />);
    const root = screen.getByTestId('expedition-home-scene');
    expect(root.getAttribute('data-asset')).toBe('expeditions.scene.homecoming');
    expect(root.textContent).toContain('Myrhavn');
    expect(root.textContent).toMatch(/38 men/);
    expect(root.textContent).toMatch(/120 silver/);
    fireEvent.click(screen.getByTestId('decision-choice-continue'));
    expect(closed).toBe(true);
  });

  it('a march home is painted from the rise', () => {
    render(<ReturnScene params={{ ...home, overland: true }} close={() => {}} />);
    expect(screen.getByTestId('expedition-home-scene').getAttribute('data-asset')).toBe('settlements.scene.overland');
    expect(screen.getByTestId('expedition-home-scene').textContent).toMatch(/war-band is home/);
  });

  it('a loss says what the alert said, and takes the alert away', () => {
    resetClientState();
    useNotifications.getState().ingest([{ type: 'Notification', key: 'expeditions.notify.lost.shipsLost', priority: 'critical', vars: {} } as unknown as SimEvent], 0);
    expect(useNotifications.getState().critical).toHaveLength(1);
    render(<ReturnScene params={{ kind: 'lost', overland: false, place: 'Myrhavn', men: 9, silver: 50, tons: 2, cause: 'shipsLost', menLost: 4 }} close={() => {}} />);
    const root = screen.getByTestId('expedition-lost-scene');
    expect(root.getAttribute('data-asset')).toBe('expeditions.scene.lost');
    expect(root.textContent).toMatch(/9 men come home; 4 more were lost/);
    expect(useNotifications.getState().critical).toHaveLength(0);
  });

  it('every string it asked for exists', () => {
    expect(missingKeysSeen().filter((k) => k.startsWith('expeditions.scene'))).toEqual([]);
  });
});
