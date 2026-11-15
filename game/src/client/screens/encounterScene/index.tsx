/**
 * Encounter scene screen (pending 'encounter', fullscreen, priority 1: it wins over the generic decision
 * modal without removing it). See EncounterScene.tsx. Also registers the developer scene gallery
 * (route 'sceneGallery', `?scenes` in dev builds), which paints every scene variant from sample data.
 */
import { useMemo, type ReactElement } from 'react';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useGame, usePending } from '../../app/gameStore';
import { EncounterScene } from './EncounterScene';
import { encounterView } from './model';
import { sceneGalleryScreen } from './gallery';

function EncounterSceneScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const view = useMemo(() => (pending && state && pending.kind === 'encounter' ? encounterView(state, pending) : null), [pending, state]);
  if (!view || !pending) return null;
  return <EncounterScene key={pending.id} view={view} onCommand={(c) => dispatch(c)} />;
}

export const screens: ScreenDescriptor[] = [
  { id: 'encounterScene', pending: 'encounter', component: EncounterSceneScreen, layout: 'fullscreen', priority: 1, titleKey: 'ui.decision.kind.encounter' },
  sceneGalleryScreen,
];
