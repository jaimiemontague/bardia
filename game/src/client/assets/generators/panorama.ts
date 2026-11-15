/**
 * `panorama` generator: settlement panoramas (design §27.2: culture sets × tiers × economy looks,
 * season and time of day). One painted view from the water or the approach: sky, distant terrain
 * (fjord walls, headlands, river valley or open steppe), the settlement in its culture's building
 * style sized by tier, ships drawn up on the strand, hearth smoke, and the light of the hour.
 * Ruined settlements are charred, smoking and shipless; thriving ones fly banners and fill the strand.
 */
import type { CultureId, EconomyStateId, SettlementTierId } from '@content/schemas/ids';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { el, ellipse, g, line, n2, path, rect, svgDoc } from '../svg/svg';
import { CULTURE_PALETTE, SEASONS, TIMES_OF_DAY, gradingFilter, groundLook, mix, shade, type SeasonKey, type TimeOfDay } from '../svg/palette';
import { mottleFilter, grainFilter, vignetteGradient, watermark, type WatermarkMode } from '../svg/paint';
import { num, oneOf, seedOf } from './params';
import {
  banner,
  broadleaf,
  buildStyleOf,
  conifer,
  cypress,
  domeBuilding,
  figure,
  foliage,
  groundMass,
  hillFort,
  hills,
  lanternChurch,
  lightOverlay,
  logHouse,
  longhouse,
  mountains,
  newScene,
  palisade,
  rack,
  roundTower,
  roundhouse,
  sceneDefs,
  shipSide,
  skinTent,
  smoke,
  stall,
  stoneHouse,
  stoneWall,
  timberHall,
  water,
  yurt,
  drawSky,
  type BuildOpts,
  type BuildStyle,
  type GroundFn,
  type Scene,
  uid,
  withLights,
} from './scene';

export const PANORAMA_SIZE = [1600, 900] as const;
const ALL_CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese', 'isafolder', 'rime'];
const TIERS: readonly SettlementTierId[] = ['hamlet', 'village', 'town', 'city', 'capital', 'cloister', 'fortress', 'emporium', 'templeStead'];
const ECONOMIES: readonly EconomyStateId[] = ['ruined', 'destitute', 'poor', 'fair', 'thriving'];
export const TERRAINS = ['auto', 'fjord', 'coast', 'river', 'plain'] as const;
export type Terrain = Exclude<(typeof TERRAINS)[number], 'auto'>;

/** Default terrain per culture. */
export function defaultTerrain(culture: CultureId): Terrain {
  switch (culture) {
    case 'skarn':
      return 'fjord';
    case 'corvani':
    case 'velkar':
      return 'river';
    case 'kurgai':
      return 'plain';
    default:
      return 'coast';
  }
}

export interface PanoramaParams {
  culture: CultureId;
  tier: SettlementTierId;
  economy: EconomyStateId;
  season: SeasonKey;
  time: TimeOfDay;
  terrain: Terrain;
  seed: number;
  /** Horizontal position of the settlement centre (0..1 of the width); undefined = natural layout. */
  focus?: number;
}

const TIER_COUNT: Readonly<Record<SettlementTierId, number>> = { hamlet: 3, village: 6, town: 10, city: 15, capital: 18, cloister: 5, fortress: 5, emporium: 12, templeStead: 6 };
const ECON_MULT: Readonly<Record<EconomyStateId, number>> = { ruined: 0.9, destitute: 0.65, poor: 0.85, fair: 1, thriving: 1.3 };
const ECON_WEALTH: Readonly<Record<EconomyStateId, number>> = { ruined: 0, destitute: 0.1, poor: 0.3, fair: 0.55, thriving: 0.95 };

/** One ordinary dwelling in the given style. */
function dwelling(style: BuildStyle, x: number, y: number, o: BuildOpts): string {
  switch (style) {
    case 'north':
      return longhouse(x, y, o, o.rng.chance(0.55) ? 'long' : 'small');
    case 'albric':
      return timberHall(x, y, o, false);
    case 'cael':
      return roundhouse(x, y, o);
    case 'corvani':
      return stoneHouse(x, y, o, false);
    case 'saraleon':
      return stoneHouse(x, y, o, true);
    case 'velkar':
      return logHouse(x, y, o);
    case 'steppe':
      return yurt(x, y, o);
    case 'rime':
      return o.rng.chance(0.75) ? skinTent(x, y, o) : rack(x, y, o);
    default:
      return '';
  }
}

