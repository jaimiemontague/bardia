/**
 * The bundled geography of Bardia: schema and §32.1 catalog, sea zones (§4.2, §8.4), connectivity (§8.8: the Ember
 * Sea only by karvi through the Velkar rivers), province coverage, determinism, ports and sea lanes for capitals
 * at the province anchors, path correctness on the real map, and a performance smoke test (build ≤ 400 ms and
 * typical sea paths ≤ 5 ms in Node; the asserted bounds carry slack for loaded CI machines).
 */
import { describe, expect, it } from 'vitest';
import { getGeography, loadGeography, parseGeography, RAW_GEOGRAPHY, type Geography, type RawGeography, type SettlementDef } from '@content/world';
import {
  buildStaticWorld,
  BUNDLED_LAND_SPEEDS,
  CELL_LAKE,
  CELL_LAND,
  CELL_SEA,
  cellAt,
  cellXY,
  detachedProvincePieces,
  findLandPath,
  findSeaPath,
  getStaticWorld,
  iceBlockedZones,
  isNavigable,
  laneDaysFrom,
  laneRoute,
  nearestSeaCell,
  portOf,
  prepareSeaRouting,
  RIVER_NAVIGABLE,
  ROAD_IMPERIAL,
  seaZoneAt,
  TERRAIN_FOREST,
  TERRAIN_HILLS,
  TERRAIN_MARSH,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAIN,
  validateGeographyFull,
  type GridPath,
  type StaticWorld,
} from './index';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const geo = getGeography();
const world = getStaticWorld();

/** §32.1: region → [province name, capital (null: uncolonized)] in catalog order. */
const CATALOG: Record<string, [string, string | null][]> = {
  skarnheim: [['Hrafnfjord', 'Kolvik'], ['Steinvangr', 'Steinholt'], ['Myrkdal', 'Ulfshaug'], ['Saltnes', 'Brimstad'], ['Jarnberg', 'Jarnvik'], ['Kaldbrekka', 'Isholm']],
  hvarnland: [['Aldmark', 'Hvarnsted'], ['Vidskog', 'Elgholm'], ['Sjoland', 'Vassby'], ['Gyllenmyr', 'Myrhavn'], ['Bjornskog', 'Bjornstad'], ['Austrvik', 'Austhavn']],
  eyjamark: [['Sundholm', 'Sundby'], ['Lyngey', 'Lyngvik'], ['Hornstrand', 'Hornby'], ['Mosey', 'Mosstead'], ['Vestkyst', 'Sandvik'], ['Marknes', 'Kaupholm']],
  albrenn: [['Northwold', 'Wealdburh'], ['Cliffmarch', 'Saltburh'], ['Merewood', 'Thelwick'], ['Fenholt', 'Marshcester'], ['Hollowmere', 'Sedgeford'], ['Westmere', 'Aldermouth'], ['Southdown', 'Chalkford'], ['Combe Vale', 'Combeham'], ['Eastfen', 'Gyrwick'], ['Seawold', 'Gullhythe']],
  cael: [['Dun Brac', 'Dun Brac'], ['Inishvar', 'Inishvar'], ['Glenmorra', 'Kilmorra'], ['Ballacree', 'Ballacree'], ['Carrowmor', 'Lisdara'], ['Tir Aoda', 'Kilaoda']],
  corvaine: [['Aurelle', 'Aurenne'], ['Brecaine', 'Brecy'], ['Valmorin', 'Morinac'], ['Gascelle', 'Lorvaux'], ['Ondrelle', 'Sablonne'], ['Varenne', 'Castel Varo'], ['Rhenmark', 'Kolden'], ['Alsenne', 'Strelle'], ['Burgonne', 'Vaux-Doré'], ['Saxmark', 'Wendelburg'], ['Frisholm', 'Wijkstede'], ['Thuringel', 'Erfholt'], ['Bavarre', 'Regenhof'], ['Ostmarch', 'Ebbensburg']],
  isafold: [['Smokebay', 'Eldvik'], ['Thingvale', null], ['Ashfjord', null]],
  velkar: [['Velkgard', 'Velkgorod'], ['Ilmenka', 'Ozerny'], ['Volokny', 'Volokgrad'], ['Borovka', 'Smolin'], ['Rusalka Marches', 'Lebedin'], ['Dnebrava', 'Svarozhin'], ['Polovna', 'Kaganak'], ['Silverwater', 'Saryn']],
  saraleon: [['Saraleon', 'Saraleon'], ['Chryseia', 'Chrysopol'], ['the Strait Forts', 'Hieron'], ['the Myrrhine Coast', 'Myrrha']],
  rimewild: [['Rimewild', 'Frostgard'], ['Whitewaste', 'Snaerholt']],
  greenshore: [['Greenshore', null], ['Mistfold', null]],
};

