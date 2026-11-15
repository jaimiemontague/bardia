/**
 * `vignette` generator: event illustrations (design §27.2 "event vignettes", §19.2 event families,
 * §21.3 delve plates). Parametric scenes in the shared painted style: a storm at sea, a landing, a
 * night raid, a ship-funeral, a wedding, the Thing, a holmgang, omens (ravens, a comet, the northern
 * lights — always natural sights the characters read as signs, §4.7), sickness, harvest and famine,
 * a wreck, a hunt, an envoy, trade on the strand, a shield wall, fog, a barrow mouth, captivity.
 */
import type { CultureId } from '@content/schemas/ids';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { circle, el, ellipse, g, line, linearGradient, n, n2, path, polygon, radialGradient, rect, svgDoc } from '../svg/svg';
import { CULTURE_PALETTE, SEASONS, TIMES_OF_DAY, groundLook, mix, shade, type SeasonKey, type TimeOfDay } from '../svg/palette';
import { grainFilter, mottleFilter, vignetteGradient, watermark, type WatermarkMode } from '../svg/paint';
import type { ArtRng } from '../svg/rng';
import { nightFjordScene } from './nightFjord';
import { oneOf, seedOf } from './params';
import {
  broadleaf,
  buildStyleOf,
  conifer,
  drawSky,
  groundMass,
  hills,
  lightOverlay,
  logHouse,
  longhouse,
  mountains,
  newScene,
  roundhouse,
  sceneDefs,
  shipSide,
  smoke,
  stall,
  stoneHouse,
  timberHall,
  uid,
  water,
  yurt,
  type BuildOpts,
  type Scene,
} from './scene';

export const VIGNETTE_SIZE = [1200, 675] as const;
export const VIGNETTE_SCENES = [
  'storm',
  'voyage',
  'landing',
  'raid',
  'funeral',
  'wedding',
  'birth',
  'ravens',
  'comet',
  'northernLights',
  'thing',
  'holmgang',
  'sickness',
  'harvest',
  'famine',
  'wreck',
  'hunt',
  'envoy',
  'trade',
  'shieldWall',
  'fog',
  'barrow',
  'captivity',
  'feast',
  'storehouse',
  'shore',
  'aftermath',
  'nightFjord',
] as const;
export type VignetteScene = (typeof VIGNETTE_SCENES)[number];

/** Other names for scenes (accepted in manifests). */
export const VIGNETTE_SCENE_ALIASES: Readonly<Record<string, VignetteScene>> = {
  granary: 'storehouse',
  fields: 'harvest',
  hallFeast: 'feast',
  skald: 'feast',
  winterShore: 'shore',
  shipAtSea: 'voyage',
  battlefield: 'aftermath',
  menu: 'nightFjord',
};

/** `palette` param: season/time overrides (manifest shorthand). */
export const VIGNETTE_PALETTES: Readonly<Record<string, { season?: SeasonKey; time?: TimeOfDay }>> = {
  winter: { season: 'winter' },
  summer: { season: 'summer', time: 'day' },
  spring: { season: 'spring' },
  autumn: { season: 'autumn' },
  firelight: { time: 'night' },
  overcast: { season: 'autumn', time: 'day' },
  dusk: { time: 'dusk' },
  dawn: { time: 'dawn' },
  night: { time: 'night' },
  day: { time: 'day' },
};
const ALL_CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese', 'isafolder', 'rime'];

/** Natural default light and season per scene. */
const SCENE_DEFAULTS: Readonly<Record<VignetteScene, { time: TimeOfDay; season: SeasonKey }>> = {
  storm: { time: 'dusk', season: 'autumn' },
  voyage: { time: 'dawn', season: 'summer' },
  landing: { time: 'dawn', season: 'spring' },
  raid: { time: 'night', season: 'summer' },
  funeral: { time: 'dusk', season: 'autumn' },
  wedding: { time: 'day', season: 'summer' },
  birth: { time: 'night', season: 'winter' },
  ravens: { time: 'day', season: 'autumn' },
  comet: { time: 'night', season: 'winter' },
  northernLights: { time: 'night', season: 'winter' },
  thing: { time: 'day', season: 'summer' },
  holmgang: { time: 'day', season: 'spring' },
  sickness: { time: 'night', season: 'winter' },
  harvest: { time: 'day', season: 'autumn' },
  famine: { time: 'day', season: 'winter' },
  wreck: { time: 'dawn', season: 'autumn' },
  hunt: { time: 'day', season: 'autumn' },
  envoy: { time: 'day', season: 'summer' },
  trade: { time: 'day', season: 'summer' },
  shieldWall: { time: 'day', season: 'summer' },
  fog: { time: 'dawn', season: 'autumn' },
  barrow: { time: 'dusk', season: 'autumn' },
  captivity: { time: 'night', season: 'winter' },
  feast: { time: 'night', season: 'winter' },
  storehouse: { time: 'night', season: 'winter' },
  shore: { time: 'day', season: 'winter' },
  aftermath: { time: 'dusk', season: 'summer' },
  nightFjord: { time: 'night', season: 'winter' },
};

// ---------------------------------------------------------------------------------------------
// Figures

interface Person {
  x: number;
  y: number;
  h: number;
  cloak: string;
  pose?: 'stand' | 'raise' | 'kneel' | 'lie' | 'walk' | 'strike';
  shield?: string;
  spear?: boolean;
  axe?: boolean;
  facing?: -1 | 1;
  hair?: string;
}

