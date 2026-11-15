/**
 * Painting helpers for rooms (the 1600 × 900 interior canvas), in the game's painted-placeholder style: oak
 * and bone, a gold firelight, flat shapes with a lit side and a shadow side. Every helper takes plain viewBox
 * coordinates and the room's `RoomLight`, so a new room is a list of calls in back-to-front order.
 *
 *   RoomSvg       the canvas with its gradients (fire glow, shadow, smoke, sky for open rooms)
 *   PlankedWall   a wall of planks as any four-cornered shape (flat or in perspective)
 *   Post, Beam    roof-bearing posts (with carved bands) and beams / rafters between two points
 *   Floor         earth, boards or flagstones from a line down to the bottom
 *   Hearth        a fire pit (round or long) with stones, logs, flames and its pool of light
 *   FireGlow      an extra pool of firelight anywhere (screen-blended)
 *   SmokeHaze     smoke gathered under a roof
 *   SideBench     a raised bench along a wall in perspective; Bench and Table seen from the front
 *   Hanging       a woven wall hanging; Shield a painted round shield (squash it for perspective)
 *   HighSeat      the carved high seat with its two pillars; Chest a strongbox (open shows silver)
 *   Anvil, Forge, ToolRack, Barrel   the smith's things
 *   Overhang      the underside of an open shelter's roof across the top of the view
 *   Landscape     sky, mountains and meadow beyond an open side (the scenes' Sky and Ridge)
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { Ridge, Sky } from '../scenes/layers';
import { Woods } from '../scenes/land';
import { BONE, INK, mix, rng, shade } from '../scenes/paint';
import { lit, outside, type RoomLight } from './light';
import { ROOM_H, ROOM_W } from './types';

type Pt = readonly [number, number];

/** A DOM-safe id prefix for one painting's gradients. */
export function useRoomUid(): string {
  return `rm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** The room canvas: gradients every helper refers to by `uid`. Pass `sky` when the room shows the outdoors. */
export function RoomSvg({ uid, light, sky, children, testId }: { uid: string; light: RoomLight; sky?: { horizon: number }; children: ReactNode; testId?: string }): ReactElement {
  const o = light.outdoor;
  const horizon = sky?.horizon ?? 400;
  return (
    <svg className="int-svg" viewBox={`0 0 ${ROOM_W} ${ROOM_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-testid={testId} data-tod={light.tod}>
      <defs>
        {/* The scenes' Sky reads these two ids. */}
        <linearGradient id={`${uid}-sky`} gradientUnits="userSpaceOnUse" x1="0" y1="-60" x2="0" y2={horizon}>
          <stop offset="0" stopColor={o.sky[0]} />
          <stop offset="0.42" stopColor={o.sky[1]} />
          <stop offset="0.8" stopColor={o.sky[2]} />
          <stop offset="1" stopColor={o.sky[3]} />
        </linearGradient>
        <radialGradient id={`${uid}-orb`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={o.orb.glow} />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,184,96,0.85)" />
          <stop offset="0.35" stopColor="rgba(240,140,60,0.38)" />
          <stop offset="1" stopColor="rgba(200,90,30,0)" />
        </radialGradient>
        <radialGradient id={`${uid}-flame`} cx="0.5" cy="0.75" r="0.6">
          <stop offset="0" stopColor="#fff2c0" />
          <stop offset="0.35" stopColor="#ffc861" />
          <stop offset="0.75" stopColor="#f07a2a" />
          <stop offset="1" stopColor="#b8401a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-shadow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-smoke`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix('#2a2420', o.haze, 0.15)} stopOpacity="0.85" />
          <stop offset="1" stopColor="#2a2420" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-vignette`} cx="0.5" cy="0.55" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </radialGradient>
        <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      {children}
      <rect x={-100} y={-100} width={ROOM_W + 200} height={ROOM_H + 200} fill={`url(#${uid}-vignette)`} pointerEvents="none" />
    </svg>
  );
}

function poly(pts: readonly Pt[]): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * A wall of planks: any four corners in order top-left, top-right, bottom-right, bottom-left (in perspective
 * the far edge is simply shorter). `seams` runs the plank joints vertically ('v') or along the wall ('h').
 */
export function PlankedWall({ corners, colour, light, seams = 'v', count = 12, warm = 0.2, depth = 0 }: { corners: readonly [Pt, Pt, Pt, Pt]; colour: string; light: RoomLight; seams?: 'v' | 'h'; count?: number; warm?: number; depth?: number }): ReactElement {
  const [tl, tr, br, bl] = corners;
  const fill = lit(light, colour, warm, depth);
  const seam = shade(fill, 0.45);
  const hi = mix(fill, BONE, 0.08);
  const lines: ReactElement[] = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const [a, b] = seams === 'v' ? [lerp(tl, tr, t), lerp(bl, br, t)] : [lerp(tl, bl, t), lerp(tr, br, t)];
    lines.push(<line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={seam} strokeWidth={2.2} opacity={0.75} />);
    const [c, d] = seams === 'v' ? [lerp(tl, tr, t + 0.012), lerp(bl, br, t + 0.012)] : [lerp(tl, bl, t + 0.02), lerp(tr, br, t + 0.02)];
    lines.push(<line key={`h${i}`} x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} stroke={hi} strokeWidth={1.2} opacity={0.35} />);
  }
  return (
    <g>
      <polygon points={poly(corners)} fill={fill} />
      {lines}
    </g>
  );
}

