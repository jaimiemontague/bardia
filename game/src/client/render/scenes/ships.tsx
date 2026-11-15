/**
 * Ships for the scenes: other hulls seen side-on across the water (sized and rigged by type, sails in their
 * lord's colours, faded by distance), and our own bow seen from the deck, which frames every sea scene.
 */
import type { ReactElement } from 'react';
import { aerial, BONE, INK, mix, PLAYER_COLOUR, shade, VIEW_W, type Light } from './paint';

/** How each hull type looks (len: relative hull length). */
export const SHIP_LOOK: Readonly<Record<string, { len: number; high: boolean; shields: boolean; oars: number; rig: 'square' | 'lateen' | 'none'; head: boolean }>> = {
  karvi: { len: 0.8, high: false, shields: true, oars: 5, rig: 'square', head: false },
  snekkja: { len: 1, high: false, shields: true, oars: 7, rig: 'square', head: false },
  drakkar: { len: 1.3, high: false, shields: true, oars: 10, rig: 'square', head: true },
  knarr: { len: 0.95, high: true, shields: false, oars: 0, rig: 'square', head: false },
  galley: { len: 1.25, high: false, shields: false, oars: 12, rig: 'lateen', head: false },
  riverboat: { len: 0.6, high: false, shields: false, oars: 4, rig: 'none', head: false },
};

export interface ShipPaint {
  /** Sail cloth and its stripe (their lord's colour). */
  sail: string;
  stripe: string;
  /** Shield colours on the rail. */
  shieldA: string;
  shieldB: string;
}

/** Sail and shields for a lord's colour (raiders without a lord: weathered brown and black). */
export function shipPaint(colour: string | undefined, rough = false): ShipPaint {
  if (!colour) return { sail: rough ? '#5a3a2a' : '#cdbb92', stripe: rough ? '#2a1c16' : '#7a6a52', shieldA: '#3a2a20', shieldB: '#6a5038' };
  return { sail: rough ? mix(colour, '#3a2418', 0.35) : BONE, stripe: colour, shieldA: colour, shieldB: BONE };
}

/**
 * A ship side-on. (x, y) is the waterline at mid-ship; `L` the hull length in px. `distance` (0 near … 1
 * far) fades it toward the haze. `facing` 1 = bow to the right.
 */
