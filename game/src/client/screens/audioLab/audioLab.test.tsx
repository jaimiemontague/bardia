// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_STATES, SFX_IDS } from '@client/audio/catalog';
import { configureAudio, getAudioManager, useMusicState } from '@client/audio/hooks';
import { testAudioContext, TestFinalBackend } from '@client/audio/testFakes';
import { setMissingKeyWarnings } from '@client/i18n/index';
import { AudioLabScreen } from './AudioLab';
import { screen as descriptor } from './index';

beforeEach(() => {
  setMissingKeyWarnings(false);
  const { ctx } = testAudioContext();
  configureAudio(
    { createContext: () => ctx, finalBackend: new TestFinalBackend(), loadIndex: null, storage: null, window: null, document: null, autoTick: false },
    { speech: null, createUtterance: null },
  );
});

afterEach(() => {
  cleanup();
  configureAudio();
});

describe('audio lab screen', () => {
  it('registers as a fullscreen route screen', () => {
    expect(descriptor).toMatchObject({ id: 'audioLab', route: 'audioLab', layout: 'fullscreen', titleKey: 'music.lab.title' });
  });

  it('lists every music state and sound effect, unlocks, plays and cleans up', async () => {
    const close = vi.fn();
    const { unmount } = render(<AudioLabScreen close={close} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audio lab');
    for (const s of MUSIC_STATES) expect(screen.getByTestId(`music-${s}`)).toBeTruthy();
    for (const id of SFX_IDS) expect(screen.getByTestId(`sfx-${id}`)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable audio' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getAudioManager().getStatus().unlocked).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId('music-duel'));
    });
    expect(getAudioManager().effectiveMusicRequest()).toBe('duel');
    expect(getAudioManager().getStatus().music.state).toBe('duel');
    expect(screen.getByText(/Now playing: Duel/)).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Speak' })[0]!);
    });
    expect(screen.getByTestId('audio-lab-subtitle').textContent).toContain('The fjord was quiet that morning');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(getAudioManager().effectiveMusicRequest()).toBe('silence');
  });

  it('starts and stops a loop from its row', async () => {
    render(<AudioLabScreen close={() => {}} />);
    await act(async () => {
      await getAudioManager().unlock();
    });
    const row = screen.getByTestId('sfx-weather.rain');
    const button = row.querySelector('button');
    act(() => {
      fireEvent.click(button!);
    });
    expect(getAudioManager().activeSfxCount('weather.rain')).toBe(1);
    expect(button!.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      fireEvent.click(button!);
    });
    expect(button!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('useMusicState', () => {
  function Requester({ state }: { state: Parameters<typeof useMusicState>[0] }) {
    useMusicState(state);
    return null;
  }

  it('stacks requests by mount order and unwinds on unmount', () => {
    const m = getAudioManager();
    m.setMusic('homeSkarn');
    const a = render(<Requester state="sailingCalm" />);
    expect(m.effectiveMusicRequest()).toBe('sailingCalm');
    const b = render(<Requester state="battleRaid" />);
    expect(m.effectiveMusicRequest()).toBe('battleRaid');
    b.rerender(<Requester state="battleShieldwall" />);
    expect(m.effectiveMusicRequest()).toBe('battleShieldwall');
    b.rerender(<Requester state={null} />);
    expect(m.effectiveMusicRequest()).toBe('sailingCalm');
    b.unmount();
    a.unmount();
    expect(m.effectiveMusicRequest()).toBe('homeSkarn');
  });
});