/** Province-level realms of §32.1 (kingdom id → province names). */
const REALMS: Record<string, string[]> = {
  northwold: ['Northwold', 'Cliffmarch'],
  merewood: ['Merewood', 'Fenholt', 'Hollowmere'],
  westmere: ['Westmere', 'Southdown', 'Combe Vale'],
  eastfen: ['Eastfen', 'Seawold'],
  aurelle: ['Aurelle', 'Brecaine', 'Valmorin', 'Gascelle', 'Ondrelle'],
  varenne: ['Varenne', 'Rhenmark', 'Alsenne', 'Burgonne'],
  saxmark: ['Saxmark', 'Frisholm', 'Thuringel', 'Bavarre', 'Ostmarch'],
};

const ZONE_NAMES = ['the Whale-Road', 'the Straits', 'the Gray Firth', 'the Albrenn Sea', 'the Cael Sound', 'the Western Ocean', 'the Southern Narrows', 'the Ember Sea', 'the Rimesea'];

function provinceByName(name: string) {
  const p = geo.provinces.find((q) => q.name === name);
  if (p === undefined) throw new Error(`no province '${name}'`);
  return p;
}

/**
 * The bundled geography plus a stand-in capital at every colonized province's anchor (coastal when within
 * build.coastalMaxCells of the sea), the way region authors are expected to place them.
 */
function withAnchorCapitals(): { geo: Geography; capitals: SettlementDef[] } {
  const raw = structuredClone(RAW_GEOGRAPHY) as RawGeography;
  const capitals: SettlementDef[] = [];
  const packs = raw.packs as unknown as Record<string, { provinces: Geography['provinces']; settlements: SettlementDef[]; sites: unknown[] }>;
  for (const pack of Object.values(packs)) {
    // Only the anchor capitals: the region authors' own settlements and sites would collide with them.
    pack.settlements = [];
    pack.sites = [];
    for (const p of pack.provinces) {
      if (!p.colonized || p.capital === null || p.culture === null || p.faith === null) continue;
      const c = cellAt(world, p.anchor);
      const s: SettlementDef = {
        id: `test${p.id[0]?.toUpperCase()}${p.id.slice(1)}`,
        name: p.capital,
        provinceId: p.id,
        tier: 'capital',
        culture: p.culture,
        faith: p.faith,
        pos: [p.anchor[0], p.anchor[1]],
        coastal: (world.coastDist[c] as number) <= geo.build.coastalMaxCells,
      };
      pack.settlements.push(s);
      capitals.push(s);
    }
  }
  return { geo: parseGeography(raw), capitals };
}

const anchored = withAnchorCapitals();
const portWorld = buildStaticWorld(anchored.geo);

function expectNavigablePath(w: StaticWorld, path: GridPath, karvi: boolean): void {
  for (let k = 0; k < path.cells.length; k++) {
    const c = path.cells[k] as number;
    expect(isNavigable(w, c, karvi)).toBe(true);
    if (k === 0) continue;
    const a = path.cells[k - 1] as number;
    const [ax, ay] = cellXY(w, a);
    const [bx, by] = cellXY(w, c);
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      expect(w.portageAt[a]).toBeGreaterThanOrEqual(0); // only portages jump
      continue;
    }
    if (dx !== 0 && dy !== 0) {
      expect(isNavigable(w, a + dx, karvi)).toBe(true);
      expect(isNavigable(w, a + dy * w.width, karvi)).toBe(true);
    }
  }
}

