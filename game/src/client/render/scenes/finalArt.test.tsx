// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AssetEntry } from '@content/schemas/assets';
import { clearAssetCache } from '../../assets/resolver/resolve';
import { resetFinalIndex, setFinalIndex } from '../../assets/resolver/finalIndex';
import { setManifestForTests } from '../../assets/resolver/manifest';
import { setAssetSettings } from '../../assets/index';
import { Painting, finalPaintingFor, seasonalPath } from './finalArt';

const ENTRIES: Record<string, AssetEntry> = {
  'hub.test.panorama': { kind: 'image', path: 'hub/panorama-test.png', size: [1600, 900], placeholder: { generator: 'panorama' } },
  'hub.test.loose': { kind: 'image', path: 'loose', size: [1600, 900], placeholder: { generator: 'panorama' } },
  'music.test.theme': { kind: 'music', path: 'music/theme.ogg', durationS: 10, placeholder: { generator: 'audio.music' } },
};

const file = (hash: string) => ({ bytes: 5, hash });

function index(files: string[]): void {
  setFinalIndex({ format: 1, files: Object.fromEntries(files.map((f, i) => [f, file(`h${i}`)])) });
}

beforeEach(() => {
  setManifestForTests(ENTRIES);
  setFinalIndex({ format: 1, files: {} });
  setAssetSettings({ devProbe: false, forcePlaceholders: false, watermark: 'off' });
  clearAssetCache();
});

afterEach(() => {
  cleanup();
  setManifestForTests(undefined);
  resetFinalIndex();
  setAssetSettings({ forcePlaceholders: false });
  clearAssetCache();
});

describe('seasonalPath', () => {
  it('adds the season before the extension', () => {
    expect(seasonalPath('hub/panorama-home-skarn.jpg', 'winter')).toBe('hub/panorama-home-skarn-winter.jpg');
    expect(seasonalPath('menu.png', 'spring')).toBe('menu-spring.png');
    expect(seasonalPath('a/b/c.d.webp', 'autumn')).toBe('a/b/c.d-autumn.webp');
  });

  it('appends the season to a path with no extension, also when a folder name has a dot', () => {
    expect(seasonalPath('hub/panorama', 'summer')).toBe('hub/panorama-summer');
    expect(seasonalPath('hub.v2/panorama', 'winter')).toBe('hub.v2/panorama-winter');
    expect(seasonalPath('panorama', 'autumn')).toBe('panorama-autumn');
  });
});

describe('finalPaintingFor', () => {
  it('is null while only the placeholder exists, for unknown ids and for audio ids', () => {
    expect(finalPaintingFor('hub.test.panorama', 'winter')).toBeNull();
    expect(finalPaintingFor('hub.test.nothing', null)).toBeNull();
    index(['music/theme.ogg']);
    expect(finalPaintingFor('music.test.theme', null)).toBeNull();
  });

  it('shows the base file when there is only a base file, in every season', () => {
    index(['hub/panorama-test.jpg']);
    const base = finalPaintingFor('hub.test.panorama', null);
    expect(base).toEqual({ url: expect.stringContaining('hub/panorama-test.jpg'), variant: 'base' });
    expect(finalPaintingFor('hub.test.panorama', undefined)).toEqual(base);
    for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) expect(finalPaintingFor('hub.test.panorama', s)).toEqual(base);
  });

  it("shows a season's own painting in that season and the base file in the others", () => {
    index(['hub/panorama-test.jpg', 'hub/panorama-test-winter.jpg']);
    expect(finalPaintingFor('hub.test.panorama', 'winter')).toEqual({ url: expect.stringContaining('hub/panorama-test-winter.jpg'), variant: 'winter' });
    expect(finalPaintingFor('hub.test.panorama', 'summer')).toEqual({ url: expect.stringContaining('hub/panorama-test.jpg'), variant: 'base' });
    expect(finalPaintingFor('hub.test.panorama', null)).toMatchObject({ variant: 'base' });
    expect(finalPaintingFor('hub.test.panorama', 'winter')?.url).toContain('?v=h1');
  });

  it("finds a season's file under an alternative extension, and the base file likewise", () => {
    index(['hub/panorama-test.webp', 'hub/panorama-test-autumn.jpeg']);
    expect(finalPaintingFor('hub.test.panorama', 'autumn')).toMatchObject({ url: expect.stringContaining('hub/panorama-test-autumn.jpeg'), variant: 'autumn' });
    expect(finalPaintingFor('hub.test.panorama', 'spring')).toMatchObject({ url: expect.stringContaining('hub/panorama-test.webp'), variant: 'base' });
  });

  it('shows nothing for a season file with no base file', () => {
    index(['hub/panorama-test-winter.jpg']);
    expect(finalPaintingFor('hub.test.panorama', 'winter')).toBeNull();
  });

  it('finds the season file of a path without an extension', () => {
    index(['loose.png', 'loose-winter.png']);
    expect(finalPaintingFor('hub.test.loose', 'winter')).toMatchObject({ variant: 'winter' });
  });

  it('shows no final painting while the placeholders are forced', () => {
    index(['hub/panorama-test.jpg', 'hub/panorama-test-winter.jpg']);
    setAssetSettings({ forcePlaceholders: true });
    expect(finalPaintingFor('hub.test.panorama', 'winter')).toBeNull();
    expect(finalPaintingFor('hub.test.panorama', null)).toBeNull();
    setAssetSettings({ forcePlaceholders: false });
    expect(finalPaintingFor('hub.test.panorama', 'winter')).toMatchObject({ variant: 'winter' });
  });
});

describe('<Painting>', () => {
  it('says which painting it shows', () => {
    index(['hub/panorama-test.jpg', 'hub/panorama-test-winter.jpg']);
    const { container, rerender } = render(<Painting assetId="hub.test.panorama" season="winter"><i data-testid="proc" /></Painting>);
    const wrap = () => container.querySelector('.scn-picture') as HTMLElement;
    expect(wrap().dataset.variant).toBe('winter');
    expect(wrap().dataset.final).toBe('yes');
    expect(container.querySelector('img.scn-final')?.getAttribute('src')).toContain('panorama-test-winter.jpg');
    rerender(<Painting assetId="hub.test.panorama" season="summer"><i data-testid="proc" /></Painting>);
    expect(wrap().dataset.variant).toBe('base');
    rerender(<Painting assetId="hub.test.panorama" season={null}><i data-testid="proc" /></Painting>);
    expect(wrap().dataset.variant).toBe('base');
  });

  it('draws the children and an empty variant while there is no final file', () => {
    const { container, getByTestId } = render(<Painting assetId="hub.test.panorama" season="winter"><i data-testid="proc" /></Painting>);
    expect(getByTestId('proc')).toBeTruthy();
    const wrap = container.querySelector('.scn-picture') as HTMLElement;
    expect(wrap.dataset.final).toBe('no');
    expect(wrap.dataset.variant).toBe('');
  });
});
