/**
 * Meters and bars: HP/stamina/morale/hull/loyalty. `Meter` is a continuous bar (role="meter");
 * `SegmentBar` draws discrete pips (hull ▮▮▮▯, star ranks). Tones follow the colour-blind palette
 * and `thresholds` switch tone automatically (e.g. red under 25 %).
 */
import type { ReactElement, ReactNode } from 'react';

export type MeterTone = 'accent' | 'good' | 'bad' | 'warn' | 'info' | 'neutral';

export interface MeterProps {
  value: number;
  max?: number;
  min?: number;
  label: ReactNode;
  /** Show the label above the bar (default) or keep it for screen readers only. */
  showLabel?: boolean;
  /** Readout right of the label ("72 / 100"); default "value / max". */
  readout?: ReactNode;
  tone?: MeterTone;
  /** Automatic tone by fraction: [[0.25, 'bad'], [0.5, 'warn']] → bad below 25 %, warn below 50 %. */
  thresholds?: readonly (readonly [number, MeterTone])[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Fraction of a value in [min, max], clamped to [0, 1]. */
export function meterFraction(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Picks the tone for a fraction given ascending thresholds. */
export function toneFor(fraction: number, base: MeterTone, thresholds?: MeterProps['thresholds']): MeterTone {
  if (!thresholds) return base;
  for (const [limit, tone] of [...thresholds].sort((a, b) => a[0] - b[0])) if (fraction < limit) return tone;
  return base;
}

/** A continuous bar. */
export function Meter({ value, max = 100, min = 0, label, showLabel = true, readout, tone = 'accent', thresholds, size = 'md', className }: MeterProps): ReactElement {
  const f = meterFraction(value, min, max);
  const actual = toneFor(f, tone, thresholds);
  const text = typeof label === 'string' ? label : undefined;
  return (
    <div className={['meter', `meter-${size}`, className].filter(Boolean).join(' ')}>
      {showLabel && (
        <div className="meter-top">
          <span className="meter-label">{label}</span>
          <span className="meter-readout num">{readout ?? `${Math.round(value)} / ${max}`}</span>
        </div>
      )}
      <div
        className={`meter-track tone-bg-${actual}`}
        role="meter"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-label={text}
      >
        <div className="meter-fill" style={{ width: `${f * 100}%` }} />
      </div>
    </div>
  );
}

export interface SegmentBarProps {
  value: number;
  segments: number;
  label: string;
  tone?: MeterTone;
  className?: string;
}

/** Discrete pips (value rounded to whole segments). */
export function SegmentBar({ value, segments, label, tone = 'accent', className }: SegmentBarProps): ReactElement {
  const filled = Math.max(0, Math.min(segments, Math.round(value)));
  return (
    <span className={['segbar', `tone-bg-${tone}`, className].filter(Boolean).join(' ')} role="img" aria-label={`${label}: ${filled}/${segments}`}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < filled ? 'seg is-on' : 'seg'} />
      ))}
    </span>
  );
}
