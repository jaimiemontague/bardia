// @vitest-environment jsdom
/**
 * The interior kit: person placement in the picture box, panel sides, the keys (digits, Esc closes the panel
 * first and leaves on the next press), deep links through the route params, and the rooms' own tables.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigation } from '../../app/navigation';
import { missingKeysSeen, t } from '../../i18n/index';
import { resetClientState } from '../../testing/clientTestKit';
import { InteriorRoom, findPerson, panelSideOf, personBox, placePeople, plateSpot, roomKey, ROOM_H, ROOM_W, spotOf, useRoutePerson, type InteriorRoomDef, type PersonSpot } from './index';
import { roomById, roomIds } from './registry';
import { greatHallRoom } from './rooms/greatHall';
import { smithyRoom } from './rooms/smithy';

const AMBIENCE = { hourOfDay: 12, season: 'summer', weather: { fog: false, wind: 'fresh', storm: false } } as const;

beforeEach(() => resetClientState());
afterEach(() => cleanup());

describe('layout', () => {
  it('places a person by percentage of the picture box, clamped inside it', () => {
    expect(personBox({ x: 800, y: 900, w: 160, h: 450 })).toEqual({ left: 45, top: 50, width: 10, height: 50 });
    const edge = personBox({ x: 20, y: 100, w: 100, h: 300 });
    expect(edge.left).toBe(0);
    expect(edge.top).toBe(0);
    expect(edge.width).toBeCloseTo((70 / ROOM_W) * 100);
  });

  it('opens the panel away from the person unless the table says otherwise', () => {
    expect(panelSideOf({ x: 400 })).toBe('right');
    expect(panelSideOf({ x: 1200 })).toBe('left');
    expect(panelSideOf({ x: 1200, panel: 'right' })).toBe('right');
  });

  it('every room keeps its people inside the safe middle of the picture, with unique ids and real strings', () => {
    expect(roomIds()).toEqual(expect.arrayContaining(['greatHall', 'smithy']));
    for (const id of roomIds()) {
      const room = roomById(id) as InteriorRoomDef;
      expect(room.people.length).toBeGreaterThan(0);
      expect(new Set(room.people.map((p) => p.id)).size).toBe(room.people.length);
      for (const p of room.people) {
        expect(p.x).toBeGreaterThanOrEqual(200);
        expect(p.x).toBeLessThanOrEqual(1400);
        expect(p.y).toBeLessThanOrEqual(ROOM_H);
        expect(p.y - p.h).toBeGreaterThanOrEqual(0);
        t(p.nameKey);
        t(p.greetingKey);
      }
      t(room.titleKey);
    }
    expect(missingKeysSeen().filter((k) => k.startsWith('hub.'))).toEqual([]);
  });
});

/** The share of the smaller of two click boxes that the other covers (0: apart, 1: one inside the other). */
function overlapShare(a: PersonSpot, b: PersonSpot): number {
  const w = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const h = Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

describe('final paintings', () => {
  it('every final table holds every person of its room, inside the picture, and the boxes barely overlap', () => {
    const ALL_ROOMS = ['greatHall', 'smithy', 'shipyard', 'market', 'meadHall', 'longhouse', 'seer', 'grove'];
    expect(roomIds()).toEqual(expect.arrayContaining(ALL_ROOMS));
    for (const id of ALL_ROOMS) {
      const room = roomById(id) as InteriorRoomDef;
      expect(room.final, `${id} has a table for its final painting`).toBeDefined();
      const tables = Object.entries(room.final ?? {});
      for (const [variant, table] of tables) {
        if (variant === 'base') expect(Object.keys(table).sort(), `${id}: the base table holds every person`).toEqual(room.people.map((p) => p.id).sort());
        // A season's table may leave people out (they stand where `base` puts them), but names nobody else.
        for (const pid of Object.keys(table)) expect(findPerson(room, pid), `${id}/${variant}: ${pid} is in the room`).toBeDefined();
        const spots = Object.entries(table);
        for (const [pid, s] of spots) {
          const where = `${id}/${variant}/${pid}`;
          expect(s.w, where).toBeGreaterThan(0);
          expect(s.h, where).toBeGreaterThan(0);
          expect(s.x - s.w / 2, where).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w / 2, where).toBeLessThanOrEqual(ROOM_W);
          expect(s.y - s.h, where).toBeGreaterThanOrEqual(0);
          expect(s.y, where).toBeLessThanOrEqual(ROOM_H);
          // Feet inside the safe middle, where narrow windows never crop.
          expect(s.x, where).toBeGreaterThanOrEqual(200);
          expect(s.x, where).toBeLessThanOrEqual(1400);
          if (s.plateAt) {
            expect(s.plateAt[0], where).toBeGreaterThan(0);
            expect(s.plateAt[0], where).toBeLessThan(ROOM_W);
            expect(s.plateAt[1], where).toBeGreaterThan(0);
            expect(s.plateAt[1], where).toBeLessThan(ROOM_H);
          }
        }
        for (let i = 0; i < spots.length; i++)
          for (let j = i + 1; j < spots.length; j++) {
            const [a, sa] = spots[i] as [string, PersonSpot];
            const [b, sb] = spots[j] as [string, PersonSpot];
            expect(overlapShare(sa, sb), `${id}/${variant}: ${a} and ${b} overlap`).toBeLessThan(0.1);
          }
      }
    }
  });

  it('places people by the painting on screen: drawn, the base file, or a season falling back to base', () => {
    const room: Pick<InteriorRoomDef, 'people' | 'final'> = {
      people: [
        { id: 'a', x: 400, y: 800, w: 200, h: 400, nameKey: 'a', greetingKey: 'a', plate: 'below', wide: true },
        { id: 'b', x: 1200, y: 800, w: 200, h: 400, nameKey: 'b', greetingKey: 'b' },
      ],
      final: {
        base: { a: { x: 500, y: 850, w: 220, h: 500 }, b: { x: 1100, y: 840, w: 240, h: 520, plateAt: [1300, 300] } },
        winter: { a: { x: 520, y: 860, w: 220, h: 500, panel: 'left' } },
      },
    };
    expect(placePeople(room, null)).toBe(room.people);
    const base = placePeople(room, 'base');
    expect(base.map((p) => [p.id, p.x, p.y])).toEqual([
      ['a', 500, 850],
      ['b', 1100, 840],
    ]);
    // Fields the spot does not give stay as the person says (names, wide, plate side).
    expect(base[0]).toMatchObject({ nameKey: 'a', wide: true, plate: 'below' });
    const winter = placePeople(room, 'winter');
    expect(winter.map((p) => [p.id, p.x])).toEqual([
      ['a', 520],
      ['b', 1100],
    ]);
    expect(panelSideOf(winter[0] as PersonSpot)).toBe('left');
    // A season with no table of its own uses the base table.
    expect(placePeople(room, 'autumn').map((p) => p.x)).toEqual([500, 1100]);
    expect(spotOf(room, room.people[1] as never, 'winter')).toBe(room.final?.base['b']);
    // A room with no final table keeps the drawn places on any painting.
    expect(placePeople({ people: room.people }, 'base')).toBe(room.people);
    // plateAt as percentages of the click box (outside it when the point is).
    expect(plateSpot(base[1] as PersonSpot)).toEqual({ left: ((1300 - 980) / 240) * 100, top: ((300 - 320) / 520) * 100 });
    expect(plateSpot(base[0] as PersonSpot)).toBeNull();
  });

  it('the stage uses the drawn places while only the placeholder exists', () => {
    render(<InteriorRoom room={smithyRoom} ambience={AMBIENCE} panel={() => <p>work</p>} onLeave={() => {}} />);
    expect(screen.getByTestId('interior-smithy').getAttribute('data-art')).toBe('drawn');
    const b = screen.getByTestId('interior-person-smith');
    const box = personBox(smithyRoom.people[0] as PersonSpot);
    expect(b.style.left).toBe(`${box.left}%`);
  });
});

