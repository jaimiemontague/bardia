/**
 * Modal dialog: portalled, focus-trapped, labelled by its title, restores focus on close.
 * Escape (the player's 'ui.back' binding) closes a dismissible modal; the newest modal wins because
 * action handlers run newest-first. `data-focus-scope="modal"` lets controller D-pad navigation stay
 * inside the dialog.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAction } from '../input/actions';
import { comboFromEvent } from '../input/bindings';
import { useSettings } from '../settings/store';
import { useT } from '../i18n/index';
import { Frame, type FrameVariant } from './Frame';
import { IconButton } from './Button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  open: boolean;
  onClose?(): void;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Escape / close button / backdrop click close it (default true when onClose is given). */
  dismissible?: boolean;
  /** 'critical' draws a blood-red frame (holding attacked, death, capture). */
  tone?: 'default' | 'critical' | 'important';
  variant?: FrameVariant;
  className?: string;
  /** Selector or element focused on open (default: [data-autofocus], then the first control). */
  initialFocus?: string;
  /**
   * Stacking layer: 'dialog' (default) sits above everything; 'decision' sits under overlay screens
   * so the game menu, options and ledgers can be opened while a decision waits.
   */
  layer?: 'dialog' | 'decision';
  'data-testid'?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
}

/** A centred dialog over a dimmed backdrop. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissible,
  tone = 'default',
  variant = 'oak',
  className,
  initialFocus,
  layer = 'dialog',
  ...rest
}: ModalProps): ReactElement | null {
  const t = useT();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const canDismiss = (dismissible ?? true) && onClose !== undefined;
  const backBindings = useSettings((s) => s.settings.controls.bindings['ui.back'] ?? ['Escape']);

  useAction(
    'ui.back',
    () => {
      if (!canDismiss) return false;
      onClose?.();
      return true;
    },
    open,
  );

  useEffect(() => {
    if (!open) return undefined;
    const previously = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    if (root) {
      const target =
        (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ??
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        focusables(root).find((el) => !el.classList.contains('modal-close')) ??
        root;
      target.focus({ preventScroll: true });
    }
    return () => {
      if (previously && typeof previously.focus === 'function' && document.contains(previously)) previously.focus({ preventScroll: true });
    };
  }, [open, initialFocus]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (backBindings.includes(comboFromEvent(e.nativeEvent))) {
      if (canDismiss) {
        e.stopPropagation();
        e.preventDefault();
        onClose?.();
      }
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = focusables(dialog.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={['modal-backdrop', `modal-tone-${tone}`, `modal-layer-${layer}`].join(' ')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canDismiss) onClose?.();
      }}
    >
      <div
        ref={dialog}
        role={tone === 'critical' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={['modal', `modal-${size}`, className].filter(Boolean).join(' ')}
        data-focus-scope="modal"
        data-testid={rest['data-testid']}
        onKeyDown={onKeyDown}
      >
        <Frame
          variant={variant}
          title={title}
          titleId={titleId}
          subtitle={subtitle}
          ornate
          className={tone !== 'default' ? `frame-tone-${tone}` : undefined}
          actions={canDismiss ? <IconButton className="modal-close" icon="close" label={t('ui.common.close')} keyHint="ui.back" onClick={() => onClose?.()} /> : undefined}
          footer={footer}
        >
          {children}
        </Frame>
      </div>
    </div>,
    document.body,
  );
}