/** The settlement's chief building (hall, church, dome…). */
function landmark(style: BuildStyle, tier: SettlementTierId, x: number, y: number, o: BuildOpts): string {
  if (tier === 'cloister') return style === 'cael' ? g({}, [lanternChurch(x, y, { ...o, k: o.k * 1.4 }, true), roundTower(x + 90 * o.k, y, { ...o, k: o.k * 1.1 })]) : style === 'saraleon' ? domeBuilding(x, y, o, false) : lanternChurch(x, y, { ...o, k: o.k * 1.5 }, style === 'corvani');
  switch (style) {
    case 'north':
    case 'rime':
      return longhouse(x, y, { ...o, k: o.k * (tier === 'capital' ? 1.25 : 1) }, 'hall');
    case 'albric':
      return tier === 'city' || tier === 'capital' ? g({}, [timberHall(x - 60 * o.k, y, o, true), lanternChurch(x + 90 * o.k, y, o, false)]) : timberHall(x, y, o, true);
    case 'cael':
      return g({}, [roundhouse(x, y, { ...o, k: o.k * 1.5 }), tier !== 'hamlet' ? roundTower(x + 70 * o.k, y, o) : '']);
    case 'corvani':
      return lanternChurch(x, y, { ...o, k: o.k * 1.6 }, true);
    case 'saraleon':
      return domeBuilding(x, y, o, tier === 'capital' || tier === 'city');
    case 'velkar':
      return logHouse(x, y, { ...o, k: o.k * 1.6 });
    case 'steppe':
      return yurt(x, y, { ...o, k: o.k * 1.7 }) + banner(x + 40 * o.k, y, 70 * o.k, o.accent, o.k);
    default:
      return '';
  }
}

/** Decorative trees for a style. */
function tree(s: Scene, style: BuildStyle, x: number, y: number, h: number): string {
  if (style === 'steppe') return '';
  if (style === 'saraleon' || (style === 'corvani' && s.rng.chance(0.3))) return cypress(x, y, h * 1.1);
  const conif = style === 'north' || style === 'rime' || style === 'velkar' ? 0.8 : 0.25;
  return s.rng.chance(conif) ? conifer(x, y, h, s.group === 'far' ? '#3a4a3a' : '#2e4a32', s.snow) : broadleaf(x, y, h, foliage(s), s.season === 'winter');
}

