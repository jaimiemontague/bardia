/**
 * `interior` generator: building interiors and yards (design §27.2: 9 building types × 4 culture
 * groups, plus the Home Hall hubs). Indoor rooms are one-point-perspective boxes in the culture's
 * materials (northern plank-and-turf, western wattle-and-limewash, southern stone and tile, eastern
 * logs) furnished per building and lit by the hearth at night or by smoke-hole light by day. The
 * shipyard, market and grove are open-air yards drawn with the scene toolkit.
 */
import type { CultureId } from '@content/schemas/ids';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { circle, ellipse, g, line, linearGradient, n, n2, path, polygon, radialGradient, rect, svgDoc } from '../svg/svg';
import { CULTURE_GROUP, CULTURE_PALETTE, SEASONS, mix, shade, type CultureGroup, type SeasonKey } from '../svg/palette';
import { grainFilter, mottleFilter, vignetteGradient, watermark, type WatermarkMode } from '../svg/paint';
import { ArtRng } from '../svg/rng';
import { oneOf, seedOf } from './params';
import { broadleaf, conifer, drawSky, figure, groundMass, newScene, sceneDefs, shipSide, stall, water, buildStyleOf, longhouse, timberHall, stoneHouse, logHouse, roundhouse, type BuildOpts } from './scene';

export const INTERIOR_SIZE = [1600, 900] as const;
export const INTERIOR_KINDS = ['greatHall', 'meadHall', 'smithy', 'shipyard', 'market', 'seerHut', 'grove', 'church', 'longhouse', 'leadersHall'] as const;
export type InteriorKind = (typeof INTERIOR_KINDS)[number];
export const INTERIOR_LIGHTS = ['day', 'night'] as const;
const ALL_CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese', 'isafolder', 'rime'];

/** buildings.json ids → interior kinds. */
export const INTERIOR_OF_BUILDING: Readonly<Record<string, InteriorKind>> = {
  hall: 'greatHall',
  walls: 'leadersHall',
  smithy: 'smithy',
  shipyard: 'shipyard',
  market: 'market',
  grove: 'grove',
  farms: 'longhouse',
  watchtowers: 'longhouse',
  meadhall: 'meadHall',
  seersHut: 'seerHut',
};

type Material = 'north' | 'west' | 'south' | 'east';

function materialOf(group: CultureGroup): Material {
  return group === 'west' ? 'west' : group === 'south' ? 'south' : group === 'east' || group === 'steppe' ? 'east' : 'north';
}

interface MatLook {
  wall: string;
  wall2: string;
  floor: string;
  ceiling: string;
  post: string;
}

const MATS: Readonly<Record<Material, MatLook>> = {
  north: { wall: '#5a3e28', wall2: '#4a3220', floor: '#4a3a2a', ceiling: '#2e1e12', post: '#3a2616' },
  west: { wall: '#c8b898', wall2: '#a8987a', floor: '#7a6a42', ceiling: '#5a4a2a', post: '#4a3220' },
  south: { wall: '#c8b490', wall2: '#a89470', floor: '#8a6a4a', ceiling: '#6a5038', post: '#9a8a6a' },
  east: { wall: '#7a5636', wall2: '#6a4a2c', floor: '#5a4430', ceiling: '#3a2818', post: '#4a3220' },
};

// ---------------------------------------------------------------------------------------------
// Perspective room

const W = INTERIOR_SIZE[0];
const H = INTERIOR_SIZE[1];
const VX = W / 2;
/** Back wall rectangle. */
const BX0 = 480;
const BX1 = 1120;
const BY0 = 190;
const BY1 = 590;

/** Screen position of floor point (u ∈ [-1,1] across, t ∈ [0,1] from front to back wall). */
function at(u: number, t: number): { x: number; y: number; k: number; ceil: number } {
  const z = 1 / (1 + t * 1.5); // perspective falloff
  const zb = 1 / 2.5;
  const f = (1 - z) / (1 - zb); // 0 at front, 1 at back
  const half = (W / 2) * (1 - f) + ((BX1 - BX0) / 2) * f;
  return { x: VX + u * half, y: H * (1 - f) + BY1 * f, k: half / (W / 2), ceil: 0 * (1 - f) + BY0 * f };
}

interface Room {
  defs: string[];
  rng: ArtRng;
  mat: MatLook;
  matKind: Material;
  culture: CultureId;
  night: boolean;
  accent: string;
  accent2: string;
}