/** A painted figure silhouette with cloak colour, optional shield and weapon. */
function person(p: Person): string {
  const { x, y, h } = p;
  const f = p.facing ?? 1;
  const dark = '#1c140e';
  const out: string[] = [];
  if (p.pose === 'lie') {
    out.push(ellipse(x, y - h * 0.08, h * 0.45, h * 0.09, { fill: p.cloak }));
    out.push(circle(x - h * 0.42, y - h * 0.12, h * 0.08, { fill: '#d8b090' }));
    out.push(path(`M${n(x - h * 0.4)} ${n(y - h * 0.2)}Q${n(x)} ${n(y - h * 0.28)} ${n(x + h * 0.5)} ${n(y - h * 0.12)}V${n(y)}H${n(x - h * 0.4)}Z`, { fill: shade(p.cloak, 0.15), opacity: '0.9' }));
    return g({}, out);
  }
  const kneel = p.pose === 'kneel';
  const top = kneel ? y - h * 0.68 : y - h;
  const headR = h * 0.085;
  const stride = p.pose === 'walk' || p.pose === 'strike' ? h * 0.12 : h * 0.05;
  out.push(path(`M${n(x - stride - h * 0.04)} ${n(y)}L${n(x - h * 0.03)} ${n(top + h * 0.55)}L${n(x + h * 0.03)} ${n(top + h * 0.55)}L${n(x + stride + h * 0.04)} ${n(y)}`, { stroke: dark, 'stroke-width': n(h * 0.07), fill: 'none', 'stroke-linecap': 'round' }));
  out.push(path(`M${n(x - h * 0.15)} ${n(top + h * 0.62)}L${n(x - h * 0.11)} ${n(top + h * 0.2)}Q${n(x)} ${n(top + h * 0.13)} ${n(x + h * 0.11)} ${n(top + h * 0.2)}L${n(x + h * 0.15)} ${n(top + h * 0.62)}Z`, { fill: p.cloak }));
  out.push(path(`M${n(x - h * 0.11)} ${n(top + h * 0.2)}L${n(x - h * 0.17)} ${n(top + h * 0.7)}`, { stroke: shade(p.cloak, -0.3), 'stroke-width': n(h * 0.03) }));
  out.push(circle(x, top + h * 0.09, headR, { fill: '#c89a78' }));
  out.push(path(`M${n(x - headR * 1.05)} ${n(top + h * 0.1)}Q${n(x - headR * 1.1)} ${n(top - h * 0.005)} ${n(x)} ${n(top - h * 0.002)}Q${n(x + headR * 1.1)} ${n(top - h * 0.005)} ${n(x + headR * 1.05)} ${n(top + h * 0.1)}Q${n(x)} ${n(top + h * 0.04)} ${n(x - headR * 1.05)} ${n(top + h * 0.1)}Z`, { fill: p.hair ?? '#4a3020' }));
  const armY = top + h * 0.26;
  if (p.pose === 'raise') out.push(path(`M${n(x - h * 0.1)} ${n(armY)}L${n(x - h * 0.22)} ${n(top - h * 0.08)}M${n(x + h * 0.1)} ${n(armY)}L${n(x + h * 0.22)} ${n(top - h * 0.08)}`, { stroke: p.cloak, 'stroke-width': n(h * 0.05), 'stroke-linecap': 'round' }));
  if (p.spear) out.push(line(x + f * h * 0.17, y + h * 0.02, x + f * h * 0.24, top - h * 0.32, { stroke: '#5a3e26', 'stroke-width': n2(h * 0.022) }), polygon([x + f * h * 0.24, top - h * 0.42, x + f * h * 0.26, top - h * 0.3, x + f * h * 0.22, top - h * 0.3], { fill: '#c9ccd1' }));
  if (p.axe) {
    const sx = p.pose === 'strike' ? -0.1 : 0.2;
    out.push(line(x + f * h * 0.12, armY, x + f * h * sx, top - h * 0.2, { stroke: '#5a3e26', 'stroke-width': n2(h * 0.025) }), path(`M${n(x + f * h * sx)} ${n(top - h * 0.22)}l${n(f * h * 0.08)} ${n(-h * 0.02)}l${n(0)} ${n(h * 0.1)}Z`, { fill: '#c9ccd1' }));
  }
  if (p.shield) out.push(ellipse(x - f * h * 0.1, top + h * 0.42, h * 0.16, h * 0.18, { fill: p.shield, stroke: dark, 'stroke-width': n2(h * 0.015) }), circle(x - f * h * 0.1, top + h * 0.42, h * 0.035, { fill: '#a8743a' }));
  return g({}, out);
}

function crowdRow(s: Scene, key: string, x0: number, x1: number, y: number, h: number, count: number, culture: CultureId, armed: boolean): string {
  const r = s.rng.fork(key);
  const pal = CULTURE_PALETTE[culture];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / count + r.jitter(((x1 - x0) / count) * 0.3);
    out.push(person({ x, y: y + r.jitter(6), h: h * r.range(0.9, 1.08), cloak: shade(r.pick(pal.cloth), r.range(-0.2, 0.1)), spear: armed && r.chance(0.5), shield: armed && r.chance(0.6) ? (r.chance(0.5) ? pal.primary : pal.secondary) : undefined, hair: r.pick(['#c8a35e', '#8a6440', '#5e4028', '#3e2a1a']) }));
  }
  return g({}, out);
}

function bird(x: number, y: number, s: number, colour = '#14100c'): string {
  return path(`M${n(x - s)} ${n(y)}Q${n(x - s * 0.5)} ${n(y - s * 0.55)} ${n(x)} ${n(y)}Q${n(x + s * 0.5)} ${n(y - s * 0.55)} ${n(x + s)} ${n(y)}Q${n(x + s * 0.5)} ${n(y - s * 0.25)} ${n(x)} ${n(y + s * 0.15)}Q${n(x - s * 0.5)} ${n(y - s * 0.25)} ${n(x - s)} ${n(y)}Z`, { fill: colour });
}

function waves(s: Scene, y0: number, rows: number, amp: number, colour: string, key: string): string {
  const r = s.rng.fork(key);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const y = y0 + i * (amp * 1.6);
    let d = `M-20 ${n(y)}`;
    const len = r.range(140, 260);
    for (let x = -20; x < s.W + 40; x += len) d += `Q${n(x + len * 0.25)} ${n(y - amp * r.range(0.6, 1.2))} ${n(x + len * 0.5)} ${n(y)}T${n(x + len)} ${n(y)}`;
    out.push(path(`${d}V${s.H}H-20Z`, { fill: shade(colour, -i * 0.04 + 0.05), opacity: '0.95' }));
    out.push(path(d, { fill: 'none', stroke: '#e8f0f2', 'stroke-width': n(2 + i * 0.6), opacity: '0.5' }));
  }
  return g({}, out);
}

function dwellingFor(culture: CultureId, x: number, y: number, o: BuildOpts): string {
  const st = buildStyleOf(culture);
  if (st === 'albric') return timberHall(x, y, o, false);
  if (st === 'cael') return roundhouse(x, y, o);
  if (st === 'corvani' || st === 'saraleon') return stoneHouse(x, y, o, st === 'saraleon');
  if (st === 'velkar') return logHouse(x, y, o);
  if (st === 'steppe') return yurt(x, y, o);
  return longhouse(x, y, o, 'long');
}