/** Renders a settlement panorama. */
export function panoramaSvg(p: PanoramaParams, opts: { width?: number; height?: number; watermark?: WatermarkMode; label?: string } = {}): string {
  const [W, H] = PANORAMA_SIZE;
  const s = newScene(W, H, `pan|${p.culture}|${p.tier}|${p.economy}|${p.seed}`, p.culture, p.season, p.time);
  const style = buildStyleOf(p.culture);
  const pal = CULTURE_PALETTE[p.culture];
  const ground = groundLook(p.season, s.group);
  const ruined = p.economy === 'ruined';
  const wealth = ECON_WEALTH[p.economy];
  const terrain = p.terrain;
  const horizon = terrain === 'plain' ? 520 : 470;
  const body: string[] = [];

  // Sky and far terrain.
  body.push(drawSky(s, horizon));
  const far = mix(s.sky.haze, '#4a5868', 0.45);
  const mid = mix(s.sky.haze, s.group === 'south' ? '#6a6a50' : '#3e4e48', 0.55);
  if (terrain === 'fjord') {
    body.push(mountains(s, 'far', horizon + 10, 330, far, { peaks: 5, rough: 0.1, haze: 0.25 }));
    body.push(mountains(s, 'mid', horizon + 10, 230, mid, { peaks: 3, rough: 0.14 }));
  } else if (terrain === 'coast') {
    body.push(mountains(s, 'far', horizon + 4, s.group === 'north' || s.group === 'far' ? 170 : 90, far, { peaks: 4, rough: 0.08, haze: 0.35, snowLine: s.group === 'far' ? 0.3 : undefined }));
  } else if (terrain === 'river') {
    body.push(mountains(s, 'far', horizon + 10, 120, far, { peaks: 3, rough: 0.06, haze: 0.4, snowLine: 2 }));
    body.push(hills(s, 'midhills', horizon + 20, 70, mix(mid, ground.grassDark, 0.4), horizon + 120, 5));
  } else {
    body.push(mountains(s, 'far', horizon + 4, 50, far, { peaks: 3, rough: 0.04, haze: 0.5, snowLine: 2 }));
  }

  // Water.
  if (terrain !== 'plain') body.push(water(s, horizon, H));

  // The land the settlement stands on: it rises from the strand (left) to a backing hill (right).
  let groundY: GroundFn;
  let landX0: number;
  if (terrain === 'plain') {
    groundY = (x) => horizon + 150 + Math.sin(x / 260) * 10;
    landX0 = -40;
    body.push(groundMass(s, -40, W + 40, (x) => horizon + 2 + Math.sin(x / 300) * 4, H, mix(ground.grass, s.sky.haze, 0.35)));
  } else if (terrain === 'river') {
    groundY = (x) => 610 - (x - 900) * 0.05 + Math.sin(x / 140) * 6;
    landX0 = 430;
    body.push(groundMass(s, -40, W + 40, (x) => horizon + 18 + Math.sin(x / 200) * 6, horizon + 60, mix(ground.grassDark, s.sky.haze, 0.5)));
    body.push(groundMass(s, -40, 360, (x) => 760 + (x + 40) * 0.08 + Math.sin(x / 50) * 4, H, shade(ground.grassDark, -0.1)));
  } else {
    const slope = terrain === 'fjord' ? 0.1 : 0.06;
    groundY = (x) => 615 - (x - 800) * slope + Math.sin(x / 120) * 5;
    landX0 = 400;
    if (terrain === 'fjord') {
      // A steep fjord wall on the left that plunges into the water.
      const wallTop = (x: number): number => (x < 180 ? 300 + (x + 40) * 0.35 + Math.sin(x / 40) * 10 : 377 + ((x - 180) / 160) ** 1.6 * (horizon + 30 - 377));
      body.push(groundMass(s, -40, 340, wallTop, horizon + 34, shade(mid, -0.15)));
    }
  }
  // Backing hill with field strips (not on the steppe, where the whole view is grass).
  const hillTop = (x: number): number => groundY(x) - 70 - 40 * Math.sin((x - landX0) / 380) - 12 * Math.sin(x / 90);
  if (terrain !== 'plain') {
    body.push(groundMass(s, landX0 + 220, W + 40, hillTop, H, mix(ground.grassDark, s.sky.haze, 0.25)));
    if (s.snow < 0.3 && s.group !== 'far') {
      const fr = s.rng.fork('fields');
      const fields: string[] = [];
      for (let i = 0; i < 7; i++) {
        const x0 = landX0 + 420 + i * 150 + fr.jitter(30);
        const x1 = x0 + fr.range(90, 150);
        const y0a = hillTop(x0) + 12;
        const y1a = hillTop(x1) + 12;
        const colour = fr.pick(p.season === 'autumn' ? ['#b8963e', '#8a6a32', '#a8883a'] : p.season === 'spring' ? ['#7a9a4a', '#6a5a3a', '#8aa856'] : ['#9aa850', '#c0a85a', '#7a8a42']);
        fields.push(path(`M${x0} ${y0a}L${x1} ${y1a}L${x1 - 30} ${y1a + 50}L${x0 - 30} ${y0a + 50}Z`, { fill: colour, opacity: '0.55' }));
      }
      body.push(g({}, fields));
    }
  }
  const landTop = (x: number): number => {
    if (terrain === 'plain') return groundY(x) - 90;
    const span = 260;
    if (x >= landX0 + span) return groundY(x);
    const t = Math.max(0, (x - landX0) / span);
    const ease = t * t * (3 - 2 * t);
    // Small bays and points along the strand.
    const wobble = (Math.sin(x / 31 + p.seed) * 9 + Math.sin(x / 13 + p.seed * 0.7) * 4) * Math.sin(Math.PI * t);
    return groundY(landX0 + span) + (1 - ease) * (H + 30 - groundY(landX0 + span)) + wobble;
  };
  const landD = (): string => {
    let d = `M${landX0} ${H + 40}`;
    for (let x = landX0; x <= W + 40; x += 20) d += `L${x} ${n2(landTop(x))}`;
    return `${d}L${W + 40} ${H + 40}Z`;
  };
  /** Where the land edge crosses height y on the strand (landTop falls from the water to the hill). */
  const shoreX = (y: number): number => {
    let lo = landX0;
    let hi = landX0 + 260;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (landTop(m) > y) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  body.push(groundMass(s, landX0, W + 40, landTop, H, ground.grass, terrain === 'plain' ? undefined : s.group === 'south' ? '#d8c8a0' : '#a89a7a'));
  // Grass texture and a track from the strand up into the settlement.
  {
    const tr = s.rng.fork('grass');
    const clip = uid(s, 'land');
    s.defs.push(el('clipPath', { id: clip }, path(landD())));
    const strokes: string[] = [];
    const light = s.snow > 0.5 ? '#ffffff' : shade(ground.grass, 0.18);
    const dark = s.snow > 0.5 ? '#b8c4cc' : shade(ground.grass, -0.25);
    for (let i = 0; i < 260; i++) {
      const x = landX0 + tr.next() * (W - landX0);
      const y = landTop(x) + tr.next() ** 0.7 * (H - landTop(x));
      const len = 4 + ((y - horizon) / (H - horizon)) * 14;
      strokes.push(path(`M${n2(x)} ${n2(y)}l${n2(tr.jitter(3))} ${n2(-len)}`, { stroke: tr.chance(0.5) ? light : dark, 'stroke-width': n2(1 + (y - horizon) / 300), opacity: '0.45' }));
    }
    body.push(g({ 'clip-path': `url(#${clip})` }, strokes));
  }

  // Building slots: a back row (smaller, hazier) and a front row.
  const count = Math.max(2, Math.round(TIER_COUNT[p.tier] * ECON_MULT[p.economy]));
  const r = s.rng.fork('layout');
  const natMin = terrain === 'plain' ? 160 : landX0 + 300;
  const focusX = p.focus === undefined ? undefined : p.focus * W;
  const xMin = focusX === undefined ? natMin : Math.max(natMin, focusX - 420);
  const xMax = focusX === undefined ? W - 80 : Math.min(W - 80, Math.max(xMin + 500, focusX + 420));
  const bo = (k: number): BuildOpts => ({ k, lit: s.lit, ruined, snow: s.snow, rng: r, accent: pal.primary, wealth });
  const back: string[] = [];
  const front: string[] = [];
  const smokes: string[] = [];
  const centre = focusX ?? (xMin + xMax) / 2 + r.jitter(80);

  // A track from the strand (or the near edge of the steppe) up to the chief building.
  {
    const ax = terrain === 'plain' ? W * 0.45 : terrain === 'river' ? landX0 + 200 : shoreX(770) + 70;
    const ay = terrain === 'plain' ? H + 20 : 790;
    const bx = centre + 20;
    const by = groundY(centre) + 16;
    const c1x = ax + 140;
    const c1y = ay - 70;
    const c2x = bx - 60;
    const c2y = by + 70;
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const u = 1 - t;
      const x = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
      const y = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by;
      const half = 26 * (1 - t) + 6 * t;
      left.push(x - half, y + half * 0.25);
      right.push(x + half, y - half * 0.25);
    }
    let d = `M${n2(left[0] as number)} ${n2(left[1] as number)}`;
    for (let i = 2; i < left.length; i += 2) d += `L${n2(left[i] as number)} ${n2(left[i + 1] as number)}`;
    for (let i = right.length - 2; i >= 0; i -= 2) d += `L${n2(right[i] as number)} ${n2(right[i + 1] as number)}`;
    const trackCol = s.snow > 0.5 ? '#c8cfd2' : mix(ground.earth, '#c8b48a', 0.25);
    body.push(path(`${d}Z`, { fill: trackCol, opacity: '0.85' }));
    body.push(path(`${d}Z`, { fill: 'none', stroke: shade(trackCol, -0.25), 'stroke-width': 1.5, opacity: '0.35' }));
  }

  // Sheep grazing below the settlement (not in winter, on the steppe or in the far north).
  if (!ruined && p.season !== 'winter' && terrain !== 'plain' && s.group !== 'far') {
    const sr = s.rng.fork('sheep');
    const flock = Math.round({ ruined: 0, destitute: 1, poor: 3, fair: 6, thriving: 8 }[p.economy] * (p.tier === 'city' || p.tier === 'capital' ? 0.6 : 1));
    const fx = sr.range(Math.max(shoreX(780) + 260, xMin), Math.max(shoreX(780) + 300, xMax - 260));
    const sheep: string[] = [];
    for (let i = 0; i < flock; i++) {
      const x = fx + sr.jitter(130);
      const y = Math.min(H - 70, groundY(x) + 150 + sr.range(0, 90));
      const k = 0.9 + (y - 700) / 260;
      const wool = shade('#e6dfcf', sr.range(-0.12, 0.04));
      const dir = sr.chance(0.5) ? 1 : -1;
      sheep.push(g({}, [
        line(x - 5 * k, y, x - 5 * k, y + 5 * k, { stroke: '#2a2420', 'stroke-width': n2(1.4 * k) }),
        line(x + 5 * k, y, x + 5 * k, y + 5 * k, { stroke: '#2a2420', 'stroke-width': n2(1.4 * k) }),
        ellipse(x, y - 2 * k, 10 * k, 6.5 * k, { fill: wool }),
        ellipse(x + dir * 10 * k, y - 1 * k, 3.4 * k, 2.6 * k, { fill: '#2e2620' }),
      ]));
    }
    body.push(g({}, sheep));
  }

  // Window lights are collected while the buildings are drawn and re-drawn above the night overlay.
  const walls: string[] = [];
  const litLayer = withLights(() => {
    // Fortifications (drawn between the back and front rows, so the town sits inside them).
    const fortified = p.tier === 'town' || p.tier === 'city' || p.tier === 'capital' || p.tier === 'fortress';
    if (p.tier === 'fortress') {
      if (style === 'corvani' || style === 'saraleon') walls.push(stoneWall(s, centre - 300, centre + 300, groundY(centre) + 30, 90, 1.3, style === 'saraleon'));
      else back.push(hillFort(s, centre, groundY(centre) + 6, 1.5));
    } else if (fortified) {
      const wy = groundY(centre) + 34;
      const span = p.tier === 'town' ? 340 : 520;
      const x0w = Math.max(landX0 + 260, centre - span);
      const x1w = Math.min(W + 20, centre + span);
      if (style === 'corvani' || style === 'saraleon') walls.push(stoneWall(s, x0w, x1w, wy, p.tier === 'town' ? 56 : 78, 1.25, style === 'saraleon' && p.tier !== 'town'));
      else if (style === 'albric') walls.push(palisade(s, x0w, x1w, wy + 12, 1.3, true));
      else if (style !== 'steppe' && style !== 'rime') walls.push(palisade(s, x0w, x1w, wy, 1.3, false));
    }

    // Back row dwellings (behind the walls) and the landmark.
    const backN = Math.ceil(count * 0.55);
    for (let i = 0; i < backN; i++) {
      const x = xMin + ((xMax - xMin) * (i + 0.5)) / backN + r.jitter(30);
      const y = groundY(x) - 14 - r.range(0, 18);
      back.push(dwelling(style, x, y, bo(1)));
      if (!ruined && r.chance(0.35)) smokes.push(smoke(s, x + r.jitter(10), y - 50, 120, false, `bs${i}`));
    }
    back.push(landmark(style, p.tier, centre, groundY(centre) + 2, bo(1.3)));
    if (p.tier === 'templeStead') {
      for (let i = 0; i < 5; i++) back.push(tree(s, style === 'steppe' ? 'north' : style, centre - 200 + i * 40 + r.jitter(10), groundY(centre) - 10, 120 + r.range(0, 60)));
    }

    // Front row.
    const frontN = count - backN;
    for (let i = 0; i < frontN; i++) {
      const x = xMin + 40 + ((xMax - xMin - 80) * (i + 0.5)) / Math.max(1, frontN) + r.jitter(40);
      const y = groundY(x) + 60 + r.range(0, 34);
      front.push(dwelling(style, x, y, bo(1.35)));
      if (!ruined && r.chance(0.3)) smokes.push(smoke(s, x + r.jitter(10), y - 60, 140, false, `fs${i}`));
    }
    if (p.tier === 'emporium' || (p.economy === 'thriving' && p.tier !== 'hamlet')) {
      for (let i = 0; i < (p.tier === 'emporium' ? 6 : 3); i++) {
        const x = xMin + 60 + r.next() * (xMax - xMin - 200);
        front.push(stall(x, groundY(x) + 110 + r.range(0, 20), bo(1.5)));
      }
    }
    if (ruined) for (let i = 0; i < 5; i++) {
      const x = xMin + r.next() * (xMax - xMin);
      smokes.push(smoke(s, x, groundY(x) - 30, 260 + r.range(0, 120), true, `rs${i}`));
    }

    return '';
  }).lights;

  // Trees around the edges.
  const trees: string[] = [];
  for (let i = 0; i < 10; i++) {
    const x = r.chance(0.5) ? xMax - r.range(0, 160) : xMin + r.range(-80, 80);
    trees.push(tree(s, style, x, groundY(x) - 10 + r.range(-6, 10), 70 + r.range(0, 60)));
  }

  body.push(g({ opacity: '0.95' }, trees.slice(0, 5)));
  body.push(g({}, back));
  body.push(rect(0, 0, W, H, { fill: s.sky.haze, opacity: '0.08' }));
  body.push(g({}, walls));
  body.push(g({}, smokes));
  body.push(g({}, front));
  body.push(g({}, trees.slice(5)));

  // Ships drawn up on the strand: bows on the shingle, sterns in the water, nearer ones lower and
  // larger; on a coast or fjord one more may ride at anchor further out.
  if (terrain !== 'plain') {
    const ships = ruined ? 0 : Math.max(0, Math.round((p.tier === 'emporium' ? 6 : p.tier === 'hamlet' ? 1 : p.tier === 'fortress' || p.tier === 'cloister' ? 1 : 3) * ECON_MULT[p.economy]));
    if (terrain === 'river') {
      for (let i = 0; i < ships; i++) {
        const x = 120 + i * 150 + r.jitter(20);
        body.push(shipSide(x, 760 + r.range(-10, 30), r.range(150, 210), p.culture, { flip: r.chance(0.5), sail: 'furled', shields: p.culture !== 'albric' && p.culture !== 'corvani' }));
      }
    } else {
      const beached = Math.min(ships, 3);
      for (let i = 0; i < beached; i++) {
        const y = 662 + i * (beached > 3 ? 40 : 52) + r.range(-5, 5);
        const len = r.range(150, 195) * (1 + (y - 662) / 420);
        const bow = shoreX(y - 6) + len * 0.06;
        body.push(shipSide(bow - len / 2, y, len, p.culture, { sail: r.chance(0.15) ? 'set' : 'furled', shields: p.culture !== 'albric' && p.culture !== 'corvani' }));
      }
      for (let i = beached; i < ships; i++) {
        const y = 640 + (i - beached) * 22 + r.range(-6, 6);
        const len = r.range(120, 160);
        body.push(shipSide(shoreX(y) - 260 - (i - beached) * 170 + r.jitter(30), y, len, p.culture, { flip: r.chance(0.5), sail: r.chance(0.5) ? 'set' : 'furled', shields: false }));
      }
      if (ruined) body.push(path(`M${n2(shoreX(700) - 160)} 720l120 -30l40 22l-150 20Z`, { fill: '#1a1410', opacity: '0.8' }));
      if (!ruined) {
        for (let i = 0; i < 6; i++) {
          const y = 690 + r.range(0, 70);
          body.push(figure(shoreX(y) + r.range(24, 150), y, 24 + (y - 690) * 0.08, '#1a140e', { spear: r.chance(0.3), cloak: r.pick(pal.cloth) }));
        }
      }
    }
  } else if (!ruined) {
    for (let i = 0; i < 7; i++) {
      const x = 200 + r.next() * 1200;
      body.push(path(`M${x} ${groundY(x) + 120}c10 -14 30 -14 40 0v14h-6v-8h-28v8h-6z`, { fill: shade('#5a3e26', r.range(-0.3, 0.2)) }));
    }
  }

  // Foreground framing: dark banks, rocks and tufts.
  const fg = shade(ground.grassDark, -0.45);
  {
    const fr = s.rng.fork('fg');
    for (let i = 0; i < 9; i++) {
      const x = fr.chance(0.5) ? fr.range(-20, 360) : fr.range(W - 380, W + 20);
      const y = H - fr.range(10, 60);
      const w = fr.range(26, 70);
      body.push(path(`M${n2(x - w)} ${n2(y + 20)}Q${n2(x - w * 0.8)} ${n2(y - w * 0.5)} ${n2(x)} ${n2(y - w * 0.55)}Q${n2(x + w * 0.9)} ${n2(y - w * 0.4)} ${n2(x + w)} ${n2(y + 20)}Z`, { fill: shade('#6a665c', fr.range(-0.35, 0)), opacity: '0.95' }));
    }
  }
  body.push(path(`M-20 ${H}V${H - 70}Q120 ${H - 110} 260 ${H - 60}Q340 ${H - 30} 420 ${H}Z`, { fill: fg, opacity: '0.9' }));
  body.push(path(`M${W + 20} ${H}V${H - 90}Q${W - 150} ${H - 130} ${W - 300} ${H - 50}Q${W - 360} ${H - 20} ${W - 420} ${H}Z`, { fill: fg, opacity: '0.9' }));

  // Light, grading and paint.
  body.push(lightOverlay(s, horizon));
  if (s.lit && litLayer) body.push(g({ style: 'mix-blend-mode:screen' }, litLayer));
  if (ruined) body.push(rect(0, 0, W, H, { fill: '#3a2a20', style: 'mix-blend-mode:multiply', opacity: '0.4' }));
  if (p.economy === 'destitute') body.push(rect(0, 0, W, H, { fill: '#8a8478', style: 'mix-blend-mode:saturation', opacity: '0.35' }));
  if (p.economy === 'thriving') body.push(rect(0, 0, W, H, { fill: '#f0c070', style: 'mix-blend-mode:soft-light', opacity: '0.25' }));
  s.defs.push(grainFilter('pn-grain', p.seed, 0.8, 0.2), mottleFilter('pn-mottle', p.seed, 0.006), vignetteGradient('pn-vig', 0.5));
  body.push(rect(0, 0, W, H, { filter: 'url(#pn-mottle)', opacity: '0.25', style: 'mix-blend-mode:multiply' }));
  body.push(rect(0, 0, W, H, { filter: 'url(#pn-grain)', opacity: '0.7', style: 'mix-blend-mode:multiply' }));
  body.push(rect(0, 0, W, H, { fill: 'url(#pn-vig)' }));

  const width = opts.width ?? W;
  const height = opts.height ?? H;
  if (opts.watermark && opts.watermark !== 'off') body.push(g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark)));
  return svgDoc({ width, height, viewBox: [0, 0, W, H], defs: [...sceneDefs(), ...s.defs], body, preserveAspectRatio: 'xMidYMid slice' });
}

