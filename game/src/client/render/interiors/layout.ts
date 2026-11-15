/**
 * Pure layout and key logic of a room (unit-tested): which table places the people (the procedural painting's or
 * a final painting's), where a person's button sits as percentages of the picture box (the box always keeps the
 * 16:9 viewBox aspect, so a button never drifts off its person), which side a panel opens on, and what a key
 * press does.
 */
import type { PaintingVariant } from '../scenes/finalArt';
import { ROOM_H, ROOM_W, type InteriorPerson, type InteriorRoomDef, type PersonSpot } from './types';

/**
 * Where a person stands in the painting on screen: `variant` null for the procedural painting (the person's own
 * x/y/w/h), else the final painting's table for that variant, falling back to the base file's table.
 */
export function spotOf(room: Pick<InteriorRoomDef, 'final'>, person: InteriorPerson, variant: PaintingVariant | null): PersonSpot | undefined {
  if (variant === null || !room.final) return undefined;
  const own = variant === 'base' ? undefined : room.final[variant];
  return own && Object.hasOwn(own, person.id) ? own[person.id] : Object.hasOwn(room.final.base, person.id) ? room.final.base[person.id] : undefined;
}

/** The room's people placed for the painting on screen (see spotOf); same order and ids as `room.people`. */
export function placePeople(room: Pick<InteriorRoomDef, 'people' | 'final'>, variant: PaintingVariant | null): readonly InteriorPerson[] {
  if (variant === null || !room.final) return room.people;
  return room.people.map((p) => {
    const spot = spotOf(room, p, variant);
    return spot ? { ...p, ...spot } : p;
  });
}

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

/**
 * Where a person's name plate is centred when the table gives `plateAt`, as CSS percentages of the person's click
 * box (it may lie outside the box); null when the plate sits above or below as usual.
 */
export function plateSpot(p: Pick<InteriorPerson, 'x' | 'y' | 'w' | 'h' | 'plateAt'>): { left: number; top: number } | null {
  if (!p.plateAt) return null;
  const x0 = Math.max(0, p.x - p.w / 2);
  const x1 = Math.min(ROOM_W, p.x + p.w / 2);
  const y0 = Math.max(0, p.y - p.h);
  const y1 = Math.min(ROOM_H, p.y);
  return { left: ((p.plateAt[0] - x0) / Math.max(1, x1 - x0)) * 100, top: ((p.plateAt[1] - y0) / Math.max(1, y1 - y0)) * 100 };
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
