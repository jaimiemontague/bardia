/**
 * Map preview: renders the geography pack through the map engine into PNGs (pngjs) in tools/out/.
 *
 *   npm run tool -- map-preview [--scale 2] [--region <regionId> | --bbox x0,y0,x1,y1] [--layers a,b]
 *                               [--out <dir>] [--grid <cells>] [--no-labels]
 *
 * Layers: overview (terrain + relief + rivers + roads + borders + settlements/sites + labels), terrain (no
 * borders), provinces (political: kingdoms, provinces, capitals), seazones (zones, winds, ice, lanes and ports),
 * all (default: every layer). Province anchors are drawn as small rings; until region authors add settlements,
 * the lane layer uses provisional ports at coastal province anchors.
 */
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { getGeography, type Climate, type Geography } from '../../src/content/world';
import {
  buildSeaLanes,
  buildStaticWorld,
  CELL_LAKE,
  CELL_LAND,
  CELL_SEA,
  nearestCellWhere,
  RIVER_NAVIGABLE,
  RIVER_NONE,
  ROAD_IMPERIAL,
  ROAD_NONE,
  TERRAIN_FOREST,
  TERRAIN_HILLS,
  TERRAIN_MARSH,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAIN,
  type SeaLaneGraph,
  type StaticWorld,
} from '../../src/sim/modules/world/map/index';

// ---------------------------------------------------------------------------------------------
// Arguments.

interface Args {
  scale: number;
  region?: string;
  bbox?: [number, number, number, number];
  layers: string[];
  out: string;
  grid: number;
  labels: boolean;
}

