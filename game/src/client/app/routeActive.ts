/**
 * Whether a route screen is the one the player is looking at. A room (a screen with `staysUnder`) stays drawn
 * under a panel opened from it (the ledger over the Great Hall); while it is underneath it is not active and
 * must not answer keys.
 */
import { createContext, useContext } from 'react';

/** True for the top route (and for anything rendered outside the route host). */
export const RouteActiveContext = createContext(true);

/** True while the calling screen is the top route. */
export function useRouteActive(): boolean {
  return useContext(RouteActiveContext);
}
