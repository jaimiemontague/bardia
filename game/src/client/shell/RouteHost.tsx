/**
 * Hosts navigation routes: the top in-game overlay route (top-bar screens, options, the game menu)
 * and, outside a campaign, the menu page. Screens draw their own frame; the host supplies the
 * backdrop, focus scope and `close()`. Routes without a screen show a "Coming soon" card.
 *
 * A room (a screen with `staysUnder`, i.e. a building interior) stays drawn, inert, under an overlay or
 * modal route opened from it, so the ledger opens over the hall and not over the village.
 */
import { useEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useNavigation, type Route } from '../app/navigation';
import { RouteActiveContext } from '../app/routeActive';
import type { ScreenRegistry } from '../app/screenRegistry';
import { ComingSoonModal, ComingSoonPage } from './ComingSoon';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focuses into the host when it appears, and again whenever it becomes the active route. */
function useInitialFocus(key: number, active = true): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    if (root.contains(document.activeElement)) return;
    // Prefer an explicit autofocus target; otherwise the first control that is not a close button.
    const target =
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => !el.matches('[aria-label][data-testid$="close"], .modal-close')) ??
      root;
    if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [key, active]);
  return ref;
}

/** Attributes of a route kept under the top one: out of the tab order, the accessibility tree and the pointer's reach. */
const UNDER: Readonly<Record<string, string>> = { inert: '', 'aria-hidden': 'true' };

function OverlayRoute({ route, registry, active }: { route: Route; registry: ScreenRegistry; active: boolean }): ReactElement {
  const close = () => useNavigation.getState().close(route.key);
  const screen = registry.forRoute(route.id);
  const ref = useInitialFocus(route.key, active);
  if (!screen) return <ComingSoonModal routeId={route.id} onClose={close} />;
  const Component = screen.component;
  const layout = screen.layout ?? 'overlay';
  return (
    <div
      ref={ref}
      className={`route-host layout-${layout}${active ? '' : ' is-under'}`}
      data-focus-scope={active ? 'modal' : undefined}
      data-route={route.id}
      data-testid={`route-${route.id}`}
      {...(active ? {} : UNDER)}
    >
      <RouteActiveContext.Provider value={active}>
        <Component params={route.params} close={close} />
      </RouteActiveContext.Provider>
    </div>
  );
}

/** The room that stays drawn under the top route, if the top route was opened over one. */
export function roomUnder(stack: readonly Route[], registry: ScreenRegistry): Route | undefined {
  const top = stack[stack.length - 1];
  if (!top) return undefined;
  const topScreen = registry.forRoute(top.id);
  const topLayout = topScreen?.layout ?? 'overlay';
  // A room or a full-screen page covers everything: nothing shows beneath it.
  if (topScreen?.staysUnder || topLayout === 'fullscreen' || topLayout === 'scene') return undefined;
  for (let i = stack.length - 2; i >= 0; i--) {
    const route = stack[i];
    if (route && registry.forRoute(route.id)?.staysUnder) return route;
  }
  return undefined;
}

/** The top in-game route, over the room it was opened from when there is one. */
export function RouteHost({ registry }: { registry: ScreenRegistry }): ReactElement | null {
  const stack = useNavigation((s) => s.stack);
  const top = stack[stack.length - 1];
  if (!top) return null;
  const under = roomUnder(stack, registry);
  return (
    <>
      {under && <OverlayRoute key={under.key} route={under} registry={registry} active={false} />}
      <OverlayRoute key={top.key} route={top} registry={registry} active />
    </>
  );
}

/** The menu page shown while no campaign is open. */
export function MenuHost({ registry }: { registry: ScreenRegistry }): ReactElement {
  const page = useNavigation((s) => s.menuPage);
  const ref = useInitialFocus(page.key);
  const screen = registry.forRoute(page.id);
  const back = () => useNavigation.getState().showMenu('mainMenu');
  return (
    <div ref={ref} className="menu-host" data-route={page.id} data-testid={`menu-${page.id}`}>
      {screen ? <screen.component key={page.key} params={page.params} close={back} /> : <ComingSoonPage routeId={page.id} onBack={back} />}
    </div>
  );
}
