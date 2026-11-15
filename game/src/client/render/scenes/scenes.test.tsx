// @vitest-environment jsdom
/**
 * The shared scene painting and staging: colour and light helpers, words for numbers, every picture
 * variant renders, the cue holds the scene back until it ends (a click, a fresh key or its timer), held
 * keys never skip it, and reduced motion gives a still banner.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTLEMENT_TIER_IDS } from '@content/schemas/ids';
import { approxMen, compassWord, oddsBand } from './ambience';
import { lightFor, mix, timeOfDay, VIEW_W } from './paint';
import { EncounterPicture, MAX_DRAWN_SHIPS, SettlementPicture, type Ambience, type SettlementPictureModel } from './pictures';
import { firstSentences } from './SceneLayout';
import { CUE_MS, CUE_STILL_MS, SceneStage } from './SceneStage';
import { styleOfCulture } from './settlement';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset['motion'];
});

const day: Ambience = { hourOfDay: 12, season: 'summer', weather: { fog: false, wind: 'fresh', storm: false } };

describe('paint and words', () => {
  it('mixes colours and tells the time of day', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(timeOfDay(6)).toBe('dawn');
    expect(timeOfDay(12)).toBe('day');
    expect(timeOfDay(19)).toBe('dusk');
    expect(timeOfDay(2)).toBe('night');
    expect(timeOfDay(-1)).toBe('night');
  });

  it('darkens the light in storms and fog, snows in winter', () => {
    const fair = lightFor(12);
    const storm = lightFor(12, 'summer', { fog: false, wind: 'gale', storm: true });
    expect(storm.rain).toBe(true);
    expect(storm.sky[0]).not.toBe(fair.sky[0]);
    expect(lightFor(12, 'summer', { fog: true, wind: 'calm', storm: false }).hazeAmount).toBeGreaterThan(fair.hazeAmount);
    expect(lightFor(12, 'winter').snow).toBe(true);
    expect(lightFor(23).lamps).toBe(1);
    expect(lightFor(12).lamps).toBe(0);
  });

  it('speaks odds, head-counts and bearings in words', () => {
    expect(oddsBand(0.95)).toBe('certain');
    expect(oddsBand(0.7)).toBe('likely');
    expect(oddsBand(0.5)).toBe('even');
    expect(oddsBand(0.2)).toBe('unlikely');
    expect(oddsBand(0.05)).toBe('slim');
    expect(approxMen(7)).toBe(7);
    expect(approxMen(23)).toBe(25);
    expect(approxMen(63)).toBe(60);
    expect(approxMen(437)).toBe(450);
    expect(compassWord({ x: 0, y: 0 }, { x: 0, y: -5 })).toBe('n');
    expect(compassWord({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe('se');
    expect(compassWord({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe('none');
  });

  it('keeps at most two sentences', () => {
    expect(firstSentences('One. Two! Three? Four.')).toBe('One. Two!');
    expect(firstSentences('Only one')).toBe('Only one');
  });
});

describe('pictures', () => {
  it('paints the other party at sea with at most the drawable number of hulls', () => {
    const ships = Array.from({ length: 12 }, () => 'snekkja');
    const { container } = render(<EncounterPicture model={{ ambience: day, kind: 'warfleet', stage: 'sighted', domain: 'sea', ships, men: 400, colour: '#3f70aa', seed: 1 }} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(`0 0 ${VIEW_W} 900`);
    // Each drawn hull bobs on its own swell.
    expect(container.querySelectorAll('.scn-bob').length).toBe(MAX_DRAWN_SHIPS);
  });

  it('paints a land encounter and a caught scene at night', () => {
    const night: Ambience = { ...day, hourOfDay: 1 };
    for (const [kind, stage] of [
      ['outlaws', 'sighted'],
      ['landPatrol', 'sighted'],
      ['outlaws', 'caught'],
    ] as const) {
      const { container, unmount } = render(<EncounterPicture model={{ ambience: night, kind, stage, domain: 'land', ships: [], men: 40, seed: 2 }} />);
      expect(container.querySelector('[data-tod="night"]')).not.toBeNull();
      unmount();
    }
    const { container } = render(<EncounterPicture model={{ ambience: night, kind: 'raiders', stage: 'caught', domain: 'sea', ships: ['drakkar', 'karvi'], men: 90, seed: 3 }} />);
    expect(container.querySelectorAll('.scn-bob').length).toBe(2);
  });

  it('paints every settlement tier, culture style, view and its scars', () => {
    const base: SettlementPictureModel = { ambience: day, tier: 'village', fortTier: 0, style: 'north', lantern: false, seed: 5, colour: '#b8402f', raided: false, coastal: true, view: 'sea' };
    for (const tier of SETTLEMENT_TIER_IDS) {
      for (const fortTier of [0, 1, 2, 3, 4]) {
        const { container, unmount } = render(<SettlementPicture model={{ ...base, tier, fortTier }} />);
        expect(container.querySelector(`[data-tier="${tier}"]`)).not.toBeNull();
        unmount();
      }
    }
    for (const culture of ['skarn', 'albric', 'corvani', 'velkar', 'saraleonese', 'kurgai']) {
      const { unmount } = render(<SettlementPicture model={{ ...base, tier: 'town', style: styleOfCulture(culture), lantern: culture === 'albric' }} />);
      unmount();
    }
    for (const view of ['land', 'quay', 'aftermath'] as const) {
      const { container, unmount } = render(<SettlementPicture model={{ ...base, view, raided: view === 'aftermath' }} />);
      if (view === 'aftermath') expect(container.querySelectorAll('.scn-smoke-dark').length).toBeGreaterThan(0);
      unmount();
    }
    const { container } = render(<SettlementPicture model={{ ...base, raided: true }} />);
    expect(container.querySelectorAll('.scn-smoke-dark').length).toBeGreaterThan(0);
  });
});

describe('the attention cue', () => {
  const cue = { text: 'A sail!', sound: 'none' as const, glyph: 'sail' as const };

  it('holds the scene back until it is clicked', () => {
    render(
      <SceneStage cue={cue}>
        <button data-testid="inside">Go</button>
      </SceneStage>,
    );
    expect(screen.getByTestId('scene-cue').textContent).toContain('A sail!');
    expect(screen.queryByTestId('inside')).toBeNull();
    fireEvent.click(screen.getByTestId('scene-cue'));
    expect(screen.getByTestId('inside')).toBeTruthy();
  });

  it('ignores held (repeating) keys and ends on a fresh press', () => {
    render(
      <SceneStage cue={cue}>
        <button data-testid="inside">Go</button>
      </SceneStage>,
    );
    fireEvent.keyDown(window, { key: 'w', repeat: true });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(screen.queryByTestId('inside')).toBeNull();
    fireEvent.keyDown(window, { key: 'w' });
    expect(screen.getByTestId('inside')).toBeTruthy();
  });

  it('ends by itself, and is a still banner under reduced motion', () => {
    vi.useFakeTimers();
    render(
      <SceneStage cue={cue}>
        <span data-testid="inside" />
      </SceneStage>,
    );
    act(() => void vi.advanceTimersByTime(CUE_MS - 50));
    expect(screen.queryByTestId('inside')).toBeNull();
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByTestId('inside')).toBeTruthy();
    cleanup();
    document.documentElement.dataset['motion'] = 'reduced';
    render(
      <SceneStage cue={cue}>
        <span data-testid="inside" />
      </SceneStage>,
    );
    expect(screen.getByTestId('scene-cue').className).toContain('is-still');
    act(() => void vi.advanceTimersByTime(CUE_STILL_MS + 10));
    expect(screen.getByTestId('inside').closest('.scn-stage')?.className).not.toContain('scn-enter');
  });
});
