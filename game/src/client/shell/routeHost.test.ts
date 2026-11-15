/** Which room stays drawn under the top route (RouteHost: the ledger opens over the hall, not over the village). */
import { describe, expect, it } from 'vitest';
import type { Route } from '../app/navigation';
import { ScreenRegistry, normalizeDescriptor } from '../app/screenRegistry';
import { roomUnder } from './RouteHost';

function Nothing(): null {
  return null;
}

function registry(): ScreenRegistry {
  const defs = [
    { id: 'hall', route: 'building.greatHall', component: Nothing, layout: 'overlay', staysUnder: true },
    { id: 'seer', route: 'building.seer', component: Nothing, layout: 'overlay', staysUnder: true },
    { id: 'ledger', route: 'ledger', component: Nothing, layout: 'overlay' },
    { id: 'character', route: 'character', component: Nothing },
    { id: 'planner', route: 'expeditionPlanner', component: Nothing, layout: 'fullscreen' },
  ];
  const screens = defs.map((d) => normalizeDescriptor(d, 'test'));
  return new ScreenRegistry(screens.filter((s): s is NonNullable<typeof s> => s !== undefined));
}

function stack(...ids: string[]): Route[] {
  return ids.map((id, i) => ({ id, key: i + 1 }));
}

describe('roomUnder', () => {
  const reg = registry();

  it('keeps the room under a panel opened from it', () => {
    expect(roomUnder(stack('building.greatHall', 'ledger'), reg)?.id).toBe('building.greatHall');
  });

  it('finds the room below another panel too', () => {
    expect(roomUnder(stack('building.greatHall', 'ledger', 'character'), reg)?.id).toBe('building.greatHall');
  });

  it('shows nothing under a room, a full-screen page or a panel opened from the village', () => {
    expect(roomUnder(stack('building.greatHall'), reg)).toBeUndefined();
    expect(roomUnder(stack('building.greatHall', 'building.seer'), reg)).toBeUndefined();
    expect(roomUnder(stack('building.greatHall', 'expeditionPlanner'), reg)).toBeUndefined();
    expect(roomUnder(stack('ledger'), reg)).toBeUndefined();
    expect(roomUnder([], reg)).toBeUndefined();
  });

  it('reads staysUnder from the descriptor', () => {
    expect(reg.forRoute('building.greatHall')?.staysUnder).toBe(true);
    expect(reg.forRoute('ledger')?.staysUnder).toBe(false);
  });
});