function parseArgs(argv: string[]): Args {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const args: Args = { scale: 2, layers: ['overview', 'terrain', 'provinces', 'seazones'], out: join(root, 'tools', 'out'), grid: 0, labels: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--scale') args.scale = Math.max(1, Math.min(12, Number(next()) || 2));
    else if (a === '--region') args.region = next();
    else if (a === '--bbox') {
      const v = next().split(',').map(Number);
      if (v.length === 4 && v.every(Number.isFinite)) args.bbox = v as [number, number, number, number];
    } else if (a === '--layers') {
      const v = next();
      args.layers = v === 'all' ? ['overview', 'terrain', 'provinces', 'seazones'] : v.split(',');
    } else if (a === '--out') args.out = resolve(next());
    else if (a === '--grid') args.grid = Math.max(0, Number(next()) || 0);
    else if (a === '--no-labels') args.labels = false;
    else if (a === '--help' || a === '-h') {
      console.log('usage: npm run tool -- map-preview [--scale n] [--region id | --bbox x0,y0,x1,y1] [--layers overview,terrain,provinces,seazones|all] [--out dir] [--grid cells] [--no-labels]');
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------------------------
// Pixels and a 5×7 bitmap font.

type RGB = [number, number, number];

const GLYPHS: Record<string, string> = {
  "0": '.###.#...##..###.#.###..##...#.###.',
  "1": '..#...##....#....#....#....#...###.',
  "2": '.###.#...#....#...#...#...#...#####',
  "3": '#####...#...#.....#.....##...#.###.',
  "4": '...#...##..#.#.#..#.#####...#....#.',
  "5": '######....####.....#....##...#.###.',
  "6": '..##..#...#....####.#...##...#.###.',
  "7": '#####....#...#...#...#....#....#...',
  "8": '.###.#...##...#.###.#...##...#.###.',
  "9": '.###.#...##...#.####....#...#..##..',
  "A": '.###.#...##...#######...##...##...#',
  "B": '####.#...##...#####.#...##...#####.',
  "C": '.###.#...##....#....#....#...#.###.',
  "D": '###..#..#.#...##...##...##..#.###..',
  "E": '######....#....####.#....#....#####',
  "F": '######....#....####.#....#....#....',
  "G": '.###.#...##....#.####...##...#.####',
  "H": '#...##...##...#######...##...##...#',
  "I": '.###...#....#....#....#....#...###.',
  "J": '..###...#....#....#....#.#..#..##..',
  "K": '#...##..#.#.#..##...#.#..#..#.#...#',
  "L": '#....#....#....#....#....#....#####',
  "M": '#...###.###.#.##.#.##...##...##...#',
  "N": '#...##...###..##.#.##..###...##...#',
  "O": '.###.#...##...##...##...##...#.###.',
  "P": '####.#...##...#####.#....#....#....',
  "Q": '.###.#...##...##...##.#.##..#..##.#',
  "R": '####.#...##...#####.#.#..#..#.#...#',
  "S": '.#####....#.....###.....#....#####.',
  "T": '#####..#....#....#....#....#....#..',
  "U": '#...##...##...##...##...##...#.###.',
  "V": '#...##...##...##...##...#.#.#...#..',
  "W": '#...##...##...##.#.##.#.##.#.#.#.#.',
  "X": '#...##...#.#.#...#...#.#.#...##...#',
  "Y": '#...##...#.#.#...#....#....#....#..',
  "Z": '#####....#...#...#...#...#....#####',
  "-": '................###................',
  "'": '..#....#...#.......................',
  ".": '..........................##...##..',
  ",": '.....................##....#...#...',
  "(": '...#...#...#....#....#.....#.....#.',
  ")": '.#.....#.....#....#....#...#...#...',
  "/": '.........#...#...#...#...#.........',
  "?": '.###.#...#....#...#...#.........#..',
  " ": '...................................',
  ":": '......##...##........##...##.......',
  "&": '.##..#..#..##...#...#.#.##..#..##.#',
  "+": '.......#....#..#####..#....#.......',
};

class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = 255;
  }

  blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    const d = this.data;
    d[o] = Math.round((d[o] as number) * (1 - a) + c[0] * a);
    d[o + 1] = Math.round((d[o + 1] as number) * (1 - a) + c[1] * a);
    d[o + 2] = Math.round((d[o + 2] as number) * (1 - a) + c[2] * a);
    d[o + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) a >= 1 ? this.set(i, j, c) : this.blend(i, j, c, a);
  }

  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        const d = (i + 0.5 - cx) * (i + 0.5 - cx) + (j + 0.5 - cy) * (j + 0.5 - cy);
        if (d <= r * r) a >= 1 ? this.set(i, j, c) : this.blend(i, j, c, a);
      }
    }
  }

  ring(cx: number, cy: number, r: number, c: RGB, width = 1): void {
    for (let j = Math.floor(cy - r - 1); j <= Math.ceil(cy + r + 1); j++) {
      for (let i = Math.floor(cx - r - 1); i <= Math.ceil(cx + r + 1); i++) {
        const d = Math.sqrt((i + 0.5 - cx) * (i + 0.5 - cx) + (j + 0.5 - cy) * (j + 0.5 - cy));
        if (Math.abs(d - r) <= width / 2) this.set(i, j, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1, dash = 0): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      if (dash > 0 && Math.floor(k / dash) % 2 === 1) continue;
      const x = Math.round(x0 + ((x1 - x0) * k) / n);
      const y = Math.round(y0 + ((y1 - y0) * k) / n);
      a >= 1 ? this.set(x, y, c) : this.blend(x, y, c, a);
    }
  }

  textWidth(s: string, scale: number): number {
    return s.length * 6 * scale - scale;
  }

  text(x: number, y: number, s: string, c: RGB, scale = 1, halo: RGB | null = [20, 16, 12]): void {
    const str = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const draw = (ox: number, oy: number, col: RGB) => {
      for (let k = 0; k < str.length; k++) {
        const g = GLYPHS[str[k] as string] ?? GLYPHS['?'] as string;
        for (let row = 0; row < 7; row++) {
          for (let colI = 0; colI < 5; colI++) {
            if (g[row * 5 + colI] !== '#') continue;
            this.rect(ox + (k * 6 + colI) * scale, oy + row * scale, scale, scale, col);
          }
        }
      }
    };
    if (halo !== null) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) draw(x + dx, y + dy, halo);
    }
    draw(x, y, c);
  }

  save(path: string): void {
    const png = new PNG({ width: this.w, height: this.h });
    png.data.set(this.data);
    writeFileSync(path, PNG.sync.write(png));
  }
}

// ---------------------------------------------------------------------------------------------
// Palette.

const SEA_DEEP: RGB = [27, 52, 76];
const SEA_SHALLOW: RGB = [74, 116, 142];
const LAKE: RGB = [86, 130, 160];
const RIVER_NAV: RGB = [40, 92, 140];
const RIVER_STREAM_C: RGB = [70, 120, 160];
const ROAD_IMP: RGB = [120, 74, 40];
const ROAD_TRK: RGB = [150, 118, 80];
const INK: RGB = [44, 34, 28];
const PARCH: RGB = [236, 226, 200];

