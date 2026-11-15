/**
 * `relic` generator: emblems for the sixteen relics of design §21.2 — a carved roundel with an
 * over-under interlace border, a field in the colour of the god the relic's keepers revere, and the
 * object itself in its material (bronze bell, bone harp, iron seed, sailcloth, pearl…). The objects
 * are ordinary things people revere; nothing glows or floats (§4.7).
 */
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { circle, el, g, linearGradient, n, n2, path, radialGradient, svgDoc } from '../svg/svg';
import { CHROME, shade } from '../svg/palette';
import { grainFilter, watermark } from '../svg/paint';
import { ArtRng } from '../svg/rng';
import type { Glyph } from './iconGlyphs';
import { oneOf, seedOf } from './params';

/** The sixteen relic keys (§21.2 order). */
export const RELIC_KEYS = [
  'drownedBell',
  'ravenQuill',
  'anvilShard',
  'oathstone',
  'goldenSheaf',
  'emberCloak',
  'whaleboneHorn',
  'grayQueensComb',
  'sailOfSevenWinds',
  'harpOfHollowBone',
  'ironSeed',
  'firstWolfPelt',
  'moonSilverScales',
  'weepingShield',
  'salthasPearl',
  'highKingsCrown',
] as const;
export type RelicKey = (typeof RELIC_KEYS)[number];

type GodKey = 'valgrim' | 'dunnar' | 'saltha' | 'fjorna' | 'eidr' | 'skell' | 'grayQueen' | 'none';

/** Material ramps [light, mid, dark]. */
const MATERIALS = {
  bronze: ['#e6c27a', '#a8743a', '#4a2c14'],
  gold: ['#fff0a8', '#d4a72c', '#6a4a10'],
  iron: ['#b8bec4', '#5b6066', '#1e2124'],
  stone: ['#c8c4b8', '#7d786c', '#34312b'],
  bone: ['#fbf3df', '#d8c8a2', '#7a6a4a'],
  silver: ['#ffffff', '#c9ccd1', '#5a5e66'],
  cloth: ['#e09a6a', '#9b3a22', '#3a120a'],
  sailcloth: ['#f3e6c8', '#c8b088', '#6a5432'],
  fur: ['#c8a47a', '#7a5636', '#2e1c10'],
  feather: ['#6a7488', '#262a34', '#08090c'],
  wood: ['#c89a5a', '#7a5228', '#2e1c0c'],
  pearl: ['#ffffff', '#e8e2e6', '#8a8290'],
} as const;
type Material = keyof typeof MATERIALS;

const GOD_FIELD: Readonly<Record<GodKey, string>> = {
  valgrim: '#2b3850',
  dunnar: '#5a2420',
  saltha: '#1b4a50',
  fjorna: '#5a5020',
  eidr: '#3a2e4a',
  skell: '#5a2a10',
  grayQueen: '#3a3e44',
  none: '#2a2440',
};

interface RelicDraw {
  god: GodKey;
  material: Material;
  /** Second material for parts drawn in `top` (e.g. the pearl on its shell). */
  accent?: Material;
  glyph: Glyph;
}

