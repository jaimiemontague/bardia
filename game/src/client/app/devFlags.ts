/**
 * Client-side developer flags (never in GameState, never saved). Toggled from the dev console;
 * renderers read them:
 *   revealMap     — draw the map without fog (the map renderer reads `useDevFlags`)
 *   showIds       — show entity ids next to names in panels
 *   forceRealtime — run the real-time clock on any scene (testing time flow at home)
 *   consoleOpen   — the dev console overlay is open
 */
import { create } from 'zustand';

export interface DevFlagsStore {
  revealMap: boolean;
  showIds: boolean;
  forceRealtime: boolean;
  consoleOpen: boolean;
  set(patch: Partial<Omit<DevFlagsStore, 'set' | 'toggleConsole'>>): void;
  toggleConsole(open?: boolean): void;
}

export const useDevFlags = create<DevFlagsStore>()((set) => ({
  revealMap: false,
  showIds: false,
  forceRealtime: false,
  consoleOpen: false,
  set(patch) {
    set(patch);
  },
  toggleConsole(open) {
    set((s) => ({ consoleOpen: open ?? !s.consoleOpen }));
  },
}));

/** Whether developer tools are available (dev builds, or enabled in Options → Gameplay). */
export function devToolsAllowed(settingEnabled: boolean): boolean {
  let dev = false;
  try {
    dev = Boolean(import.meta.env?.DEV);
  } catch {
    dev = false;
  }
  return dev || settingEnabled;
}