const TERRAIN_COLORS: Record<Climate, Record<number, RGB>> = {
  temperate: { [TERRAIN_PLAIN]: [182, 194, 132], [TERRAIN_FOREST]: [92, 132, 72], [TERRAIN_HILLS]: [160, 158, 108], [TERRAIN_MOUNTAIN]: [140, 128, 116], [TERRAIN_MARSH]: [122, 146, 112] },
  oceanic: { [TERRAIN_PLAIN]: [166, 190, 132], [TERRAIN_FOREST]: [84, 126, 78], [TERRAIN_HILLS]: [150, 156, 112], [TERRAIN_MOUNTAIN]: [128, 124, 112], [TERRAIN_MARSH]: [112, 138, 110] },
  boreal: { [TERRAIN_PLAIN]: [168, 180, 128], [TERRAIN_FOREST]: [60, 100, 68], [TERRAIN_HILLS]: [136, 140, 106], [TERRAIN_MOUNTAIN]: [132, 126, 120], [TERRAIN_MARSH]: [104, 128, 100] },
  steppe: { [TERRAIN_PLAIN]: [206, 194, 136], [TERRAIN_FOREST]: [96, 124, 76], [TERRAIN_HILLS]: [178, 164, 116], [TERRAIN_MOUNTAIN]: [150, 136, 118], [TERRAIN_MARSH]: [128, 146, 104] },
  warm: { [TERRAIN_PLAIN]: [204, 190, 132], [TERRAIN_FOREST]: [116, 136, 78], [TERRAIN_HILLS]: [186, 164, 114], [TERRAIN_MOUNTAIN]: [160, 140, 118], [TERRAIN_MARSH]: [132, 150, 108] },
  polar: { [TERRAIN_PLAIN]: [186, 192, 172], [TERRAIN_FOREST]: [140, 156, 136], [TERRAIN_HILLS]: [212, 216, 210], [TERRAIN_MOUNTAIN]: [244, 247, 250], [TERRAIN_MARSH]: [180, 196, 186] },
  volcanic: { [TERRAIN_PLAIN]: [150, 160, 120], [TERRAIN_FOREST]: [96, 118, 86], [TERRAIN_HILLS]: [104, 98, 90], [TERRAIN_MOUNTAIN]: [212, 218, 222], [TERRAIN_MARSH]: [118, 132, 110] },
};

function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

function shade(c: RGB, f: number): RGB {
  return [Math.max(0, Math.min(255, Math.round(c[0] * f))), Math.max(0, Math.min(255, Math.round(c[1] * f))), Math.max(0, Math.min(255, Math.round(c[2] * f)))];
}

function hexColor(hex: string): RGB {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Stable pseudo-random value in [0, 1) for an integer. */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const ZONE_COLORS: RGB[] = [
  [52, 92, 140], [120, 70, 130], [60, 120, 120], [150, 100, 60], [80, 130, 80], [40, 60, 110], [140, 80, 80], [160, 120, 40], [110, 150, 170], [90, 90, 90],
];

// ---------------------------------------------------------------------------------------------
// Rendering.

interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  s: number;
}

function hillshade(world: StaticWorld, i: number): number {
  const W = world.width;
  const e = world.elevation;
  const x = i % W;
  const y = (i - x) / W;
  const at = (xx: number, yy: number) => {
    const cx = Math.min(W - 1, Math.max(0, xx));
    const cy = Math.min(world.height - 1, Math.max(0, yy));
    return e[cy * W + cx] as number;
  };
  const gx = at(x + 1, y) - at(x - 1, y) + 0.5 * (at(x + 1, y - 1) - at(x - 1, y - 1) + at(x + 1, y + 1) - at(x - 1, y + 1));
  const gy = at(x, y + 1) - at(x, y - 1) + 0.5 * (at(x - 1, y + 1) - at(x - 1, y - 1) + at(x + 1, y + 1) - at(x + 1, y - 1));
  // Light from the north-west.
  const v = (-gx - gy) / 160;
  return Math.max(0.72, Math.min(1.25, 1 + v));
}

