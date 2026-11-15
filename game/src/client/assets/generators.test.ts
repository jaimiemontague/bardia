import { describe, expect, it } from 'vitest';
import { XMLValidator } from 'fast-xml-parser';
import cultures from '@content/data/cultures.json';
import portraitsManifest from '@content/assets/manifest/portraits.json';
import { MANIFEST_FRAGMENTS } from '@content/assets/index';
import { CULTURE_IDS, SETTLEMENT_TIER_IDS, ECONOMY_STATE_IDS } from '@content/schemas/ids';
import type { GeneratorParams, RenderContext } from './types';
import { BUILTIN_GENERATORS } from './generators/index';
import { checkRecipe, getImageGenerator, registerGenerator } from './generators/registry';
import { GLYPH_ALIASES, GLYPH_IDS, glyphFor } from './generators/iconGlyphs';
import { ICON_STYLES, iconSvg } from './generators/icon';
import { RELIC_KEYS, relicSvg } from './generators/relic';
import { AGE_STAGES, decidePortraitLook, portraitLayerCatalog, portraitLayerPath, portraitLayerPlan, portraitSvg } from './generators/portrait';
import { VIGNETTE_SCENES, VIGNETTE_SCENE_ALIASES, vignetteParamsFrom } from './generators/vignette';
import { panoramaSvg, panoramaParamsFrom, defaultTerrain } from './generators/panorama';
import { INTERIOR_KINDS, interiorSvg } from './generators/interior';
import { CULTURE_GROUP } from './svg/palette';
import { ArtRng, hash32 } from './svg/rng';

function ctx(width: number, height: number, frames = 1): RenderContext {
  return { width, height, frames, anchor: [0.5, 0.5], watermark: 'off' };
}

