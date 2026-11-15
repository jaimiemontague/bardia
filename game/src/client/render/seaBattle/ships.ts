/**
 * Ships drawn in code (top-down, original art): a clinker hull by type (double-ended longships, the
 * broad knarr, the long galley with its bronze beak), the deck, shields on the rail in the side's
 * colours, the mast with the square sail set (striped, bellied downwind, burning or torn) or furled
 * on the yard, oars sweeping when the crew rows, the crew as dots on deck, a pennant on the
 * flagship, smoke, flames and a list to one side as the hull is beaten in.
 *
 * Geometry is in the ship's frame: u along the keel (bow +, metres), v to starboard (metres).
 */
import type { Graphics } from 'pixi.js';
import type { SeaShipView } from '@sim/seabattle/index';
import { FX, hash01, mixHex, SHIP, type SidePalette } from './palette';

export type HullKind = 'longship' | 'knarr' | 'galley';

/** Compass heading (degrees, 0 = north, clockwise) → screen unit vector (y grows south). */
export function forwardOf(headingDeg: number): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  return [Math.sin(h), -Math.cos(h)];
}

export function hullKind(type: string): HullKind {
  if (type === 'knarr') return 'knarr';
  if (type === 'galley') return 'galley';
  return 'longship';
}

/** Half-beam (metres) at t ∈ [−1, 1] along the hull (−1 stern, +1 bow). */
export function halfBeam(kind: HullKind, beamM: number, t: number): number {
  const a = Math.min(1, Math.abs(t));
  const B = beamM / 2;
  if (kind === 'knarr') return B * Math.pow(Math.max(0, 1 - Math.pow(a, 3)), 0.6);
  if (kind === 'galley') {
    if (t < 0) return B * Math.pow(Math.max(0, 1 - Math.pow(a, 5)), 0.5) * (a > 0.96 ? 0.6 : 1);
    return B * Math.pow(Math.max(0, 1 - Math.pow(a, 3.2)), 0.55);
  }
  return B * Math.pow(Math.max(0, 1 - Math.pow(a, 2.2)), 0.75);
}

/** Hull outline in the ship's frame: [u, v] pairs around the hull (starboard bow→stern, then port). */
export function hullOutline(kind: HullKind, lengthM: number, beamM: number, steps = 14, widthScale = 1, lengthScale = 1): [number, number][] {
  const L = (lengthM / 2) * lengthScale;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = 1 - (2 * i) / steps;
    pts.push([t * L, halfBeam(kind, beamM, t) * widthScale]);
  }
  for (let i = steps - 1; i >= 1; i--) {
    const t = 1 - (2 * i) / steps;
    pts.push([t * L, -halfBeam(kind, beamM, t) * widthScale]);
  }
  return pts;
}

/** What drawShip needs besides the ship. */
export interface ShipDrawCtx {
  /** Screen position of the ship's centre and its heading (degrees, interpolated). */
  sx: number;
  sy: number;
  heading: number;
  /** Pixels per metre for this ship (camera scale × inflation). */
  k: number;
  /** Extra breadth when drawn larger than life (slender hulls stay readable), 1 = true to life. */
  beamScale?: number;
  pal: SidePalette;
  /** The captor's palette for a taken ship. */
  captor?: SidePalette;
  /** Real seconds (animation clock). */
  t: number;
  /** Downwind unit vector (screen). */
  downX: number;
  downY: number;
  /** Compass bearing the wind blows from (degrees). */
  windFrom: number;
  /** Men of the other crew fighting on this deck (boarding), 0 when none. */
  boarders: number;
  boarderPal?: SidePalette;
  /** 0..1 while sinking (1 = gone), else 0. */
  sinking: number;
  playerFlag: boolean;
}

