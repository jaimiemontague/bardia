/**
 * Test fixtures for the map engine: a tiny, noise-free geography whose rasterisation is exact, so tests can assert
 * cells, ports and paths precisely. Other modules' tests may use it too (ARCHITECTURE.md §16).
 *
 *   60 × 40 grid. A rectangular mainland x 20–40, y 5–35 splits the sea into a western and an eastern zone joined
 *   by channels north and south of it; an islet sits in the west. Inside the mainland: the navigable lake Mere
 *   (x 26–34, y 14–20) fed by the navigable river Runnel from the east coast (y 17), and the navigable Tarn
 *   (x 24–32, y 25–30) reached only by the Drag portage from the Mere. All land is plain (tests paint mountains or
 *   forest on their own copy of `world.terrain`); an imperial road runs along x 22. Two provinces (north/south of
 *   y 20.5), one realm, a neutral islet region, the east sea frozen in Icebreak. Settlements: Westport (west
 *   coast), Eastport (east coast), Lakeside (a river port on the Mere); one site.
 */
import { parseGeography, type Geography, type RawGeography } from '@content/world';

const calmWinds = {
  spring: { fromDeg: 270, strength: 'fresh', spreadDeg: 30 },
  summer: { fromDeg: 270, strength: 'light', spreadDeg: 30 },
  autumn: { fromDeg: 225, strength: 'strong', spreadDeg: 30 },
  winter: { fromDeg: 0, strength: 'gale', spreadDeg: 30 },
};

const flatRule = {
  elevation: { wavelength: 20, coastGain: 0, coastCap: 0, hills: 5, mountain: 6 },
  moisture: { wavelength: 20, forest: 5, marsh: 6 },
};

/** The raw fixture (base + packs); tests may tweak a structuredClone of it before parsing. */
export function testRawGeography(): RawGeography {
  const noNoise = { amplitude: 0, wavelength: 10, octaves: 1, persistence: 0.5 };
  const base = {
    version: 1,
    grid: { width: 60, height: 40, cellKm: 5 },
    build: {
      seed: 'test-geography',
      coast: noNoise,
      lakes: noNoise,
      rivers: noNoise,
      roads: noNoise,
      regions: noNoise,
      terrainAreas: noNoise,
      fractal: { coast: 0, lakes: 0, regions: 0, rivers: 0, roads: 0, terrainAreas: 0, minSegment: 1.4 },
      maxSegment: 1,
      provinceBorders: noNoise,
      referenceSeaZone: 'westSea',
      coastalMaxCells: 3,
      inlandMinCells: 2,
      riverPortMaxCells: 2,
      portSearchRadius: 6,
      minPortWaterCells: 20,
      minProvinceCells: 20,
      minPointSpacing: 2,
      siteMaxSeaCells: 2,
      lanes: { nominalKmPerDay: 100, portageDays: 3, pruneDetour: 1.15 },
    },
    landmasses: [
      { id: 'main', name: 'Testland', kind: 'mainland', polygon: [[20, 5], [40, 5], [40, 35], [20, 35]] },
      { id: 'isle', kind: 'island', polygon: [[8, 15], [12, 15], [12, 19], [8, 19]] },
    ],
    lakes: [
      { id: 'mere', name: 'the Mere', polygon: [[26, 14], [34, 14], [34, 20], [26, 20]], navigable: true },
      { id: 'tarn', name: 'the Tarn', polygon: [[24, 25], [32, 25], [32, 30], [24, 30]], navigable: true },
    ],
    rivers: [{ id: 'runnel', name: 'the Runnel', points: [[42, 17.5], [38, 17.5], [33.5, 17.5]], navigable: true, width: 2 }],
    portages: [{ id: 'drag', name: 'the Drag', from: [29.5, 19.5], to: [28.5, 25.5], days: [2, 4], toll: false }],
    terrain: {
      areas: [],
      roads: [{ id: 'oldRoad', name: 'the Old Road', kind: 'imperial', points: [[22.5, 6.5], [22.5, 33.5]] }],
    },
    seaZones: [
      {
        id: 'westSea',
        name: 'the West Sea',
        exposure: 'openOcean',
        stormMod: 1.5,
        traffic: 0.04,
        winds: calmWinds,
        ice: [],
        encounterMix: { merchant: 1, raider: 1, patrol: 1, fleet: 1 },
        seeds: [[5, 5]],
        polygons: [[[0, 0], [30, 0], [30, 5], [20, 5], [20, 35], [30, 35], [30, 40], [0, 40]]],
        label: [5, 30],
      },
      {
        id: 'eastSea',
        name: 'the East Sea',
        exposure: 'coastal',
        stormMod: 0.8,
        traffic: 0.02,
        winds: calmWinds,
        ice: [{ from: { month: 'icebreak', day: 1 }, to: { month: 'icebreak', day: 30 } }],
        encounterMix: { merchant: 1, raider: 0, patrol: 0, fleet: 0 },
        seeds: [[55, 20]],
        polygons: [[[30, 0], [60, 0], [60, 40], [30, 40], [30, 35], [40, 35], [40, 5], [30, 5]]],
        label: [50, 30],
      },
    ],
    regions: [
      {
        id: 'testland',
        name: 'Testland',
        homeland: true,
        neutral: false,
        culture: 'skarn',
        faith: 'oldways',
        climate: 'temperate',
        landmasses: ['main'],
        polygons: [],
        terrain: flatRule,
        label: [30, 3],
      },
      {
        id: 'isles',
        name: 'the Isles',
        homeland: false,
        neutral: true,
        culture: null,
        faith: null,
        climate: 'oceanic',
        landmasses: ['isle'],
        polygons: [],
        terrain: flatRule,
        label: [10, 13],
      },
    ],
    kingdoms: [
      { id: 'testRealm', name: 'the Test Realm', regionId: 'testland', kind: 'kingdom', culture: 'skarn', faith: 'oldways', homeland: true, seatProvinceId: 'northMark', color: '#336699' },
    ],
  };
  const province = (id: string, name: string, capital: string, anchor: [number, number]) => ({
    id,
    name,
    regionId: 'testland',
    kingdomId: 'testRealm',
    homeland: true,
    capital,
    colonized: true,
    anchor,
    culture: 'skarn',
    faith: 'oldways',
    tags: [],
  });
  const homelands = {
    provinces: [province('northMark', 'Northmark', 'Westport', [30.5, 8.5]), province('southMark', 'Southmark', 'Eastport', [30.5, 32.5])],
    settlements: [
      { id: 'westport', name: 'Westport', provinceId: 'northMark', tier: 'capital', culture: 'skarn', faith: 'oldways', pos: [20.5, 10.5], coastal: true },
      { id: 'eastport', name: 'Eastport', provinceId: 'southMark', tier: 'capital', culture: 'skarn', faith: 'oldways', pos: [39.5, 31.5], coastal: true },
      { id: 'lakeside', name: 'Lakeside', provinceId: 'northMark', tier: 'village', culture: 'skarn', faith: 'oldways', pos: [30.5, 12.5], coastal: false, riverPort: true },
    ],
    sites: [{ id: 'oldCairn', name: 'the Old Cairn', kind: 'barrow', pos: [37.5, 8.5] }],
  };
  const empty = { provinces: [], settlements: [], sites: [] };
  return { base, packs: { homelands, 'albrenn-cael': empty, corvaine: empty, 'east-and-west': empty } };
}

/** The parsed fixture geography. */
export function makeTestGeography(): Geography {
  return parseGeography(testRawGeography());
}