/** A generated SVG must be well-formed XML with no NaN/undefined leaking into attributes. */
function expectValidSvg(svg: string, what: string): void {
  expect(svg.startsWith('<svg'), what).toBe(true);
  expect(svg.endsWith('</svg>'), what).toBe(true);
  expect(svg, what).not.toMatch(/NaN|undefined|Infinity|\[object/);
  const v = XMLValidator.validate(svg);
  if (v !== true) throw new Error(`${what}: invalid XML: ${JSON.stringify(v.err)}`);
}

describe('seeded art randomness', () => {
  it('is deterministic and forks independently of position', () => {
    const a = new ArtRng('x');
    const b = new ArtRng('x');
    const seqA = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(seqA);
    const c = new ArtRng('x');
    c.next();
    expect(c.fork('hair').next()).toBe(new ArtRng('x').fork('hair').next());
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
  });
});

describe('every built-in generator', () => {
  for (const gen of BUILTIN_GENERATORS) {
    it(`${gen.id}: variants render deterministically to valid SVG`, () => {
      const variants: GeneratorParams[] = gen.variants ? gen.variants() : [{}];
      expect(variants.length).toBeGreaterThan(0);
      const sample = gen.id === 'icon' ? variants : variants.slice(0, 14);
      for (const v of sample) {
        const c = ctx(Math.round(gen.defaultSize[0] / 2), Math.round(gen.defaultSize[1] / 2));
        const one = gen.render(v, c);
        const two = gen.render({ ...v }, { ...c });
        expect(two, `${gen.id} ${JSON.stringify(v)}`).toBe(one);
        expectValidSvg(one, `${gen.id} ${JSON.stringify(v)}`);
      }
    });
  }

  it('tolerates junk params (falls back to defaults, never throws)', () => {
    for (const gen of BUILTIN_GENERATORS) {
      const svg = gen.render({ culture: 'atlantis', tier: 42, seed: 'x', scene: 'dragons', glyph: 'nope', relic: 'grail', biome: 'lava', age: 'old', kind: 'castle' }, ctx(64, 64));
      expectValidSvg(svg, gen.id);
    }
  });

  it('draws the watermark label when asked', () => {
    const gen = getImageGenerator('vignette');
    const svg = gen?.render({ scene: 'storm' }, { ...ctx(600, 338), watermark: 'full', label: 'Storm at sea' }) ?? '';
    expect(svg).toContain('PLACEHOLDER · Storm at sea');
    expectValidSvg(svg, 'watermarked vignette');
  });
});

describe('icons', () => {
  it('has a consistent set of ~120+ glyphs, every one renders in every style', () => {
    expect(GLYPH_IDS.length).toBeGreaterThanOrEqual(120);
    expect(new Set(GLYPH_IDS).size).toBe(GLYPH_IDS.length);
    for (const id of GLYPH_IDS) {
      for (const style of ICON_STYLES) expectValidSvg(iconSvg(id, { style, size: 32 }), `icon ${id} ${style}`);
    }
  });

  it('covers the game vocabularies through aliases', () => {
    for (const [alias, target] of Object.entries(GLYPH_ALIASES)) {
      expect(glyphFor(alias), alias).toBeDefined();
      expect(GLYPH_IDS, `${alias} → ${target}`).toContain(target);
    }
    for (const good of ['salt', 'timber', 'iron', 'pitch', 'furs', 'ivory', 'amber', 'cloth', 'wine', 'mead', 'honey', 'jewelry', 'silk', 'weapons', 'rations']) expect(glyphFor(good), good).toBeDefined();
  });

  it('inline icons follow currentColor and use unique ids', () => {
    const a = iconSvg('silver', { style: 'flat', color: 'currentColor', idPrefix: 'p1' });
    expect(a).toContain('currentColor');
    expect(a).toContain('id="p1-m"');
  });
});

describe('relic emblems', () => {
  it('cover the sixteen relics of §21.2', () => {
    expect(RELIC_KEYS).toHaveLength(16);
    expect(new Set(RELIC_KEYS).size).toBe(16);
    for (const k of RELIC_KEYS) expectValidSvg(relicSvg(k, { size: 128 }), k);
    expect(relicSvg('oathstone', { seed: 1 })).not.toBe(relicSvg('oathstone', { seed: 2 }));
  });
});

describe('portraits', () => {
  it('the same seed keeps its identity while aging (greying, beard, proportions change)', () => {
    const ages = [8, 15, 25, 45, 70];
    const looks = ages.map((age) => decidePortraitLook({ seed: 4242, sex: 'male', culture: 'skarn', age }));
    for (const l of looks) {
      expect(l.face).toBe(looks[0]?.face);
      expect(l.eye).toBe(looks[0]?.eye);
      expect(l.hairBase).toBe(looks[0]?.hairBase);
      expect(l.skin).toBe(looks[0]?.skin);
    }
    expect(looks.map((l) => l.stage)).toEqual([...AGE_STAGES]);
    expect(looks[0]?.beard).toBe('none');
    expect(looks[4]?.greyT).toBeGreaterThan(looks[2]?.greyT ?? 1);
    expect(portraitSvg({ seed: 4242, age: 25 })).not.toBe(portraitSvg({ seed: 4242, age: 70 }));
  });

  it('women and children are beardless; traits show (scars, eye patch, wounds)', () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(decidePortraitLook({ seed, sex: 'female', age: 40 }).beard).toBe('none');
      expect(decidePortraitLook({ seed, sex: 'male', age: 9 }).beard).toBe('none');
    }
    expect(decidePortraitLook({ seed: 1, traits: ['scarred'] }).scars.length).toBeGreaterThan(0);
    const oneEyed = decidePortraitLook({ seed: 1, traits: ['oneEyed'] }).scars;
    expect(oneEyed.some((s) => s === 'eyePatch' || s === 'blindEye')).toBe(true);
    expect(decidePortraitLook({ seed: 1, wounded: true }).accessories).toContain('bandage');
  });

  it('tolerates loose recipes from direct callers (NaN age, unknown faith, fractional picks, string traits)', () => {
    const loose = { seed: 77, age: Number.NaN, faith: 'nonsense', culture: 'nowhere', sex: 'x', layers: { hair: 2.7, beard: -3, face: Number.NaN }, traits: 'scarred, oneEyed' } as unknown as Parameters<typeof portraitSvg>[0];
    const svg = portraitSvg(loose, { width: 128, height: 160 });
    expectValidSvg(svg, 'loose recipe');
    const look = decidePortraitLook(loose);
    expect(look).toMatchObject({ age: 30, culture: 'skarn', sex: 'male' });
    expect(look.scars.length).toBeGreaterThan(0);
    expect(portraitSvg(loose, { width: 128, height: 160 })).toBe(svg);
  });

  it('different seeds give different people', () => {
    const svgs = new Set<string>();
    for (let seed = 0; seed < 12; seed++) svgs.add(portraitSvg({ seed, culture: 'hvarn', age: 30 }));
    expect(svgs.size).toBe(12);
  });

  it('every layer a portrait uses is in the catalog, and the portraits manifest covers the catalog exactly', () => {
    const catalog = portraitLayerCatalog();
    const ids = new Set(catalog.map((l) => l.assetId));
    for (const culture of CULTURE_IDS) {
      for (const sex of ['male', 'female'] as const) {
        for (const age of [6, 16, 30, 50, 80]) {
          for (const rank of ['common', 'warrior', 'noble', 'ruler', 'clergy', 'seer'] as const) {
            const plan = portraitLayerPlan(decidePortraitLook({ seed: `${culture}${sex}${age}${rank}`, culture, sex, age, rank, traits: ['scarred', 'oneEyed'], wounded: true }));
            for (const l of plan) expect(ids.has(l.assetId), l.assetId).toBe(true);
          }
        }
      }
    }
    const manifest = portraitsManifest as Record<string, { path: string; placeholder: { generator: string; params?: Record<string, unknown> } }>;
    const layerIds = Object.keys(manifest).filter((k) => k.startsWith('portraits.layer.'));
    expect(new Set(layerIds)).toEqual(ids);
    for (const l of catalog) {
      const e = manifest[l.assetId];
      expect(e?.path).toBe(portraitLayerPath(l.slot, l.variant));
      expect(e?.placeholder).toMatchObject({ generator: 'portraitLayer', params: { slot: l.slot, variant: l.variant } });
    }
    expect(manifest['portraits.character']?.placeholder.generator).toBe('portrait');
  });

  it('culture groups mirror cultures.json portraitGroup', () => {
    const data = cultures as Record<string, { portraitGroup: string }>;
    for (const c of CULTURE_IDS) expect(CULTURE_GROUP[c], c).toBe(data[c]?.portraitGroup);
  });
});

