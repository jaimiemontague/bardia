// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOURS_PER_DAY } from '@sim/core/time';
import { App } from '../app/App';
import { useGame } from '../app/gameStore';
import { getShortcutManager } from '../app/inputRuntime';
import { useNavigation } from '../app/navigation';
import { useNewSaga } from '../app/newSaga/store';
import { buildRegistry, type ScreenRegistry } from '../app/screenRegistry';
import { applySettingsToDocument } from '../settings/apply';
import { STORAGE_KEY, reloadSettingsFromStorage, useSettings } from '../settings/store';
import type { SaveManager } from '../saves/saveManager';
import { resetClientState, testShellSession } from '../testing/clientTestKit';
import * as gameMenu from './gameMenu/index';
import * as hub from './hub/index';
import * as hubPlaceholder from './hubPlaceholder/index';
import * as inbox from './inbox/index';
import * as mainMenu from './mainMenu/index';
import * as newSaga from './newSaga/index';
import * as options from './options/index';
import * as saveLoad from './saveLoad/index';
import * as credits from './credits/index';

function registry(): ScreenRegistry {
  return buildRegistry({ gameMenu, hub, hubPlaceholder, inbox, mainMenu, newSaga, options, saveLoad, credits });
}

let saves: SaveManager;
let unsubscribeApply: (() => void) | null = null;

beforeEach(() => {
  saves = resetClientState();
  // What main.tsx does: settings are applied to <html> and kept in sync.
  applySettingsToDocument(useSettings.getState().settings);
  unsubscribeApply = useSettings.subscribe((s) => applySettingsToDocument(s.settings));
});
afterEach(() => {
  cleanup();
  unsubscribeApply?.();
  act(() => useGame.getState().quit());
});

