// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentExcess, useOverflowCompact } from './useOverflowCompact';

/** Gives an element a fake layout box. */
function box(el: Element, left: number, width: number, extra: { scrollWidth?: number; clientWidth?: number } = {}): void {
  el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: extra.clientWidth ?? width });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: extra.scrollWidth ?? width });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('contentExcess', () => {
  it('counts centred content that spills out on both sides in full', () => {
    const plate = document.createElement('div');
    const a = document.createElement('span');
    const b = document.createElement('span');
    plate.append(a, b);
    box(plate, 100, 200);
    box(a, 60, 140); // starts 40 px left of the plate
    box(b, 200, 140); // ends 40 px right of it
    expect(contentExcess(plate)).toBe(80);
  });

  it('is 0 when everything fits, and falls back to scrollWidth for childless elements', () => {
    const plate = document.createElement('div');
    const a = document.createElement('span');
    plate.append(a);
    box(plate, 0, 300);
    box(a, 10, 100);
    expect(contentExcess(plate)).toBe(0);
    const text = document.createElement('div');
    box(text, 0, 100, { scrollWidth: 130, clientWidth: 100 });
    expect(contentExcess(text)).toBe(30);
  });
});

describe('useOverflowCompact', () => {
  it('switches on when a child overflows, and off again only after a resize that makes room', () => {
    let resize: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resize = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    let width = 600;
    let compactSeen = false;
    function Bar({ resetKey }: { resetKey: string }) {
      const [ref, compact] = useOverflowCompact<HTMLDivElement>(resetKey, '.plate');
      compactSeen = compact;
      return (
        <div
          ref={(el) => {
            (ref as { current: HTMLDivElement | null }).current = el;
            if (!el) return;
            box(el, 0, width);
            const plate = el.querySelector('.plate');
            const kid = el.querySelector('.kid');
            if (plate && kid) {
              // Like a flex-grow plate: everything else takes 300 px, the plate gets the rest.
              box(plate, 0, width - 300);
              // The plate's content needs 400 px.
              box(kid, 0, 400);
            }
          }}
        >
          <div className="plate">
            <span className="kid" />
          </div>
        </div>
      );
    }
    const { rerender } = render(<Bar resetKey="a" />);
    expect(compactSeen).toBe(true); // 300 px plate, 400 px of content
    // A render without a resize never switches it back (no oscillation).
    rerender(<Bar resetKey="a" />);
    expect(compactSeen).toBe(true);
    // Wider window: the one-row bar needed 600 + 100 px.
    width = 700;
    rerender(<Bar resetKey="a" />);
    act(() => resize?.());
    expect(compactSeen).toBe(false);
    // A new reset key (text size) re-measures from scratch.
    width = 500;
    rerender(<Bar resetKey="b" />);
    expect(compactSeen).toBe(true);
  });
});
