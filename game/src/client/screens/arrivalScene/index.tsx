/**
 * Arrival scene screen (pending 'arrival', fullscreen, priority 1: it wins over the old Arrival Card in
 * screens/settlement without removing it). See ArrivalScene.tsx.
 */
import { useMemo, type ReactElement } from 'react';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useGame, usePending } from '../../app/gameStore';
import { GenericDecision } from '../../shell/DecisionHost';
import { ArrivalScene } from './ArrivalScene';
import { arrivalView } from './model';

function ArrivalSceneScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const view = useMemo(() => (pending && state && pending.kind === 'arrival' ? arrivalView(state, pending) : null), [pending, state]);
  if (!pending || pending.kind !== 'arrival') return null;
  // An unknown settlement still gets an answerable decision (the generic modal with the payload's choices).
  if (!view) return <GenericDecision pending={pending} />;
  return <ArrivalScene key={pending.id} view={view} onChoose={(choice) => dispatch({ type: 'resolveArrival', choice })} />;
}

export const screen: ScreenDescriptor = { id: 'arrivalScene', pending: 'arrival', component: ArrivalSceneScreen, layout: 'fullscreen', priority: 1, titleKey: 'ui.decision.kind.arrival' };
