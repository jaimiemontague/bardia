/**
 * A rolling log of recent sim-event batches for the dev console's `events` command and bug reports.
 * Batches with only clock events (TimeAdvanced/DayStarted/…) are dropped to keep it useful.
 */
import { onSimEvents, type SimEventBatch } from '../app/simEvents';

const LIMIT = 60;
const CLOCK_EVENTS = new Set(['TimeAdvanced', 'DayStarted', 'WeekStarted', 'MonthStarted', 'YearStarted']);
const batches: SimEventBatch[] = [];

/** The recent interesting batches, oldest first. */
export function recentEventBatches(): readonly SimEventBatch[] {
  return batches;
}

/** Starts recording; returns the stop function. */
export function installEventLog(): () => void {
  return onSimEvents((batch) => {
    if (batch.origin === 'startup') batches.length = 0;
    const interesting = batch.events.filter((e) => !CLOCK_EVENTS.has(e.type as string));
    if (interesting.length === 0) return;
    batches.push({ ...batch, events: interesting });
    if (batches.length > LIMIT) batches.splice(0, batches.length - LIMIT);
  });
}
