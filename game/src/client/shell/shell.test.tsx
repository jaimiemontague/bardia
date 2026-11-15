// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOURS_PER_DAY } from '@sim/core/time';
import { App } from '../app/App';
import { MS_PER_DAY_AT_1X } from '../app/clock';
import { useDevFlags } from '../app/devFlags';
import { useGame } from '../app/gameStore';
import { useNavigation } from '../app/navigation';
import { useNotifications } from '../app/notifications';
import { buildRegistry, type ScreenRegistry } from '../app/screenRegistry';
import { installGameServices } from '../app/services';
import { installEventLog } from '../devtools/eventLog';
import { actionBus } from '../input/actions';
import { useSettings } from '../settings/store';
import { resetClientState, testShellSession, type TestScriptStep } from '../testing/clientTestKit';
import * as gameMenu from '../screens/gameMenu/index';
import * as hub from '../screens/hub/index';
import * as hubPlaceholder from '../screens/hubPlaceholder/index';
import * as inbox from '../screens/inbox/index';
import * as mainMenu from '../screens/mainMenu/index';
import * as newSaga from '../screens/newSaga/index';
import * as options from '../screens/options/index';
import * as saveLoad from '../screens/saveLoad/index';

/** The shell's own screens (other agents' screens stay out of these tests). */
function shellRegistry(): ScreenRegistry {
  return buildRegistry({
    './screens/gameMenu/index.tsx': gameMenu,
    './screens/hub/index.tsx': hub,
    './screens/hubPlaceholder/index.tsx': hubPlaceholder,
    './screens/inbox/index.tsx': inbox,
    './screens/mainMenu/index.tsx': mainMenu,
    './screens/newSaga/index.tsx': newSaga,
    './screens/options/index.tsx': options,
    './screens/saveLoad/index.tsx': saveLoad,
  });
}

let uninstall: (() => void)[] = [];

function setup(script?: readonly TestScriptStep[]) {
  for (const off of uninstall) off();
  const saves = resetClientState(script);
  // Narration types out instantly so assertions see whole lines.
  useSettings.getState().update({ accessibility: { reducedMotion: true } });
  uninstall = [installGameServices({ saveManager: () => saves }), installEventLog()];
  return saves;
}

function startGame(script?: readonly TestScriptStep[]) {
  const session = testShellSession(script ? { script } : {});
  act(() => {
    useGame.getState().attach(session);
  });
  return session;
}

/** Advances the session (as the real-time loop would) inside act(). */
function advanceDays(days: number) {
  act(() => {
    useGame.getState().advanceHours(days * HOURS_PER_DAY);
  });
}