/** Reads generator params into PanoramaParams. */
/** Named views accepted as `scene` (manifest shorthand); explicit params still win. */
export const PANORAMA_SCENES: Readonly<Record<string, GeneratorParams>> = {
  nightFjord: { culture: 'skarn', terrain: 'fjord', tier: 'village', time: 'night', season: 'winter' },
  homeHallDusk: { culture: 'skarn', terrain: 'fjord', tier: 'capital', economy: 'thriving', time: 'dusk', focus: 0.56 },
  homeHall: { culture: 'skarn', terrain: 'fjord', tier: 'capital', economy: 'fair' },
  burningTown: { culture: 'albric', tier: 'town', economy: 'ruined', time: 'night' },
  goldenCity: { culture: 'saraleonese', tier: 'capital', economy: 'thriving', time: 'dusk' },
  riverFort: { culture: 'velkar', tier: 'fortress', terrain: 'river' },
  steppeCamp: { culture: 'kurgai', tier: 'village', terrain: 'plain' },
};

export function panoramaParamsFrom(input: GeneratorParams): PanoramaParams {
  const sceneKey = typeof input.scene === 'string' && Object.hasOwn(PANORAMA_SCENES, input.scene) ? input.scene : undefined;
  const params: GeneratorParams = sceneKey ? { ...PANORAMA_SCENES[sceneKey], ...input } : input;
  const culture = oneOf(params, 'culture', ALL_CULTURES, 'skarn');
  const terrain = oneOf(params, 'terrain', TERRAINS, 'auto');
  return {
    culture,
    tier: oneOf(params, 'tier', TIERS, 'village'),
    economy: oneOf(params, 'economy', ECONOMIES, 'fair'),
    season: oneOf(params, 'season', SEASONS, 'summer'),
    time: oneOf(params, 'time', TIMES_OF_DAY, 'day'),
    terrain: terrain === 'auto' ? defaultTerrain(culture) : terrain,
    seed: seedOf(params, `${culture}`),
    ...(typeof params.focus === 'number' || typeof params.focus === 'string' ? { focus: num(params, 'focus', 0.6, 0.3, 0.8) } : {}),
  };
}

