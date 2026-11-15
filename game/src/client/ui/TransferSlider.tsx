/**
 * TransferSlider (ARCHITECTURE §20 rule 6): moves a quantity between two places. The left side is what
 * stays, the right side what goes; one handle sits on the boundary between two piles that fill a wide
 * track, and both amounts update live as it moves.
 *
 *   value   the amount on the RIGHT side (what goes); the left side holds `total - value`
 *   min/max the range the handle may reach (ship benches, a minimum garrison); when the handle rests on a
 *           limit narrower than the whole, the limit's reason is shown under the track and the blocked part
 *           of the track is hatched
 *   marks   quick marks ("none", "half", "all", a suggested amount) as chips under the track
 *
 * Keyboard (the handle is an ARIA slider whose value is the LEFT amount, so it grows to the right like any
 * slider): ArrowRight/ArrowUp move one step to the left side, ArrowLeft/ArrowDown one step to the right
 * side, PageUp/PageDown a big step, Home sends everything it may to the right side, End keeps everything
 * it may on the left. Pointer and touch: press anywhere on the track and drag.
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { formatNumber, useT } from '../i18n/index';
import { Icon, type IconName } from './Icon';

/** One end of a transfer. */
export interface TransferSide {
  /** Plain-text name of the place ("Stay to guard the town"); also read by screen readers. */
  label: string;
  /** Glyph beside the label and the token that fills this side's pile on the track. */
  icon?: IconName;
  /** A small picture beside the label (overrides the icon there; the icon still fills the pile). */
  picture?: ReactNode;
  /** A secondary line in words under the amount, or a function of the amount ("Food for 30 days"). */
  note?: ReactNode | ((amount: number) => ReactNode);
}

/** A quick mark: a chip under the track that moves the handle to `value` (clamped to the limits). */
export interface TransferMark {
  value: number;
  label: ReactNode;
  /** Draws a tick on the track at this value as well. */
  tick?: boolean;
  testId?: string;
}

export type TransferQuickMark = 'none' | 'half' | 'all';

export interface TransferSliderProps {
  /** Accessible name of the whole control ("Bondi"). */
  label: string;
  /** Everything there is to split between the two sides. */
  total: number;
  /** The amount on the right side (what goes). */
  value: number;
  onChange(value: number): void;
  left: TransferSide;
  right: TransferSide;
  /** Granularity of the right-side amount (default 1). Limits and `total` are always reachable exactly. */
  step?: number;
  /** Page Up / Page Down (default: a tenth of the total, at least one step). */
  bigStep?: number;
  /** Least the right side may hold (default 0) and why, shown when the handle rests on it. */
  min?: number;
  minReason?: ReactNode;
  /** Most the right side may hold (default `total`) and why, shown when the handle rests on it. */
  max?: number;
  maxReason?: ReactNode;
  /** Preset chips: 'none' (0), 'half', 'all' (the total), each clamped to the limits. */
  quick?: readonly TransferQuickMark[];
  /** A suggested right-side amount: a chip and a tick on the track. */
  suggested?: number;
  /** Extra marks. */
  marks?: readonly TransferMark[];
  /** Formats an amount (default: grouped digits). */
  format?(amount: number): string;
  /** Tokens across the track (default 12; 0 hides them). Shown when a side has an icon. */
  slots?: number;
  /** A smaller version for lists of several transfers. */
  compact?: boolean;
  /**
   * 'stacked' (default): the side names, big amounts and notes above a full-width track.
   * 'inline': one row, amount | track | amount, without side names or notes (for a list of transfers under
   * one shared legend, such as the planner's men).
   */
  layout?: 'stacked' | 'inline';
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Snaps `v` to the step grid (from 0) inside [lo, hi]; the ends themselves are always allowed. */
export function snapTransfer(v: number, lo: number, hi: number, step: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v <= lo) return lo;
  if (v >= hi) return hi;
  const s = step > 0 ? step : 1;
  return round(clamp(Math.round(v / s) * s, lo, hi));
}