function baseColor(world: StaticWorld, i: number, mode: 'terrain' | 'political' | 'zones'): RGB {
  const geo = world.geo;
  const k = world.kind[i];
  if (k === CELL_SEA) {
    const d = world.coastDist[i] as number;
    const t = Math.pow(Math.max(0, 1 - d / 16), 1.6);
    let c = mix(SEA_DEEP, SEA_SHALLOW, t);
    if (mode === 'zones') {
      const z = world.zoneOf[i] as number;
      if (z >= 0) c = mix(c, ZONE_COLORS[z % ZONE_COLORS.length] as RGB, 0.45);
    }
    return c;
  }
  if (k === CELL_LAKE) return mode === 'zones' ? mix(LAKE, PARCH, 0.4) : LAKE;
  const r = world.regionOf[i] as number;
  const climate: Climate = r >= 0 ? (geo.regions[r]?.climate ?? 'temperate') : 'temperate';
  const t = world.terrain[i] as number;
  let c = TERRAIN_COLORS[climate][t] ?? [200, 0, 200];
  if (t === TERRAIN_MOUNTAIN && (world.elevation[i] as number) > 236 && climate !== "polar") c = mix(c, [240, 242, 244], 0.55);
  if (t === TERRAIN_FOREST) c = shade(c, 0.92 + 0.16 * hash01(i));
  if (mode === 'political') {
    const p = world.provinceOf[i] as number;
    if (p < 0) return mix(c, [214, 190, 110], 0.6);
    const prov = geo.provinces[p];
    const kid = prov?.kingdomId ?? null;
    const kingdom = kid === null ? undefined : geo.kingdoms[world.index.kingdom[kid] ?? -1];
    let pc: RGB = kingdom === undefined ? (prov?.colonized === false ? [200, 200, 196] : [176, 170, 160]) : hexColor(kingdom.color);
    pc = shade(pc, 0.78 + 0.44 * hash01(p * 7919 + 13));
    return mix(c, pc, 0.66);
  }
  if (mode === 'zones') return mix(c, PARCH, 0.55);
  return c;
}

