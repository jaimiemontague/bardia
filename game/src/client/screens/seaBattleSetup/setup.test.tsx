/** Before the Sea Battle: the odds word and the ship pictures it shows. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShipGlyph } from '../seaBattle/ShipGlyph';
import { seaBand } from './index';

const bands = { decisive: 0.85, likely: 0.65, even: 0.45, risky: 0.25 };

describe('before the sea battle', () => {
  it('turns the chance of victory into a word', () => {
    expect(seaBand(0.9, bands)).toBe('decisive');
    expect(seaBand(0.7, bands)).toBe('likely');
    expect(seaBand(0.5, bands)).toBe('even');
    expect(seaBand(0.3, bands)).toBe('risky');
    expect(seaBand(0.1, bands)).toBe('hopeless');
  });

  it('draws each hull type as a picture in the side colours', () => {
    for (const type of ['karvi', 'snekkja', 'drakkar', 'knarr', 'galley', 'riverboat']) {
      const own = renderToStaticMarkup(<ShipGlyph type={type} side="own" title={type} />);
      const foe = renderToStaticMarkup(<ShipGlyph type={type} side="foe" flip />);
      expect(own).toContain('<svg');
      expect(own).toContain('#2f63b8');
      expect(foe).toContain('#a8321f');
      expect(foe).toContain('scale(-1 1)');
    }
    expect(renderToStaticMarkup(<ShipGlyph type="snekkja" side="own" fate="sunk" />)).toContain('fate-sunk');
  });
});
