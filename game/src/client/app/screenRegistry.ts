/**
 * The screen registry: normalises screen descriptors found in screen modules and answers "which
 * screen serves this mode / pending kind / route?". Pure (no import.meta.glob here) so it is unit
 * testable; `registry.ts` feeds it the eager glob of `src/client/screens/*\/index.tsx`.
 *
 * Normalisation is deliberately tolerant so parallel screen authors cannot break the shell: any
 * named export that looks like a descriptor (an `id` string plus a `component`/`Component`
 * function) is registered; `mode|modes`, `pending|pendingKind|pendingKinds`, `route|routes` and a
 * `serves` object (or array of them) are all understood. Malformed exports are skipped with a
 * diagnostic, never thrown.
 */
import type { ComponentType } from 'react';
import type { RegisteredScreen, ScreenLayout, ScreenProps } from './screenTypes';

const LAYOUTS: readonly ScreenLayout[] = ['scene', 'fullscreen', 'overlay', 'modal'];

function strings(v: unknown): string[] {
  if (typeof v === 'string' && v.length > 0) return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return [];
}

function isComponent(v: unknown): v is ComponentType<ScreenProps> {
  // Function components, class components, and React.memo/forwardRef objects ($$typeof).
  return typeof v === 'function' || (v !== null && typeof v === 'object' && '$$typeof' in (v as object));
}

/** Normalises one candidate export; returns undefined if it is not a descriptor. */
export function normalizeDescriptor(candidate: unknown, source: string): RegisteredScreen | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const d = candidate as Record<string, unknown>;
  const component = d.component ?? d.Component;
  if (typeof d.id !== 'string' || d.id.length === 0 || !isComponent(component)) return undefined;
  const modes = [...strings(d.mode), ...strings(d.modes)];
  const pending = [...strings(d.pending), ...strings(d.pendingKind), ...strings(d.pendingKinds)];
  const routes = [...strings(d.route), ...strings(d.routes)];
  const serves = Array.isArray(d.serves) ? d.serves : d.serves !== undefined ? [d.serves] : [];
  for (const s of serves) {
    if (s === null || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    modes.push(...strings(o.mode));
    pending.push(...strings(o.pending), ...strings(o.pendingKind));
    routes.push(...strings(o.route));
  }
  const layout = typeof d.layout === 'string' && (LAYOUTS as readonly string[]).includes(d.layout) ? (d.layout as ScreenLayout) : undefined;
  return {
    id: d.id,
    modes: [...new Set(modes)],
    pending: [...new Set(pending)],
    routes: [...new Set(routes)],
    component,
    layout,
    priority: typeof d.priority === 'number' && Number.isFinite(d.priority) ? d.priority : 0,
    titleKey: typeof d.titleKey === 'string' ? d.titleKey : undefined,
    realtime: typeof d.realtime === 'boolean' ? d.realtime : undefined,
    source,
  };
}

/** Collects every descriptor exported by the given modules (path → module namespace). */
export function collectScreens(modules: Readonly<Record<string, unknown>>): { screens: RegisteredScreen[]; problems: string[] } {
  const screens: RegisteredScreen[] = [];
  const problems: string[] = [];
  const ids: Record<string, string> = {};
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    if (mod === null || typeof mod !== 'object') continue;
    let found = 0;
    for (const value of Object.values(mod as Record<string, unknown>)) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const c of candidates) {
        const s = normalizeDescriptor(c, path);
        if (!s) continue;
        found++;
        const dup = ids[s.id];
        if (dup !== undefined) {
          problems.push(`screen id '${s.id}' is exported by both ${dup} and ${path}; the second is ignored`);
          continue;
        }
        ids[s.id] = path;
        if (s.modes.length + s.pending.length + s.routes.length === 0) problems.push(`screen '${s.id}' (${path}) serves no mode, pending kind or route`);
        screens.push(s);
      }
    }
    if (found === 0) problems.push(`${path} exports no screen descriptor`);
  }
  return { screens, problems };
}

/** Lookup structure over registered screens. */
export class ScreenRegistry {
  constructor(
    readonly screens: readonly RegisteredScreen[],
    readonly problems: readonly string[] = [],
  ) {}

  private best(pred: (s: RegisteredScreen) => boolean): RegisteredScreen | undefined {
    let best: RegisteredScreen | undefined;
    for (const s of this.screens) if (pred(s) && (!best || s.priority > best.priority)) best = s;
    return best;
  }

  /** The scene for a game mode. */
  forMode(mode: string): RegisteredScreen | undefined {
    return this.best((s) => s.modes.includes(mode));
  }

  /** The screen that resolves a pending kind. */
  forPending(kind: string): RegisteredScreen | undefined {
    return this.best((s) => s.pending.includes(kind));
  }

  /** The screen for a navigation route. */
  forRoute(route: string): RegisteredScreen | undefined {
    return this.best((s) => s.routes.includes(route));
  }

  /** The screen with this id. */
  byId(id: string): RegisteredScreen | undefined {
    return this.screens.find((s) => s.id === id);
  }
}

/** Builds a registry from glob results. */
export function buildRegistry(modules: Readonly<Record<string, unknown>>): ScreenRegistry {
  const { screens, problems } = collectScreens(modules);
  return new ScreenRegistry(screens, problems);
}