/** Draws one ship. */
export function drawShip(g: Graphics, s: SeaShipView, c: ShipDrawCtx): void {
  const kind = hullKind(s.type);
  const [fx, fy] = forwardOf(c.heading);
  const rx = -fy;
  const ry = fx;
  // Listing ships wallow: a slow roll shifts the hull a little.
  const damage = 1 - s.hullPct;
  const roll = damage > 0.45 && c.sinking === 0 ? Math.sin(c.t * 1.3 + s.idx) * damage * 0.25 : 0;
  const k = c.k * (1 - c.sinking * 0.25);
  const bs = c.beamScale ?? 1;
  const P = (u: number, v: number): [number, number] => [c.sx + (fx * u + rx * (v + roll) * bs) * k, c.sy + (fy * u + ry * (v + roll) * bs) * k];
  const poly = (pts: [number, number][]): number[] => {
    const out: number[] = [];
    for (const [u, v] of pts) {
      const [x, y] = P(u, v);
      out.push(x, y);
    }
    return out;
  };
  const L = s.lengthM;
  const B = s.beamM;
  const alpha = 1 - c.sinking;
  const gone = s.status === 'sunk' || s.status === 'burned';
  const taken = s.status === 'captured';
  const struck = s.status === 'struck';
  const pal = taken && c.captor ? c.captor : c.pal;

  // Wake: a foaming V from the stern and a bow wave, fading behind the ship.
  if (!gone && s.speedMs > 0.4) {
    const w = Math.min(1, s.speedMs / 4);
    const len = L * (0.22 + 0.4 * w);
    for (let i = 0; i < 4; i++) {
      const f0 = i / 4;
      const f1 = (i + 1) / 4;
      const a = 0.4 * w * (1 - f0);
      for (const side of [1, -1]) {
        const [x0, y0] = P(-L * 0.45 - len * f0, side * (B * 0.4 + len * f0 * 0.5));
        const [x1, y1] = P(-L * 0.45 - len * f1, side * (B * 0.4 + len * f1 * 0.5));
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: Math.max(1.2, (0.7 - 0.12 * i) * k), color: 0xeef8f8, alpha: a });
      }
      if (i < 2) {
        const [c0x, c0y] = P(-L * 0.48 - len * f0 * 0.5, 0);
        const [c1x, c1y] = P(-L * 0.48 - len * f1 * 0.5, 0);
        g.moveTo(c0x, c0y).lineTo(c1x, c1y).stroke({ width: Math.max(2, B * (0.5 + f0 * 0.4) * k), color: 0xdff0f0, alpha: 0.08 * w * (1 - f0 * 1.5) });
      }
    }
    const [px0, py0] = P(L * 0.42, B * 0.75);
    const [px1, py1] = P(L * 0.53, 0);
    const [px2, py2] = P(L * 0.42, -B * 0.75);
    g.moveTo(px0, py0).lineTo(px1, py1).lineTo(px2, py2).stroke({ width: Math.max(1.2, 0.5 * k), color: 0xffffff, alpha: 0.5 * w });
  }

  // A shadow on the water under the hull.
  if (c.sinking < 0.8) {
    const sh = hullOutline(kind, L, B).map(([u, v]) => {
      const [x, y] = P(u, v);
      return [x + 2 + 0.25 * k, y + 3 + 0.35 * k] as const;
    });
    g.poly(sh.flatMap((p) => [p[0], p[1]])).fill({ color: 0x06141a, alpha: 0.35 * alpha });
  }

  // Oars (under the hull so they come out of the rail).
  const rowing = !gone && !taken && !struck && s.status === 'active' && s.grappledTo < 0 && (s.rowing || s.propulsion === 'oars') && s.rowers > 0;
  if (rowing && kind !== 'knarr') {
    const ports = Math.max(3, Math.round((L * 0.55) / 1.15));
    const n = Math.min(ports, Math.max(2, Math.ceil(s.rowers / 2)));
    const rate = 2.4 + Math.min(2, s.speedMs * 0.4);
    const sweep = Math.sin(c.t * rate + s.idx * 1.7);
    const len = Math.max(B * 1.1, 4.5);
    for (let i = 0; i < n; i++) {
      const t = -0.55 + (1.1 * (i + 0.5)) / n;
      const u = t * L * 0.5;
      for (const side of [1, -1]) {
        const v0 = halfBeam(kind, B, t) * side;
        const ang = sweep * 0.42;
        const du = Math.sin(ang) * len * -1;
        const dv = Math.cos(ang) * len * side;
        const [x0, y0] = P(u, v0);
        const [x1, y1] = P(u + du, v0 + dv);
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: Math.max(0.7, 0.18 * k), color: SHIP.oar, alpha: 0.6 * alpha });
        // A dab of white water at each blade on the stroke.
        if (sweep > 0.6 && k > 1.2) g.circle(x1, y1, Math.max(0.8, 0.35 * k)).fill({ color: 0xffffff, alpha: 0.35 * alpha });
      }
    }
  }

  // Hull, deck, strakes.
  const hullColor = mixHex(SHIP.hull, 0x241810, Math.min(0.6, damage * 0.7));
  g.poly(poly(hullOutline(kind, L, B))).fill({ color: hullColor, alpha }).stroke({ width: Math.max(1.5, 0.3 * k), color: SHIP.hullDark, alpha });
  if (kind === 'galley') {
    // The bronze beak at the waterline.
    g.poly(poly([[L * 0.48, B * 0.16], [L * 0.62, 0], [L * 0.48, -B * 0.16]])).fill({ color: SHIP.bronze, alpha });
  }
  g.poly(poly(hullOutline(kind, L, B, 14, 0.74, 0.86))).fill({ color: taken || struck ? mixHex(SHIP.deck, 0x8a8478, 0.35) : SHIP.deck, alpha });
  if (k > 1.1) {
    for (const v of [-0.22, 0.22]) {
      const [x0, y0] = P(-L * 0.38, B * v);
      const [x1, y1] = P(L * 0.38, B * v);
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: Math.max(0.5, 0.12 * k), color: SHIP.deckLine, alpha: 0.6 * alpha });
    }
  }
  // Stem and stern posts (a curled prow; a dragon head on the drakkar).
  if (kind === 'longship') {
    const [bx, by] = P(L * 0.5, 0);
    const [tx, ty] = P(L * 0.56, B * 0.12);
    g.moveTo(bx, by).lineTo(tx, ty).stroke({ width: Math.max(1, 0.35 * k), color: SHIP.hullDark, alpha });
    const [sx0, sy0] = P(-L * 0.5, 0);
    const [sx1, sy1] = P(-L * 0.55, -B * 0.1);
    g.moveTo(sx0, sy0).lineTo(sx1, sy1).stroke({ width: Math.max(1, 0.3 * k), color: SHIP.hullDark, alpha });
    if (s.type === 'drakkar') {
      g.circle(tx, ty, Math.max(1.6, 0.5 * k)).fill({ color: SHIP.gold, alpha }).stroke({ width: 1, color: SHIP.hullDark, alpha });
    }
  }

  // Shields on the rail (warships), in the side's colours (the captor's on a prize).
  if (kind !== 'knarr' && kind !== 'galley' && !gone) {
    const n = Math.max(4, Math.round((L * 0.62) / 1.5));
    const r = Math.max(1.6, 0.5 * k * Math.min(1.3, bs));
    for (let i = 0; i < n; i++) {
      const t = -0.62 + (1.24 * (i + 0.5)) / n;
      for (const side of [1, -1]) {
        const [x, y] = P(t * L * 0.5, halfBeam(kind, B, t) * side * 0.9);
        const col = (i + (side > 0 ? 0 : 1)) % 2 === 0 ? pal.fill : pal.light;
        g.circle(x, y, r).fill({ color: struck ? SHIP.struck : col, alpha });
      }
    }
  } else if (!gone) {
    // A painted strake in the side's colour.
    const pts: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = -0.7 + (1.4 * i) / 8;
      pts.push([t * L * 0.5, halfBeam(kind, B, t) * 0.92]);
    }
    for (const side of [1, -1]) {
      const out = poly(pts.map(([u, v]) => [u, v * side] as [number, number]));
      g.moveTo(out[0]!, out[1]!);
      for (let i = 2; i < out.length; i += 2) g.lineTo(out[i]!, out[i + 1]!);
      g.stroke({ width: Math.max(1, 0.4 * k), color: struck ? SHIP.struck : pal.fill, alpha });
    }
  }

  // Crew on deck (and boarders fighting among them).
  if (!gone && s.crew > 0 && k > 0.55) {
    const own = Math.max(1, Math.min(18, Math.round(s.crew / 6)));
    const foe = c.boarders > 0 ? Math.max(1, Math.min(14, Math.round(c.boarders / 6))) : 0;
    const total = own + foe;
    const r = Math.max(0.9, 0.42 * k);
    const fighting = foe > 0;
    for (let i = 0; i < total; i++) {
      const row = i % 2 === 0 ? 1 : -1;
      const t = -0.55 + (1.1 * (Math.floor(i / 2) + 0.5)) / Math.ceil(total / 2);
      let u = t * L * 0.5;
      let v = row * B * 0.2;
      if (fighting) {
        const ph = Math.floor(c.t * 6) + i * 13;
        u += (hash01(ph, i, 1) - 0.5) * 1.2;
        v += (hash01(ph, i, 2) - 0.5) * B * 0.3;
      }
      const isFoe = fighting && i % 3 === 1 && i / 3 < foe;
      const [x, y] = P(u, v);
      const col = struck ? SHIP.struck : isFoe ? (c.boarderPal?.light ?? 0xffffff) : pal.light;
      g.circle(x, y, r).fill({ color: col, alpha }).stroke({ width: Math.max(0.5, r * 0.35), color: isFoe ? (c.boarderPal?.dark ?? 0) : pal.dark, alpha: 0.8 * alpha });
    }
    if (fighting) {
      // The press of the deck fight: a warm haze of struggle, and steel flashing.
      const pulse = 0.5 + 0.5 * Math.sin(c.t * 5 + s.idx);
      g.poly(poly(hullOutline(kind, L, B, 12, 1.25, 0.95))).fill({ color: 0xffb060, alpha: (0.1 + 0.08 * pulse) * alpha });
      for (let j = 0; j < 8; j++) {
        const ph = Math.floor(c.t * 10) + j * 7 + s.idx * 3;
        const [x, y] = P((hash01(ph, j, 4) - 0.5) * L * 0.6, (hash01(ph, j, 5) - 0.5) * B * 0.5);
        const a = hash01(ph, j, 6) * Math.PI;
        const len = Math.max(3.5, 1.1 * k);
        g.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len)
          .lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
          .stroke({ width: 1.8, color: j % 2 === 0 ? 0xfff3c4 : 0xffb347, alpha: 0.95 });
      }
    }
  }

  // Listing: the low side awash.
  if (!gone && damage > 0.45) {
    const wash = Math.min(1, (damage - 0.45) / 0.45);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = 0.85 - (1.7 * i) / 10;
      pts.push([t * L * 0.5, halfBeam(kind, B, t)]);
    }
    for (let i = 10; i >= 0; i--) {
      const t = 0.85 - (1.7 * i) / 10;
      pts.push([t * L * 0.5, halfBeam(kind, B, t) * (1 - 0.7 * wash)]);
    }
    g.poly(poly(pts)).fill({ color: 0x2c6a76, alpha: 0.55 * alpha });
  }

  // Mast, sail and flag.
  const mu = kind === 'galley' ? L * 0.08 : L * 0.04;
  const [mx, my] = P(mu, 0);
  if (!gone) {
    const sailUp = s.sailSet && s.sailPct > 0.02 && !taken;
    const wantW = Math.min(B * 2.6, L * 0.48) * (kind === 'galley' ? 0.8 : 1);
    // Yard trimmed toward the wind: perpendicular to the keel, turned up to 45° with the wind.
    const rel = (((c.windFrom - c.heading) % 360) + 540) % 360 - 180;
    const trim = (Math.max(-45, Math.min(45, rel * 0.4)) * Math.PI) / 180;
    const yu = Math.sin(trim);
    const yv = Math.cos(trim);
    const half = wantW / 2;
    const [ax, ay] = P(mu + yu * half, yv * half);
    const [bx, by] = P(mu - yu * half, -yv * half);
    if (sailUp) {
      const belly = wantW * 0.42 * (0.4 + 0.6 * s.sailPct);
      const ox = c.downX * belly * k;
      const oy = c.downY * belly * k;
      const midx = (ax + bx) / 2 + ox;
      const midy = (ay + by) / 2 + oy;
      const burning = s.sailBurning;
      const flick = 0.5 + 0.5 * Math.sin(c.t * 11 + s.idx);
      const cloth = burning ? mixHex(SHIP.sailCloth, FX.fire, 0.5 + 0.3 * flick) : SHIP.sailCloth;
      const sa = alpha * (0.45 + 0.55 * s.sailPct);
      g.moveTo(ax, ay).quadraticCurveTo(midx + ox, midy + oy, bx, by).lineTo(ax, ay).fill({ color: cloth, alpha: sa }).stroke({ width: 1, color: SHIP.hullDark, alpha: sa * 0.6 });
      // Stripes in the side's colour.
      for (const f of [0.2, 0.5, 0.8]) {
        const px = ax + (bx - ax) * f;
        const py = ay + (by - ay) * f;
        const bulge = 1 - Math.pow(2 * f - 1, 2);
        g.moveTo(px, py).lineTo(px + ox * bulge * 0.9, py + oy * bulge * 0.9).stroke({ width: Math.max(1, wantW * 0.12 * k), color: taken ? SHIP.struck : pal.sail, alpha: sa * 0.9 });
      }
      if (s.sailPct < 0.5) {
        for (let j = 0; j < 3; j++) {
          const f = 0.2 + 0.3 * j;
          g.circle(ax + (bx - ax) * f + ox * 0.5, ay + (by - ay) * f + oy * 0.5, Math.max(1, wantW * 0.07 * k)).fill({ color: 0x1b3c48, alpha: 0.8 * alpha });
        }
      }
      if (burning) {
        for (let j = 0; j < 4; j++) {
          const f = 0.15 + 0.23 * j;
          const fl = 0.6 + 0.4 * Math.sin(c.t * 9 + j * 1.9);
          const X = ax + (bx - ax) * f + ox * 0.6;
          const Y = ay + (by - ay) * f + oy * 0.6;
          g.circle(X, Y, Math.max(2, 1.1 * k * fl)).fill({ color: FX.fire, alpha: 0.8 });
          g.circle(X, Y, Math.max(1, 0.55 * k * fl)).fill({ color: FX.fireCore, alpha: 0.9 });
        }
      }
      g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: Math.max(1, 0.3 * k), color: SHIP.mast, alpha });
    } else {
      // Furled on the yard: a thin roll along the beam.
      const [fa, fb] = [P(mu, half * 0.7), P(mu, -half * 0.7)];
      g.moveTo(fa[0], fa[1]).lineTo(fb[0], fb[1]).stroke({ width: Math.max(1.4, 0.55 * k), color: s.sailPct > 0.02 ? SHIP.sailCloth : SHIP.mast, alpha: 0.9 * alpha });
      if (s.sailBurning) {
        for (let j = 0; j < 3; j++) {
          const f = 0.2 + 0.3 * j;
          const fl = 0.6 + 0.4 * Math.sin(c.t * 9 + j * 1.9 + s.idx);
          const X = fa[0] + (fb[0] - fa[0]) * f;
          const Y = fa[1] + (fb[1] - fa[1]) * f;
          g.circle(X, Y, Math.max(2.5, 1.0 * k * fl)).fill({ color: FX.fire, alpha: 0.8 });
          g.circle(X, Y, Math.max(1.2, 0.5 * k * fl)).fill({ color: FX.fireCore, alpha: 0.9 });
        }
      }
    }
    g.circle(mx, my, Math.max(1.2, 0.35 * k)).fill({ color: SHIP.mast, alpha });
    // Flags: the player's own banner, a flagship pennant, a white flag when struck, the captor's on a prize.
    const flagColor = struck ? SHIP.white : taken && c.captor ? c.captor.fill : c.playerFlag ? SHIP.gold : s.isFlagship ? pal.fill : -1;
    if (flagColor >= 0) {
      const fl = Math.sin(c.t * 7 + s.idx) * 0.25;
      const len = Math.max(7, 2.4 * k);
      const dx = c.downX + fl * c.downY;
      const dy = c.downY - fl * c.downX;
      const nx = -dy;
      const ny = dx;
      const w = len * 0.42;
      g.poly([mx, my, mx + dx * len + nx * w * 0.2, my + dy * len + ny * w * 0.2, mx + nx * w, my + ny * w]).fill({ color: flagColor, alpha }).stroke({ width: 1, color: FX.ink, alpha: 0.7 * alpha });
    }
  }

  // Fire on the planking.
  if (!gone && s.hullBurning) {
    for (let j = 0; j < 5; j++) {
      const fl = 0.55 + 0.45 * Math.sin(c.t * 8 + j * 2.3 + s.idx);
      const [x, y] = P((-0.35 + 0.17 * j) * L, (hash01(j, s.idx, 8) - 0.5) * B * 0.6);
      g.circle(x, y, Math.max(2.5, 1.0 * k * fl)).fill({ color: FX.fire, alpha: 0.75 });
      g.circle(x, y - 0.3 * k, Math.max(1.2, 0.5 * k * fl)).fill({ color: FX.fireCore, alpha: 0.9 });
    }
  }
}