describe('the geography pack', () => {
  it('passes the schema, the reference checks and the spatial validator', () => {
    expect(() => loadGeography(RAW_GEOGRAPHY)).not.toThrow();
    const { report } = validateGeographyFull(geo);
    expect(report.errors).toEqual([]);
    // Until region authors fill the packs, the only warning is that there are no settlements yet.
    for (const w of report.warnings) expect(w).toMatch(/settlements|no settlements yet/);
  });

  it('holds the 67 provinces and capitals of §32.1 with their regions and realms', () => {
    expect(geo.provinces).toHaveLength(67);
    for (const [region, list] of Object.entries(CATALOG)) {
      const ids = geo.provinces.filter((p) => p.regionId === region).map((p) => p.name);
      expect(ids.sort()).toEqual(list.map(([n]) => n).sort());
      for (const [name, capital] of list) {
        const p = provinceByName(name);
        expect(p.capital).toBe(capital);
        expect(p.colonized).toBe(capital !== null || name === 'Smokebay');
      }
    }
    const homeland = geo.provinces.filter((p) => p.homeland);
    expect(homeland).toHaveLength(18);
    for (const p of homeland) expect(p.kingdomId).toBe(p.regionId);
    for (const [kingdom, names] of Object.entries(REALMS)) {
      expect(geo.provinces.filter((p) => p.kingdomId === kingdom).map((p) => p.name).sort()).toEqual([...names].sort());
    }
    expect(geo.kingdoms.find((k) => k.id === 'skarnheim')?.seatProvinceId).toBe('hrafnfjord');
    expect(geo.kingdoms.find((k) => k.id === 'hvarnland')?.seatProvinceId).toBe('aldmark');
    expect(geo.kingdoms.find((k) => k.id === 'eyjamark')?.seatProvinceId).toBe('sundholm');
    // Eyjamark's Straits provinces and the Marknes emporium.
    for (const name of ['Sundholm', 'Lyngey', 'Marknes']) expect(provinceByName(name).tags).toContain('straits');
    expect(provinceByName('Marknes').tags).toContain('emporium');
  });

  it('keeps Thingey a neutral isle in the Straits that belongs to no province', () => {
    const thingey = geo.regions.find((r) => r.id === 'thingey');
    expect(thingey?.neutral).toBe(true);
    expect(geo.provinces.some((p) => p.regionId === 'thingey')).toBe(false);
    const ri = world.index.region.thingey as number;
    let cells = 0;
    let straitsShore = false;
    for (let i = 0; i < world.size; i++) {
      if (world.regionOf[i] !== ri || world.kind[i] !== CELL_LAND) continue;
      cells++;
      expect(world.provinceOf[i]).toBe(-1);
      const n = nearestSeaCell(world, i, 3);
      if (n >= 0 && seaZoneAt(world, n)?.id === 'straits') straitsShore = true;
    }
    expect(cells).toBeGreaterThan(60);
    expect(straitsShore).toBe(true);
  });

  it('keeps the Straits isles, Thingey and the western isles separate islands (open water between them)', () => {
    /** The land component holding most of a landmass (fractal coasts shed a few islets). */
    const componentOf = (id: string) => {
      const li = world.index.landmass[id] as number;
      const counts: Record<string, number> = {};
      for (let i = 0; i < world.size; i++) {
        if (world.landmassOf[i] !== li || world.kind[i] === CELL_SEA) continue;
        const c = world.landComponent[i] as number;
        counts[c] = (counts[c] ?? 0) + 1;
      }
      return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);
    };
    const ids = ['lyngey', 'sundholm', 'mosey', 'marknes', 'thingey', 'northland', 'vestkyst', 'albrenn', 'brac', 'morra', 'isafold', 'rimewild', 'greenshore'];
    const comps = ids.map(componentOf);
    // Hornstrand (vestkyst) and the Northland (through the Hvarnland–Velkar isthmus) join the continent; every
    // other listed landmass is its own island.
    const continent = world.landComponent[cellAt(world, provinceByName('Saxmark').anchor)];
    expect(comps[ids.indexOf('vestkyst')]).toBe(continent);
    expect(comps[ids.indexOf('northland')]).toBe(continent);
    const islands = comps.filter((_, i) => ids[i] !== 'vestkyst' && ids[i] !== 'northland');
    expect(new Set(islands).size).toBe(islands.length);
    expect(islands).not.toContain(continent);
  });

  it('defines the nine sea zones of §4.2 with storm, traffic, winds and ice (§8.4)', () => {
    expect(geo.seaZones.map((z) => z.name).sort()).toEqual([...ZONE_NAMES].sort());
    for (const z of geo.seaZones) {
      expect(z.stormMod).toBe(z.exposure === 'openOcean' ? 1.5 : 0.8);
      expect(z.traffic).toBeGreaterThanOrEqual(0.02);
      expect(z.traffic).toBeLessThanOrEqual(0.06);
      expect(Object.keys(z.winds).sort()).toEqual(['autumn', 'spring', 'summer', 'winter']);
      expect(world.seaZones[world.index.seaZone[z.id] as number]?.cells).toBeGreaterThan(100);
    }
    const blocked = (month: number, day: number) => {
      const b = iceBlockedZones(world, month, day);
      return geo.seaZones.filter((_, i) => b[i]).map((z) => z.id).sort();
    };
    expect(blocked(11, 1)).toEqual(['rimesea']); // Frostmoot
    expect(blocked(0, 1)).toEqual(['grayFirth', 'rimesea']); // Icebreak 1
    expect(blocked(0, 10)).toEqual(['grayFirth', 'rimesea']);
    expect(blocked(0, 11)).toEqual(['rimesea']);
    expect(blocked(0, 30)).toEqual(['rimesea']);
    expect(blocked(1, 1)).toEqual([]); // Seedtide
    expect(blocked(10, 30)).toEqual([]); // Wolfmonth
  });
});

