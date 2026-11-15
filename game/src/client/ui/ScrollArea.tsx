/**
 * Scroll container with fade shadows at the clipped edges. It is keyboard-scrollable (focusable,
 * labelled region) so lists remain usable without a mouse.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface ScrollAreaProps {
  children: ReactNode;
  /** Accessible name of the region (required: it is focusable). */
  label: string;
  maxHeight?: string;
  className?: string;
  style?: CSSProperties;
  /** Keep scrolled to the bottom while new content arrives (logs, consoles). */
  stickToBottom?: boolean;
}

/** A labelled, focusable scroll region with edge fades. */
export const ScrollArea = forwardRef<HTMLDivElement | null, ScrollAreaProps>(function ScrollArea({ children, label, maxHeight, className, style, stickToBottom = false }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(ref, () => el.current, []);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const pinned = useRef(true);

  const measure = useCallback(() => {
    const d = el.current;
    if (!d) return;
    const top = d.scrollTop > 2;
    const bottom = d.scrollTop + d.clientHeight < d.scrollHeight - 2;
    pinned.current = !bottom;
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);

  useEffect(() => {
    const d = el.current;
    if (!d) return;
    if (stickToBottom && pinned.current) d.scrollTop = d.scrollHeight;
    measure();
  });

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !el.current) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div
      ref={el}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={['scroll-area', edges.top && 'fade-top', edges.bottom && 'fade-bottom', className].filter(Boolean).join(' ')}
      style={{ maxHeight, ...style }}
      onScroll={measure}
    >
      {children}
    </div>
  );
});
