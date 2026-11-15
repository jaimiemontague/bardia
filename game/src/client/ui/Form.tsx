/**
 * Form controls: Toggle (switch), Segmented (single choice as a radio group), Field (label + hint +
 * control), TextInput and Select. All are native elements underneath, so keyboard and screen
 * readers behave as expected.
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** An on/off switch (role="switch"). */
export function Toggle({ checked, onChange, label, hint, disabled = false, className, ...rest }: ToggleProps): ReactElement {
  const id = useId();
  return (
    <div className={['toggle', disabled && 'is-disabled', className].filter(Boolean).join(' ')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={['toggle-switch', checked && 'is-on'].filter(Boolean).join(' ')}
        onClick={() => onChange(!checked)}
        data-testid={rest['data-testid']}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        <span className="toggle-knob" />
      </button>
      <label className="toggle-label" htmlFor={id}>
        {label}
        {hint && (
          <span className="toggle-hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** Tooltip-ish description for screen readers. */
  description?: string;
}

export interface SegmentedProps<V extends string> {
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange(value: V): void;
  label: string;
  /** Hide the visible label (still announced). */
  hideLabel?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

/** A row of mutually exclusive choices (radio group with arrow-key navigation). */
export function Segmented<V extends string>({ value, options, onChange, label, hideLabel = false, className, size = 'md' }: SegmentedProps<V>): ReactElement {
  const name = useId();
  return (
    <fieldset className={['segmented', `segmented-${size}`, className].filter(Boolean).join(' ')}>
      <legend className={hideLabel ? 'sr-only' : 'segmented-legend'}>{label}</legend>
      <div className="segmented-options">
        {options.map((o) => (
          <label key={o.value} className={['segmented-option', o.value === value && 'is-active', o.disabled && 'is-disabled'].filter(Boolean).join(' ')} title={o.description}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            {o.icon && <Icon name={o.icon} />}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children(id: string, describedBy: string | undefined): ReactNode;
  className?: string;
}

/** Label + control + hint/error, wired with ids. */
export function Field({ label, hint, error, children, className }: FieldProps): ReactElement {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', error && 'has-error', className].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(id, describedBy)}
      {hint && !error && (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
      {error && (
        <div className="field-error" id={`${id}-err`} role="alert">
          <Icon name="warning" /> {error}
        </div>
      )}
    </div>
  );
}

/** A styled text input. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={['text-input', className].filter(Boolean).join(' ')} {...rest} />;
});

/** A styled native select. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <span className="select-wrap">
      <select ref={ref} className={['select', className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" className="select-chevron" />
    </span>
  );
});
