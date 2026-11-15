/**
 * The action bus: keyboard shortcuts, gamepad buttons and UI buttons all trigger named actions
 * ('time.togglePause', 'open.character', 'map.landfall', …). Screens subscribe with `useAction`
 * (or `actionBus.on`). The most recently registered handler runs first; returning `false` passes
 * the action on to the next (older) handler, so a modal can take Escape without the shell losing it.
 */
import { useEffect, useRef } from 'react';

export type ActionSource = 'keyboard' | 'gamepad' | 'ui';

export interface ActionInfo {
  action: string;
  source: ActionSource;
  /** Key auto-repeat (keyboard only). */
  repeat: boolean;
  /** 'down' when pressed, 'up' when released (hold-to-toggle and held abilities). */
  phase: 'down' | 'up';
}

/** Return false to let the next handler see the action; anything else consumes it. */
export type ActionHandler = (info: ActionInfo) => boolean | void;

export class ActionBus {
  private readonly handlers: Record<string, ActionHandler[]> = {};
  private readonly observers: ((info: ActionInfo, handled: boolean) => void)[] = [];

  /** Registers a handler; returns the unsubscribe function. */
  on(action: string, handler: ActionHandler): () => void {
    const list = (this.handlers[action] ??= []);
    list.push(handler);
    return () => {
      const i = list.lastIndexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /** Observes every triggered action (input hints, analytics, tests). */
  observe(fn: (info: ActionInfo, handled: boolean) => void): () => void {
    this.observers.push(fn);
    return () => {
      const i = this.observers.indexOf(fn);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  /** True if any handler is registered for the action. */
  has(action: string): boolean {
    return (this.handlers[action]?.length ?? 0) > 0;
  }

  /** Triggers an action; returns true if a handler consumed it. */
  trigger(action: string, partial: Partial<Omit<ActionInfo, 'action'>> = {}): boolean {
    const info: ActionInfo = { action, source: partial.source ?? 'ui', repeat: partial.repeat ?? false, phase: partial.phase ?? 'down' };
    const list = this.handlers[action] ?? [];
    let handled = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      if (!h) continue;
      if (h(info) !== false) {
        handled = true;
        break;
      }
    }
    for (const o of [...this.observers]) o(info, handled);
    return handled;
  }
}

/** The app-wide bus. */
export const actionBus = new ActionBus();

/**
 * React hook: handle `action` while mounted (and `enabled`). Only 'down' phases are delivered
 * unless `withRelease` is set. The latest handler closure is always used.
 */
export function useAction(action: string, handler: ActionHandler, enabled = true, withRelease = false): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    return actionBus.on(action, (info) => {
      if (info.phase === 'up' && !withRelease) return false;
      return ref.current(info);
    });
  }, [action, enabled, withRelease]);
}
