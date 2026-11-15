import { describe, expect, it } from 'vitest';
import { bundledJarldoms, difficultyPips, jarldomsFromGeography, JARLDOMS_PER_KINGDOM } from './provinces';

const base = {
  kingdoms: [
    { id: 'skarnheim', name: 'Skarnheim', culture: 'skarn', homeland: true, seatProvinceId: 'seat' },
    { id: 'albrenn', name: 'Albrenn', culture: 'albric', homeland: false, seatProvinceId: 'x' },
  ],
};
const pack = {
  provinces: [
    { id: 'seat', name: 'Royal Seat', kingdomId: 'skarnheim', capital: 'Kingstead', colonized: true, tags: [] },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Prov ${i}`, kingdomId: 'skarnheim', capital: `Cap ${i}`, colonized: true, tags: i === 0 ? ['straits'] : ['iron'] })),
    { id: 'frontier', name: 'Frontier', kingdomId: 'skarnheim', capital: null, colonized: false, tags: [] },
    { id: 'abroad', name: 'Abroad', kingdomId: 'albrenn', capital: 'Town', colonized: true, tags: [] },
  ],
  settlements: [{ name: 'Cap 0', provinceId: 'p0', tier: 'village' }],
};

describe('starting jarldoms (§5.1 step 8)', () => {
  it('lists up to five provinces per homeland kingdom, never the royal seat or uncolonized land', () => {
    const list = jarldomsFromGeography(base, [pack]);
    expect(list).toHaveLength(JARLDOMS_PER_KINGDOM);
    expect(list.map((j) => j.provinceId)).not.toContain('seat');
    expect(list.map((j) => j.provinceId)).not.toContain('frontier');
    expect(list.every((j) => j.culture === 'skarn' && j.kingdomName === 'Skarnheim')).toBe(true);
    expect(list[0]).toMatchObject({ capitalName: 'Cap 0', capitalTier: 'village', difficultyPips: 3 });
  });

  it('rates expected difficulty from tags and the seat’s size', () => {
    expect(difficultyPips(['iron'], 'town')).toBe(1);
    expect(difficultyPips([], 'town')).toBe(2);
    expect(difficultyPips(['straits'], 'village')).toBe(3);
    expect(difficultyPips(['straits'], 'city')).toBe(2);
  });

  it('tolerates missing or malformed geography', () => {
    expect(jarldomsFromGeography(null, [])).toEqual([]);
    expect(jarldomsFromGeography({ kingdoms: 'no' }, [42, null])).toEqual([]);
    expect(Array.isArray(bundledJarldoms())).toBe(true);
  });
});