// ---------------------------------------------------------------------------------------------
// Scenes

/** Flames licking from a roof line between x0 and x1 at height y (scale k). */
function roofFlames(r: ArtRng, x0: number, x1: number, y: number, k: number): string {
  const out: string[] = [];
  const count = Math.max(3, Math.round((x1 - x0) / (16 * k)));
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / count + r.jitter(5 * k);
    const h = r.range(40, 95) * k;
    const w = r.range(9, 15) * k;
    out.push(path(`M${n(x - w)} ${n(y)}Q${n(x - w * 0.7)} ${n(y - h * 0.55)} ${n(x + r.jitter(w * 0.6))} ${n(y - h)}Q${n(x + w * 0.8)} ${n(y - h * 0.45)} ${n(x + w)} ${n(y)}Z`, { fill: 'url(#v-flame)' }));
  }
  return g({}, out);
}

/** A bear in side view facing left, feet on y (length ≈ 240·k). */
function bear(x: number, y: number, k: number, colour: string): string {
  const pts = [-120, -60, -112, -74, -94, -86, -86, -100, -76, -96, -72, -88, -56, -94, -28, -120, 10, -114, 44, -104, 92, -98, 116, -84, 120, -60, 112, -36, 112, 0, 88, 0, 84, -30, 52, -34, 10, -36, -30, -32, -40, 0, -66, 0, -70, -38, -84, -50, -102, -50, -116, -54];
  let d = '';
  for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${n(x + (pts[i] as number) * k)} ${n(y + (pts[i + 1] as number) * k)}`;
  const far = `M${n(x + 60 * k)} ${n(y - 34 * k)}L${n(x + 62 * k)} ${n(y)}H${n(x + 80 * k)}L${n(x + 82 * k)} ${n(y - 32 * k)}ZM${n(x - 20 * k)} ${n(y - 34 * k)}L${n(x - 18 * k)} ${n(y)}H${n(x)}L${n(x + 2 * k)} ${n(y - 34 * k)}Z`;
  return g({}, [path(far, { fill: shade(colour, -0.3) }), path(`${d}Z`, { fill: colour, 'stroke-linejoin': 'round' }), circle(x - 96 * k, y - 76 * k, 3 * k, { fill: '#120c08' }), ellipse(x - 117 * k, y - 60 * k, 4 * k, 3 * k, { fill: '#120c08' })]);
}

/** A hunting hound in side view facing left (length ≈ 80·k). */
function hound(x: number, y: number, k: number, colour: string): string {
  const pts = [-40, -30, -30, -36, -26, -44, -22, -36, -16, -30, 24, -30, 34, -36, 40, -44, 38, -30, 32, -24, 34, 0, 28, 0, 24, -18, -10, -18, -16, 0, -22, 0, -22, -20, -30, -24, -40, -26];
  let d = '';
  for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${n(x + (pts[i] as number) * k)} ${n(y + (pts[i + 1] as number) * k)}`;
  return path(`${d}Z`, { fill: colour });
}