/** Moves a transfer: the cleaned limits and the next value for a key (or null when the key is not ours). */
export function transferKey(key: string, value: number, lo: number, hi: number, step: number, big: number): number | null {
  const s = step > 0 ? step : 1;
  const up = (v: number, by: number) => round(Math.floor(v / s + 1e-9) * s + by);
  const down = (v: number, by: number) => round(Math.ceil(v / s - 1e-9) * s - by);
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(up(value, s), lo, hi);
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(down(value, s), lo, hi);
    case 'PageDown':
      return clamp(up(value, Math.max(s, big)), lo, hi);
    case 'PageUp':
      return clamp(down(value, Math.max(s, big)), lo, hi);
    case 'Home':
      return hi;
    case 'End':
      return lo;
    default:
      return null;
  }
}

function sideNote(side: TransferSide, amount: number): ReactNode {
  return typeof side.note === 'function' ? side.note(amount) : side.note;
}

/** The two-sided transfer control. */
export function TransferSlider({
  label,
  total: rawTotal,
  value,
  onChange,
  left,
  right,
  step = 1,
  bigStep,
  min,
  minReason,
  max,
  maxReason,
  quick,
  suggested,
  marks,
  format,
  slots = 12,
  compact = false,
  layout = 'stacked',
  disabled: disabledProp = false,
  className,
  ...rest
}: TransferSliderProps): ReactElement {
  const t = useT();
  const labelId = useId();
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [bump, setBump] = useState(0);
  const total = Math.max(0, rawTotal);
  const lo = clamp(min ?? 0, 0, total);
  const hi = clamp(max ?? total, lo, total);
  const disabled = disabledProp || total <= 0 || hi <= lo;
  const big = bigStep ?? Math.max(step, Math.round(total / 10 / step) * step);
  const fmt = format ?? ((n: number) => formatNumber(n));
  const shown = clamp(value, 0, total);
  const leftAmount = round(total - shown);
  const frac = total > 0 ? leftAmount / total : 1;
  const testId = rest['data-testid'];
  const tid = (part: string) => (testId ? `${testId}-${part}` : undefined);

  const request = (v: number) => {
    if (disabled) return;
    const next = snapTransfer(v, lo, hi, step);
    if ((v > hi && hi < total) || (v < lo && lo > 0)) setBump((b) => b + 1);
    if (next !== value) onChange(next);
  };

  const fromPointer = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const f = clamp((clientX - rect.left) / rect.width, 0, 1);
    request(total - f * total);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    handle.current?.focus({ preventScroll: true });
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom and some touch stacks have no capture */
    }
    fromPointer(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) fromPointer(e.clientX);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = transferKey(e.key, value, lo, hi, step, big);
    if (next === null) return;
    e.preventDefault();
    const towardRight = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'Home';
    if (next === value && ((towardRight && hi < total && value >= hi) || (!towardRight && lo > 0 && value <= lo))) setBump((b) => b + 1);
    if (next !== value) onChange(next);
  };

  // Limits: which one the handle rests on (or is beyond), and the hatched parts of the track.
  const over = value > hi + 1e-9;
  const under = value < lo - 1e-9;
  const atMax = !over && hi < total && value >= hi - 1e-9;
  const atMin = !under && lo > 0 && value <= lo + 1e-9;
  const reason = over || atMax ? maxReason : under || atMin ? minReason : undefined;
  const blockLeft = total > 0 && hi < total ? (total - hi) / total : 0; // the handle may not go left of this
  const blockRight = total > 0 && lo > 0 ? (total - lo) / total : 1; // nor right of this

  const allMarks: TransferMark[] = [];
  for (const q of quick ?? []) {
    const v = q === 'none' ? 0 : q === 'all' ? total : Math.round(total / 2 / step) * step;
    allMarks.push({ value: v, label: t(`ui.transfer.${q}`), testId: tid(`mark-${q}`) });
  }
  if (suggested !== undefined) allMarks.push({ value: suggested, label: t('ui.transfer.suggested'), tick: true, testId: tid('mark-suggested') });
  allMarks.push(...(marks ?? []));

  const tokenIcon = (side: TransferSide) => side.icon;
  const showTokens = slots > 0 && (left.icon !== undefined || right.icon !== undefined);

  const end = (side: TransferSide, amount: number, which: 'left' | 'right') => {
    const note = sideNote(side, amount);
    return (
      <div className={`xfer-side xfer-side-${which}`}>
        <div className="xfer-side-head">
          {side.picture ? <span className="xfer-picture">{side.picture}</span> : side.icon ? <Icon name={side.icon} className="xfer-side-icon" /> : null}
          <span className="xfer-side-label">{side.label}</span>
        </div>
        <div className="xfer-amount num" data-testid={tid(which)}>
          {fmt(amount)}
        </div>
        {note !== undefined && note !== null && note !== '' && <div className="xfer-note">{note}</div>}
      </div>
    );
  };

  const trackEl = (
    <div
      ref={track}
      className="xfer-track"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-testid={tid('track')}
    >
      <div className="xfer-fill xfer-fill-left" style={{ width: `${frac * 100}%` }} />
      <div className="xfer-fill xfer-fill-right" style={{ width: `${(1 - frac) * 100}%` }} />
      {blockLeft > 0 && <div className="xfer-block" style={{ left: 0, width: `${blockLeft * 100}%` }} aria-hidden="true" />}
      {blockRight < 1 && <div className="xfer-block" style={{ left: `${blockRight * 100}%`, width: `${(1 - blockRight) * 100}%` }} aria-hidden="true" />}
      {showTokens && (
        <div className="xfer-tokens" aria-hidden="true">
          {Array.from({ length: slots }, (_, i) => {
            const onLeft = (i + 0.5) / slots < frac;
            const icon = tokenIcon(onLeft ? left : right) ?? tokenIcon(onLeft ? right : left);
            return (
              <span key={i} className={`xfer-token ${onLeft ? 'is-left' : 'is-right'}`} style={{ left: `${(i / slots) * 100}%`, width: `${100 / slots}%` }}>
                {icon && <Icon name={icon} />}
              </span>
            );
          })}
        </div>
      )}
      {allMarks
        .filter((m) => m.tick && total > 0)
        .map((m, i) => (
          <span key={`tick-${i}`} className="xfer-tick" style={{ left: `${((total - clamp(m.value, 0, total)) / total) * 100}%` }} aria-hidden="true" />
        ))}
      <div
        ref={handle}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        className="xfer-handle"
        style={{ left: `${frac * 100}%` }}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={round(total - hi)}
        aria-valuemax={round(total - lo)}
        aria-valuenow={leftAmount}
        aria-valuetext={t('ui.transfer.valueText', { leftName: left.label, left: fmt(leftAmount), rightName: right.label, right: fmt(shown) })}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        data-testid={tid('handle')}
      >
        <span className="xfer-grip" aria-hidden="true" />
      </div>
    </div>
  );

  return (
    <div
      className={['xfer', compact && 'xfer-compact', `xfer-${layout}`, disabled && 'is-disabled', dragging && 'is-dragging', (over || under) && 'is-over', className].filter(Boolean).join(' ')}
      role="group"
      aria-labelledby={labelId}
      data-testid={testId}
      data-value={value}
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>
      {layout === 'inline' ? (
        <div className="xfer-row">
          <div className="xfer-amount xfer-amount-left num" data-testid={tid('left')}>
            {fmt(leftAmount)}
          </div>
          {trackEl}
          <div className="xfer-amount xfer-amount-right num" data-testid={tid('right')}>
            {fmt(shown)}
          </div>
        </div>
      ) : (
        <>
          <div className="xfer-ends">
            {end(left, leftAmount, 'left')}
            {end(right, shown, 'right')}
          </div>
          {trackEl}
        </>
      )}
      {(allMarks.length > 0 || reason) && (
        <div className="xfer-foot">
          {reason ? (
            <p key={bump} className={`xfer-limit${bump > 0 ? ' is-bumped' : ''}${over || under ? ' tone-bad' : ''}`} role="status" data-testid={tid('limit')}>
              <Icon name={over || under ? 'warning' : 'info'} /> {reason}
            </p>
          ) : (
            <span className="xfer-limit-spacer" />
          )}
          {allMarks.length > 0 && (
            <div className="xfer-marks">
              {allMarks.map((m, i) => {
                const target = snapTransfer(m.value, lo, hi, step);
                return (
                  <button
                    key={`mark-${i}`}
                    type="button"
                    className="xfer-mark"
                    disabled={disabled}
                    aria-pressed={target === value}
                    onClick={() => request(m.value)}
                    data-testid={m.testId}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
