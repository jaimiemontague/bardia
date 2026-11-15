/**
 * Pure layout and key logic of a room (unit-tested): where a person's button sits as percentages of the
 * picture box (the box always keeps the 16:9 viewBox aspect, so a button never drifts off its person), which
 * side a panel opens on, and what a key press does.
 */
import { ROOM_H, ROOM_W, type InteriorPerson, type InteriorRoomDef } from './types';

/** A person's click box as CSS percentages of the picture box. */
export interface PersonBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The click box of a person, as percentages of the picture (clamped inside it). */
export function personBox(p: Pick<InteriorPerson, 'x' | 'y' | 'w' | 'h'>): PersonBox {
  const x0 = Math.max(0, p.x - p.w / 2);
  const x1 = Math.min(ROOM_W, p.x + p.w / 2);
  const y0 = Math.max(0, p.y - p.h);
  const y1 = Math.min(ROOM_H, p.y);
  return {
    left: (x0 / ROOM_W) * 100,
    top: (y0 / ROOM_H) * 100,
    width: ((x1 - x0) / ROOM_W) * 100,
    height: ((y1 - y0) / ROOM_H) * 100,
  };
}

/** The side a person's panel opens on: as the table says, else away from the person. */
export function panelSideOf(p: Pick<InteriorPerson, 'x' | 'panel'>): 'left' | 'right' {
  if (p.panel === 'left' || p.panel === 'right') return p.panel;
  return p.x > ROOM_W / 2 ? 'left' : 'right';
}

/** The person with an id in a room (undefined for unknown ids, so a stale deep link opens the bare room). */
export function findPerson(room: Pick<InteriorRoomDef, 'people'>, id: unknown): InteriorPerson | undefined {
  return typeof id === 'string' ? room.people.find((p) => p.id === id) : undefined;
}

/** What a key does in a room. */
export type RoomKeyAction = { kind: 'open'; person: string } | { kind: 'closePanel' } | { kind: 'leave' } | { kind: 'none' };

/**
 * A key press in a room: digits 1..n open that person's panel, Escape closes the open panel first and leaves
 * the building on the next press. Everything else (Tab, Enter, arrows) is left to the focused control.
 */
export function roomKey(key: string, room: Pick<InteriorRoomDef, 'people'>, open: string | null): RoomKeyAction {
  if (key === 'Escape') return open !== null ? { kind: 'closePanel' } : { kind: 'leave' };
  if (/^[1-9]$/.test(key)) {
    const p = room.people[Number(key) - 1];
    return p ? { kind: 'open', person: p.id } : { kind: 'none' };
  }
  return { kind: 'none' };
}
