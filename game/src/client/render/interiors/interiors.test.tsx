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
import { InteriorRoom, findPerson, panelSideOf, personBox, roomKey, ROOM_H, ROOM_W, useRoutePerson, type InteriorRoomDef } from './index';
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