function render(world: StaticWorld, view: View, mode: 'overview' | 'terrain' | 'provinces' | 'seazones', args: Args, lanes: { graph: SeaLaneGraph; cells: number[]; provisional: boolean }): Canvas {
  const geo = world.geo;
  const W = world.width;
  const s = view.s;
  const cw = (view.x1 - view.x0) * s;
  const ch = (view.y1 - view.y0) * s;
  const cv = new Canvas(cw, ch);
  const baseMode = mode === 'provinces' ? 'political' : mode === 'seazones' ? 'zones' : 'terrain';
  const px = (x: number) => Math.round((x - view.x0) * s);
  const py = (y: number) => Math.round((y - view.y0) * s);

  for (let y = view.y0; y < view.y1; y++) {
    for (let x = view.x0; x < view.x1; x++) {
      const i = y * W + x;
      let c = baseColor(world, i, baseMode);
      if (world.kind[i] === CELL_LAND) c = shade(c, baseMode === 'zones' ? 1 : hillshade(world, i));
      cv.rect((x - view.x0) * s, (y - view.y0) * s, s, s, c);
      if (world.kind[i] === CELL_LAND && world.terrain[i] === TERRAIN_MARSH && s >= 3 && baseMode === 'terrain') {
        cv.rect((x - view.x0) * s, (y - view.y0) * s + Math.floor(s / 2), s, 1, [70, 100, 90], 0.5);
      }
    }
  }
  // Coastline ink.
  for (let y = view.y0; y < view.y1; y++) {
    for (let x = view.x0; x < view.x1; x++) {
      const i = y * W + x;
      if (world.kind[i] === CELL_SEA) continue;
      const ox = (x - view.x0) * s;
      const oy = (y - view.y0) * s;
      const edge = (j: number) => world.kind[j] === CELL_SEA;
      if (x > 0 && edge(i - 1)) cv.rect(ox, oy, 1, s, INK, 0.75);
      if (x < W - 1 && edge(i + 1)) cv.rect(ox + s - 1, oy, 1, s, INK, 0.75);
      if (y > 0 && edge(i - W)) cv.rect(ox, oy, s, 1, INK, 0.75);
      if (y < world.height - 1 && edge(i + W)) cv.rect(ox, oy + s - 1, s, 1, INK, 0.75);
    }
  }
  // Rivers and roads.
  if (mode !== 'seazones') {
    for (let y = view.y0; y < view.y1; y++) {
      for (let x = view.x0; x < view.x1; x++) {
        const i = y * W + x;
        const ox = (x - view.x0) * s;
        const oy = (y - view.y0) * s;
        if (world.road[i] !== ROAD_NONE && mode !== 'provinces') {
          const c = world.road[i] === ROAD_IMPERIAL ? ROAD_IMP : ROAD_TRK;
          const r = Math.max(1, Math.floor(s / 4));
          if ((x + y) % 2 === 0 || world.road[i] === ROAD_IMPERIAL) cv.rect(ox + Math.floor((s - r) / 2), oy + Math.floor((s - r) / 2), r, r, c);
        }
        if (world.river[i] !== RIVER_NONE) {
          const nav = world.river[i] === RIVER_NAVIGABLE;
          const col = nav ? RIVER_NAV : RIVER_STREAM_C;
          const r = Math.max(1, Math.round(s * (nav ? 0.55 : 0.35)));
          const o = Math.floor((s - r) / 2);
          cv.rect(ox + o, oy + o, r, r, col);
          // Bridge to river or water neighbours so the course reads as a line.
          const wet = (j: number) => world.river[j] !== RIVER_NONE || world.kind[j] !== CELL_LAND;
          if (x < W - 1 && wet(i + 1)) cv.rect(ox + o, oy + o, s, r, col);
          if (y < world.height - 1 && wet(i + W)) cv.rect(ox + o, oy + o, r, s, col);
          if (x > 0 && world.kind[i - 1] !== CELL_LAND) cv.rect(ox - (s - o - r), oy + o, s - o, r, col);
          if (y > 0 && world.kind[i - W] !== CELL_LAND) cv.rect(ox + o, oy - (s - o - r), r, s - o, col);
        }
      }
    }
  }
  // Borders.
  if (mode === 'overview' || mode === 'provinces') {
    for (let y = view.y0; y < view.y1; y++) {
      for (let x = view.x0; x < view.x1; x++) {
        const i = y * W + x;
        if (world.kind[i] === CELL_SEA) continue;
        const p = world.provinceOf[i] as number;
        const r = world.regionOf[i] as number;
        const kOf = (pp: number) => (pp < 0 ? '' : (geo.provinces[pp]?.kingdomId ?? `p${pp}`));
        const ox = (x - view.x0) * s;
        const oy = (y - view.y0) * s;
        const check = (j: number, vertical: boolean, far: boolean) => {
          if (world.kind[j] === CELL_SEA) return;
          const q = world.provinceOf[j] as number;
          if (q === p) return;
          const regionBorder = world.regionOf[j] !== r;
          const kingdomBorder = kOf(q) !== kOf(p);
          const col: RGB = regionBorder ? [30, 20, 16] : kingdomBorder ? [70, 30, 30] : [60, 48, 40];
          const a = regionBorder ? 1 : kingdomBorder ? 0.9 : 0.75;
          const t = regionBorder && s >= 2 ? 2 : 1;
          if (vertical) cv.rect(far ? ox + s - t : ox, oy, t, s, col, a);
          else cv.rect(ox, far ? oy + s - t : oy, s, t, col, a);
        };
        if (x < W - 1) check(i + 1, true, true);
        if (y < world.height - 1) check(i + W, false, true);
      }
    }
  }
  // Lanes and ports.
  if (mode === 'seazones') {
    for (const lane of lanes.graph.lanes) {
      const a = lanes.cells[lane.a] as number;
      const b = lanes.cells[lane.b] as number;
      const ax = (a % W) + 0.5;
      const ay = Math.floor(a / W) + 0.5;
      const bx = (b % W) + 0.5;
      const by = Math.floor(b / W) + 0.5;
      cv.line(px(ax), py(ay), px(bx), py(by), lane.karviOnly ? [150, 220, 160] : [240, 230, 200], 0.8, lanes.provisional ? 3 : 0);
    }
    for (const c of lanes.cells) {
      const x = (c % W) + 0.5;
      const y = Math.floor(c / W) + 0.5;
      cv.disc(px(x), py(y), Math.max(1.5, s * 0.8), [250, 250, 240]);
      cv.ring(px(x), py(y), Math.max(1.5, s * 0.8), INK);
    }
  }
  // Anchors, settlements and sites.
  const labelScale = s >= 4 ? 2 : 1;
  if (mode !== 'seazones') {
    for (const p of geo.provinces) {
      for (const a of [p.anchor, ...(p.anchors ?? [])]) {
        const isMain = a === p.anchor;
        cv.ring(px(a[0]), py(a[1]), Math.max(2, s * (isMain ? 1.2 : 0.7)), isMain ? [140, 20, 20] : [110, 70, 60], 1);
      }
    }
    for (const st of geo.settlements) {
      const big = st.tier === 'capital' || st.tier === 'city' || st.tier === 'emporium';
      const col: RGB = st.tier === 'cloister' ? [240, 220, 120] : st.tier === 'fortress' ? [90, 90, 90] : st.tier === 'templeStead' ? [160, 60, 40] : [250, 246, 236];
      const r = Math.max(1.5, s * (big ? 1.3 : 0.8));
      cv.disc(px(st.pos[0]), py(st.pos[1]), r, col);
      cv.ring(px(st.pos[0]), py(st.pos[1]), r, INK);
      if (args.labels && (big || s >= 3)) cv.text(px(st.pos[0]) + Math.ceil(r) + 2, py(st.pos[1]) - 3 * labelScale, st.name, [250, 246, 236], labelScale);
    }
    for (const site of geo.sites) {
      const x = px(site.pos[0]);
      const y = py(site.pos[1]);
      const r = Math.max(2, s);
      cv.line(x - r, y - r, x + r, y + r, [120, 30, 120]);
      cv.line(x - r, y + r, x + r, y - r, [120, 30, 120]);
    }
  }
  // Labels.
  if (args.labels) {
    if (mode === 'overview' || mode === 'provinces') {
      for (const info of world.provinces) {
        const def = geo.provinces[info.index];
        if (def === undefined || info.landCells === 0) continue;
        const [lx, ly] = info.labelAt;
        if (lx < view.x0 || lx >= view.x1 || ly < view.y0 || ly >= view.y1) continue;
        const name = def.name;
        const w = cv.textWidth(name, labelScale);
        cv.text(px(lx) - Math.round(w / 2), py(ly) + 3 * labelScale, name, def.colonized ? [255, 248, 230] : [210, 210, 210], labelScale);
      }
      for (const r of geo.regions) {
        if (r.label[0] < view.x0 || r.label[0] >= view.x1 || r.label[1] < view.y0 || r.label[1] >= view.y1) continue;
        const sc = labelScale + 1;
        const name = r.name.toUpperCase();
        cv.text(px(r.label[0]) - Math.round(cv.textWidth(name, sc) / 2), py(r.label[1]), name, [255, 222, 140], sc);
      }
    }
    for (const z of geo.seaZones) {
      if (z.label[0] < view.x0 || z.label[0] >= view.x1 || z.label[1] < view.y0 || z.label[1] >= view.y1) continue;
      const sc = mode === 'seazones' ? labelScale + 1 : labelScale;
      cv.text(px(z.label[0]) - Math.round(cv.textWidth(z.name, sc) / 2), py(z.label[1]), z.name, [196, 220, 240], sc, [16, 30, 46]);
      if (mode === 'seazones') {
        const w = z.winds;
        const line = `SP ${w.spring.fromDeg} ${w.spring.strength}  SU ${w.summer.fromDeg} ${w.summer.strength}  AU ${w.autumn.fromDeg} ${w.autumn.strength}  WI ${w.winter.fromDeg} ${w.winter.strength}`;
        const info = `STORM X${z.stormMod}  TRAFFIC ${z.traffic}${z.ice.length > 0 ? '  ICE' : ''}${z.riverAccessOnly === true ? '  RIVER ACCESS ONLY' : ''}`;
        cv.text(px(z.label[0]) - Math.round(cv.textWidth(line, labelScale) / 2), py(z.label[1]) + 10 * sc, line, [220, 230, 240], labelScale, [16, 30, 46]);
        cv.text(px(z.label[0]) - Math.round(cv.textWidth(info, labelScale) / 2), py(z.label[1]) + 10 * sc + 9 * labelScale, info, [220, 230, 240], labelScale, [16, 30, 46]);
      }
    }
  }
  // Coordinate grid.
  const grid = args.grid > 0 ? args.grid : s >= 4 ? 10 : 50;
  for (let gx = Math.ceil(view.x0 / grid) * grid; gx < view.x1; gx += grid) {
    for (let y = 0; y < ch; y += 2) cv.blend(px(gx), y, [255, 255, 255], 0.18);
    cv.text(px(gx) + 2, 2, String(gx), [255, 255, 255], 1);
  }
  for (let gy = Math.ceil(view.y0 / grid) * grid; gy < view.y1; gy += grid) {
    for (let x = 0; x < cw; x += 2) cv.blend(x, py(gy), [255, 255, 255], 0.18);
    cv.text(2, py(gy) + 2, String(gy), [255, 255, 255], 1);
  }
  return cv;
}

