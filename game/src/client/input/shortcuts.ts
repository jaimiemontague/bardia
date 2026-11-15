/**
 * Keyboard shortcut manager (design §25.6). Translates key events into actions on the action bus
 * using the player's (rebindable) bindings and the currently active input contexts.
 *
 * Resolution: among actions bound to the pressed combo whose context is active, a specific context
 * (battle, duel, map, menu) wins over 'global'; global actions flagged `outsideBattles` are off
 * while a battle or duel context is active. Typing in a text field never triggers shortcuts except
 * Escape. A rebinding UI can `capture()` the next combo instead.
 */
import { ACTIONS, comboFromEvent, type ActionDef, type InputContext } from './bindings';
import { actionBus, type ActionBus } from './actions';

export type KeyEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat' | 'target'> & {
  preventDefault(): void;
};

export interface ShortcutManagerDeps {
  bus?: ActionBus;
  bindings: () => Readonly<Record<string, readonly string[]>>;
  contexts: () => ReadonlySet<InputContext>;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'].includes(type);
  }
  return el.isContentEditable === true;
}

export class ShortcutManager {
  private readonly bus: ActionBus;
  private captureFn: ((combo: string) => void) | null = null;
  private readonly down: Record<string, string> = {};

  constructor(private readonly deps: ShortcutManagerDeps) {
    this.bus = deps.bus ?? actionBus;
  }

  /** The action a combo maps to in the given contexts (undefined when unbound). */
  resolve(combo: string, contexts: ReadonlySet<InputContext> = this.deps.contexts()): ActionDef | undefined {
    if (combo === '') return undefined;
    const bindings = this.deps.bindings();
    const inBattle = contexts.has('battle') || contexts.has('duel');
    let best: ActionDef | undefined;
    for (const a of ACTIONS) {
      if (!(bindings[a.id] ?? a.defaults).includes(combo)) continue;
      if (a.context !== 'global' && !contexts.has(a.context)) continue;
      if (a.context === 'global' && a.outsideBattles && inBattle) continue;
      if (!best || (best.context === 'global' && a.context !== 'global')) best = a;
    }
    return best;
  }

  /** The next non-modifier combo goes to `fn` instead of triggering an action (rebinding UI). */
  capture(fn: (combo: string) => void): () => void {
    this.captureFn = fn;
    return () => {
      if (this.captureFn === fn) this.captureFn = null;
    };
  }

  get capturing(): boolean {
    return this.captureFn !== null;
  }

  /** Handles a keydown; returns true when it triggered (or captured) something. */
  handleKeyDown(e: KeyEventLike): boolean {
    const combo = comboFromEvent(e);
    if (combo === '') return false;
    if (this.captureFn) {
      const fn = this.captureFn;
      this.captureFn = null;
      e.preventDefault();
      fn(combo);
      return true;
    }
    if (isTextInput(e.target) && e.code !== 'Escape') return false;
    const action = this.resolve(combo);
    if (!action) return false;
    const handled = this.bus.trigger(action.id, { source: 'keyboard', repeat: e.repeat, phase: 'down' });
    if (handled) {
      e.preventDefault();
      this.down[e.code] = action.id;
    }
    return handled;
  }

  /** Handles a keyup (delivers the 'up' phase to the action that went down with this key). */
  handleKeyUp(e: Pick<KeyboardEvent, 'code'>): void {
    const id = this.down[e.code];
    if (id === undefined) return;
    delete this.down[e.code];
    this.bus.trigger(id, { source: 'keyboard', phase: 'up' });
  }

  /** Listens on a window/document; returns the detach function. */
  attach(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    const onDown = (e: Event) => {
      this.handleKeyDown(e as KeyboardEvent);
    };
    const onUp = (e: Event) => this.handleKeyUp(e as KeyboardEvent);
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    return () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
    };
  }
}
