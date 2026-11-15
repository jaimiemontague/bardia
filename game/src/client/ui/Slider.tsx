/**
 * Slider with Min/Max buttons and a typed number field (muster sliders, cargo, volumes, UI scale).
 * Values are clamped to [min, max] and snapped to `step`; the typed field commits on Enter/blur and
 * reverts on Escape. Arrow keys/PageUp/PageDown/Home/End work on the range itself.
 */
import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { useT } from '../i18n/index';

export interface SliderProps {
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  step?: number;
  label: ReactNode;
  /** Formats the value for the readout and aria-valuetext. */
  format?(value: number): string;
  /** Unit shown after the typed field ('%', 's'). */
  unit?: string;
  /** Show the Min/Max buttons (default true). */
  minMax?: boolean;
  /** Show the typed number field (default true). */
  typed?: boolean;
  disabled?: boolean;
  /** Helper text under the slider. */
  hint?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Clamps and snaps a value to the slider's range and step. */
export function snapValue(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const clamped = Math.min(max, Math.max(min, v));
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}

/** A labelled range slider with Min/Max buttons and a typed field. */
export function Slider({ value, onChange, min, max, step = 1, label, format, unit, minMax = true, typed = true, disabled = false, hint, className, ...rest }: SliderProps): ReactElement {
  const t = useT();
  const id = useId();
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const set = (v: number) => {
    const next = snapValue(v, min, max, step);
    if (next !== value) onChange(next);
    setText(String(next));
  };
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(n)) setText(String(value));
    else set(n);
  };
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const readout = format ? format(value) : `${value}${unit ?? ''}`;

  return (
    <div className={['slider', disabled && 'is-disabled', className].filter(Boolean).join(' ')} data-testid={rest['data-testid']}>
      <div className="slider-top">
        <label className="slider-label" htmlFor={id}>
          {label}
        </label>
        {!typed && <span className="slider-readout num">{readout}</span>}
      </div>
      <div className="slider-row">
        {minMax && (
          <button type="button" className="slider-minmax" onClick={() => set(min)} disabled={disabled || value <= min} aria-label={t('ui.slider.minAria', { value: format ? format(min) : min })}>
            {t('ui.slider.min')}
          </button>
        )}
        <input
          id={id}
          type="range"
          className="slider-range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={readout}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => set(Number(e.currentTarget.value))}
        />
        {minMax && (
          <button type="button" className="slider-minmax" onClick={() => set(max)} disabled={disabled || value >= max} aria-label={t('ui.slider.maxAria', { value: format ? format(max) : max })}>
            {t('ui.slider.max')}
          </button>
        )}
        {typed && (
          <span className="slider-typed">
            <input
              type="text"
              inputMode="decimal"
              className="slider-input num"
              value={text}
              disabled={disabled}
              aria-label={t('ui.slider.typedAria')}
              onFocus={(e) => {
                setEditing(true);
                e.currentTarget.select();
              }}
              onChange={(e) => setText(e.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                  setText(String(value));
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  set(value + (e.key === 'ArrowUp' ? step : -step));
                }
              }}
            />
            {unit && <span className="slider-unit">{unit}</span>}
          </span>
        )}
      </div>
      {hint && <div className="slider-hint">{hint}</div>}
    </div>
  );
}
