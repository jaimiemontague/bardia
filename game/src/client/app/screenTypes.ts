/**
 * Screen descriptors (ARCHITECTURE §14). Every screen lives in its own folder,
 * `src/client/screens/<name>/index.tsx`, and exports a descriptor — conventionally
 * `export const screen: ScreenDescriptor = { … }` (any named export of this shape is picked up, and
 * an array of descriptors works too). The registry is built with `import.meta.glob`, so adding a
 * screen never edits a shared file.
 *
 * A descriptor says what it serves:
 *   mode     — a GameMode (`state.meta.mode`): the main scene ('hub', 'map', 'battle', …)
 *   pending  — a pending-decision kind (`state.pending.kind`): shown over the scene until resolved
 *   route    — a navigation route id: top-bar panels ('character', 'family', 'ledger', 'chronicle',
 *              'sagaLedger', 'codex'), menu pages ('mainMenu', 'newSaga', 'options', 'saveLoad'),
 *              or any id another screen opens with `navigation.open(routeId)`
 *
 *   // src/client/screens/worldMap/index.tsx
 *   import type { ScreenDescriptor } from '@client/app/screenTypes';
 *   export const screen: ScreenDescriptor = { id: 'worldMap', mode: 'map', component: WorldMapScreen };
 *
 * When several descriptors serve the same thing the highest `priority` wins (default 0), so a
 * placeholder (priority < 0) is replaced by a real screen without deleting it.
 */
import type { ComponentType } from 'react';
import type { GameMode, PendingKind } from '@sim/core/state';

/** Ids of the routes the shell itself opens (screens may define any other route ids). */
export type CoreRouteId =
  | 'mainMenu'
  | 'newSaga'
  | 'options'
  | 'saveLoad'
  | 'credits'
  | 'character'
  | 'family'
  | 'ledger'
  | 'chronicle'
  | 'sagaLedger'
  | 'codex'
  | 'inbox'
  | 'gameMenu';

export type RouteId = CoreRouteId | (string & {});

/** Props every screen component receives (all data is also reachable through the stores' hooks). */
export interface ScreenProps {
  /** The route params (for route screens), e.g. `{ id: 'chr_12' }` for a character sheet. */
  params?: Readonly<Record<string, string | number | boolean>>;
  /** Closes this screen (route screens: pop the route; others: no-op). */
  close(): void;
}

/**
 * How the shell hosts a screen:
 *   scene      — fills the area between the top bar and the narration bar (modes)
 *   fullscreen — covers the whole viewport, no shell chrome (battles, menus)
 *   overlay    — a large framed panel over the scene (top-bar screens)
 *   modal      — a centred dialog (pending decisions)
 */
export type ScreenLayout = 'scene' | 'fullscreen' | 'overlay' | 'modal';

export interface ScreenDescriptor {
  /** Unique screen id (usually the folder name). */
  id: string;
  /** Game mode(s) this screen renders as the main scene. */
  mode?: GameMode | readonly GameMode[];
  /** Pending-decision kind(s) this screen resolves. */
  pending?: PendingKind | readonly PendingKind[];
  /** Navigation route id(s) that open this screen. */
  route?: RouteId | readonly RouteId[];
  component: ComponentType<ScreenProps>;
  /** Hosting layout (default: scene for modes, modal for pending, overlay for routes). */
  layout?: ScreenLayout;
  /** Higher wins when several screens serve the same mode/pending kind/route (default 0). */
  priority?: number;
  /** Locale key of the screen title (window titles, breadcrumbs, the Coming-soon card). */
  titleKey?: string;
  /** Whether the time controls may run while this screen is the scene (default: mode === 'map'). */
  realtime?: boolean;
}

/** A descriptor normalised for lookups. */
export interface RegisteredScreen {
  id: string;
  modes: readonly string[];
  pending: readonly string[];
  routes: readonly string[];
  component: ComponentType<ScreenProps>;
  layout: ScreenLayout | undefined;
  priority: number;
  titleKey: string | undefined;
  realtime: boolean | undefined;
  /** Module path it was found in (diagnostics). */
  source: string;
}
