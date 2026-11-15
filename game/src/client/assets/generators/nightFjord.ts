/**
 * The title painting (`menuBackdrop` / vignette scene `nightFjord`): a longship under a square sail
 * crossing a moonlit fjord in winter, under curtains of northern lights. Layered fjord walls with
 * moonlit snow on their ridges, reflections, a moon path on the water, the lights of a distant
 * steading at the head of the fjord, and a dark shore with spruce in the foreground.
 *
 * Composed in the 1200×675 vignette frame (16:9, sliced to any size). Night light is painted
 * directly (no ambient overlay), so the moon, the aurora and the window lights keep their glow.
 */
import type { CultureId } from '@content/schemas/ids';
import { circle, el, ellipse, g, line, linearGradient, n, n2, path, polygon, radialGradient, rect, smoothOpen } from '../svg/svg';
import { mix } from '../svg/palette';
import type { ArtRng } from '../svg/rng';
import { mountains, shipSide, uid, type Scene } from './scene';

/** Smooth 0→1 step. */
function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** A closed cliff mass: `top` points left→right, then the foot (shoreline) right→left. */
function cliffPath(top: readonly number[], foot: readonly number[]): string {
  let d = smoothOpen(top, 0.5);
  for (let i = 0; i + 1 < foot.length; i += 2) d += `L${n(foot[i] as number)} ${n(foot[i + 1] as number)}`;
  return `${d}Z`;
}

/**
 * Samples a fjord-wall ridge from (x0, yHigh) falling to (x1, yLow) (or rising, when x0 > x1),
 * with a plateau, a steep drop and jagged crags.
 */
function wallTop(r: ArtRng, x0: number, x1: number, yHigh: number, yLow: number, steep: number): number[] {
  const pts: number[] = [];
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const fall = smooth((t - 0.15) / 0.85) ** steep;
    const crag = i === 0 || i === steps ? 0 : r.jitter(9) + (r.chance(0.18) ? -r.range(6, 18) : 0);
    pts.push(x, yHigh + (yLow - yHigh) * fall + crag * (1 - fall * 0.7));
  }
  return pts;
}

interface Cliff {
  d: string;
  top: number[];
}

function cliff(r: ArtRng, from: { x: number; y: number }, to: { x: number; y: number }, steep: number, foot: readonly number[]): Cliff {
  const top = wallTop(r, from.x, to.x, from.y, to.y, steep);
  return { d: cliffPath(top, foot), top };
}