/** A roof-bearing post from `top` to `bottom`, lit from the fire's side, with carved bands near the top. */
export function Post({ x, top, bottom, w, light, warm = 0.4, depth = 0, fireSide = 'right', carved = true }: { x: number; top: number; bottom: number; w: number; light: RoomLight; warm?: number; depth?: number; fireSide?: 'left' | 'right'; carved?: boolean }): ReactElement {
  const body = lit(light, '#4a3220', warm, depth);
  const dark = shade(body, 0.45);
  const hi = lit(light, '#8a5e36', warm + 0.3, depth);
  const litX = fireSide === 'right' ? x + w * 0.18 : x - w * 0.5;
  const shX = fireSide === 'right' ? x - w * 0.5 : x + w * 0.2;
  const bands = carved
    ? [0.1, 0.16].map((f) => <rect key={f} x={x - w / 2 - 2} y={top + (bottom - top) * f} width={w + 4} height={Math.max(3, w * 0.12)} fill={shade(body, 0.25)} stroke={INK} strokeWidth={1} opacity={0.9} />)
    : null;
  return (
    <g>
      <rect x={x - w / 2} y={top} width={w} height={bottom - top} fill={body} />
      <rect x={shX} y={top} width={w * 0.3} height={bottom - top} fill={dark} opacity={0.7} />
      <rect x={litX} y={top} width={w * 0.32} height={bottom - top} fill={hi} opacity={0.45} />
      {bands}
      {carved && w > 22 && (
        <path d={`M${x - w * 0.3} ${top + (bottom - top) * 0.22} q ${w * 0.3} ${w * 0.5} ${w * 0.6} 0 q ${-w * 0.3} ${w * 0.5} ${-w * 0.6} ${w * 0.9}`} stroke={dark} strokeWidth={Math.max(1.5, w * 0.06)} fill="none" opacity={0.8} />
      )}
      <ellipse cx={x} cy={bottom} rx={w * 0.9} ry={w * 0.18} fill="#000" opacity={0.35} />
    </g>
  );
}

/** A squared timber from one point to another (`t` thick), lit on its top face. */
export function Beam({ a, b, t, light, warm = 0.3, depth = 0 }: { a: Pt; b: Pt; t: number; light: RoomLight; warm?: number; depth?: number }): ReactElement {
  const body = lit(light, '#3d2a1a', warm, depth);
  const [ax, ay] = a;
  const [bx, by] = b;
  return (
    <g>
      <polygon points={poly([[ax, ay - t / 2], [bx, by - t / 2], [bx, by + t / 2], [ax, ay + t / 2]])} fill={body} />
      <polygon points={poly([[ax, ay + t * 0.15], [bx, by + t * 0.15], [bx, by + t / 2], [ax, ay + t / 2]])} fill={shade(body, 0.4)} />
      <line x1={ax} y1={ay - t / 2} x2={bx} y2={by - t / 2} stroke={lit(light, '#7a5232', warm + 0.2, depth)} strokeWidth={1.5} opacity={0.6} />
    </g>
  );
}

/** The floor from line `y` (at the far end) down to the bottom of the picture. */
export function Floor({ y, light, kind = 'earth', seed = 1, warmAt }: { y: number; light: RoomLight; kind?: 'earth' | 'boards' | 'stone'; seed?: number; warmAt?: Pt }): ReactElement {
  const base = kind === 'boards' ? '#4a3524' : kind === 'stone' ? '#4c4a44' : '#3a2e22';
  const fill = lit(light, base, 0.35);
  const r = rng(seed);
  const marks: ReactElement[] = [];
  if (kind === 'stone') {
    for (let i = 0; i < 46; i++) {
      const t = r();
      const yy = y + Math.pow(t, 1.4) * (ROOM_H - y + 40);
      const xx = r() * ROOM_W;
      const w = 20 + t * 110;
      marks.push(<ellipse key={i} cx={xx} cy={yy} rx={w} ry={w * 0.22} fill={shade(fill, 0.1 + r() * 0.25)} stroke={shade(fill, 0.5)} strokeWidth={1.2} opacity={0.75} />);
    }
  } else {
    for (let i = 0; i < 60; i++) {
      const t = r();
      const yy = y + Math.pow(t, 1.3) * (ROOM_H - y + 40);
      const xx = r() * ROOM_W;
      const w = 4 + t * 28;
      marks.push(<ellipse key={i} cx={xx} cy={yy} rx={w} ry={w * 0.25} fill={r() < 0.5 ? shade(fill, 0.3) : mix(fill, BONE, 0.08)} opacity={0.5} />);
    }
    // Rushes strewn on the floor.
    for (let i = 0; i < 26; i++) {
      const t = r();
      const yy = y + 20 + Math.pow(t, 1.2) * (ROOM_H - y);
      const xx = r() * ROOM_W;
      const l = 10 + t * 40;
      marks.push(<line key={`r${i}`} x1={xx} y1={yy} x2={xx + l} y2={yy + (r() - 0.5) * l * 0.2} stroke={lit(light, '#8a7a4a', 0.4)} strokeWidth={1 + t * 1.5} opacity={0.4} />);
    }
  }
  return (
    <g>
      <rect x={-100} y={y} width={ROOM_W + 200} height={ROOM_H - y + 100} fill={fill} />
      {marks}
      {warmAt && <ellipse cx={warmAt[0]} cy={warmAt[1]} rx={520} ry={150} fill={lit(light, '#8a5a30', 1)} opacity={0.35 * light.fire} />}
    </g>
  );
}

/** A pool of firelight (screen-blended over whatever is below it). */
export function FireGlow({ uid, x, y, rx, ry, light, strength = 1 }: { uid: string; x: number; y: number; rx: number; ry: number; light: RoomLight; strength?: number }): ReactElement {
  return <ellipse className="int-glow" cx={x} cy={y} rx={rx} ry={ry} fill={`url(#${uid}-glow)`} opacity={Math.min(1, strength * (0.35 + light.fire * 0.65))} style={{ mixBlendMode: 'screen' }} pointerEvents="none" />;
}

