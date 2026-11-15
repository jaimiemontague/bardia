/**
 * Keycap hints. `<KeyHint action="open.character" />` shows the player's CURRENT binding for an
 * action (rebinding updates every hint); `<KeyHint combo="Ctrl+KeyS" />` shows a literal combo.
 */
import type { ReactElement } from 'react';
import { comboLabel } from '../input/bindings';
import { useSettings } from '../settings/store';

export interface KeyHintProps {
  /** Action id whose first binding is shown. */
  action?: string;
  /** A literal combo ("Ctrl+KeyS"); used when `action` is absent. */
  combo?: string;
  className?: string;
}

/** The first binding (combo string) of an action, or undefined when unbound. */
export function useBinding(action: string | undefined): string | undefined {
  return useSettings((s) => (action ? s.settings.controls.bindings[action]?.[0] : undefined));
}

/** The label of the first binding of an action ('' when unbound). */
export function useBindingLabel(action: string | undefined): string {
  const combo = useBinding(action);
  return combo ? comboLabel(combo) : '';
}

/** One keycap label per part of a combo ("Ctrl+NumpadAdd" → ["Ctrl", "Num +"]). */
export function comboParts(combo: string): string[] {
  return combo
    .split('+')
    .filter((p) => p.length > 0)
    .map((p) => comboLabel(p));
}

/** A keycap (renders nothing when the action is unbound). */
export function KeyHint({ action, combo, className }: KeyHintProps): ReactElement | null {
  const bound = useBinding(action);
  const raw = action ? bound : combo;
  if (!raw) return null;
  return (
    <span className={['keyhint', className].filter(Boolean).join(' ')} aria-hidden="true">
      {comboParts(raw).map((part, i) => (
        <kbd key={i}>{part}</kbd>
      ))}
    </span>
  );
}