/** Paints one cliff layer: body gradient, moonlit snow on the ridge and in gullies, rim light. */
function paintCliff(s: Scene, c: Cliff, body: string, snow: string, key: string, litFromRight: boolean, gullies = 0.3): string {
  const gid = uid(s, 'nfc');
  s.defs.push(linearGradient(gid, [[0, mix(body, '#3a4a64', 0.25)], [0.55, body], [1, mix(body, '#000000', 0.45)]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  const clip = uid(s, 'nfk');
  s.defs.push(el('clipPath', { id: clip }, path(c.d)));
  const r = s.rng.fork(key);
  const out: string[] = [path(c.d, { fill: `url(#${gid})` })];
  const snowParts: string[] = [];
  // A snow band along the ridge (thick stroke of the ridge line, clipped to the mass).
  snowParts.push(path(smoothOpen(c.top, 0.5), { fill: 'none', stroke: snow, 'stroke-width': 9, opacity: '0.32' }));
  // Gullies: tapering streaks running down from the ridge.
  for (let i = 2; i + 1 < c.top.length - 2; i += 2) {
    if (!r.chance(gullies)) continue;
    const x = c.top[i] as number;
    const y = c.top[i + 1] as number;
    const len = r.range(30, 70 + 70 * gullies * 3);
    const lean = (litFromRight ? 1 : -1) * r.range(4, 22);
    const wTop = r.range(5, 11);
    snowParts.push(path(`M${n(x - wTop)} ${n(y + 1)}Q${n(x + lean * 0.3 - wTop * 0.4)} ${n(y + len * 0.5)} ${n(x + lean)} ${n(y + len)}Q${n(x + lean * 0.5 + wTop * 0.3)} ${n(y + len * 0.4)} ${n(x + wTop)} ${n(y + 1)}Z`, { fill: snow, opacity: n2(r.range(0.12, 0.24)) }));
  }
  // Ledges: short snow strokes across the face.
  for (let i = 0; i < 9; i++) {
    const k = 2 * r.int(1, Math.floor(c.top.length / 2) - 2);
    const x = (c.top[k] as number) + r.jitter(30);
    const y = (c.top[k + 1] as number) + r.range(20, 120);
    snowParts.push(line(x, y, x + r.range(10, 28) * (litFromRight ? 1 : -1), y + r.range(2, 7), { stroke: snow, 'stroke-width': n(r.range(1.2, 2.4)), opacity: '0.18', 'stroke-linecap': 'round' }));
  }
  out.push(g({ 'clip-path': `url(#${clip})` }, snowParts));
  // Moon rim along the ridge.
  out.push(path(smoothOpen(c.top, 0.5), { fill: 'none', stroke: mix(snow, '#ffffff', 0.4), 'stroke-width': 1.6, opacity: litFromRight ? '0.4' : '0.22' }));
  return g({}, out);
}

/** A dark spruce silhouette with moonlit snow on the boughs. */
function spruce(x: number, y: number, h: number, r: ArtRng): string {
  const tiers = 7;
  const out: string[] = [rect(x - h * 0.02, y - h * 0.12, h * 0.04, h * 0.14, { fill: '#04070a' })];
  let d = `M${n(x)} ${n(y - h)}`;
  const right: number[] = [];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    const ty = y - h + h * 0.9 * t;
    const w = h * (0.05 + 0.27 * t) * r.range(0.85, 1.12);
    right.push(x + w, ty, x + w * 0.35, ty - h * 0.03);
  }
  for (let i = 0; i < right.length; i += 2) d += `L${n(right[i] as number)} ${n(right[i + 1] as number)}`;
  d += `L${n(x)} ${n(y - h * 0.08)}`;
  for (let i = right.length - 2; i >= 0; i -= 2) d += `L${n(2 * x - (right[i] as number))} ${n(right[i + 1] as number)}`;
  out.push(path(`${d}Z`, { fill: '#05090d' }));
  for (let i = 0; i < right.length; i += 4) {
    const bx = right[i] as number;
    const by = right[i + 1] as number;
    for (const side of [-1, 1]) out.push(path(`M${n(x + side * (bx - x) * 0.45)} ${n(by - h * 0.03)}L${n(x + side * (bx - x) * 0.8)} ${n(by - h * 0.012)}`, { stroke: '#8c9cb4', 'stroke-width': n(Math.max(1, h * 0.01)), opacity: side > 0 ? '0.24' : '0.1', 'stroke-linecap': 'round' }));
  }
  return g({}, out);
}

/** Northern lights: curtains of vertical rays with a bright lower hem, blurred together. */
function aurora(s: Scene, r: ArtRng): string {
  const { W } = s;
  const gid = uid(s, 'aurg');
  s.defs.push(linearGradient(gid, [[0, '#8a6ad0', 0], [0.45, '#3fd69a', 0.22], [0.86, '#72f2b6', 0.62], [1, '#c8ffe0', 0.85]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  const fid = uid(s, 'aurf');
  s.defs.push(el('filter', { id: fid, x: '-10%', y: '-30%', width: '120%', height: '160%' }, el('feGaussianBlur', { stdDeviation: '5 3' })));
  const curtains: string[] = [];
  const specs = [
    { base: 205, amp: 46, f: 0.0042, ph: r.range(0, 6), h: 150, alpha: 0.9, x0: -40, x1: W * 0.86 },
    { base: 150, amp: 34, f: 0.0061, ph: r.range(0, 6), h: 110, alpha: 0.55, x0: W * 0.12, x1: W + 40 },
    { base: 250, amp: 28, f: 0.0075, ph: r.range(0, 6), h: 90, alpha: 0.4, x0: -40, x1: W * 0.55 },
  ];
  for (const sp of specs) {
    for (let x = sp.x0; x < sp.x1; x += 5) {
      const t = (x - sp.x0) / (sp.x1 - sp.x0);
      const env = Math.sin(Math.PI * Math.max(0, Math.min(1, t))) ** 0.7;
      const hem = sp.base + sp.amp * Math.sin(x * sp.f + sp.ph) + sp.amp * 0.35 * Math.sin(x * sp.f * 2.7 + sp.ph * 1.7);
      const h = sp.h * (0.55 + 0.45 * Math.abs(Math.sin(x * 0.019 + sp.ph))) * r.range(0.8, 1.15);
      curtains.push(rect(x, hem - h, 5.6, h, { fill: `url(#${gid})`, opacity: n2(sp.alpha * env * r.range(0.55, 1)) }));
    }
  }
  return g({ filter: `url(#${fid})`, style: 'mix-blend-mode:screen' }, curtains);
}

/**
 * Draws the scene (sky to foreground) into markup. `s` must be a night scene; its defs collect the
 * gradients and filters used here.
 */
export function nightFjordScene(s: Scene, culture: CultureId): string {
  const { W, H } = s;
  const water = 404;
  const r = s.rng.fork('nightFjord');
  const out: string[] = [];

  // Sky.
  const skyId = uid(s, 'nfs');
  s.defs.push(linearGradient(skyId, [[0, '#04070f'], [0.45, '#0b1424'], [0.82, '#1b2a42'], [1, '#2a3a54']], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  out.push(rect(0, 0, W, water + 20, { fill: `url(#${skyId})` }));
  const sr = r.fork('stars');
  const stars: string[] = [];
  for (let i = 0; i < 260; i++) {
    const big = sr.chance(0.06);
    stars.push(circle(sr.next() * W, sr.next() ** 1.3 * water * 0.95, big ? sr.range(1.2, 1.9) : sr.range(0.4, 1.1), { fill: sr.chance(0.2) ? '#dfe8ff' : '#f6f1e2', opacity: n2(sr.range(0.3, 0.95)) }));
  }
  out.push(g({}, stars));
  out.push(aurora(s, r.fork('aurora')));

  // Moon above the head of the fjord.
  const mx = W * 0.7;
  const my = 118;
  const halo = uid(s, 'nfh');
  const disc = uid(s, 'nfm');
  s.defs.push(radialGradient(halo, [[0, '#dfe6f4', 0.42], [0.25, '#b8c6e0', 0.14], [1, '#b8c6e0', 0]]));
  s.defs.push(radialGradient(disc, [[0, '#fffdf4'], [0.7, '#efeadb'], [1, '#cfc8b4']], { cx: 0.42, cy: 0.4, r: 0.7 }));
  out.push(circle(mx, my, 170, { fill: `url(#${halo})` }), circle(mx, my, 21, { fill: `url(#${disc})` }));
  out.push(circle(mx - 6, my - 4, 4.5, { fill: '#c4bead', opacity: '0.5' }), circle(mx + 6, my + 6, 3.4, { fill: '#c4bead', opacity: '0.45' }), circle(mx + 3, my - 9, 2, { fill: '#c4bead', opacity: '0.4' }));

  // Far range at the head of the fjord, then the walls (far layer pale with haze, near layer dark).
  const farTone = uid(s, 'nft');
  s.defs.push(el('filter', { id: farTone, 'color-interpolation-filters': 'sRGB' }, el('feColorMatrix', { type: 'matrix', values: '0.5 0 0 0 0.04  0 0.52 0 0 0.06  0 0 0.6 0 0.1  0 0 0 1 0' })));
  const far = g({ filter: `url(#${farTone})` }, mountains(s, 'nfFar', water + 4, 150, '#3a4a64', { peaks: 8, rough: 0.12, snowLine: 0.5, haze: 0.22 }));
  const midL = cliff(r.fork('midL'), { x: -40, y: 170 }, { x: 660, y: water + 2 }, 1.3, [660, water + 3, -40, water + 3]);
  const midR = cliff(r.fork('midR'), { x: 900, y: water + 2 }, { x: W + 40, y: 228 }, 0.8, [W + 40, water + 3, 900, water + 3]);
  const nearL = cliff(r.fork('nearL'), { x: -40, y: 62 }, { x: 520, y: water + 16 }, 1.6, [520, water + 16, 400, 432, 240, 458, 90, 486, -40, 500]);
  const nearR = cliff(r.fork('nearR'), { x: 1010, y: water + 30 }, { x: W + 40, y: 150 }, 0.5, [W + 40, 500, 1150, 482, 1070, 458, 1010, water + 30]);
  const backdrop = [
    far,
    paintCliff(s, midL, '#1c2a3e', '#9eb0c8', 'nfMidL', true, 0.2),
    paintCliff(s, midR, '#18253a', '#8a9cb6', 'nfMidR', false, 0.2),
  ];
  out.push(...backdrop);

  // Distant steading at the head of the fjord: a few warm lights at the waterline.
  const lights: string[] = [];
  const lightRefl: string[] = [];
  const lr = r.fork('lights');
  for (let i = 0; i < 6; i++) {
    const x = 760 + lr.range(-40, 50);
    const y = water - lr.range(1, 6);
    lights.push(circle(x, y, lr.range(4, 7), { fill: '#ffb050', opacity: '0.35', filter: 'url(#sc-glow)' }), circle(x, y, lr.range(0.9, 1.5), { fill: '#ffe0a0' }));
    lightRefl.push(rect(x - 0.7, water + 4, 1.4, lr.range(10, 22), { fill: '#ffc870', opacity: '0.35' }));
  }

  // Water: reflections of the far scene, a moon path, ripples and a mist band.
  const wid = uid(s, 'nfw');
  s.defs.push(linearGradient(wid, [[0, '#1c2c44'], [0.4, '#111d30'], [1, '#05080f']], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  out.push(rect(0, water, W, H - water, { fill: `url(#${wid})` }));
  const below = uid(s, 'nfb');
  s.defs.push(el('clipPath', { id: below }, rect(0, water, W, H - water)));
  const blur = uid(s, 'nfbl');
  s.defs.push(el('filter', { id: blur, x: '-5%', y: '-5%', width: '110%', height: '110%' }, el('feGaussianBlur', { stdDeviation: '3 1.6' })));
  out.push(g({ 'clip-path': `url(#${below})` }, g({ transform: `translate(0 ${2 * water}) scale(1 -1)`, opacity: '0.3', filter: `url(#${blur})` }, backdrop)));
  out.push(g({}, lightRefl));
  const gr = r.fork('glitter');
  const glitter: string[] = [];
  for (let i = 0; i < 150; i++) {
    const f = gr.next() ** 1.25;
    const y = water + 6 + f * (H - water - 6);
    const spread = 14 + f * 150;
    const w = (4 + gr.range(0, 26)) * (0.6 + f * 1.4);
    const x = mx + gr.jitter(spread) - w / 2;
    glitter.push(rect(x, y, w, 1 + f * 1.8, { rx: 0.8, fill: gr.chance(0.3) ? '#fff6dc' : '#d8e2f2', opacity: n2((0.85 - f * 0.45) * gr.range(0.35, 1)) }));
  }
  const glow = uid(s, 'nfg');
  s.defs.push(linearGradient(glow, [[0, '#e8eef8', 0.3], [1, '#e8eef8', 0]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  out.push(ellipse(mx, water + 120, 60, 130, { fill: `url(#${glow})`, filter: 'url(#sc-soft)' }));
  out.push(g({}, glitter));
  const rr = r.fork('ripples');
  for (let i = 0; i < 60; i++) {
    const f = rr.next() ** 1.4;
    const y = water + 8 + f * (H - water - 8);
    const x = rr.next() * W;
    out.push(line(x, y, x + rr.range(20, 90) * (0.5 + f), y, { stroke: '#8ea4c4', 'stroke-opacity': n2(rr.range(0.05, 0.16)), 'stroke-width': n2(0.8 + f * 1.4) }));
  }
  out.push(g({}, lights));
  const mist = uid(s, 'nfmi');
  s.defs.push(linearGradient(mist, [[0, '#9fb2cc', 0], [0.5, '#9fb2cc', 0.22], [1, '#9fb2cc', 0]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  out.push(rect(0, water - 22, W, 50, { fill: `url(#${mist})` }));

  // Near walls (over the water, their feet curving toward the viewer).
  out.push(paintCliff(s, nearL, '#0f1828', '#7d8fa8', 'nfNearL', true, 0.12));
  out.push(paintCliff(s, nearR, '#0d1524', '#6c7e98', 'nfNearR', false, 0.12));

  // The longship crossing the moon path (bow to the right), with its reflection and wake.
  const shipX = mx - 40;
  const shipY = 512;
  const len = 290;
  const k = len / 200;
  const night = uid(s, 'nfn');
  s.defs.push(el('filter', { id: night, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' }, el('feColorMatrix', { type: 'matrix', values: '0.36 0.04 0.04 0 0.01  0.04 0.4 0.06 0 0.02  0.06 0.08 0.52 0 0.05  0 0 0 1 0' })));
  const ship = shipSide(shipX, shipY, len, culture, { sail: 'set' });
  const shipClip = uid(s, 'nfsc');
  s.defs.push(el('clipPath', { id: shipClip }, rect(0, shipY + 6 * k, W, H)));
  out.push(g({ 'clip-path': `url(#${shipClip})` }, g({ transform: `translate(0 ${n(2 * (shipY + 6 * k))}) scale(1 -1)`, opacity: '0.28', filter: `url(#${blur})` }, g({ filter: `url(#${night})` }, ship))));
  const wake: string[] = [];
  for (let i = 0; i < 3; i++) {
    const y = shipY + 8 * k + i * 6;
    wake.push(path(`M${n(shipX - len * 0.42)} ${n(y)}Q${n(shipX - len * 0.62)} ${n(y + 4 + i * 5)} ${n(shipX - len * (0.8 + i * 0.08))} ${n(y + 10 + i * 14)}`, { fill: 'none', stroke: '#c8d6ec', 'stroke-width': n2(1.4 - i * 0.3), opacity: n2(0.26 - i * 0.07), 'stroke-linecap': 'round' }));
  }
  out.push(g({}, wake));
  out.push(g({ filter: `url(#${night})` }, ship));
  // Moonlight catching the sail's upper edge and the bow.
  out.push(path(`M${n(shipX - 48 * k)} ${n(shipY - 22 * k - 104 * k)}H${n(shipX + 48 * k)}Q${n(shipX + 56 * k)} ${n(shipY - 22 * k - 62 * k)} ${n(shipX + 46 * k)} ${n(shipY - 22 * k - 24 * k)}`, { fill: 'none', stroke: '#dfe6f2', 'stroke-width': 1.4, opacity: '0.45' }));
  out.push(path(`M${n(shipX - 46 * k)} ${n(shipY - 24 * k)}Q${n(shipX)} ${n(shipY - 20 * k)} ${n(shipX + len / 2)} ${n(shipY - 22 * k)}`, { fill: 'none', stroke: '#dfe6f2', 'stroke-width': 1.2, opacity: '0.3' }));

  // Foreground: a dark rocky shore with spruce (left) and a boulder (right).
  out.push(path(`M-40 ${n(H + 20)}L-40 560Q30 538 96 548Q170 560 222 590Q276 622 318 656L360 ${n(H + 20)}Z`, { fill: '#05080c' }));
  out.push(path('M-40 560Q30 538 96 548Q170 560 222 590Q276 622 318 656', { fill: 'none', stroke: '#6a7c96', 'stroke-width': 1.4, opacity: '0.35' }));
  const fr = r.fork('spruce');
  for (const [x, y, h] of [
    [28, 556, 210],
    [76, 552, 168],
    [-8, 566, 250],
    [128, 560, 132],
    [176, 574, 96],
  ] as const) {
    out.push(spruce(x, y, h * fr.range(0.92, 1.08), fr));
  }
  out.push(polygon([W - 330, H + 20, W - 250, 646, W - 170, 622, W - 80, 616, W + 40, 600, W + 40, H + 20], { fill: '#05080c' }));
  out.push(path(`M${W - 250} 646L${W - 170} 622L${W - 80} 616L${W + 40} 600`, { fill: 'none', stroke: '#6a7c96', 'stroke-width': 1.2, opacity: '0.3' }));

  // Cold night grade at the edges.
  const vg = uid(s, 'nfv');
  s.defs.push(radialGradient(vg, [[0.5, '#02040a', 0], [1, '#02040a', 0.55]], { cx: 0.55, cy: 0.42, r: 0.78 }));
  out.push(rect(0, 0, W, H, { fill: `url(#${vg})` }));
  return g({}, out);
}