const P = (d: string): string => `<path d="${d}"/>`;
const C = (cx: number, cy: number, r: number): string => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`;
const E = (cx: number, cy: number, rx: number, ry: number): string => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"/>`;
const R = (x: number, y: number, w: number, h: number, rx = 0): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''}/>`;
const S = (d: string, w = 2): string => `<path d="${d}" fill="none" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
const SC = (cx: number, cy: number, r: number, w = 1.6): string => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke-width="${n(w)}"/>`;

function grainEars(): string[] {
  const out: string[] = [];
  const ears: [number, number, number][] = [
    [20, 15, -24], [32, 9, 0], [44, 15, 24], [26, 21, -12], [38, 21, 12], [14, 23, -36], [50, 23, 36],
  ];
  for (const [x, y, rot] of ears) out.push(`<ellipse cx="${x}" cy="${y}" rx="3.6" ry="8.5" transform="rotate(${rot} ${x} ${y})"/>`);
  return out;
}

const RELICS: Readonly<Record<RelicKey, RelicDraw>> = {
  drownedBell: {
    god: 'saltha',
    material: 'bronze',
    glyph: {
      cat: 'god',
      f: [P('M32 9Q45 9 46 23L48 40Q50 46 56 48V52H8V48Q14 46 16 40L18 23Q19 9 32 9Z'), C(32, 56, 4)],
      s: [SC(32, 6.5, 4, 3)],
      cut: [S('M17 27H47', 1.6), S('M15 43H49', 1.6), C(24, 33, 1.3), C(40, 36, 1.1), C(36, 20, 1), S('M22 14Q26 11 30 12', 1.6)],
    },
  },
  ravenQuill: {
    god: 'valgrim',
    material: 'feather',
    glyph: {
      cat: 'god',
      f: [P('M53 4Q61 23 48 40Q35 54 11 59Q20 46 28 31Q39 13 53 4Z'), P('M8 56Q10 60 6 62Q4 58 8 56Z')],
      cut: [S('M11 59Q32 36 52 7', 1.6), S('M47 16L39 12M44 24L34 20M39 32L29 29M33 40L24 38M27 46L19 46M50 21L56 23M46 29L53 33M41 37L48 42', 1.2)],
    },
  },
  anvilShard: {
    god: 'dunnar',
    material: 'iron',
    glyph: {
      cat: 'god',
      f: [P('M8 22H40L46 30L42 34L48 44L36 50L30 46L22 54L16 44L20 36L12 30Z')],
      cut: [S('M8 26H38', 1.4), S('M40 22L34 34L38 42', 1.2), S('M22 36L28 30', 1.2)],
    },
  },
  oathstone: {
    god: 'eidr',
    material: 'stone',
    accent: 'iron',
    glyph: {
      cat: 'god',
      // A standing stone with an oath-ring hung through a hole near its crown, and stave-marks cut
      // between two carved bands.
      f: [P('M17 59L13 25Q15 5 33 5Q51 7 51 25L47 59Z')],
      cut: [C(32, 14.5, 3), S('M18 32Q32 28 46 32', 1.4), S('M18 53Q32 49 46 53', 1.4), S('M23 36V48M23 38L26 41M29 36V48M29 42L32 39M35 36V48M35 36L38 39M35 41L38 44M41 36V48M41 44L38 47', 1.5), S('M20 12Q23 8 27 9', 1.2)],
      top: ['<path fill-rule="evenodd" d="M32 12.5A8.5 8.5 0 1 1 31.99 12.5ZM32 15.5A5.5 5.5 0 1 0 32.01 15.5Z"/>'],
    },
  },
  goldenSheaf: {
    god: 'fjorna',
    material: 'gold',
    glyph: {
      cat: 'god',
      f: [...grainEars(), R(25, 38, 14, 6, 2)],
      s: [S('M32 60L20 22M32 60V16M32 60L44 22M32 60L26 28M32 60L38 28M32 60L15 28M32 60L49 28', 2.2)],
      cut: [S('M25 41H39', 1)],
    },
  },
  emberCloak: {
    god: 'skell',
    material: 'cloth',
    accent: 'gold',
    glyph: {
      cat: 'god',
      f: [P('M32 5Q42 5 44 14L55 57Q32 63 9 57L20 14Q22 5 32 5Z')],
      cut: [S('M26 18Q24 36 20 56M38 18Q40 36 44 56M32 22V58', 1.4), P('M9 57Q12 52 15 56Q18 50 21 56Q24 50 27 56Q30 50 33 56Q36 50 39 56Q42 50 45 56Q48 50 51 56Q53 52 55 57Q32 63 9 57Z')],
      top: [C(32, 16, 4)],
    },
  },
  whaleboneHorn: {
    god: 'dunnar',
    material: 'bone',
    accent: 'bronze',
    glyph: {
      cat: 'god',
      f: [P('M4 44Q6 35 15 37Q36 41 49 22L57 11Q61 20 56 29Q43 52 15 51Q5 50 4 44Z')],
      cut: [S('M22 40Q20 45 22 50M33 38Q31 43 33 48M42 33Q40 38 42 42', 1.4), S('M10 39Q8 44 11 49', 1.4)],
      top: [P('M12 38Q16 37 17 40V49Q14 51 11 50Q9 44 12 38Z'), P('M52 17L57 11Q59 15 58 19Z')],
    },
  },
  grayQueensComb: {
    god: 'grayQueen',
    material: 'bone',
    accent: 'silver',
    glyph: {
      cat: 'god',
      f: [P('M8 20Q8 12 16 12H48Q56 12 56 20V30H8Z'), R(8, 29, 48, 23, 2)],
      cut: [S('M12 34V53M16 34V53M20 34V53M24 34V53M28 34V53M32 34V53M36 34V53M40 34V53M44 34V53M48 34V53M52 34V53', 1.6), S('M8 30H56', 1.2), SC(32, 21, 4, 1.4)],
      top: [C(18, 21, 2.2), C(46, 21, 2.2)],
    },
  },
  sailOfSevenWinds: {
    god: 'saltha',
    material: 'sailcloth',
    accent: 'wood',
    glyph: {
      cat: 'god',
      f: [P('M10 12H54Q60 32 52 52H12Q4 32 10 12Z')],
      cut: [S('M16 13Q12 32 17 51M22 13Q19 32 23 51M28 13Q26 32 29 51M36 13Q38 32 35 51M42 13Q45 32 41 51M48 13Q52 32 47 51', 1.8)],
      top: [R(6, 9, 52, 3.4, 1.5), R(30.5, 3, 3, 58)],
    },
  },
  harpOfHollowBone: {
    god: 'valgrim',
    material: 'bone',
    accent: 'wood',
    glyph: {
      cat: 'god',
      f: [P('M15 59V21Q15 6 25 6H39Q49 6 49 21V59Q32 63 15 59Z')],
      cut: [P('M21 22Q21 12 27 12H37Q43 12 43 22V29H21Z'), S('M25 31V54M29 31V55M32 31V55M35 31V55M39 31V54', 1.1), S('M22 44H42', 1.8)],
    },
  },
  ironSeed: {
    god: 'dunnar',
    material: 'iron',
    glyph: {
      cat: 'god',
      f: [P('M32 6Q46 14 47 34Q47 54 32 58Q17 54 17 34Q18 14 32 6Z')],
      cut: [C(26, 26, 2), C(36, 22, 1.6), C(38, 38, 2.4), C(27, 44, 1.8), C(33, 50, 1.4), S('M32 10Q36 30 32 54', 1.2), S('M22 20Q24 16 28 14', 1.8)],
    },
  },
  firstWolfPelt: {
    god: 'valgrim',
    material: 'fur',
    glyph: {
      cat: 'god',
      // A wolf's head worn as a hood, seen from the front, its hide draping down on both sides.
      f: [
        P('M14 3L24.5 15H39.5L50 3L52.5 21Q53 30 46.5 36.5L38.5 50Q35.5 56 32 56Q28.5 56 25.5 50L17.5 36.5Q11 30 11.5 21Z'),
        P('M12 27Q3 42 6 62L21 59L24.5 47L16.5 35.5Z'),
        P('M52 27Q61 42 58 62L43 59L39.5 47L47.5 35.5Z'),
      ],
      cut: [P('M17 8.5L22.5 15.5L18.5 19Z'), P('M47 8.5L41.5 15.5L45.5 19Z'), S('M20 26.5L27.5 29.5', 2.4), S('M44 26.5L36.5 29.5', 2.4), P('M28.5 48.5Q32 46 35.5 48.5Q34 52 32 52Q30 52 28.5 48.5Z'), S('M32 33V45', 1.2), S('M17 36.5L24.5 47M47 36.5L39.5 47', 1.4), S('M10 44L13 56M54 44L51 56', 1.1)],
    },
  },
  moonSilverScales: {
    god: 'fjorna',
    material: 'silver',
    glyph: {
      cat: 'god',
      f: [P('M3 36H23Q21 47 13 47Q5 47 3 36Z'), P('M41 36H61Q59 47 51 47Q43 47 41 36Z'), R(25, 55, 14, 5, 2), P('M28 6Q22 10 26 15Q30 12 34 15Q30 10 34 6Z')],
      s: [S('M32 14V56', 3), S('M8 18Q32 14 56 18', 3), S('M8 18L4 36M8 18L22 36M56 18L42 36M56 18L60 36', 1.2)],
      cut: [S('M6 40H20M44 40H58', 1)],
    },
  },
  weepingShield: {
    god: 'eidr',
    material: 'wood',
    accent: 'iron',
    glyph: {
      cat: 'god',
      f: [C(32, 32, 27)],
      cut: [S('M32 5V59M5 32H59', 1.2), S('M24 40Q23 48 25 55M40 40Q41 50 39 57M28 42Q28 46 29 50', 1.8), SC(32, 32, 24.5, 1.4)],
      top: [C(32, 32, 7.5)],
    },
  },
  salthasPearl: {
    god: 'saltha',
    material: 'bone',
    accent: 'pearl',
    glyph: {
      cat: 'god',
      f: [P('M8 46Q6 24 20 14Q32 6 44 14Q58 24 56 46Q44 52 32 52Q20 52 8 46Z'), R(26, 50, 12, 8, 2)],
      cut: [S('M32 52V12M32 52L18 18M32 52L46 18M32 52L11 32M32 52L53 32', 1.4)],
      top: [C(32, 40, 9)],
    },
  },
  highKingsCrown: {
    god: 'none',
    material: 'gold',
    accent: 'cloth',
    glyph: {
      cat: 'god',
      f: [P('M6 30Q32 18 58 30V42Q32 30 6 42Z'), P('M6 42Q32 30 58 42V46Q32 56 6 46Z')],
      cut: [S('M6 36Q32 24 58 36', 1.2), S('M14 28V40M50 28V40', 1.2)],
      top: [E(32, 34, 4, 5), E(20, 36, 3, 3.6), E(44, 36, 3, 3.6)],
    },
  },
};

/** Relic god (belief only), for captions and tests. */
export function relicGod(key: RelicKey): GodKey {
  return RELICS[key].god;
}

/** Over-under interlace ring between radii r0 and r1 (two strands crossing 2·k times). */
function interlace(cx: number, cy: number, rMid: number, amp: number, k: number, light: string, dark: string, width: number): string {
  const N = 360;
  const pts = (sign: number, a0: number, a1: number): string => {
    let d = '';
    const steps = Math.max(4, Math.round(((a1 - a0) / (Math.PI * 2)) * N));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const r = rMid + sign * amp * Math.sin(k * a);
      d += `${i === 0 ? 'M' : 'L'}${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`;
    }
    return d;
  };
  const strand = (d: string): string =>
    path(d, { fill: 'none', stroke: dark, 'stroke-width': n(width + 3), 'stroke-linecap': 'butt' }) + path(d, { fill: 'none', stroke: light, 'stroke-width': n(width), 'stroke-linecap': 'butt' });
  const out: string[] = [strand(pts(1, 0, Math.PI * 2)), strand(pts(-1, 0, Math.PI * 2))];
  const crossings = 2 * k;
  const da = Math.PI / k / 4;
  for (let m = 0; m < crossings; m++) {
    const a = (m * Math.PI) / k;
    out.push(strand(pts(m % 2 === 0 ? 1 : -1, a - da, a + da)));
  }
  return out.join('');
}

/** Renders a relic emblem. */
export function relicSvg(key: RelicKey, opts: { size?: number; seed?: number; watermark?: 'off' | 'corner' | 'full'; label?: string } = {}): string {
  const d = RELICS[key];
  const size = opts.size ?? 256;
  const V = 256;
  const c = V / 2;
  const seed = opts.seed ?? 1;
  const rng = new ArtRng(`relic|${key}|${seed}`);
  const field = GOD_FIELD[d.god];
  const [ml, mm, md] = MATERIALS[d.material];
  const acc = MATERIALS[d.accent ?? d.material];
  const defs: string[] = [
    radialGradient('r-field', [[0, shade(field, 0.35)], [0.6, field], [1, shade(field, -0.55)]], { cx: 0.42, cy: 0.38, r: 0.7 }),
    linearGradient('r-rim', [[0, '#8a9096'], [0.5, CHROME.iron], [1, '#16181b']], { x1: 0, y1: 0, x2: 0.5, y2: 1 }),
    linearGradient('r-mat', [[0, ml], [0.45, mm], [1, md]], { x1: 0.15, y1: 0, x2: 0.75, y2: 1 }),
    linearGradient('r-acc', [[0, acc[0]], [0.5, acc[1]], [1, acc[2]]], { x1: 0.15, y1: 0, x2: 0.75, y2: 1 }),
    radialGradient('r-light', [[0, '#fff4d8', 0.28], [1, '#fff4d8', 0]], { cx: 0.38, cy: 0.32, r: 0.5 }),
    grainFilter('r-grain', seed + key.length * 31, 0.8, 0.18),
  ];
  const gl = d.glyph;
  if (gl.cut && gl.cut.length) {
    defs.push(el('mask', { id: 'r-m', maskUnits: 'userSpaceOnUse', x: -8, y: -8, width: 80, height: 80 }, [el('rect', { x: -8, y: -8, width: 80, height: 80, fill: '#ffffff' }), g({ fill: '#000000', stroke: '#000000' }, gl.cut)]));
  }
  const glyph = (paint: string, accent: string): string =>
    g({ mask: gl.cut && gl.cut.length ? 'url(#r-m)' : undefined }, [gl.f.length ? g({ fill: paint }, gl.f) : '', gl.s && gl.s.length ? g({ fill: 'none', stroke: paint }, gl.s) : '']) +
    (gl.top && gl.top.length ? g({ fill: accent }, gl.top) : '');
  const k = 2.35;
  const place = `translate(${n(c - 32 * k)} ${n(c - 32 * k)}) scale(${n2(k)})`;
  // Field texture: soft concentric tool marks.
  const marks: string[] = [];
  for (let i = 0; i < 9; i++) {
    marks.push(circle(c + rng.jitter(6), c + rng.jitter(6), rng.range(30, 96), { fill: 'none', stroke: rng.chance(0.5) ? '#ffffff' : '#000000', 'stroke-opacity': n2(rng.range(0.03, 0.07)), 'stroke-width': n(rng.range(4, 14)) }));
  }
  const body = [
    circle(c, c, 126, { fill: 'url(#r-rim)' }),
    circle(c, c, 121, { fill: '#1a1410' }),
    interlace(c, c, 111, 6.5, 9, CHROME.boneDim, '#120c08', 4.2),
    circle(c, c, 101, { fill: 'none', stroke: '#c9ccd1', 'stroke-opacity': '0.5', 'stroke-width': 2 }),
    circle(c, c, 99, { fill: 'url(#r-field)' }),
    ...marks,
    circle(c, c, 99, { fill: 'url(#r-light)' }),
    g({ transform: `${place} translate(1.6 2.2)`, opacity: '0.55' }, glyph('#08060a', '#08060a')),
    g({ transform: place }, glyph('url(#r-mat)', 'url(#r-acc)')),
    circle(c, c, 126, { filter: 'url(#r-grain)', style: 'mix-blend-mode:multiply', opacity: '0.7' }),
    circle(c, c, 99, { fill: 'none', stroke: '#000000', 'stroke-opacity': '0.45', 'stroke-width': 3 }),
  ];
  if (opts.watermark && opts.watermark !== 'off') body.push(g({ transform: `scale(${n2(V / size)})` }, watermark(size, size, opts.label, opts.watermark)));
  return svgDoc({ width: size, height: size, viewBox: [0, 0, V, V], defs, body });
}

export const relicGenerator: ImageGenerator = {
  id: 'relic',
  kind: 'image',
  defaultSize: [256, 256],
  params: [
    { name: 'relic', type: 'enum', values: RELIC_KEYS, default: 'drownedBell', note: 'design §21.2 relic key' },
    { name: 'seed', type: 'number', note: 'varies the field texture' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    const key = oneOf(params, 'relic', RELIC_KEYS, 'drownedBell');
    return relicSvg(key, { size: Math.round(Math.min(ctx.width, ctx.height)), seed: seedOf(params, key), watermark: ctx.watermark, label: ctx.label });
  },
  variants(): GeneratorParams[] {
    return RELIC_KEYS.map((relic) => ({ relic }));
  },
};