function drawScene(scene: VignetteScene, s: Scene, culture: CultureId, other: CultureId, glow: string[]): string {
  const { W, H } = s;
  const pal = CULTURE_PALETTE[culture];
  const opal = CULTURE_PALETTE[other];
  const gl = groundLook(s.season, s.group);
  const r = s.rng.fork(`v-${scene}`);
  const bo = (k: number, ruined = false): BuildOpts => ({ k, lit: s.lit, ruined, snow: s.snow, rng: r, accent: pal.primary, wealth: 0.5 });
  const out: string[] = [];
  const seaScene = (horizon: number): void => {
    out.push(drawSky(s, horizon));
    out.push(water(s, horizon, H));
  };
  const landScene = (horizon: number, mountainsH = 120): void => {
    out.push(drawSky(s, horizon));
    out.push(mountains(s, 'vfar', horizon + 10, mountainsH, mix(s.sky.haze, '#4a5868', 0.45), { peaks: 4, rough: 0.08, haze: 0.3 }));
    out.push(hills(s, 'vmid', horizon + 40, 60, mix(gl.grassDark, s.sky.haze, 0.35), H, 4));
    out.push(groundMass(s, -40, W + 40, (x) => horizon + 70 + Math.sin(x / 180) * 10, H, gl.grass));
  };

  switch (scene) {
    case 'storm': {
      out.push(drawSky(s, 330));
      out.push(rect(0, 0, W, 360, { fill: '#1a1e28', opacity: '0.55' }));
      for (let i = 0; i < 40; i++) {
        const x = r.next() * W;
        out.push(line(x, 0, x - 60, H, { stroke: '#a8b4c4', 'stroke-opacity': '0.18', 'stroke-width': 1.4 }));
      }
      const bx = W * r.range(0.6, 0.8);
      out.push(path(`M${n(bx)} 0L${n(bx - 30)} 120L${n(bx + 10)} 130L${n(bx - 40)} 300`, { fill: 'none', stroke: '#f4f6ff', 'stroke-width': 4, filter: 'url(#sc-glow)' }), path(`M${n(bx)} 0L${n(bx - 30)} 120L${n(bx + 10)} 130L${n(bx - 40)} 300`, { fill: 'none', stroke: '#ffffff', 'stroke-width': 2 }));
      out.push(waves(s, 360, 3, 30, '#1d3a48', 'sw1'));
      out.push(g({ transform: `rotate(-12 ${W * 0.42} 470)` }, shipSide(W * 0.42, 470, 420, culture, { sail: 'set' })));
      out.push(waves(s, 520, 3, 44, '#173543', 'sw2'));
      break;
    }
    case 'voyage': {
      seaScene(360);
      out.push(shipSide(W * 0.5, 470, 520, culture, { sail: 'set' }));
      out.push(shipSide(W * 0.18, 400, 220, culture, { sail: 'set', flip: false }));
      for (let i = 0; i < 4; i++) out.push(bird(W * r.range(0.6, 0.9), r.range(80, 220), r.range(8, 14), '#3a3a40'));
      break;
    }
    case 'landing': {
      out.push(drawSky(s, 330));
      out.push(water(s, 330, H));
      const beach = (x0: number, base: (x: number) => number) => (x: number): number => {
        const t = Math.min(1, Math.max(0, (x - x0) / 160));
        return base(x0 + 160) + (1 - t * t * (3 - 2 * t)) * (H + 20 - base(x0 + 160)) + (t >= 1 ? base(x) - base(x0 + 160) : 0);
      };
      out.push(groundMass(s, 420, W + 40, beach(420, (x) => 430 - (x - 420) * 0.06), H, '#a89a7a'));
      out.push(groundMass(s, 600, W + 40, beach(600, (x) => 390 - (x - 600) * 0.08), H, gl.grass));
      out.push(shipSide(300, 520, 440, culture, { sail: 'furled', flip: false }));
      out.push(shipSide(150, 430, 260, culture, { sail: 'set' }));
      for (let i = 0; i < 8; i++) out.push(person({ x: 520 + i * 70 + r.jitter(10), y: 560 - i * 8, h: 120 + r.range(-10, 10), cloak: r.pick(pal.cloth), pose: 'walk', shield: r.chance(0.7) ? pal.primary : undefined, spear: r.chance(0.5) }));
      break;
    }
    case 'raid': {
      landScene(380, 80);
      for (let i = 0; i < 4; i++) {
        const x = 200 + i * 260 + r.jitter(30);
        const y = 520 + (i % 2) * 20;
        out.push(smoke(s, x + r.jitter(20), y - 90, 320, true, `rd${i}`));
        out.push(dwellingFor(other, x, y, bo(1.6, i % 2 === 0)));
        const flames = roofFlames(r, x - 70, x + 70, y - 60, 1.3);
        out.push(flames);
        glow.push(ellipse(x, y - 70, 170, 120, { fill: 'url(#sc-fire)', opacity: '0.55' }), flames);
      }
      for (let i = 0; i < 26; i++) glow.push(circle(r.range(120, W - 120), r.range(140, 480), r.range(1.2, 2.6), { fill: '#ffc870', opacity: n2(r.range(0.4, 0.9)) }));
      out.push(crowdRow(s, 'raiders', 120, W - 120, 640, 130, 7, culture, true));
      break;
    }
    case 'funeral': {
      seaScene(380);
      const sx = W * 0.5;
      out.push(shipSide(sx, 470, 380, culture, { sail: 'none', shields: true }));
      out.push(ellipse(sx, 380, 170, 130, { fill: 'url(#sc-fire)' }));
      out.push(smoke(s, sx, 330, 320, false, 'pyre'));
      out.push(groundMass(s, -40, W + 40, (x) => 560 + Math.sin(x / 120) * 10, H, shade(gl.grassDark, -0.2)));
      out.push(crowdRow(s, 'mourners', 140, W - 140, 640, 110, 9, culture, false));
      break;
    }
    case 'wedding': {
      landScene(360, 80);
      out.push(longhouse(W * 0.75, 470, bo(2), 'hall'));
      for (let i = 0; i < 5; i++) out.push(broadleaf(80 + i * 90, 470, 200 + r.range(0, 40), '#4a6e3a', false));
      out.push(person({ x: W * 0.45, y: 600, h: 190, cloak: pal.primary, hair: '#c8a35e' }), person({ x: W * 0.53, y: 600, h: 175, cloak: '#e8dcc0', hair: '#8a6440' }));
      out.push(path(`M${n(W * 0.47)} ${n(470)}Q${n(W * 0.49)} ${n(455)} ${n(W * 0.51)} ${n(470)}`, { fill: 'none', stroke: '#c9a227', 'stroke-width': 4 }));
      out.push(crowdRow(s, 'guests', 60, W * 0.38, 640, 140, 5, culture, false), crowdRow(s, 'guests2', W * 0.6, W - 40, 640, 140, 5, culture, false));
      break;
    }
    case 'birth':
    case 'sickness':
    case 'captivity':
    case 'storehouse':
    case 'feast': {
      // Firelit room.
      out.push(rect(0, 0, W, H, { fill: '#2a1c12' }));
      out.push(polygon([0, H, W, H, W * 0.7, H * 0.55, W * 0.3, H * 0.55], { fill: '#3a2a1c' }));
      for (let i = 0; i < 9; i++) out.push(line(W * 0.12 * i, 0, W * 0.3 + W * 0.05 * i, H * 0.55, { stroke: '#1a120a', 'stroke-width': 10 }));
      const fx = W * 0.5;
      const fy = H * 0.72;
      if (scene !== 'storehouse') {
        out.push(ellipse(fx, fy, 120, 30, { fill: '#3a3430' }));
        for (let i = 0; i < 5; i++) out.push(path(`M${n(fx - 50 + i * 25)} ${n(fy)}Q${n(fx - 44 + i * 25)} ${n(fy - 100)} ${n(fx - 36 + i * 25)} ${n(fy - 150 + r.range(0, 40))}Q${n(fx - 26 + i * 25)} ${n(fy - 70)} ${n(fx - 20 + i * 25)} ${n(fy)}Z`, { fill: 'url(#v-flame)' }));
      }
      if (scene === 'birth') {
        out.push(person({ x: W * 0.28, y: H * 0.86, h: 260, cloak: pal.cloth[0] ?? '#6a5038', pose: 'kneel' }));
        out.push(rect(W * 0.66, H * 0.74, 160, 70, { fill: '#6a4a2c', rx: 30 }), ellipse(W * 0.66 + 80, H * 0.74 + 10, 60, 18, { fill: '#e8dcc0' }));
        out.push(person({ x: W * 0.8, y: H * 0.88, h: 300, cloak: '#7a3b2a' }));
      } else if (scene === 'sickness') {
        out.push(rect(W * 0.12, H * 0.78, 420, 40, { fill: '#5a3e26' }), person({ x: W * 0.28, y: H * 0.78, h: 330, cloak: '#8a8070', pose: 'lie' }));
        out.push(person({ x: W * 0.62, y: H * 0.92, h: 300, cloak: '#4a5a4a', pose: 'kneel' }));
        for (let i = 0; i < 8; i++) out.push(ellipse(W * 0.1 + i * 130, 60 + r.range(0, 40), 14, 30, { fill: r.pick(['#5a6a3a', '#6a5a3a']) }));
      } else if (scene === 'storehouse') {
        // A storehouse by lamplight: stockfish and hams hanging from the tie-beam, a shelf of
        // crocks, barrels, and grain sacks heaped in piles; a steward counting the stores.
        const beamY = H * 0.17;
        out.push(rect(0, beamY - 9, W, 16, { fill: '#1c120a' }));
        for (let i = 0; i < 11; i++) {
          const x = 50 + i * 106 + r.jitter(14);
          const hang = r.range(10, 26);
          out.push(line(x, beamY + 6, x, beamY + 6 + hang, { stroke: '#3a2a1a', 'stroke-width': 2 }));
          const y0 = beamY + 6 + hang;
          if (r.chance(0.65)) {
            // A pair of split stockfish, tails up.
            for (const dx of [-7, 7]) out.push(path(`M${n(x + dx * 0.4)} ${n(y0)}l${n(dx)} ${n(10)}q${n(dx * 0.4)} ${n(30)} ${n(-dx * 0.2)} ${n(62)}l${n(-dx * 0.5)} ${n(-6)}q${n(-dx * 0.3)} ${n(-28)} ${n(-dx * 0.2)} ${n(-56)}Z`, { fill: shade('#a8875a', r.range(-0.15, 0.1)), stroke: '#4a3220', 'stroke-width': 1.2 }));
          } else {
            out.push(path(`M${n(x)} ${n(y0)}q${n(-22)} ${n(16)} ${n(-16)} ${n(52)}q${n(16)} ${n(14)} ${n(32)} 0q${n(6)} ${n(-36)} ${n(-16)} ${n(-52)}Z`, { fill: shade('#7a3e2a', r.range(-0.1, 0.1)), stroke: '#3a1a10', 'stroke-width': 1.4 }));
          }
        }
        const shelfY = H * 0.47;
        out.push(rect(W * 0.04, shelfY, W * 0.4, 10, { fill: '#4a3220' }), rect(W * 0.06, shelfY + 10, 8, H * 0.3, { fill: '#3a2616' }), rect(W * 0.41, shelfY + 10, 8, H * 0.3, { fill: '#3a2616' }));
        for (let i = 0; i < 7; i++) {
          const x = W * 0.07 + i * 66 + r.jitter(8);
          const h = r.range(46, 70);
          const col = r.pick(['#8a5a3a', '#a8744a', '#6a4a32', '#9a8a6a']);
          out.push(path(`M${n(x - 16)} ${n(shelfY)}Q${n(x - 26)} ${n(shelfY - h * 0.55)} ${n(x - 9)} ${n(shelfY - h * 0.86)}V${n(shelfY - h)}H${n(x + 9)}V${n(shelfY - h * 0.86)}Q${n(x + 26)} ${n(shelfY - h * 0.55)} ${n(x + 16)} ${n(shelfY)}Z`, { fill: col, stroke: shade(col, -0.45), 'stroke-width': 1.4 }));
          out.push(ellipse(x, shelfY - h, 10, 3, { fill: shade(col, -0.35) }));
        }
        const sack = (x: number, y: number, w: number, h: number, col: string): string =>
          g({}, [
            path(`M${n(x - w / 2)} ${n(y)}Q${n(x - w * 0.62)} ${n(y - h * 0.6)} ${n(x - w * 0.16)} ${n(y - h * 0.86)}L${n(x - w * 0.1)} ${n(y - h)}L${n(x + w * 0.1)} ${n(y - h)}L${n(x + w * 0.16)} ${n(y - h * 0.86)}Q${n(x + w * 0.62)} ${n(y - h * 0.6)} ${n(x + w / 2)} ${n(y)}Q${n(x)} ${n(y + h * 0.08)} ${n(x - w / 2)} ${n(y)}Z`, { fill: col, stroke: shade(col, -0.45), 'stroke-width': 1.6 }),
            line(x - w * 0.18, y - h * 0.85, x + w * 0.18, y - h * 0.85, { stroke: '#3a2a1a', 'stroke-width': 3 }),
            path(`M${n(x - w * 0.25)} ${n(y - h * 0.45)}q${n(w * 0.2)} ${n(h * 0.12)} ${n(w * 0.45)} ${n(h * 0.02)}`, { fill: 'none', stroke: shade(col, -0.25), 'stroke-width': 1.4, opacity: '0.7' }),
          ]);
        const sacks: string[] = [];
        for (let i = 0; i < 9; i++) {
          const row = i < 5 ? 0 : 1;
          const x = W * 0.5 + (row === 0 ? (i - 2) * 74 : (i - 6.5) * 74) + r.jitter(8);
          const y = row === 0 ? H * 0.9 : H * 0.9 - 58;
          sacks.push(sack(x, y, r.range(64, 80), r.range(76, 96), shade('#8a7048', r.range(-0.2, 0.05))));
        }
        out.push(g({}, sacks));
        for (let i = 0; i < 3; i++) {
          const x = W * 0.8 + i * 74;
          const y = H * 0.92 - (i === 1 ? 0 : 6);
          out.push(path(`M${n(x - 30)} ${n(y)}Q${n(x - 38)} ${n(y - 55)} ${n(x - 30)} ${n(y - 110)}H${n(x + 30)}Q${n(x + 38)} ${n(y - 55)} ${n(x + 30)} ${n(y)}Z`, { fill: '#6a4a2c', stroke: '#2e1c0e', 'stroke-width': 2 }));
          for (const t of [0.18, 0.5, 0.82]) out.push(line(x - 34 + Math.abs(t - 0.5) * 6, y - 110 * t, x + 34 - Math.abs(t - 0.5) * 6, y - 110 * t, { stroke: '#2a2a2a', 'stroke-width': 5 }));
          out.push(ellipse(x, y - 110, 30, 6, { fill: '#4a3220' }));
        }
        // Hanging lamp and its light.
        out.push(line(W * 0.62, beamY + 6, W * 0.62, H * 0.33, { stroke: '#2a1a10', 'stroke-width': 2 }), path(`M${n(W * 0.62 - 12)} ${n(H * 0.33)}h24l-5 14h-14Z`, { fill: '#5a4a3a' }), circle(W * 0.62, H * 0.33 - 3, 5, { fill: '#ffe2a0', filter: 'url(#sc-glow)' }));
        out.push(person({ x: W * 0.16, y: H * 0.98, h: 300, cloak: pal.cloth[1] ?? '#6a5038', facing: 1 }));
      } else if (scene === 'captivity') {
        out.push(person({ x: W * 0.3, y: H * 0.9, h: 280, cloak: '#5a5048', pose: 'kneel' }));
        out.push(path(`M${n(W * 0.27)} ${n(H * 0.68)}q30 20 60 0`, { fill: 'none', stroke: '#8a7a5a', 'stroke-width': 5 }));
        out.push(person({ x: W * 0.78, y: H * 0.94, h: 360, cloak: opal.primary, spear: true, shield: opal.secondary, facing: -1 }));
      } else {
        for (const side of [-1, 1]) {
          out.push(polygon([fx + side * 160, H * 0.62, fx + side * 520, H, fx + side * 760, H, fx + side * 260, H * 0.62], { fill: '#5a3e26' }));
        }
        out.push(crowdRow(s, 'feastL', 40, W * 0.34, H * 0.95, 260, 4, culture, false), crowdRow(s, 'feastR', W * 0.66, W - 40, H * 0.95, 260, 4, culture, false));
      }
      out.push(rect(0, 0, W, H, { fill: 'url(#v-firelight)', style: 'mix-blend-mode:screen' }));
      break;
    }
    case 'ravens': {
      landScene(420, 140);
      out.push(broadleaf(W * 0.78, 520, 360, '#5a4a2a', true));
      for (let i = 0; i < 9; i++) out.push(bird(W * 0.3 + Math.cos(i * 0.8) * 180 + r.jitter(30), 180 + Math.sin(i * 0.8) * 70 + r.jitter(20), r.range(14, 22)));
      out.push(person({ x: W * 0.3, y: 640, h: 200, cloak: '#3a3a40', pose: 'raise', spear: true }));
      break;
    }
    case 'comet': {
      landScene(440, 120);
      const cx = W * 0.68;
      const cy = 140;
      out.push(path(`M${n(cx)} ${n(cy)}L${n(cx - 420)} ${n(cy - 90)}L${n(cx - 420)} ${n(cy - 60)}Z`, { fill: 'url(#v-tail)' }), circle(cx, cy, 7, { fill: '#ffffff', filter: 'url(#sc-glow)' }), circle(cx, cy, 4, { fill: '#ffffff' }));
      out.push(crowdRow(s, 'watchers', 200, 700, 640, 150, 5, culture, false));
      break;
    }
    case 'northernLights': {
      landScene(460, 160);
      const fid = uid(s, 'aur');
      s.defs.push(el('filter', { id: fid, x: '-20%', y: '-50%', width: '140%', height: '200%' }, el('feGaussianBlur', { stdDeviation: 14 })));
      const bands: string[] = [];
      for (let i = 0; i < 4; i++) {
        let d = `M-40 ${n(120 + i * 40)}`;
        for (let x = -40; x <= W + 80; x += 120) d += `Q${n(x + 60)} ${n(80 + i * 40 + r.jitter(60))} ${n(x + 120)} ${n(120 + i * 40 + r.jitter(30))}`;
        bands.push(path(d, { fill: 'none', stroke: i % 2 === 0 ? '#5af0a0' : '#7ae0d0', 'stroke-width': n(40 - i * 6), opacity: n2(0.4 - i * 0.06) }));
      }
      out.push(g({ filter: `url(#${fid})`, style: 'mix-blend-mode:screen' }, bands));
      out.push(longhouse(W * 0.7, 560, bo(1.4), 'long'));
      out.push(person({ x: W * 0.3, y: 640, h: 170, cloak: '#4a4a52', pose: 'raise' }));
      break;
    }
    case 'thing': {
      landScene(380, 100);
      out.push(rect(W * 0.5 - 22, 380, 44, 150, { fill: '#7d786c', rx: 10 }));
      out.push(person({ x: W * 0.5, y: 380, h: 140, cloak: '#e8dcc0', pose: 'raise' }));
      for (let ring = 0; ring < 3; ring++) {
        const count = 9 + ring * 3;
        for (let i = 0; i < count; i++) {
          const a = Math.PI * (0.05 + (0.9 * i) / (count - 1));
          const rx = 220 + ring * 140;
          out.push(person({ x: W * 0.5 - Math.cos(a) * rx, y: 520 + Math.sin(a) * (30 + ring * 50), h: 110 + ring * 25, cloak: shade(r.pick(pal.cloth), -0.1), spear: r.chance(0.4) }));
        }
      }
      break;
    }
    case 'holmgang': {
      landScene(400, 100);
      out.push(ellipse(W * 0.5, 600, 360, 60, { fill: '#8a6a42', opacity: '0.7' }));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = W * 0.5 + Math.cos(a) * 340;
        const y = 600 + Math.sin(a) * 56;
        out.push(line(x, y, x, y - 50, { stroke: '#4a3220', 'stroke-width': 6 }));
      }
      out.push(person({ x: W * 0.42, y: 620, h: 220, cloak: pal.primary, shield: pal.secondary, axe: true, pose: 'strike' }));
      out.push(person({ x: W * 0.58, y: 620, h: 225, cloak: opal.primary, shield: opal.secondary, axe: true, facing: -1, pose: 'walk' }));
      out.push(crowdRow(s, 'onlookers', 40, W - 40, 470, 90, 12, culture, false));
      break;
    }
    case 'harvest':
    case 'famine': {
      landScene(380, 90);
      const fam = scene === 'famine';
      for (let i = 0; i < 10; i++) {
        const t0 = (i / 10) ** 1.5;
        const t1 = ((i + (fam ? 1.02 : 0.55)) / 10) ** 1.5;
        const y0 = 462 + t0 * 230;
        const y1 = 462 + t1 * 230;
        out.push(polygon([-20, y0 + 14, W + 20, y0 - 6, W + 20, y1 - 6, -20, y1 + 14], { fill: fam ? (i % 2 ? '#6e6052' : '#5e5244') : i % 2 ? '#c8a050' : '#a8883a', opacity: fam ? '0.92' : '0.85' }));
      }
      if (fam) for (let i = 0; i < 9; i++) out.push(ellipse(r.range(40, W - 40), r.range(500, 660), r.range(30, 90), r.range(5, 11), { fill: '#e8ecee', opacity: '0.7' }));
      if (fam) {
        out.push(broadleaf(W * 0.2, 560, 300, '#3a3020', true));
        for (let i = 0; i < 5; i++) out.push(bird(W * r.range(0.4, 0.9), r.range(120, 260), r.range(10, 16)));
        out.push(person({ x: W * 0.6, y: 660, h: 200, cloak: '#5a5048', pose: 'kneel' }));
      } else {
        for (let i = 0; i < 6; i++) {
          const x = 120 + i * 190;
          out.push(path(`M${x} 640L${x - 20} 560M${x} 640L${x} 550M${x} 640L${x + 20} 560`, { stroke: '#c8a050', 'stroke-width': 8 }), rect(x - 14, 600, 28, 8, { fill: '#8a6a32' }));
        }
        out.push(crowdRow(s, 'reapers', 200, W - 200, 600, 150, 5, culture, false));
      }
      break;
    }
    case 'wreck': {
      out.push(drawSky(s, 380));
      out.push(water(s, 380, H));
      out.push(polygon([W * 0.3, H, W * 0.42, 470, W * 0.5, 430, W * 0.6, 480, W * 0.75, H], { fill: '#3a3632' }));
      out.push(g({ transform: `rotate(18 ${W * 0.55} 520)` }, shipSide(W * 0.55, 520, 380, culture, { sail: 'none', shields: false })));
      for (let i = 0; i < 10; i++) out.push(rect(r.range(60, W - 60), r.range(540, H - 20), r.range(30, 80), 8, { fill: '#5a3e26', transform: `rotate(${n(r.jitter(30))})` }));
      out.push(waves(s, 600, 2, 20, '#1d3a48', 'wk'));
      break;
    }
    case 'hunt': {
      landScene(400, 120);
      for (let i = 0; i < 12; i++) out.push(conifer(r.range(0, W), 470 + r.range(0, 30), 200 + r.range(0, 100), '#2e4a32', s.snow));
      const bx = W * 0.7;
      out.push(bear(bx, 610, 1.15, '#4a3424'));
      for (let i = 0; i < 3; i++) out.push(person({ x: 200 + i * 130, y: 640, h: 190, cloak: r.pick(pal.cloth), spear: true, pose: 'walk' }));
      for (let i = 0; i < 2; i++) out.push(g({ transform: `translate(${560 + i * 90} 0) scale(-1 1) translate(${-(560 + i * 90)} 0)` }, hound(560 + i * 90, 640 - i * 6, 1.1, i === 0 ? '#6a5a48' : '#8a7458')));
      break;
    }
    case 'envoy': {
      landScene(380, 110);
      out.push(dwellingFor(culture, W * 0.78, 480, bo(1.8)));
      out.push(person({ x: W * 0.35, y: 620, h: 210, cloak: opal.primary, pose: 'walk' }));
      out.push(line(W * 0.4, 640, W * 0.42, 360, { stroke: '#4a3220', 'stroke-width': 6 }), path(`M${n(W * 0.42)} 360h70l-14 22l14 22h-70Z`, { fill: opal.primary }));
      out.push(person({ x: W * 0.62, y: 620, h: 220, cloak: pal.primary, facing: -1, spear: true, shield: pal.secondary }));
      break;
    }
    case 'trade': {
      out.push(drawSky(s, 360));
      out.push(water(s, 360, H));
      out.push(groundMass(s, 380, W + 40, (x) => 470 - (x - 380) * 0.02, H, '#a89a7a'));
      out.push(shipSide(220, 540, 380, other, { sail: 'furled', shields: false }));
      for (let i = 0; i < 3; i++) out.push(stall(560 + i * 220, 600, { ...bo(3), rng: r }));
      out.push(crowdRow(s, 'traders', 480, W - 60, 680, 160, 6, culture, false));
      break;
    }
    case 'shieldWall': {
      landScene(360, 100);
      const rowY = 620;
      for (let i = 0; i < 12; i++) {
        const x = 40 + i * 98;
        out.push(person({ x, y: rowY, h: 210, cloak: r.pick(pal.cloth), spear: i % 2 === 0, shield: i % 2 === 0 ? pal.primary : pal.secondary }));
      }
      for (let i = 0; i < 12; i++) out.push(ellipse(100 + i * 92, 420, 26, 30, { fill: i % 2 === 0 ? opal.primary : opal.secondary, opacity: '0.85' }));
      break;
    }
    case 'fog': {
      seaScene(380);
      out.push(shipSide(W * 0.4, 500, 460, culture, { sail: 'set' }));
      out.push(shipSide(W * 0.82, 440, 300, other, { sail: 'set', flip: true }));
      out.push(rect(0, 0, W, H, { fill: '#c8ccd0', opacity: '0.55' }));
      out.push(shipSide(W * 0.12, 600, 240, culture, { sail: 'furled' }));
      out.push(rect(0, 300, W, 300, { fill: '#d8dcdf', opacity: '0.35' }));
      break;
    }
    case 'shore': {
      out.push(drawSky(s, 360));
      out.push(water(s, 360, H));
      const shoreTop = (x: number): number => 470 + (x - W) * -0.12 + Math.sin(x / 70) * 6;
      out.push(groundMass(s, 260, W + 40, shoreTop, H, s.snow > 0.3 ? '#dfe4e6' : '#a89a7a'));
      out.push(shipSide(W * 0.62, 560, 360, culture, { sail: 'none', shields: false }));
      out.push(person({ x: W * 0.3, y: 640, h: 200, cloak: pal.primary, facing: 1 }));
      for (let i = 0; i < 3; i++) out.push(bird(W * r.range(0.4, 0.9), r.range(100, 220), r.range(10, 14), '#3a3a40'));
      break;
    }
    case 'aftermath': {
      landScene(380, 90);
      for (let i = 0; i < 14; i++) {
        const x = r.range(40, W - 40);
        const y = r.range(520, 660);
        if (r.chance(0.5)) out.push(ellipse(x, y, 22, 10, { fill: r.chance(0.5) ? pal.primary : opal.primary, stroke: '#1a120c', 'stroke-width': 2 }));
        else out.push(line(x, y, x + r.jitter(18), y - r.range(60, 110), { stroke: '#4a3220', 'stroke-width': 4 }));
      }
      for (let i = 0; i < 6; i++) out.push(bird(W * r.range(0.2, 0.9), r.range(80, 260), r.range(10, 16)));
      out.push(person({ x: W * 0.72, y: 650, h: 210, cloak: pal.primary, spear: true, shield: pal.secondary, facing: -1 }));
      break;
    }
    case 'nightFjord': {
      out.push(nightFjordScene(s, culture));
      break;
    }
    case 'barrow': {
      landScene(420, 120);
      out.push(path(`M${W * 0.15} 640Q${W * 0.5} 220 ${W * 0.85} 640Z`, { fill: shade(gl.grass, -0.12) }));
      out.push(path(`M${W * 0.44} 640V520Q${W * 0.5} 470 ${W * 0.56} 520V640Z`, { fill: '#100c0a' }));
      for (const dx of [-1, 1]) out.push(rect(W * 0.5 + dx * 90 - 14, 470, 28, 170, { fill: '#7d786c', rx: 6 }));
      out.push(rect(W * 0.5 - 110, 456, 220, 26, { fill: '#6a665c', rx: 4 }));
      out.push(person({ x: W * 0.22, y: 660, h: 200, cloak: pal.primary, spear: true, shield: pal.secondary }));
      break;
    }
    default:
      break;
  }
  return g({}, out);
}

