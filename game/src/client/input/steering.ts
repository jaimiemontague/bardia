/**
 * Steering keys (owner play-test 2026-11-14): W A S D and the arrow keys steer the expedition in eight directions
 * (two keys held = a diagonal). The controller reports only CHANGES of the held direction, so the game sends one
 * `steer` command per change, never per frame. Keys are ignored while `blocked()` says a decision, an overlay or a
 * text field has the player's attention, and with Shift/Ctrl/Alt/Meta held (Shift + keys pans the chart). Every
 * held key is released on window blur, when the tab is hidden, and when `releaseAll()` is called (a decision
 * appears), so the ship never runs on by itself.
 */

/** The eight headings (north = up) or null (nothing held). */
export type SteerKeyDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

type Axis = 'up' | 'down' | 'left' | 'right';

/** KeyboardEvent.code → axis. */
export const STEER_CODES: Readonly<Record<string, Axis>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** The direction for a set of held axes (opposites cancel), or null. */
export function dirOf(held: ReadonlySet<Axis> | readonly Axis[]): SteerKeyDir | null {
  const has = (a: Axis) => (Array.isArray(held) ? held.includes(a) : (held as ReadonlySet<Axis>).has(a));
  const v = (has('down') ? 1 : 0) - (has('up') ? 1 : 0);
  const h = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);
  if (v === 0 && h === 0) return null;
  const ns = v < 0 ? 'n' : v > 0 ? 's' : '';
  const ew = h > 0 ? 'e' : h < 0 ? 'w' : '';
  return (ns + ew) as SteerKeyDir;
}

function isTextTarget(target: EventTarget | null): boolean {
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

export interface SteerKeysOptions {
  /** Called with the new direction whenever it changes (null: all released). */
  onChange(dir: SteerKeyDir | null): void;
  /** True while keys must not steer (a decision, an overlay, the console, a text field). */
  blocked?(): boolean;
}

type KeyLike = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat' | 'target'> & { preventDefault(): void };

export class SteerKeys {
  private readonly codes: Record<string, Axis> = {};
  private dir: SteerKeyDir | null = null;

  constructor(private readonly opts: SteerKeysOptions) {}

  /** The direction held now. */
  get current(): SteerKeyDir | null {
    return this.dir;
  }

  private emit(): void {
    const next = dirOf(Object.values(this.codes));
    if (next === this.dir) return;
    this.dir = next;
    this.opts.onChange(next);
  }

  /** Handles a keydown; returns true when it was a steering key it took. */
  keyDown(e: KeyLike): boolean {
    const axis = STEER_CODES[e.code];
    if (axis === undefined) return false;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (isTextTarget(e.target) || this.opts.blocked?.() === true) return false;
    e.preventDefault();
    if (e.repeat && Object.hasOwn(this.codes, e.code)) return true;
    this.codes[e.code] = axis;
    this.emit();
    return true;
  }

  /** Handles a keyup. */
  keyUp(e: Pick<KeyboardEvent, 'code'>): void {
    if (!Object.hasOwn(this.codes, e.code)) return;
    delete this.codes[e.code];
    this.emit();
  }

  /** Releases every held key (blur, a decision appears, the scene changes). */
  releaseAll(): void {
    for (const k of Object.keys(this.codes)) delete this.codes[k];
    this.emit();
  }

  /** Listens on a window; returns the detach function. */
  attach(target: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document?: Document }): () => void {
    const down = (e: Event) => void this.keyDown(e as KeyboardEvent);
    const up = (e: Event) => this.keyUp(e as KeyboardEvent);
    const blur = () => this.releaseAll();
    const vis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.releaseAll();
    };
    target.addEventListener('keydown', down, true);
    target.addEventListener('keyup', up, true);
    target.addEventListener('blur', blur);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', vis);
    return () => {
      target.removeEventListener('keydown', down, true);
      target.removeEventListener('keyup', up, true);
      target.removeEventListener('blur', blur);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', vis);
      this.releaseAll();
    };
  }
}
