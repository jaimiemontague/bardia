// @vitest-environment jsdom
/**
 * The Aftermath as a scene: at most four open fates in view (the rest, and the closed ones, behind More),
 * each dispatching its fate, the governor picker beside "Hold it", and the descriptor now full screen.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharId, Settlement } from '@sim/core/state';
import type { AftermathFate, DecisionOption } from '@sim/modules/settlements/types';
import { buildRegistry } from '../../app/screenRegistry';
import { galleryVariant } from '../encounterScene/gallery';
import * as settlement from './index';
import { AftermathSceneBody, planFates } from './index';

afterEach(() => cleanup());

const ALL: AftermathFate[] = ['sackAndBurn', 'plunderAndLeave', 'spare', 'takeCaptives', 'makeTributary', 'annex', 'liberate'];
const fates = (closed: AftermathFate[] = ['liberate']): DecisionOption<AftermathFate>[] => ALL.map((id) => (closed.includes(id) ? { id, available: false, reasonKey: 'settlements.reason.noAlly' } : { id, available: true, preview: { renown: 3, dread: 2 } }));

function sample(): { s: Settlement; picture: Parameters<typeof AftermathSceneBody>[0]['picture'] } {
  const v = galleryVariant('aftermath');
  if (!v || v.kind !== 'aftermath') throw new Error('no sample');
  return { s: v.s, picture: v.picture };
}

describe('the Aftermath scene', () => {
  it('plans four open fates in view and the rest behind More', () => {
    const { inView, more } = planFates(fates());
    expect(inView.map((o) => o.id)).toEqual(['plunderAndLeave', 'spare', 'makeTributary', 'sackAndBurn']);
    expect(more.map((o) => o.id)).toEqual(['annex', 'takeCaptives', 'liberate']);
  });

  it('dispatches the fate pressed, with the chosen governor for Hold it', () => {
    const onChoose = vi.fn();
    const { s, picture } = sample();
    const governors = [
      { id: 'chr_1' as CharId, name: 'Ketil' },
      { id: 'chr_2' as CharId, name: 'Asa' },
    ];
    render(<AftermathSceneBody settlement={s} picture={picture} options={fates()} governors={governors} onChoose={onChoose} />);
    expect(screen.getByTestId('aftermath').textContent).toContain('Wenbury has fallen');
    expect((screen.getByTestId('choose-liberate') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('option-annex').closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('choose-spare'));
    expect(onChoose).toHaveBeenLastCalledWith('spare', undefined);
    fireEvent.click(screen.getByTestId('scene-more'));
    fireEvent.change(screen.getByTestId('annex-governor'), { target: { value: 'chr_2' } });
    fireEvent.click(screen.getByTestId('choose-annex'));
    expect(onChoose).toHaveBeenLastCalledWith('annex', 'chr_2');
  });

  it('is hosted full screen; the old Arrival Card stays registered beneath the arrival scene', () => {
    const registry = buildRegistry({ settlement });
    expect(registry.forPending('aftermath')?.layout).toBe('fullscreen');
    expect(registry.forPending('arrival')?.id).toBe('arrival');
  });
});