describe('the rasterised world', () => {
  it('covers all land: every non-neutral land cell has a province; provinces are big enough and contiguous', () => {
    let orphans = 0;
    for (let i = 0; i < world.size; i++) {
      if (world.kind[i] !== CELL_LAND) continue;
      const r = geo.regions[world.regionOf[i] as number];
      if (r === undefined) orphans++;
      else if (!r.neutral && (world.provinceOf[i] as number) < 0) orphans++;
    }
    expect(orphans).toBe(0);
    geo.provinces.forEach((p, pi) => {
      expect(world.provinces[pi]?.landCells).toBeGreaterThanOrEqual(geo.build.minProvinceCells);
      expect(world.provinceOf[cellAt(world, p.anchor)]).toBe(pi);
    });
    const spills = detachedProvincePieces(world).filter((piece) => piece.touchesOtherLand);
    expect(spills).toEqual([]);
    // Region sizes follow the design's weighting: the continent and the homelands are the big ones.
    const regionCells = (id: string) => world.regions[world.index.region[id] as number]?.landCells ?? 0;
    expect(regionCells('corvaine')).toBeGreaterThan(regionCells('albrenn'));
    expect(regionCells('albrenn')).toBeGreaterThan(regionCells('cael'));
    expect(regionCells('cael')).toBeGreaterThan(regionCells('eyjamark'));
  });

  it('gives each region its character: fjords and mountains, lakes, fens, roads', () => {
    const share = (region: string, terrain: number) => {
      const ri = world.index.region[region] as number;
      let n = 0;
      let all = 0;
      for (let i = 0; i < world.size; i++) {
        if (world.regionOf[i] !== ri || world.kind[i] !== CELL_LAND) continue;
        all++;
        if (world.terrain[i] === terrain) n++;
      }
      return n / all;
    };
    expect(share('skarnheim', TERRAIN_MOUNTAIN)).toBeGreaterThan(share('hvarnland', TERRAIN_MOUNTAIN));
    expect(share('skarnheim', TERRAIN_MOUNTAIN)).toBeGreaterThan(0.2);
    expect(share('hvarnland', TERRAIN_FOREST)).toBeGreaterThan(0.3);
    for (const t of [TERRAIN_PLAIN, TERRAIN_FOREST, TERRAIN_HILLS, TERRAIN_MOUNTAIN, TERRAIN_MARSH]) expect(share('corvaine', t) + share('albrenn', t) + share('skarnheim', t)).toBeGreaterThan(0);
    const lakeCells = (region: string) => {
      const ri = world.index.region[region] as number;
      let n = 0;
      for (let i = 0; i < world.size; i++) if (world.regionOf[i] === ri && world.kind[i] === CELL_LAKE) n++;
      return n;
    };
    expect(lakeCells('hvarnland')).toBeGreaterThan(3 * lakeCells('skarnheim'));
    let corvaineRoads = 0;
    for (let i = 0; i < world.size; i++) if (world.road[i] === ROAD_IMPERIAL && world.regionOf[i] === world.index.region.corvaine) corvaineRoads++;
    expect(corvaineRoads).toBeGreaterThan(100);
    // The royal seat of Skarnheim lies at the head of a deep fjord: water reaches it from the Whale-Road.
    const kolvik = cellAt(world, provinceByName('Hrafnfjord').anchor);
    const fjordHead = nearestSeaCell(world, kolvik, 6);
    expect(fjordHead).toBeGreaterThanOrEqual(0);
    expect(seaZoneAt(world, fjordHead)?.id).toBe('whaleRoad');
    expect(cellXY(world, fjordHead)[0]).toBeGreaterThan(418); // ≥ 18 cells inside the outer coast (x ≈ 400)
  });

  it('connects every sea zone to the Whale-Road by sea, except the Ember Sea (karvi only, via portages)', () => {
    for (const z of geo.seaZones) {
      const zi = world.index.seaZone[z.id] as number;
      let bySea = false;
      let byKarvi = false;
      for (let i = 0; i < world.size; i++) {
        if (world.zoneOf[i] !== zi) continue;
        if (world.seaComponent[i] === world.referenceSeaComponent) bySea = true;
        if (world.karviComponent[i] === world.referenceKarviComponent) byKarvi = true;
      }
      expect(byKarvi).toBe(true);
      expect(bySea).toBe(z.riverAccessOnly !== true);
    }
    expect(geo.seaZones.filter((z) => z.riverAccessOnly === true).map((z) => z.id)).toEqual(['emberSea']);
    expect(world.portages.every((p) => p.valid)).toBe(true);
    for (const r of geo.rivers.filter((rv) => rv.navigable)) {
      let cells = 0;
      for (let i = 0; i < world.size; i++) if (world.riverOf[i] === world.index.river[r.id] && world.river[i] === RIVER_NAVIGABLE) cells++;
      expect(cells, r.id).toBeGreaterThan(0);
    }
  });

  it('routes the eastern way (§8.8): Hvarnland → the Velkar rivers → the Ember Sea, for karvi only', () => {
    const from = nearestSeaCell(world, cellAt(world, provinceByName('Austrvik').anchor), 8);
    const to = nearestSeaCell(world, cellAt(world, provinceByName('Saraleon').anchor), 8);
    expect(seaZoneAt(world, from)?.id).toBe('grayFirth');
    expect(seaZoneAt(world, to)?.id).toBe('emberSea');
    expect(findSeaPath(world, from, to)).toBeNull();
    const path = findSeaPath(world, from, to, { karvi: true });
    expect(path).not.toBeNull();
    if (path === null) return;
    expectNavigablePath(world, path, true);
    expect(path.portages.length).toBeGreaterThanOrEqual(1);
    expect(path.cells.some((c) => world.river[c] === RIVER_NAVIGABLE)).toBe(true);
    expect(path.km).toBeGreaterThan(1000);
  });

  it('is deterministic: two builds of the same geography are identical', () => {
    const a = buildStaticWorld(geo);
    const b = buildStaticWorld(parseGeography(RAW_GEOGRAPHY));
    for (const key of ['kind', 'terrain', 'elevation', 'road', 'river', 'regionOf', 'provinceOf', 'zoneOf', 'coastDist', 'nav'] as const) {
      expect(Buffer.from(a[key].buffer).equals(Buffer.from(b[key].buffer)), key).toBe(true);
    }
    expect(JSON.stringify(a.provinces)).toBe(JSON.stringify(b.provinces));
    expect(getStaticWorld()).toBe(world); // memoized
  });
});