export interface VignetteParams {
  scene: VignetteScene;
  culture: CultureId;
  other: CultureId;
  season: SeasonKey;
  time: TimeOfDay;
  seed: number;
}

/** Renders an event vignette. */
export function vignetteSvg(p: VignetteParams, opts: { width?: number; height?: number; watermark?: WatermarkMode; label?: string } = {}): string {
  const [W, H] = VIGNETTE_SIZE;
  const s = newScene(W, H, `vig|${p.scene}|${p.culture}|${p.seed}`, p.culture, p.season, p.time);
  const defs: string[] = [
    linearGradient('v-flame', [[0, '#fff2a0'], [0.35, '#f6b04a'], [1, '#c03a14', 0.6]], { x1: 0, y1: 1, x2: 0, y2: 0 }),
    radialGradient('v-firelight', [[0, '#ffb060', 0.55], [0.6, '#e07030', 0.15], [1, '#000000', 0]], { cx: 0.5, cy: 0.7, r: 0.7 }),
    linearGradient('v-tail', [[0, '#ffffff', 0.9], [1, '#a8c0ff', 0]], { x1: 1, y1: 0.5, x2: 0, y2: 0.4 }),
    grainFilter('v-grain', p.seed, 0.85, 0.2),
    mottleFilter('v-mottle', p.seed, 0.008),
    vignetteGradient('v-vig', 0.6),
  ];
  const glow: string[] = [];
  const body: string[] = [drawScene(p.scene, s, p.culture, p.other, glow)];
  const indoor = p.scene === 'birth' || p.scene === 'sickness' || p.scene === 'captivity' || p.scene === 'feast' || p.scene === 'storehouse';
  // The title painting paints its own night light (moon, aurora and lights keep their glow).
  if (!indoor && p.scene !== 'nightFjord') body.push(lightOverlay(s, H * 0.55));
  if (glow.length > 0) body.push(g({ style: 'mix-blend-mode:screen' }, glow));
  body.push(rect(0, 0, W, H, { filter: 'url(#v-mottle)', opacity: '0.3', style: 'mix-blend-mode:multiply' }));
  body.push(rect(0, 0, W, H, { filter: 'url(#v-grain)', opacity: '0.75', style: 'mix-blend-mode:multiply' }));
  body.push(rect(0, 0, W, H, { fill: 'url(#v-vig)' }));
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  if (opts.watermark && opts.watermark !== 'off') body.push(g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark)));
  return svgDoc({ width, height, viewBox: [0, 0, W, H], defs: [...defs, ...sceneDefs(), ...s.defs], body, preserveAspectRatio: 'xMidYMid slice' });
}