/** Flames: a few licking tongues of fire (animated by CSS, still under reduced motion). */
export function Flames({ uid, x, y, w, h }: { uid: string; x: number; y: number; w: number; h: number }): ReactElement {
  const tongues = [-0.32, -0.12, 0.08, 0.28];
  return (
    <g>
      {tongues.map((f, i) => {
        const cx = x + f * w;
        const th = h * (i % 2 === 0 ? 0.8 : 1);
        const tw = w * 0.32;
        return (
          <path
            key={f}
            className={`int-flame int-flame-${i % 3}`}
            d={`M${cx - tw / 2} ${y} C ${cx - tw / 2} ${y - th * 0.4}, ${cx - tw * 0.1} ${y - th * 0.55}, ${cx + tw * 0.05} ${y - th} C ${cx + tw * 0.2} ${y - th * 0.6}, ${cx + tw / 2} ${y - th * 0.45}, ${cx + tw / 2} ${y} Z`}
            fill={`url(#${uid}-flame)`}
            style={{ transformOrigin: `${cx}px ${y}px` }}
          />
        );
      })}
    </g>
  );
}

/** A fire pit: stones in a ring (a long hearth when `rx` ≫ `ry`), logs, flames and the pool of light. */
export function Hearth({ uid, x, y, rx, ry, light, flame = 1 }: { uid: string; x: number; y: number; rx: number; ry: number; light: RoomLight; flame?: number }): ReactElement {
  const stone = lit(light, '#6a645a', 0.9);
  const stones: ReactElement[] = [];
  const n = Math.max(10, Math.round((rx + ry) / 9));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const sx = x + Math.cos(a) * rx;
    const sy = y + Math.sin(a) * ry;
    const s = (ry * 0.32 + 6) * (Math.sin(a) > 0 ? 1.15 : 0.8);
    stones.push(<ellipse key={i} cx={sx} cy={sy} rx={s * 1.2} ry={s * 0.7} fill={i % 3 === 0 ? shade(stone, 0.2) : stone} stroke={shade(stone, 0.55)} strokeWidth={1.2} />);
  }
  const back = stones.filter((_, i) => Math.sin((i / n) * Math.PI * 2) < 0);
  const front = stones.filter((_, i) => Math.sin((i / n) * Math.PI * 2) >= 0);
  const logs = [-0.5, -0.1, 0.35].map((f, i) => (
    <line key={f} x1={x + f * rx - rx * 0.2} y1={y + ry * 0.15 + i * 2} x2={x + f * rx + rx * 0.35} y2={y - ry * 0.15 + i * 2} stroke={shade('#3a2414', 0.2)} strokeWidth={ry * 0.32 + 4} strokeLinecap="round" />
  ));
  return (
    <g>
      <FireGlow uid={uid} x={x} y={y - ry * 0.5} rx={rx * 2.6 + 200} ry={ry * 2.4 + 110} light={light} strength={flame} />
      {back}
      <ellipse cx={x} cy={y} rx={rx * 0.95} ry={ry * 0.85} fill="#1a0f08" />
      <ellipse cx={x} cy={y} rx={rx * 0.8} ry={ry * 0.6} fill="#c2501c" opacity={0.75} className="int-embers" />
      {logs}
      <Flames uid={uid} x={x} y={y + ry * 0.2} w={rx * 1.3} h={(ry * 2.4 + 50) * flame} />
      {front}
    </g>
  );
}

/** Smoke gathered under the roof, from the top of the picture down to `y`. */
export function SmokeHaze({ uid, y, opacity = 0.7 }: { uid: string; y: number; opacity?: number }): ReactElement {
  return <rect x={-100} y={-100} width={ROOM_W + 200} height={y + 100} fill={`url(#${uid}-smoke)`} opacity={opacity} pointerEvents="none" />;
}

/**
 * A raised bench (a sleeping-and-sitting platform) along a side wall in perspective: `near` and `far` are the
 * front edge's two ends at seat height; it drops `nearH`/`farH` to the floor and reaches `nearD`/`farD` back
 * to the wall (negative to the left).
 */
export function SideBench({ near, far, nearH, farH, nearD, farD, light, warm = 0.4 }: { near: Pt; far: Pt; nearH: number; farH: number; nearD: number; farD: number; light: RoomLight; warm?: number }): ReactElement {
  const top = lit(light, '#5a3e26', warm);
  const front = lit(light, '#3a2716', warm * 0.8);
  const seat: Pt[] = [near, far, [far[0] + farD, far[1] - farH * 0.15], [near[0] + nearD, near[1] - nearH * 0.15]];
  const face: Pt[] = [near, far, [far[0], far[1] + farH], [near[0], near[1] + nearH]];
  const legs: ReactElement[] = [];
  for (let i = 0; i <= 4; i++) {
    const p = lerp(near, far, i / 4);
    const h = nearH + (farH - nearH) * (i / 4);
    legs.push(<line key={i} x1={p[0]} y1={p[1]} x2={p[0]} y2={p[1] + h} stroke={shade(front, 0.4)} strokeWidth={3 + (1 - i / 4) * 6} />);
  }
  return (
    <g>
      <polygon points={poly(seat)} fill={top} />
      <polygon points={poly(face)} fill={front} />
      {legs}
      <line x1={near[0]} y1={near[1]} x2={far[0]} y2={far[1]} stroke={lit(light, '#9a6a3a', warm + 0.4)} strokeWidth={2} opacity={0.6} />
    </g>
  );
}

/** A bench seen from the front (seat at `y`, legs to `y + h`). */
export function Bench({ x, y, w, h, light, warm = 0.4 }: { x: number; y: number; w: number; h: number; light: RoomLight; warm?: number }): ReactElement {
  const top = lit(light, '#5a3e26', warm);
  return (
    <g>
      <rect x={x - w / 2} y={y - h * 0.12} width={w} height={h * 0.18} fill={top} />
      <rect x={x - w / 2} y={y + h * 0.06} width={w} height={h * 0.06} fill={shade(top, 0.45)} />
      {[-0.42, 0.42].map((f) => (
        <rect key={f} x={x + f * w - h * 0.06} y={y + h * 0.06} width={h * 0.12} height={h * 0.94} fill={shade(top, 0.35)} />
      ))}
    </g>
  );
}

