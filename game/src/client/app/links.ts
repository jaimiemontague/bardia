/**
 * Following notification links ("Go to …", §25.9): screen links open a route; characters open the
 * character sheet; everything else asks the scene (the map) to focus the entity.
 */
import type { EntityLink } from '@sim/core/events';
import { useNavigation } from './navigation';

/** Locale key for a link's "Go to" label. */
export function linkLabelKey(link: EntityLink): string {
  return `ui.link.${link.kind}`;
}

/** Acts on a link. */
export function followLink(link: EntityLink): void {
  const nav = useNavigation.getState();
  if (link.kind === 'screen' && link.id) {
    nav.open(link.id);
    return;
  }
  if (link.kind === 'character' && link.id) {
    nav.open('character', { id: link.id });
    return;
  }
  nav.reset();
  nav.requestFocus(link);
}