beforeEach(() => {
  setup();
});
afterEach(() => {
  cleanup();
  for (const off of uninstall) off();
  uninstall = [];
  act(() => useGame.getState().quit());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('screen registry', () => {
  it('registers every shell screen without problems', () => {
    const reg = shellRegistry();
    expect(reg.problems).toEqual([]);
    expect(reg.forRoute('mainMenu')?.id).toBe('mainMenu');
    expect(reg.forRoute('options')?.id).toBe('options');
    // The real Home Hall (priority 0) replaces the placeholder (priority < 0).
    expect(reg.forMode('hub')?.id).toBe('hub');
    expect(reg.forMode('hub')?.priority).toBe(0);
  });
});

describe('main menu → Quick Start → hub', () => {
  it('starts a saga from the main menu and shows the hub with the top bar', async () => {
    render(<App registry={shellRegistry()} />);
    const menu = screen.getByTestId('main-menu');
    // No saves yet: Continue is disabled; New Saga is the primary action.
    await act(async () => {
      await Promise.resolve();
    });
    expect((within(menu).getByTestId('menu-continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByTestId('menu-newSaga'));
    expect(screen.getByTestId('new-saga')).toBeTruthy();
    fireEvent.click(screen.getByTestId('quick-start'));
    expect(screen.getByTestId('game-shell')).toBeTruthy();
    expect(screen.getByTestId('hub')).toBeTruthy();
    const state = useGame.getState().state;
    const ruler = state ? state.characters[state.player.rulerId] : undefined;
    expect(ruler).toBeTruthy();
    expect(screen.getByTestId('topbar-ruler').textContent).toContain(ruler?.name ?? '?');
    expect(screen.getByTestId('stat-silver').textContent).toMatch(/\d/);
    expect(screen.getByTestId('topbar-date').textContent).toContain('Icebreak');
    // Time at home is paused (§7.3): no time controls on the hub.
    expect(screen.queryByTestId('time-controls')).toBeNull();
  });
});

describe('top bar navigation and the route stack', () => {
  it('opens a Coming-soon card for unbuilt screens; Escape closes it, then opens the game menu', () => {
    startGame();
    render(<App registry={shellRegistry()} />);
    fireEvent.click(screen.getByTestId('nav-ledger'));
    const card = screen.getByTestId('coming-soon');
    expect(within(card).getByRole('heading', { name: 'Ledger' })).toBeTruthy();
    act(() => {
      actionBus.trigger('ui.back', { source: 'keyboard' });
    });
    expect(screen.queryByTestId('coming-soon')).toBeNull();
    act(() => {
      actionBus.trigger('ui.back', { source: 'keyboard' });
    });
    expect(screen.getByTestId('game-menu')).toBeTruthy();
    // Options opened from the game menu returns to it when closed.
    fireEvent.click(screen.getByTestId('gm-options'));
    expect(screen.getByTestId('options')).toBeTruthy();
    fireEvent.click(screen.getByTestId('options-close'));
    expect(screen.getByTestId('game-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('gm-resume'));
    expect(useNavigation.getState().stack).toEqual([]);
  });

  it('global keys toggle the top-bar screens (C opens and closes the character route)', () => {
    startGame();
    render(<App registry={shellRegistry()} />);
    act(() => {
      actionBus.trigger('open.character', { source: 'keyboard' });
    });
    expect(useNavigation.getState().stack.map((r) => r.id)).toEqual(['character']);
    act(() => {
      actionBus.trigger('open.character', { source: 'keyboard' });
    });
    expect(useNavigation.getState().stack).toEqual([]);
  });
});

describe('notifications (§25.9)', () => {
  const script: TestScriptStep[] = [
    { day: 1, notify: { key: 'ui.comingSoon.sceneBody', priority: 'normal' } },
    {
      day: 2,
      notify: { key: 'ui.comingSoon.body', priority: 'high', link: { kind: 'screen', id: 'ledger' } },
    },
    { day: 3, notify: { key: 'ui.error.title', priority: 'critical' } },
  ];

  it('Info goes to the feed, Important adds a toast, Critical opens a modal until acknowledged', () => {
    setup(script);
    startGame(script);
    render(<App registry={shellRegistry()} />);
    advanceDays(1);
    expect(screen.getAllByTestId('feed-chip')).toHaveLength(1);
    expect(screen.queryAllByTestId('toast')).toHaveLength(0);
    advanceDays(1);
    expect(screen.getAllByTestId('feed-chip')).toHaveLength(2);
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast').textContent).toContain('The skalds have not finished this tale');
    advanceDays(1);
    const modal = screen.getByTestId('critical-modal');
    expect(within(modal).getByRole('heading', { name: 'Grave Tidings' })).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'So be it' }));
    expect(screen.queryByTestId('critical-modal')).toBeNull();
    // The inbox keeps everything, newest first, with "Go to" links.
    fireEvent.click(screen.getByTestId('nav-inbox'));
    const box = screen.getByTestId('inbox');
    const items = within(box).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('Critical');
    fireEvent.click(within(items[1] as HTMLElement).getByRole('button'));
    expect(useNavigation.getState().stack.map((r) => r.id)).toEqual(['ledger']);
  });

  it('auto-pauses on Critical notifications while time runs (setting on by default)', () => {
    setup(script);
    startGame(script);
    act(() => useGame.getState().setPaused(false));
    advanceDays(3);
    expect(useGame.getState().paused).toBe(true);
    expect(useGame.getState().pauseReason).toBe('ui.time.autoPause.critical');
    expect(useNotifications.getState().critical).toHaveLength(1);
  });
});

describe('pending decisions', () => {
  it('shows the generic decision modal for a message and resolves it with the core acknowledge command', () => {
    const script: TestScriptStep[] = [
      { day: 1, message: { key: 'ui.comingSoon.sceneBody', priority: 'high' } },
    ];
    setup(script);
    const session = startGame(script);
    render(<App registry={shellRegistry()} />);
    advanceDays(5);
    expect(session.getState().pending?.kind).toBe('message');
    // Time never advances while a decision is pending.
    const hour = session.getState().time.hour;
    advanceDays(1);
    expect(session.getState().time.hour).toBe(hour);
    const modal = screen.getByTestId('generic-decision');
    expect(within(modal).getByRole('heading', { name: 'Tidings' })).toBeTruthy();
    expect(modal.textContent).toContain('This part of the saga is still being carved');
    fireEvent.click(within(modal).getByTestId('decision-acknowledge'));
    expect(session.getState().pending).toBeNull();
    expect(screen.queryByTestId('generic-decision')).toBeNull();
  });
});

describe('narration and standing reasons', () => {
  it('shows the latest narration line with its speaker and remembers why Renown changed', () => {
    const script: TestScriptStep[] = [
      {
        day: 1,
        narrate: { key: 'ui.narration.idle', voice: 'hirdmaster' },
        renown: 15,
        notify: { key: 'ui.comingSoon.body', priority: 'low' },
      },
    ];
    setup(script);
    startGame(script);
    render(<App registry={shellRegistry()} />);
    advanceDays(1);
    const line = screen.getByTestId('narration-line');
    expect(line.getAttribute('aria-label')).toBe('The fire crackles; the hall waits for your word.');
    expect(line.textContent).toContain('Hirdmaster');
    // Renown, Honor and Dread live in the ruler's portrait tooltip (ARCHITECTURE §20), with why they changed.
    expect(screen.queryByTestId('stat-renown')).toBeNull();
    vi.useFakeTimers();
    fireEvent.mouseEnter(screen.getByTestId('topbar-portrait').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByTestId('tip-renown').textContent).toContain('15');
    expect(tip.textContent).toContain('+15');
    expect(tip.textContent).toContain('The skalds have not finished this tale');
  });
});

describe('time controls and the real-time loop (§7.2)', () => {
  it('shows Pause/1×/2×/4× on real-time scenes and drives the clock from the action bus', () => {
    startGame();
    act(() => useDevFlags.getState().set({ forceRealtime: true }));
    render(<App registry={shellRegistry()} />);
    const controls = screen.getByTestId('time-controls');
    fireEvent.click(within(controls).getByTestId('time-speed-2'));
    expect(useGame.getState().speed).toBe(2);
    expect(useGame.getState().paused).toBe(false);
    act(() => {
      actionBus.trigger('time.togglePause', { source: 'keyboard' });
    });
    expect(useGame.getState().paused).toBe(true);
    act(() => {
      actionBus.trigger('time.speed4', { source: 'keyboard' });
    });
    expect(useGame.getState().speed).toBe(4);
    expect(useGame.getState().paused).toBe(false);
  });

  it('converts wall-clock frames to game hours: one day per ~4 s at 1×, held while an overlay is open', () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const session = startGame();
    act(() => useDevFlags.getState().set({ forceRealtime: true }));
    render(<App registry={shellRegistry()} />);
    act(() => useGame.getState().setSpeed(1));
    const start = session.getState().time.hour;
    let now = performance.now();
    const tick = (ms: number) => {
      // Frames of ≤ 100 ms (the clock clips longer gaps).
      for (let left = ms; left > 0; left -= 100) {
        now += Math.min(100, left);
        act(() => frame?.(now));
      }
    };
    tick(MS_PER_DAY_AT_1X);
    expect(session.getState().time.hour - start).toBe(HOURS_PER_DAY);
    act(() => useNavigation.getState().open('codex'));
    tick(MS_PER_DAY_AT_1X);
    expect(session.getState().time.hour - start).toBe(HOURS_PER_DAY);
    act(() => useNavigation.getState().reset());
    act(() => useGame.getState().setSpeed(4));
    tick(MS_PER_DAY_AT_1X);
    expect(session.getState().time.hour - start).toBe(HOURS_PER_DAY * 5);
  });
});

describe('developer console', () => {
  it('opens with the backtick action and runs inspection commands', () => {
    startGame();
    render(<App registry={shellRegistry()} />);
    act(() => {
      actionBus.trigger('dev.console', { source: 'keyboard' });
    });
    const input = screen.getByTestId('dev-console-input');
    fireEvent.change(input, { target: { value: 'seed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('dev-console').textContent).toContain('shell-test');
    fireEvent.change(input, { target: { value: 'advance 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useGame.getState().state?.time.hour).toBe(2 * HOURS_PER_DAY);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('dev-console')).toBeNull();
  });
});
