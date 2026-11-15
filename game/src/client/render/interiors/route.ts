/**
 * Keeping a room's open person in its route params, so a deep link (`navigation.open('building.greatHall',
 * { person: 'steward' })`) opens that panel, and coming back from a screen opened on top (the ledger, the
 * planner) shows the panel the player left.
 */
import { useState } from 'react';
import { useNavigation, type RouteParams } from '../../app/navigation';
import { findPerson } from './layout';
import type { InteriorRoomDef } from './types';

/**
 * The open person of a room hosted on a route: starts from `params.person` (unknown ids: none) and writes every
 * change back into the route's params while that route is on top. Returns [person, setPerson] for
 * `<InteriorRoom person={…} onPersonChange={…}>`.
 */
export function useRoutePerson(room: Pick<InteriorRoomDef, 'people'>, routeIds: readonly string[], params: RouteParams | undefined): [string | null, (id: string | null) => void] {
  const [person, setPerson] = useState<string | null>(() => findPerson(room, params?.['person'])?.id ?? null);
  const set = (id: string | null) => {
    setPerson(id);
    const nav = useNavigation.getState();
    const top = nav.stack[nav.stack.length - 1];
    if (top && routeIds.includes(top.id)) nav.open(top.id, id ? { person: id } : {});
  };
  return [person, set];
}