describe('scenes', () => {
  it('panoramas render for every culture × tier × economy without leaking NaN', () => {
    for (const culture of CULTURE_IDS) {
      for (const tier of SETTLEMENT_TIER_IDS) {
        const economy = ECONOMY_STATE_IDS[(culture.length + tier.length) % ECONOMY_STATE_IDS.length] ?? 'fair';
        const svg = panoramaSvg({ culture, tier, economy, season: 'summer', time: 'day', terrain: defaultTerrain(culture), seed: 3 }, { width: 160, height: 90 });
        expect(svg, `${culture} ${tier}`).not.toMatch(/NaN|undefined/);
      }
    }
    expectValidSvg(panoramaSvg(panoramaParamsFrom({ scene: 'homeHallDusk' })), 'panorama scene preset');
    expect(panoramaParamsFrom({ scene: 'homeHallDusk', time: 'day' }).time).toBe('day');
  });

  it('panoramas beach their ships and accept a focus for centre-cropped views', () => {
    const base = panoramaParamsFrom({ culture: 'skarn', tier: 'capital', economy: 'thriving', seed: 3 });
    expect(base.focus).toBeUndefined();
    expect(panoramaParamsFrom({ scene: 'homeHallDusk' }).focus).toBeCloseTo(0.56);
    expect(panoramaParamsFrom({ focus: 5 }).focus).toBe(0.8);
    const centred = panoramaSvg({ ...base, focus: 0.5 });
    expectValidSvg(centred, 'focused panorama');
    expect(centred).not.toBe(panoramaSvg(base));
    expect(panoramaSvg({ ...base, focus: 0.5 })).toBe(centred);
  });

  it('the title painting is a deterministic night scene (no ambient overlay over its own light)', () => {
    const gen = getImageGenerator('menuBackdrop');
    const a = gen?.render({ scene: 'nightFjord', seed: 812 }, ctx(480, 270)) ?? '';
    expectValidSvg(a, 'nightFjord');
    expect(gen?.render({ scene: 'nightFjord', seed: 812 }, ctx(480, 270))).toBe(a);
    expect(gen?.render({ scene: 'nightFjord', seed: 813 }, ctx(480, 270))).not.toBe(a);
    expect(gen?.render({ scene: 'nightFjord', seed: 812, culture: 'eyjar' }, ctx(480, 270))).not.toBe(a);
  });

  it('every interior kind and culture group renders', () => {
    for (const kind of INTERIOR_KINDS) for (const culture of ['skarn', 'albric', 'corvani', 'velkar'] as const) {
      expectValidSvg(interiorSvg({ kind, culture, light: 'night', season: 'summer', seed: 1 }, { width: 160, height: 90 }), `${kind} ${culture}`);
    }
  });

  it('every vignette scene and alias renders; palettes map to season/time', () => {
    const gen = getImageGenerator('vignette');
    for (const scene of [...VIGNETTE_SCENES, ...Object.keys(VIGNETTE_SCENE_ALIASES)]) expectValidSvg(gen?.render({ scene }, ctx(240, 135)) ?? '', scene);
    expect(vignetteParamsFrom({ scene: 'granary', palette: 'winter' })).toMatchObject({ scene: 'storehouse', season: 'winter' });
    expect(vignetteParamsFrom({ scene: 'hallFeast', palette: 'firelight' })).toMatchObject({ scene: 'feast', time: 'night' });
  });

  it('panoramas grade final files by season and time', () => {
    expect(getImageGenerator('panorama')?.finalFilter?.({ season: 'winter', time: 'night' })).toContain('brightness');
    expect(getImageGenerator('panorama')?.finalFilter?.({ season: 'summer', time: 'day' })).toBeUndefined();
  });
});

