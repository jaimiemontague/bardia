/**
 * Measured responsive switch: `compact` turns on when an element's one-row layout overflows (the
 * element itself, or any child matching `childSelector`), and turns off again once the element is
 * wide enough for the one-row layout it needed. Width alone cannot predict this — the UI scale, the
 * text size, the chosen typeface and the live numbers all change how much room the content needs —
 * so it is measured: after every render (switch on) and on real resizes (switch off). Changing
 * `resetKey` (e.g. the text settings) retries the one-row layout from scratch.
 *
 * The two directions are deliberately separated so the layout cannot oscillate: a render can only
 * turn compact mode on, and only a resize (or a reset) can turn it off.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * How far an element's content extends beyond its content box, in px (0 when it fits). Measured from
 * the children's boxes, so centred content that spills out on both sides is counted in full.
 */
export function contentExcess(el: Element): number {
  const own = Math.max(0, el.scrollWidth - el.clientWidth);
  const kids = el.children;
  if (kids.length === 0) return own;
  let left = Infinity;
  let right = -Infinity;
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  if (!Number.isFinite(left)) return own;
  const box = el.getBoundingClientRect();
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
  const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
  const inner = box.width - padL - padR;
  return Math.max(own, right - left - inner);
}

/** Returns the ref to attach and whether the compact layout is active. */
export function useOverflowCompact<T extends HTMLElement>(resetKey: string, childSelector?: string): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  /** Width the one-row layout needed when it last overflowed. */
  const needed = useRef(0);
  compactRef.current = compact;

  // A new reset key (text size, scale, typeface) retries the one-row layout.
  useLayoutEffect(() => {
    needed.current = 0;
    compactRef.current = false;
    setCompact(false);
  }, [resetKey]);

  // After every render: switch ON when the one-row layout overflows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || compactRef.current) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    let excess = contentExcess(el);
    if (childSelector) for (const child of el.querySelectorAll(childSelector)) excess += contentExcess(child);
    if (excess > 1) {
      needed.current = width + Math.ceil(excess);
      compactRef.current = true;
      setCompact(true);
    }
  });

  // On real resizes: switch OFF once there is room for the one-row layout again.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (compactRef.current && el.clientWidth >= needed.current) {
        compactRef.current = false;
        setCompact(false);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, compact];
}
