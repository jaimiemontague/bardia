/**
 * The Shipyard, out on the slip by the fjord under a wide sky: a half-built hull stands on its stocks, the lower
 * strakes lapped on and the bare ribs rising above them, one wright at work inside her and another at the stem.
 * Stacked timber lies in the foreground beside a tar pot steaming over a small fire. Beyond, the house's ships lie
 * drawn up on the strand before the boat sheds, and the fjord runs away between the mountains.
 *
 * People: the Shipwright (the master, adze in hand: new ships and the slipways) and a spot, the ships drawn up on
 * the strand (your ships and their repairs).
 */
import type { ReactElement } from 'react';
import { Ridge, Sky, Smoke } from '../../scenes/layers';
import { Woods } from '../../scenes/land';
import { mix, rng, shade } from '../../scenes/paint';
import { lit, outside, type RoomLight } from '../light';
import { FireGlow, Flames, RoomSvg, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

const HORIZON = 420;
/** The far shore of the fjord, where the water begins. */
const WATER_TOP = 470;
/** The ground under the hull and its stocks. */
const SLIP = 745;

/** The hull on the stocks: u (0 stern … 1 stem) to x, the sheer line and the keel. */
const HX0 = 540;
const HX1 = 1150;
const hx = (u: number): number => HX0 + u * (HX1 - HX0);
const sheer = (u: number): number => 545 - 165 * (2 * u - 1) ** 2;
const keel = (u: number): number => 700 - 62 * (2 * u - 1) ** 2;

/** The fjord between the shores: a band of water with a sheen, and the far shore's woods and farms. */
function Fjord({ uid, light, seed }: { uid: string; light: RoomLight; seed: number }): ReactElement {
  const o = light.outdoor;
  const r = rng(seed + 11);
  const glints: ReactElement[] = [];
  for (let i = 0; i < 26; i++) {
    const t = r();
    const y = WATER_TOP + 8 + t * 110;
    const x = r() * 1700 - 50;
    glints.push(<rect key={i} x={x} y={y} width={18 + t * 60} height={1 + t * 2} fill={mix(o.sea[0], '#ffffff', 0.3)} opacity={0.18 + 0.2 * (1 - t)} />);
  }
  const roofs = [
    { x: 1080, w: 70 },
    { x: 1160, w: 90 },
    { x: 1270, w: 60 },
  ];
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-fjord`} x1="0" y1={WATER_TOP} x2="0" y2={640} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={o.sea[0]} />
          <stop offset="0.5" stopColor={o.sea[1]} />
          <stop offset="1" stopColor={shade(o.sea[1], 0.25)} />
        </linearGradient>
      </defs>
      <Ridge y={HORIZON - 10} height={250} colour={outside(light, o.far, 0.85)} seed={seed + 1} roughness={1} snowCaps step={95} />
      <Ridge y={HORIZON + 40} height={150} colour={outside(light, mix(o.mid, '#34443a', 0.25), 0.55)} seed={seed + 2} roughness={0.7} snowCaps={light.winter} step={80} />
      <Woods x0={-100} x1={1700} y={WATER_TOP + 4} h={70} light={o} distance={0.5} seed={seed + 3} snow={light.winter} />
      {/* A farm on the far shore. */}
      {roofs.map(({ x, w }) => (
        <g key={x}>
          <rect x={x - w / 2} y={WATER_TOP - 16} width={w} height={14} fill={outside(light, '#5a4630', 0.6)} />
          <path d={`M${x - w / 2 - 6} ${WATER_TOP - 14} Q ${x} ${WATER_TOP - 40} ${x + w / 2 + 6} ${WATER_TOP - 14} Z`} fill={outside(light, light.winter ? '#dfe3e6' : '#56602e', 0.6)} />
        </g>
      ))}
      <rect x={-100} y={WATER_TOP} width={1800} height={200} fill={`url(#${uid}-fjord)`} />
      {glints}
      {o.orb.glow !== 'rgba(0,0,0,0)' && !o.rain && <path d={`M${o.orb.x - 20} ${WATER_TOP} L${o.orb.x + 20} ${WATER_TOP} L${o.orb.x + 120} 640 L${o.orb.x - 120} 640 Z`} fill={o.orb.colour} opacity={o.orb.moon ? 0.08 : 0.12} />}
    </g>
  );
}

/** A long boat shed (naust) with its gable to the water: low stone sides and a turf roof. */
function BoatShed({ x, y, w, light }: { x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const wall = outside(light, '#5e5346', 0.3);
  const roof = outside(light, light.winter ? '#dde2e6' : '#5a6432', 0.3);
  const dark = outside(light, '#1e1610', 0.3);
  const h = w * 0.55;
  return (
    <g>
      <rect x={x - w / 2} y={y - h * 0.5} width={w} height={h * 0.5} fill={wall} />
      <path d={`M${x - w / 2 - 8} ${y - h * 0.46} L${x} ${y - h} L${x + w / 2 + 8} ${y - h * 0.46} Z`} fill={roof} />
      <path d={`M${x - w * 0.3} ${y} L${x - w * 0.3} ${y - h * 0.5} L${x} ${y - h * 0.8} L${x + w * 0.3} ${y - h * 0.5} L${x + w * 0.3} ${y} Z`} fill={dark} />
      <line x1={x - w / 2 - 8} y1={y - h * 0.46} x2={x} y2={y - h} stroke={shade(roof, 0.35)} strokeWidth={3} />
    </g>
  );
}

/** A ship drawn up on the strand on her rollers, mast lowered along her, shields stowed. */
function BeachedHull({ x, y, L, light, colour, facing = 1 }: { x: number; y: number; L: number; light: RoomLight; colour: string; facing?: 1 | -1 }): ReactElement {
  const hull = outside(light, '#2e1f12', 0.2);
  const strake = outside(light, '#5a4128', 0.2);
  const g = -0.13 * L;
  const end = -0.3 * L;
  const d = `M${-0.5 * L} ${end} C ${-0.42 * L} ${-0.1 * L}, ${-0.32 * L} ${g}, ${-0.2 * L} ${g} L${0.2 * L} ${g} C ${0.32 * L} ${g}, ${0.42 * L} ${-0.1 * L}, ${0.5 * L} ${end} C ${0.46 * L} ${-0.08 * L}, ${0.34 * L} 0, ${0.2 * L} 0 L${-0.2 * L} 0 C ${-0.34 * L} 0, ${-0.46 * L} ${-0.08 * L}, ${-0.5 * L} ${end} Z`;
  return (
    <g transform={`translate(${x} ${y}) scale(${facing} 1)`}>
      <ellipse cx={0} cy={4} rx={0.55 * L} ry={0.03 * L + 3} fill="#000" opacity={0.3} />
      {[-0.3, 0, 0.3].map((f) => (
        <rect key={f} x={f * L - 0.02 * L} y={-2} width={0.04 * L} height={8} rx={3} fill={outside(light, '#6a4a2a', 0.2)} />
      ))}
      <path d={d} fill={hull} stroke="#120c08" strokeWidth={1.5} />
      <path d={`M${-0.47 * L} ${end * 0.72} C ${-0.36 * L} ${-0.05 * L}, ${0.36 * L} ${-0.05 * L}, ${0.47 * L} ${end * 0.72}`} stroke={strake} strokeWidth={2} fill="none" />
      <path d={`M${-0.45 * L} ${end * 0.45} C ${-0.36 * L} ${-0.02 * L}, ${0.36 * L} ${-0.02 * L}, ${0.45 * L} ${end * 0.45}`} stroke={strake} strokeWidth={1.5} fill="none" opacity={0.7} />
      {/* The mast lowered fore and aft on its crutches, the sail lashed to the yard. */}
      <line x1={-0.36 * L} y1={g - 0.07 * L} x2={0.38 * L} y2={g - 0.09 * L} stroke={outside(light, '#2a1c12', 0.2)} strokeWidth={Math.max(3, L * 0.018)} />
      <path d={`M${-0.3 * L} ${g - 0.07 * L} Q 0 ${g - 0.02 * L} ${0.3 * L} ${g - 0.09 * L}`} stroke={outside(light, mix('#b8a888', colour, 0.15), 0.2)} strokeWidth={Math.max(3, L * 0.022)} fill="none" strokeLinecap="round" />
      <path d={`M${0.5 * L} ${end} q ${0.04 * L} ${-0.08 * L} ${-0.02 * L} ${-0.13 * L}`} stroke={hull} strokeWidth={Math.max(3, L * 0.02)} fill="none" strokeLinecap="round" />
      <path d={`M${-0.5 * L} ${end} q ${-0.04 * L} ${-0.08 * L} ${0.02 * L} ${-0.13 * L}`} stroke={hull} strokeWidth={Math.max(3, L * 0.02)} fill="none" strokeLinecap="round" />
    </g>
  );
}

/** The half-built hull on her stocks: ribs, the lower strakes lapped on, the stem and sternpost, shores and blocks. */
function HullOnStocks({ light }: { light: RoomLight }): ReactElement {
  const oak = lit(light, '#7a5a36', 0.15);
  const oakDark = shade(oak, 0.35);
  const rib = lit(light, '#5e4226', 0.15);
  const N = 40;
  const us = Array.from({ length: N + 1 }, (_, i) => 0.03 + (i / N) * 0.94);
  // The planking reaches this far from the keel toward the sheer, strake by strake.
  const STRAKES = 5;
  const reach = 0.56;
  const lineAt = (f: number) => us.map((u) => [hx(u), keel(u) - f * (keel(u) - sheer(u))] as const);
  const strakes: ReactElement[] = [];
  for (let s = 0; s < STRAKES; s++) {
    const lo = lineAt((s / STRAKES) * reach);
    const hi = lineAt(((s + 1) / STRAKES) * reach + 0.012);
    const pts = [...lo, ...[...hi].reverse()].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const fill = s % 2 === 0 ? oak : mix(oak, '#8a6a44', 0.25);
    strakes.push(<polygon key={`s${s}`} points={pts} fill={fill} />);
    // The lap of each strake over the one below: a dark line and a lit lip.
    strakes.push(<polyline key={`l${s}`} points={lo.map(([x, y]) => `${x.toFixed(1)},${(y + 1).toFixed(1)}`).join(' ')} fill="none" stroke={oakDark} strokeWidth={3} />);
    strakes.push(<polyline key={`h${s}`} points={hi.map(([x, y]) => `${x.toFixed(1)},${(y + 2).toFixed(1)}`).join(' ')} fill="none" stroke={mix(oak, '#f0d8a8', 0.3)} strokeWidth={1.2} opacity={0.6} />);
  }
  // Rivet heads along the laps.
  const rivets: ReactElement[] = [];
  for (let s = 1; s <= STRAKES; s++) {
    for (let i = 2; i < N - 1; i += 3) {
      const u = us[i] ?? 0.5;
      const y = keel(u) - ((s / STRAKES) * reach) * (keel(u) - sheer(u));
      rivets.push(<circle key={`${s}-${i}`} cx={hx(u)} cy={y + 4} r={1.8} fill={lit(light, '#3a3a3a', 0.2)} />);
    }
  }
  const ribs = [0.14, 0.22, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86].map((u) => {
    const x = hx(u);
    const top = sheer(u) - 6;
    const bot = keel(u) - 8;
    // The far side's rib top shows just behind the near one.
    return (
      <g key={u}>
        <path d={`M${x + 10} ${bot} Q ${x + 24} ${(top + bot) / 2} ${x + 16} ${top + 14}`} stroke={shade(rib, 0.3)} strokeWidth={9} fill="none" strokeLinecap="round" />
        <path d={`M${x} ${bot} Q ${x - 10} ${(top + bot) / 2} ${x - 4} ${top}`} stroke={rib} strokeWidth={11} fill="none" strokeLinecap="round" />
        <path d={`M${x - 3} ${bot} Q ${x - 13} ${(top + bot) / 2} ${x - 7} ${top + 2}`} stroke={mix(rib, '#e8c890', 0.25)} strokeWidth={2} fill="none" opacity={0.6} />
      </g>
    );
  });
  const blocks = [0.18, 0.5, 0.82].map((u) => {
    const x = hx(u);
    const k = keel(u);
    return (
      <g key={u}>
        <rect x={x - 34} y={k - 2} width={68} height={SLIP - k + 2} fill={lit(light, '#4a3420', 0.1)} />
        {Array.from({ length: Math.max(1, Math.floor((SLIP - k) / 18)) }, (_, i) => (
          <line key={i} x1={x - 34} y1={k + 16 + i * 18} x2={x + 34} y2={k + 16 + i * 18} stroke={lit(light, '#2a1c12', 0.1)} strokeWidth={2} />
        ))}
      </g>
    );
  });
  const shores = [0.3, 0.66].map((u) => (
    <line key={u} x1={hx(u) + 70} y1={SLIP + 6} x2={hx(u) + 6} y2={keel(u) - 0.35 * (keel(u) - sheer(u))} stroke={lit(light, '#5a3e24', 0.1)} strokeWidth={12} strokeLinecap="round" />
  ));
  return (
    <g>
      <ellipse cx={(HX0 + HX1) / 2} cy={SLIP + 4} rx={(HX1 - HX0) * 0.58} ry={18} fill="#000" opacity={0.3} />
      {blocks}
      {/* The keel. */}
      <polyline points={us.map((u) => `${hx(u).toFixed(1)},${(keel(u) + 4).toFixed(1)}`).join(' ')} fill="none" stroke={lit(light, '#3a2816', 0.1)} strokeWidth={16} strokeLinecap="round" />
      {ribs}
      {/* A wright inside the hull, driving rivets (his legs hidden by the planking). */}
      <Person x={hx(0.42)} y={keel(0.42) - 14} h={210} pose="working" hold="hammer" light={light} warmSide="right" warm={0.1} depth={0.12} look={{ tunic: '#6a5a3a', bareArms: true, beard: 'short', hair: '#a07a4a', head: 'band', trim: '#5a3a22' }} />
      {strakes}
      {rivets}
      {/* Sternpost and stem rising past the sheer, the stem with its curl. */}
      <path d={`M${hx(0.03)} ${keel(0.03) + 2} C ${HX0 - 30} ${keel(0.03) - 80}, ${HX0 - 40} ${sheer(0) - 40}, ${HX0 - 18} ${sheer(0) - 120}`} stroke={lit(light, '#5a3e24', 0.15)} strokeWidth={20} fill="none" strokeLinecap="round" />
      <path d={`M${hx(0.97)} ${keel(0.97) + 2} C ${HX1 + 34} ${keel(0.97) - 80}, ${HX1 + 44} ${sheer(1) - 40}, ${HX1 + 30} ${sheer(1) - 150} q -6 -36 -36 -28`} stroke={lit(light, '#5a3e24', 0.15)} strokeWidth={22} fill="none" strokeLinecap="round" />
      <path d={`M${hx(0.97) + 4} ${keel(0.97) - 10} C ${HX1 + 30} ${keel(0.97) - 84}, ${HX1 + 38} ${sheer(1) - 44}, ${HX1 + 25} ${sheer(1) - 146}`} stroke={mix(oak, '#f0d8a8', 0.3)} strokeWidth={2.5} fill="none" opacity={0.5} />
      {shores}
    </g>
  );
}

/** Oak logs stacked end-on on two bearers, waiting for the splitting wedge, and sawn planks leaning on them. */
function TimberStack({ x, y, w, light }: { x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const bark = lit(light, '#4a3220', 0.2);
  const end = lit(light, '#b88a52', 0.25);
  const plank = lit(light, '#8a6a42', 0.2);
  const rows = [5, 4, 3];
  const r = w / 10;
  const out: ReactElement[] = [];
  rows.forEach((n, row) => {
    const cy = y - 16 - r - row * r * 1.72;
    const x0 = x - ((n - 1) * r * 2) / 2;
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * r * 2;
      const rr = r * (0.92 + ((i * 7 + row * 3) % 5) * 0.025);
      out.push(
        <g key={`${row}-${i}`}>
          <circle cx={cx} cy={cy} r={rr} fill={end} stroke={bark} strokeWidth={rr * 0.16} />
          <circle cx={cx + rr * 0.06} cy={cy - rr * 0.04} r={rr * 0.58} fill="none" stroke={shade(end, 0.22)} strokeWidth={1.2} opacity={0.7} />
          <circle cx={cx + rr * 0.08} cy={cy - rr * 0.05} r={rr * 0.26} fill="none" stroke={shade(end, 0.22)} strokeWidth={1.2} opacity={0.7} />
          <line x1={cx + rr * 0.1} y1={cy} x2={cx + rr * 0.7} y2={cy + rr * 0.3} stroke={shade(end, 0.4)} strokeWidth={1.2} opacity={0.6} />
        </g>,
      );
    }
  });
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx={w * 0.62} ry={12} fill="#000" opacity={0.35} />
      {[-0.3, 0.3].map((f) => (
        <rect key={f} x={x + f * w - 12} y={y - 18} width={24} height={18} fill={shade(plank, 0.4)} />
      ))}
      {/* Sawn planks leaning against the far side of the pile. */}
      {[0, 1].map((i) => (
        <line key={i} x1={x + w / 2 + 30 + i * 18} y1={y} x2={x + w / 2 - 40 + i * 20} y2={y - 200 - i * 10} stroke={i === 1 ? plank : shade(plank, 0.15)} strokeWidth={13} />
      ))}
      {out}
    </g>
  );
}

/** An iron tar pot on three stones over a small fire, steaming. */
function TarPot({ uid, x, y, light }: { uid: string; x: number; y: number; light: RoomLight }): ReactElement {
  const iron = lit(light, '#2a2826', 0.5);
  return (
    <g>
      <FireGlow uid={uid} x={x} y={y - 20} rx={170} ry={80} light={light} strength={0.7} />
      {[-40, 0, 40].map((dx) => (
        <ellipse key={dx} cx={x + dx} cy={y - 4} rx={20} ry={12} fill={lit(light, '#6a645a', 0.6)} />
      ))}
      <Flames uid={uid} x={x} y={y - 6} w={70} h={44} />
      <path d={`M${x - 52} ${y - 40} Q ${x - 56} ${y - 106} ${x} ${y - 108} Q ${x + 56} ${y - 106} ${x + 52} ${y - 40} Q ${x} ${y - 24} ${x - 52} ${y - 40} Z`} fill={iron} />
      <ellipse cx={x} cy={y - 104} rx={52} ry={10} fill="#0b0806" />
      <ellipse cx={x + 8} cy={y - 104} rx={20} ry={3} fill={light.fireTint} opacity={0.3 * light.fire} />
      <path d={`M${x - 50} ${y - 98} Q ${x} ${y - 160} ${x + 50} ${y - 98}`} stroke={iron} strokeWidth={4} fill="none" />
      {/* The tar mop. */}
      <line x1={x + 20} y1={y - 100} x2={x + 96} y2={y - 190} stroke={lit(light, '#5a3a22', 0.5)} strokeWidth={6} strokeLinecap="round" />
      <Smoke x={x} y={y - 110} h={110} w={6} light={light.outdoor} />
    </g>
  );
}

/** An adze in the hand at (x, y): the haft hanging forward (`dir` −1 to the left), the curved blade across its end. */
function Adze({ x, y, s, light, dir = 1 }: { x: number; y: number; s: number; light: RoomLight; dir?: 1 | -1 }): ReactElement {
  const haft = lit(light, '#6a4a2a', 0.3);
  const iron = lit(light, '#7a7c80', 0.4);
  return (
    <g transform={`translate(${x} ${y}) scale(${dir} 1)`}>
      <line x1={-2 * s} y1={-4 * s} x2={8 * s} y2={28 * s} stroke={haft} strokeWidth={2.4 * s} strokeLinecap="round" />
      <path d={`M${6 * s} ${26 * s} q ${7 * s} ${-1 * s} ${10 * s} ${5 * s} l ${-2.4 * s} ${1.2 * s} q ${-3 * s} ${-3.6 * s} ${-8.6 * s} ${-3.2 * s} Z`} fill={iron} stroke="#141210" strokeWidth={0.5 * s} />
    </g>
  );
}

/** The procedural Shipyard (1600 × 900). */
export function ShipyardPainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const sand = light.winter ? '#c4c8cc' : '#8a7a5a';
  const grass = light.winter ? '#d4d8dc' : '#5a6236';
  const r = rng(seed + 5);
  const chips: ReactElement[] = [];
  for (let i = 0; i < 60; i++) {
    const t = r();
    const cx = 620 + r() * 760;
    const cy = 770 + t * 120;
    chips.push(<path key={i} d={`M${cx} ${cy} q ${4 + t * 6} ${-3} ${8 + t * 10} 0`} stroke={lit(light, '#c8a470', 0.2)} strokeWidth={1.5 + t * 2} fill="none" opacity={0.7} />);
  }
  // The shipwright (facing the hull, so mirrored): feet centre, height, and where his right hand hangs.
  const sw = { x: 1300, y: 872, h: 480 };
  const k = sw.h / 100;
  const hand = { x: sw.x - (15.5 + 1) * k, y: sw.y - 45 * k };
  return (
    <RoomSvg uid={uid} light={light} sky={{ horizon: HORIZON }} testId="interior-painting-shipyard">
      <Sky uid={uid} light={light.outdoor} horizon={HORIZON} seed={seed} />
      <Fjord uid={uid} light={light} seed={seed} />
      {/* The near strand: shingle by the water, then the trodden yard of the slip. */}
      <path d={`M-100 618 C 300 600, 700 640, 1000 628 C 1250 620, 1450 632, 1700 626 L1700 1000 L-100 1000 Z`} fill={outside(light, sand, 0.15)} />
      <path d={`M-100 560 C 120 548, 380 552, 560 590 L 560 640 L -100 640 Z`} fill={outside(light, grass, 0.3)} />
      <path d={`M-100 676 C 400 660, 900 690, 1700 672 L1700 1000 L-100 1000 Z`} fill={lit(light, light.winter ? '#b8bcc0' : '#5a4a34', 0.1)} />
      {/* Boat sheds on the strand, the house's ships drawn up before them. */}
      <BoatShed x={110} y={600} w={170} light={light} />
      <BoatShed x={300} y={596} w={190} light={light} />
      <BoatShed x={470} y={604} w={130} light={light} />
      <BeachedHull x={180} y={662} L={240} light={light} colour="#a8321f" />
      <BeachedHull x={365} y={678} L={210} light={light} colour="#a8321f" facing={-1} />
      <Smoke x={300} y={520} h={80} w={5} light={light.outdoor} />

      <HullOnStocks light={light} />
      {/* A second wright at the sternpost, his mallet raised. */}
      <Person x={490} y={SLIP + 10} h={220} pose="working" hold="hammer" light={light} warmSide="right" warm={0.1} depth={0.1} look={{ tunic: '#4e5a3a', bareArms: true, beard: 'long', hair: '#5a3a20', build: 'broad' }} />

      {chips}
      <TimberStack x={730} y={890} w={230} light={light} />
      <TarPot uid={uid} x={440} y={878} light={light} />

      {/* The Shipwright, the master of the slip, with his adze. */}
      <Person x={sw.x} y={sw.y} h={sw.h} pose="standing" flip light={light} warmSide="left" warm={0.35} look={{ tunic: '#5a4a32', trousers: '#3a3428', apron: true, bareArms: true, beard: 'long', hair: '#9a9288', hairStyle: 'braid', build: 'broad', head: 'cap', hat: '#3e4a56', skin: '#c08a62' }} />
      <Adze x={hand.x} y={hand.y} s={k} light={light} dir={-1} />
    </RoomSvg>
  );
}

/** The Shipyard: its painting, the Shipwright and the ships on the strand (digit order: the Shipwright first). */
export const shipyardRoom: InteriorRoomDef = {
  id: 'shipyard',
  titleKey: 'hub.building.shipyard.name',
  assetId: 'hub.interior.shipyard',
  Painting: ShipyardPainting,
  people: [
    { id: 'shipwright', x: 1300, y: 884, w: 290, h: 520, nameKey: 'hub.interior.shipyard.shipwright.name', greetingKey: 'hub.interior.shipyard.shipwright.greeting', icon: 'gear', wide: true },
    { id: 'strand', x: 270, y: 694, w: 360, h: 150, nameKey: 'hub.interior.shipyard.strand.name', greetingKey: 'hub.interior.shipyard.strand.greeting', icon: 'ship', kind: 'place' },
  ],
};
