/**
 * The app's single shortcut manager (keyboard → actions with the player's bindings and the active
 * contexts). main.tsx attaches it to the window; the rebinding UI uses `capture()` on it.
 */
import { ShortcutManager } from '../input/shortcuts';
import { useSettings } from '../settings/store';
import { currentInputContexts } from './inputContext';

let manager: ShortcutManager | undefined;

/** The shared shortcut manager. */
export function getShortcutManager(): ShortcutManager {
  manager ??= new ShortcutManager({
    bindings: () => useSettings.getState().settings.controls.bindings,
    contexts: currentInputContexts,
  });
  return manager;
}