describe('capitals at the anchors (how region authors will place them)', () => {
  it('validate cleanly: on land, in their province, coastal flags right, ports reachable', () => {
    const { report } = validateGeographyFull(anchored.geo);
    expect(report.errors).toEqual([]);
  });

  it('get ports in the expected seas: ice-bound Isholm in the Rimesea, the Golden City on the Ember Sea', () => {
    const coastal = anchored.capitals.filter((s) => s.coastal);
    expect(coastal.length).toBeGreaterThan(30);
    for (const s of coastal) {
      const port = portOf(portWorld, s.id);
      expect(port, s.id).toBeDefined();
      expect(port?.karviReachable, s.id).toBe(true);
      const zone = geo.seaZones[port?.zone ?? -1];
      expect(port?.seaReachable, s.id).toBe(zone?.riverAccessOnly !== true);
    }
    const zoneOfCapital = (province: string) => geo.seaZones[portOf(portWorld, `test${province[0]?.toUpperCase()}${province.slice(1)}`)?.zone ?? -1]?.id;
    expect(zoneOfCapital('kaldbrekka')).toBe('rimesea');
    expect(zoneOfCapital('saraleon')).toBe('emberSea');
    expect(zoneOfCapital('sundholm')).toBe('straits');
  });

  it('are joined by a connected sea-lane graph with plausible travel days', () => {
    const g = portWorld.lanes;
    expect(g.nodes.length).toBe(portWorld.ports.length);
    expect(g.lanes.length).toBeGreaterThanOrEqual(g.nodes.length - 1);
    const karviDays = laneDaysFrom(g, 0, true);
    expect(Array.from(karviDays).every(Number.isFinite)).toBe(true);
    const seaDays = laneDaysFrom(g, 0, false);
    portWorld.ports.forEach((p, i) => expect(Number.isFinite(seaDays[i] as number), p.settlementId).toBe(p.seaReachable));
    for (const lane of g.lanes) {
      expect(lane.days).toBeGreaterThanOrEqual(0);
      expect(lane.days).toBeLessThan(25);
    }
    const node = (id: string) => g.nodes.indexOf(id);
    const route = laneRoute(g, node('testHrafnfjord'), node('testSundholm'));
    expect(route).not.toBeNull();
    expect(route?.days).toBeGreaterThan(3);
    expect(route?.days).toBeLessThan(20);
  });
});

