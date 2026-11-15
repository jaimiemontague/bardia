/**
 * The Sacred Grove, outdoors: a clearing under old yews at the edge of the woods, the sky of the hour above and the
 * hills beyond. A ring of standing stones encloses it; behind the ring stand the seven tall god-posts, grey and
 * weathered, each with its carved face and a trace of old paint (the hooded wanderer with one eye and a raven, the
 * storm-god's broad face and fist, the sea-mother's waves, the gold tears of the giver of plenty, the oath-ring, the
 * grinning flame, the veiled queen of the dead). In the middle lies the flat altar stone with the offerings on it;
 * cloth strips hang from the branches and the ash of the last fire smoulders in a pit.
 *
 * One person: the Grove-keeper beside the altar with the blessing-bowl. The gods and the sacrifice are behind him.
 */
import type { ReactElement } from 'react';
import { Woods } from '../../scenes/land';
import { BONE, INK, mix, rng, shade } from '../../scenes/paint';
import { lit, outside, type RoomLight } from '../light';
import { Hearth, Landscape, RoomSvg, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

const HORIZON = 470;
const GROUND = 590;
const KEEPER_X = 1230;
const FIRE_X = 470;
const RING = { x: 760, y: 712, rx: 560, ry: 86 } as const;

/** Which god a post shows: its carved face and its paint. */
type PostKind = 'wanderer' | 'storm' | 'sea' | 'plenty' | 'oath' | 'flame' | 'queen';

/** A tall carved wooden god-post with a weathered face near the top. */
function GodPost({ x, y, h, w, kind, light }: { x: number; y: number; h: number; w: number; kind: PostKind; light: RoomLight }): ReactElement {
  const wood = lit(light, '#6a5c4a', 0.25);
  const dark = shade(wood, 0.45);
  const crack = shade(wood, 0.6);
  const top = y - h;
  const fy = top + w * 1.05; // the face's centre
  const fw = w * 0.42; // the face's half width
  const paint = {
    wanderer: '#3a4a6a',
    storm: '#9e2f22',
    sea: '#2f5a6a',
    plenty: '#c9a04a',
    oath: '#7a6a4a',
    flame: '#b8501c',
    queen: '#8a8a90',
  }[kind];
  const pc = lit(light, paint, 0.25);
  const eye = (dx: number, closed = false) =>
    closed ? (
      <path d={`M${x + dx - fw * 0.22} ${fy - fw * 0.12} q ${fw * 0.22} ${fw * 0.12} ${fw * 0.44} 0`} stroke={INK} strokeWidth={Math.max(2, w * 0.04)} fill="none" />
    ) : (
      <ellipse cx={x + dx} cy={fy - fw * 0.12} rx={fw * 0.2} ry={fw * 0.13} fill={INK} opacity={0.85} />
    );
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w * 0.9} ry={w * 0.16} fill="#000" opacity={0.35} />
      {/* The pole, a little narrower at the top, split and cracked by the weather. */}
      <path d={`M${x - w / 2} ${y} L${x - w * 0.44} ${top + w * 0.3} Q ${x} ${top - w * 0.12} ${x + w * 0.44} ${top + w * 0.3} L${x + w / 2} ${y} Z`} fill={wood} />
      <path d={`M${x + w * 0.16} ${y} L${x + w * 0.16} ${top + w * 0.4} Q ${x + w * 0.34} ${top + w * 0.2} ${x + w * 0.44} ${top + w * 0.3} L${x + w / 2} ${y} Z`} fill={dark} opacity={0.6} />
      <path d={`M${x - w * 0.18} ${y - h * 0.08} l ${w * 0.04} ${-h * 0.3} M${x + w * 0.06} ${y - h * 0.2} l ${-w * 0.03} ${-h * 0.24}`} stroke={crack} strokeWidth={Math.max(1.5, w * 0.03)} />
      {/* Bands carved round it under the face. */}
      {[1.95, 2.2].map((f) => (
        <rect key={f} x={x - w * 0.46} y={top + w * f} width={w * 0.92} height={w * 0.1} fill={dark} opacity={0.8} />
      ))}
      <path d={`M${x - w * 0.4} ${top + w * 2.6} q ${w * 0.4} ${w * 0.4} ${w * 0.8} 0 M${x - w * 0.4} ${top + w * 3.0} q ${w * 0.4} ${w * 0.4} ${w * 0.8} 0`} stroke={dark} strokeWidth={Math.max(1.5, w * 0.05)} fill="none" opacity={0.7} />
      {/* The face: a brow ridge, deep eyes, a long nose, a mouth. */}
      <path d={`M${x - fw} ${fy - fw * 0.36} Q ${x} ${fy - fw * 0.66} ${x + fw} ${fy - fw * 0.36}`} stroke={dark} strokeWidth={Math.max(2.5, w * 0.08)} fill="none" />
      {kind === 'wanderer' ? (
        <>
          {/* One eye open, one shut: the wanderer gave the other for wisdom. */}
          {eye(-fw * 0.45)}
          <path d={`M${x + fw * 0.25} ${fy - fw * 0.2} l ${fw * 0.4} ${fw * 0.12}`} stroke={INK} strokeWidth={Math.max(2, w * 0.05)} />
        </>
      ) : (
        <>
          {eye(-fw * 0.45, kind === 'queen' || kind === 'oath')}
          {eye(fw * 0.45, kind === 'queen' || kind === 'oath')}
        </>
      )}
      <path d={`M${x} ${fy - fw * 0.2} L${x - fw * 0.14} ${fy + fw * 0.34} L${x + fw * 0.12} ${fy + fw * 0.36}`} stroke={dark} strokeWidth={Math.max(2, w * 0.05)} fill="none" />
      {kind === 'flame' ? (
        <path d={`M${x - fw * 0.55} ${fy + fw * 0.55} Q ${x} ${fy + fw * 1.05} ${x + fw * 0.55} ${fy + fw * 0.55} Q ${x} ${fy + fw * 0.75} ${x - fw * 0.55} ${fy + fw * 0.55} Z`} fill={INK} opacity={0.85} />
      ) : (
        <path d={`M${x - fw * 0.36} ${fy + fw * 0.66} L${x + fw * 0.36} ${fy + fw * 0.66}`} stroke={INK} strokeWidth={Math.max(2, w * 0.05)} opacity={0.85} />
      )}
      {/* What each god carries, in carving and old paint. */}
      {kind === 'wanderer' && (
        <>
          <path d={`M${x - w * 0.5} ${fy + fw * 0.3} L${x - w * 0.46} ${top + w * 0.2} Q ${x} ${top - w * 0.3} ${x + w * 0.46} ${top + w * 0.2} L${x + w * 0.5} ${fy + fw * 0.3} L${x + fw * 1.05} ${fy - fw * 0.5} Q ${x} ${fy - fw * 1.5} ${x - fw * 1.05} ${fy - fw * 0.5} Z`} fill={pc} opacity={0.85} />
          <path d={`M${x + w * 0.1} ${top - w * 0.05} q ${w * 0.2} ${-w * 0.36} ${w * 0.44} ${-w * 0.2} l ${w * 0.18} ${w * 0.02} l ${-w * 0.16} ${w * 0.08} q ${-w * 0.06} ${w * 0.2} ${-w * 0.36} ${w * 0.22} Z`} fill={lit(light, '#18181e', 0.2)} />
          <path d={`M${x - fw * 0.5} ${fy + fw * 0.8} L${x} ${fy + fw * 1.6} L${x + fw * 0.5} ${fy + fw * 0.8}`} fill={shade(wood, 0.2)} />
        </>
      )}
      {kind === 'storm' && (
        <>
          <path d={`M${x - fw * 0.8} ${fy + fw * 0.5} Q ${x} ${fy + fw * 1.9} ${x + fw * 0.8} ${fy + fw * 0.5}`} fill={shade(wood, 0.25)} />
          <path d={`M${x - w * 0.3} ${top + w * 2.5} l ${w * 0.22} ${w * 0.24} l ${-w * 0.12} ${w * 0.08} l ${w * 0.3} ${w * 0.34}`} stroke={pc} strokeWidth={Math.max(3, w * 0.08)} fill="none" />
          <rect x={x + w * 0.08} y={top + w * 2.5} width={w * 0.3} height={w * 0.34} rx={w * 0.08} fill={shade(wood, 0.15)} stroke={dark} strokeWidth={2} />
          <path d={`M${x - fw * 1.0} ${fy - fw * 0.4} L${x - fw * 0.7} ${fy - fw * 0.1} M${x + fw} ${fy - fw * 0.4} L${x + fw * 0.7} ${fy - fw * 0.1}`} stroke={pc} strokeWidth={Math.max(2, w * 0.05)} />
        </>
      )}
      {kind === 'sea' && (
        <>
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${x - w * 0.42} ${top + w * (2.6 + i * 0.32)} q ${w * 0.14} ${-w * 0.14} ${w * 0.28} 0 q ${w * 0.14} ${w * 0.14} ${w * 0.28} 0 q ${w * 0.14} ${-w * 0.14} ${w * 0.28} 0`} stroke={pc} strokeWidth={Math.max(2.5, w * 0.06)} fill="none" />
          ))}
          <path d={`M${x - fw * 1.05} ${fy - fw * 0.3} Q ${x - fw * 1.3} ${fy + fw * 1.2} ${x - fw * 0.6} ${fy + fw * 1.8} M${x + fw * 1.05} ${fy - fw * 0.3} Q ${x + fw * 1.3} ${fy + fw * 1.2} ${x + fw * 0.6} ${fy + fw * 1.8}`} stroke={shade(wood, 0.3)} strokeWidth={Math.max(3, w * 0.08)} fill="none" />
        </>
      )}
      {kind === 'plenty' && (
        <>
          {[-1, 1].map((s) => (
            <path key={s} d={`M${x + s * fw * 0.45} ${fy} q ${-fw * 0.08} ${fw * 0.3} 0 ${fw * 0.42} q ${fw * 0.08} ${-fw * 0.12} 0 ${-fw * 0.42}`} fill={lit(light, '#e0b850', 0.4)} />
          ))}
          <path d={`M${x} ${top + w * 2.4} l 0 ${w * 0.9} M${x} ${top + w * 2.6} l ${-w * 0.18} ${-w * 0.14} M${x} ${top + w * 2.6} l ${w * 0.18} ${-w * 0.14} M${x} ${top + w * 2.85} l ${-w * 0.2} ${-w * 0.14} M${x} ${top + w * 2.85} l ${w * 0.2} ${-w * 0.14}`} stroke={pc} strokeWidth={Math.max(2, w * 0.05)} />
        </>
      )}
      {kind === 'oath' && (
        <>
          <ellipse cx={x} cy={top + w * 2.7} rx={w * 0.26} ry={w * 0.26} fill="none" stroke={pc} strokeWidth={Math.max(3, w * 0.08)} />
          <path d={`M${x - w * 0.46} ${top + w * 2.3} L${x + w * 0.46} ${top + w * 3.1} M${x + w * 0.46} ${top + w * 2.3} L${x - w * 0.46} ${top + w * 3.1}`} stroke={dark} strokeWidth={Math.max(2, w * 0.05)} opacity={0.6} />
        </>
      )}
      {kind === 'flame' && (
        <>
          <path d={`M${x - w * 0.44} ${top + w * 0.3} L${x - w * 0.3} ${top - w * 0.36} L${x - w * 0.12} ${top + w * 0.06} L${x} ${top - w * 0.52} L${x + w * 0.14} ${top + w * 0.06} L${x + w * 0.3} ${top - w * 0.36} L${x + w * 0.44} ${top + w * 0.3} Z`} fill={wood} />
          <path d={`M${x - w * 0.3} ${top - w * 0.2} L${x - w * 0.12} ${top + w * 0.18} L${x} ${top - w * 0.36} L${x + w * 0.14} ${top + w * 0.18} L${x + w * 0.3} ${top - w * 0.2}`} stroke={pc} strokeWidth={Math.max(2.5, w * 0.07)} fill="none" />
          <path d={`M${x - fw * 0.9} ${fy + fw * 0.3} Q ${x - fw} ${fy + fw * 0.6} ${x - fw * 0.6} ${fy + fw * 0.6} M${x + fw * 0.9} ${fy + fw * 0.3} Q ${x + fw} ${fy + fw * 0.6} ${x + fw * 0.6} ${fy + fw * 0.6}`} stroke={dark} strokeWidth={2} fill="none" />
        </>
      )}
      {kind === 'queen' && (
        <>
          <path d={`M${x - w * 0.5} ${fy + fw * 2.2} L${x - w * 0.46} ${top + w * 0.25} Q ${x} ${top - w * 0.2} ${x + w * 0.46} ${top + w * 0.25} L${x + w * 0.5} ${fy + fw * 2.2} L${x + fw * 0.95} ${fy + fw * 0.8} L${x + fw * 1.0} ${fy - fw * 0.5} Q ${x} ${fy - fw * 1.3} ${x - fw * 1.0} ${fy - fw * 0.5} L${x - fw * 0.95} ${fy + fw * 0.8} Z`} fill={pc} opacity={0.7} />
          <path d={`M${x} ${fy - fw * 0.9} L${x} ${fy + fw * 0.9}`} stroke={lit(light, BONE, 0.2)} strokeWidth={Math.max(1.5, w * 0.03)} opacity={0.4} />
        </>
      )}
      {/* A faint lit edge from the sky. */}
      <path d={`M${x - w * 0.44} ${top + w * 0.3} L${x - w / 2} ${y}`} stroke={mix(wood, BONE, 0.3)} strokeWidth={Math.max(1.5, w * 0.04)} opacity={0.4} />
    </g>
  );
}

/** A standing stone, rough and lichened. */
function Stone({ x, y, w, h, light, distance, seed }: { x: number; y: number; w: number; h: number; light: RoomLight; distance: number; seed: number }): ReactElement {
  const r = rng(seed);
  const c = mix(lit(light, '#7a766c', 0.15), light.outdoor.haze, distance * light.outdoor.hazeAmount * 0.5);
  const lean = (r() - 0.5) * w * 0.3;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w * 0.75} ry={w * 0.14} fill="#000" opacity={0.3} />
      <path d={`M${x - w / 2} ${y} L${x - w * 0.42 + lean} ${y - h * 0.82} Q ${x + lean} ${y - h * (1.02 + r() * 0.08)} ${x + w * 0.4 + lean} ${y - h * 0.78} L${x + w / 2} ${y} Z`} fill={c} />
      <path d={`M${x + w * 0.12} ${y} L${x + w * 0.14 + lean} ${y - h * 0.86} Q ${x + w * 0.3 + lean} ${y - h * 0.84} ${x + w * 0.4 + lean} ${y - h * 0.78} L${x + w / 2} ${y} Z`} fill={shade(c, 0.35)} />
      <ellipse cx={x - w * 0.12} cy={y - h * 0.4} rx={w * 0.12} ry={h * 0.06} fill={outside(light, '#7a8a4a', distance)} opacity={0.5} />
      {light.winter && <path d={`M${x - w * 0.42 + lean} ${y - h * 0.82} Q ${x + lean} ${y - h * 1.04} ${x + w * 0.4 + lean} ${y - h * 0.78} Q ${x + lean} ${y - h * 0.9} ${x - w * 0.42 + lean} ${y - h * 0.82} Z`} fill="#e8eef2" opacity={0.85} />}
    </g>
  );
}

/** An old yew: a broad fluted trunk, roots, dark heavy boughs; cloth strips tied to its branches. */
function OldTree({ x, y, w, top, light, side, seed }: { x: number; y: number; w: number; top: number; light: RoomLight; side: -1 | 1; seed: number }): ReactElement {
  const r = rng(seed);
  const bark = lit(light, '#4a3a2c', 0.15);
  const dark = shade(bark, 0.45);
  const leaf = lit(light, light.winter ? '#2e3a2c' : '#26361e', 0.1);
  const cloths = ['#9e2f22', '#d8c8a0', '#2f4f7a', '#c9a04a'];
  const masses: ReactElement[] = [];
  for (let i = 0; i < 9; i++) {
    const cx = x + side * (r() * 520 - 60);
    const cy = top + r() * 200;
    const rx = 120 + r() * 140;
    masses.push(<ellipse key={i} cx={cx} cy={cy} rx={rx} ry={rx * 0.55} fill={shade(leaf, r() * 0.3)} />);
    if (light.winter && r() < 0.7) masses.push(<ellipse key={`s${i}`} cx={cx} cy={cy - rx * 0.4} rx={rx * 0.7} ry={rx * 0.14} fill="#e2e8ec" opacity={0.75} />);
  }
  return (
    <g>
      {masses}
      {/* The trunk and two great boughs. */}
      <path d={`M${x - w / 2 - 40} ${y} Q ${x - w * 0.42} ${y - 300} ${x - w * 0.36} ${top + 120} L${x + w * 0.36} ${top + 120} Q ${x + w * 0.44} ${y - 300} ${x + w / 2 + 40} ${y} Z`} fill={bark} />
      <path d={`M${x + side * w * 0.2} ${top + 260} Q ${x + side * 220} ${top + 120} ${x + side * 460} ${top + 90}`} stroke={bark} strokeWidth={w * 0.32} fill="none" strokeLinecap="round" />
      <path d={`M${x - side * w * 0.1} ${top + 180} Q ${x - side * 60} ${top + 40} ${x - side * 30} ${top - 60}`} stroke={bark} strokeWidth={w * 0.26} fill="none" strokeLinecap="round" />
      {[-0.25, 0, 0.22].map((f) => (
        <path key={f} d={`M${x + f * w} ${y - 10} Q ${x + f * w * 1.2} ${y - 260} ${x + f * w * 0.9} ${top + 140}`} stroke={dark} strokeWidth={6} fill="none" opacity={0.7} />
      ))}
      <path d={`M${x - side * w * 0.5} ${y} Q ${x - side * w * 0.3} ${y - 200} ${x - side * w * 0.38} ${top + 140} L${x - side * w * 0.2} ${top + 140} Q ${x - side * w * 0.1} ${y - 200} ${x - side * w * 0.2} ${y} Z`} fill={dark} opacity={0.6} />
      {/* Roots running out into the grass. */}
      <path d={`M${x - w / 2 - 40} ${y} q ${-60} 10 ${-120} 30 M${x + w / 2 + 40} ${y} q 70 10 130 34`} stroke={bark} strokeWidth={22} fill="none" strokeLinecap="round" />
      {/* Strips of cloth tied to the bough. */}
      {cloths.map((c, i) => {
        const bx = x + side * (120 + i * 80);
        const by = top + 150 - i * 14;
        return <path key={c} d={`M${bx} ${by} q ${-6 + i * 3} 30 ${4} ${60 + (i % 2) * 20} l 10 -4 q -8 -28 -2 -56 Z`} fill={lit(light, c, 0.1)} opacity={0.9} />;
      })}
    </g>
  );
}

/** The flat altar stone with the offerings laid on it. */
function Altar({ x, y, w, light }: { x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const stone = lit(light, '#6e6a62', 0.35);
  const silver = lit(light, '#d8dcd8', 0.5);
  const h = w * 0.22;
  return (
    <g>
      <ellipse cx={x} cy={y + 6} rx={w * 0.62} ry={w * 0.08} fill="#000" opacity={0.4} />
      {/* The block and its flat top. */}
      <path d={`M${x - w / 2} ${y} L${x - w * 0.48} ${y - h} L${x + w * 0.48} ${y - h} L${x + w / 2} ${y} Z`} fill={shade(stone, 0.25)} />
      <path d={`M${x - w * 0.48} ${y - h} L${x - w * 0.4} ${y - h - w * 0.1} L${x + w * 0.42} ${y - h - w * 0.1} L${x + w * 0.48} ${y - h} Z`} fill={stone} />
      <path d={`M${x - w * 0.2} ${y - h * 0.3} l ${w * 0.06} ${-h * 0.5} M${x + w * 0.24} ${y - h * 0.2} l ${-w * 0.02} ${-h * 0.6}`} stroke={shade(stone, 0.55)} strokeWidth={2} />
      {light.winter && <path d={`M${x - w * 0.48} ${y - h} L${x - w * 0.4} ${y - h - w * 0.1} L${x - w * 0.1} ${y - h - w * 0.1} L${x - w * 0.16} ${y - h} Z`} fill="#e8eef2" opacity={0.8} />}
      {/* A stain darker than the stone where the blood was poured. */}
      <ellipse cx={x + w * 0.05} cy={y - h - w * 0.05} rx={w * 0.12} ry={w * 0.025} fill={lit(light, '#4a1a14', 0.3)} opacity={0.7} />
      {/* The offerings: a bowl, loaves, apples, a sheaf, silver rings, a drinking horn. */}
      <path d={`M${x - w * 0.36} ${y - h - w * 0.08} Q ${x - w * 0.28} ${y - h - w * 0.01} ${x - w * 0.2} ${y - h - w * 0.08} Z`} fill={lit(light, '#7a5232', 0.4)} />
      <ellipse cx={x - w * 0.28} cy={y - h - w * 0.08} rx={w * 0.08} ry={w * 0.014} fill={lit(light, '#5a2a1a', 0.4)} />
      {[0, 1].map((i) => (
        <ellipse key={i} cx={x - w * 0.1 + i * w * 0.09} cy={y - h - w * 0.1} rx={w * 0.05} ry={w * 0.03} fill={lit(light, '#b8864a', 0.45)} />
      ))}
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={x + w * 0.12 + i * w * 0.035} cy={y - h - w * 0.085 - (i === 1 ? w * 0.02 : 0)} r={w * 0.018} fill={lit(light, i === 1 ? '#c8a03a' : '#a8402a', 0.45)} />
      ))}
      <path d={`M${x + w * 0.26} ${y - h - w * 0.09} L${x + w * 0.3} ${y - h - w * 0.3} M${x + w * 0.28} ${y - h - w * 0.09} L${x + w * 0.27} ${y - h - w * 0.32} M${x + w * 0.3} ${y - h - w * 0.09} L${x + w * 0.34} ${y - h - w * 0.29}`} stroke={lit(light, '#c8a85a', 0.45)} strokeWidth={4} />
      <rect x={x + w * 0.255} y={y - h - w * 0.16} width={w * 0.06} height={w * 0.016} fill={lit(light, '#8a6a3a', 0.4)} />
      {[0, 1].map((i) => (
        <ellipse key={i} cx={x - w * 0.02 + i * w * 0.05} cy={y - h - w * 0.065} rx={w * 0.022} ry={w * 0.008} fill="none" stroke={silver} strokeWidth={2.4} />
      ))}
      <path d={`M${x + w * 0.36} ${y - h - w * 0.07} q ${w * 0.04} ${-w * 0.02} ${w * 0.08} ${-w * 0.08} l ${w * 0.012} ${w * 0.008} q ${-w * 0.02} ${w * 0.07} ${-w * 0.09} ${w * 0.085} Z`} fill={lit(light, BONE, 0.45)} />
    </g>
  );
}

/** The procedural Sacred Grove (1600 × 900). */
export function GrovePainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const o = light.outdoor;
  const grass = light.winter ? '#cfd4d8' : '#3e4a26';
  const posts: { kind: PostKind; x: number; y: number; h: number; w: number }[] = [
    { kind: 'queen', x: 390, y: 632, h: 300, w: 46 },
    { kind: 'sea', x: 510, y: 616, h: 330, w: 50 },
    { kind: 'storm', x: 630, y: 606, h: 360, w: 56 },
    { kind: 'wanderer', x: 760, y: 600, h: 400, w: 60 },
    { kind: 'oath', x: 890, y: 606, h: 360, w: 56 },
    { kind: 'plenty', x: 1010, y: 616, h: 330, w: 50 },
    { kind: 'flame', x: 1130, y: 632, h: 300, w: 46 },
  ];
  const stones = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    const near = Math.sin(a);
    return { i, a, x: RING.x + Math.cos(a) * RING.rx, y: RING.y + near * RING.ry, near };
  });
  const back = stones.filter((s) => s.near < 0);
  // The ring is open toward us: no stone stands before the altar, the fire-pit or the Grove-keeper.
  const front = stones.filter((s) => s.near >= 0 && Math.abs(s.x - KEEPER_X) > 130 && Math.abs(s.x - RING.x) > 250 && Math.abs(s.x - FIRE_X) > 100);
  const stone = (s: (typeof stones)[number]) => {
    const k = 0.75 + (s.near + 1) * 0.35;
    return <Stone key={s.i} x={s.x} y={s.y} w={46 * k} h={92 * k} light={light} distance={(1 - s.near) * 0.4} seed={seed + s.i * 7} />;
  };
  return (
    <RoomSvg uid={uid} light={light} sky={{ horizon: HORIZON }} testId="interior-painting-grove">
      <Landscape uid={uid} light={light} horizon={HORIZON} groundY={GROUND} seed={seed} />
      {/* The wood behind the clearing. */}
      <Woods x0={-100} x1={1700} y={GROUND - 10} h={190} light={o} distance={0.25} seed={seed + 9} snow={light.winter} />
      <Woods x0={-60} x1={1700} y={GROUND + 10} h={150} light={o} distance={0.1} seed={seed + 13} snow={light.winter} />
      {/* The clearing's floor: grass, moss and a worn path to the altar. */}
      <path d={`M-100 ${GROUND} C 400 ${GROUND - 14}, 1200 ${GROUND + 10}, 1700 ${GROUND - 6} L1700 1000 L-100 1000 Z`} fill={lit(light, grass, 0.15)} />
      <ellipse cx={RING.x} cy={RING.y + 10} rx={RING.rx + 40} ry={RING.ry + 30} fill={lit(light, light.winter ? '#b8bec2' : '#4a5230', 0.2)} opacity={0.7} />
      <path d={`M${RING.x - 60} ${RING.y + 30} Q ${RING.x - 40} 820 ${RING.x - 160} 920 L${RING.x + 120} 920 Q ${RING.x + 40} 820 ${RING.x + 60} ${RING.y + 30} Z`} fill={lit(light, light.winter ? '#a8aeb2' : '#5a4a32', 0.2)} opacity={0.7} />
      {Array.from({ length: 40 }, (_, i) => {
        const r = rng(seed + i);
        const x = r() * 1600;
        const y = GROUND + 20 + Math.pow(r(), 1.3) * 300;
        const l = 6 + (y - GROUND) * 0.06;
        return <path key={`g${i}`} d={`M${x} ${y} l -3 ${-l} M${x + 4} ${y} l 1 ${-l * 1.2} M${x + 8} ${y} l 4 ${-l}`} stroke={lit(light, light.winter ? '#8a9090' : '#5a6a32', 0.15)} strokeWidth={1.5} opacity={0.7} />;
      })}

      {/* The god-posts behind the ring, the back of the ring in front of them. */}
      {posts.map((p) => (
        <GodPost key={p.kind} {...p} light={light} />
      ))}
      {back.map(stone)}

      {/* The fire-pit's last embers. */}
      <Hearth uid={uid} x={FIRE_X} y={790} rx={70} ry={18} light={light} flame={0.45} />

      <Altar x={RING.x} y={752} w={340} light={light} />

      {/* The Grove-keeper beside the altar with the blessing-bowl. */}
      <Person x={KEEPER_X} y={826} h={430} hold="cup" flip light={light} warmSide="left" warm={0.35} look={{ tunic: '#d8ccb0', trim: '#5a7a3a', cloak: '#3e5a34', head: 'hood', hair: '#d0ccc4', hairStyle: 'long', beard: 'long', build: 'normal', trousers: '#5a5040', skin: '#c49a7a' }} />

      {front.map(stone)}

      {/* The old yews framing the clearing. */}
      <OldTree x={40} y={900} w={180} top={-60} light={light} side={1} seed={seed + 21} />
      <OldTree x={1580} y={900} w={200} top={-80} light={light} side={-1} seed={seed + 31} />
    </RoomSvg>
  );
}

/** The Sacred Grove: its painting and its one person. */
export const groveRoom: InteriorRoomDef = {
  id: 'grove',
  titleKey: 'hub.building.grove.name',
  assetId: 'hub.interior.grove',
  Painting: GrovePainting,
  people: [
    {
      id: 'groveKeeper',
      x: KEEPER_X,
      y: 840,
      w: 230,
      h: 470,
      nameKey: 'faith.interior.grove.groveKeeper.name',
      greetingKey: 'faith.interior.grove.groveKeeper.greeting',
      icon: 'favor',
      wide: true,
    },
  ],
};
