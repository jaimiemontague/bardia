/**
 * Fan-out of simulation events to client services (notifications, narration, auto-pause,
 * autosave, audio cues, renderers' cosmetic animations). Events are never stored in GameState;
 * this bus is how everything outside React sees them, in order, exactly once.
 */
import type { Command } from '@sim/core/commands';
import type { SimEvent } from '@sim/core/events';
import type { GameState } from '@sim/core/state';

export type SimEventOrigin = 'startup' | 'dispatch' | 'advance';

export interface SimEventBatch {
  events: readonly SimEvent[];
  state: GameState;
  origin: SimEventOrigin;
  /** The command that produced the batch (origin 'dispatch'). */
  command?: Command;
}

export type SimEventListener = (batch: SimEventBatch) => void;

const listeners: SimEventListener[] = [];

/** Subscribes to every event batch; returns the unsubscribe function. */
export function onSimEvents(listener: SimEventListener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Publishes a batch to every listener (a throwing listener never blocks the others). */
export function publishSimEvents(batch: SimEventBatch): void {
  for (const l of [...listeners]) {
    try {
      l(batch);
    } catch (err) {
      console.error('[simEvents] listener failed', err);
    }
  }
}

/** Reads an event field without depending on the event's declared type (events of modules that may not exist yet). */
export function eventField(e: SimEvent, key: string): unknown {
  return (e as unknown as Record<string, unknown>)[key];
}