function flush() {
  return act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('Options (§25.7, §25.8)', () => {
  it('changes the text size, applies it to the document and persists it across reloads', () => {
    act(() => useNavigation.getState().showMenu('options'));
    render(<App registry={registry()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Accessibility' }));
    const field = within(screen.getByTestId('options-text-size')).getByRole('textbox');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '130' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(useSettings.getState().settings.accessibility.textSize).toBe(130);
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.3');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { accessibility?: { textSize?: number } };
    expect(stored.accessibility?.textSize).toBe(130);
    // A "reload": the store re-reads storage.
    act(() => useSettings.setState({ settings: { ...useSettings.getState().settings, accessibility: { ...useSettings.getState().settings.accessibility, textSize: 100 } } }));
    act(() => reloadSettingsFromStorage());
    expect(useSettings.getState().settings.accessibility.textSize).toBe(130);
  });

  it('applies UI scale, high contrast, colour-blind palette, typeface and reduced motion as root attributes', () => {
    act(() => useNavigation.getState().showMenu('options'));
    render(<App registry={registry()} />);
    fireEvent.click(screen.getByRole('button', { name: /Set to the maximum \(150/ }));
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.5');
    fireEvent.click(screen.getByRole('tab', { name: 'Accessibility' }));
    fireEvent.click(screen.getByTestId('options-high-contrast'));
    expect(document.documentElement.dataset.contrast).toBe('high');
    fireEvent.change(screen.getByTestId('options-colorblind'), { target: { value: 'tritanopia' } });
    expect(document.documentElement.dataset.cb).toBe('tritanopia');
    fireEvent.click(screen.getByRole('radio', { name: 'Hyperlegible' }));
    expect(document.documentElement.dataset.font).toBe('hyperlegible');
    fireEvent.click(screen.getByRole('switch', { name: 'Reduced motion' }));
    expect(document.documentElement.dataset.motion).toBe('reduced');
    // Restore defaults for this page.
    fireEvent.click(screen.getByTestId('options-reset'));
    expect(document.documentElement.dataset.contrast).toBe('normal');
    expect(useSettings.getState().settings.video.uiScale).toBe(150);
  });

  it('audio sliders reach the registered audio sink', async () => {
    const { setAudioSink } = await import('../settings/store');
    const sink = vi.fn();
    setAudioSink(sink);
    expect(sink).toHaveBeenCalledTimes(1);
    act(() => useNavigation.getState().showMenu('options'));
    render(<App registry={registry()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    fireEvent.click(within(screen.getByTestId('options-audio-music')).getByRole('button', { name: /minimum/ }));
    expect(sink).toHaveBeenLastCalledWith(expect.objectContaining({ music: 0 }));
    setAudioSink(null);
  });

  it('rebinds a key by capturing the next combination and flags conflicts', () => {
    act(() => useNavigation.getState().showMenu('options'));
    render(<App registry={registry()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
    fireEvent.click(screen.getByTestId('rebind-open.ledger'));
    expect(within(screen.getByTestId('bind-open.ledger')).getByText('Press a key…')).toBeTruthy();
    act(() => {
      getShortcutManager().handleKeyDown({ code: 'KeyC', key: 'c', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, repeat: false, target: null, preventDefault() {} });
    });
    expect(useSettings.getState().settings.controls.bindings['open.ledger']?.[0]).toBe('Shift+KeyC');
    // Rebinding Ledger to plain C collides with Character.
    fireEvent.click(screen.getByTestId('rebind-open.ledger'));
    act(() => {
      getShortcutManager().handleKeyDown({ code: 'KeyC', key: 'c', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, target: null, preventDefault() {} });
    });
    expect(screen.getByRole('alert').textContent).toContain('bound to more than one action');
    fireEvent.click(screen.getByTestId('bindings-reset-all'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useSettings.getState().settings.controls.bindings['open.ledger']).toEqual(['KeyL']);
  });
});

describe('Save / Load (§29.9)', () => {
  it('saves to a named slot in game, lists it, and continues it from the main menu', async () => {
    act(() => {
      useGame.getState().attach(testShellSession({ seed: 'slot-test' }));
    });
    render(<App registry={registry()} />);
    act(() => useNavigation.getState().open('saveLoad', { mode: 'save' }));
    await flush();
    fireEvent.change(screen.getByTestId('save-name'), { target: { value: 'Before the storm' } });
    fireEvent.click(screen.getByTestId('save-new'));
    await waitFor(() => expect(screen.getByTestId('save-row-manual-1')).toBeTruthy());
    expect(screen.getByTestId('save-row-manual-1').textContent).toContain('Before the storm');
    expect((await saves.list()).map((m) => m.id)).toEqual(['manual-1']);
    // Quit to the main menu: Continue now offers the save.
    act(() => useGame.getState().advanceHours(HOURS_PER_DAY * 3));
    cleanup();
    act(() => {
      useGame.getState().quit();
      useNavigation.getState().reset();
      useNavigation.getState().showMenu('mainMenu');
    });
    render(<App registry={registry()} />);
    await flush();
    const cont = screen.getByTestId('menu-continue') as HTMLButtonElement;
    await waitFor(() => expect(cont.disabled).toBe(false));
    expect(cont.textContent).toContain('Sigrun');
    fireEvent.click(cont);
    await waitFor(() => expect(screen.getByTestId('game-shell')).toBeTruthy());
    expect(useGame.getState().state?.meta.seed).toBe('slot-test');
    expect(useGame.getState().state?.time.hour).toBe(0);
  });

  it('Ironman campaigns cannot save manually', async () => {
    act(() => {
      useGame.getState().attach(testShellSession({ seed: 'iron', options: { options: { ironman: true } } }));
    });
    render(<App registry={registry()} />);
    act(() => useNavigation.getState().open('saveLoad', { mode: 'save' }));
    await flush();
    expect(screen.queryByTestId('save-new')).toBeNull();
    expect(screen.getByTestId('save-load').textContent).toContain('Ironman');
  });
});

describe('New Saga wizard (§5.1)', () => {
  it('walks the steps with validation, Random and Recommended, and begins the saga', () => {
    act(() => useNavigation.getState().showMenu('newSaga'));
    render(<App registry={registry()} />);
    expect(screen.getByTestId('wizard-step-identity')).toBeTruthy();
    // An empty name blocks the step.
    fireEvent.change(screen.getByTestId('saga-name'), { target: { value: '   ' } });
    expect(screen.getByRole('status').textContent).toContain('Give your hero a name.');
    fireEvent.click(screen.getByTestId('wizard-recommended'));
    expect(screen.getByTestId('saga-name')).toHaveProperty('value');
    expect((screen.getByTestId('saga-name') as HTMLInputElement).value.trim().length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toBe('');
    // Skills: Random spends every point; removing one shows the points left.
    fireEvent.click(screen.getByTestId('step-skills'));
    fireEvent.click(screen.getByTestId('wizard-random'));
    expect(screen.getByTestId('points-left').textContent).toMatch(/All \d+ skill points spent/);
    const melee = within(screen.getByTestId('points-melee'));
    const minus = melee.getAllByRole('button')[0] as HTMLButtonElement;
    if (!minus.disabled) {
      fireEvent.click(minus);
      expect(screen.getByTestId('points-left').textContent).not.toMatch(/All/);
      fireEvent.click(screen.getByTestId('wizard-recommended'));
    }
    expect(screen.getByTestId('points-left').textContent).toMatch(/All \d+ skill points spent/);
    // Difficulty: Long Winter, then the confirm card, then begin.
    fireEvent.click(screen.getByTestId('step-difficulty'));
    fireEvent.click(screen.getByTestId('difficulty-longWinter'));
    fireEvent.click(screen.getByTestId('option-ironman'));
    fireEvent.click(screen.getByTestId('step-confirm'));
    expect(screen.getByTestId('confirm-card')).toBeTruthy();
    const name = useNewSaga.getState().choices?.name.trim();
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('game-shell')).toBeTruthy();
    const state = useGame.getState().state;
    expect(state?.meta.difficulty).toBe('longWinter');
    expect(state?.meta.options.ironman).toBe(true);
    expect(state ? state.characters[state.player.rulerId]?.name : undefined).toBe(name);
    // The wizard store is reset for the next saga.
    expect(useNewSaga.getState().choices).toBeNull();
  });
});

describe('Home hall hub (mode hub)', () => {
  it('passes time at home through the core wait command', () => {
    act(() => {
      useGame.getState().attach(testShellSession());
    });
    render(<App registry={registry()} />);
    // The real hall replaces the placeholder (priority 0 over −100).
    expect(registry().forMode('hub')?.id).toBe('hub');
    expect(screen.getByTestId('hub-capital')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wait-1'));
    expect(useGame.getState().state?.time.hour).toBe(HOURS_PER_DAY);
    fireEvent.click(screen.getByTestId('wait-7'));
    expect(useGame.getState().state?.time.hour).toBe(HOURS_PER_DAY * 8);
    expect(useGame.getState().session?.commandLog.filter((e) => e.kind === 'command')).toHaveLength(2);
    expect(screen.getByTestId('topbar-date').textContent).toContain('9 Icebreak');
  });
});

describe('Credits', () => {
  it('lists the open-source libraries and returns to the main menu', () => {
    act(() => useNavigation.getState().showMenu('credits'));
    render(<App registry={registry()} />);
    expect(screen.getByTestId('credits').textContent).toContain('PixiJS');
    fireEvent.click(within(screen.getByTestId('credits')).getByRole('button', { name: /Back/ }));
    expect(screen.getByTestId('main-menu')).toBeTruthy();
  });
});
