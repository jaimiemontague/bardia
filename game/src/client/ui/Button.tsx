/**
 * Buttons: carved-oak plates with iron edges. Variants:
 *   primary   — gilded, the one action a panel wants (Begin, Confirm)
 *   secondary — oak plate (default)
 *   ghost     — text-only (toolbars, links)
 *   danger    — blood-red (irreversible actions; pair with a confirm step, §25.1 rule 6)
 * `keyHint` shows the binding of an action; `icon` puts a glyph before the label.
 * IconButton is square and REQUIRES a label (aria-label + tooltip).
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { KeyHint } from './KeyHint';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Icon after the label. */
  iconAfter?: IconName;
  /** Action id whose keybinding is shown as a keycap. */
  keyHint?: string;
  /** Shows a busy state and disables the button. */
  busy?: boolean;
  /** Pressed state for toggle buttons (aria-pressed). */
  pressed?: boolean;
  block?: boolean;
  children?: ReactNode;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** A text button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconAfter, keyHint, busy = false, pressed, block = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', busy && 'is-busy', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      {...rest}
    >
      {icon && <Icon name={icon} className="btn-icon" />}
      {children !== undefined && children !== null && <span className="btn-label">{children}</span>}
      {iconAfter && <Icon name={iconAfter} className="btn-icon" />}
      {keyHint && <KeyHint action={keyHint} className="btn-key" />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Accessible name, also shown as the tooltip. */
  label: string;
  /** Extra tooltip content under the label (e.g. a formula or a hint). */
  hint?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  keyHint?: string;
  pressed?: boolean;
  /** Small count badge (unread notifications). */
  badge?: number;
  /** Hide the tooltip (when a visible label sits next to the button). */
  noTooltip?: boolean;
}

/** A square icon-only button with a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, hint, variant = 'ghost', size = 'md', keyHint, pressed, badge, noTooltip = false, className, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      className={cx('btn', 'btn-icon-only', `btn-${variant}`, `btn-${size}`, className)}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} />
      {badge !== undefined && badge > 0 && (
        <span className="btn-badge num" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
  if (noTooltip) return button;
  return (
    <Tooltip
      content={
        <span className="tip-head">
          <span>{label}</span>
          {keyHint && <KeyHint action={keyHint} />}
          {hint && <span className="tip-hint">{hint}</span>}
        </span>
      }
    >
      {button}
    </Tooltip>
  );
});

/** A row of buttons with consistent spacing (right-aligned by default). */
export function ButtonRow({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'between' | 'center'; className?: string }): ReactElement {
  return <div className={cx('btn-row', `btn-row-${align}`, className)}>{children}</div>;
}