export function vignetteParamsFrom(params: GeneratorParams, fallback: VignetteScene = 'voyage'): VignetteParams {
  const raw = typeof params.scene === 'string' ? params.scene : '';
  const scene: VignetteScene = (VIGNETTE_SCENES as readonly string[]).includes(raw) ? (raw as VignetteScene) : Object.hasOwn(VIGNETTE_SCENE_ALIASES, raw) ? (VIGNETTE_SCENE_ALIASES[raw] as VignetteScene) : fallback;
  const d = SCENE_DEFAULTS[scene];
  const palette = typeof params.palette === 'string' && Object.hasOwn(VIGNETTE_PALETTES, params.palette) ? VIGNETTE_PALETTES[params.palette] : undefined;
  const culture = oneOf(params, 'culture', ALL_CULTURES, 'skarn');
  return {
    scene,
    culture,
    other: oneOf(params, 'other', ALL_CULTURES, culture === 'albric' ? 'skarn' : 'albric'),
    season: oneOf(params, 'season', SEASONS, palette?.season ?? d.season),
    time: oneOf(params, 'time', TIMES_OF_DAY, palette?.time ?? d.time),
    seed: seedOf(params, scene),
  };
}

export const vignetteGenerator: ImageGenerator = {
  id: 'vignette',
  kind: 'image',
  defaultSize: VIGNETTE_SIZE,
  params: [
    { name: 'scene', type: 'enum', values: [...VIGNETTE_SCENES, ...Object.keys(VIGNETTE_SCENE_ALIASES)], default: 'voyage', note: `aliases: ${Object.entries(VIGNETTE_SCENE_ALIASES).map(([a, b]) => `${a}=${b}`).join(', ')}` },
    { name: 'palette', type: 'enum', values: Object.keys(VIGNETTE_PALETTES), note: 'shorthand for season/time' },
    { name: 'culture', type: 'enum', values: ALL_CULTURES, default: 'skarn', note: 'culture of the protagonists' },
    { name: 'other', type: 'enum', values: ALL_CULTURES, note: 'the other party (raid victims, envoy, rival)' },
    { name: 'season', type: 'enum', values: SEASONS, note: 'default per scene' },
    { name: 'time', type: 'enum', values: TIMES_OF_DAY, note: 'default per scene' },
    { name: 'seed', type: 'number' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return vignetteSvg(vignetteParamsFrom(params), { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label });
  },
  variants(): GeneratorParams[] {
    return VIGNETTE_SCENES.map((scene, i) => ({ scene, culture: (['skarn', 'hvarn', 'eyjar'] as const)[i % 3], seed: 11 }));
  },
};

/** `menuBackdrop` generator: a large title painting (defaults to the moonlit fjord with a longship). */
export const menuBackdropGenerator: ImageGenerator = {
  id: 'menuBackdrop',
  kind: 'image',
  defaultSize: [1920, 1080],
  params: vignetteGenerator.params,
  render(params: GeneratorParams, ctx: RenderContext): string {
    return vignetteSvg(vignetteParamsFrom(params, 'nightFjord'), { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label });
  },
  variants(): GeneratorParams[] {
    return [{ scene: 'nightFjord', seed: 812 }];
  },
};