/** A trestle table from the front, with a few cups and a bowl. */
export function Table({ x, y, w, h, light, warm = 0.4, things = true }: { x: number; y: number; w: number; h: number; light: RoomLight; warm?: number; things?: boolean }): ReactElement {
  const top = lit(light, '#6a4a2c', warm);
  return (
    <g>
      <ellipse cx={x} cy={y + h} rx={w * 0.55} ry={h * 0.12} fill="#000" opacity={0.3} />
      {[-0.38, 0.38].map((f) => (
        <path key={f} d={`M${x + f * w - h * 0.25} ${y + h} L${x + f * w} ${y} L${x + f * w + h * 0.25} ${y + h}`} stroke={shade(top, 0.4)} strokeWidth={h * 0.08} fill="none" />
      ))}
      <rect x={x - w / 2} y={y - h * 0.12} width={w} height={h * 0.14} fill={top} />
      <rect x={x - w / 2} y={y + h * 0.02} width={w} height={h * 0.05} fill={shade(top, 0.5)} />
      {things && (
        <g>
          <path d={`M${x - w * 0.3} ${y - h * 0.12} l ${h * 0.05} ${-h * 0.2} l ${h * 0.12} 0 l ${h * 0.05} ${h * 0.2} Z`} fill={lit(light, '#8a8478', warm + 0.3)} />
          <ellipse cx={x + w * 0.1} cy={y - h * 0.14} rx={h * 0.22} ry={h * 0.07} fill={lit(light, '#5a4030', warm)} />
          <path d={`M${x + w * 0.28} ${y - h * 0.12} q ${h * 0.08} ${-h * 0.32} ${h * 0.3} ${-h * 0.36}`} stroke={lit(light, BONE, warm + 0.3)} strokeWidth={h * 0.07} fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

/** A woven wall hanging from a rod: border bands, a repeated motif, a fringe. */
export function Hanging({ x, y, w, h, colour, light, motif = 'diamond', warm = 0.3, depth = 0 }: { x: number; y: number; w: number; h: number; colour: string; light: RoomLight; motif?: 'diamond' | 'knot' | 'stripes'; warm?: number; depth?: number }): ReactElement {
  const cloth = lit(light, colour, warm, depth);
  const band = lit(light, '#c9a04a', warm, depth);
  const dark = shade(cloth, 0.4);
  const marks: ReactElement[] = [];
  const cols = Math.max(1, Math.round(w / Math.max(30, h * 0.22)));
  const cw = (w - w * 0.16) / cols;
  for (let i = 0; i < cols; i++) {
    const cx = x - w / 2 + w * 0.08 + cw * (i + 0.5);
    for (let j = 0; j < 3; j++) {
      const cy = y + h * (0.28 + j * 0.24);
      const s = Math.min(cw, h * 0.2) * 0.38;
      if (motif === 'diamond') marks.push(<path key={`${i}-${j}`} d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`} fill="none" stroke={band} strokeWidth={Math.max(1.5, s * 0.22)} opacity={0.8} />);
      else if (motif === 'knot') marks.push(<path key={`${i}-${j}`} d={`M${cx - s} ${cy} C ${cx - s} ${cy - s * 1.4}, ${cx + s} ${cy + s * 1.4}, ${cx + s} ${cy} C ${cx + s} ${cy - s * 1.4}, ${cx - s} ${cy + s * 1.4}, ${cx - s} ${cy}`} fill="none" stroke={band} strokeWidth={Math.max(1.5, s * 0.2)} opacity={0.8} />);
    }
    if (motif === 'stripes' && i % 2 === 0) marks.push(<rect key={`s${i}`} x={cx - cw * 0.25} y={y + h * 0.12} width={cw * 0.5} height={h * 0.74} fill={dark} opacity={0.6} />);
  }
  const fringe: ReactElement[] = [];
  for (let fx = x - w / 2 + 4; fx < x + w / 2; fx += Math.max(5, w / 30)) fringe.push(<line key={fx} x1={fx} y1={y + h} x2={fx + 1} y2={y + h + h * 0.05} stroke={band} strokeWidth={1.4} opacity={0.7} />);
  return (
    <g>
      <rect x={x - w / 2 - w * 0.06} y={y - 6} width={w * 1.12} height={8} rx={4} fill={lit(light, '#2a1c12', warm, depth)} />
      <path d={`M${x - w / 2} ${y} L${x + w / 2} ${y} L${x + w / 2} ${y + h} Q ${x} ${y + h * 1.03} ${x - w / 2} ${y + h} Z`} fill={cloth} />
      <rect x={x - w / 2} y={y + h * 0.06} width={w} height={h * 0.035} fill={band} opacity={0.85} />
      <rect x={x - w / 2} y={y + h * 0.9} width={w} height={h * 0.035} fill={band} opacity={0.85} />
      {marks}
      <path d={`M${x + w * 0.3} ${y} L${x + w / 2} ${y} L${x + w / 2} ${y + h} L${x + w * 0.38} ${y + h}`} fill={dark} opacity={0.35} />
      {fringe}
    </g>
  );
}

/** A painted round shield on the wall; `squash` < 1 turns it away (perspective on a side wall). */
export function Shield({ x, y, r, colour, light, design = 'quarter', squash = 1, warm = 0.3, depth = 0 }: { x: number; y: number; r: number; colour: string; light: RoomLight; design?: 'quarter' | 'cross' | 'spiral' | 'plain' | 'half'; squash?: number; warm?: number; depth?: number }): ReactElement {
  const base = lit(light, colour, warm, depth);
  const other = lit(light, '#d8c8a0', warm, depth);
  const rx = r * squash;
  const rim = lit(light, '#6a6660', warm + 0.2, depth);
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={r} fill={base} />
      {design === 'quarter' && (
        <path d={`M${x} ${y} L${x} ${y - r} A ${rx} ${r} 0 0 1 ${x + rx} ${y} Z M${x} ${y} L${x} ${y + r} A ${rx} ${r} 0 0 1 ${x - rx} ${y} Z`} fill={other} opacity={0.9} />
      )}
      {design === 'half' && <path d={`M${x} ${y - r} A ${rx} ${r} 0 0 1 ${x} ${y + r} Z`} fill={other} opacity={0.9} />}
      {design === 'cross' && (
        <g stroke={other} strokeWidth={r * 0.22} opacity={0.9}>
          <line x1={x} y1={y - r} x2={x} y2={y + r} />
          <line x1={x - rx} y1={y} x2={x + rx} y2={y} />
        </g>
      )}
      {design === 'spiral' &&
        [0, 1, 2].map((i) => {
          const a = (i * Math.PI * 2) / 3;
          return <path key={i} d={`M${x} ${y} Q ${x + Math.cos(a) * rx * 0.9} ${y + Math.sin(a) * r * 0.9} ${x + Math.cos(a + 1.2) * rx * 0.85} ${y + Math.sin(a + 1.2) * r * 0.85}`} stroke={other} strokeWidth={r * 0.14} fill="none" />;
        })}
      <ellipse cx={x} cy={y} rx={rx} ry={r} fill="none" stroke={rim} strokeWidth={Math.max(1.5, r * 0.09)} />
      <ellipse cx={x} cy={y} rx={rx * 0.24} ry={r * 0.24} fill={lit(light, '#9a948a', warm + 0.3, depth)} stroke={INK} strokeWidth={1} />
      <ellipse cx={x - rx * 0.06} cy={y - r * 0.07} rx={rx * 0.09} ry={r * 0.08} fill={BONE} opacity={0.35} />
    </g>
  );
}

/** The high seat: a broad carved chair on a dais, a high back, two carved pillars with knob heads, a fur. */
export function HighSeat({ x, y, w, h, light, warm = 0.5, cloth = '#7a2a1e' }: { x: number; y: number; w: number; h: number; light: RoomLight; warm?: number; cloth?: string }): ReactElement {
  const wood = lit(light, '#4e3420', warm);
  const dark = shade(wood, 0.4);
  const gold = lit(light, '#c9a04a', warm + 0.2);
  const fur = lit(light, '#8a6e52', warm);
  const pillar = (px: number) => (
    <g>
      <rect x={px - w * 0.06} y={y - h * 1.02} width={w * 0.12} height={h * 1.02} fill={wood} />
      <rect x={px - w * 0.06} y={y - h * 1.02} width={w * 0.04} height={h * 1.02} fill={dark} opacity={0.7} />
      {[0.25, 0.5, 0.75].map((f) => (
        <path key={f} d={`M${px - w * 0.05} ${y - h * f} q ${w * 0.05} ${-h * 0.06} ${w * 0.1} 0`} stroke={gold} strokeWidth={2} fill="none" opacity={0.7} />
      ))}
      <ellipse cx={px} cy={y - h * 1.06} rx={w * 0.085} ry={h * 0.06} fill={wood} stroke={gold} strokeWidth={2} />
      <path d={`M${px - w * 0.04} ${y - h * 1.1} q ${w * 0.04} ${-h * 0.08} ${w * 0.08} 0`} stroke={wood} strokeWidth={w * 0.03} fill="none" />
    </g>
  );
  return (
    <g>
      {/* The dais. */}
      <path d={`M${x - w * 0.95} ${y + h * 0.08} L${x + w * 0.95} ${y + h * 0.08} L${x + w * 1.05} ${y + h * 0.2} L${x - w * 1.05} ${y + h * 0.2} Z`} fill={shade(wood, 0.2)} />
      <rect x={x - w * 1.05} y={y + h * 0.2} width={w * 2.1} height={h * 0.06} fill={dark} />
      {/* The back with a hanging cloth. */}
      <path d={`M${x - w * 0.42} ${y - h * 0.15} L${x - w * 0.42} ${y - h * 0.86} Q ${x} ${y - h * 1.0} ${x + w * 0.42} ${y - h * 0.86} L${x + w * 0.42} ${y - h * 0.15} Z`} fill={wood} />
      <path d={`M${x - w * 0.32} ${y - h * 0.3} L${x - w * 0.32} ${y - h * 0.8} Q ${x} ${y - h * 0.9} ${x + w * 0.32} ${y - h * 0.8} L${x + w * 0.32} ${y - h * 0.3} Z`} fill={lit(light, cloth, warm)} />
      <path d={`M${x - w * 0.32} ${y - h * 0.78} Q ${x} ${y - h * 0.88} ${x + w * 0.32} ${y - h * 0.78}`} stroke={gold} strokeWidth={3} fill="none" />
      {/* Seat, fur and arms. */}
      <rect x={x - w * 0.46} y={y - h * 0.32} width={w * 0.92} height={h * 0.1} fill={shade(wood, 0.1)} />
      <path d={`M${x - w * 0.38} ${y - h * 0.34} Q ${x - w * 0.2} ${y - h * 0.4} ${x} ${y - h * 0.36} Q ${x + w * 0.2} ${y - h * 0.4} ${x + w * 0.38} ${y - h * 0.34} L${x + w * 0.34} ${y - h * 0.18} L${x - w * 0.34} ${y - h * 0.18} Z`} fill={fur} />
      <rect x={x - w * 0.46} y={y - h * 0.22} width={w * 0.92} height={h * 0.22} fill={wood} />
      <rect x={x - w * 0.46} y={y - h * 0.22} width={w * 0.92} height={h * 0.04} fill={dark} />
      {pillar(x - w * 0.55)}
      {pillar(x + w * 0.55)}
    </g>
  );
}

/** An iron-bound strongbox; `open` lifts the lid on a heap of silver. */
export function Chest({ x, y, w, h, light, warm = 0.4, open = false }: { x: number; y: number; w: number; h: number; light: RoomLight; warm?: number; open?: boolean }): ReactElement {
  const wood = lit(light, '#7a5230', warm);
  const iron = lit(light, '#3e3e3c', warm + 0.2);
  const silver = lit(light, '#d8dcd8', warm + 0.4);
  const coins: ReactElement[] = [];
  if (open) {
    const r = rng(Math.round(x * 7 + y));
    for (let i = 0; i < 34; i++) {
      const cx = x - w * 0.4 + r() * w * 0.8;
      const cy = y - h - Math.sin(((cx - x) / w + 0.5) * Math.PI) * h * 0.3 + r() * h * 0.12;
      coins.push(<ellipse key={i} cx={cx} cy={cy} rx={w * 0.035} ry={w * 0.018} fill={r() < 0.3 ? lit(light, '#e0b860', warm + 0.4) : silver} stroke={shade(silver, 0.5)} strokeWidth={0.8} />);
    }
    // A few spilled on the floor.
    for (let i = 0; i < 5; i++) coins.push(<ellipse key={`f${i}`} cx={x + w * 0.55 + r() * w * 0.3} cy={y + r() * h * 0.08} rx={w * 0.035} ry={w * 0.014} fill={silver} />);
  }
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx={w * 0.62} ry={h * 0.12} fill="#000" opacity={0.4} />
      {open && (
        <g>
          {/* The lid thrown back against the wall behind the box. */}
          <path d={`M${x - w / 2} ${y - h} L${x - w * 0.46} ${y - h * 1.62} Q ${x} ${y - h * 1.9} ${x + w * 0.46} ${y - h * 1.62} L${x + w / 2} ${y - h} Z`} fill={shade(wood, 0.12)} stroke={iron} strokeWidth={3} />
          {[0.2, 0.8].map((f) => (
            <line key={f} x1={x - w / 2 + w * f} y1={y - h} x2={x - w * 0.46 + w * 0.92 * f} y2={y - h * 1.66 - Math.sin(f * Math.PI) * h * 0.2} stroke={iron} strokeWidth={w * 0.06} />
          ))}
        </g>
      )}
      <rect x={x - w / 2} y={y - h} width={w} height={h} fill={wood} />
      <rect x={x - w / 2} y={y - h} width={w * 0.12} height={h} fill={shade(wood, 0.35)} />
      {[0.18, 0.82].map((f) => (
        <rect key={f} x={x - w / 2 + w * f - w * 0.04} y={y - h} width={w * 0.08} height={h} fill={iron} />
      ))}
      <rect x={x - w * 0.07} y={y - h * 0.85} width={w * 0.14} height={h * 0.22} fill={iron} stroke={INK} strokeWidth={1} />
      {open ? (
        <g>
          <ellipse cx={x} cy={y - h} rx={w / 2} ry={h * 0.12} fill="#1a1008" />
          {coins}
        </g>
      ) : (
        <path d={`M${x - w / 2} ${y - h} Q ${x} ${y - h * 1.45} ${x + w / 2} ${y - h} Z`} fill={shade(wood, 0.1)} stroke={iron} strokeWidth={w * 0.03} />
      )}
    </g>
  );
}

/** An anvil on its stump; `hot` lays a glowing bar of iron on the face. */
export function Anvil({ uid, x, y, s, light, hot = true }: { uid: string; x: number; y: number; s: number; light: RoomLight; hot?: boolean }): ReactElement {
  const iron = lit(light, '#4a4a4c', 0.7);
  const hi = lit(light, '#9a9aa0', 0.9);
  const stump = lit(light, '#4a3220', 0.6);
  const top = y - s * 0.9;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={s * 0.5} ry={s * 0.1} fill="#000" opacity={0.45} />
      <path d={`M${x - s * 0.32} ${y} L${x - s * 0.28} ${top + s * 0.28} L${x + s * 0.28} ${top + s * 0.28} L${x + s * 0.32} ${y} Z`} fill={stump} />
      <ellipse cx={x} cy={top + s * 0.28} rx={s * 0.28} ry={s * 0.06} fill={shade(stump, 0.2)} />
      <path d={`M${x - s * 0.18} ${top + s * 0.26} L${x - s * 0.12} ${top + s * 0.1} L${x + s * 0.12} ${top + s * 0.1} L${x + s * 0.18} ${top + s * 0.26} Z`} fill={iron} />
      {/* Face with the horn to the left. */}
      <path d={`M${x - s * 0.62} ${top - s * 0.02} Q ${x - s * 0.4} ${top + s * 0.02} ${x - s * 0.3} ${top + s * 0.1} L${x + s * 0.36} ${top + s * 0.1} L${x + s * 0.36} ${top - s * 0.04} Z`} fill={iron} />
      <line x1={x - s * 0.5} y1={top - s * 0.03} x2={x + s * 0.36} y2={top - s * 0.04} stroke={hi} strokeWidth={Math.max(1.5, s * 0.02)} />
      {hot && (
        <g>
          <FireGlow uid={uid} x={x - s * 0.05} y={top - s * 0.05} rx={s * 0.7} ry={s * 0.35} light={light} strength={0.8} />
          <rect x={x - s * 0.22} y={top - s * 0.08} width={s * 0.34} height={s * 0.045} rx={s * 0.02} fill="#ffb24a" />
          <rect x={x - s * 0.18} y={top - s * 0.072} width={s * 0.2} height={s * 0.02} fill="#fff0b0" opacity={0.8} />
        </g>
      )}
    </g>
  );
}

/** A stone forge with a hood and chimney, glowing coals and a pair of bellows at its side. */
export function Forge({ uid, x, y, w, h, light }: { uid: string; x: number; y: number; w: number; h: number; light: RoomLight }): ReactElement {
  const stone = lit(light, '#5e5a52', 0.7);
  const dark = shade(stone, 0.4);
  const leather = lit(light, '#5a3a22', 0.5);
  const stones: ReactElement[] = [];
  const r = rng(Math.round(x + y));
  for (let row = 0; row < 6; row++) {
    const yy = y - (row + 1) * (h * 0.45) / 6;
    for (let sx = x - w / 2 + (row % 2) * 14; sx < x + w / 2 - 10; sx += 26 + r() * 10)
      stones.push(<rect key={`${row}-${sx}`} x={sx} y={yy} width={22 + r() * 8} height={(h * 0.45) / 6 - 3} rx={4} fill={shade(stone, r() * 0.25)} />);
  }
  const hearthY = y - h * 0.45;
  return (
    <g>
      {/* Chimney hood. */}
      <path d={`M${x - w * 0.42} ${hearthY - h * 0.12} L${x - w * 0.2} ${y - h} L${x + w * 0.2} ${y - h} L${x + w * 0.42} ${hearthY - h * 0.12} Z`} fill={dark} />
      <path d={`M${x - w * 0.42} ${hearthY - h * 0.12} L${x - w * 0.2} ${y - h} L${x - w * 0.1} ${y - h} L${x - w * 0.3} ${hearthY - h * 0.12} Z`} fill={shade(dark, 0.3)} />
      {/* The block. */}
      <rect x={x - w / 2} y={hearthY} width={w} height={h * 0.45} fill={stone} />
      {stones}
      <rect x={x - w / 2 - 6} y={hearthY - 8} width={w + 12} height={14} rx={4} fill={shade(stone, 0.15)} />
      {/* Coals. */}
      <ellipse cx={x} cy={hearthY - 4} rx={w * 0.34} ry={h * 0.05} fill="#3a1408" />
      <ellipse cx={x} cy={hearthY - 6} rx={w * 0.28} ry={h * 0.035} fill="#ff8a30" className="int-embers" />
      <Flames uid={uid} x={x} y={hearthY - 2} w={w * 0.35} h={h * 0.16} />
      <FireGlow uid={uid} x={x} y={hearthY - h * 0.05} rx={w * 1.4} ry={h * 0.8} light={light} strength={1.1} />
      {/* Bellows at the right: two pear-shaped boards with pleated leather between, the nozzle in the fire. */}
      {(() => {
        const bx = x + w / 2 - 4;
        const by = hearthY + h * 0.06;
        const bl = w * 0.46;
        const bh = h * 0.05;
        const board = lit(light, '#6a4628', 0.6);
        const zig = Array.from({ length: 7 }, (_, i) => `${(bx + bl * (0.25 + i * 0.1)).toFixed(1)},${(by + (i % 2 === 0 ? -bh * 0.35 : bh * 0.35)).toFixed(1)}`).join(' ');
        return (
          <g>
            {/* Leather between the boards, pleated. */}
            <path d={`M${bx + bl * 0.12} ${by} Q ${bx + bl * 0.5} ${by - bh * 0.9} ${bx + bl * 0.92} ${by - bh * 0.7} L${bx + bl * 0.92} ${by + bh * 0.7} Q ${bx + bl * 0.5} ${by + bh * 0.9} ${bx + bl * 0.12} ${by} Z`} fill={leather} />
            <polyline points={zig} fill="none" stroke={shade(leather, 0.45)} strokeWidth={2} />
            {/* The two pear-shaped boards seen edge-on, and the handles. */}
            <path d={`M${bx + bl * 0.1} ${by - bh * 0.1} Q ${bx + bl * 0.5} ${by - bh * 1.5} ${bx + bl} ${by - bh * 0.9}`} stroke={board} strokeWidth={6} fill="none" strokeLinecap="round" />
            <path d={`M${bx + bl * 0.1} ${by + bh * 0.1} Q ${bx + bl * 0.5} ${by + bh * 1.5} ${bx + bl} ${by + bh * 0.9}`} stroke={shade(board, 0.3)} strokeWidth={6} fill="none" strokeLinecap="round" />
            <line x1={bx + bl} y1={by - bh * 0.9} x2={bx + bl * 1.25} y2={by - bh * 1.5} stroke={board} strokeWidth={6} strokeLinecap="round" />
            <line x1={bx + bl} y1={by + bh * 0.9} x2={bx + bl * 1.25} y2={by + bh * 1.4} stroke={shade(board, 0.3)} strokeWidth={6} strokeLinecap="round" />
            {/* The iron nozzle into the fire. */}
            <path d={`M${bx + bl * 0.12} ${by} L${bx - w * 0.04} ${by - h * 0.01}`} stroke={iron2(light)} strokeWidth={7} strokeLinecap="round" />
          </g>
        );
      })()}
    </g>
  );
}

function iron2(light: RoomLight): string {
  return lit(light, '#5a5a5c', 0.6);
}

/** Tongs and hammers hanging from a beam (`y` is the beam's underside). */
export function ToolRack({ x, y, w, light }: { x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const iron = lit(light, '#5a5a5c', 0.5);
  const wood = lit(light, '#5a3a22', 0.5);
  const tools: ReactElement[] = [];
  const n = Math.max(3, Math.round(w / 34));
  for (let i = 0; i < n; i++) {
    const tx = x - w / 2 + (w / (n - 1 || 1)) * i;
    const kind = i % 3;
    if (kind === 0)
      tools.push(
        <g key={i}>
          <line x1={tx} y1={y} x2={tx} y2={y + 14} stroke={iron} strokeWidth={2} />
          <path d={`M${tx - 4} ${y + 14} L${tx - 8} ${y + 90} M${tx + 4} ${y + 14} L${tx + 8} ${y + 90}`} stroke={iron} strokeWidth={4} />
        </g>,
      );
    else if (kind === 1)
      tools.push(
        <g key={i}>
          <line x1={tx} y1={y} x2={tx} y2={y + 70} stroke={wood} strokeWidth={5} />
          <rect x={tx - 12} y={y + 64} width={24} height={14} rx={2} fill={iron} />
        </g>,
      );
    else
      tools.push(
        <g key={i}>
          <line x1={tx} y1={y} x2={tx} y2={y + 12} stroke={iron} strokeWidth={2} />
          <path d={`M${tx} ${y + 12} q 14 30 0 64 q -10 -30 0 -64`} fill={iron} />
        </g>,
      );
  }
  return <g>{tools}</g>;
}

/** A coopered tub or barrel; `water` shows a dark surface catching the light. */
export function Barrel({ x, y, w, h, light, warm = 0.4, water = false }: { x: number; y: number; w: number; h: number; light: RoomLight; warm?: number; water?: boolean }): ReactElement {
  const wood = lit(light, '#5a3e24', warm);
  const hoop = lit(light, '#3a3a3a', warm);
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w * 0.6} ry={w * 0.14} fill="#000" opacity={0.35} />
      <path d={`M${x - w / 2} ${y - h} Q ${x - w * 0.56} ${y - h / 2} ${x - w / 2} ${y} L${x + w / 2} ${y} Q ${x + w * 0.56} ${y - h / 2} ${x + w / 2} ${y - h} Z`} fill={wood} />
      <path d={`M${x - w / 2} ${y - h} Q ${x - w * 0.56} ${y - h / 2} ${x - w / 2} ${y} L${x - w * 0.3} ${y} L${x - w * 0.3} ${y - h} Z`} fill={shade(wood, 0.35)} />
      {[0.15, 0.85].map((f) => (
        <rect key={f} x={x - w * 0.53} y={y - h * (1 - f) - 3} width={w * 1.06} height={6} fill={hoop} />
      ))}
      <ellipse cx={x} cy={y - h} rx={w / 2} ry={w * 0.12} fill={water ? '#141a1e' : shade(wood, 0.2)} stroke={hoop} strokeWidth={3} />
      {water && <ellipse cx={x + w * 0.1} cy={y - h} rx={w * 0.2} ry={w * 0.03} fill={light.fireTint} opacity={0.35 * light.fire} />}
    </g>
  );
}

/**
 * The underside of an open shelter's roof across the top of the view: boards, rafter ends and a front beam
 * whose lower edge is at `y`.
 */
export function Overhang({ y, light, seed = 3 }: { y: number; light: RoomLight; seed?: number }): ReactElement {
  const under = lit(light, '#2e2016', 0.25);
  const rafter = lit(light, '#4a3220', 0.35);
  const r = rng(seed);
  const rafters: ReactElement[] = [];
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 190 + r() * 20;
    rafters.push(<polygon key={i} points={poly([[x - 22, -20], [x + 22, -20], [x + 16, y - 34], [x - 16, y - 34]])} fill={rafter} />);
    rafters.push(<polygon key={`s${i}`} points={poly([[x + 6, -20], [x + 22, -20], [x + 16, y - 34], [x + 4, y - 34]])} fill={shade(rafter, 0.4)} />);
  }
  return (
    <g>
      <rect x={-100} y={-100} width={ROOM_W + 200} height={y + 70} fill={under} />
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={-100} y1={(y - 34) * (i / 6)} x2={ROOM_W + 100} y2={(y - 34) * (i / 6)} stroke={shade(under, 0.4)} strokeWidth={2} />
      ))}
      {rafters}
      <Beam a={[-100, y - 18]} b={[ROOM_W + 100, y - 18]} t={40} light={light} warm={0.4} />
      {/* Icicles in winter, a drip line otherwise. */}
      {light.winter &&
        Array.from({ length: 30 }, (_, i) => {
          const x = i * 56 + r() * 30;
          const l = 10 + r() * 34;
          return <path key={`i${i}`} d={`M${x - 4} ${y} L${x} ${y + l} L${x + 4} ${y} Z`} fill="#dfe8ee" opacity={0.7} />;
        })}
    </g>
  );
}

/**
 * The outdoors beyond an open side: sky (sun or moon, clouds), snow-capped mountains, a nearer ridge, a wood's
 * edge and the meadow up to `groundY`. Uses the outdoor light, so it follows the hour, the season and the weather.
 */
export function Landscape({ uid, light, horizon, groundY, seed }: { uid: string; light: RoomLight; horizon: number; groundY: number; seed: number }): ReactElement {
  const o = light.outdoor;
  const meadow = light.winter ? '#d4d8dc' : '#4e5a2e';
  return (
    <g>
      <Sky uid={uid} light={o} horizon={horizon} seed={seed} />
      <Ridge y={horizon - 40} height={260} colour={outside(light, o.far, 0.9)} seed={seed + 1} roughness={1} snowCaps step={90} />
      <Ridge y={horizon + 10} height={150} colour={outside(light, mix(o.mid, '#3a4a3a', 0.2), 0.55)} seed={seed + 2} roughness={0.8} snowCaps={light.winter} step={70} />
      <Woods x0={-100} x1={ROOM_W + 100} y={horizon + 60} h={90} light={o} distance={0.4} seed={seed + 3} snow={light.winter} />
      <path d={`M-100 ${horizon + 60} C 400 ${horizon + 40}, 900 ${horizon + 80}, ${ROOM_W + 100} ${horizon + 50} L${ROOM_W + 100} ${groundY + 60} L-100 ${groundY + 60} Z`} fill={outside(light, meadow, 0.2)} />
      {light.outdoor.rain && <rect x={-100} y={-100} width={ROOM_W + 200} height={groundY + 100} fill={o.haze} opacity={0.25} />}
    </g>
  );
}
