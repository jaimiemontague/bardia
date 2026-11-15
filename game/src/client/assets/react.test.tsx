// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { AssetEntry } from '@content/schemas/assets';
import { setMissingKeyWarnings } from '@client/i18n/index';
import { AssetImage, GlyphIcon } from './react';
import { clearAssetCache } from './resolver/resolve';
import { resetFinalIndex, setFinalIndex } from './resolver/finalIndex';
import { setManifestForTests } from './resolver/manifest';
import { setAssetSettings } from './resolver/store';

const ENTRIES: Record<string, AssetEntry> = {
  'portraits.character': { kind: 'image', path: 'portraits/character.png', size: [512, 640], placeholder: { generator: 'portrait' } },
  'hub.test.strip': { kind: 'image', path: 'hub/strip.png', size: [32, 32], frames: 4, placeholder: { generator: 'unitSprite', params: { kind: 'axe', anim: 'walk' } } },
};

beforeEach(() => {
  setMissingKeyWarnings(false);
  setManifestForTests(ENTRIES);
  // Pretend the index already loaded (no fetch in tests).
  setFinalIndex({ format: 1, files: {} });
  setAssetSettings({ devProbe: false, forcePlaceholders: false, watermark: 'off' });
  clearAssetCache();
});

afterEach(() => {
  cleanup();
  setManifestForTests(undefined);
  resetFinalIndex();
  clearAssetCache();
});

describe('<AssetImage>', () => {
  it('shows the placeholder with localised alt text, then swaps to the final file when it appears', () => {
    render(<AssetImage id="portraits.character" params={{ seed: 5, culture: 'eyjar', age: 33 }} altKey="portraits.alt.character" altVars={{ name: 'Thyra' }} width={128} />);
    const img = screen.getByRole('img', { name: 'Portrait of Thyra' });
    expect(img.getAttribute('data-asset-status')).toBe('placeholder');
    expect(img.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    act(() => setFinalIndex({ format: 1, files: { 'portraits/character.png': { bytes: 9, hash: 'k' } } }));
    expect(img.getAttribute('data-asset-status')).toBe('final');
    expect(img.getAttribute('src')).toBe('/assets/portraits/character.png?v=k');
  });

  it('shows one frame of a sprite strip', () => {
    const { container } = render(<AssetImage id="hub.test.strip" alt="" frame={3} />);
    const div = container.querySelector('[data-asset-id="hub.test.strip"]') as HTMLElement;
    expect(div.tagName).toBe('DIV');
    expect(div.style.backgroundSize).toBe('400% 100%');
    expect(div.style.backgroundPosition).toBe('100% 0%');
  });

  it('labels unknown ids visibly', () => {
    const { container } = render(<AssetImage id="hub.nope" alt="x" />);
    expect(container.querySelector('img')?.getAttribute('data-asset-status')).toBe('missing');
  });
});

describe('<GlyphIcon>', () => {
  it('inlines a currentColor glyph with unique ids and an accessible label', () => {
    render(
      <>
        <GlyphIcon glyph="silver" label="Silver" />
        <GlyphIcon glyph="karvi" />
      </>,
    );
    const icon = screen.getByRole('img', { name: 'Silver' });
    expect(icon.innerHTML).toContain('currentColor');
    const ids = [...document.querySelectorAll('mask')].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
