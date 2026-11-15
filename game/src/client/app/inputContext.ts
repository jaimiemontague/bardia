/**
 * Active input contexts for the shortcut manager (§25.6): 'global' always; 'menu' while no campaign
 * is open; the scene's context ('map', 'battle', 'duel') from the game mode. Battle and sea-battle
 * scenes share the 'battle' context.
 */
import type { InputContext } from '../input/bindings';
import { useGame } from './gameStore';

const MODE_CONTEXT: Readonly<Record<string, InputContext>> = {
  map: 'map',
  battle: 'battle',
  seaBattle: 'battle',
  duel: 'duel',
};

/** Contexts for a game mode (null = no campaign open). */
export function contextsForMode(mode: string | null): ReadonlySet<InputContext> {
  const out = new Set<InputContext>(['global']);
  if (mode === null) out.add('menu');
  else {
    const ctx = MODE_CONTEXT[mode];
    if (ctx) out.add(ctx);
  }
  return out;
}

/** The contexts live right now. */
export function currentInputContexts(): ReadonlySet<InputContext> {
  const state = useGame.getState().state;
  return contextsForMode(state ? state.meta.mode : null);
}
