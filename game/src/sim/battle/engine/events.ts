/**
 * Engine event log: every notable thing that happens in a battle (for the battle log, audio cues,
 * narration and tests). Keys are locale keys `battle.event.<kind>`; the battle view formats them
 * with `{ ...event.vars, value: event.value, squad: <name of event.squad>, target: <name of
 * event.target> }` (squad names come from the snapshot: leader name or unit label).
 */
import type { TextVars } from '@sim/core/state';
import type { BattleEngineEvent, BattleEngineEventKind, BattleState, BSquad } from './types';
import { SIDE_KEYS } from './types';

/** Appends an event (the log is capped by tunables.eventLogMax; the oldest entries drop out). */
export function emit(
  state: BattleState,
  kind: BattleEngineEventKind,
  extra: { squad?: BSquad; target?: string; x?: number; y?: number; value?: number; vars?: TextVars; side?: 0 | 1 } = {},
): void {
  const e: BattleEngineEvent = { tick: state.tick, kind, key: `battle.event.${kind}` };
  const sideIdx = extra.side ?? extra.squad?.side;
  if (sideIdx !== undefined) e.side = SIDE_KEYS[sideIdx];
  if (extra.squad) {
    e.squad = extra.squad.id;
    e.x = extra.squad.x;
    e.y = extra.squad.y;
  }
  if (extra.target !== undefined) e.target = extra.target;
  if (extra.x !== undefined) e.x = extra.x;
  if (extra.y !== undefined) e.y = extra.y;
  if (extra.value !== undefined) e.value = extra.value;
  if (extra.vars !== undefined) e.vars = extra.vars;
  state.events.push(e);
  const max = state.data.t.eventLogMax;
  if (state.events.length > max) state.events.splice(0, state.events.length - max);
}
