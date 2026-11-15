import { describe, expect, it } from 'vitest';
import { idPrefix, isIdOf, newId } from './ids';
import type { CharId } from './state';

describe('ids', () => {
  it('mints sequential prefixed ids from meta.nextId', () => {
    const s = { meta: { nextId: 1 } };
    const a: CharId = newId(s, 'chr');
    expect(a).toBe('chr_1');
    expect(newId(s, 'set')).toBe('set_2');
    expect(newId(s, 'site')).toBe('site_3');
    expect(newId(s, 'news')).toBe('news_4');
    expect(s.meta.nextId).toBe(5);
  });

  it('is deterministic for the same counter', () => {
    const run = () => {
      const s = { meta: { nextId: 41 } };
      return [newId(s, 'flt'), newId(s, 'shp'), newId(s, 'evt')];
    };
    expect(run()).toEqual(['flt_41', 'shp_42', 'evt_43']);
    expect(run()).toEqual(run());
  });

  it('rejects a corrupt counter', () => {
    expect(() => newId({ meta: { nextId: 0 } }, 'chr')).toThrow();
    expect(() => newId({ meta: { nextId: 1.5 } }, 'chr')).toThrow();
  });

  it('parses prefixes', () => {
    expect(idPrefix('chr_12')).toBe('chr');
    expect(idPrefix('nounderscore')).toBeUndefined();
    expect(isIdOf('set_3', 'set')).toBe(true);
    expect(isIdOf('site_3', 'set')).toBe(false);
    expect(isIdOf('set_', 'set')).toBe(false);
  });
});
