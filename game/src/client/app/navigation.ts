/**
 * UI navigation (client-only state; never in GameState). Two layers:
 *   - the menu page shown while no game is loaded ('mainMenu', 'newSaga', 'saveLoad', 'options', …)
 *   - a stack of routes opened over the in-game scene (top-bar screens, options, the game menu, …)
 *
 * Screens open routes with `navigation.open('character', { id })`; Escape pops the top route (or
 * opens the game menu when the stack is empty). A route without a registered screen shows the shell's
 * "Coming soon" card, so buttons for screens other agents have not built yet still work.
 * `focusRequest` lets notifications ask the scene (e.g. the map) to centre on an entity.
 */
import { create } from 'zustand';
import type { EntityLink } from '@sim/core/events';
import type { RouteId } from './screenTypes';

export type RouteParams = Readonly<Record<string, string | number | boolean>>;

export interface Route {
  id: RouteId;
  params?: RouteParams;
  /** Unique key so the same route can be stacked twice (e.g. two character sheets). */
  key: number;
}

export interface NavigationStore {
  /** Menu page while no game is loaded. */
  menuPage: Route;
  /** Routes stacked over the game scene (last = top). */
  stack: Route[];
  /** A request for the scene to focus an entity (consumed by the map and other scenes). */
  focusRequest: (EntityLink & { seq: number }) | null;
  /** Shows a menu page (no game loaded). */
  showMenu(id: RouteId, params?: RouteParams): void;
  /** Pushes a route over the scene; re-opening the top route replaces its params. */
  open(id: RouteId, params?: RouteParams): void;
  /** Opens a route, or closes it when it is already on top (top-bar toggles, F-keys). */
  toggle(id: RouteId, params?: RouteParams): void;
  /** Pops the top route; returns false when the stack was empty. */
  back(): boolean;
  /** Removes a route (and everything above it). */
  close(key: number): void;
  /** Clears the stack (e.g. when leaving a game). */
  reset(): void;
  requestFocus(link: EntityLink): void;
  clearFocus(seq: number): void;
}

let keySeq = 1;

export const useNavigation = create<NavigationStore>()((set, get) => ({
  menuPage: { id: 'mainMenu', key: 0 },
  stack: [],
  focusRequest: null,

  showMenu(id, params) {
    set({ menuPage: { id, key: keySeq++, ...(params ? { params } : {}) } });
  },

  open(id, params) {
    set((s) => {
      const top = s.stack[s.stack.length - 1];
      if (top && top.id === id) {
        const replaced: Route = { ...top, ...(params ? { params } : {}) };
        return { stack: [...s.stack.slice(0, -1), replaced] };
      }
      return { stack: [...s.stack, { id, key: keySeq++, ...(params ? { params } : {}) }] };
    });
  },

  toggle(id, params) {
    const top = get().stack[get().stack.length - 1];
    if (top && top.id === id) get().back();
    else get().open(id, params);
  },

  back() {
    const { stack } = get();
    if (stack.length === 0) return false;
    set({ stack: stack.slice(0, -1) });
    return true;
  },

  close(key) {
    set((s) => {
      const i = s.stack.findIndex((r) => r.key === key);
      return i < 0 ? s : { stack: s.stack.slice(0, i) };
    });
  },

  reset() {
    set({ stack: [] });
  },

  requestFocus(link) {
    set({ focusRequest: { ...link, seq: keySeq++ } });
  },

  clearFocus(seq) {
    set((s) => (s.focusRequest?.seq === seq ? { focusRequest: null } : s));
  },
}));

/** Imperative access for non-React code (`navigation.open('codex')`). */
export const navigation = {
  open: (id: RouteId, params?: RouteParams) => useNavigation.getState().open(id, params),
  toggle: (id: RouteId, params?: RouteParams) => useNavigation.getState().toggle(id, params),
  back: () => useNavigation.getState().back(),
  showMenu: (id: RouteId, params?: RouteParams) => useNavigation.getState().showMenu(id, params),
  requestFocus: (link: EntityLink) => useNavigation.getState().requestFocus(link),
};
