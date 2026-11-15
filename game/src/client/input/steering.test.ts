/** Steering keys: eight directions, one report per change, blocked while something else has the keys. */
import { describe, expect, it } from 'vitest';
import { dirOf, SteerKeys, type SteerKeyDir } from './steering';

function key(code: string, extra: Partial<KeyboardEvent> = {}) {
  return { code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() {}, ...extra } as unknown as KeyboardEvent;
}

describe('steering keys', () => {
  it('maps held keys to eight directions; opposites cancel', () => {
    expect(dirOf(['up'])).toBe('n');
    expect(dirOf(['up', 'right'])).toBe('ne');
    expect(dirOf(['down', 'left'])).toBe('sw');
    expect(dirOf(['left'])).toBe('w');
    expect(dirOf(['up', 'down'])).toBeNull();
    expect(dirOf([])).toBeNull();
  });

  it('reports only changes (no repeats), W A S D and arrows alike', () => {
    const seen: (SteerKeyDir | null)[] = [];
    const k = new SteerKeys({ onChange: (d) => seen.push(d) });
    k.keyDown(key('KeyW'));
    k.keyDown(key('KeyW', { repeat: true }));
    k.keyDown(key('ArrowRight'));
    k.keyUp(key('KeyW'));
    k.keyUp(key('ArrowRight'));
    expect(seen).toEqual(['n', 'ne', 'e', null]);
  });

  it('ignores keys while blocked, with Shift (panning) and in text fields; releases everything on demand', () => {
    let blocked = false;
    const seen: (SteerKeyDir | null)[] = [];
    const k = new SteerKeys({ onChange: (d) => seen.push(d), blocked: () => blocked });
    expect(k.keyDown(key('KeyA', { shiftKey: true }))).toBe(false);
    const input = { tagName: 'INPUT', type: 'text' } as unknown as EventTarget;
    expect(k.keyDown(key('KeyA', { target: input }))).toBe(false);
    blocked = true;
    expect(k.keyDown(key('KeyA'))).toBe(false);
    blocked = false;
    expect(k.keyDown(key('KeyS'))).toBe(true);
    k.releaseAll();
    expect(seen).toEqual(['s', null]);
    expect(k.current).toBeNull();
  });
});
