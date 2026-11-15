/**
 * Shared painted-scene toolkit for panoramas and vignettes: sky, sun/moon/stars, clouds, ridges,
 * water, trees, culture building styles, beached ships, smoke, figures and the light/paint overlays.
 * Everything is plain SVG strings with seeded randomness (see svg/rng.ts).
 *
 * Period grounding (§4.1, ADR-002): turf- and shingle-roofed longhouses in the North; timber halls,
 * earth-and-timber burhs and small Lantern churches in Albrenn; roundhouses and round towers in the
 * Cael Isles; old imperial stone walls and red tile in Corvaine; white walls and gilded domes in
 * Saraleon; log houses and hill-forts on the Velkar rivers; felt tents on the steppe; skin tents and
 * drying racks in the Rimewild. Oared hulls with square sails.
 */
import type { CultureId } from '@content/schemas/ids';
import { circle, el, ellipse, g, line, linearGradient, n, n2, path, polygon, radialGradient, rect, smoothOpen } from '../svg/svg';
import { CULTURE_GROUP, CULTURE_PALETTE, mix, shade, skyLook, type CultureGroup, type SeasonKey, type SkyLook, type TimeOfDay } from '../svg/palette';
import { ArtRng } from '../svg/rng';

/** Building styles (one per visual culture). */
export type BuildStyle = 'north' | 'albric' | 'cael' | 'corvani' | 'saraleon' | 'velkar' | 'steppe' | 'rime';

/** Culture → building style. */
export function buildStyleOf(culture: CultureId): BuildStyle {
  switch (culture) {
    case 'albric':
      return 'albric';
    case 'cael':
      return 'cael';
    case 'corvani':
      return 'corvani';
    case 'saraleonese':
      return 'saraleon';
    case 'velkar':
      return 'velkar';
    case 'kurgai':
      return 'steppe';
    case 'rime':
      return 'rime';
    default:
      return 'north';
  }
}

/** Scene-wide drawing state. */
export interface Scene {
  W: number;
  H: number;
  rng: ArtRng;
  defs: string[];
  sky: SkyLook;
  season: SeasonKey;
  time: TimeOfDay;
  culture: CultureId;
  group: CultureGroup;
  /** 0..1 snow cover. */
  snow: number;
  /** True at dusk/night: windows and doors glow. */
  lit: boolean;
  /** Unique-id counter. */
  uid: number;
}

export function newScene(W: number, H: number, seed: string, culture: CultureId, season: SeasonKey, time: TimeOfDay): Scene {
  const group = CULTURE_GROUP[culture];
  const snowBase = season === 'winter' ? (group === 'south' ? 0 : group === 'west' ? 0.45 : 0.9) : season === 'spring' && (group === 'north' || group === 'far') ? 0.2 : 0;
  return {
    W,
    H,
    rng: new ArtRng(seed),
    defs: [],
    sky: skyLook(season, time),
    season,
    time,
    culture,
    group,
    snow: group === 'far' ? Math.max(snowBase, season === 'summer' ? 0.35 : 0.85) : snowBase,
    lit: time === 'dusk' || time === 'night',
    uid: 0,
  };
}

export function uid(s: Scene, prefix: string): string {
  s.uid++;
  return `${prefix}${s.uid}`;
}

// ---------------------------------------------------------------------------------------------
// Sky