describe('paths on the real map', () => {
  it('finds valid, optimal sea routes (the landmark bound never changes the cost)', () => {
    const ports = portWorld.ports.filter((p) => p.seaReachable);
    let h = 99;
    const rnd = () => ((h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let k = 0; k < 16; k++) {
      const a = ports[Math.floor(rnd() * ports.length)]?.cell ?? -1;
      const b = ports[Math.floor(rnd() * ports.length)]?.cell ?? -1;
      const fast = findSeaPath(portWorld, a, b);
      const plain = findSeaPath(portWorld, a, b, { landmarks: false });
      expect(fast).not.toBeNull();
      if (fast === null) continue;
      expectNavigablePath(portWorld, fast, false);
      expect(fast.cost).toBeCloseTo(plain?.cost ?? -1, 6);
      expect(fast.cost).toBeCloseTo(fast.length, 6); // no hooks: cost = geometric length
    }
  });

  it('closes iced seas: Isholm is shut in from Frostmoot to Icebreak', () => {
    const isholm = portOf(portWorld, 'testKaldbrekka')?.cell ?? -1;
    const kolvik = portOf(portWorld, 'testHrafnfjord')?.cell ?? -1;
    expect(findSeaPath(portWorld, isholm, kolvik)).not.toBeNull();
    expect(findSeaPath(portWorld, isholm, kolvik, { blockedZones: iceBlockedZones(portWorld, 11, 15) })).toBeNull();
    expect(findSeaPath(portWorld, isholm, kolvik, { blockedZones: iceBlockedZones(portWorld, 3, 15) })).not.toBeNull();
  });

  it('finds overland routes that keep to land and avoid the mountains', () => {
    const hvarnsted = cellAt(world, provinceByName('Aldmark').anchor);
    const elgholm = cellAt(world, provinceByName('Vidskog').anchor);
    const speeds = { ...BUNDLED_LAND_SPEEDS, mountain: 0 };
    const path = findLandPath(world, hvarnsted, elgholm, { speeds });
    expect(findLandPath(world, hvarnsted, elgholm)?.cost ?? Infinity).toBeLessThanOrEqual(path?.cost ?? Infinity); // slow mountains may only help
    expect(path).not.toBeNull();
    for (const c of path?.cells ?? []) {
      expect(world.kind[c]).toBe(CELL_LAND);
      expect(world.terrain[c]).not.toBe(TERRAIN_MOUNTAIN);
    }
    // Land paths never reach another landmass.
    expect(findLandPath(world, hvarnsted, cellAt(world, provinceByName('Sundholm').anchor))).toBeNull();
    expect(world.kind[cellAt(world, provinceByName('Sundholm').anchor)]).not.toBe(CELL_SEA);
  });
});

describe('performance (smoke)', () => {
  it('builds the static world and answers sea queries within budget', () => {
    const builds: number[] = [];
    for (let k = 0; k < 2; k++) {
      const t = performance.now();
      buildStaticWorld(geo);
      builds.push(performance.now() - t);
    }
    const build = Math.min(...builds);
    prepareSeaRouting(portWorld);
    const ports = portWorld.ports.filter((p) => p.seaReachable);
    let total = 0;
    let n = 0;
    for (let i = 0; i < ports.length; i += 3) {
      for (let j = 1; j < ports.length; j += 7) {
        const t = performance.now();
        findSeaPath(portWorld, ports[i]?.cell ?? -1, ports[j]?.cell ?? -1);
        total += performance.now() - t;
        n++;
      }
    }
    const meanPath = total / n;
    // Budgets: 400 ms and 5 ms in Node on a quiet machine; asserted with 3× slack.
    expect(build, `build ${build.toFixed(0)} ms`).toBeLessThan(1200 * PERF_SLACK);
    expect(meanPath, `mean sea path ${meanPath.toFixed(2)} ms over ${n} queries`).toBeLessThan(15 * PERF_SLACK);
  });
});
