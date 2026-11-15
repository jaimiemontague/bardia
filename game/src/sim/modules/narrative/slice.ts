/**
 * The narrative module's state slice (`state.storylets`, owned per ownership.ts): the core fields
 * (cooldowns, onceFired, scheduled) plus the augmented ones (types.ts). Helpers here create missing fields
 * (a save from before this module existed gets them in `init`) and keep the bookkeeping in one place.
 */
import { isSafeRecordKey } from '@sim/core/keys';
import type { GameState, Hour, StoryletsState } from '@sim/core/state';
import './types';
import type { ComposedVerse, LineMemory, StoryletInstance } from './types';

/** The slice with every augmented field present. */
export interface NarrativeSlice extends StoryletsState {
  instances: Record<string, StoryletInstance>;
  marks: Record<string, Hour>;
  tallies: Record<string, number>;
  lines: LineMemory;
  verses: Record<string, ComposedVerse>;
}

/** A fresh line memory (session 1). */
export function newLineMemory(): LineMemory {
  return { session: 1, draws: 0, recent: {}, uses: {}, last: {} };
}

/** Returns the slice, creating any missing field (cheap when everything exists). */
export function ensureSlice(draft: GameState): NarrativeSlice {
  const s = draft.storylets;
  if (s.instances === undefined) s.instances = {};
  if (s.marks === undefined) s.marks = {};
  if (s.tallies === undefined) s.tallies = {};
  if (s.lines === undefined) s.lines = newLineMemory();
  if (s.verses === undefined) s.verses = {};
  return s as NarrativeSlice;
}

/** Records that `key` happened at `hour` (daysSince marks and count tallies). */
export function noteMark(slice: NarrativeSlice, key: string, hour: Hour): void {
  if (!isSafeRecordKey(key)) return;
  const prev = Object.hasOwn(slice.marks, key) ? (slice.marks[key] as number) : undefined;
  if (prev === undefined || hour >= prev) slice.marks[key] = hour;
  slice.tallies[key] = (Object.hasOwn(slice.tallies, key) ? (slice.tallies[key] as number) : 0) + 1;
}

/**
 * New game / first load of a save made before this module existed: creates the augmented fields and
 * back-fills the chronicle marks and tallies from the chronicle already written (so daysSince('chronicle:x')
 * and count('chronicle', x) work mid-campaign).
 */
export function initSlice(draft: GameState): void {
  const fresh = draft.storylets.marks === undefined;
  const slice = ensureSlice(draft);
  if (!fresh) return;
  for (const entry of draft.chronicle) noteMark(slice, `chronicle:${entry.kind}`, entry.hour);
}

/**
 * A plain (non-draft) copy of an instance. Resolution deletes the instance from the slice, so code that
 * keeps using it afterwards (effects, chronicle, follow-ups) works on a snapshot, never on a detached draft.
 */
export function snapshotInstance(inst: StoryletInstance): StoryletInstance {
  return JSON.parse(JSON.stringify(inst)) as StoryletInstance;
}

/** Active instances in a deterministic order (by fired hour, then id number). */
export function sortedInstances(instances: Readonly<Record<string, StoryletInstance>>): StoryletInstance[] {
  return Object.values(instances).sort((a, b) => a.firedHour - b.firedHour || idNumber(a.id) - idNumber(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function idNumber(id: string): number {
  const n = Number(id.slice(id.indexOf('_') + 1));
  return Number.isFinite(n) ? n : 0;
}