/** Smoke drifting downwind from a damaged or burning ship. */
export function drawSmoke(g: Graphics, s: SeaShipView, c: Pick<ShipDrawCtx, 'sx' | 'sy' | 'k' | 't' | 'downX' | 'downY'>): void {
  const burning = s.hullBurning || s.sailBurning;
  const damage = 1 - s.hullPct;
  if (!burning && damage < 0.35) return;
  const n = burning ? 7 : Math.round(2 + damage * 5);
  for (let i = 0; i < n; i++) {
    const ph = (c.t * (burning ? 0.45 : 0.3) + i / n + s.idx * 0.13) % 1;
    const dist = ph * (burning ? 34 : 22) * c.k;
    const wob = Math.sin((ph + i) * 5) * 3 * c.k * ph;
    const x = c.sx + c.downX * dist - c.downY * wob;
    const y = c.sy + c.downY * dist + c.downX * wob;
    g.circle(x, y, Math.max(2.5, (1.4 + ph * 5) * c.k)).fill({ color: burning ? 0x3b3633 : FX.smoke, alpha: (1 - ph) * (burning ? 0.38 : 0.24) });
  }
}

/** A short rope between two points with a little sag (grapnel lines). */
export function drawRope(g: Graphics, x0: number, y0: number, x1: number, y1: number, sag: number, width: number): void {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.max(1e-6, Math.hypot(dx, dy));
  g.moveTo(x0, y0)
    .quadraticCurveTo(mx - (dy / d) * sag, my + (dx / d) * sag, x1, y1)
    .stroke({ width: width + 1.2, color: 0x1a120c, alpha: 0.6 })
    .moveTo(x0, y0)
    .quadraticCurveTo(mx - (dy / d) * sag, my + (dx / d) * sag, x1, y1)
    .stroke({ width, color: FX.rope, alpha: 0.95 });
}