function roomShell(r: Room, opts: { beams: boolean; smokeHole: boolean; windows: boolean }): string {
  const { mat } = r;
  const out: string[] = [];
  r.defs.push(linearGradient('in-floor', [[0, shade(mat.floor, -0.2)], [1, shade(mat.floor, 0.1)]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  r.defs.push(linearGradient('in-ceil', [[0, shade(mat.ceiling, -0.3)], [1, mat.ceiling]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  r.defs.push(linearGradient('in-wallL', [[0, shade(mat.wall2, -0.35)], [1, mat.wall2]], { x1: 0, y1: 0, x2: 1, y2: 0 }));
  r.defs.push(linearGradient('in-wallR', [[0, mat.wall2], [1, shade(mat.wall2, -0.35)]], { x1: 0, y1: 0, x2: 1, y2: 0 }));
  out.push(polygon([0, 0, W, 0, BX1, BY0, BX0, BY0], { fill: 'url(#in-ceil)' }));
  out.push(polygon([0, H, W, H, BX1, BY1, BX0, BY1], { fill: 'url(#in-floor)' }));
  out.push(polygon([0, 0, BX0, BY0, BX0, BY1, 0, H], { fill: 'url(#in-wallL)' }));
  out.push(polygon([W, 0, BX1, BY0, BX1, BY1, W, H], { fill: 'url(#in-wallR)' }));
  out.push(rect(BX0, BY0, BX1 - BX0, BY1 - BY0, { fill: mat.wall }));
  // Wall texture per material.
  if (r.matKind === 'north' || r.matKind === 'east') {
    const horizontal = r.matKind === 'east';
    if (horizontal) {
      for (let i = 1; i < 12; i++) {
        const y = BY0 + ((BY1 - BY0) * i) / 12;
        out.push(line(BX0, y, BX1, y, { stroke: shade(mat.wall, -0.4), 'stroke-width': 2 }));
        const yl = (i / 12) * H;
        out.push(line(0, yl, BX0, BY0 + ((BY1 - BY0) * i) / 12, { stroke: shade(mat.wall2, -0.4), 'stroke-width': 2.4 }));
        out.push(line(W, yl, BX1, BY0 + ((BY1 - BY0) * i) / 12, { stroke: shade(mat.wall2, -0.4), 'stroke-width': 2.4 }));
      }
    } else {
      for (let i = 1; i < 16; i++) out.push(line(BX0 + ((BX1 - BX0) * i) / 16, BY0, BX0 + ((BX1 - BX0) * i) / 16, BY1, { stroke: shade(mat.wall, -0.35), 'stroke-width': 1.6 }));
      for (let i = 1; i < 10; i++) {
        const tt = i / 10;
        const p = at(-1, tt);
        const q = at(1, tt);
        out.push(line(p.x, p.ceil, p.x, p.y, { stroke: shade(mat.wall2, -0.4), 'stroke-width': n(3 * p.k + 1) }));
        out.push(line(q.x, q.ceil, q.x, q.y, { stroke: shade(mat.wall2, -0.4), 'stroke-width': n(3 * q.k + 1) }));
      }
    }
  } else if (r.matKind === 'west') {
    for (let i = 0; i <= 4; i++) out.push(rect(BX0 + ((BX1 - BX0) * i) / 4 - 7, BY0, 14, BY1 - BY0, { fill: mat.post }));
    out.push(rect(BX0, BY0 + 30, BX1 - BX0, 10, { fill: mat.post }));
    for (let i = 1; i < 6; i++) {
      const p = at(-1, i / 6);
      const q = at(1, i / 6);
      out.push(line(p.x, p.ceil, p.x, p.y, { stroke: mat.post, 'stroke-width': n(18 * p.k + 3) }));
      out.push(line(q.x, q.ceil, q.x, q.y, { stroke: mat.post, 'stroke-width': n(18 * q.k + 3) }));
    }
  } else {
    // Stone courses and arches.
    for (let i = 1; i < 14; i++) out.push(line(BX0, BY0 + ((BY1 - BY0) * i) / 14, BX1, BY0 + ((BY1 - BY0) * i) / 14, { stroke: shade(mat.wall, -0.2), 'stroke-width': 1, opacity: '0.6' }));
    for (let i = 0; i < 3; i++) {
      const ax = BX0 + 70 + i * 170;
      out.push(path(`M${ax} ${BY1}V${BY0 + 120}Q${ax + 50} ${BY0 + 50} ${ax + 100} ${BY0 + 120}V${BY1}Z`, { fill: shade(mat.wall, -0.25) }));
    }
    out.push(rect(BX0, BY0 + 18, BX1 - BX0, 16, { fill: r.accent, opacity: '0.55' }));
    out.push(path(`M0 ${n(H * 0.18)}L${BX0} ${BY0 + 26}V${BY0 + 34}L0 ${n(H * 0.24)}Z`, { fill: r.accent, opacity: '0.5' }));
    out.push(path(`M${W} ${n(H * 0.18)}L${BX1} ${BY0 + 26}V${BY0 + 34}L${W} ${n(H * 0.24)}Z`, { fill: r.accent, opacity: '0.5' }));
    // Tiled floor.
    for (let i = -6; i <= 6; i++) {
      const a = at(i / 6, 0);
      const b = at(i / 6, 1);
      out.push(line(a.x, a.y, b.x, b.y, { stroke: shade(mat.floor, -0.3), 'stroke-width': 1.4, opacity: '0.6' }));
    }
    for (let i = 1; i < 10; i++) {
      const tt = (i / 10) ** 0.8;
      const a = at(-1, tt);
      const b = at(1, tt);
      out.push(line(a.x, a.y, b.x, b.y, { stroke: shade(mat.floor, -0.3), 'stroke-width': 1.4, opacity: '0.6' }));
    }
  }
  if (opts.beams) {
    for (let i = 0; i < 6; i++) {
      const tt = i / 6 + 0.05;
      const p = at(-1, tt);
      const q = at(1, tt);
      out.push(line(p.x, p.ceil + 6 * p.k, q.x, q.ceil + 6 * q.k, { stroke: mat.post, 'stroke-width': n(26 * p.k + 4) }));
    }
    for (const u of [-0.5, 0, 0.5]) {
      const a = at(u, 0);
      const b = at(u, 1);
      out.push(line(a.x, a.ceil, b.x, b.ceil, { stroke: shade(mat.post, -0.2), 'stroke-width': 10 }));
    }
  }
  if (opts.smokeHole && !r.night) {
    r.defs.push(linearGradient('in-shaft', [[0, '#fff2d0', 0.45], [1, '#fff2d0', 0]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
    out.push(polygon([VX - 60, 0, VX + 60, 0, VX + 180, 700, VX - 40, 700], { fill: 'url(#in-shaft)' }));
  }
  if (opts.windows) {
    for (let i = 0; i < 3; i++) {
      const wx = BX0 + 120 + i * 140;
      out.push(path(`M${wx - 18} ${BY0 + 150}V${BY0 + 80}Q${wx} ${BY0 + 56} ${wx + 18} ${BY0 + 80}V${BY0 + 150}Z`, { fill: r.night ? '#1a2238' : '#f4ecd0' }));
      if (!r.night) out.push(polygon([wx - 18, BY0 + 80, wx + 18, BY0 + 80, wx + 120, BY1 + 140, wx - 10, BY1 + 140], { fill: '#fff4d8', opacity: '0.12' }));
    }
  }
  return g({}, out);
}

/** A carved pillar from floor to ceiling at (u, t). */
function pillar(r: Room, u: number, t: number, carved: boolean): string {
  const p = at(u, t);
  const w = 26 * p.k + 6;
  const out = [rect(p.x - w / 2, p.ceil, w, p.y - p.ceil, { fill: r.mat.post }), rect(p.x - w / 2, p.ceil, w * 0.3, p.y - p.ceil, { fill: '#ffffff', opacity: '0.06' })];
  if (carved) for (let i = 1; i < 6; i++) out.push(path(`M${n(p.x - w / 2)} ${n(p.ceil + ((p.y - p.ceil) * i) / 6)}q${n(w / 2)} ${n(-w * 0.4)} ${n(w)} 0`, { fill: 'none', stroke: shade(r.mat.post, 0.25), 'stroke-width': n2(2 * p.k + 0.6) }));
  return g({}, out);
}

/** A row of round shields hung on a side wall. */
function wallShields(r: Room, side: -1 | 1, count: number): string {
  const pal = CULTURE_PALETTE[r.culture];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = 0.12 + (i / count) * 0.8;
    const p = at(side, t);
    const y = p.ceil + (p.y - p.ceil) * 0.32;
    const rx = 46 * p.k * 0.5 + 4;
    const ry = 62 * p.k + 6;
    out.push(ellipse(p.x - side * rx * 0.6, y, rx, ry, { fill: i % 2 === 0 ? pal.primary : pal.secondary, stroke: '#1a120c', 'stroke-width': n2(2 * p.k + 0.6) }));
    out.push(ellipse(p.x - side * rx * 0.6, y, rx * 0.3, ry * 0.3, { fill: pal.metal }));
  }
  return g({}, out);
}

/** Benches along both side walls. */
function benches(r: Room): string {
  const out: string[] = [];
  for (const side of [-1, 1] as const) {
    const a = at(side * 0.82, 0.02);
    const b = at(side * 0.82, 0.98);
    const a2 = at(side * 0.62, 0.02);
    const b2 = at(side * 0.62, 0.98);
    out.push(polygon([a.x, a.y - 60 * a.k, b.x, b.y - 60 * b.k, b2.x, b2.y - 60 * b2.k, a2.x, a2.y - 60 * a2.k], { fill: shade(r.mat.post, 0.15) }));
    out.push(polygon([a2.x, a2.y - 60 * a2.k, b2.x, b2.y - 60 * b2.k, b2.x, b2.y, a2.x, a2.y], { fill: shade(r.mat.post, -0.1) }));
  }
  return g({}, out);
}

/** The long hearth down the middle of the floor, with fire. */
function longHearth(r: Room, t0: number, t1: number, fire: number): string {
  const a = at(-0.12, t0);
  const b = at(0.12, t0);
  const c = at(0.12, t1);
  const d = at(-0.12, t1);
  const out = [polygon([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y], { fill: '#3a3430', stroke: '#6a6258', 'stroke-width': 4 })];
  const fr = r.rng.fork('hearth');
  for (let i = 0; i < 9; i++) {
    const tt = t0 + ((t1 - t0) * (i + 0.5)) / 9;
    const p = at(fr.jitter(0.05), tt);
    const h = (70 + fr.range(0, 60)) * p.k * fire;
    out.push(path(`M${n(p.x - 16 * p.k)} ${n(p.y - 6 * p.k)}Q${n(p.x - 10 * p.k)} ${n(p.y - h * 0.6)} ${n(p.x + fr.jitter(6) * p.k)} ${n(p.y - h)}Q${n(p.x + 10 * p.k)} ${n(p.y - h * 0.5)} ${n(p.x + 16 * p.k)} ${n(p.y - 6 * p.k)}Z`, { fill: 'url(#in-flame)' }));
  }
  return g({}, out);
}

/** The high seat on a dais at the back wall, under the house banner. */
function highSeat(r: Room, grand: boolean): string {
  const p = at(0, 0.97);
  const k = p.k * (grand ? 1.3 : 1);
  const pal = CULTURE_PALETTE[r.culture];
  const out = [
    rect(p.x - 160 * k, p.y - 26 * k, 320 * k, 26 * k, { fill: shade(r.mat.post, 0.1) }),
    rect(p.x - 50 * k, p.y - 190 * k, 100 * k, 170 * k, { fill: shade(r.mat.post, -0.15) }),
    rect(p.x - 42 * k, p.y - 100 * k, 84 * k, 20 * k, { fill: r.accent }),
    path(`M${n(p.x - 50 * k)} ${n(p.y - 190 * k)}q${n(-14 * k)} ${n(-30 * k)} ${n(6 * k)} ${n(-46 * k)}M${n(p.x + 50 * k)} ${n(p.y - 190 * k)}q${n(14 * k)} ${n(-30 * k)} ${n(-6 * k)} ${n(-46 * k)}`, { fill: 'none', stroke: '#3a2614', 'stroke-width': n2(8 * k) }),
    // Banner on the back wall.
    path(`M${n(p.x - 70 * k)} ${n(BY0 + 30)}H${n(p.x + 70 * k)}V${n(BY0 + 170)}L${n(p.x)} ${n(BY0 + 210)}L${n(p.x - 70 * k)} ${n(BY0 + 170)}Z`, { fill: pal.primary }),
    circle(p.x, BY0 + 110, 30 * k, { fill: 'none', stroke: pal.secondary, 'stroke-width': n2(6 * k) }),
  ];
  if (grand) {
    for (const side of [-1, 1]) out.push(path(`M${n(p.x + side * 220 * k)} ${n(BY0 + 40)}h${n(side * 60 * k)}v${n(150 * k)}l${n(-side * 30 * k)} ${n(26 * k)}l${n(-side * 30 * k)} ${n(-26 * k)}Z`, { fill: pal.secondary, opacity: '0.9' }));
  }
  return g({}, out);
}

/** Long tables with drinking horns, cups and platters. */
function feastTables(r: Room): string {
  const out: string[] = [];
  for (const side of [-1, 1] as const) {
    const a = at(side * 0.45, 0.06);
    const b = at(side * 0.45, 0.9);
    const a2 = at(side * 0.28, 0.06);
    const b2 = at(side * 0.28, 0.9);
    const lift = (p: { y: number; k: number }): number => p.y - 90 * p.k;
    out.push(polygon([a.x, lift(a), b.x, lift(b), b2.x, lift(b2), a2.x, lift(a2)], { fill: '#6a4a2c' }));
    out.push(polygon([a.x, lift(a), a2.x, lift(a2), a2.x, lift(a2) + 14 * a2.k, a.x, lift(a) + 14 * a.k], { fill: '#4a3220' }));
    const fr = r.rng.fork(`tbl${side}`);
    for (let i = 0; i < 9; i++) {
      const p = at(side * fr.range(0.3, 0.43), 0.08 + (i / 9) * 0.8);
      const y = p.y - 90 * p.k;
      const kind = fr.int(0, 2);
      if (kind === 0) out.push(path(`M${n(p.x - 12 * p.k)} ${n(y - 30 * p.k)}q${n(10 * p.k)} ${n(4 * p.k)} ${n(22 * p.k)} ${n(28 * p.k)}l${n(-4 * p.k)} ${n(2 * p.k)}q${n(-12 * p.k)} ${n(-18 * p.k)} ${n(-24 * p.k)} ${n(-22 * p.k)}Z`, { fill: '#e8dcc0' }));
      else if (kind === 1) out.push(rect(p.x - 7 * p.k, y - 20 * p.k, 14 * p.k, 20 * p.k, { fill: '#8a6a3a', rx: n(3 * p.k) }));
      else out.push(ellipse(p.x, y - 4 * p.k, 22 * p.k, 7 * p.k, { fill: '#a8a098' }));
    }
  }
  return g({}, out);
}

/** Seated/standing people in silhouette. */
function crowd(r: Room, count: number, band: [number, number]): string {
  const out: string[] = [];
  const fr = r.rng.fork('crowd');
  const pal = CULTURE_PALETTE[r.culture];
  const spots: { u: number; t: number }[] = [];
  for (let i = 0; i < count; i++) spots.push({ u: (fr.chance(0.5) ? -1 : 1) * fr.range(band[0], band[1]), t: fr.range(0.05, 0.85) });
  spots.sort((a, b) => b.t - a.t);
  for (const s of spots) {
    const p = at(s.u, s.t);
    out.push(figure(p.x, p.y - 10 * p.k, 300 * p.k, shade('#2a1d14', fr.range(-0.2, 0.2)), { cloak: shade(fr.pick(pal.cloth), -0.35) }));
  }
  return g({}, out);
}

function hangingThings(r: Room, kind: 'herbs' | 'tools' | 'pots'): string {
  const out: string[] = [];
  const fr = r.rng.fork(kind);
  for (let i = 0; i < 12; i++) {
    const p = at(fr.range(-0.7, 0.7), fr.range(0.2, 0.9));
    const top = p.ceil + 20 * p.k;
    const len = fr.range(40, 120) * p.k;
    out.push(line(p.x, top, p.x, top + len, { stroke: '#2a1a10', 'stroke-width': n2(1.4 * p.k + 0.5) }));
    if (kind === 'herbs') {
      // A tied bundle hanging head-down: stems gathered at the cord, leaves fanning out below.
      const col = fr.pick(['#5a6a3a', '#6a5a3a', '#4a5a2a', '#7a6a4a', '#7a5a5a']);
      const y0 = top + len;
      out.push(path(`M${n(p.x - 3 * p.k)} ${n(y0)}L${n(p.x - 14 * p.k)} ${n(y0 + 34 * p.k)}Q${n(p.x)} ${n(y0 + 44 * p.k)} ${n(p.x + 14 * p.k)} ${n(y0 + 34 * p.k)}L${n(p.x + 3 * p.k)} ${n(y0)}Z`, { fill: col }));
      out.push(path(`M${n(p.x)} ${n(y0)}V${n(y0 + 36 * p.k)}M${n(p.x)} ${n(y0 + 4 * p.k)}L${n(p.x - 8 * p.k)} ${n(y0 + 32 * p.k)}M${n(p.x)} ${n(y0 + 4 * p.k)}L${n(p.x + 8 * p.k)} ${n(y0 + 32 * p.k)}`, { stroke: shade(col, -0.35), 'stroke-width': n2(1.2 * p.k + 0.3), fill: 'none' }));
      out.push(rect(p.x - 4 * p.k, y0 - 2 * p.k, 8 * p.k, 4 * p.k, { fill: '#8a6a42' }));
    }
    if (kind === 'tools') out.push(path(`M${n(p.x - 8 * p.k)} ${n(top + len)}h${n(16 * p.k)}v${n(10 * p.k)}h${n(-16 * p.k)}Z`, { fill: '#5b6066' }));
    if (kind === 'pots') out.push(ellipse(p.x, top + len, 16 * p.k, 12 * p.k, { fill: '#3a3430' }));
  }
  return g({}, out);
}

// ---------------------------------------------------------------------------------------------
// Interiors

function indoor(kind: InteriorKind, r: Room): string {
  const out: string[] = [];
  switch (kind) {
    case 'greatHall':
    case 'leadersHall': {
      out.push(roomShell(r, { beams: true, smokeHole: true, windows: false }));
      out.push(highSeat(r, kind === 'leadersHall'));
      out.push(benches(r));
      out.push(wallShields(r, -1, 7), wallShields(r, 1, 7));
      out.push(longHearth(r, 0.18, 0.78, 1));
      for (const tt of [0.85, 0.6, 0.35, 0.1]) out.push(pillar(r, -0.55, tt, kind === 'leadersHall'), pillar(r, 0.55, tt, kind === 'leadersHall'));
      out.push(crowd(r, kind === 'leadersHall' ? 10 : 6, [0.62, 0.8]));
      break;
    }
    case 'meadHall': {
      out.push(roomShell(r, { beams: true, smokeHole: true, windows: false }));
      out.push(benches(r));
      out.push(wallShields(r, -1, 5), wallShields(r, 1, 5));
      out.push(longHearth(r, 0.35, 0.7, 0.8));
      out.push(feastTables(r));
      for (let i = 0; i < 3; i++) {
        const p = at(0.85, 0.85 - i * 0.12);
        out.push(ellipse(p.x, p.y - 50 * p.k, 34 * p.k, 50 * p.k, { fill: '#6a4a2c', stroke: '#3a2616', 'stroke-width': 3 }));
      }
      out.push(crowd(r, 16, [0.2, 0.5]));
      for (const tt of [0.75, 0.4]) out.push(pillar(r, -0.6, tt, false), pillar(r, 0.6, tt, false));
      break;
    }
    case 'longhouse': {
      out.push(roomShell(r, { beams: true, smokeHole: true, windows: false }));
      out.push(benches(r));
      out.push(longHearth(r, 0.3, 0.55, 0.7));
      out.push(hangingThings(r, 'pots'));
      // Loom against the left wall, stalls at the back.
      const lp = at(-0.85, 0.3);
      out.push(rect(lp.x, lp.y - 300 * lp.k, 120 * lp.k, 300 * lp.k, { fill: 'none', stroke: '#4a3220', 'stroke-width': 8 }));
      for (let i = 0; i < 14; i++) out.push(line(lp.x + 10 * lp.k + i * 7 * lp.k, lp.y - 290 * lp.k, lp.x + 10 * lp.k + i * 7 * lp.k, lp.y - 40 * lp.k, { stroke: '#c8b898', 'stroke-width': 1.4 }));
      out.push(rect(lp.x + 6 * lp.k, lp.y - 200 * lp.k, 108 * lp.k, 120 * lp.k, { fill: r.accent, opacity: '0.75' }));
      for (let i = 0; i < 4; i++) {
        const p = at(-0.6 + i * 0.4, 0.95);
        out.push(rect(p.x - 60 * p.k, p.y - 110 * p.k, 120 * p.k, 110 * p.k, { fill: 'none', stroke: r.mat.post, 'stroke-width': 6 }));
      }
      out.push(crowd(r, 4, [0.4, 0.6]));
      break;
    }
    case 'smithy': {
      out.push(roomShell(r, { beams: true, smokeHole: false, windows: false }));
      out.push(hangingThings(r, 'tools'));
      const f = at(-0.45, 0.6);
      out.push(rect(f.x - 150 * f.k, f.y - 150 * f.k, 300 * f.k, 150 * f.k, { fill: '#5a5450', stroke: '#2a2622', 'stroke-width': 4 }));
      out.push(ellipse(f.x, f.y - 150 * f.k, 120 * f.k, 26 * f.k, { fill: '#2a1a10' }));
      out.push(ellipse(f.x, f.y - 152 * f.k, 90 * f.k, 18 * f.k, { fill: 'url(#in-ember)' }));
      out.push(path(`M${n(f.x - 60 * f.k)} ${n(f.y - 160 * f.k)}L${n(f.x - 90 * f.k)} ${n(BY0)}H${n(f.x + 90 * f.k)}L${n(f.x + 60 * f.k)} ${n(f.y - 160 * f.k)}Z`, { fill: '#3a3430', opacity: '0.85' }));
      const a = at(0.2, 0.3);
      out.push(path(`M${n(a.x - 110 * a.k)} ${n(a.y - 120 * a.k)}H${n(a.x + 70 * a.k)}Q${n(a.x + 130 * a.k)} ${n(a.y - 120 * a.k)} ${n(a.x + 150 * a.k)} ${n(a.y - 150 * a.k)}Q${n(a.x + 140 * a.k)} ${n(a.y - 95 * a.k)} ${n(a.x + 70 * a.k)} ${n(a.y - 95 * a.k)}L${n(a.x + 50 * a.k)} ${n(a.y - 60 * a.k)}H${n(a.x - 70 * a.k)}L${n(a.x - 90 * a.k)} ${n(a.y - 95 * a.k)}H${n(a.x - 110 * a.k)}Z`, { fill: '#3a3e44' }));
      out.push(rect(a.x - 40 * a.k, a.y - 60 * a.k, 80 * a.k, 60 * a.k, { fill: '#5a3e26' }));
      out.push(rect(a.x - 20 * a.k, a.y - 136 * a.k, 60 * a.k, 14 * a.k, { fill: '#e07030' }));
      const tub = at(0.7, 0.55);
      out.push(ellipse(tub.x, tub.y - 50 * tub.k, 70 * tub.k, 22 * tub.k, { fill: '#1d3a48' }), rect(tub.x - 70 * tub.k, tub.y - 50 * tub.k, 140 * tub.k, 50 * tub.k, { fill: '#5a3e26' }));
      out.push(crowd(r, 2, [0.05, 0.3]));
      break;
    }
    case 'seerHut': {
      out.push(roomShell(r, { beams: false, smokeHole: true, windows: false }));
      // A painted hide stretched on a frame against the back wall.
      const hw = at(-0.45, 1);
      const hx0 = hw.x - 80;
      const hy0 = BY0 + 70;
      out.push(rect(hx0, hy0, 160, 190, { fill: 'none', stroke: '#4a3220', 'stroke-width': 6 }));
      out.push(path(`M${n(hx0 + 18)} ${n(hy0 + 14)}Q${n(hx0 + 80)} ${n(hy0 + 2)} ${n(hx0 + 142)} ${n(hy0 + 14)}Q${n(hx0 + 150)} ${n(hy0 + 95)} ${n(hx0 + 140)} ${n(hy0 + 176)}Q${n(hx0 + 80)} ${n(hy0 + 188)} ${n(hx0 + 20)} ${n(hy0 + 176)}Q${n(hx0 + 10)} ${n(hy0 + 95)} ${n(hx0 + 18)} ${n(hy0 + 14)}Z`, { fill: '#b08e62' }));
      for (const [x1, y1, x2, y2] of [[hx0 + 18, hy0 + 14, hx0, hy0], [hx0 + 142, hy0 + 14, hx0 + 160, hy0], [hx0 + 20, hy0 + 176, hx0, hy0 + 190], [hx0 + 140, hy0 + 176, hx0 + 160, hy0 + 190]] as const) out.push(line(x1, y1, x2, y2, { stroke: '#3a2a1a', 'stroke-width': 1.6 }));
      // Painted with a spiral and a ring of dots in red ochre.
      {
        const cx = hx0 + 80;
        const cy = hy0 + 92;
        let d = `M${n(cx)} ${n(cy)}`;
        // Semicircles of radius i·a, all clockwise, ending alternately right and left of the centre.
        const a = 5.5;
        for (let i = 1; i <= 6; i++) d += `A${n(i * a)} ${n(i * a)} 0 0 1 ${n(i % 2 ? cx + (i + 1) * a : cx - i * a)} ${n(cy)}`;
        out.push(path(d, { fill: 'none', stroke: '#6a2a1a', 'stroke-width': 3.4, 'stroke-linecap': 'round' }));
        for (let i = 0; i < 12; i++) out.push(circle(cx + Math.cos((i / 12) * Math.PI * 2) * 52, cy + Math.sin((i / 12) * Math.PI * 2) * 62, 3, { fill: '#6a2a1a' }));
      }
      // A shelf of crocks, a skull of an elk and bone charms.
      const sw = at(0.45, 1);
      out.push(rect(sw.x - 100, BY0 + 170, 200, 10, { fill: '#4a3220' }));
      for (let i = 0; i < 5; i++) {
        const x = sw.x - 80 + i * 40;
        const h = 26 + ((i * 7) % 13);
        out.push(path(`M${n(x - 12)} ${n(BY0 + 170)}Q${n(x - 18)} ${n(BY0 + 170 - h * 0.6)} ${n(x - 6)} ${n(BY0 + 170 - h)}H${n(x + 6)}Q${n(x + 18)} ${n(BY0 + 170 - h * 0.6)} ${n(x + 12)} ${n(BY0 + 170)}Z`, { fill: ['#7a5a3a', '#8a6a4a', '#5a4a3a', '#9a7a52', '#6a4a32'][i] as string }));
      }
      out.push(path(`M${n(sw.x - 30)} ${n(BY0 + 70)}q-40 -30 -56 -6M${n(sw.x + 30)} ${n(BY0 + 70)}q40 -30 56 -6M${n(sw.x - 44)} ${n(BY0 + 60)}l-8 -22M${n(sw.x + 44)} ${n(BY0 + 60)}l8 -22`, { fill: 'none', stroke: '#d8ccb0', 'stroke-width': 5, 'stroke-linecap': 'round' }));
      out.push(path(`M${n(sw.x - 22)} ${n(BY0 + 64)}Q${n(sw.x)} ${n(BY0 + 54)} ${n(sw.x + 22)} ${n(BY0 + 64)}L${n(sw.x + 10)} ${n(BY0 + 120)}H${n(sw.x - 10)}Z`, { fill: '#d8ccb0' }), circle(sw.x - 9, BY0 + 78, 4, { fill: '#2a1a10' }), circle(sw.x + 9, BY0 + 78, 4, { fill: '#2a1a10' }));
      for (let i = 0; i < 4; i++) out.push(line(sw.x - 60 + i * 40, BY0 + 180, sw.x - 60 + i * 40, BY0 + 220, { stroke: '#2a1a10', 'stroke-width': 1.2 }), ellipse(sw.x - 60 + i * 40, BY0 + 226, 4, 7, { fill: '#e0d4b8' }));
      out.push(hangingThings(r, 'herbs'));
      const fp = at(0, 0.45);
      out.push(ellipse(fp.x, fp.y, 120 * fp.k, 34 * fp.k, { fill: '#3a3430', stroke: '#6a6258', 'stroke-width': 4 }));
      for (let i = 0; i < 4; i++) out.push(path(`M${n(fp.x - 40 * fp.k + i * 26 * fp.k)} ${n(fp.y)}Q${n(fp.x - 30 * fp.k + i * 26 * fp.k)} ${n(fp.y - 90 * fp.k)} ${n(fp.x - 20 * fp.k + i * 26 * fp.k)} ${n(fp.y - 140 * fp.k)}Q${n(fp.x - 8 * fp.k + i * 26 * fp.k)} ${n(fp.y - 70 * fp.k)} ${n(fp.x + i * 26 * fp.k)} ${n(fp.y)}Z`, { fill: 'url(#in-flame)' }));
      // Iron cauldron hanging from a tripod over the fire, steaming.
      const apexY = fp.y - 330 * fp.k;
      out.push(path(`M${n(fp.x - 130 * fp.k)} ${n(fp.y + 10 * fp.k)}L${n(fp.x)} ${n(apexY)}L${n(fp.x + 130 * fp.k)} ${n(fp.y + 10 * fp.k)}M${n(fp.x)} ${n(apexY)}L${n(fp.x + 30 * fp.k)} ${n(fp.y - 10 * fp.k)}`, { fill: 'none', stroke: '#3a2a1a', 'stroke-width': n2(7 * fp.k) }));
      out.push(line(fp.x, apexY, fp.x, fp.y - 190 * fp.k, { stroke: '#2a2622', 'stroke-width': n2(3 * fp.k), 'stroke-dasharray': `${n(6 * fp.k)} ${n(3 * fp.k)}` }));
      out.push(path(`M${n(fp.x - 62 * fp.k)} ${n(fp.y - 180 * fp.k)}Q${n(fp.x - 66 * fp.k)} ${n(fp.y - 100 * fp.k)} ${n(fp.x)} ${n(fp.y - 96 * fp.k)}Q${n(fp.x + 66 * fp.k)} ${n(fp.y - 100 * fp.k)} ${n(fp.x + 62 * fp.k)} ${n(fp.y - 180 * fp.k)}Z`, { fill: '#2a2622', stroke: '#14110e', 'stroke-width': 2 }));
      out.push(ellipse(fp.x, fp.y - 180 * fp.k, 62 * fp.k, 14 * fp.k, { fill: '#3a3430', stroke: '#14110e', 'stroke-width': 2 }));
      out.push(path(`M${n(fp.x - 20 * fp.k)} ${n(fp.y - 196 * fp.k)}q${n(-14 * fp.k)} ${n(-40 * fp.k)} ${n(6 * fp.k)} ${n(-70 * fp.k)}q${n(18 * fp.k)} ${n(-30 * fp.k)} ${n(-4 * fp.k)} ${n(-70 * fp.k)}M${n(fp.x + 22 * fp.k)} ${n(fp.y - 196 * fp.k)}q${n(16 * fp.k)} ${n(-36 * fp.k)} ${n(-2 * fp.k)} ${n(-66 * fp.k)}`, { fill: 'none', stroke: '#d8d4cc', 'stroke-width': n2(6 * fp.k), opacity: '0.25', 'stroke-linecap': 'round' }));
      // A woven mat by the hearth.
      const mp = at(-0.1, 0.18);
      out.push(ellipse(mp.x, mp.y, 170 * mp.k, 34 * mp.k, { fill: r.accent, opacity: '0.45' }), ellipse(mp.x, mp.y, 130 * mp.k, 24 * mp.k, { fill: 'none', stroke: shade(r.accent, -0.3), 'stroke-width': 3, opacity: '0.6' }));
      const sp = at(0.4, 0.75);
      out.push(rect(sp.x - 60 * sp.k, sp.y - 100 * sp.k, 120 * sp.k, 100 * sp.k, { fill: '#4a3220' }), rect(sp.x - 50 * sp.k, sp.y - 260 * sp.k, 100 * sp.k, 170 * sp.k, { fill: '#3a2616' }));
      out.push(line(sp.x + 90 * sp.k, sp.y, sp.x + 80 * sp.k, sp.y - 360 * sp.k, { stroke: '#5a3e26', 'stroke-width': 8 }), circle(sp.x + 80 * sp.k, sp.y - 372 * sp.k, 14 * sp.k, { fill: 'none', stroke: '#5a3e26', 'stroke-width': 6 }));
      const tp = at(-0.45, 0.4);
      out.push(rect(tp.x - 90 * tp.k, tp.y - 70 * tp.k, 180 * tp.k, 16 * tp.k, { fill: '#6a4a2c' }));
      for (let i = 0; i < 6; i++) out.push(rect(tp.x - 70 * tp.k + i * 26 * tp.k, tp.y - 110 * tp.k, 8 * tp.k, 40 * tp.k, { fill: '#c8b898' }));
      out.push(crowd(r, 1, [0.3, 0.35]));
      break;
    }
    case 'church': {
      out.push(roomShell(r, { beams: r.matKind !== 'south', smokeHole: false, windows: true }));
      const p = at(0, 0.95);
      out.push(rect(p.x - 90 * p.k, p.y - 90 * p.k, 180 * p.k, 90 * p.k, { fill: '#e8dcc0', stroke: '#8a7a5a', 'stroke-width': 3 }));
      out.push(rect(p.x - 84 * p.k, p.y - 70 * p.k, 168 * p.k, 30 * p.k, { fill: r.accent, opacity: '0.85' }));
      // The lantern of the One Flame.
      const ly = p.y - 210 * p.k;
      out.push(line(p.x, BY0, p.x, ly - 50 * p.k, { stroke: '#3a2a1a', 'stroke-width': 3 }));
      out.push(path(`M${n(p.x - 34 * p.k)} ${n(ly - 46 * p.k)}H${n(p.x + 34 * p.k)}L${n(p.x + 26 * p.k)} ${n(ly + 46 * p.k)}H${n(p.x - 26 * p.k)}Z`, { fill: '#c9a227', stroke: '#6a4a10', 'stroke-width': 3 }));
      out.push(ellipse(p.x, ly, 16 * p.k, 26 * p.k, { fill: '#fff2a0' }));
      out.push(circle(p.x, ly, 140 * p.k, { fill: 'url(#in-glow)' }));
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const c = at(side * (0.3 + i * 0.05), 0.92 - i * 0.05);
        out.push(rect(c.x - 5 * c.k, c.y - 120 * c.k, 10 * c.k, 60 * c.k, { fill: '#f0e8d0' }), ellipse(c.x, c.y - 130 * c.k, 5 * c.k, 10 * c.k, { fill: '#ffd060' }));
      }
      for (const tt of [0.75, 0.45, 0.15]) out.push(pillar(r, -0.6, tt, false), pillar(r, 0.6, tt, false));
      out.push(crowd(r, 8, [0.05, 0.45]));
      break;
    }
    default:
      break;
  }
  return g({}, out);
}

/** Open-air yards: shipyard, market, grove. */
function outdoor(kind: InteriorKind, culture: CultureId, night: boolean, season: SeasonKey, seed: number, defs: string[]): string {
  const s = newScene(W, H, `yard|${kind}|${culture}|${seed}`, culture, season, night ? 'night' : 'day');
  const horizon = 380;
  const out: string[] = [drawSky(s, horizon)];
  const green = s.season === 'autumn' ? '#7a7a3a' : s.season === 'winter' ? '#8a8a7a' : '#5a7a42';
  const r = s.rng.fork('yard');
  const bo = (k: number): BuildOpts => ({ k, lit: s.lit, ruined: false, snow: s.snow, rng: r, accent: CULTURE_PALETTE[culture].primary, wealth: 0.6 });
  const style = buildStyleOf(culture);
  const house = (x: number, y: number, k: number): string =>
    style === 'albric' ? timberHall(x, y, bo(k), false) : style === 'cael' ? roundhouse(x, y, bo(k)) : style === 'corvani' || style === 'saraleon' ? stoneHouse(x, y, bo(k), style === 'saraleon') : style === 'velkar' ? logHouse(x, y, bo(k)) : longhouse(x, y, bo(k), 'long');
  if (kind === 'shipyard') {
    out.push(water(s, horizon, H));
    out.push(groundMass(s, 300, W + 40, (x) => 520 - (x - 300) * 0.06, H, '#8a7a5a', '#a89a7a'));
    out.push(house(1300, 520, 1.6), house(1050, 500, 1.2));
    // A hull on the stocks, ribs showing.
    const hx = 760;
    const hy = 700;
    out.push(rect(hx - 340, hy, 680, 18, { fill: '#4a3220' }));
    for (let i = -4; i <= 4; i++) out.push(rect(hx + i * 80 - 12, hy + 18, 24, 50, { fill: '#3a2616' }));
    out.push(shipSide(hx, hy - 10, 640, culture, { sail: 'none', shields: false }));
    for (let i = -6; i <= 6; i++) out.push(path(`M${hx + i * 40} ${hy - 60}Q${hx + i * 42} ${hy - 160} ${hx + i * 36} ${hy - 200}`, { fill: 'none', stroke: '#c8a070', 'stroke-width': 7 }));
    for (let i = 0; i < 8; i++) out.push(rect(1150 + r.jitter(40), 760 + i * 12, 300, 10, { fill: shade('#a07848', r.range(-0.2, 0.1)), rx: 4 }));
    out.push(figure(520, 820, 120, '#1a140e', { cloak: '#5a4a3a' }), figure(1000, 800, 110, '#1a140e', { cloak: '#6a3a2a' }));
  } else if (kind === 'market') {
    out.push(groundMass(s, -40, W + 40, () => horizon + 40, H, mix(green, '#8a7a5a', 0.4)));
    for (let i = 0; i < 6; i++) out.push(house(120 + i * 280 + r.jitter(30), horizon + 80, 1.3));
    for (let i = 0; i < 7; i++) out.push(stall(120 + i * 230 + r.jitter(20), 640 + (i % 2) * 40, bo(3.2)));
    for (let i = 0; i < 14; i++) out.push(figure(r.range(60, W - 60), r.range(720, 860), r.range(110, 150), '#1a140e', { cloak: shade(r.pick(CULTURE_PALETTE[culture].cloth), -0.3) }));
  } else {
    // Grove: great trees, carved posts hung with offerings, a stone altar.
    out.push(groundMass(s, -40, W + 40, (x) => horizon + 60 + Math.sin(x / 200) * 12, H, green));
    for (let i = 0; i < 9; i++) {
      const x = 80 + i * 180 + r.jitter(40);
      out.push(culture === 'velkar' || CULTURE_GROUP[culture] === 'north' || CULTURE_GROUP[culture] === 'far' ? conifer(x, horizon + 90, 260 + r.range(0, 80), '#2e4a32', s.snow) : broadleaf(x, horizon + 90, 300 + r.range(0, 80), s.season === 'autumn' ? '#a86a2a' : '#4a6e3a', s.season === 'winter'));
    }
    const tx = 800;
    out.push(path(`M${tx - 60} 800Q${tx - 40} 560 ${tx - 30} 420Q${tx - 120} 360 ${tx - 260} 300M${tx - 30} 420Q${tx} 300 ${tx + 40} 200M${tx + 40} 800Q${tx + 50} 600 ${tx + 30} 430Q${tx + 140} 380 ${tx + 280} 330`, { fill: 'none', stroke: '#3a2a1a', 'stroke-width': 34, 'stroke-linecap': 'round' }));
    out.push(path(`M${tx - 60} 800Q${tx - 40} 560 ${tx - 30} 420L${tx + 30} 430Q${tx + 50} 600 ${tx + 40} 800Z`, { fill: '#3a2a1a' }));
    if (s.season !== 'winter') for (let i = 0; i < 14; i++) out.push(circle(tx + r.jitter(380), 260 + r.jitter(120), r.range(60, 120), { fill: shade(s.season === 'autumn' ? '#a86a2a' : '#4a6e3a', r.range(-0.2, 0.15)), opacity: '0.92' }));
    for (let i = 0; i < 10; i++) {
      const x = tx + r.jitter(300);
      const y = 380 + r.range(0, 120);
      out.push(line(x, y, x, y + r.range(30, 70), { stroke: '#3a2a1a', 'stroke-width': 1.6 }), rect(x - 5, y + 40 + r.range(0, 30), 10, 26, { fill: r.pick(['#9b2f2a', '#e8dcc0', '#c9a227', '#2b4f86']) }));
    }
    out.push(path(`M${tx - 160} 840L${tx - 140} 770H${tx + 140}L${tx + 160} 840Z`, { fill: '#7d786c', stroke: '#34312b', 'stroke-width': 3 }));
    for (const px of [tx - 380, tx + 360]) {
      out.push(rect(px - 16, 560, 32, 260, { fill: '#5a3e26' }));
      for (let i = 0; i < 5; i++) out.push(path(`M${px - 16} ${590 + i * 44}q16 -14 32 0`, { fill: 'none', stroke: '#8a6a42', 'stroke-width': 4 }));
      out.push(path(`M${px - 22} 560q22 -50 44 0Z`, { fill: '#4a3220' }));
    }
    out.push(figure(560, 860, 150, '#1a140e', { cloak: '#4a3a5a' }));
  }
  if (s.sky.dark > 0) out.push(rect(0, 0, W, H, { fill: '#0a1020', opacity: n2(s.sky.dark * 0.6) }));
  defs.push(...sceneDefs(), ...s.defs);
  return g({}, out);
}

export interface InteriorParams {
  kind: InteriorKind;
  culture: CultureId;
  light: 'day' | 'night';
  season: SeasonKey;
  seed: number;
}

/** Renders an interior or yard. */
export function interiorSvg(p: InteriorParams, opts: { width?: number; height?: number; watermark?: WatermarkMode; label?: string } = {}): string {
  const group = CULTURE_GROUP[p.culture];
  const pal = CULTURE_PALETTE[p.culture];
  const night = p.light === 'night';
  const defs: string[] = [
    linearGradient('in-flame', [[0, '#fff2a0'], [0.35, '#f6b04a'], [1, '#c03a14', 0.6]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
    radialGradient('in-ember', [[0, '#fff0a0'], [0.5, '#f08a30'], [1, '#801a08']]),
    radialGradient('in-glow', [[0, '#ffd890', 0.45], [1, '#ffd890', 0]]),
    radialGradient('in-fire', [[0, '#ffb060', night ? 0.5 : 0.12], [0.5, '#e07030', night ? 0.22 : 0.04], [1, '#000000', 0]], { cx: 0.5, cy: 0.62, r: 0.6 }),
    radialGradient('in-dark', [[0.3, '#000000', 0], [1, '#05030a', night ? 0.8 : 0.45]], { cx: 0.5, cy: 0.55, r: 0.75 }),
    grainFilter('in-grain', p.seed, 0.85, 0.2),
    mottleFilter('in-mottle', p.seed, 0.008),
    vignetteGradient('in-vig', 0.5),
  ];
  const outdoorKind = p.kind === 'shipyard' || p.kind === 'market' || p.kind === 'grove';
  const body: string[] = [];
  if (outdoorKind) {
    body.push(outdoor(p.kind, p.culture, night, p.season, p.seed, defs));
  } else {
    const room: Room = { defs, rng: new ArtRng(`int|${p.kind}|${p.culture}|${p.seed}`), mat: MATS[materialOf(group)], matKind: materialOf(group), culture: p.culture, night, accent: pal.primary, accent2: pal.secondary };
    body.push(indoor(p.kind, room));
    body.push(rect(0, 0, W, H, { fill: 'url(#in-dark)' }));
    body.push(rect(0, 0, W, H, { fill: 'url(#in-fire)', style: 'mix-blend-mode:screen' }));
    if (night) body.push(rect(0, 0, W, H, { fill: '#ff9a40', style: 'mix-blend-mode:multiply', opacity: '0.25' }));
  }
  body.push(rect(0, 0, W, H, { filter: 'url(#in-mottle)', opacity: '0.3', style: 'mix-blend-mode:multiply' }));
  body.push(rect(0, 0, W, H, { filter: 'url(#in-grain)', opacity: '0.75', style: 'mix-blend-mode:multiply' }));
  body.push(rect(0, 0, W, H, { fill: 'url(#in-vig)' }));
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  if (opts.watermark && opts.watermark !== 'off') body.push(g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark)));
  return svgDoc({ width, height, viewBox: [0, 0, W, H], defs, body, preserveAspectRatio: 'xMidYMid slice' });
}

export function interiorParamsFrom(params: GeneratorParams): InteriorParams {
  const building = typeof params.building === 'string' && Object.hasOwn(INTERIOR_OF_BUILDING, params.building) ? INTERIOR_OF_BUILDING[params.building] : undefined;
  const culture = oneOf(params, 'culture', ALL_CULTURES, 'skarn');
  return {
    kind: oneOf(params, 'kind', INTERIOR_KINDS, building ?? 'greatHall'),
    culture,
    light: oneOf(params, 'light', INTERIOR_LIGHTS, 'night'),
    season: oneOf(params, 'season', SEASONS, 'summer'),
    seed: seedOf(params, `${culture}`),
  };
}

export const interiorGenerator: ImageGenerator = {
  id: 'interior',
  kind: 'image',
  defaultSize: INTERIOR_SIZE,
  params: [
    { name: 'kind', type: 'enum', values: INTERIOR_KINDS, default: 'greatHall' },
    { name: 'building', type: 'enum', values: Object.keys(INTERIOR_OF_BUILDING), note: 'buildings.json id (alternative to kind)' },
    { name: 'culture', type: 'enum', values: ALL_CULTURES, default: 'skarn' },
    { name: 'light', type: 'enum', values: INTERIOR_LIGHTS, default: 'night' },
    { name: 'season', type: 'enum', values: SEASONS, default: 'summer', note: 'yards only' },
    { name: 'seed', type: 'number' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return interiorSvg(interiorParamsFrom(params), { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label });
  },
  variants(): GeneratorParams[] {
    const out: GeneratorParams[] = [];
    const cultures: CultureId[] = ['skarn', 'albric', 'corvani', 'velkar'];
    INTERIOR_KINDS.forEach((kind, i) => out.push({ kind, culture: cultures[i % cultures.length] as CultureId, light: i % 3 === 0 ? 'day' : 'night', seed: 5 }));
    for (const culture of cultures) out.push({ kind: 'leadersHall', culture, light: 'night', seed: 9 });
    return out;
  },
};