describe('recipes', () => {
  it('the portraits manifest recipes match their generators', () => {
    for (const [id, e] of Object.entries(portraitsManifest as Record<string, { kind: string; placeholder: { generator: string; params?: Record<string, string | number | boolean> } }>)) {
      expect(checkRecipe(e.placeholder.generator, e.placeholder.params, 'image'), id).toEqual([]);
    }
  });

  it('reports unknown generators and enum values', () => {
    expect(checkRecipe('nope', {}, 'image')).toHaveLength(1);
    expect(checkRecipe('nope', {}, 'audio')).toEqual([]);
    expect(checkRecipe('relic', { relic: 'grail' }, 'image')[0]).toContain('grail');
    expect(checkRecipe('portrait', { 'layer.face': 2, seed: 4 }, 'image')).toEqual([]);
  });

  it('image recipes across all areas name registered generators (informational for other areas)', () => {
    const unknown: string[] = [];
    for (const [area, raw] of Object.entries(MANIFEST_FRAGMENTS)) {
      for (const [id, e] of Object.entries(raw as Record<string, { kind: string; placeholder: { generator: string } }>)) {
        if (e.kind === 'image' && !getImageGenerator(e.placeholder.generator)) unknown.push(`${area}: ${id} → ${e.placeholder.generator}`);
      }
    }
    if (unknown.length > 0) console.warn(`[assets] image recipes with unknown generators (shown as labelled cards):\n  ${unknown.join('\n  ')}`);
    expect(unknown.filter((u) => u.startsWith('portraits:') || u.startsWith('hub:'))).toEqual([]);
  });

  it('accepts dotted generator ids from other systems and rejects bad ones', () => {
    registerGenerator({ id: 'audio.testTone', kind: 'audio', render: async () => 'data:audio/wav;base64,' }, { replace: true });
    expect(() => registerGenerator({ id: 'Bad Id', kind: 'audio', render: async () => '' })).toThrow();
  });
});
