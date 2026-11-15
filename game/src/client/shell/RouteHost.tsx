/**
 * Hosts navigation routes: the top in-game overlay route (top-bar screens, options, the game menu)
 * and, outside a campaign, the menu page. Screens draw their own frame; the host supplies the
 * backdrop, focus scope and `close()`. Routes without a screen show a "Coming soon" card.
 */
import { useEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useNavigation, type Route } from '../app/navigation';
import type { ScreenRegistry } from '../app/screenRegistry';
import { ComingSoonModal, ComingSoonPage } from './ComingSoon';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useInitialFocus(key: number): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (root.contains(document.activeElement)) return;
    // Prefer an explicit autofocus target; otherwise the first control that is not a close button.
    const target =
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => !el.matches('[aria-label][data-testid$="close"], .modal-close')) ??
      root;
    if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [key]);
  return ref;
}

function OverlayRoute({ route, registry }: { route: Route; registry: ScreenRegistry }): ReactElement {
  const close = () => useNavigation.getState().close(route.key);
  const screen = registry.forRoute(route.id);
  const ref = useInitialFocus(route.key);
  if (!screen) return <ComingSoonModal routeId={route.id} onClose={close} />;
  const Component = screen.component;
  const layout = screen.layout ?? 'overlay';
  return (
    <div ref={ref} className={`route-host layout-${layout}`} data-focus-scope="modal" data-route={route.id} data-testid={`route-${route.id}`}>
      <Component params={route.params} close={close} />
    </div>
  );
}

/** The top in-game route (only the top one is shown). */
export function RouteHost({ registry }: { registry: ScreenRegistry }): ReactElement | null {
  const top = useNavigation((s) => s.stack[s.stack.length - 1]);
  if (!top) return null;
  return <OverlayRoute key={top.key} route={top} registry={registry} />;
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