export function drawSky(s: Scene, horizon: number): string {
  const id = uid(s, 'sky');
  const { sky } = s;
  s.defs.push(linearGradient(id, [[0, sky.zenith], [0.55, sky.mid], [1, sky.horizon]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  const out: string[] = [rect(0, 0, s.W, horizon + 40, { fill: `url(#${id})` })];
  const r = s.rng.fork('sky');
  if (s.time === 'night') {
    for (let i = 0; i < 140; i++) out.push(circle(r.next() * s.W, r.next() * horizon * 0.9, r.range(0.6, 1.8), { fill: '#f4f0e0', opacity: n2(r.range(0.25, 0.9)) }));
    out.push(...moon(s, s.W * r.range(0.62, 0.85), horizon * r.range(0.18, 0.32), 26));
  } else {
    const sx = s.time === 'dawn' ? s.W * 0.22 : s.time === 'dusk' ? s.W * 0.8 : s.W * r.range(0.3, 0.7);
    const sy = s.time === 'day' ? horizon * 0.22 : horizon * 0.86;
    const gid = uid(s, 'sun');
    s.defs.push(radialGradient(gid, [[0, sky.sun, 0.95], [0.1, sky.sun, 0.75], [0.35, sky.sun, 0.18], [1, sky.sun, 0]]));
    out.push(circle(sx, sy, s.time === 'day' ? 220 : 320, { fill: `url(#${gid})` }));
    out.push(circle(sx, sy, s.time === 'day' ? 26 : 34, { fill: mix(sky.sun, '#ffffff', 0.4), opacity: s.time === 'day' ? '0.9' : '0.95' }));
  }
  out.push(clouds(s, horizon));
  return g({}, out);
}

function moon(s: Scene, x: number, y: number, r: number): string[] {
  const gid = uid(s, 'moon');
  const mid = uid(s, 'moonb');
  s.defs.push(radialGradient(gid, [[0, '#e8ecf4', 0.3], [1, '#e8ecf4', 0]]));
  s.defs.push(radialGradient(mid, [[0, '#fbf8ee'], [0.75, '#e8e4d6'], [1, '#c8c4b4']], { cx: 0.4, cy: 0.38, r: 0.7 }));
  return [
    circle(x, y, r * 5, { fill: `url(#${gid})` }),
    circle(x, y, r, { fill: `url(#${mid})` }),
    circle(x - r * 0.3, y - r * 0.2, r * 0.22, { fill: '#b8b4a6', opacity: '0.45' }),
    circle(x + r * 0.25, y + r * 0.3, r * 0.16, { fill: '#b8b4a6', opacity: '0.4' }),
    circle(x + r * 0.1, y - r * 0.4, r * 0.1, { fill: '#b8b4a6', opacity: '0.35' }),
  ];
}

function clouds(s: Scene, horizon: number): string {
  const fid = uid(s, 'cb');
  s.defs.push(el('filter', { id: fid, x: '-30%', y: '-60%', width: '160%', height: '220%' }, el('feGaussianBlur', { stdDeviation: 3.5 })));
  const r = s.rng.fork('clouds');
  const count = s.season === 'winter' || s.season === 'autumn' ? 8 : 5;
  const lightCol = s.time === 'night' ? '#3a4560' : s.time === 'dusk' ? mix(s.sky.horizon, '#ffd0a0', 0.4) : mix(s.sky.horizon, '#ffffff', 0.6);
  const darkCol = s.time === 'night' ? '#141a2c' : mix(s.sky.mid, '#5a6070', 0.5);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const cx = r.next() * s.W;
    const cy = horizon * r.range(0.1, 0.62);
    const w = r.range(140, 360) * (1 - (cy / horizon) * 0.3);
    const h = w * r.range(0.16, 0.26);
    const lobes: string[] = [];
    const base: string[] = [];
    for (let k = 0; k < 6; k++) {
      const lx = cx + (k / 5 - 0.5) * w * 0.9 + r.jitter(w * 0.06);
      const lr = h * r.range(0.45, 0.85) * (1 - Math.abs(k / 5 - 0.5) * 0.9);
      lobes.push(circle(lx, cy - lr * 0.4, lr));
    }
    base.push(ellipse(cx, cy + h * 0.15, w * 0.52, h * 0.32));
    out.push(g({ fill: darkCol, opacity: '0.5' }, [...base, ...lobes.map((l) => l.replace('<circle', '<circle transform="translate(4 10)"'))]));
    out.push(g({ fill: lightCol, opacity: n2(r.range(0.7, 0.9)) }, [...base, ...lobes]));
  }
  return g({ filter: `url(#${fid})` }, out);
}

// ---------------------------------------------------------------------------------------------
// Terrain

/** A ridge line by midpoint displacement → closed polygon down to `bottom`. */
export function ridge(s: Scene, key: string, x0: number, x1: number, base: number, height: number, rough: number, bottom: number, peaks = 3): { d: string; top: number[] } {
  const r = s.rng.fork(key);
  const N = 64;
  const ys: number[] = [];
  // Sum of a few bumps (mountains) + displacement noise.
  const bumps: [number, number, number][] = [];
  for (let i = 0; i < peaks; i++) bumps.push([r.range(0, 1), r.range(0.5, 1), r.range(0.08, 0.22)]);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let y = 0;
    for (const [c, a, w] of bumps) y = Math.max(y, a * Math.max(0, 1 - Math.abs(t - c) / w) ** 1.4);
    ys.push(y);
  }
  // Midpoint-like roughness.
  let amp = rough;
  for (let step = 16; step >= 1; step = Math.floor(step / 2)) {
    for (let i = step; i < N; i += step * 2) ys[i] = (ys[i] as number) + r.jitter(amp);
    amp *= 0.55;
  }
  const pts: number[] = [];
  for (let i = 0; i <= N; i++) pts.push(x0 + ((x1 - x0) * i) / N, base - Math.max(0, ys[i] as number) * height);
  let d = `M${n(x0)} ${n(bottom)}`;
  for (let i = 0; i + 1 < pts.length; i += 2) d += `L${n(pts[i] as number)} ${n(pts[i + 1] as number)}`;
  d += `L${n(x1)} ${n(bottom)}Z`;
  return { d, top: pts };
}

/** Distant mountains with optional snow caps. */
export function mountains(s: Scene, key: string, base: number, height: number, colour: string, opts: { rough?: number; peaks?: number; snowLine?: number; haze?: number } = {}): string {
  const { d, top } = ridge(s, key, -20, s.W + 20, base, height, opts.rough ?? 0.12, base + 60, opts.peaks ?? 4);
  const out = [path(d, { fill: colour })];
  const gid = uid(s, 'mt');
  s.defs.push(linearGradient(gid, [[0, shade(colour, 0.12)], [1, shade(colour, -0.12)]], { x1: 0, y1: 0, x2: 1, y2: 0.3 }));
  out.push(path(d, { fill: `url(#${gid})`, opacity: '0.5' }));
  const snowLine = opts.snowLine ?? (s.snow > 0.3 ? 0.35 : s.group === 'north' || s.group === 'far' ? 0.62 : 2);
  if (snowLine < 1.5) {
    const cid = uid(s, 'sc');
    const capY = base - height * (1 - snowLine);
    s.defs.push(el('clipPath', { id: cid }, path(d)));
    const r = s.rng.fork(`${key}snow`);
    let wave = `M-20 ${n(capY)}`;
    for (let x = -20; x <= s.W + 40; x += 40) wave += `L${n(x)} ${n(capY + r.jitter(height * 0.08))}`;
    wave += `L${n(s.W + 40)} -10L-20 -10Z`;
    out.push(g({ 'clip-path': `url(#${cid})` }, path(wave, { fill: mix('#f4f6f8', s.sky.horizon, 0.25), opacity: '0.92' })));
  }
  if (opts.haze) out.push(path(d, { fill: s.sky.haze, opacity: n2(opts.haze) }));
  void top;
  return g({}, out);
}

/** Rolling hills (smooth). */
export function hills(s: Scene, key: string, base: number, height: number, colour: string, bottom: number, bumps = 4): string {
  const r = s.rng.fork(key);
  const pts: number[] = [];
  const N = 24;
  const phase = r.range(0, 6);
  for (let i = 0; i <= N; i++) {
    const x = -40 + ((s.W + 80) * i) / N;
    const t = i / N;
    const y = base - height * (0.55 + 0.45 * Math.sin(t * Math.PI * bumps * 0.5 + phase) * Math.sin(t * Math.PI * 1.3 + phase * 0.3)) + r.jitter(height * 0.05);
    pts.push(x, y);
  }
  const top = smoothOpen(pts, 0.8);
  const d = `${top}L${n(s.W + 40)} ${n(bottom)}L-40 ${n(bottom)}Z`;
  const gid = uid(s, 'hl');
  s.defs.push(linearGradient(gid, [[0, shade(colour, 0.1)], [1, shade(colour, -0.25)]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  return path(d, { fill: `url(#${gid})` });
}

/** The terrain line y(x) of a ground mass (for placing buildings on it). */
export type GroundFn = (x: number) => number;

/** A ground mass from x0..x1 whose top follows `groundY`, filled down to `bottom`. */
export function groundMass(s: Scene, x0: number, x1: number, groundY: GroundFn, bottom: number, colour: string, shoreColour?: string): string {
  const pts: number[] = [];
  for (let x = x0; x <= x1; x += 20) pts.push(x, groundY(x));
  const top = smoothOpen(pts, 0.7);
  const d = `${top}L${n(x1)} ${n(bottom)}L${n(x0)} ${n(bottom)}Z`;
  const gid = uid(s, 'gm');
  s.defs.push(linearGradient(gid, [[0, shade(colour, 0.08)], [1, shade(colour, -0.3)]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  const out = [path(d, { fill: `url(#${gid})` })];
  if (shoreColour) out.push(path(top, { fill: 'none', stroke: shoreColour, 'stroke-width': 6, opacity: '0.7' }));
  if (s.snow > 0.15) out.push(path(d, { fill: '#eef2f4', opacity: n2(Math.min(0.85, s.snow * 0.9)) }));
  return g({}, out);
}

/** Water from y0 to y1 reflecting the sky, with shimmer lines; frozen edges in deep winter. */
export function water(s: Scene, y0: number, y1: number): string {
  const gid = uid(s, 'wt');
  const deep = s.group === 'south' ? '#245a6a' : s.group === 'far' ? '#2a4250' : '#1d4050';
  const top = mix(s.sky.horizon, deep, 0.35);
  s.defs.push(linearGradient(gid, [[0, top], [0.35, mix(s.sky.mid, deep, 0.6)], [1, shade(deep, -0.35)]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  const out = [rect(0, y0, s.W, y1 - y0, { fill: `url(#${gid})` })];
  const r = s.rng.fork('water');
  for (let i = 0; i < 70; i++) {
    const y = y0 + (y1 - y0) * r.next() ** 1.6;
    const w = r.range(20, 120) * (0.4 + (y - y0) / (y1 - y0));
    const x = r.next() * s.W;
    out.push(line(x, y, x + w, y, { stroke: s.time === 'night' ? '#8aa0c0' : '#ffffff', 'stroke-opacity': n2(r.range(0.06, 0.22)), 'stroke-width': n(r.range(1, 2.6)) }));
  }
  if (s.snow > 0.7 && (s.group === 'north' || s.group === 'far')) {
    for (let i = 0; i < 6; i++) out.push(ellipse(r.next() * s.W, y0 + r.range(4, 40), r.range(60, 200), r.range(3, 8), { fill: '#e8eef2', opacity: '0.7' }));
  }
  return g({}, out);
}

// ---------------------------------------------------------------------------------------------
// Vegetation

export function conifer(x: number, y: number, h: number, colour: string, snow: number): string {
  const w = h * 0.36;
  const parts = [rect(x - h * 0.03, y - h * 0.18, h * 0.06, h * 0.2, { fill: '#3a2a1a' })];
  for (let i = 0; i < 3; i++) {
    const ty = y - h * 0.12 - i * h * 0.27;
    const tw = w * (1 - i * 0.24);
    parts.push(polygon([x - tw, ty, x, ty - h * 0.46, x + tw, ty], { fill: shade(colour, -i * 0.05) }));
    if (snow > 0.3) parts.push(polygon([x - tw * 0.45, ty - h * 0.24, x, ty - h * 0.46, x + tw * 0.45, ty - h * 0.24], { fill: '#eef2f4', opacity: n2(Math.min(0.9, snow)) }));
  }
  return parts.join('');
}

export function broadleaf(x: number, y: number, h: number, colour: string, bare: boolean): string {
  const parts = [path(`M${n(x - h * 0.04)} ${n(y)}L${n(x - h * 0.02)} ${n(y - h * 0.5)}L${n(x + h * 0.02)} ${n(y - h * 0.5)}L${n(x + h * 0.04)} ${n(y)}Z`, { fill: '#3a2a1a' })];
  if (bare) {
    parts.push(path(`M${n(x)} ${n(y - h * 0.45)}L${n(x - h * 0.2)} ${n(y - h * 0.85)}M${n(x)} ${n(y - h * 0.5)}L${n(x + h * 0.22)} ${n(y - h * 0.8)}M${n(x)} ${n(y - h * 0.5)}L${n(x + h * 0.02)} ${n(y - h)}`, { stroke: '#3a2a1a', 'stroke-width': n(h * 0.025), fill: 'none' }));
  } else {
    parts.push(ellipse(x, y - h * 0.68, h * 0.3, h * 0.3, { fill: colour }));
    parts.push(ellipse(x - h * 0.14, y - h * 0.58, h * 0.2, h * 0.18, { fill: shade(colour, -0.12) }));
    parts.push(ellipse(x + h * 0.12, y - h * 0.78, h * 0.18, h * 0.16, { fill: shade(colour, 0.12) }));
  }
  return parts.join('');
}

export function cypress(x: number, y: number, h: number): string {
  return path(`M${n(x)} ${n(y - h)}Q${n(x + h * 0.13)} ${n(y - h * 0.55)} ${n(x + h * 0.06)} ${n(y)}H${n(x - h * 0.06)}Q${n(x - h * 0.13)} ${n(y - h * 0.55)} ${n(x)} ${n(y - h)}Z`, { fill: '#2e4228' });
}

/** Foliage colour by season. */
export function foliage(s: Scene): string {
  if (s.season === 'autumn') return s.rng.fork(`fol${s.uid}`).pick(['#a86a2a', '#b88a3a', '#8a4a22', '#9a7a32']);
  if (s.season === 'spring') return '#6a9a4a';
  if (s.season === 'winter') return '#5a6050';
  return s.group === 'south' ? '#5a7a3a' : '#4a6e3a';
}

// ---------------------------------------------------------------------------------------------
// Buildings. Each draws with its base centred at (x, y), scale k (1 = a 60px-tall longhouse).

export interface BuildOpts {
  k: number;
  lit: boolean;
  ruined: boolean;
  snow: number;
  rng: ArtRng;
  /** Culture accent colour (banners, painted boards). */
  accent: string;
  /** Wealth 0..1 (thriving settlements get banners and gilding). */
  wealth: number;
}

/** Lights collected while drawing (window glows re-drawn above the night overlay). */
let LIGHTS: string[] | null = null;

/** Runs `draw` while collecting window lights; returns its markup and the lights layer. */
export function withLights(draw: () => string): { markup: string; lights: string } {
  const prev = LIGHTS;
  LIGHTS = [];
  try {
    const markup = draw();
    return { markup, lights: LIGHTS.join('') };
  } finally {
    LIGHTS = prev;
  }
}

function glowWindow(x: number, y: number, w: number, h: number, lit: boolean): string {
  if (!lit) return rect(x - w / 2, y - h / 2, w, h, { fill: '#1a120c', opacity: '0.85' });
  if (LIGHTS) {
    LIGHTS.push(ellipse(x, y, w * 1.7, h * 1.25, { fill: '#ffb050', opacity: '0.3', filter: 'url(#sc-glow)' }));
    LIGHTS.push(rect(x - w / 2, y - h / 2, w, h, { fill: '#ffe6a8', opacity: '0.95' }));
  }
  return rect(x - w / 2, y - h / 2, w, h, { fill: '#ffc870', filter: 'url(#sc-glow)' }) + rect(x - w / 2, y - h / 2, w, h, { fill: '#ffe6a8' });
}

function charred(d: string, o: BuildOpts): string {
  return o.ruined ? path(d, { fill: '#1a1410', opacity: '0.55' }) : '';
}

function snowCap(d: string, o: BuildOpts): string {
  return o.snow > 0.3 && !o.ruined ? path(d, { fill: '#f2f4f6', opacity: n2(Math.min(0.92, o.snow)) }) : '';
}

/** Northern longhouse: bowed walls, great curved turf or shingle roof, crossed gable finials. */
export function longhouse(x: number, y: number, o: BuildOpts, size: 'small' | 'long' | 'hall'): string {
  const k = o.k * (size === 'hall' ? 1.5 : size === 'long' ? 1.15 : 0.8);
  const w = (size === 'small' ? 70 : 120) * k;
  const wallH = 16 * k;
  const roofH = 36 * k;
  const turf = size !== 'hall' && o.rng.chance(0.6);
  const roofCol = turf ? (o.snow > 0.3 ? '#cfd6d8' : '#5a6a3a') : '#4a3424';
  const wallCol = '#6a4a30';
  const out: string[] = [];
  out.push(path(`M${n(x - w / 2)} ${n(y)}Q${n(x)} ${n(y + 4 * k)} ${n(x + w / 2)} ${n(y)}V${n(y - wallH)}H${n(x - w / 2)}Z`, { fill: wallCol }));
  for (let i = 1; i < 10; i++) out.push(line(x - w / 2 + (w * i) / 10, y + 1, x - w / 2 + (w * i) / 10, y - wallH, { stroke: shade(wallCol, -0.35), 'stroke-width': n2(1.2 * k) }));
  const ridge = `M${n(x - w / 2 - 8 * k)} ${n(y - wallH + 2 * k)}Q${n(x - w * 0.45)} ${n(y - wallH - roofH * 0.95)} ${n(x)} ${n(y - wallH - roofH)}Q${n(x + w * 0.45)} ${n(y - wallH - roofH * 0.95)} ${n(x + w / 2 + 8 * k)} ${n(y - wallH + 2 * k)}Z`;
  out.push(path(ridge, { fill: roofCol, stroke: shade(roofCol, -0.4), 'stroke-width': n2(1.2 * k) }));
  if (!turf) for (let i = 1; i < 5; i++) out.push(path(`M${n(x - w / 2 - 6 * k + i * 2 * k)} ${n(y - wallH + 2 * k - (roofH * i) / 6)}Q${n(x)} ${n(y - wallH - roofH * 0.95 - (roofH * i) / 50)} ${n(x + w / 2 + 6 * k - i * 2 * k)} ${n(y - wallH + 2 * k - (roofH * i) / 6)}`, { fill: 'none', stroke: shade(roofCol, -0.3), 'stroke-width': n2(1 * k), opacity: '0.6' }));
  else for (let i = 0; i < 18; i++) out.push(line(x - w * 0.45 + o.rng.next() * w * 0.9, y - wallH - roofH * o.rng.range(0.2, 0.8), x - w * 0.45 + o.rng.next() * w * 0.9 + 3 * k, y - wallH - roofH * o.rng.range(0.2, 0.8), { stroke: shade(roofCol, 0.15), 'stroke-width': n2(1.4 * k), opacity: '0.6' }));
  out.push(snowCap(`M${n(x - w * 0.42)} ${n(y - wallH - roofH * 0.55)}Q${n(x)} ${n(y - wallH - roofH * 1.08)} ${n(x + w * 0.42)} ${n(y - wallH - roofH * 0.55)}Q${n(x)} ${n(y - wallH - roofH * 0.8)} ${n(x - w * 0.42)} ${n(y - wallH - roofH * 0.55)}Z`, o));
  if (size === 'hall') {
    for (const sx of [-1, 1]) out.push(path(`M${n(x + (sx * w) / 2 + sx * 4 * k)} ${n(y - wallH)}l${n(sx * 8 * k)} ${n(-14 * k)}q${n(sx * 3 * k)} ${n(-4 * k)} ${n(sx * -1 * k)} ${n(-6 * k)}`, { fill: 'none', stroke: '#3a2614', 'stroke-width': n2(2.4 * k), 'stroke-linecap': 'round' }));
    if (o.wealth > 0.5 && !o.ruined) out.push(banner(x + w * 0.32, y - wallH - roofH * 0.6, 40 * k, o.accent, k));
  }
  out.push(glowWindow(x - w * 0.12, y - wallH * 0.45, 8 * k, wallH * 0.75, o.lit && !o.ruined));
  out.push(charred(ridge, o));
  return g({}, out);
}

/** Albric timber hall: plank walls, steep thatched gable roof. */
export function timberHall(x: number, y: number, o: BuildOpts, big: boolean): string {
  const k = o.k * (big ? 1.4 : 0.9);
  const w = 90 * k;
  const wallH = 24 * k;
  const roofH = 34 * k;
  const thatch = o.snow > 0.3 ? '#d8dcdc' : '#a8884a';
  const out = [rect(x - w / 2, y - wallH, w, wallH, { fill: '#7a5a3a' })];
  for (let i = 1; i < 12; i++) out.push(line(x - w / 2 + (w * i) / 12, y, x - w / 2 + (w * i) / 12, y - wallH, { stroke: '#4a3424', 'stroke-width': n2(1 * k) }));
  const roof = `M${n(x - w / 2 - 8 * k)} ${n(y - wallH + 2)}L${n(x - w / 2 + 14 * k)} ${n(y - wallH - roofH)}H${n(x + w / 2 - 14 * k)}L${n(x + w / 2 + 8 * k)} ${n(y - wallH + 2)}Z`;
  out.push(path(roof, { fill: thatch, stroke: shade(thatch, -0.4), 'stroke-width': n2(1.2 * k) }));
  for (let i = 1; i < 4; i++) out.push(line(x - w / 2 - 8 * k + i * 6 * k, y - wallH + 2 - (roofH * i) / 4, x + w / 2 + 8 * k - i * 6 * k, y - wallH + 2 - (roofH * i) / 4, { stroke: shade(thatch, -0.25), 'stroke-width': n2(1 * k), opacity: '0.6' }));
  out.push(rect(x - 6 * k, y - wallH * 0.8, 12 * k, wallH * 0.8, { fill: o.lit && !o.ruined ? '#e8a850' : '#2a1a10' }));
  out.push(glowWindow(x + w * 0.28, y - wallH * 0.6, 6 * k, 6 * k, o.lit && !o.ruined));
  out.push(charred(roof, o));
  return g({}, out);
}

/** A small Lantern church: nave, chancel and a bell-turret crowned with a lantern finial. */
export function lanternChurch(x: number, y: number, o: BuildOpts, stone: boolean): string {
  const k = o.k;
  const wall = stone ? '#b8ae98' : '#7a5a3a';
  const roof = stone ? '#6a4a3a' : o.snow > 0.3 ? '#d8dcdc' : '#5a4030';
  const out = [rect(x - 34 * k, y - 30 * k, 52 * k, 30 * k, { fill: wall }), rect(x + 18 * k, y - 22 * k, 20 * k, 22 * k, { fill: shade(wall, -0.08) })];
  out.push(polygon([x - 38 * k, y - 29 * k, x - 8 * k, y - 52 * k, x + 22 * k, y - 29 * k], { fill: roof }));
  out.push(polygon([x + 16 * k, y - 21 * k, x + 28 * k, y - 36 * k, x + 40 * k, y - 21 * k], { fill: shade(roof, -0.1) }));
  out.push(rect(x - 14 * k, y - 68 * k, 12 * k, 20 * k, { fill: shade(wall, -0.05) }));
  out.push(polygon([x - 16 * k, y - 67 * k, x - 8 * k, y - 78 * k, x, y - 67 * k], { fill: roof }));
  out.push(path(`M${n(x - 8 * k)} ${n(y - 78 * k)}v${n(-6 * k)}`, { stroke: '#c9a227', 'stroke-width': n2(1.6 * k) }));
  out.push(circle(x - 8 * k, y - 86 * k, 2.6 * k, { fill: '#e0c050' }));
  out.push(path(`M${n(x - 12 * k)} ${n(y)}V${n(y - 14 * k)}Q${n(x - 8 * k)} ${n(y - 19 * k)} ${n(x - 4 * k)} ${n(y - 14 * k)}V${n(y)}Z`, { fill: o.lit && !o.ruined ? '#e8a850' : '#2a1a10' }));
  for (const wx of [-26, 6]) out.push(glowWindow(x + wx * k, y - 18 * k, 4 * k, 8 * k, o.lit && !o.ruined));
  out.push(snowCap(`M${n(x - 30 * k)} ${n(y - 35 * k)}L${n(x - 8 * k)} ${n(y - 52 * k)}L${n(x + 14 * k)} ${n(y - 35 * k)}Z`, o));
  return g({}, out);
}

/** Cael roundhouse: low round wall, tall conical thatch. */
export function roundhouse(x: number, y: number, o: BuildOpts): string {
  const k = o.k * o.rng.range(0.85, 1.15);
  const thatch = o.snow > 0.3 ? '#d8dcdc' : '#9a7a42';
  const out = [path(`M${n(x - 26 * k)} ${n(y)}V${n(y - 14 * k)}Q${n(x)} ${n(y - 10 * k)} ${n(x + 26 * k)} ${n(y - 14 * k)}V${n(y)}Q${n(x)} ${n(y + 4 * k)} ${n(x - 26 * k)} ${n(y)}Z`, { fill: '#8a7a62' })];
  const roof = `M${n(x - 31 * k)} ${n(y - 12 * k)}L${n(x)} ${n(y - 50 * k)}L${n(x + 31 * k)} ${n(y - 12 * k)}Q${n(x)} ${n(y - 6 * k)} ${n(x - 31 * k)} ${n(y - 12 * k)}Z`;
  out.push(path(roof, { fill: thatch, stroke: shade(thatch, -0.4), 'stroke-width': n2(1 * k) }));
  for (let i = -2; i <= 2; i++) out.push(line(x, y - 50 * k, x + i * 12 * k, y - 10 * k, { stroke: shade(thatch, -0.2), 'stroke-width': n2(0.9 * k), opacity: '0.6' }));
  out.push(rect(x - 5 * k, y - 11 * k, 10 * k, 11 * k, { fill: o.lit && !o.ruined ? '#e8a850' : '#2a1a10' }));
  out.push(charred(roof, o));
  return g({}, out);
}

/** A tall round stone tower with a conical cap (cloister bell-tower). */
export function roundTower(x: number, y: number, o: BuildOpts): string {
  const k = o.k;
  const out = [path(`M${n(x - 9 * k)} ${n(y)}L${n(x - 7 * k)} ${n(y - 110 * k)}H${n(x + 7 * k)}L${n(x + 9 * k)} ${n(y)}Z`, { fill: '#a8a08c' })];
  out.push(polygon([x - 9 * k, y - 109 * k, x, y - 132 * k, x + 9 * k, y - 109 * k], { fill: '#6a6458' }));
  out.push(glowWindow(x, y - 96 * k, 3 * k, 6 * k, o.lit));
  out.push(rect(x - 2 * k, y - 40 * k, 4 * k, 8 * k, { fill: '#2a1a10' }));
  out.push(path(`M${n(x - 6 * k)} ${n(y - 20 * k)}L${n(x + 6 * k)} ${n(y - 22 * k)}`, { stroke: '#7a7462', 'stroke-width': n2(1 * k) }));
  return g({}, out);
}

/** Corvani/Saraleon stone house: plastered walls, low red-tile or flat roof. */
export function stoneHouse(x: number, y: number, o: BuildOpts, flat: boolean): string {
  const k = o.k * o.rng.range(0.8, 1.2);
  const w = o.rng.range(38, 64) * k;
  const h = o.rng.range(26, 46) * k;
  const wall = flat ? o.rng.pick(['#ece4d4', '#e2d6bc', '#f2ece0', '#d8c8a8']) : o.rng.pick(['#d8c8a8', '#c8b490', '#e0d2b4', '#b8a888']);
  const out = [rect(x - w / 2, y - h, w, h, { fill: wall })];
  out.push(rect(x + w * 0.2, y - h, w * 0.3, h, { fill: '#000000', opacity: '0.08' }));
  if (flat) out.push(rect(x - w / 2 - 2 * k, y - h - 3 * k, w + 4 * k, 4 * k, { fill: shade(wall, -0.2) }));
  else out.push(polygon([x - w / 2 - 4 * k, y - h + 1, x, y - h - 12 * k, x + w / 2 + 4 * k, y - h + 1], { fill: o.ruined ? '#3a2a20' : '#a84a32' }));
  const rows = Math.max(1, Math.floor(h / (14 * k)));
  for (let r = 0; r < rows; r++) for (let c = 0; c < Math.max(1, Math.floor(w / (16 * k))); c++) out.push(glowWindow(x - w / 2 + 9 * k + c * 16 * k, y - h + 9 * k + r * 14 * k, 4 * k, 6 * k, o.lit && !o.ruined && o.rng.chance(0.6)));
  if (o.ruined) out.push(path(`M${n(x - w / 2)} ${n(y - h)}l${n(w * 0.3)} ${n(h * 0.3)}l${n(w * 0.2)} ${n(-h * 0.1)}l${n(w * 0.5)} ${n(h * 0.25)}V${n(y - h - 1)}Z`, { fill: '#1a1410', opacity: '0.6' }));
  return g({}, out);
}

/** Gilded dome on a drum (Saraleon). */
export function domeBuilding(x: number, y: number, o: BuildOpts, big: boolean): string {
  const k = o.k * (big ? 1.6 : 1);
  const out = [rect(x - 40 * k, y - 34 * k, 80 * k, 34 * k, { fill: '#ece4d4' }), rect(x - 22 * k, y - 50 * k, 44 * k, 18 * k, { fill: '#e2d6bc' })];
  const gid = 'sc-gold';
  out.push(path(`M${n(x - 22 * k)} ${n(y - 49 * k)}Q${n(x - 22 * k)} ${n(y - 82 * k)} ${n(x)} ${n(y - 84 * k)}Q${n(x + 22 * k)} ${n(y - 82 * k)} ${n(x + 22 * k)} ${n(y - 49 * k)}Z`, { fill: `url(#${gid})` }));
  out.push(path(`M${n(x)} ${n(y - 84 * k)}v${n(-8 * k)}`, { stroke: '#c9a227', 'stroke-width': n2(1.6 * k) }));
  out.push(circle(x, y - 94 * k, 2.4 * k, { fill: '#f0d778' }));
  for (let i = -3; i <= 3; i++) out.push(path(`M${n(x + i * 10 * k - 4 * k)} ${n(y)}V${n(y - 16 * k)}Q${n(x + i * 10 * k)} ${n(y - 22 * k)} ${n(x + i * 10 * k + 4 * k)} ${n(y - 16 * k)}V${n(y)}Z`, { fill: o.lit ? '#e8a850' : '#3a2e24', opacity: '0.85' }));
  for (let i = -1; i <= 1; i++) out.push(glowWindow(x + i * 12 * k, y - 42 * k, 3 * k, 6 * k, o.lit));
  return g({}, out);
}

/** Crenellated stone wall segment with towers (old imperial walls). */
export function stoneWall(s: Scene, x0: number, x1: number, y: number, h: number, k: number, great: boolean): string {
  const wall = great ? '#d8ccb0' : '#b8ae98';
  const out = [rect(x0, y - h, x1 - x0, h, { fill: wall })];
  for (let x = x0; x < x1; x += 10 * k) out.push(rect(x, y - h - 6 * k, 5 * k, 6 * k, { fill: wall }));
  out.push(rect(x0, y - h * 0.4, x1 - x0, 2 * k, { fill: shade(wall, -0.2) }));
  const towers = Math.max(2, Math.round((x1 - x0) / (110 * k)));
  for (let i = 0; i <= towers; i++) {
    const tx = x0 + ((x1 - x0) * i) / towers;
    const tw = (great ? 26 : 20) * k;
    const th = h * (great ? 1.6 : 1.45);
    out.push(rect(tx - tw / 2, y - th, tw, th, { fill: shade(wall, -0.06) }));
    for (let c = 0; c < 3; c++) out.push(rect(tx - tw / 2 + c * (tw / 2.5), y - th - 6 * k, tw / 5, 6 * k, { fill: shade(wall, -0.06) }));
    out.push(glowWindow(tx, y - th * 0.7, 3 * k, 6 * k, s.lit));
  }
  for (let x = x0 + 4; x < x1; x += 7 * k) out.push(line(x, y - h, x, y, { stroke: shade(wall, -0.15), 'stroke-width': 0.6, opacity: '0.4' }));
  return g({}, out);
}

/** Earth bank with a timber palisade (burh) or a plain palisade. */
export function palisade(s: Scene, x0: number, x1: number, y: number, k: number, bank: boolean): string {
  const out: string[] = [];
  const h = 24 * k;
  if (bank) out.push(path(`M${n(x0 - 20 * k)} ${n(y + 4)}L${n(x0)} ${n(y - 12 * k)}H${n(x1)}L${n(x1 + 20 * k)} ${n(y + 4)}Z`, { fill: s.snow > 0.3 ? '#dfe4e6' : '#5a6a3a' }));
  const base = bank ? y - 12 * k : y;
  for (let x = x0; x <= x1; x += 6 * k) out.push(polygon([x - 2.6 * k, base, x - 2.6 * k, base - h, x, base - h - 4 * k, x + 2.6 * k, base - h, x + 2.6 * k, base], { fill: s.rng.chance(0.5) ? '#6a4a30' : '#5a3e28' }));
  out.push(rect(x0, base - h * 0.62, x1 - x0, 2.4 * k, { fill: '#3a2614' }));
  return g({}, out);
}

/** Velkar log house: log walls, plank gable roof. */
export function logHouse(x: number, y: number, o: BuildOpts): string {
  const k = o.k * o.rng.range(0.85, 1.15);
  const w = 52 * k;
  const h = 22 * k;
  const out = [rect(x - w / 2, y - h, w, h, { fill: '#7a5636' })];
  for (let i = 1; i < 6; i++) out.push(line(x - w / 2 - 2 * k, y - (h * i) / 6, x + w / 2 + 2 * k, y - (h * i) / 6, { stroke: '#4a3220', 'stroke-width': n2(1.4 * k) }));
  const roof = `M${n(x - w / 2 - 6 * k)} ${n(y - h + 2)}L${n(x)} ${n(y - h - 26 * k)}L${n(x + w / 2 + 6 * k)} ${n(y - h + 2)}Z`;
  out.push(path(roof, { fill: o.snow > 0.3 ? '#dfe4e6' : '#5a4030', stroke: '#2e1c0c', 'stroke-width': n2(1 * k) }));
  out.push(path(`M${n(x)} ${n(y - h - 26 * k)}l${n(-4 * k)} ${n(-5 * k)}M${n(x)} ${n(y - h - 26 * k)}l${n(4 * k)} ${n(-5 * k)}`, { stroke: '#2e1c0c', 'stroke-width': n2(1.6 * k) }));
  out.push(glowWindow(x - 10 * k, y - h * 0.5, 6 * k, 6 * k, o.lit && !o.ruined));
  out.push(charred(roof, o));
  return g({}, out);
}

/** Steppe felt tent. */
export function yurt(x: number, y: number, o: BuildOpts): string {
  const k = o.k * o.rng.range(0.85, 1.15);
  const felt = o.rng.pick(['#e8e0cc', '#d8ccb0', '#c8b898', '#e0d4bc']);
  const out = [path(`M${n(x - 26 * k)} ${n(y)}V${n(y - 14 * k)}Q${n(x - 24 * k)} ${n(y - 34 * k)} ${n(x)} ${n(y - 36 * k)}Q${n(x + 24 * k)} ${n(y - 34 * k)} ${n(x + 26 * k)} ${n(y - 14 * k)}V${n(y)}Z`, { fill: felt, stroke: shade(felt, -0.4), 'stroke-width': n2(1 * k) })];
  out.push(path(`M${n(x - 26 * k)} ${n(y - 14 * k)}Q${n(x)} ${n(y - 10 * k)} ${n(x + 26 * k)} ${n(y - 14 * k)}`, { fill: 'none', stroke: '#8a3a2a', 'stroke-width': n2(2 * k) }));
  out.push(rect(x - 5 * k, y - 12 * k, 10 * k, 12 * k, { fill: o.lit ? '#e8a850' : '#8a3a2a' }));
  out.push(ellipse(x, y - 35 * k, 6 * k, 2 * k, { fill: shade(felt, -0.3) }));
  return g({}, out);
}

/** Rimewild skin tent (poles crossing at the top). */
export function skinTent(x: number, y: number, o: BuildOpts): string {
  const k = o.k * o.rng.range(0.8, 1.15);
  const skin = o.rng.pick(['#8a7458', '#a08a6a', '#6a5a46']);
  const out = [polygon([x - 22 * k, y, x, y - 40 * k, x + 22 * k, y], { fill: skin, stroke: shade(skin, -0.4), 'stroke-width': n2(1 * k) })];
  out.push(path(`M${n(x - 4 * k)} ${n(y - 48 * k)}L${n(x + 3 * k)} ${n(y - 36 * k)}M${n(x + 5 * k)} ${n(y - 47 * k)}L${n(x - 3 * k)} ${n(y - 36 * k)}`, { stroke: '#3a2a1a', 'stroke-width': n2(1.4 * k) }));
  out.push(polygon([x - 5 * k, y, x, y - 14 * k, x + 5 * k, y], { fill: o.lit ? '#e8a850' : '#2a1a10' }));
  if (o.snow > 0.3) out.push(polygon([x - 22 * k, y, x - 14 * k, y - 10 * k, x + 14 * k, y - 10 * k, x + 22 * k, y], { fill: '#f2f4f6', opacity: '0.85' }));
  return g({}, out);
}

/** Timber hill-fort on a mound (Velkar gord / northern ring-fort). */
export function hillFort(s: Scene, x: number, y: number, k: number): string {
  const out = [path(`M${n(x - 150 * k)} ${n(y)}Q${n(x - 90 * k)} ${n(y - 50 * k)} ${n(x)} ${n(y - 56 * k)}Q${n(x + 90 * k)} ${n(y - 50 * k)} ${n(x + 150 * k)} ${n(y)}Z`, { fill: s.snow > 0.3 ? '#dfe4e6' : '#5a6a3a' })];
  out.push(palisade(s, x - 100 * k, x + 100 * k, y - 50 * k, k, false));
  for (const tx of [-100, 100]) {
    out.push(rect(x + tx * k - 9 * k, y - 96 * k, 18 * k, 46 * k, { fill: '#6a4a30' }));
    out.push(polygon([x + tx * k - 12 * k, y - 95 * k, x + tx * k, y - 112 * k, x + tx * k + 12 * k, y - 95 * k], { fill: '#4a3424' }));
  }
  return g({}, out);
}

/** Stilted storehouse / drying rack. */
export function rack(x: number, y: number, o: BuildOpts): string {
  const k = o.k;
  return g({}, [
    path(`M${n(x - 16 * k)} ${n(y)}V${n(y - 26 * k)}M${n(x + 16 * k)} ${n(y)}V${n(y - 26 * k)}M${n(x - 20 * k)} ${n(y - 24 * k)}H${n(x + 20 * k)}`, { stroke: '#4a3424', 'stroke-width': n2(2 * k) }),
    ...[-12, -6, 0, 6, 12].map((dx) => path(`M${n(x + dx * k)} ${n(y - 24 * k)}v${n(10 * k)}`, { stroke: '#8a7a6a', 'stroke-width': n2(2.4 * k) })),
  ]);
}

/** A market stall with an awning. */
export function stall(x: number, y: number, o: BuildOpts): string {
  const k = o.k;
  const awn = o.rng.pick(['#9b2f2a', '#2b4f86', '#c9a227', '#2f6a5a', '#e8dcc0']);
  return g({}, [
    path(`M${n(x - 16 * k)} ${n(y)}V${n(y - 18 * k)}M${n(x + 16 * k)} ${n(y)}V${n(y - 18 * k)}`, { stroke: '#4a3424', 'stroke-width': n2(1.6 * k) }),
    rect(x - 16 * k, y - 8 * k, 32 * k, 4 * k, { fill: '#6a4a30' }),
    polygon([x - 20 * k, y - 16 * k, x - 14 * k, y - 24 * k, x + 14 * k, y - 24 * k, x + 20 * k, y - 16 * k], { fill: awn }),
    circle(x - 8 * k, y - 10 * k, 2.4 * k, { fill: '#c8a050' }),
    circle(x + 6 * k, y - 10 * k, 2.8 * k, { fill: '#7a3a2a' }),
  ]);
}

/** A banner on a pole. */
export function banner(x: number, y: number, h: number, colour: string, k: number): string {
  return g({}, [line(x, y, x, y - h, { stroke: '#3a2614', 'stroke-width': n2(1.6 * k) }), path(`M${n(x)} ${n(y - h)}h${n(16 * k)}l${n(-4 * k)} ${n(6 * k)}l${n(4 * k)} ${n(6 * k)}h${n(-16 * k)}Z`, { fill: colour })]);
}

/** A beached or moored ship in side view (bow right unless flipped). */
export function shipSide(x: number, y: number, len: number, culture: CultureId, opts: { flip?: boolean; sail?: 'furled' | 'set' | 'none'; shields?: boolean; burning?: boolean; lit?: boolean } = {}): string {
  const pal = CULTURE_PALETTE[culture];
  const k = len / 200;
  const x0 = -len / 2;
  const x1 = len / 2;
  const yG = -22 * k;
  const yK = 6 * k;
  const stem = 46 * k;
  const hull =
    `M${n(x0)} ${n(yG)}Q${n(x0 + len * 0.12)} ${n(yK)} ${n(x0 + len * 0.3)} ${n(yK)}L${n(x1 - len * 0.3)} ${n(yK)}Q${n(x1 - len * 0.12)} ${n(yK)} ${n(x1)} ${n(yG)}` +
    `Q${n(x1 + 10 * k)} ${n(yG - stem * 0.5)} ${n(x1 + 6 * k)} ${n(yG - stem)}Q${n(x1 + 1 * k)} ${n(yG - stem - 8 * k)} ${n(x1 - 4 * k)} ${n(yG - stem + 2 * k)}` +
    `Q${n(x1)} ${n(yG - stem * 0.5)} ${n(x1 - 8 * k)} ${n(yG + 3 * k)}L${n(x0 + 8 * k)} ${n(yG + 3 * k)}Q${n(x0)} ${n(yG - stem * 0.5)} ${n(x0 + 4 * k)} ${n(yG - stem + 2 * k)}` +
    `Q${n(x0 - 1 * k)} ${n(yG - stem - 8 * k)} ${n(x0 - 6 * k)} ${n(yG - stem)}Q${n(x0 - 10 * k)} ${n(yG - stem * 0.5)} ${n(x0)} ${n(yG)}Z`;
  const out: string[] = [];
  const sail = opts.sail ?? 'furled';
  if (sail !== 'none') {
    out.push(line(0, yG, 0, yG - 110 * k, { stroke: '#3a2614', 'stroke-width': n2(3 * k) }));
    if (sail === 'set') {
      out.push(path(`M${n(-48 * k)} ${n(yG - 104 * k)}H${n(48 * k)}Q${n(56 * k)} ${n(yG - 62 * k)} ${n(46 * k)} ${n(yG - 24 * k)}H${n(-46 * k)}Q${n(-56 * k)} ${n(yG - 62 * k)} ${n(-48 * k)} ${n(yG - 104 * k)}Z`, { fill: pal.secondary, stroke: shade(pal.secondary, -0.45), 'stroke-width': n2(1.2 * k) }));
      for (let i = -2; i <= 2; i += 2) out.push(path(`M${n(i * 16 * k - 6 * k)} ${n(yG - 104 * k)}H${n(i * 16 * k + 6 * k)}Q${n(i * 17 * k + 8 * k)} ${n(yG - 62 * k)} ${n(i * 16 * k + 6 * k)} ${n(yG - 24 * k)}H${n(i * 16 * k - 6 * k)}Q${n(i * 17 * k - 8 * k)} ${n(yG - 62 * k)} ${n(i * 16 * k - 6 * k)} ${n(yG - 104 * k)}Z`, { fill: pal.primary, opacity: '0.9' }));
    } else {
      out.push(rect(-52 * k, yG - 106 * k, 104 * k, 7 * k, { fill: shade(pal.secondary, -0.2), rx: n(3 * k) }));
    }
  }
  out.push(path(hull, { fill: '#5a3e26', stroke: '#24160c', 'stroke-width': n2(1.6 * k) }));
  out.push(path(`M${n(x0 + 10 * k)} ${n(yG + 10 * k)}Q${n(0)} ${n(yG + 18 * k)} ${n(x1 - 10 * k)} ${n(yG + 10 * k)}`, { fill: 'none', stroke: '#2e1c0c', 'stroke-width': n2(1.4 * k), opacity: '0.7' }));
  out.push(path(`M${n(x0 + 14 * k)} ${n(yG + 18 * k)}Q${n(0)} ${n(yG + 26 * k)} ${n(x1 - 14 * k)} ${n(yG + 18 * k)}`, { fill: 'none', stroke: '#2e1c0c', 'stroke-width': n2(1.2 * k), opacity: '0.5' }));
  if (opts.shields !== false) {
    const cnt = Math.max(3, Math.round(len / 22));
    for (let i = 0; i < cnt; i++) {
      const sx = x0 + len * 0.18 + (len * 0.64 * (i + 0.5)) / cnt;
      out.push(circle(sx, yG + 1.5 * k, 7 * k, { fill: i % 2 === 0 ? pal.primary : pal.secondary, stroke: '#1a120c', 'stroke-width': n2(1 * k) }));
      out.push(circle(sx, yG + 1.5 * k, 2 * k, { fill: pal.metal }));
    }
  }
  if (opts.burning) {
    out.push(ellipse(0, yG - 30 * k, 60 * k, 40 * k, { fill: 'url(#sc-fire)' }));
  }
  return g({ transform: `translate(${n(x)} ${n(y)})${opts.flip ? ' scale(-1 1)' : ''}` }, out);
}

/** A column of smoke rising from (x, y). */
export function smoke(s: Scene, x: number, y: number, h: number, dark: boolean, key: string): string {
  const r = s.rng.fork(key);
  const col = dark ? '#2a2420' : s.time === 'night' ? '#5a6070' : mix(s.sky.horizon, '#a8a49c', 0.6);
  const puffs: string[] = [];
  const drift = r.range(0.2, 0.6) * (r.chance(0.5) ? 1 : -1);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    puffs.push(circle(x + drift * h * t * t + r.jitter(6), y - h * t, 6 + t * h * 0.16, { fill: col, opacity: n2((dark ? 0.75 : 0.45) * (1 - t * 0.7)) }));
  }
  return g({ filter: 'url(#sc-soft)' }, puffs);
}

/** Tiny standing figures (dark silhouettes) for scale and life. */
export function figure(x: number, y: number, h: number, colour: string, opts: { spear?: boolean; cloak?: string } = {}): string {
  const out = [circle(x, y - h * 0.88, h * 0.1, { fill: colour }), path(`M${n(x - h * 0.16)} ${n(y)}L${n(x - h * 0.12)} ${n(y - h * 0.72)}Q${n(x)} ${n(y - h * 0.8)} ${n(x + h * 0.12)} ${n(y - h * 0.72)}L${n(x + h * 0.16)} ${n(y)}Z`, { fill: opts.cloak ?? colour })];
  if (opts.spear) out.push(line(x + h * 0.2, y + 2, x + h * 0.24, y - h * 1.25, { stroke: colour, 'stroke-width': n2(Math.max(1, h * 0.04)) }));
  return out.join('');
}

// ---------------------------------------------------------------------------------------------
// Shared defs and overlays

/** Definitions every scene uses (glow, soft blur, gold and fire gradients). */
export function sceneDefs(): string[] {
  return [
    el('filter', { id: 'sc-glow', x: '-200%', y: '-200%', width: '500%', height: '500%' }, el('feGaussianBlur', { stdDeviation: 4 })),
    el('filter', { id: 'sc-soft', x: '-50%', y: '-50%', width: '200%', height: '200%' }, el('feGaussianBlur', { stdDeviation: 3 })),
    linearGradient('sc-gold', [[0, '#fff0a8'], [0.4, '#e0b840'], [1, '#8a6a18']], { x1: 0.2, y1: 0, x2: 0.8, y2: 1 }),
    radialGradient('sc-fire', [[0, '#fff2a0'], [0.35, '#f6b04a'], [0.7, '#d0401a', 0.7], [1, '#8a2010', 0]]),
  ];
}

/** Time-of-day and season light: ambient multiply, darkness, horizon haze. */
export function lightOverlay(s: Scene, horizon: number): string {
  const out: string[] = [];
  if (s.sky.ambient !== '#ffffff') out.push(rect(0, 0, s.W, s.H, { fill: s.sky.ambient, style: 'mix-blend-mode:multiply', opacity: '0.55' }));
  if (s.sky.dark > 0) out.push(rect(0, 0, s.W, s.H, { fill: '#0a1020', opacity: n2(s.sky.dark * 0.55) }));
  const hid = uid(s, 'hz');
  s.defs.push(linearGradient(hid, [[0, s.sky.haze, 0], [0.5, s.sky.haze, s.season === 'autumn' ? 0.35 : 0.2], [1, s.sky.haze, 0]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  out.push(rect(0, horizon - 120, s.W, 240, { fill: `url(#${hid})` }));
  return g({ 'pointer-events': 'none' }, out);
}
