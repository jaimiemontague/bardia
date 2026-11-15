/**
 * Client-side rolling logs derived from events: narration lines (the narration bar and its
 * history) and recent standing changes (the "why" behind Renown/Honor/Dread tooltips).
 */
import { create } from 'zustand';
import type { SimEvent, VoiceId } from '@sim/core/events';
import type { Hour, TextVars } from '@sim/core/state';

export interface NarrationEntry {
  id: number;
  key: string;
  vars: TextVars;
  voice: VoiceId;
  hour: Hour;
}

export type StandingStat = 'renown' | 'honor' | 'dread' | 'favor' | 'faithWrath' | 'piety';

export interface StandingChange {
  id: number;
  stat: StandingStat;
  delta: number;
  value: number;
  hour: Hour;
  god?: string;
  /** Locale key + vars of a chronicle entry or notification raised by the same operation (the reason). */
  reasonKey?: string;
  reasonVars?: TextVars;
}

export const NARRATION_LIMIT = 100;
export const STANDING_LIMIT = 12;

export interface FeedsStore {
  narration: NarrationEntry[];
  standings: Record<StandingStat, StandingChange[]>;
  ingest(events: readonly SimEvent[], hour: Hour): void;
  clear(): void;
}

let seq = 1;

function emptyStandings(): Record<StandingStat, StandingChange[]> {
  return { renown: [], honor: [], dread: [], favor: [], faithWrath: [], piety: [] };
}

export const useFeeds = create<FeedsStore>()((set) => ({
  narration: [],
  standings: emptyStandings(),

  ingest(events, hour) {
    const lines: NarrationEntry[] = [];
    const changes: StandingChange[] = [];
    // A chronicle entry or notification in the same batch is the most specific reason we have.
    let reasonKey: string | undefined;
    let reasonVars: TextVars | undefined;
    for (const e of events) {
      if (e.type === 'ChronicleAdded') {
        reasonKey = e.entry.textKey;
        reasonVars = e.entry.vars;
      } else if (e.type === 'Notification' && reasonKey === undefined) {
        reasonKey = e.key;
        reasonVars = e.vars;
      }
    }
    for (const e of events) {
      if (e.type === 'NarrationLine') lines.push({ id: seq++, key: e.key, vars: e.vars ?? {}, voice: e.voice, hour });
      else if (e.type === 'StandingChanged' && e.delta !== 0) {
        changes.push({
          id: seq++,
          stat: e.stat,
          delta: e.delta,
          value: e.value,
          hour,
          ...(e.god !== undefined ? { god: e.god } : {}),
          ...(reasonKey !== undefined ? { reasonKey, reasonVars: reasonVars ?? {} } : {}),
        });
      }
    }
    if (lines.length === 0 && changes.length === 0) return;
    set((s) => {
      const standings = { ...s.standings };
      for (const c of changes) standings[c.stat] = [c, ...standings[c.stat]].slice(0, STANDING_LIMIT);
      return { narration: [...s.narration, ...lines].slice(-NARRATION_LIMIT), standings };
    });
  },

  clear() {
    set({ narration: [], standings: emptyStandings() });
  },
}));
