/**
 * Controller groundwork (design §25.6): polls the Gamepad API (standard mapping) once per frame
 * and turns button edges into actions on the action bus. Analog sticks are published as
 * `gamepadAxes` for renderers (cursor/steering) to read; the D-pad moves keyboard focus between
 * controls so every menu is usable with a controller.
 *
 *   A → ui.confirm   B → ui.back   X → duel.strike   Y → ui.secondary
 *   LB → duel.block  RB → battle.radial   LT/RT → time.slower/time.faster
 *   Back → open.inbox   Start → time.togglePause   D-pad → ui.nav{Up,Down,Left,Right}
 */
import { actionBus, type ActionBus } from './actions';

/** Standard-mapping button index → action id. */
export const GAMEPAD_BUTTON_ACTIONS: Readonly<Record<number, string>> = {
  0: 'ui.confirm',
  1: 'ui.back',
  2: 'duel.strike',
  3: 'ui.secondary',
  4: 'duel.block',
  5: 'battle.radial',
  6: 'time.slower',
  7: 'time.faster',
  8: 'open.inbox',
  9: 'time.togglePause',
  12: 'ui.navUp',
  13: 'ui.navDown',
  14: 'ui.navLeft',
  15: 'ui.navRight',
};

/** Latest stick values (−1…1, dead-zoned), read by renderers each frame. */
export const gamepadAxes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, connected: false };

const DEAD_ZONE = 0.18;
/** Repeat delay/interval for held D-pad buttons (ms). */
const REPEAT_DELAY = 380;
const REPEAT_INTERVAL = 120;

function deadZone(v: number | undefined): number {
  const x = v ?? 0;
  return Math.abs(x) < DEAD_ZONE ? 0 : x;
}

interface PadLike {
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
  mapping?: string;
}

/** Edge detector for one or more pads (pure enough to unit-test with fake pads). */
export class GamepadPoller {
  private prev: boolean[] = [];
  private heldSince: Record<number, number> = {};
  private lastRepeat: Record<number, number> = {};

  constructor(private readonly bus: ActionBus = actionBus) {}

  /** Processes one frame of pad state at time `now` (ms). */
  poll(pads: readonly (PadLike | null)[], now: number): void {
    const pressed: boolean[] = [];
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    let connected = false;
    for (const pad of pads) {
      if (!pad) continue;
      connected = true;
      pad.buttons.forEach((b, i) => {
        if (b.pressed) pressed[i] = true;
      });
      lx = lx || deadZone(pad.axes[0]);
      ly = ly || deadZone(pad.axes[1]);
      rx = rx || deadZone(pad.axes[2]);
      ry = ry || deadZone(pad.axes[3]);
    }
    gamepadAxes.leftX = lx;
    gamepadAxes.leftY = ly;
    gamepadAxes.rightX = rx;
    gamepadAxes.rightY = ry;
    gamepadAxes.connected = connected;
    const count = Math.max(pressed.length, this.prev.length);
    for (let i = 0; i < count; i++) {
      const now_ = pressed[i] === true;
      const before = this.prev[i] === true;
      const action = GAMEPAD_BUTTON_ACTIONS[i];
      if (!action) continue;
      if (now_ && !before) {
        this.heldSince[i] = now;
        this.lastRepeat[i] = now;
        this.bus.trigger(action, { source: 'gamepad', phase: 'down' });
      } else if (!now_ && before) {
        delete this.heldSince[i];
        this.bus.trigger(action, { source: 'gamepad', phase: 'up' });
      } else if (now_ && before && i >= 12 && i <= 15) {
        const since = this.heldSince[i] ?? now;
        const last = this.lastRepeat[i] ?? now;
        if (now - since >= REPEAT_DELAY && now - last >= REPEAT_INTERVAL) {
          this.lastRepeat[i] = now;
          this.bus.trigger(action, { source: 'gamepad', phase: 'down', repeat: true });
        }
      }
    }
    this.prev = pressed;
  }
}

/** Starts polling navigator.getGamepads() every animation frame; returns the stop function. */
export function startGamepadPolling(bus: ActionBus = actionBus, enabled: () => boolean = () => true): () => void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return () => {};
  const poller = new GamepadPoller(bus);
  let raf = 0;
  let active = true;
  const frame = (t: number) => {
    if (!active) return;
    if (enabled()) {
      try {
        poller.poll(navigator.getGamepads(), t);
      } catch {
        // Some browsers throw when the page is not focused.
      }
    }
    raf = window.requestAnimationFrame(frame);
  };
  raf = window.requestAnimationFrame(frame);
  return () => {
    active = false;
    window.cancelAnimationFrame(raf);
  };
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves focus to the nearest focusable element in a direction (controller/arrow navigation). */
export function moveFocus(direction: 'up' | 'down' | 'left' | 'right', root: ParentNode = document): boolean {
  const scope = (document.querySelector('[data-focus-scope="modal"]:last-of-type') as ParentNode | null) ?? root;
  const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) return false;
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    items[0]?.focus();
    return true;
  }
  const a = current.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === current) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const forward = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    if (forward <= 1) continue;
    const lateral = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = forward + lateral * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    return true;
  }
  return false;
}
