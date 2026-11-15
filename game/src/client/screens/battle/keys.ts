/**
 * The battle's direct-control keys (owner play-test 2026-11-15), kept free of React so they are unit
 * tested with a headless controller:
 *   W A S D / arrows  drive the selected squads (two keys = a diagonal; let go = halt and hold);
 *   Shift (held)      run while driving (fatigue as any run);
 *   Space             charge the enemy ahead / hold to draw an aimed volley, let go to loose;
 *   P                 pause or resume;
 *   Tab / Shift+Tab   the next / previous squad alone;
 *   C                 the camera goes back to the squads and follows them.
 * The held direction is read with the world map's steering table (`STEER_CODES`, `dirOf`), but
 * Shift does not block it here: Shift with a direction runs. Only changes reach the controller
 * (one engine order per change, never per frame).
 */
import { dirOf, STEER_CODES, type SteerKeyDir } from '../../input/steering';
import type { BattleController, DriveStep } from './controller';

type Axis = (typeof STEER_CODES)[string];

/** The parts of a KeyboardEvent the battle keys read. */
export type BattleKeyEvent = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>;

const STEPS: Readonly<Record<SteerKeyDir, [DriveStep, DriveStep]>> = {
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [-1, -1],
};

/** Screen step of a held direction (0, 0 for none). */
export function driveStepOf(dir: SteerKeyDir | null): [DriveStep, DriveStep] {
  return dir === null ? [0, 0] : STEPS[dir];
}

/** Turns key presses into controller calls for one battle. */
export class BattleKeys {
  private readonly held: Record<string, Axis> = {};
  private shift = false;
  private space = false;

  constructor(private readonly c: BattleController) {}

  /** True while Space is held (the archers are drawing). */
  get attacking(): boolean {
    return this.space;
  }

  private sync(): void {
    const [dx, dy] = driveStepOf(dirOf(Object.values(this.held)));
    this.c.drive(dx, dy, this.shift);
  }

  /** Handles a keydown; returns true when the key was a battle key it took (the caller stops it). */
  keyDown(e: BattleKeyEvent): boolean {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.shift = true;
      if (Object.keys(this.held).length > 0) this.sync();
      return false;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const axis = STEER_CODES[e.code];
    if (axis !== undefined) {
      if (e.repeat && Object.hasOwn(this.held, e.code)) return true;
      this.held[e.code] = axis;
      this.shift = e.shiftKey;
      this.sync();
      return true;
    }
    switch (e.code) {
      case 'Space':
        if (!e.repeat && !this.space) {
          this.space = true;
          this.c.attackDown();
        }
        return true;
      case 'KeyP':
        if (!e.repeat) this.c.togglePause();
        return true;
      case 'Tab':
        this.c.selectNext(e.shiftKey ? -1 : 1);
        return true;
      case 'KeyC':
        if (e.shiftKey) return false;
        this.c.recentre();
        return true;
      default:
        return false;
    }
  }

  /** Handles a keyup; returns true when it released a battle key. */
  keyUp(e: Pick<KeyboardEvent, 'code'>): boolean {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.shift = false;
      if (Object.keys(this.held).length > 0) this.sync();
      return false;
    }
    if (Object.hasOwn(this.held, e.code)) {
      delete this.held[e.code];
      this.sync();
      return true;
    }
    if (e.code === 'Space' && this.space) {
      this.space = false;
      this.c.attackUp();
      return true;
    }
    return false;
  }

  /** Lets go of everything (a card opened, the window lost focus): the squads halt, a drawn volley is dropped. */
  releaseAll(): void {
    for (const k of Object.keys(this.held)) delete this.held[k];
    this.shift = false;
    this.space = false;
    this.c.stopDriving();
  }
}
