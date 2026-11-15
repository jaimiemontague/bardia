/**
 * Disclosure ("Details"): a show/hide section for the numbers ARCHITECTURE §20 rule 1 moves out of view.
 * The toggle is a real button (aria-expanded / aria-controls); the content stays mounted while hidden
 * (`hidden` attribute) so its state survives closing and tests can still find what it holds.
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { useT } from '../i18n/index';
import { Icon } from './Icon';

export interface DisclosureProps {
  /** The toggle's text (default: "Details"). */
  summary?: ReactNode;
  /** Text on the toggle while open (default: the same summary). */
  openSummary?: ReactNode;
  /** Uncontrolled starting state (default closed). */
  defaultOpen?: boolean;
  /** Controlled state: pass with onOpenChange. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** Unmount the content while closed (default false: kept mounted and hidden). */
  lazy?: boolean;
  /** 'inline': a quiet text toggle (default); 'bar': a full-width carved bar. */
  variant?: 'inline' | 'bar';
  className?: string;
  children?: ReactNode;
  'data-testid'?: string;
}

/** A "Details" toggle with the section it reveals. */
export function Disclosure({
  summary,
  openSummary,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  lazy = false,
  variant = 'inline',
  className,
  children,
  ...rest
}: DisclosureProps): ReactElement {
  const t = useT();
  const id = useId();
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const label = open ? (openSummary ?? summary ?? t('ui.disclosure.details')) : (summary ?? t('ui.disclosure.details'));
  const testId = rest['data-testid'];
  return (
    <div className={['disclosure', `disclosure-${variant}`, open && 'is-open', className].filter(Boolean).join(' ')} data-testid={testId}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <Icon name="chevronDown" className="disclosure-chevron" />
        <span>{label}</span>
      </button>
      <div id={id} className="disclosure-body" hidden={!open} role="region" aria-label={typeof label === 'string' ? label : undefined}>
        {lazy && !open ? null : children}
      </div>
    </div>
  );
}