export function SideShip({
  x,
  y,
  L,
  type,
  paint,
  light,
  distance,
  facing = 1,
  oarsOut = false,
  furled = false,
  lit = false,
  bob = 0,
}: {
  x: number;
  y: number;
  L: number;
  type: string;
  paint: ShipPaint;
  light: Light;
  distance: number;
  facing?: 1 | -1;
  oarsOut?: boolean;
  furled?: boolean;
  lit?: boolean;
  /** Bob animation phase (seconds of delay). */
  bob?: number;
}): ReactElement {
  const look = SHIP_LOOK[type] ?? SHIP_LOOK['snekkja']!;
  const d = distance;
  // Near hulls take the hour's light too: dusk and night darken them before the haze fades them.
  const dim = light.tod === 'day' ? 0 : light.tod === 'night' ? 0.55 : 0.28;
  const c = (col: string) => aerial(light, shade(col, dim * (1 - d * 0.5)), d);
  const hullCol = c('#2e1d10');
  const hullLit = c(mix('#5c4329', light.rim, 0.25));
  const ink = c(INK);
  const k = look.high ? 1.3 : 1;
  const g = -0.07 * L * k;
  const end = look.rig === 'lateen' ? -0.16 * L : -0.24 * L;
  const hull = `M${-0.5 * L} ${end} C ${-0.42 * L} ${-0.1 * L}, ${-0.32 * L} ${g}, ${-0.2 * L} ${g} L${0.2 * L} ${g} C ${0.32 * L} ${g}, ${0.42 * L} ${-0.1 * L}, ${0.5 * L} ${end} C ${0.46 * L} ${-0.07 * L}, ${0.34 * L} ${0.03 * L}, ${0.2 * L} ${0.03 * L} L${-0.2 * L} ${0.03 * L} C ${-0.34 * L} ${0.03 * L}, ${-0.46 * L} ${-0.07 * L}, ${-0.5 * L} ${end} Z`;
  const detail = L >= 70;
  const sw = Math.max(0.8, L / 110);
  const parts: ReactElement[] = [];

  // Oars (behind the hull, into the water).
  if ((oarsOut || look.rig === 'none' || look.rig === 'lateen') && look.oars > 0 && detail) {
    for (let i = 0; i < look.oars; i++) {
      const ox = -0.3 * L + (i * 0.6 * L) / Math.max(1, look.oars - 1);
      parts.push(<line key={`o${i}`} className="scn-oar" style={{ animationDelay: `${bob}s` }} x1={ox} y1={g + 2} x2={ox - 0.07 * L} y2={0.1 * L} stroke={c('#4a3420')} strokeWidth={sw * 1.4} />);
    }
  }
  // Mast, yard and sail.
  const mastTop = -0.66 * L;
  if (look.rig === 'square') {
    const top = -0.56 * L;
    const bot = furled ? top + 0.05 * L : -0.17 * L;
    const hw = 0.3 * L;
    const bulge = furled ? 0 : 0.05 * L;
    parts.push(<line key="mast" x1={0} y1={g} x2={0} y2={mastTop} stroke={c('#1d140d')} strokeWidth={Math.min(sw * 2.6, 12)} />);
    parts.push(<line key="stayf" x1={0} y1={mastTop} x2={0.47 * L} y2={end} stroke={ink} strokeWidth={sw * 0.6} opacity={0.6} />);
    parts.push(<line key="stayb" x1={0} y1={mastTop} x2={-0.47 * L} y2={end} stroke={ink} strokeWidth={sw * 0.6} opacity={0.6} />);
    if (furled) {
      // The sail lashed to its yard: a bundle of cloth sagging between the ties.
      const fh = Math.min(0.04 * L, 14);
      const bundle = `M${-hw} ${top} Q ${-hw * 0.5} ${top + fh * 1.6} 0 ${top + fh * 0.6} Q ${hw * 0.5} ${top + fh * 1.6} ${hw} ${top} Z`;
      parts.push(<path key="furl" d={bundle} fill={c(shade(paint.sail, 0.25))} stroke={ink} strokeWidth={Math.min(sw * 0.6, 2)} />);
      parts.push(<path key="furl2" d={`M${-hw * 0.8} ${top + fh * 0.3} Q 0 ${top + fh * 0.9} ${hw * 0.8} ${top + fh * 0.3}`} stroke={c(paint.stripe)} strokeWidth={Math.min(sw, 3)} fill="none" opacity={0.7} />);
    } else {
      const n = 6;
      const bottom = (u: number) => bot + bulge * 4 * u * (1 - u);
      const xAt = (u: number, yy: number) => -hw * (1 + 0.04 * ((yy - top) / (bot - top))) + 2 * hw * u * (1 + 0.04 * ((yy - top) / (bot - top)));
      const sailFill = c(paint.sail);
      const stripeFill = c(paint.stripe);
      const stripes: ReactElement[] = [];
      for (let i = 0; i < n; i++) {
        const u0 = i / n;
        const u1 = (i + 1) / n;
        const um = (u0 + u1) / 2;
        stripes.push(
          <path
            key={i}
            d={`M${xAt(u0, top)} ${top} L${xAt(u1, top)} ${top} L${xAt(u1, bottom(u1))} ${bottom(u1)} L${xAt(um, bottom(um))} ${bottom(um)} L${xAt(u0, bottom(u0))} ${bottom(u0)} Z`}
            fill={i % 2 === 0 ? sailFill : stripeFill}
          />,
        );
      }
      parts.push(
        <g key="sail" className="scn-sail" style={{ animationDelay: `${bob * 0.7}s` }}>
          {stripes}
          <path d={`M${-hw} ${top} L${hw} ${top} L${hw * 1.04} ${bot} Q 0 ${bot + bulge * 2} ${-hw * 1.04} ${bot} Z`} fill="none" stroke={ink} strokeWidth={sw * 0.9} opacity={0.75} />
          {detail && <path d={`M${-hw} ${top + 0.02 * L} Q 0 ${top + 0.1 * L} ${hw} ${top + 0.02 * L}`} stroke={c(light.rim)} strokeWidth={sw} fill="none" opacity={0.25} />}
        </g>,
      );
    }
    const yw = Math.min(sw * 3, 7);
    parts.push(<rect key="yard" x={-hw * 1.08} y={top - yw * 0.55} width={hw * 2.16} height={yw} rx={yw / 2} fill={c('#1d140d')} />);
  } else if (look.rig === 'lateen') {
    const foot = g - 0.02 * L;
    parts.push(<line key="mast" x1={0.05 * L} y1={g} x2={0.05 * L} y2={-0.5 * L} stroke={c('#1d140d')} strokeWidth={sw * 2.4} />);
    parts.push(<line key="yard" x1={-0.36 * L} y1={-0.12 * L} x2={0.34 * L} y2={-0.66 * L} stroke={c('#1d140d')} strokeWidth={sw * 1.8} />);
    parts.push(
      <g key="sail" className="scn-sail">
        <path d={`M${-0.34 * L} ${-0.13 * L} L${0.33 * L} ${-0.64 * L} Q ${0.3 * L} ${-0.3 * L} ${0.26 * L} ${foot} Z`} fill={c(paint.sail)} stroke={ink} strokeWidth={sw * 0.8} />
        <path d={`M${-0.05 * L} ${-0.36 * L} L${0.3 * L} ${-0.62 * L} Q ${0.28 * L} ${-0.35 * L} ${0.26 * L} ${-0.18 * L} Z`} fill={c(paint.stripe)} opacity={0.8} />
      </g>,
    );
  }
  // Hull.
  parts.push(<path key="hull" d={hull} fill={hullCol} stroke={ink} strokeWidth={sw} />);
  if (detail) {
    parts.push(<path key="strake" d={`M${-0.47 * L} ${end * 0.72} C ${-0.36 * L} ${-0.02 * L}, ${0.36 * L} ${-0.02 * L}, ${0.47 * L} ${end * 0.72}`} stroke={hullLit} strokeWidth={sw * 1.2} fill="none" />);
    parts.push(<path key="rim" d={`M${-0.42 * L} ${end * 0.6} C ${-0.32 * L} ${g}, ${0.32 * L} ${g}, ${0.42 * L} ${end * 0.6}`} stroke={c(light.rim)} strokeWidth={sw * 0.8} fill="none" opacity={0.35} />);
  }
  // Stem and stern posts, the dragon's head.
  if (look.rig !== 'lateen') {
    parts.push(<path key="stem" d={`M${0.5 * L} ${end} q ${0.03 * L} ${-0.08 * L} ${-0.02 * L} ${-0.12 * L}`} stroke={hullCol} strokeWidth={sw * 3} fill="none" strokeLinecap="round" />);
    parts.push(<path key="stern" d={`M${-0.5 * L} ${end} q ${-0.03 * L} ${-0.08 * L} ${0.02 * L} ${-0.12 * L}`} stroke={hullCol} strokeWidth={sw * 3} fill="none" strokeLinecap="round" />);
  }
  if (look.head) parts.push(<path key="head" d={`M${0.47 * L} ${end - 0.12 * L} l ${0.07 * L} ${-0.025 * L} l ${-0.015 * L} ${0.035 * L} l ${0.02 * L} ${0.012 * L} Z`} fill={hullCol} stroke={ink} strokeWidth={sw * 0.6} />);
  if (look.high && detail) {
    parts.push(<rect key="cargo" x={-0.16 * L} y={g - 0.06 * L} width={0.3 * L} height={0.06 * L} rx={sw * 2} fill={c('#7d5f38')} stroke={ink} strokeWidth={sw * 0.6} />);
  }
  if (look.shields && detail) {
    const sr = Math.max(1.6, Math.min(L * 0.022, 15));
    const n = Math.max(5, Math.min(Math.round(L / 18), Math.floor((0.64 * L) / (sr * 2.25)) + 1));
    for (let i = 0; i < n; i++) {
      const sx = -0.32 * L + (i * 0.64 * L) / Math.max(1, n - 1);
      parts.push(<circle key={`s${i}`} cx={sx} cy={g + sw * 0.5} r={sr} fill={c(i % 2 === 0 ? paint.shieldA : paint.shieldB)} stroke={ink} strokeWidth={Math.min(sw * 0.5, 2.5)} />);
      if (sr > 6) parts.push(<circle key={`b${i}`} cx={sx} cy={g + sw * 0.5} r={sr * 0.22} fill={c('#8a8478')} />);
    }
  }
  // Crew heads above the rail when close.
  if (L > 260) {
    for (let i = 0; i < 9; i++) {
      const hx = -0.26 * L + i * 0.065 * L;
      parts.push(<circle key={`h${i}`} cx={hx} cy={g - 0.025 * L} r={0.012 * L} fill={c('#1a120c')} />);
      if (i % 3 === 0) parts.push(<line key={`sp${i}`} x1={hx + 2} y1={g - 0.02 * L} x2={hx + 0.01 * L} y2={g - 0.12 * L} stroke={c('#1a120c')} strokeWidth={sw * 0.7} />);
    }
  }
  if (lit && light.lamps > 0) {
    parts.push(<circle key="lampglow" className="scn-flicker" cx={-0.44 * L} cy={end - 0.04 * L} r={Math.max(6, 0.08 * L)} fill="rgba(255,170,80,0.35)" />);
    parts.push(<circle key="lamp" cx={-0.44 * L} cy={end - 0.04 * L} r={Math.max(1.2, 0.012 * L)} fill="#ffd08a" />);
  }
  // Reflection and the wake line on the water.
  const reflection = <path d={hull} transform={`translate(0 ${0.06 * L}) scale(1 -0.4)`} fill={shade(hullCol, 0.3)} opacity={0.3} />;
  const foam = <path d={`M${-0.52 * L} ${0.03 * L} Q 0 ${0.06 * L} ${0.52 * L} ${0.03 * L}`} stroke={c('#e8ecea')} strokeWidth={sw * 1.2} fill="none" opacity={0.35} />;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      <g className="scn-bob" style={{ animationDelay: `${-bob}s` }}>
        <g transform={facing === -1 ? 'scale(-1 1)' : undefined}>
          {reflection}
          {parts}
          {foam}
        </g>
      </g>
    </g>
  );
}

