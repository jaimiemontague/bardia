/**
 * The placeholder icon set: ~160 glyphs on a 64×64 grid in one consistent "carved bone" style
 * (resources, goods, units, ships, skills, attributes, traits, gods, faiths, buildings, map markers,
 * UI actions, seasons/weather/time and omens). Period-grounded: round shields, square sails, oared
 * hulls, folding scales, rune-staves; no fantasy motifs.
 *
 * A glyph is four element lists:
 *   f   — filled shapes (ink)
 *   s   — stroked lines (ink)
 *   cut — shapes cut OUT of f and s through a mask (fill-cuts and stroke-cuts)
 *   top — filled shapes drawn above the cuts (pupils, flames inside windows, …)
 */

export type IconCategory =
  | 'resource'
  | 'good'
  | 'unit'
  | 'ship'
  | 'skill'
  | 'attribute'
  | 'trait'
  | 'god'
  | 'faith'
  | 'building'
  | 'marker'
  | 'ui'
  | 'season'
  | 'weather'
  | 'time'
  | 'omen';

export interface Glyph {
  cat: IconCategory;
  f: string[];
  s?: string[];
  cut?: string[];
  top?: string[];
}

// ---------------------------------------------------------------------------------------------
// Element helpers (fill/stroke colour comes from the enclosing group)

function f1(x: number): string {
  const r = Math.round(x * 10) / 10;
  return r === 0 ? '0' : String(r);
}
const P = (d: string): string => `<path d="${d}"/>`;
const C = (cx: number, cy: number, r: number): string => `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}"/>`;
const E = (cx: number, cy: number, rx: number, ry: number, rot = 0): string =>
  `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}"${rot ? ` transform="rotate(${f1(rot)} ${f1(cx)} ${f1(cy)})"` : ''}/>`;
const R = (x: number, y: number, w: number, h: number, rx = 0): string =>
  `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"${rx ? ` rx="${f1(rx)}"` : ''}/>`;
