/**
 * Big choices and plain stat lines (ARCHITECTURE §20 rules 1, 4 and 5).
 *   ChoiceCard — a large card button: a picture or icon, a title and ONE plain line saying what it does.
 *                `selected` makes it a toggle (aria-pressed); a disabled card shows its `reason` instead
 *                of the line, so it always says why.
 *   ChoiceGrid — lays cards out in even columns that fold on narrow windows.
 *   StatLine   — icon + word + number on one line ("Men at home ... 60").
 */
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  title: ReactNode;
  /** One plain line saying what the choice does. */
  line?: ReactNode;
  icon?: IconName;
  /** A picture (portrait, ship, building); shown instead of the icon. */
  picture?: ReactNode;
  /** Toggle state (aria-pressed); omit for a plain action card. */
  selected?: boolean;
  /** A small corner tag ("Leads", "12"). */
  badge?: ReactNode;
  /** Why it cannot be chosen; shown in place of the line while disabled. */
  reason?: ReactNode;
  /** 'lg' for a screen's main doors, 'md' (default) for pickers, 'sm' for dense pickers. */
  size?: 'sm' | 'md' | 'lg';
  /** 'row': picture left of the text (default for 'sm'/'md'); 'column': picture above. */
  layout?: 'row' | 'column';
}

/** A large, readable choice. */
export function ChoiceCard({ title, line, icon, picture, selected, badge, reason, size = 'md', layout, className, disabled, type = 'button', ...rest }: ChoiceCardProps): ReactElement {
  const dir = layout ?? (size === 'lg' ? 'column' : 'row');
  return (
    <button
      type={type}
      className={['choice', `choice-${size}`, `choice-${dir}`, selected && 'is-selected', className].filter(Boolean).join(' ')}
      aria-pressed={selected}
      disabled={disabled}
      {...rest}
    >
      {(picture || icon) && <span className="choice-picture">{picture ?? (icon ? <Icon name={icon} /> : null)}</span>}
      <span className="choice-text">
        <span className="choice-title">{title}</span>
        {disabled && reason ? <span className="choice-line choice-reason">{reason}</span> : line ? <span className="choice-line">{line}</span> : null}
      </span>
      {badge !== undefined && badge !== null && badge !== false && <span className="choice-badge">{badge}</span>}
      {selected !== undefined && (
        <span className="choice-check" aria-hidden="true">
          {selected && <Icon name="check" />}
        </span>
      )}
    </button>
  );
}

/** Even columns of choice cards. */
export function ChoiceGrid({ columns = 2, label, className, children }: { columns?: number; label?: string; className?: string; children?: ReactNode }): ReactElement {
  return (
    <div className={['choice-grid', className].filter(Boolean).join(' ')} style={{ ['--choice-cols' as string]: columns }} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export interface StatLineProps {
  icon?: IconName;
  label: ReactNode;
  value: ReactNode;
  tone?: 'good' | 'bad' | 'warn';
  className?: string;
  'data-testid'?: string;
}

/** Icon + word + number on one line. */
export function StatLine({ icon, label, value, tone, className, ...rest }: StatLineProps): ReactElement {
  return (
    <div className={['statline', tone && `tone-${tone}`, className].filter(Boolean).join(' ')} data-testid={rest['data-testid']}>
      {icon && <Icon name={icon} className="statline-icon" />}
      <span className="statline-label">{label}</span>
      <span className="statline-value num">{value}</span>
    </div>
  );
}
