/**
 * Dev page `?mapPreview` (also `?mapPreview&seed=ketil&days=20&culture=hvarn&reveal`): a fresh registry session
 * shown on the chart alone, for looking at the map without playing (Playwright screenshots use it too).
 */
import { useMemo, type ReactElement } from 'react';
import { GameSession } from '@sim/index';
import { headlessCommand } from '@sim/headless';
import { useDevFlags } from '../../app/devFlags';
import { WorldMap } from './index';

/** Builds the preview session from the URL. */
function previewState(search: string) {
  const q = new URLSearchParams(search);
  const culture = q.get('culture');
  const session = GameSession.newGame({
    seed: q.get('seed') ?? 'preview',
    ...(culture === 'skarn' || culture === 'hvarn' || culture === 'eyjar' ? { player: { culture } } : {}),
  });
  const days = Math.max(0, Math.min(365, Number(q.get('days') ?? 0) || 0));
  let left = days * 24;
  for (let guard = 0; left > 0 && guard < 500; guard++) {
    const r = session.advance(left);
    left -= r.hoursAdvanced;
    if (r.pending) {
      const h = headlessCommand(session.getState(), r.pending);
      if (!('command' in h) || session.dispatch(h.command).error) break;
    }
  }
  if (q.has('reveal')) useDevFlags.getState().set({ revealMap: true });
  return session.getState();
}

export function MapPreview(): ReactElement {
  const state = useMemo(() => previewState(globalThis.location?.search ?? ''), []);
  return (
    <div className="wm-preview" data-testid="map-preview">
      <WorldMap state={state} />
    </div>
  );
}