// ---------------------------------------------------------------------------------------------

function provisionalLanes(world: StaticWorld): { graph: SeaLaneGraph; cells: number[]; provisional: boolean } {
  if (world.ports.length > 0) return { graph: world.lanes, cells: world.ports.map((p) => p.cell), provisional: false };
  const nodes: { id: string; cell: number }[] = [];
  for (const p of world.geo.provinces) {
    const c = Math.floor(p.anchor[1]) * world.width + Math.floor(p.anchor[0]);
    const sea = nearestCellWhere(world.width, world.height, c, 8, (i) => world.kind[i] === CELL_SEA && (world.seaComponentSize[world.seaComponent[i] as number] as number) > 500);
    const water = sea !== -1 ? sea : nearestCellWhere(world.width, world.height, c, 6, (i) => (world.nav[i] as number) !== 0);
    if (water !== -1) nodes.push({ id: p.id, cell: water });
  }
  return { graph: buildSeaLanes(world, nodes), cells: nodes.map((n) => n.cell), provisional: true };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const geo: Geography = getGeography();
  const t0 = performance.now();
  const world = buildStaticWorld(geo);
  const t1 = performance.now();
  let view: View = { x0: 0, y0: 0, x1: world.width, y1: world.height, s: args.scale };
  let suffix = '';
  if (args.region !== undefined) {
    const ri = world.index.region[args.region];
    if (ri === undefined) {
      console.error(`unknown region '${args.region}'. Regions: ${geo.regions.map((r) => r.id).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const b = (world.regions[ri] as { bounds: { minX: number; minY: number; maxX: number; maxY: number } }).bounds;
    const m = 12;
    view = { x0: Math.max(0, b.minX - m), y0: Math.max(0, b.minY - m), x1: Math.min(world.width, b.maxX + m + 1), y1: Math.min(world.height, b.maxY + m + 1), s: args.scale };
    suffix = `-${args.region}`;
  } else if (args.bbox !== undefined) {
    const [x0, y0, x1, y1] = args.bbox;
    view = { x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)), x1: Math.min(world.width, Math.ceil(x1)), y1: Math.min(world.height, Math.ceil(y1)), s: args.scale };
    suffix = `-${view.x0}_${view.y0}_${view.x1}_${view.y1}`;
  }
  mkdirSync(args.out, { recursive: true });
  const lanes = provisionalLanes(world);
  for (const layer of args.layers) {
    if (!['overview', 'terrain', 'provinces', 'seazones'].includes(layer)) {
      console.error(`unknown layer '${layer}'`);
      continue;
    }
    const cv = render(world, view, layer as 'overview' | 'terrain' | 'provinces' | 'seazones', args, lanes);
    const file = join(args.out, `map-${layer}${suffix}.png`);
    cv.save(file);
    console.log(`wrote ${file} (${cv.w}×${cv.h})`);
  }
  let land = 0;
  let lake = 0;
  for (let i = 0; i < world.size; i++) {
    if (world.kind[i] === CELL_LAND) land++;
    else if (world.kind[i] === CELL_LAKE) lake++;
  }
  const sizes = world.provinces.map((p) => p.landCells);
  console.log(`build ${(t1 - t0).toFixed(0)} ms; land ${land} cells, lakes ${lake}; provinces ${sizes.length} (min ${Math.min(...sizes)}, max ${Math.max(...sizes)}); ports ${world.ports.length}; lanes ${lanes.graph.lanes.length}${lanes.provisional ? ' (provisional, from anchors)' : ''}`);
  for (const r of world.regions) {
    const provs = world.provinces.filter((p) => p.regionIndex === r.index).map((p) => `${p.id}:${p.landCells}`);
    console.log(`  ${r.id.padEnd(11)} ${String(r.landCells).padStart(6)} cells  ${provs.join(' ')}`);
  }
}

main();
