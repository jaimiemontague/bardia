/**
 * Tooltips (§25.1 rule 2: "every number has a tooltip with its formula breakdown").
 *
 *   <Tooltip content="Silver in the treasury"><span>4,210</span></Tooltip>
 *   <Tooltip content={<FormulaBreakdown title="Recruit pool" total="142" rows={[…]} />}>…</Tooltip>
 *
 * Shown on hover (after a short delay) and immediately on keyboard focus; Escape hides it. The
 * bubble is portalled to <body>, placed above the anchor (below when there is no room) and kept
 * inside the viewport. The focusable child gets `aria-describedby` pointing at the bubble.
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: TooltipPlacement;
  /** Hover delay in ms (focus shows immediately). */
  delay?: number;
  /** Stretch the anchor wrapper to its container (for block-level children). */
  block?: boolean;
  disabled?: boolean;
  className?: string;
}

const MARGIN = 8;

/** Wraps an element and shows `content` in a floating bubble on hover/focus. */
export function Tooltip({ content, children, placement = 'top', delay = 320, block = false, disabled = false, className }: TooltipProps): ReactElement {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; side: TooltipPlacement } | null>(null);

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(
    (immediate: boolean) => {
      if (disabled || content === null || content === undefined || content === '') return;
      clear();
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [content, delay, disabled],
  );
  const hide = useCallback(() => {
    clear();
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => clear(), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onScroll = () => hide();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    // Measure the wrapped element itself: it may be positioned out of the inline wrapper
    // (absolutely placed hotspots, transformed chips), which then has an empty box elsewhere.
    const target = anchor.current.firstElementChild ?? anchor.current;
    const a = target.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = placement;
    if (side === 'top' && a.top - b.height - MARGIN < 0) side = 'bottom';
    else if (side === 'bottom' && a.bottom + b.height + MARGIN > vh) side = 'top';
    else if (side === 'left' && a.left - b.width - MARGIN < 0) side = 'right';
    else if (side === 'right' && a.right + b.width + MARGIN > vw) side = 'left';
    let left: number;
    let top: number;
    if (side === 'top' || side === 'bottom') {
      left = a.left + a.width / 2 - b.width / 2;
      top = side === 'top' ? a.top - b.height - MARGIN : a.bottom + MARGIN;
    } else {
      top = a.top + a.height / 2 - b.height / 2;
      left = side === 'left' ? a.left - b.width - MARGIN : a.right + MARGIN;
    }
    left = Math.max(MARGIN, Math.min(vw - b.width - MARGIN, left));
    top = Math.max(MARGIN, Math.min(vh - b.height - MARGIN, top));
    setPos((p) => (p && p.left === left && p.top === top && p.side === side ? p : { left, top, side }));
  }, [open, placement, content]);

  const child = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { 'aria-describedby': open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'] })
    : children;

  return (
    <>
      <span
        ref={anchor}
        className={['tip-anchor', block && 'tip-anchor-block', className].filter(Boolean).join(' ')}
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={(e) => {
          // Keyboard focus shows the tip at once; programmatic or pointer focus does not.
          const target = e.target as HTMLElement;
          let visible = true;
          try {
            visible = target.matches(':focus-visible');
          } catch {
            visible = true;
          }
          if (visible) show(true);
        }}
        onBlur={hide}
        onPointerDown={hide}
      >
        {child}
      </span>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className={['tooltip', pos ? `tooltip-${pos.side}` : 'tooltip-measuring'].join(' ')}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/** One line of a formula breakdown. */
export interface FormulaRow {
  label: ReactNode;
  value: ReactNode;
  /** Operator shown before the value ('+', '−', '×', '÷', '='). */
  op?: '+' | '−' | '×' | '÷' | '=';
  tone?: 'good' | 'bad' | 'neutral';
}

export interface FormulaBreakdownProps {
  title: ReactNode;
  total: ReactNode;
  rows: readonly FormulaRow[];
  /** A short explanatory note under the table. */
  note?: ReactNode;
}

/**
 * A formula breakdown for tooltips: "Recruit pool 142 = pop 1,580 × 12% × loyalty 0.75" as a small
 * ledger table with the result on top.
 */
export function FormulaBreakdown({ title, total, rows, note }: FormulaBreakdownProps): ReactElement {
  return (
    <div className="formula">
      <div className="formula-head">
        <span className="formula-title">{title}</span>
        <span className="formula-total num">{total}</span>
      </div>
      {rows.length > 0 && (
        <table className="formula-rows">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.tone ? `tone-${r.tone}` : undefined}>
                <td className="formula-op">{r.op ?? (i === 0 ? '' : '+')}</td>
                <td className="formula-label">{r.label}</td>
                <td className="formula-value num">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <div className="formula-note">{note}</div>}
    </div>
  );
}
