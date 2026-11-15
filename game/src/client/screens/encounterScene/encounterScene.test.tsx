// @vitest-environment jsdom
/**
 * The encounter scene: the cue first (no choice can be pressed during it), then the full-screen scene for
 * every kind and stage, the safe default first and at most four choices in view, "More" for the rest,
 * each choice dispatching the payload's own command, and the screen registered over the generic modal.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@sim/core/commands';
import type { PendingDecision } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { useGame } from '../../app/gameStore';
import { buildRegistry } from '../../app/screenRegistry';
import { missingKeysSeen } from '../../i18n/index';
import { DecisionHost } from '../../shell/DecisionHost';
import { resetClientState } from '../../testing/clientTestKit';
import { EncounterScene, EncounterSceneBody, bodyText } from './EncounterScene';
import { galleryVariant, SCENE_VARIANTS, SceneVariant } from './gallery';
import * as encounterScene from './index';
import { encounterView, planChoices, type EncounterView } from './model';

function view(name: string): EncounterView {
  const v = galleryVariant(name);
  if (!v || v.kind !== 'encounter') throw new Error(name);
  return v.view;
}

afterEach(() => cleanup());

describe('planning the choices', () => {
  it('puts the safe default first, keeps four in view and the closed ones behind More', () => {
    const v = view('sea-night-raiders');
    expect(v.inView[0]?.choice.id).toBe('evade');
    expect(v.inView.length).toBeLessThanOrEqual(4);
    expect(v.inView.every((c) => c.choice.disabled !== true)).toBe(true);
    expect(v.more.map((c) => c.choice.id)).toContain('hail');
    // Flee's odds are of getting away (the option's chance is that they catch us).
    expect(v.inView.find((c) => c.choice.id === 'flee')?.odds?.band).toBe('likely');
  });

  it('keeps Attack in view for a merchant and a peaceful patrol', () => {
    expect(view('sea-day-merchant').inView.map((c) => c.choice.id)).toEqual(['hail', 'trade', 'pass', 'attack']);
    expect(view('sea-dusk-patrol').inView.map((c) => c.choice.id)).toContain('attack');
  });

  it('copes with a payload without choices', () => {
    expect(planChoices({ choices: [], options: [], defaultChoice: 'pass', aggressive: false })).toEqual({ inView: [], more: [] });
  });
});

describe('the scene', () => {
  it('renders every gallery variant of every kind and stage', () => {
    for (const name of SCENE_VARIANTS) {
      const { unmount } = render(<SceneVariant name={name} cue={false} />);
      const v = galleryVariant(name);
      if (v?.kind === 'encounter') {
        const root = screen.getByTestId('encounter-scene');
        expect(root.getAttribute('data-kind')).toBe(v.view.payload.kind);
        expect(root.getAttribute('data-stage')).toBe(v.view.payload.stage);
        expect(screen.getByTestId('encounter-picture')).toBeTruthy();
        expect(within(root).getAllByRole('button').filter((b) => b.closest('[hidden]') === null && /^decision-choice-/.test(b.getAttribute('data-testid') ?? '')).length).toBeLessThanOrEqual(4);
      }
      unmount();
    }
  });

  it('shows the cue first: no choice can be pressed until the scene is showing', () => {
    const onCommand = vi.fn();
    render(<EncounterScene view={view('sea-day-merchant')} onCommand={onCommand} />);
    expect(screen.getByTestId('scene-cue').textContent).toMatch(/A sail to the north-east!/);
    expect(screen.queryByTestId('decision-choice-hail')).toBeNull();
    // A key held for steering repeats: it neither skips the cue nor answers.
    fireEvent.keyDown(window, { key: '1', repeat: true });
    expect(screen.queryByTestId('decision-choice-hail')).toBeNull();
    fireEvent.click(screen.getByTestId('scene-cue'));
    expect(screen.getByTestId('decision-choice-hail')).toBeTruthy();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('dispatches the payload command of the choice pressed, by click or by a fresh number key', () => {
    const onCommand = vi.fn<(c: Command) => void>();
    const v = view('sea-night-raiders');
    render(<EncounterSceneBody view={v} onCommand={onCommand} />);
    fireEvent.click(screen.getByTestId('decision-choice-attack'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'resolveEncounter', choice: 'attack' });
    fireEvent.keyDown(window, { key: '1', repeat: true });
    expect(onCommand).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: '1' });
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'resolveEncounter', choice: 'evade' });
  });

  it('reveals the rest behind More, greyed with the reason when closed', () => {
    render(<EncounterSceneBody view={view('sea-night-raiders')} onCommand={() => undefined} />);
    const hail = screen.getByTestId('decision-choice-hail') as HTMLButtonElement;
    expect(hail.closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('scene-more'));
    expect(hail.closest('[hidden]')).toBeNull();
    expect(hail.disabled).toBe(true);
    expect(hail.textContent).toMatch(/not men who talk/);
    fireEvent.click(screen.getByTestId('scene-less'));
    expect(hail.closest('[hidden]')).not.toBeNull();
  });

  it('says who and how many in words, and never repeats the title as the first sentence', () => {
    render(<EncounterSceneBody view={view('sea-dusk-patrol')} onCommand={() => undefined} />);
    expect(screen.getByTestId('encounter-scene').textContent).toContain('Three ships, about ninety men of Vargholm.');
    expect(bodyText('They run you down', 'They run you down. Hulls grind. A voice calls.')).toBe('Hulls grind. A voice calls.');
  });
});

describe('the screen', () => {
  beforeEach(() => {
    resetClientState();
    act(() => useGame.getState().attach(GameSession.newGame({ seed: 'scene-1' })));
  });
  afterEach(() => act(() => useGame.getState().quit()));

  it('wins over the generic modal for encounter decisions, fullscreen', () => {
    const registry = buildRegistry({ encounterScene });
    const s = registry.forPending('encounter');
    expect(s?.id).toBe('encounterScene');
    expect(s?.layout).toBe('fullscreen');
    expect(registry.forRoute('sceneGallery')?.id).toBe('sceneGallery');
  });

  it('reads a live payload against the state (missing fleets are tolerated)', () => {
    const state = useGame.getState().state;
    if (!state) throw new Error('no state');
    const sample = view('land-day-outlaws');
    const pending = { id: 'pd_test', kind: 'encounter', hour: state.time.hour, payload: { ...sample.payload, fleetId: 'flt_missing' } } as unknown as PendingDecision;
    const v = encounterView(state, pending);
    expect(v.picture.domain).toBe('land');
    expect(v.cue.glyph).toBe('spears');
    expect(v.assetId).toBe('encounters.scene.outlaws');
    render(<DecisionHost registry={buildRegistry({ encounterScene })} />);
  });

  it('asks only for strings that exist', () => {
    for (const name of SCENE_VARIANTS) {
      const { unmount } = render(<SceneVariant name={name} cue />);
      const cue = screen.queryByTestId('scene-cue');
      if (cue) fireEvent.click(cue);
      const more = screen.queryByTestId('scene-more');
      if (more) fireEvent.click(more);
      unmount();
    }
    expect(missingKeysSeen().filter((k) => k.startsWith('encounters.') || k.startsWith('settlements.'))).toEqual([]);
  });
});