export const panoramaGenerator: ImageGenerator = {
  id: 'panorama',
  kind: 'image',
  defaultSize: PANORAMA_SIZE,
  params: [
    { name: 'culture', type: 'enum', values: ALL_CULTURES, default: 'skarn' },
    { name: 'tier', type: 'enum', values: TIERS, default: 'village' },
    { name: 'economy', type: 'enum', values: ECONOMIES, default: 'fair' },
    { name: 'season', type: 'enum', values: SEASONS, default: 'summer' },
    { name: 'time', type: 'enum', values: TIMES_OF_DAY, default: 'day' },
    { name: 'terrain', type: 'enum', values: TERRAINS, default: 'auto' },
    { name: 'seed', type: 'number', note: 'settlement id hash: same seed, same town' },
    { name: 'scene', type: 'enum', values: Object.keys(PANORAMA_SCENES), note: 'named view preset; explicit params win' },
    { name: 'focus', type: 'number', note: 'settlement centre as a fraction of the width (0.3..0.8), for views shown centre-cropped' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return panoramaSvg(panoramaParamsFrom(params), { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label });
  },
  finalFilter(params: GeneratorParams): string | undefined {
    const f = gradingFilter(oneOf(params, 'season', SEASONS, 'summer'), oneOf(params, 'time', TIMES_OF_DAY, 'day'));
    return f === 'none' ? undefined : f;
  },
  variants(): GeneratorParams[] {
    const out: GeneratorParams[] = [];
    const sets: [CultureId, SettlementTierId, EconomyStateId][] = [
      ['skarn', 'village', 'fair'],
      ['skarn', 'capital', 'thriving'],
      ['hvarn', 'town', 'poor'],
      ['eyjar', 'emporium', 'thriving'],
      ['albric', 'town', 'fair'],
      ['albric', 'city', 'thriving'],
      ['cael', 'cloister', 'fair'],
      ['cael', 'village', 'destitute'],
      ['corvani', 'city', 'thriving'],
      ['corvani', 'fortress', 'fair'],
      ['saraleonese', 'capital', 'thriving'],
      ['velkar', 'town', 'fair'],
      ['kurgai', 'village', 'fair'],
      ['rime', 'hamlet', 'poor'],
      ['isafolder', 'village', 'fair'],
      ['skarn', 'town', 'ruined'],
    ];
    for (const [culture, tier, economy] of sets) out.push({ culture, tier, economy, seed: 7 });
    for (const season of SEASONS) for (const time of TIMES_OF_DAY) out.push({ culture: 'skarn', tier: 'town', economy: 'fair', season, time, seed: 3 });
    return out;
  },
};