/**
 * Our own bow seen from the deck: the inside of the hull, the two rails closing on the stem post, shields
 * on the rails, the forestay and, across the top, the hem of our own sail. It frames every sea scene.
 */
export function OwnBow({ light, uid, stemX = 1080, stemY = 640, colour = PLAYER_COLOUR, lantern }: { light: Light; uid: string; stemX?: number; stemY?: number; colour?: string; lantern?: boolean }): ReactElement {
  const wood = mix('#2a1a0e', light.sky[1], 0.12);
  const woodLit = mix('#6b4b2c', light.rim, 0.3);
  const inner = shade(mix('#24170c', light.sky[2], 0.08), 0.15);
  const L = { x0: 200, y0: 1000, cx: 620, cy: 760 };
  const R = { x0: 1900, y0: 1000, cx: 1440, cy: 740 };
  const left = (t: number) => {
    const u = 1 - t;
    return [u * u * L.x0 + 2 * u * t * L.cx + t * t * stemX, u * u * L.y0 + 2 * u * t * L.cy + t * t * stemY] as const;
  };
  const right = (t: number) => {
    const u = 1 - t;
    return [u * u * R.x0 + 2 * u * t * R.cx + t * t * stemX, u * u * R.y0 + 2 * u * t * R.cy + t * t * stemY] as const;
  };
  const strakes: ReactElement[] = [];
  for (let i = 1; i <= 4; i++) {
    const dy = i * 46;
    strakes.push(<path key={`l${i}`} d={`M${L.x0 + i * 60} ${L.y0 + dy * 0.2} Q ${L.cx + i * 40} ${L.cy + dy} ${stemX} ${stemY + 6 + i * 4}`} stroke={shade(wood, 0.35)} strokeWidth={3} fill="none" opacity={0.7} />);
    strakes.push(<path key={`r${i}`} d={`M${R.x0 - i * 60} ${R.y0 + dy * 0.2} Q ${R.cx - i * 40} ${R.cy + dy} ${stemX} ${stemY + 6 + i * 4}`} stroke={shade(wood, 0.35)} strokeWidth={3} fill="none" opacity={0.7} />);
  }
  // Ribs: frames crossing the strakes.
  const ribs: ReactElement[] = [];
  for (let i = 1; i <= 6; i++) {
    const t = i / 7.2;
    const [lx, ly] = left(t);
    const [rx, ry] = right(t);
    ribs.push(<path key={`rl${i}`} d={`M${lx} ${ly} Q ${lx + (stemX - lx) * 0.25} ${ly + 120 * (1 - t)} ${(lx + rx) / 2} ${Math.max(ly, ry) + 160 * (1 - t)}`} stroke={shade(wood, 0.25)} strokeWidth={10 * (1 - t) + 3} fill="none" opacity={0.85} />);
    ribs.push(<path key={`rr${i}`} d={`M${rx} ${ry} Q ${rx - (rx - stemX) * 0.25} ${ry + 120 * (1 - t)} ${(lx + rx) / 2} ${Math.max(ly, ry) + 160 * (1 - t)}`} stroke={shade(wood, 0.25)} strokeWidth={10 * (1 - t) + 3} fill="none" opacity={0.85} />);
  }
  // A thwart (rowing bench) across the hull.
  const [tlx, tly] = left(0.42);
  const [trx, try_] = right(0.42);
  const shields: ReactElement[] = [];
  for (let i = 0; i < 9; i++) {
    const t = 0.1 + i * 0.09;
    const s = 64 * (1 - t) + 10;
    for (const side of [left, right]) {
      const [sx, sy] = side(t);
      shields.push(
        <g key={`${side === left ? 'l' : 'r'}${i}`}>
          <path d={`M${sx - s} ${sy} A ${s} ${s} 0 0 1 ${sx + s} ${sy} Z`} fill={shade(i % 2 === 0 ? colour : BONE, 0.45)} stroke={INK} strokeWidth={2} />
          <path d={`M${sx - s * 0.92} ${sy - 2} A ${s * 0.92} ${s * 0.92} 0 0 1 ${sx + s * 0.92} ${sy - 2}`} stroke={light.rim} strokeWidth={2} fill="none" opacity={0.3} />
        </g>,
      );
    }
  }
  const rail = (side: typeof left, key: string) => {
    const pts = Array.from({ length: 21 }, (_, i) => side(i / 20));
    return <polyline key={key} points={pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')} stroke={woodLit} strokeWidth={14} fill="none" strokeLinecap="round" />;
  };
  const hullFill = `M${L.x0} ${L.y0} Q ${L.cx} ${L.cy} ${stemX} ${stemY} Q ${R.cx} ${R.cy} ${R.x0} ${R.y0} L${R.x0} 1100 L${L.x0} 1100 Z`;
  const sx = stemX;
  const sy = stemY;
  // Deck boards running forward to the bow.
  const boards: ReactElement[] = [];
  for (let i = 0; i < 9; i++) {
    const bx = 260 + i * 170;
    boards.push(<path key={`d${i}`} d={`M${bx} 1000 L${bx + (sx - bx) * 0.62} ${1000 + (sy + 70 - 1000) * 0.62}`} stroke={shade(inner, 0.45)} strokeWidth={2.5} opacity={0.6} />);
  }
  return (
    <g className="scn-roll">
      <defs>
        <linearGradient id={`${uid}-hull`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(inner, light.rim, 0.16)} />
          <stop offset="0.3" stopColor={inner} />
          <stop offset="1" stopColor={shade(inner, 0.6)} />
        </linearGradient>
      </defs>
      {/* The stem post, curling up and forward, with a carved spiral. */}
      <path d={`M${sx - 14} ${sy + 10} C ${sx - 20} ${sy - 90}, ${sx + 6} ${sy - 170}, ${sx + 44} ${sy - 214} C ${sx + 70} ${sy - 244}, ${sx + 40} ${sy - 276}, ${sx + 18} ${sy - 258} C ${sx + 2} ${sy - 244}, ${sx + 20} ${sy - 226}, ${sx + 32} ${sy - 236}`} stroke={wood} strokeWidth={22} fill="none" strokeLinecap="round" />
      <path d={`M${sx - 20} ${sy - 40} C ${sx - 18} ${sy - 110}, ${sx + 6} ${sy - 170}, ${sx + 40} ${sy - 208}`} stroke={woodLit} strokeWidth={4} fill="none" opacity={0.55} />
      <path d={hullFill} fill={`url(#${uid}-hull)`} />
      {strakes}
      {boards}
      {ribs}
      <path d={`M${tlx} ${tly + 14} L${trx} ${try_ + 14}`} stroke={shade(wood, 0.1)} strokeWidth={26} strokeLinecap="round" />
      <path d={`M${tlx} ${tly + 4} L${trx} ${try_ + 4}`} stroke={woodLit} strokeWidth={3} opacity={0.4} />
      {/* A coil of rope on the deck. */}
      <g opacity={0.9}>
        <ellipse cx={sx + 330} cy={960} rx={70} ry={20} fill="none" stroke={shade('#a08860', 0.45)} strokeWidth={9} />
        <ellipse cx={sx + 330} cy={952} rx={48} ry={13} fill="none" stroke={shade('#a08860', 0.35)} strokeWidth={8} />
      </g>
      {shields}
      {rail(left, 'railL')}
      {rail(right, 'railR')}
      {/* Forestay from the masthead behind us to the stem, and a sheet to the right. */}
      <line x1={sx - 150} y1={-40} x2={sx + 30} y2={sy - 230} stroke={INK} strokeWidth={4} />
      <line x1={VIEW_W - 60} y1={60} x2={R.cx + 60} y2={R.cy + 20} stroke={INK} strokeWidth={3} opacity={0.85} />
      {lantern && light.lamps > 0 && (
        <g>
          <circle className="scn-flicker" cx={sx - 46} cy={sy - 96} r={120} fill={`url(#${uid}-lamp)`} />
          <line x1={sx - 46} y1={sy - 126} x2={sx - 46} y2={sy - 108} stroke={INK} strokeWidth={2} />
          <rect x={sx - 54} y={sy - 108} width={16} height={22} rx={3} fill="#ffcf7a" stroke={INK} strokeWidth={2} />
        </g>
      )}
      <OwnSailHem light={light} colour={colour} />
    </g>
  );
}

/** The hem of our own square sail across the top of the view, filling and easing in the wind. */
export function OwnSailHem({ light, colour }: { light: Light; colour: string }): ReactElement {
  const n = 9;
  const bottom = (x: number) => 64 + 46 * Math.sin((Math.PI * (x + 100)) / (VIEW_W + 200));
  const edge = (x0: number, x1: number) => {
    const pts: string[] = [];
    const steps = Math.max(4, Math.ceil(Math.abs(x1 - x0) / 40));
    for (let k = 0; k <= steps; k++) {
      const x = x1 + ((x0 - x1) * k) / steps;
      pts.push(`L${x.toFixed(1)} ${bottom(x).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const stripes: ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = -100 + (i * (VIEW_W + 200)) / n;
    const x1 = -100 + ((i + 1) * (VIEW_W + 200)) / n;
    stripes.push(<path key={i} d={`M${x0} -60 L${x1} -60 ${edge(x0, x1)} Z`} fill={shade(i % 2 === 0 ? colour : BONE, light.tod === 'day' ? 0.3 : 0.5)} />);
  }
  const line = `M${VIEW_W + 100} ${bottom(VIEW_W + 100)} ${edge(-100, VIEW_W + 100)}`;
  return (
    <g className="scn-hem">
      {stripes}
      <path d={line} stroke={INK} strokeWidth={6} fill="none" opacity={0.75} />
      <path d={line} transform="translate(0 -5)" stroke={light.rim} strokeWidth={2} fill="none" opacity={0.35} />
    </g>
  );
}