describe('keys', () => {
  it('digits pick a person, Escape closes the panel first and leaves on the next press', () => {
    expect(roomKey('1', greatHallRoom, null)).toEqual({ kind: 'open', person: 'hirdmaster' });
    expect(roomKey('3', greatHallRoom, null)).toEqual({ kind: 'open', person: 'lawspeaker' });
    expect(roomKey('4', greatHallRoom, null)).toEqual({ kind: 'none' });
    expect(roomKey('Escape', greatHallRoom, 'steward')).toEqual({ kind: 'closePanel' });
    expect(roomKey('Escape', greatHallRoom, null)).toEqual({ kind: 'leave' });
    expect(roomKey('Enter', greatHallRoom, null)).toEqual({ kind: 'none' });
    expect(findPerson(greatHallRoom, 'nobody')).toBeUndefined();
  });
});

describe('the room stage', () => {
  it('shows every person as a named button, opens a panel on click and walks back out with Escape', () => {
    const onLeave = vi.fn();
    render(<InteriorRoom room={greatHallRoom} ambience={AMBIENCE} panel={(id) => <p data-testid="panel-body">{id}</p>} onLeave={onLeave} stageTestId="great-hall" />);
    expect(screen.getByTestId('interior-greatHall')).toBeTruthy();
    expect(screen.getByTestId('great-hall')).toBeTruthy();
    for (const p of greatHallRoom.people) {
      const b = screen.getByTestId(`interior-person-${p.id}`);
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('aria-label')).toMatch(/^Speak with The /);
      expect(b.textContent).toContain(t(p.nameKey));
    }
    expect(screen.queryByTestId('interior-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('interior-person-steward'));
    const panel = screen.getByTestId('interior-panel');
    expect(panel.textContent).toContain('The Steward');
    expect(screen.getByTestId('panel-body').textContent).toBe('steward');
    expect(screen.getByTestId('interior-greatHall').className).toContain('side-right');
    // Escape: the panel first, then the building.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('interior-panel')).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('digits open a person; Back returns to the room; Leave goes back to the village', () => {
    const onLeave = vi.fn();
    render(<InteriorRoom room={greatHallRoom} ambience={AMBIENCE} panel={(id) => <p>{id}</p>} onLeave={onLeave} />);
    fireEvent.keyDown(document.body, { key: '3' });
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('lawspeaker');
    expect(screen.getByTestId('interior-greatHall').className).toContain('side-left');
    fireEvent.keyDown(document.body, { key: '1' });
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('hirdmaster');
    fireEvent.click(screen.getByTestId('interior-back'));
    expect(screen.queryByTestId('interior-panel')).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('interior-leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('a deep link opens with the named person’s panel; an unknown name opens the bare room', () => {
    const { unmount } = render(<InteriorRoom room={smithyRoom} ambience={AMBIENCE} initialPerson="smith" panel={() => <p>work</p>} onLeave={() => {}} />);
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('smith');
    unmount();
    render(<InteriorRoom room={smithyRoom} ambience={AMBIENCE} initialPerson="nobody" panel={() => <p>work</p>} onLeave={() => {}} />);
    expect(screen.queryByTestId('interior-panel')).toBeNull();
  });

  it('keeps the open person in the route params', () => {
    function Routed({ params }: { params?: Readonly<Record<string, string>> }) {
      const [person, setPerson] = useRoutePerson(greatHallRoom, ['building.greatHall'], params);
      return <InteriorRoom room={greatHallRoom} ambience={AMBIENCE} person={person} onPersonChange={setPerson} panel={(id) => <p>{id}</p>} onLeave={() => {}} />;
    }
    act(() => useNavigation.getState().open('building.greatHall', { person: 'steward' }));
    render(<Routed params={{ person: 'steward' }} />);
    expect(screen.getByTestId('interior-panel').getAttribute('data-person')).toBe('steward');
    fireEvent.click(screen.getByTestId('interior-person-lawspeaker'));
    expect(useNavigation.getState().stack.at(-1)?.params).toEqual({ person: 'lawspeaker' });
    fireEvent.click(screen.getByTestId('interior-back'));
    expect(useNavigation.getState().stack.at(-1)?.params).toEqual({});
  });
});