const PG = (...pts: number[]): string => {
  const out: string[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push(`${f1(pts[i] as number)},${f1(pts[i + 1] as number)}`);
  return `<polygon points="${out.join(' ')}"/>`;
};
const T = (transform: string, ...els: string[]): string => `<g transform="${transform}">${els.join('')}</g>`;
/** A stroke (used in `s` and as a stroke-cut in `cut`). */
const S = (d: string, w = 4): string => `<path d="${d}" fill="none" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** A stroked circle (ring). */
const SC = (cx: number, cy: number, r: number, w = 2): string => `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="none" stroke-width="${f1(w)}"/>`;
const SE = (cx: number, cy: number, rx: number, ry: number, w = 2): string =>
  `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="none" stroke-width="${f1(w)}"/>`;

// ---------------------------------------------------------------------------------------------
// Shared motifs

/** A vertical sword: point at `top`, blade `len` long, centred on cx (total height len + 19). */
function sword(cx: number, top: number, len: number): Glyph {
  return {
    cat: 'skill',
    f: [PG(cx - 2.8, top + 6, cx, top, cx + 2.8, top + 6, cx + 2.8, top + len, cx - 2.8, top + len), R(cx - 9, top + len, 18, 4, 1.5), R(cx - 2, top + len + 4, 4, 9), E(cx, top + len + 15, 4.5, 3.2)],
    cut: [S(`M${f1(cx)} ${f1(top + 8)}V${f1(top + len - 2)}`, 1.2)],
  };
}

function merge(cat: IconCategory, ...parts: (Glyph | Partial<Glyph>)[]): Glyph {
  const out: Glyph = { cat, f: [], s: [], cut: [], top: [] };
  for (const p of parts) {
    out.f.push(...(p.f ?? []));
    out.s!.push(...(p.s ?? []));
    out.cut!.push(...(p.cut ?? []));
    out.top!.push(...(p.top ?? []));
  }
  return out;
}

function moved(gl: Glyph | Partial<Glyph>, transform: string): Partial<Glyph> {
  return {
    f: gl.f && gl.f.length ? [T(transform, ...gl.f)] : [],
    s: gl.s && gl.s.length ? [T(transform, ...gl.s)] : [],
    cut: gl.cut && gl.cut.length ? [T(transform, ...gl.cut)] : [],
    top: gl.top && gl.top.length ? [T(transform, ...gl.top)] : [],
  };
}

/** Side view of an oared ship. x0 = stern, x1 = bow; yG gunwale, yK keel. */
function hull(x0: number, x1: number, yG: number, yK: number, stemH: number, curl = 3): string {
  const L = x1 - x0;
  return P(
    `M${f1(x0)} ${f1(yG)}Q${f1(x0 + L * 0.12)} ${f1(yK)} ${f1(x0 + L * 0.3)} ${f1(yK)}L${f1(x1 - L * 0.3)} ${f1(yK)}Q${f1(x1 - L * 0.12)} ${f1(yK)} ${f1(x1)} ${f1(yG)}` +
      `Q${f1(x1 + 4)} ${f1(yG - stemH * 0.5)} ${f1(x1 + curl)} ${f1(yG - stemH)}Q${f1(x1 + 1)} ${f1(yG - stemH - 3)} ${f1(x1 - 1.5)} ${f1(yG - stemH + 1)}` +
      `Q${f1(x1 + 0.5)} ${f1(yG - stemH * 0.5)} ${f1(x1 - 3)} ${f1(yG + 1.5)}L${f1(x0 + 3)} ${f1(yG + 1.5)}` +
      `Q${f1(x0 - 0.5)} ${f1(yG - stemH * 0.5)} ${f1(x0 + 1.5)} ${f1(yG - stemH + 1)}Q${f1(x0 - 1)} ${f1(yG - stemH - 3)} ${f1(x0 - curl)} ${f1(yG - stemH)}` +
      `Q${f1(x0 - 4)} ${f1(yG - stemH * 0.5)} ${f1(x0)} ${f1(yG)}Z`,
  );
}

interface ShipOpts {
  x0: number;
  x1: number;
  yG: number;
  yK: number;
  stem: number;
  sail?: { x: number; w: number; top: number; stripes?: number } | null;
  oars?: number;
  shields?: number;
  ram?: boolean;
  tiers?: number;
}

function ship(o: ShipOpts): Glyph {
  const g: Glyph = { cat: 'ship', f: [hull(o.x0, o.x1, o.yG, o.yK, o.stem)], s: [], cut: [], top: [] };
  const L = o.x1 - o.x0;
  if (o.ram) g.f.push(PG(o.x1 - 2, o.yK - 1, o.x1 + 8, o.yK + 1, o.x1 - 2, o.yK + 3));
  if (o.sail) {
    const { x, w, top } = o.sail;
    g.f.push(R(x - 1, top - 3, 2.4, o.yG - top + 4));
    g.f.push(P(`M${f1(x - w / 2)} ${f1(top)}H${f1(x + w / 2)}Q${f1(x + w / 2 + 2)} ${f1((top + o.yG - 6) / 2)} ${f1(x + w / 2 - 1)} ${f1(o.yG - 6)}H${f1(x - w / 2 + 1)}Q${f1(x - w / 2 - 2)} ${f1((top + o.yG - 6) / 2)} ${f1(x - w / 2)} ${f1(top)}Z`));
    g.cut!.push(S(`M${f1(x - w / 2 - 2)} ${f1(top - 1)}H${f1(x + w / 2 + 2)}`, 1.4));
    for (let i = 1; i < (o.sail.stripes ?? 0); i++) {
      const sx = x - w / 2 + (w * i) / (o.sail.stripes ?? 1);
      g.cut!.push(S(`M${f1(sx)} ${f1(top + 1)}V${f1(o.yG - 7)}`, 1.3));
    }
  }
  for (let t = 0; t < (o.tiers ?? 1); t++) {
    for (let i = 0; i < (o.oars ?? 0); i++) {
      const ox = o.x0 + L * 0.2 + (L * 0.6 * (i + 0.5)) / (o.oars ?? 1);
      g.s!.push(S(`M${f1(ox)} ${f1(o.yG + 2 + t * 3)}L${f1(ox - 5)} ${f1(o.yK + 6 + t * 2)}`, 1.6));
    }
  }
  for (let i = 0; i < (o.shields ?? 0); i++) {
    const sx = o.x0 + L * 0.22 + (L * 0.56 * (i + 0.5)) / (o.shields ?? 1);
    g.cut!.push(SC(sx, o.yG + 1.8, 2, 1.1));
  }
  return g;
}

function cloud(cx: number, cy: number, k = 1): string {
  return P(
    `M${f1(cx - 20 * k)} ${f1(cy + 8 * k)}Q${f1(cx - 26 * k)} ${f1(cy + 8 * k)} ${f1(cx - 26 * k)} ${f1(cy + 1 * k)}Q${f1(cx - 26 * k)} ${f1(cy - 6 * k)} ${f1(cx - 18 * k)} ${f1(cy - 6 * k)}Q${f1(cx - 16 * k)} ${f1(cy - 16 * k)} ${f1(cx - 5 * k)} ${f1(cy - 15 * k)}Q${f1(cx + 2 * k)} ${f1(cy - 22 * k)} ${f1(cx + 12 * k)} ${f1(cy - 16 * k)}Q${f1(cx + 20 * k)} ${f1(cy - 14 * k)} ${f1(cx + 19 * k)} ${f1(cy - 6 * k)}Q${f1(cx + 27 * k)} ${f1(cy - 5 * k)} ${f1(cx + 26 * k)} ${f1(cy + 2 * k)}Q${f1(cx + 26 * k)} ${f1(cy + 8 * k)} ${f1(cx + 19 * k)} ${f1(cy + 8 * k)}Z`,
  );
}

function sun(cx: number, cy: number, r: number, rays: number, rayLen: number, wavy = false): Glyph {
  const s: string[] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const x0 = cx + Math.cos(a) * (r + 3);
    const y0 = cy + Math.sin(a) * (r + 3);
    const x1 = cx + Math.cos(a) * (r + 3 + rayLen);
    const y1 = cy + Math.sin(a) * (r + 3 + rayLen);
    if (wavy) {
      const mx = (x0 + x1) / 2 + Math.cos(a + Math.PI / 2) * 2.5;
      const my = (y0 + y1) / 2 + Math.sin(a + Math.PI / 2) * 2.5;
      s.push(S(`M${f1(x0)} ${f1(y0)}Q${f1(mx)} ${f1(my)} ${f1(x1)} ${f1(y1)}`, 3));
    } else s.push(S(`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`, 3.2));
  }
  return { cat: 'season', f: [C(cx, cy, r)], s };
}

function star(cx: number, cy: number, ro: number, ri: number, points: number, rot = -Math.PI / 2): string {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const r = i % 2 === 0 ? ro : ri;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return PG(...pts);
}

function house(x: number, base: number, w: number, h: number, roofH: number): string[] {
  return [PG(x - 2, base - h, x + w / 2, base - h - roofH, x + w + 2, base - h), R(x, base - h, w, h)];
}

function lantern(cx: number, top: number, k = 1): Glyph {
  const w = 24 * k;
  const h = 30 * k;
  return {
    cat: 'faith',
    f: [PG(cx - w / 2, top + 7 * k, cx + w / 2, top + 7 * k, cx + w * 0.28, top + 1 * k, cx - w * 0.28, top + 1 * k), R(cx - w / 2, top + 7 * k, w, h, 3 * k), R(cx - w / 2 - 2 * k, top + 7 * k + h, w + 4 * k, 5 * k, 2 * k)],
    s: [SC(cx, top - 3 * k, 3.5 * k, 2.2 * k)],
    cut: [R(cx - w / 2 + 4.5 * k, top + 12 * k, w - 9 * k, h - 9 * k, 3 * k)],
    top: [P(`M${f1(cx)} ${f1(top + 15 * k)}Q${f1(cx + 6 * k)} ${f1(top + 24 * k)} ${f1(cx + 4 * k)} ${f1(top + 29 * k)}Q${f1(cx)} ${f1(top + 33 * k)} ${f1(cx - 4 * k)} ${f1(top + 29 * k)}Q${f1(cx - 6 * k)} ${f1(top + 24 * k)} ${f1(cx)} ${f1(top + 15 * k)}Z`)],
  };
}

function horseHead(): Glyph {
  return {
    cat: 'unit',
    f: [P('M18 60Q13 44 19 31L17 13L25 21Q33 12 44 18L57 34Q60 41 54 43L44 39Q38 47 42 60Z')],
    cut: [C(38, 25, 2.4), S('M25 22Q21 32 22 44', 1.6), S('M29 19Q25 30 26 42', 1.4), E(53, 38, 1.6, 1.2)],
  };
}

function wolfFront(): Glyph {
  return {
    cat: 'unit',
    f: [P('M11 6L22 21Q32 17 42 21L53 6L52 28Q56 39 45 48L37 59H27L19 48Q8 39 12 28Z')],
    cut: [PG(19, 31, 28, 33, 26, 36), PG(45, 31, 36, 33, 38, 36), E(32, 52, 4.5, 3), S('M32 38V48', 1.5), S('M16 15L22 24', 1.5), S('M48 15L42 24', 1.5)],
  };
}

function shieldRound(cx: number, cy: number, r: number): Glyph {
  return { cat: 'unit', f: [C(cx, cy, r)], cut: [SC(cx, cy, r * 0.32, 2.2), SC(cx, cy, r - 2.6, 1.3), S(`M${f1(cx)} ${f1(cy - r + 3)}V${f1(cy - r * 0.38)}M${f1(cx)} ${f1(cy + r * 0.38)}V${f1(cy + r - 3)}`, 1.3)] };
}

function bow(x: number, top: number, bottom: number, depth: number): Glyph {
  const mid = (top + bottom) / 2;
  return {
    cat: 'unit',
    f: [],
    s: [S(`M${f1(x)} ${f1(top)}Q${f1(x + depth)} ${f1(mid)} ${f1(x)} ${f1(bottom)}`, 4), S(`M${f1(x)} ${f1(top)}V${f1(bottom)}`, 1.3)],
  };
}

function arrow(x0: number, y0: number, x1: number, y1: number): Glyph {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const hx = x1 - Math.cos(a) * 8;
  const hy = y1 - Math.sin(a) * 8;
  const nx = -Math.sin(a) * 4;
  const ny = Math.cos(a) * 4;
  const fx = x0 + Math.cos(a) * 6;
  const fy = y0 + Math.sin(a) * 6;
  return {
    cat: 'unit',
    f: [PG(x1, y1, hx + nx, hy + ny, hx - nx, hy - ny), PG(x0, y0, fx + nx * 0.9, fy + ny * 0.9, fx, fy, fx - nx * 0.9, fy - ny * 0.9)],
    s: [S(`M${f1(x0)} ${f1(y0)}L${f1(hx)} ${f1(hy)}`, 2.4)],
  };
}

function axe(): Glyph {
  return { cat: 'unit', f: [P('M37 6Q55 3 58 20Q51 17 45 22L42 24L38 13Z')], s: [S('M41 8L25 60', 3.6)] };
}

function chest(): Glyph {
  return {
    cat: 'ui',
    f: [P('M10 30Q10 16 32 16Q54 16 54 30Z'), R(10, 32, 44, 24, 2)],
    cut: [S('M10 31H54', 2), S('M20 18V56M44 18V56', 2), R(28, 36, 8, 9, 1.5)],
  };
}

function book(open: boolean): Glyph {
  if (open) {
    return {
      cat: 'ui',
      f: [P('M4 16Q18 10 31 16V54Q18 48 4 54Z'), P('M60 16Q46 10 33 16V54Q46 48 60 54Z')],
      cut: [S('M9 24Q18 20 26 24M9 32Q18 28 26 32M9 40Q18 36 26 40', 1.6), S('M38 24Q46 20 55 24M38 32Q46 28 55 32M38 40Q46 36 55 40', 1.6)],
    };
  }
  return { cat: 'ui', f: [R(12, 8, 40, 50, 3)], cut: [S('M18 8V58', 2), R(24, 18, 22, 14, 2), S('M50 26H56V40H50', 3)] };
}

function scroll(): Glyph {
  return {
    cat: 'ui',
    f: [R(14, 12, 36, 40, 2), E(14, 32, 5, 20), E(50, 32, 5, 20)],
    cut: [S('M22 22H42M22 30H42M22 38H36', 2.2), SE(50, 32, 2, 16, 1.2)],
  };
}

function magnifier(sign: '+' | '-' | ''): Glyph {
  return {
    cat: 'ui',
    f: [],
    s: [SC(26, 26, 16, 5), S('M38 38L56 56', 7)],
    cut: [],
    top: sign === '' ? [] : sign === '+' ? [R(18, 24, 16, 4, 1), R(24, 18, 4, 16, 1)] : [R(18, 24, 16, 4, 1)],
  };
}

// ---------------------------------------------------------------------------------------------
// The set

const G: Record<string, Glyph> = {};
function def(id: string, gl: Glyph): void {
  G[id] = gl;
}

// --- Resources and standings
def('silver', {
  cat: 'resource',
  f: [E(24, 50, 16, 6), R(8, 39, 32, 11), E(24, 39, 16, 6), C(45, 28, 13)],
  cut: [S('M8 44.5Q24 51 40 44.5', 1.4), SE(24, 39, 12, 4, 1.4), SC(45, 28, 9.5, 1.8), S('M45 22V34M39 28H51', 2)],
});
def('goods', {
  cat: 'resource',
  f: [P('M21 22Q15 16 22 11H42Q49 16 43 22Q55 31 53 45Q51 57 32 57Q13 57 11 45Q9 31 21 22Z')],
  cut: [S('M19 22Q32 27 45 22', 3), S('M25 34Q29 43 25 50', 1.6), S('M40 33Q37 40 40 48', 1.6)],
});
def('rations', {
  cat: 'resource',
  f: [P('M7 44Q7 24 32 21Q57 24 57 44Z'), R(7, 41, 50, 9, 3)],
  cut: [S('M17 30L23 40', 2.6), S('M30 26L35 37', 2.6), S('M43 28L48 39', 2.6), S('M7 46H57', 1.3)],
});
def('grain', {
  cat: 'resource',
  f: [E(19, 17, 4, 9, -22), E(32, 12, 4.2, 9.5), E(45, 17, 4, 9, 22), E(25, 24, 3.5, 8, -10), E(39, 24, 3.5, 8, 10), R(25.5, 40, 13, 5, 2)],
  s: [S('M32 59L19 22', 2.4), S('M32 59V18', 2.4), S('M32 59L45 22', 2.4), S('M32 59L25 30', 2.2), S('M32 59L39 30', 2.2)],
  cut: [S('M19 12V22M32 6V18M45 12V22', 1)],
});
def('men', {
  cat: 'resource',
  f: [C(16, 28, 6.5), P('M4 56Q4 40 16 38Q24 39 27 44L23 56Z'), C(48, 28, 6.5), P('M60 56Q60 40 48 38Q40 39 37 44L41 56Z'), C(32, 22, 8.5), P('M17 57Q17 36 32 34Q47 36 47 57Z'), P('M22.5 21Q23 11 32 11Q41 11 41.5 21Z')],
  cut: [S('M17 57Q17 36 32 34Q47 36 47 57', 3), S('M23 21H41', 1.6), S('M32 11V21', 1.4)],
});
def('renown', { cat: 'resource', f: [star(32, 32, 28, 11, 8)], cut: [SC(32, 32, 6, 2.2)] });
def('honor', {
  cat: 'resource',
  f: [E(32, 32, 26, 16)],
  cut: [E(32, 32, 17, 8.5), S('M12 26L16 36M19 21L23 33M28 18L30 30M36 18L36 30M44 20L42 32M51 24L48 35', 1.4)],
});
def('dread', {
  cat: 'resource',
  f: [P('M32 6Q53 6 53 27Q53 38 46 42V49H18V42Q11 38 11 27Q11 6 32 6Z'), R(20, 47, 24, 10, 2)],
  cut: [E(23.5, 28, 6.2, 7.2), E(40.5, 28, 6.2, 7.2), PG(32, 34, 28.5, 41, 35.5, 41), S('M26 48V57M32 48V57M38 48V57', 2)],
});
def('favor', {
  cat: 'resource',
  f: [P('M7 36H57Q55 53 32 55Q9 53 7 36Z'), R(25, 54, 14, 5, 2)],
  s: [S('M25 31Q20 23 27 16Q34 9 29 3', 3), S('M38 31Q43 24 37 17', 3)],
  cut: [S('M11 41H53', 1.4)],
});
def('loyalty', {
  cat: 'resource',
  f: [P('M17 8H53L45 20.5L53 33H17Z')],
  s: [S('M14 5V60', 4)],
  cut: [SC(32, 20.5, 5.5, 2), S('M32 15V26', 1.4)],
});
def('ships', merge('resource', ship({ x0: 8, x1: 56, yG: 40, yK: 50, stem: 16, sail: { x: 32, w: 26, top: 10, stripes: 4 }, oars: 0, shields: 6 })));

// --- Goods (§30.1)
def('salt', {
  cat: 'good',
  f: [P('M6 54Q18 28 32 22Q46 28 58 54Z'), PG(46, 14, 49, 9, 52, 14, 49, 19)],
  cut: [S('M17 47Q25 40 30 44', 2), S('M34 37Q40 34 45 41', 2), S('M26 33L29 30', 1.6)],
});
def('timber', {
  cat: 'good',
  f: [C(20, 45, 11), C(44, 45, 11), C(32, 25, 11)],
  cut: [SC(20, 45, 7, 1.6), SC(20, 45, 3, 1.4), SC(44, 45, 7, 1.6), SC(44, 45, 3, 1.4), SC(32, 25, 7, 1.6), SC(32, 25, 3, 1.4), S('M8 45Q8 34 20 34M56 45Q56 34 44 34', 2)],
});
def('iron', {
  cat: 'good',
  f: [PG(8, 46, 55, 37, 58, 43, 11, 52), PG(6, 31, 51, 22, 54, 28, 9, 37)],
  cut: [S('M9 47L56 38', 1.3), S('M7 32L52 23', 1.3), C(52, 25, 1.6), C(55, 40, 1.6)],
});
def('pitch', {
  cat: 'good',
  f: [R(13, 19, 38, 7, 2.5), P('M16 26H48L46 31Q55 41 47 53Q32 59 17 53Q9 41 18 31Z'), P('M50 28Q55 37 52 42Q48 43 48 37Z')],
  cut: [S('M18 35Q32 39 46 35', 2), S('M15 23H49', 1.2)],
});
def('furs', {
  cat: 'good',
  f: [P('M32 5Q36 11 40 11Q50 9 52 15Q48 22 50 29Q58 33 58 42Q50 42 46 46Q44 56 32 60Q20 56 18 46Q14 42 6 42Q6 33 14 29Q16 22 12 15Q14 9 24 11Q28 11 32 5Z')],
  cut: [S('M32 14V52', 1.8), S('M24 22L28 28M40 22L36 28M22 36L27 40M42 36L37 40', 1.4)],
});
def('ivory', {
  cat: 'good',
  f: [P('M11 56Q12 31 30 17Q43 7 58 7Q51 13 43 21Q27 37 23 57Z')],
  cut: [S('M17 45Q21 43 26 46', 1.5), S('M23 34Q27 32 31 36', 1.5), S('M31 25Q35 23 38 27', 1.5), S('M40 17Q43 15 46 18', 1.5)],
});
def('amber', {
  cat: 'good',
  f: [P('M20 13Q34 5 47 15Q57 28 50 44Q42 58 26 54Q9 48 11 31Q12 19 20 13Z')],
  cut: [C(30, 34, 3), C(39, 40, 1.8), S('M20 23Q25 17 33 17', 3.2)],
});
def('cloth', {
  cat: 'good',
  f: [R(8, 16, 42, 32, 3), E(50, 32, 7, 16)],
  cut: [S('M8 24H45M8 32H45M8 40H45', 1.4), SE(50, 32, 3.6, 9, 1.6), C(50, 32, 1.4)],
});
def('wine', {
  cat: 'good',
  f: [P('M26 6H38V13Q49 18 49 32Q49 46 37 54L35 60H29L27 54Q15 46 15 32Q15 18 26 13Z')],
  s: [S('M27 15Q15 13 17 26', 3), S('M37 15Q49 13 47 26', 3)],
  cut: [S('M22 33Q32 37 42 33', 1.8), S('M26 10H38', 1.4)],
});
def('mead', {
  cat: 'good',
  f: [P('M6 17Q9 10 17 12Q41 20 53 40Q58 49 53 54Q48 56 45 51Q34 34 13 25Q4 23 6 17Z')],
  cut: [S('M14 10Q8 18 13 26', 2.6), S('M42 31Q37 35 38 41', 2), S('M48 45Q44 48 46 52', 2)],
});
def('honey', {
  cat: 'good',
  f: [P('M11 53Q9 20 32 11Q55 20 53 53Z'), R(8, 51, 48, 5, 2)],
  cut: [E(32, 48, 5, 4.5), S('M13 42Q32 46 51 42', 2), S('M14 32Q32 36 50 32', 2), S('M19 22Q32 26 45 22', 2)],
});
def('jewelry', {
  cat: 'good',
  f: [E(32, 34, 25, 18)],
  cut: [SE(32, 34, 19, 12.5, 2), C(32, 34, 4), C(20, 28, 2), C(44, 28, 2), C(20, 40, 2), C(44, 40, 2), S('M32 16V22M32 46V52M8 34H13M51 34H56', 1.6)],
});
def('silk', {
  cat: 'good',
  f: [P('M7 20Q19 12 32 20Q45 28 57 20V45Q45 53 32 45Q19 37 7 45Z')],
  cut: [S('M7 32Q19 24 32 32Q45 40 57 32', 1.6), S('M7 38Q19 30 32 38', 1)],
});
def('weapons', merge('good', moved(sword(32, 3, 36), 'rotate(40 32 32)'), moved(axe(), 'rotate(-12 32 32)')));

// --- Unit roles
def('unitSpear', merge('unit', shieldRound(25, 38, 19), { s: [S('M48 13V62', 3.4)], f: [P('M48 1L52.5 13L48 16L43.5 13Z')] }));
def('unitAxe', merge('unit', axe(), shieldRound(22, 41, 17)));
def('unitBow', merge('unit', bow(17, 5, 59, 34), arrow(8, 32, 58, 32)));
def('unitJavelin', merge('unit', arrow(10, 56, 52, 10), arrow(20, 60, 58, 20), arrow(6, 46, 42, 6)));
def('unitBerserker', {
  cat: 'unit',
  f: [P('M32 28Q48 28 49 42Q50 56 32 56Q14 56 15 42Q16 28 32 28Z'), E(14, 24, 5.5, 7, -25), E(25, 15, 5.5, 7.5, -8), E(39, 15, 5.5, 7.5, 8), E(50, 24, 5.5, 7, 25)],
  cut: [S('M24 44Q32 49 40 44', 1.8)],
});
def('unitWolfcoat', merge('unit', wolfFront(), { cut: [S('M22 48Q32 44 42 48', 1.4)] }));
def('unitWolf', {
  cat: 'unit',
  f: [P('M6 42L18 26L19 9L28 19Q43 16 52 26L61 33Q59 40 50 41L41 43Q36 54 22 57Q12 52 6 42Z')],
  cut: [PG(37, 26, 44, 27, 39, 30), S('M49 36L58 36', 1.4), S('M21 21L24 28', 1.4)],
});
def('unitHorse', horseHead());
def('unitHorseArcher', merge('unit', moved(horseHead(), 'translate(-4 4) scale(0.82)'), bow(42, 6, 58, 20), { s: [S('M38 32H62', 2)] }));
def('unitElite', {
  cat: 'unit',
  f: [P('M14 31Q14 8 32 8Q50 8 50 31Z'), P('M13 31H51L53 52Q32 61 11 52Z')],
  cut: [E(24, 35, 5.5, 3.2), E(40, 35, 5.5, 3.2), R(30, 26, 4, 15), S('M18 44H46M17 50H47', 1.4), S('M32 8V24', 1.6), S('M14 26Q32 22 50 26', 1.6)],
});
def('unitOutlaw', {
  cat: 'unit',
  f: [P('M32 5Q51 7 52 33L55 59H9L12 33Q13 7 32 5Z')],
  cut: [E(32, 32, 9.5, 12.5), S('M20 46L44 58', 2)],
  top: [E(28.5, 31, 1.8, 1.2), E(35.5, 31, 1.8, 1.2)],
});
def('unitBear', {
  cat: 'unit',
  f: [C(15, 16, 7.5), C(49, 16, 7.5), E(32, 35, 23, 21)],
  cut: [C(15, 16, 3), C(49, 16, 3), C(24, 30, 2.6), C(40, 30, 2.6), SE(32, 45, 10, 8, 2), E(32, 41, 4.5, 3)],
});

// --- Ships (side silhouettes)
def('shipKarvi', ship({ x0: 12, x1: 52, yG: 40, yK: 48, stem: 12, sail: { x: 32, w: 18, top: 16, stripes: 0 }, oars: 4, shields: 0 }));
def('shipSnekkja', ship({ x0: 4, x1: 60, yG: 40, yK: 47, stem: 13, sail: { x: 32, w: 22, top: 14, stripes: 3 }, oars: 7, shields: 7 }));
def('shipDrakkar', ship({ x0: 3, x1: 61, yG: 38, yK: 48, stem: 20, sail: { x: 32, w: 30, top: 6, stripes: 5 }, oars: 9, shields: 9 }));
def('shipKnarr', merge('ship', ship({ x0: 10, x1: 54, yG: 36, yK: 50, stem: 9, sail: { x: 31, w: 28, top: 6, stripes: 0 }, oars: 2, shields: 0 }), { cut: [S('M18 42Q32 46 46 42', 1.4)] }));
def('shipGalley', ship({ x0: 4, x1: 56, yG: 39, yK: 45, stem: 8, sail: { x: 30, w: 20, top: 12, stripes: 0 }, oars: 9, tiers: 2, ram: true }));
def('shipRiverboat', merge('ship', ship({ x0: 14, x1: 50, yG: 42, yK: 49, stem: 7, sail: null, oars: 3 }), { f: [E(32, 34, 4, 5), R(28, 37, 8, 6, 2)] }));

// --- Skills
def('skillMelee', merge('skill', moved(sword(32, 2, 38), 'rotate(42 32 32)'), moved(sword(32, 2, 38), 'rotate(-42 32 32)')));
def('skillArchery', merge('skill', { f: [C(26, 38, 21)], cut: [SC(26, 38, 14, 3), SC(26, 38, 7, 3)] }, arrow(60, 4, 27, 37)));
def('skillCommand', {
  cat: 'skill',
  f: [P('M5 44Q7 35 16 38Q36 42 49 23L57 12Q61 21 56 30Q43 53 16 51Q6 50 5 44Z')],
  cut: [S('M14 38Q11 44 15 50', 2.4), S('M44 29Q41 35 44 40', 2), S('M52 20Q49 24 51 28', 2)],
  s: [S('M58 6Q62 4 63 8', 1.4)],
});
def('skillSeafaring', {
  cat: 'skill',
  f: [P('M3 46Q11 40 19 46Q27 52 35 46Q43 40 51 46Q57 50 61 46V60H3Z'), E(25, 44, 5.5, 11, 25)],
  s: [S('M45 5L28 38', 4)],
  cut: [S('M3 53Q11 48 19 53Q27 58 35 53Q43 48 51 53', 1.5)],
});
def('skillWildcraft', {
  cat: 'skill',
  f: [PG(32, 3, 50, 25, 42, 25, 56, 44, 37, 44, 37, 58, 27, 58, 27, 44, 8, 44, 22, 25, 14, 25)],
  cut: [S('M32 14V44', 1.4), S('M24 34L32 40L40 34', 1.4)],
});
def('skillSpeechcraft', {
  cat: 'skill',
  f: [P('M8 11H56Q60 11 60 15V38Q60 42 56 42H29L16 54V42H8Q4 42 4 38V15Q4 11 8 11Z')],
  cut: [S('M14 21H50M14 29H42', 3)],
});
def('skillStewardship', merge('skill', {
  f: [C(20, 15, 10), R(26, 50, 7, 4), R(30, 44, 7, 4)],
  s: [S('M24 22L46 56', 4.2)],
  cut: [C(20, 15, 5)],
}, moved({ f: [C(20, 15, 10), R(26, 50, 7, 4), R(30, 44, 7, 4)], s: [S('M24 22L46 56', 4.2)], cut: [C(20, 15, 5)] }, 'translate(64 0) scale(-1 1)')));
def('skillRunecraft', {
  cat: 'skill',
  f: [P('M17 59L13 24Q15 5 34 5Q51 7 51 26L47 59Z')],
  cut: [S('M25 16V46M25 22L33 16M25 30L33 24', 2.6), S('M40 18V44M40 26L34 32M40 26L46 32', 2.6), S('M20 52H44', 1.4)],
});

// --- Attributes
def('attrMight', {
  cat: 'attribute',
  f: [P('M14 28Q14 17 22 17H46Q53 17 53 25V40Q53 53 40 55H26Q14 53 14 42Z')],
  cut: [S('M24 17V29M32 17V29M40 17V29', 2), S('M14 35Q24 34 31 41', 2.6)],
});
def('attrAgility', {
  cat: 'attribute',
  f: [P('M51 5Q59 22 47 38Q35 52 13 57Q21 45 29 31Q39 14 51 5Z')],
  cut: [S('M13 57Q32 36 50 8', 2), S('M44 18L37 15M41 26L32 23M36 34L27 32M30 41L22 40', 1.4)],
});
def('attrWits', {
  cat: 'attribute',
  f: [P('M3 32Q32 7 61 32Q32 57 3 32Z')],
  cut: [C(32, 32, 12)],
  top: [C(32, 32, 6.5)],
});
def('attrVigor', {
  cat: 'attribute',
  f: [R(30, 3, 4, 10, 1.5), P('M13 28Q13 12 32 12Q51 12 51 28Z'), P('M18 30H46Q46 51 32 59Q18 51 18 30Z')],
  cut: [S('M18 18L26 26M26 14L36 26M38 14L46 24', 1.4), S('M24 38Q26 48 31 52', 1.8)],
});

// --- Trait categories
def('traitBody', {
  cat: 'trait',
  f: [P('M8 50Q8 40 18 38L24 28Q22 16 32 12Q42 12 42 22Q42 30 36 32L32 40Q46 38 54 46Q58 54 50 58H14Q8 57 8 50Z')],
  cut: [S('M24 30Q30 34 34 31', 1.6), S('M20 46Q30 44 38 48', 1.6)],
});
def('traitMind', {
  cat: 'trait',
  f: [P('M20 58V46Q10 40 10 28Q10 8 32 8Q52 8 54 26L58 36L52 38V46Q52 50 46 50H40V58Z')],
  cut: [S('M30 28Q30 22 35 22Q41 22 41 28Q41 35 34 35Q26 35 26 27Q26 18 35 17', 2.2)],
});
def('traitInjury', {
  cat: 'trait',
  f: [T('rotate(45 32 32)', R(23, 4, 18, 56, 3)), T('rotate(-45 32 32)', R(23, 4, 18, 56, 3))],
  cut: [T('rotate(45 32 32)', S('M28 10V22M36 10V22M28 42V54M36 42V54', 1.3)), T('rotate(-45 32 32)', S('M28 10V22M36 10V22M28 42V54M36 42V54', 1.3))],
});
def('traitLearned', merge('trait', scroll()));
def('traitFaith', {
  cat: 'trait',
  f: [P('M32 4Q42 18 46 24Q53 33 50 44Q46 58 32 60Q18 58 14 44Q11 33 18 24Q22 32 28 32Q22 18 32 4Z')],
  cut: [P('M32 34Q38 41 38 47Q38 54 32 55Q26 54 26 47Q26 41 32 34Z')],
});
def('traitFortune', {
  cat: 'trait',
  f: [PG(32, 6, 56, 18, 56, 46, 32, 58, 8, 46, 8, 18)],
  cut: [S('M8 18L32 30L56 18M32 30V58', 1.6), C(32, 18, 3), C(20, 38, 2.8), C(26, 46, 2.8), C(38, 40, 2.8), C(46, 34, 2.8), C(44, 48, 2.8)],
});
def('traitVirtue', { cat: 'trait', f: [C(32, 32, 27)], cut: [S('M18 38L32 22L46 38', 5), S('M32 23V48', 4)] });
def('traitVice', { cat: 'trait', f: [C(32, 32, 27)], cut: [S('M18 26L32 42L46 26', 5), S('M32 16V41', 4)] });

// --- Gods (belief only: emblems of what their worshippers carve)
def('godValgrim', {
  cat: 'god',
  f: [P('M5 31Q14 22 26 22L34 13Q44 9 50 15L59 17L50 22Q48 30 40 36L45 53L38 45L30 53L32 40Q18 41 5 31Z')],
  cut: [C(44, 16, 2), S('M14 29Q24 30 33 26', 1.4), S('M30 33Q36 33 40 28', 1.4)],
});
def('godDunnar', {
  cat: 'god',
  f: [P('M9 9H55L50 27H14Z'), R(28, 25, 8, 25, 2), C(32, 54, 6.5)],
  cut: [C(32, 54, 2.6), PG(34, 11, 26, 19, 32, 19, 28, 26, 38, 16, 32, 16, 36, 11)],
});
def('godSaltha', {
  cat: 'god',
  f: [P('M4 50Q8 29 24 25Q41 21 45 35Q37 30 33 38Q31 46 41 46Q53 46 58 33Q63 46 57 55H4Z')],
  cut: [S('M10 50Q16 38 26 36', 1.6), S('M8 55H56', 1.4)],
});
def('godFjorna', {
  cat: 'god',
  f: [P('M32 4Q49 26 49 38Q49 55 32 57Q15 55 15 38Q15 26 32 4Z')],
  cut: [S('M32 50V24', 1.8), E(32, 22, 2.4, 5), E(27.5, 30, 2.2, 4.6, -30), E(36.5, 30, 2.2, 4.6, 30), E(27.5, 39, 2.2, 4.6, -30), E(36.5, 39, 2.2, 4.6, 30)],
});
def('godEidr', merge('god', { f: [C(32, 30, 21)], cut: [C(32, 30, 13.5)] }, { top: [PG(29.5, 9, 32, 3, 34.5, 9, 34.5, 44, 29.5, 44), R(23, 44, 18, 4, 1.5), R(30, 48, 4, 8), E(32, 58, 4, 3)] }));
def('godSkell', {
  cat: 'god',
  f: [P('M32 3Q41 17 47 22Q55 30 53 43Q50 57 32 61Q14 57 11 43Q9 30 19 21Q22 31 28 32Q22 17 32 3Z')],
  cut: [P('M33 33Q40 40 40 47Q40 55 32 56Q24 55 24 48Q24 42 29 39Q30 45 33 45Q30 39 33 33Z')],
});
def('godGrayQueen', {
  cat: 'god',
  f: [P('M32 14Q48 15 50 32L55 59H9L14 32Q16 15 32 14Z'), PG(22, 14, 22, 5, 27, 10, 32, 3, 37, 10, 42, 5, 42, 14)],
  cut: [E(32, 33, 9, 11.5), S('M22 14H42', 1.4)],
  top: [S('M27 31H29M35 31H37', 1.6)],
});

// --- Faiths
def('faithOldWays', {
  cat: 'faith',
  f: [C(32, 22, 18), R(28.5, 33, 7, 18), P('M14 59Q27 51 28 46H36Q37 51 50 59Z')],
  cut: [S('M32 36V18M32 26L24 18M32 22L40 14M32 30L42 24M32 28L22 26', 1.6)],
});
def('faithLantern', lantern(32, 10, 1.25));
def('faithGoldenLantern', merge('faith', { f: [P('M12 46Q12 20 32 17Q52 20 52 46Z'), R(9, 46, 46, 9, 2), R(30.5, 6, 3, 12)], cut: [P('M22 46V36Q22 30 26 30Q30 30 30 36V46Z'), P('M34 46V36Q34 30 38 30Q42 30 42 36V46Z'), S('M9 50H55', 1.2)] }, { f: [E(32, 6, 3.5, 4.5)] }));
def('faithRiverSpirits', {
  cat: 'faith',
  f: [P('M7 26Q22 11 40 22L55 12L51 26L55 40L40 30Q22 41 7 26Z')],
  s: [S('M4 48Q12 43 20 48Q28 53 36 48Q44 43 52 48Q56 50 60 48', 2.6), S('M4 57Q12 52 20 57Q28 62 36 57Q44 52 52 57', 2.6)],
  cut: [C(16, 24, 2), S('M28 18Q32 26 28 33', 1.4)],
});
def('faithHighSky', merge('faith', sun(32, 32, 11, 8, 13), { cut: [SC(32, 32, 6.5, 2)] }));

// --- Buildings (§10.4)
def('bldHall', {
  cat: 'building',
  f: [P('M3 35Q32 19 61 35L57 40H7Z'), R(9, 38, 46, 17)],
  s: [S('M6 33L2 25M58 33L62 25', 2.4)],
  cut: [R(27.5, 43, 9, 12, 1), S('M9 44H24M40 44H55', 1.2)],
});
def('bldWalls', { cat: 'building', f: [[0, 1, 2, 3, 4, 5, 6].map((i) => PG(5 + i * 8, 59, 5 + i * 8, 20, 8.5 + i * 8, 13, 12 + i * 8, 20, 12 + i * 8, 59)).join(''), R(3, 34, 58, 4)], cut: [S('M3 46H61', 1.4)] });
def('bldSmithy', {
  cat: 'building',
  f: [P('M7 23H46Q56 23 59 16Q59 31 46 31H42L40 40H46V49H17V40H23L21 31H11Q7 29 7 23Z')],
  s: [S('M18 4L30 16', 3.4)],
  top: [T('rotate(45 30 12)', R(24, 7, 14, 8, 1.5))],
  cut: [S('M11 26H44', 1.2)],
});
def('bldShipyard', {
  cat: 'building',
  f: [R(10, 52, 8, 8), R(28, 54, 8, 6), R(46, 52, 8, 8)],
  s: [S('M4 47Q32 56 60 47', 4), S('M4 47L2 30M60 47L62 30', 3), S('M13 49Q10 38 14 28M22 51Q20 38 23 26M32 52V26M42 51Q44 38 41 26M51 49Q54 38 50 28', 2.4)],
});
def('bldMarket', {
  cat: 'building',
  f: [P('M5 23L13 9H51L59 23Q55 28 51 23Q47 28 43 23Q39 28 35 23Q31 28 27 23Q23 28 19 23Q15 28 11 23Q8 27 5 23Z'), R(11, 24, 4, 34), R(49, 24, 4, 34), R(8, 38, 48, 7, 1.5), C(22, 34, 4), C(31, 35, 3.4), E(41, 34, 5, 4)],
  cut: [S('M21 9L17 23M32 9V23M43 9L47 23', 1.4)],
});
def('bldGrove', { cat: 'building', f: [C(17, 25, 11), C(32, 17, 13), C(47, 25, 11), R(15, 32, 4, 20), R(30, 26, 4, 26), R(45, 32, 4, 20), P('M4 58Q32 46 60 58Z')], cut: [S('M17 20V30M32 10V24M47 20V30', 1.4)] });
def('bldFarms', {
  cat: 'building',
  f: [P('M3 40L61 33V59H3Z')],
  s: [S('M50 6V28', 2), S('M46 10L50 14L54 10M45 16L50 20L55 16', 2)],
  cut: [S('M3 46L61 39M3 52L61 45M3 58L61 51', 2), S('M20 40L14 59M38 37L36 59', 1.2)],
});
def('bldWatchtower', {
  cat: 'building',
  f: [PG(15, 19, 32, 5, 49, 19), R(16, 19, 32, 10)],
  s: [S('M20 29L13 60M44 29L51 60M26 29L24 60M38 29L40 60', 3), S('M16 40L48 52M48 40L16 52', 1.8)],
  cut: [R(22, 21, 4, 5), R(30, 21, 4, 5), R(38, 21, 4, 5)],
});
def('bldMeadhall', {
  cat: 'building',
  f: [P('M3 41Q32 27 61 41L57 46H7Z'), R(10, 44, 44, 15), P('M14 20Q16 13 23 14Q37 17 44 8L49 4Q51 10 47 16Q38 28 20 26Q13 25 14 20Z')],
  cut: [R(27.5, 48, 9, 11, 1), S('M20 15Q17 19 20 25', 2)],
});
def('bldSeersHut', {
  cat: 'building',
  f: [PG(8, 36, 30, 12, 52, 36), R(13, 35, 34, 21)],
  s: [S('M58 14V60', 2.6), S('M30 10Q26 6 30 2', 2), SC(58, 11, 3.2, 2)],
  cut: [P('M24 56V46Q24 41 30 41Q36 41 36 46V56Z'), S('M10 35H50', 1.4)],
});

// --- Map markers
def('mkSettlement', { cat: 'marker', f: [...house(8, 54, 20, 14, 12), ...house(34, 54, 22, 18, 14)], cut: [R(15, 46, 6, 8), R(42, 44, 6, 10)] });
def('mkTown', {
  cat: 'marker',
  f: [...house(14, 46, 14, 10, 9), ...house(32, 46, 18, 14, 12)],
  s: [S('M4 58V40M60 58V40', 3), S('M4 58H60', 4)],
  cut: [R(18, 40, 5, 6), R(38, 38, 5, 8)],
});
def('mkCity', {
  cat: 'marker',
  f: [R(4, 24, 14, 34), R(46, 24, 14, 34), R(16, 32, 32, 26), PG(4, 24, 4, 19, 7, 19, 7, 22, 10, 22, 10, 19, 13, 19, 13, 22, 16, 22, 16, 19, 18, 19, 18, 24), PG(46, 24, 46, 19, 49, 19, 49, 22, 52, 22, 52, 19, 55, 19, 55, 22, 58, 22, 58, 19, 60, 19, 60, 24)],
  cut: [P('M26 58V46Q26 40 32 40Q38 40 38 46V58Z'), R(9, 30, 4, 7, 2), R(51, 30, 4, 7, 2)],
});
def('mkCapital', merge('marker', { f: G.mkCity!.f.map((x) => T('translate(0 6)', x)), cut: G.mkCity!.cut!.map((x) => T('translate(0 6)', x)) }, { f: [PG(20, 22, 20, 10, 26, 16, 32, 6, 38, 16, 44, 10, 44, 22)] }));
def('mkFortress', {
  cat: 'marker',
  f: [P('M2 60Q12 42 32 40Q52 42 62 60Z'), R(22, 20, 20, 22), PG(20, 20, 32, 9, 44, 20)],
  s: [S('M8 50V40M14 46V36M50 46V36M56 50V40', 2.4)],
  cut: [R(29, 30, 6, 12, 1), S('M6 40H58', 1.2)],
});
def('mkCloister', merge('marker', { f: [R(10, 32, 44, 26), PG(6, 33, 32, 16, 58, 33), R(27, 5, 10, 14), PG(25, 6, 32, 1, 39, 6)], cut: [P('M27 58V48Q27 42 32 42Q37 42 37 48V58Z'), C(32, 11, 2.4), R(16, 38, 6, 8, 3), R(42, 38, 6, 8, 3)] }));
def('mkBarrow', { cat: 'marker', f: [P('M3 54Q32 20 61 54Z'), R(28, 10, 8, 18, 2)], cut: [P('M25 54V47Q25 42 32 42Q39 42 39 47V54Z'), S('M30 14L34 18M34 14L30 18', 1.2)] });
def('mkCave', { cat: 'marker', f: [P('M3 57L12 30L24 17L40 13L53 24L61 57Z')], cut: [P('M21 57Q21 34 32 32Q43 34 43 57Z'), S('M12 30L20 34M48 22L44 30', 1.4)] });
def('mkRuin', { cat: 'marker', f: [R(8, 30, 9, 28), PG(23, 58, 23, 22, 28, 18, 32, 24, 32, 58), R(41, 38, 12, 20), P('M4 58H60V61H4Z'), PG(36, 30, 44, 26, 46, 30, 38, 34)], cut: [S('M8 38H17M23 32H32M23 44H32M41 46H53', 1.2)] });
def('mkWreck', merge('marker', moved(ship({ x0: 10, x1: 52, yG: 40, yK: 48, stem: 12, sail: null, oars: 0 }), 'rotate(-14 32 44)'), { s: [S('M30 38L40 10', 2.6), S('M4 56Q12 51 20 56Q28 61 36 56Q44 51 52 56Q56 58 60 56', 2.4)], cut: [S('M22 44L26 50L22 52', 1.6)] }));
def('mkFleet', merge('marker', ship({ x0: 8, x1: 56, yG: 42, yK: 50, stem: 12, sail: { x: 32, w: 28, top: 8, stripes: 4 }, oars: 0, shields: 0 })));
def('mkArmy', { cat: 'marker', f: [P('M22 6H50L44 16L50 26H22Z')], s: [S('M20 4V60', 3.4), S('M34 30V60M44 32V60M54 30V60', 2.2)], top: [PG(34, 24, 36.5, 31, 31.5, 31), PG(44, 26, 46.5, 33, 41.5, 33), PG(54, 24, 56.5, 31, 51.5, 31)], cut: [C(36, 16, 3.2)] });
def('mkStorm', { cat: 'marker', f: [cloud(32, 24, 1.05), PG(30, 32, 22, 46, 30, 46, 24, 61, 40, 41, 32, 41, 38, 32)], cut: [S('M14 30H50', 1.2)] });
def('mkBattle', merge('marker', moved(sword(32, 6, 32), 'rotate(42 32 32)'), moved(sword(32, 6, 32), 'rotate(-42 32 32)'), { s: [S('M32 2V8M4 32H10M54 32H60M10 10L14 14M54 10L50 14', 2.4)] }));
def('mkQuest', { cat: 'marker', f: [P('M18 60L16 20Q18 5 32 5Q46 5 48 20L46 60Z')], cut: [R(28.5, 14, 7, 24, 3), C(32, 47, 4)] });
def('mkRelic', {
  cat: 'marker',
  f: [PG(9, 30, 32, 13, 55, 30), R(10, 30, 44, 26, 2), PG(28, 13, 32, 6, 36, 13)],
  cut: [S('M10 38H54M10 48H54', 1.6), C(32, 43, 3.2), S('M22 30V56M42 30V56', 1.2)],
});
def('mkHarbour', {
  cat: 'marker',
  f: [R(30, 14, 4, 38), R(19, 18, 26, 4, 1.5), P('M9 38Q11 57 32 57Q53 57 55 38L49 44Q47 51 32 51Q17 51 15 44Z'), PG(9, 38, 4, 44, 14, 44), PG(55, 38, 60, 44, 50, 44)],
  s: [SC(32, 9, 5, 3)],
});
def('mkDanger', { cat: 'marker', f: [PG(4, 48, 12, 26, 18, 34, 26, 14, 34, 32, 40, 22, 50, 40, 56, 34, 60, 48)], s: [S('M2 56Q10 51 18 56Q26 61 34 56Q42 51 50 56Q56 59 62 56', 2.6)], cut: [S('M26 14L24 30M40 22L42 34', 1.4)] });
def('mkPortage', merge('marker', ship({ x0: 10, x1: 54, yG: 30, yK: 38, stem: 9, sail: null, oars: 0 }), { f: [C(16, 46, 5), C(32, 46, 5), C(48, 46, 5)], s: [S('M4 54H60', 3)], cut: [C(16, 46, 1.6), C(32, 46, 1.6), C(48, 46, 1.6)] }));
def('mkTrade', {
  cat: 'marker',
  f: [PG(52, 10, 60, 18, 52, 26), PG(12, 38, 4, 46, 12, 54), C(32, 32, 7)],
  s: [S('M8 18H54', 3.4), S('M58 46H10', 3.4)],
  cut: [SC(32, 32, 4, 1.4)],
});
def('mkCamp', { cat: 'marker', f: [PG(6, 56, 32, 12, 58, 56)], s: [S('M32 12L28 4M32 12L36 4', 2)], cut: [PG(32, 30, 24, 56, 40, 56), S('M6 56H58', 1.2)] });
def('mkSite', { cat: 'marker', f: [R(10, 26, 10, 32, 3), R(27, 16, 10, 42, 3), R(44, 28, 10, 30, 3), P('M3 60Q32 52 61 60Z')], cut: [S('M30 26L34 30M34 26L30 30', 1.2)] });
def('mkHome', merge('marker', { f: [P('M3 33Q32 15 61 33L57 39H7Z'), R(9, 37, 46, 20)], s: [S('M6 31L1 21M58 31L63 21', 2.6)], cut: [R(27.5, 42, 9, 15, 1)] }, { f: [P('M26 13Q32 6 38 13Z')] }));

// --- UI actions
def('uiSail', { cat: 'ui', f: [P('M14 10H50Q57 26 50 42H14Q7 26 14 10Z'), R(30.5, 4, 3, 46)], s: [S('M10 50Q20 58 32 54Q44 58 54 50', 3)], cut: [S('M12 10H52', 1.4), S('M24 10Q20 26 24 42M40 10Q44 26 40 42', 1.4)] });
def('uiRaid', {
  cat: 'ui',
  f: [P('M33 4Q40 12 41 18Q45 24 40 30Q36 34 30 32Q24 30 24 23Q24 17 29 14Q30 20 33 20Q30 13 33 4Z'), R(28, 31, 8, 6, 1.5)],
  s: [S('M32 36L24 61', 4.4)],
  cut: [P('M33 20Q36 24 35 27Q33 29 31 27Q30 24 33 20Z')],
});
def('uiTrade', {
  cat: 'ui',
  f: [P('M3 34H23Q21 44 13 44Q5 44 3 34Z'), P('M41 34H61Q59 44 51 44Q43 44 41 34Z'), R(26, 54, 12, 5, 2), C(32, 9, 3.5)],
  s: [S('M32 10V55', 3), S('M8 14H56', 3), S('M8 14L4 34M8 14L22 34M56 14L42 34M56 14L60 34', 1.4)],
});
def('uiTalk', {
  cat: 'ui',
  f: [P('M6 8H36Q40 8 40 12V28Q40 32 36 32H18L10 40V32H6Q2 32 2 28V12Q2 8 6 8Z'), P('M58 24H30Q26 24 26 28V44Q26 48 30 48H46L54 56V48H58Q62 48 62 44V28Q62 24 58 24Z')],
  cut: [S('M26 28Q26 24 30 24H40V32', 3)],
});
def('uiAttack', merge('ui', moved(sword(32, 2, 40), 'rotate(45 32 32)')));
def('uiDefend', merge('ui', shieldRound(32, 32, 27)));
def('uiWait', {
  cat: 'ui',
  f: [P('M14 44A18 18 0 0 1 50 44Z'), R(4, 46, 56, 4, 1.5)],
  s: [S('M32 20V12M18 26L13 21M46 26L51 21M8 38H4M56 38H60', 3), S('M14 56Q32 64 50 56', 2.4)],
  top: [PG(50, 56, 44, 52, 46, 60)],
});
def('uiPause', { cat: 'ui', f: [R(14, 10, 12, 44, 3), R(38, 10, 12, 44, 3)] });
def('uiPlay', { cat: 'ui', f: [P('M18 9Q16 8 16 11V53Q16 56 18 55L53 34Q55 32 53 30Z')] });
def('uiFast', { cat: 'ui', f: [P('M6 12V52L30 32Z'), P('M32 12V52L58 32Z')] });
def('uiFaster', { cat: 'ui', f: [P('M2 14V50L22 32Z'), P('M22 14V50L42 32Z'), P('M42 14V50L62 32Z')] });
def('uiSettings', {
  cat: 'ui',
  f: [],
  s: [SC(32, 32, 23, 5), SC(32, 32, 6, 4), S('M32 9V26M32 38V55M9 32H26M38 32H55M16 16L28 28M36 36L48 48M48 16L36 28M28 36L16 48', 3)],
});
def('uiSave', merge('ui', chest(), { s: [S('M32 2V12', 3.6)], f: [PG(25, 10, 39, 10, 32, 17)] }));
def('uiLoad', merge('ui', chest(), { s: [S('M32 16V4', 3.6)], f: [PG(25, 7, 39, 7, 32, 0)] }));
def('uiClose', { cat: 'ui', f: [], s: [S('M14 14L50 50M50 14L14 50', 7)] });
def('uiBack', { cat: 'ui', f: [PG(6, 32, 28, 12, 28, 52)], s: [S('M26 32H56', 8)] });
def('uiForward', { cat: 'ui', f: [PG(58, 32, 36, 12, 36, 52)], s: [S('M38 32H8', 8)] });
def('uiMenu', { cat: 'ui', f: [R(8, 12, 48, 7, 3), R(8, 28.5, 48, 7, 3), R(8, 45, 48, 7, 3)] });
def('uiInfo', { cat: 'ui', f: [C(32, 32, 27)], cut: [C(32, 18, 4), R(28.5, 26, 7, 22, 2)] });
def('uiWarning', { cat: 'ui', f: [P('M32 5Q35 5 37 9L60 52Q62 57 57 57H7Q2 57 4 52L27 9Q29 5 32 5Z')], cut: [R(29, 21, 6, 19, 2.5), C(32, 47, 3.5)] });
def('uiConfirm', { cat: 'ui', f: [], s: [S('M9 34L25 50L55 14', 8)] });
def('uiCancel', { cat: 'ui', f: [], s: [SC(32, 32, 23, 6), S('M16 48L48 16', 6)] });
def('uiPlus', { cat: 'ui', f: [R(28, 8, 8, 48, 3), R(8, 28, 48, 8, 3)] });
def('uiMinus', { cat: 'ui', f: [R(8, 28, 48, 8, 3)] });
def('uiZoomIn', magnifier('+'));
def('uiZoomOut', magnifier('-'));
def('uiChronicle', book(true));
def('uiCodex', book(false));
def('uiMap', {
  cat: 'ui',
  f: [PG(4, 12, 22, 6, 42, 12, 60, 6, 60, 52, 42, 58, 22, 52, 4, 58)],
  cut: [S('M22 6V52M42 12V58', 1.4), S('M10 44Q18 30 28 36Q38 42 46 24', 2, ), S('M48 18L54 24M54 18L48 24', 2)],
});
def('uiFamily', {
  cat: 'ui',
  f: [C(32, 10, 7), C(14, 32, 6.5), C(50, 32, 6.5), C(10, 54, 5.5), C(26, 54, 5.5), C(50, 54, 5.5)],
  s: [S('M32 17V24M14 25V24H50V25M14 38V43M10 43H26M10 43V48M26 43V48M50 38V48', 2.6)],
});
def('uiCharacter', { cat: 'ui', f: [C(32, 21, 12), P('M10 60Q10 38 32 36Q54 38 54 60Z')] });
def('uiLedger', {
  cat: 'ui',
  f: [R(6, 26, 40, 9, 2), C(48, 44, 12)],
  cut: [S('M12 26V35M18 26V35M24 26V35M30 26V31M36 26V35', 2), SC(48, 44, 8.5, 1.6), S('M48 39V49M43 44H53', 1.8)],
});
def('uiInbox', merge('ui', scroll(), { f: [C(32, 50, 7)], cut: [S('M29 50H35M32 47V53', 1.4)] }));
def('uiDice', merge('ui', { f: G.traitFortune!.f, cut: G.traitFortune!.cut ?? [] }));
def('uiLock', { cat: 'ui', f: [R(12, 28, 40, 30, 4)], s: [S('M20 28V20Q20 8 32 8Q44 8 44 20V28', 5)], cut: [C(32, 40, 4), R(30, 42, 4, 9)] });
def('uiEye', { cat: 'ui', f: G.attrWits!.f, cut: G.attrWits!.cut ?? [], top: G.attrWits!.top ?? [] });
def('uiHome', { cat: 'ui', f: G.mkHome!.f, s: G.mkHome!.s ?? [], cut: G.mkHome!.cut ?? [] });
def('uiMuster', {
  cat: 'ui',
  f: [PG(58, 6, 46, 10, 54, 18), P('M8 50L14 56L10 58Q6 58 6 54Z')],
  s: [S('M52 12L12 52', 3.6)],
  cut: [S('M16 48L20 44', 1.6)],
  top: [P('M54 5Q60 1 60 8Q58 4 55 7Z')],
});
def('uiBuild', merge('ui', { f: [R(4, 46, 56, 10, 2)], cut: [S('M4 51H60', 1.2)] }, moved(axe(), 'rotate(30 32 32) translate(0 -6)')));
def('uiRepair', { cat: 'ui', f: [T('rotate(-40 32 32)', R(14, 10, 22, 12, 2)), R(4, 48, 56, 9, 2)], s: [S('M30 22L48 46', 4)], cut: [S('M14 48L18 57M40 48L36 57', 1.4)] });
def('uiFeast', merge('ui', { f: G.mead!.f, cut: G.mead!.cut ?? [] }));
def('uiOmen', { cat: 'ui', f: [T('rotate(-18 20 34)', R(15, 10, 9, 46, 2)), T('rotate(4 33 32)', R(28.5, 8, 9, 48, 2)), T('rotate(24 46 34)', R(41.5, 12, 9, 44, 2))], cut: [T('rotate(-18 20 34)', S('M19.5 18V44M19.5 24L23 20', 1.6)), T('rotate(4 33 32)', S('M33 16V46M29 24L37 30', 1.6)), T('rotate(24 46 34)', S('M46 20V46M46 30L42 34', 1.6))] });
def('uiSearch', magnifier(''));
def('uiSound', {
  cat: 'ui',
  // A cow-horn blown from the left, with sound rolling out of the bell.
  f: [P('M5 47Q4 43 8 42Q22 38 31 15Q33 11 37 13L46 21Q49 24 46 27Q30 49 10 52Q6 52 5 47Z')],
  s: [S('M47 9Q55 13 57 21', 3.4), S('M50 2Q62 8 63 21', 3.4), S('M5 45L2 47', 3)],
  cut: [E(40.5, 19.5, 6.5, 2.6, 41), S('M12 47Q26 44 36 28', 1.4)],
});
def('uiMusic', {
  cat: 'ui',
  // A round-shouldered lyre: yoke, two arms, soundbox and strings.
  f: [P('M12 8Q8 8 8 14V44Q8 58 22 58H42Q56 58 56 44V14Q56 8 52 8Q48 8 48 14V40H16V14Q16 8 12 8Z'), R(8, 6, 48, 7, 3)],
  cut: [S('M22 13V50M27 13V50M32 13V50M37 13V50M42 13V50', 1.4), R(18, 48, 28, 4, 1.5)],
});
def('uiVoice', {
  cat: 'ui',
  // A speaker in profile with words leaving the lips.
  f: [P('M8 58V46Q4 40 6 30Q8 12 24 8Q40 6 42 22L46 32L41 34Q42 44 34 44H28V58Z')],
  s: [S('M50 26Q55 32 50 38', 3), S('M56 20Q64 32 56 44', 3)],
  cut: [C(32, 22, 2.4)],
});

// --- Seasons, weather, time of day
def('seasonSpring', { cat: 'season', f: [P('M31 58V36Q20 38 12 30Q8 22 12 14Q24 14 30 24Q31 28 31 34Z'), P('M33 40Q40 30 50 30Q58 32 58 40Q48 46 38 42Q34 41 33 44Z'), P('M10 60Q32 52 54 60Z')], cut: [S('M14 18Q22 22 29 32', 1.4), S('M54 38Q46 38 37 41', 1.4)] });
def('seasonSummer', merge('season', sun(32, 32, 13, 12, 10, true)));
def('seasonAutumn', { cat: 'season', f: [P('M32 4Q38 14 44 12Q42 20 50 22Q46 28 54 34Q46 36 46 44Q38 42 34 48V58H30V48Q26 42 18 44Q18 36 10 34Q18 28 14 22Q22 20 20 12Q26 14 32 4Z')], cut: [S('M32 50V14M32 24L24 18M32 24L40 18M32 34L20 30M32 34L44 30', 1.4)] });
def('seasonWinter', { cat: 'season', f: [], s: [S('M32 4V60M8 18L56 46M8 46L56 18', 4), S('M24 8L32 16L40 8M24 56L32 48L40 56M8 28L16 25L13 16M56 36L48 39L51 48M8 36L16 39L13 48M56 28L48 25L51 16', 3)] });
def('wxWind', { cat: 'weather', f: [], s: [S('M4 22H40Q50 22 50 14Q50 7 43 7Q37 7 37 13', 4), S('M4 34H52Q60 34 60 42Q60 50 52 50Q46 50 46 44', 4), S('M4 46H28', 4)] });
def('wxRain', { cat: 'weather', f: [cloud(32, 22, 1.05)], s: [S('M18 38L14 48M30 38L26 48M42 38L38 48M24 50L20 60M36 50L32 60', 3)] });
def('wxSnow', { cat: 'weather', f: [cloud(32, 22, 1.05), C(16, 44, 3.2), C(30, 42, 3.2), C(44, 44, 3.2), C(22, 55, 3.2), C(38, 56, 3.2)] });
def('wxFog', { cat: 'weather', f: [R(6, 12, 46, 6, 3), R(14, 24, 44, 6, 3), R(4, 36, 50, 6, 3), R(12, 48, 46, 6, 3)] });
def('wxStorm', { cat: 'weather', f: G.mkStorm!.f, cut: G.mkStorm!.cut ?? [], s: [S('M12 38L8 48M50 38L46 48', 3)] });
def('wxCalm', merge('weather', moved(sun(32, 26, 11, 8, 7), ''), { s: [S('M4 50H60', 3), S('M12 58H52', 3)] }));
def('timeDawn', { cat: 'time', f: [P('M14 46A18 18 0 0 1 50 46Z'), R(4, 48, 56, 4, 1.5)], s: [S('M32 22V14M18 28L13 23M46 28L51 23', 3), S('M10 58H54', 2.4)] });
def('timeDay', merge('time', sun(32, 32, 13, 8, 10)));
def('timeDusk', { cat: 'time', f: [P('M14 44A18 18 0 0 1 50 44Z'), R(4, 46, 56, 4, 1.5)], s: [S('M8 54H56M16 60H48', 2.4)], cut: [S('M14 38H50M18 32H46', 1.6)] });
def('timeNight', { cat: 'time', f: [P('M38 6Q22 10 20 30Q20 50 40 56Q26 58 16 50Q4 40 6 26Q10 8 30 4Q34 4 38 6Z'), star(46, 18, 6, 2.5, 4), star(52, 38, 4, 1.6, 4)] });

// --- Omens (§4.4)
def('omenIll', { cat: 'omen', f: [P('M4 34Q12 22 24 28L32 20Q38 14 44 18L52 16L46 22Q48 30 40 34L50 46L38 40L30 48L30 38Q16 42 4 34Z')], cut: [C(42, 20, 1.8)] });
def('omenUncertain', { cat: 'omen', f: [P('M32 6A26 26 0 0 0 32 58Z')], s: [SC(32, 32, 24, 3)] });
def('omenFair', merge('omen', sun(32, 32, 12, 8, 9)));
def('omenBlessed', merge('omen', { f: [star(32, 32, 29, 9, 8, -Math.PI / 8)] }, { f: [C(32, 32, 12)] }, { cut: [SC(32, 32, 8, 2)] }));

/** Every glyph, by id. */
export const GLYPHS: Readonly<Record<string, Glyph>> = G;

/** Glyph ids in definition order. */
export const GLYPH_IDS: readonly string[] = Object.keys(G);

/** Default glyph per category (fallback for unknown ids). */
export const CATEGORY_DEFAULT: Readonly<Record<IconCategory, string>> = {
  resource: 'goods',
  good: 'goods',
  unit: 'unitSpear',
  ship: 'shipKarvi',
  skill: 'skillRunecraft',
  attribute: 'attrMight',
  trait: 'traitVirtue',
  god: 'godValgrim',
  faith: 'faithOldWays',
  building: 'bldHall',
  marker: 'mkSite',
  ui: 'uiInfo',
  season: 'seasonSummer',
  weather: 'wxWind',
  time: 'timeDay',
  omen: 'omenFair',
};

/**
 * Aliases from game vocabularies to glyphs (goods, ship types, skills, attributes, gods, faiths,
 * buildings, units and omen ids map onto the set), so `icon` params may use content ids directly.
 */
export const GLYPH_ALIASES: Readonly<Record<string, string>> = {
  // goods §30.1
  rations: 'rations',
  // ships
  karvi: 'shipKarvi',
  snekkja: 'shipSnekkja',
  drakkar: 'shipDrakkar',
  knarr: 'shipKnarr',
  galley: 'shipGalley',
  riverboat: 'shipRiverboat',
  // skills
  melee: 'skillMelee',
  archery: 'skillArchery',
  command: 'skillCommand',
  seafaring: 'skillSeafaring',
  wildcraft: 'skillWildcraft',
  speechcraft: 'skillSpeechcraft',
  stewardship: 'skillStewardship',
  runecraft: 'skillRunecraft',
  // attributes
  might: 'attrMight',
  agility: 'attrAgility',
  wits: 'attrWits',
  vigor: 'attrVigor',
  // gods and faiths
  valgrim: 'godValgrim',
  dunnar: 'godDunnar',
  saltha: 'godSaltha',
  fjorna: 'godFjorna',
  eidr: 'godEidr',
  skell: 'godSkell',
  grayQueen: 'godGrayQueen',
  oldways: 'faithOldWays',
  lantern: 'faithLantern',
  goldenLantern: 'faithGoldenLantern',
  riverSpirits: 'faithRiverSpirits',
  highSky: 'faithHighSky',
  // buildings §10.4
  hall: 'bldHall',
  walls: 'bldWalls',
  smithy: 'bldSmithy',
  shipyard: 'bldShipyard',
  market: 'bldMarket',
  grove: 'bldGrove',
  farms: 'bldFarms',
  watchtowers: 'bldWatchtower',
  meadhall: 'bldMeadhall',
  seersHut: 'bldSeersHut',
  // omens
  ill: 'omenIll',
  uncertain: 'omenUncertain',
  fair: 'omenFair',
  blessed: 'omenBlessed',
  // seasons
  spring: 'seasonSpring',
  summer: 'seasonSummer',
  autumn: 'seasonAutumn',
  winter: 'seasonWinter',
  // units (balance.units)
  bondi: 'unitSpear',
  huscarls: 'unitAxe',
  archers: 'unitBow',
  skirmishers: 'unitJavelin',
  berserkers: 'unitBerserker',
  wolfcoats: 'unitWolfcoat',
  fjordWallHuscarls: 'unitAxe',
  elkBowArchers: 'unitBow',
  strandRiders: 'unitHorse',
  fyrdSpearmen: 'unitSpear',
  thegns: 'unitElite',
  albricBowmen: 'unitBow',
  caelRaiders: 'unitJavelin',
  cloisterGuard: 'unitSpear',
  horsemen: 'unitHorse',
  javelinmen: 'unitJavelin',
  menAtArms: 'unitElite',
  horseArchers: 'unitHorseArcher',
  steppeHorseArchers: 'unitHorseArcher',
  druzhina: 'unitElite',
  emberGuard: 'unitElite',
  outlaws: 'unitOutlaw',
  barrowWardens: 'unitElite',
  hermitClan: 'unitOutlaw',
  wolfPack: 'unitWolf',
  greatBear: 'unitBear',
  wreckers: 'unitOutlaw',
};

/** Resolves a glyph id or alias; unknown ids yield undefined. */
export function glyphFor(id: string): Glyph | undefined {
  if (Object.hasOwn(G, id)) return G[id];
  const alias = Object.hasOwn(GLYPH_ALIASES, id) ? GLYPH_ALIASES[id] : undefined;
  return alias !== undefined && Object.hasOwn(G, alias) ? G[alias] : undefined;
}
