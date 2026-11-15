/**
 * The Market: a merchant's storehouse open on one side to the harbour. Under the roof timbers hang furs and
 * strings of dried fish; shelves on the back wall carry jars and bolts of cloth; barrels and sacks are stacked on
 * the boards; a pair of scales with its weights stands on the trestle counter, a torch burns on the corner post.
 * Out through the open side a trading ship lies at the jetty with her sail furled, the water and the hills beyond.
 * The merchant stands among his goods beside an open chest of silver and amber.
 *
 * People: the Merchant (the whole market: the quick deals, the goods and the deal, trade routes).
 */
import type { ReactElement } from 'react';
import { Ridge, Sky } from '../../scenes/layers';
import { SideShip, shipPaint } from '../../scenes/ships';
import { mix, rng, shade } from '../../scenes/paint';
import { lit, outside, type RoomLight } from '../light';
import { Barrel, Beam, Chest, FireGlow, Flames, Floor, Overhang, PlankedWall, Post, RoomSvg, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

const HORIZON = 470;
/** The floor line at the back wall. */
const FLOOR = 640;
/** The open side: the back wall ends here and the harbour shows beyond. */
const OPEN_X = 1080;

/** The harbour seen through the open side: sky, hills, water, the jetty and a knarr moored at it. */
function Harbour({ uid, light, seed }: { uid: string; light: RoomLight; seed: number }): ReactElement {
  const o = light.outdoor;
  const plank = outside(light, '#6a5236', 0.15);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-water`} x1="0" y1={HORIZON} x2="0" y2={FLOOR + 20} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={o.sea[0]} />
          <stop offset="0.6" stopColor={o.sea[1]} />
          <stop offset="1" stopColor={shade(o.sea[1], 0.3)} />
        </linearGradient>
      </defs>
      <Sky uid={uid} light={o} horizon={HORIZON} seed={seed} />
      <Ridge y={HORIZON} height={150} colour={outside(light, o.far, 0.8)} seed={seed + 1} roughness={0.9} snowCaps step={80} />
      <Ridge y={HORIZON + 20} height={70} colour={outside(light, mix(o.mid, '#3a4a3a', 0.2), 0.5)} seed={seed + 2} roughness={0.6} snowCaps={light.winter} step={60} />
      <rect x={OPEN_X - 40} y={HORIZON + 10} width={700} height={FLOOR - HORIZON + 30} fill={`url(#${uid}-water)`} />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={OPEN_X + ((i * 97) % 420)} y1={HORIZON + 30 + i * 16} x2={OPEN_X + ((i * 97) % 420) + 40 + i * 4} y2={HORIZON + 30 + i * 16} stroke={mix(o.sea[0], '#ffffff', 0.3)} strokeWidth={1 + i * 0.2} opacity={0.3} />
      ))}
      <SideShip x={1380} y={560} L={330} type="knarr" paint={shipPaint('#2f4f7a')} light={o} distance={0.15} facing={-1} furled />
      {/* The jetty: a deck on piles running out from the storehouse's side. */}
      <polygon points={`${OPEN_X - 20},${FLOOR - 10} ${OPEN_X + 560},${FLOOR - 66} ${OPEN_X + 560},${FLOOR - 54} ${OPEN_X - 20},${FLOOR + 14}`} fill={plank} />
      {Array.from({ length: 7 }, (_, i) => {
        const x = OPEN_X + 30 + i * 80;
        const y = FLOOR - 4 - i * 8;
        return <rect key={i} x={x} y={y} width={9} height={36 - i * 2} fill={shade(plank, 0.4)} />;
      })}
      {/* A mooring post and a coil of rope at the jetty's end. */}
      <rect x={OPEN_X + 470} y={FLOOR - 104} width={12} height={44} fill={shade(plank, 0.3)} />
      <line x1={OPEN_X + 476} y1={FLOOR - 96} x2={1310} y2={FLOOR - 120} stroke={outside(light, '#8a7a5a', 0.15)} strokeWidth={2} />
    </g>
  );
}

/** A long shelf on the back wall with jars, pots and bolts of cloth seen end-on. */
function Shelf({ x0, x1, y, light, seed }: { x0: number; x1: number; y: number; light: RoomLight; seed: number }): ReactElement {
  const r = rng(seed);
  const board = lit(light, '#5a3e24', 0.35);
  const items: ReactElement[] = [];
  let x = x0 + 16;
  let i = 0;
  while (x < x1 - 40) {
    const kind = r();
    if (kind < 0.45) {
      // A jar with a narrow neck.
      const w = 34 + r() * 18;
      const h = 54 + r() * 28;
      const c = lit(light, ['#9a5a34', '#7a6a4a', '#5a5040', '#a07444'][i % 4] ?? '#9a5a34', 0.4);
      items.push(
        <g key={i}>
          <path d={`M${x} ${y} Q ${x - 4} ${y - h * 0.55} ${x + w * 0.3} ${y - h * 0.82} L${x + w * 0.3} ${y - h} L${x + w * 0.7} ${y - h} L${x + w * 0.7} ${y - h * 0.82} Q ${x + w + 4} ${y - h * 0.55} ${x + w} ${y} Z`} fill={c} />
          <path d={`M${x + w * 0.62} ${y - 4} Q ${x + w + 2} ${y - h * 0.5} ${x + w * 0.66} ${y - h * 0.8}`} stroke={shade(c, 0.35)} strokeWidth={w * 0.18} fill="none" opacity={0.6} />
        </g>,
      );
      x += w + 10;
    } else {
      // Bolts of cloth, stacked end-on.
      const s = 26 + r() * 6;
      const cols = ['#7a2a1e', '#2f4f6a', '#c9a04a', '#4f6a3a', '#d8c8a0'];
      for (let k = 0; k < 3; k++) {
        const cx = x + s / 2 + (k === 2 ? s / 2 : k * s);
        const cy = y - s / 2 - (k === 2 ? s * 0.86 : 0);
        const c = lit(light, cols[(i + k) % cols.length] ?? '#7a2a1e', 0.4);
        items.push(<circle key={`${i}-${k}`} cx={cx} cy={cy} r={s / 2} fill={c} stroke={shade(c, 0.4)} strokeWidth={1.5} />);
        items.push(<circle key={`${i}-${k}c`} cx={cx} cy={cy} r={s / 7} fill={shade(c, 0.5)} />);
      }
      x += s * 2 + 14;
    }
    i++;
  }
  return (
    <g>
      {items}
      <rect x={x0} y={y} width={x1 - x0} height={12} fill={board} />
      <rect x={x0} y={y + 10} width={x1 - x0} height={5} fill={shade(board, 0.5)} />
      {[x0 + 20, (x0 + x1) / 2, x1 - 30].map((bx) => (
        <path key={bx} d={`M${bx} ${y + 14} l 0 26 l 18 -26 Z`} fill={shade(board, 0.3)} />
      ))}
    </g>
  );
}

/** A fur pelt hanging by its head from the beam. */
function Pelt({ x, y, h, colour, light }: { x: number; y: number; h: number; colour: string; light: RoomLight }): ReactElement {
  const c = lit(light, colour, 0.35);
  const w = h * 0.42;
  return (
    <g>
      <line x1={x} y1={y - 16} x2={x} y2={y} stroke={lit(light, '#8a7a5a', 0.3)} strokeWidth={2} />
      <path d={`M${x - w * 0.2} ${y} Q ${x - w * 0.6} ${y + h * 0.1} ${x - w * 0.5} ${y + h * 0.3} L${x - w * 0.62} ${y + h * 0.42} Q ${x - w * 0.5} ${y + h * 0.8} ${x - w * 0.2} ${y + h} L${x} ${y + h * 0.92} L${x + w * 0.2} ${y + h} Q ${x + w * 0.5} ${y + h * 0.8} ${x + w * 0.62} ${y + h * 0.42} L${x + w * 0.5} ${y + h * 0.3} Q ${x + w * 0.6} ${y + h * 0.1} ${x + w * 0.2} ${y} Z`} fill={c} />
      <path d={`M${x} ${y + h * 0.08} L${x} ${y + h * 0.88}`} stroke={shade(c, 0.35)} strokeWidth={w * 0.12} opacity={0.5} />
      <path d={`M${x - w * 0.35} ${y + h * 0.5} q ${w * 0.1} ${h * 0.05} 0 ${h * 0.1} M${x + w * 0.3} ${y + h * 0.36} q ${-w * 0.08} ${h * 0.05} 0 ${h * 0.1}`} stroke={mix(c, '#f0e0c0', 0.25)} strokeWidth={1.4} fill="none" opacity={0.6} />
    </g>
  );
}

/** A string of dried fish hanging from the beam. */
function FishString({ x, y, n, light }: { x: number; y: number; n: number; light: RoomLight }): ReactElement {
  const c = lit(light, '#b8a07a', 0.35);
  return (
    <g>
      <line x1={x} y1={y - 16} x2={x} y2={y + n * 34} stroke={lit(light, '#6a5a3a', 0.3)} strokeWidth={2} />
      {Array.from({ length: n }, (_, i) => (
        <g key={i} transform={`rotate(${i % 2 === 0 ? -14 : 14} ${x} ${y + i * 34})`}>
          <path d={`M${x} ${y + i * 34} q 10 6 8 26 l 6 8 l -14 -2 l -14 2 l 6 -8 q -2 -20 8 -26 Z`} fill={i % 2 === 0 ? c : shade(c, 0.15)} />
        </g>
      ))}
    </g>
  );
}

/** A sack of grain or salt, tied at the neck. */
function Sack({ x, y, w, h, light }: { x: number; y: number; w: number; h: number; light: RoomLight }): ReactElement {
  const c = lit(light, '#a08a62', 0.35);
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w * 0.55} ry={w * 0.12} fill="#000" opacity={0.3} />
      <path d={`M${x - w * 0.5} ${y} Q ${x - w * 0.6} ${y - h * 0.6} ${x - w * 0.2} ${y - h * 0.9} L${x - w * 0.14} ${y - h} L${x + w * 0.14} ${y - h} L${x + w * 0.2} ${y - h * 0.9} Q ${x + w * 0.6} ${y - h * 0.6} ${x + w * 0.5} ${y} Z`} fill={c} />
      <path d={`M${x + w * 0.1} ${y} Q ${x + w * 0.55} ${y - h * 0.5} ${x + w * 0.18} ${y - h * 0.88}`} stroke={shade(c, 0.35)} strokeWidth={w * 0.16} fill="none" opacity={0.5} />
      <line x1={x - w * 0.22} y1={y - h * 0.88} x2={x + w * 0.22} y2={y - h * 0.88} stroke={lit(light, '#5a4028', 0.3)} strokeWidth={3} />
    </g>
  );
}

/** Bales of fur and wool, corded, stacked two and one. */
function Bales({ x, y, light }: { x: number; y: number; light: RoomLight }): ReactElement {
  const bales = [
    { dx: -70, dy: 0, w: 150, h: 92, c: '#7a6a52' },
    { dx: 80, dy: 0, w: 140, h: 88, c: '#5a4632' },
    { dx: 0, dy: -86, w: 150, h: 86, c: '#9a8a6a' },
  ];
  return (
    <g>
      <ellipse cx={x} cy={y + 4} rx={170} ry={18} fill="#000" opacity={0.3} />
      {bales.map(({ dx, dy, w, h, c }) => {
        const fill = lit(light, c, 0.3);
        const bx = x + dx - w / 2;
        const by = y + dy - h;
        return (
          <g key={`${dx},${dy}`}>
            <rect x={bx} y={by} width={w} height={h} rx={18} fill={fill} />
            <rect x={bx} y={by} width={w} height={h * 0.3} rx={14} fill={mix(fill, '#f0e0c0', 0.12)} />
            {[0.3, 0.7].map((f) => (
              <line key={f} x1={bx + w * f} y1={by + 2} x2={bx + w * f} y2={by + h - 2} stroke={lit(light, '#3a2a1a', 0.3)} strokeWidth={4} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** The trestle counter with the merchant's scales, a stack of weights, a few bars of iron and a bolt of cloth. */
function Counter({ x, y, w, light }: { x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const top = lit(light, '#6a4a2c', 0.45);
  const brass = lit(light, '#c9a04a', 0.6);
  const iron = lit(light, '#5a5a5c', 0.4);
  const h = 120;
  const sx = x - w * 0.18;
  const beamY = y - 118;
  return (
    <g>
      <ellipse cx={x} cy={y + h} rx={w * 0.55} ry={14} fill="#000" opacity={0.3} />
      {[-0.4, 0.4].map((f) => (
        <path key={f} d={`M${x + f * w - 28} ${y + h} L${x + f * w} ${y} L${x + f * w + 28} ${y + h}`} stroke={shade(top, 0.4)} strokeWidth={10} fill="none" />
      ))}
      <rect x={x - w / 2} y={y - 14} width={w} height={18} fill={top} />
      <rect x={x - w / 2} y={y + 4} width={w} height={7} fill={shade(top, 0.5)} />
      {/* The scales: a post, a beam, two pans on cords. */}
      <rect x={sx - 4} y={beamY} width={8} height={104} fill={brass} />
      <rect x={sx - 18} y={y - 20} width={36} height={8} rx={2} fill={shade(brass, 0.3)} />
      <g transform={`rotate(-5 ${sx} ${beamY})`}>
        <rect x={sx - 70} y={beamY - 3} width={140} height={6} rx={3} fill={brass} />
        {[-1, 1].map((s) => (
          <g key={s}>
            <path d={`M${sx + s * 66} ${beamY} L${sx + s * 66 - 18} ${beamY + 60} M${sx + s * 66} ${beamY} L${sx + s * 66 + 18} ${beamY + 60}`} stroke={lit(light, '#a08a62', 0.5)} strokeWidth={1.3} />
            <path d={`M${sx + s * 66 - 24} ${beamY + 60} Q ${sx + s * 66} ${beamY + 76} ${sx + s * 66 + 24} ${beamY + 60} Z`} fill={brass} />
          </g>
        ))}
        {/* A few hack-silver bits in one pan. */}
        <ellipse cx={sx - 70} cy={beamY + 60} rx={10} ry={3} fill={lit(light, '#d8dcd8', 0.6)} />
      </g>
      {/* Weights, largest first. */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={x + w * 0.02 + i * 26} y={y - 14 - (22 - i * 4)} width={22 - i * 4} height={22 - i * 4} rx={3} fill={lit(light, '#7a6a5a', 0.5)} stroke={shade(brass, 0.5)} strokeWidth={1} />
      ))}
      {/* Iron bars and a bolt of cloth. */}
      {[0, 1].map((i) => (
        <rect key={`b${i}`} x={x + w * 0.24} y={y - 26 - i * 9} width={70} height={9} rx={2} fill={iron} />
      ))}
      <rect x={x + w * 0.24 + 80} y={y - 40} width={60} height={26} rx={10} fill={lit(light, '#2f4f6a', 0.45)} />
    </g>
  );
}

/** A torch in an iron bracket on a post, with its pool of light. */
function Torch({ uid, x, y, light }: { uid: string; x: number; y: number; light: RoomLight }): ReactElement {
  return (
    <g>
      <FireGlow uid={uid} x={x} y={y - 10} rx={260} ry={220} light={light} strength={0.9} />
      <path d={`M${x - 22} ${y + 50} L${x - 4} ${y + 30} L${x} ${y + 60}`} stroke={lit(light, '#3a3a3a', 0.6)} strokeWidth={5} fill="none" />
      <line x1={x} y1={y} x2={x + 6} y2={y + 70} stroke={lit(light, '#3a2414', 0.7)} strokeWidth={9} strokeLinecap="round" />
      <Flames uid={uid} x={x} y={y + 6} w={30} h={54} />
    </g>
  );
}

/** The procedural Market (1600 × 900). */
export function MarketPainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const wood = '#4a3322';
  return (
    <RoomSvg uid={uid} light={light} sky={{ horizon: HORIZON }} testId="interior-painting-market">
      <Harbour uid={uid} light={light} seed={seed} />
      {/* The back wall of the storehouse, and its open side to the harbour. */}
      <PlankedWall corners={[[-100, 120], [OPEN_X, 120], [OPEN_X, FLOOR], [-100, FLOOR]]} colour={wood} light={light} count={18} warm={0.45} />
      <Shelf x0={70} x1={720} y={330} light={light} seed={seed + 1} />
      <Shelf x0={40} x1={760} y={480} light={light} seed={seed + 2} />
      <Floor y={FLOOR} light={light} kind="boards" seed={seed + 3} warmAt={[700, 760]} />
      {/* The boards end at the jetty; a sill along the open side. */}
      <polygon points={`${OPEN_X},${FLOOR} 1700,${FLOOR - 4} 1700,${FLOOR + 22} ${OPEN_X},${FLOOR + 18}`} fill={lit(light, '#3a2a1a', 0.2)} />

      {/* Barrels and sacks along the wall. */}
      <Barrel x={190} y={672} w={96} h={118} light={light} warm={0.25} />
      <Barrel x={120} y={720} w={120} h={150} light={light} warm={0.3} />
      <Barrel x={250} y={712} w={110} h={138} light={light} warm={0.35} />
      <Sack x={360} y={720} w={90} h={110} light={light} />
      <Sack x={940} y={700} w={80} h={96} light={light} />
      <Barrel x={1010} y={706} w={90} h={110} light={light} warm={0.4} />

      <Counter x={830} y={640} w={380} light={light} />

      {/* The roof and its timbers, the goods hanging from the front beam. */}
      <Overhang y={150} light={light} seed={seed} />
      <Beam a={[-100, 240]} b={[OPEN_X, 240]} t={22} light={light} warm={0.4} />
      <Pelt x={140} y={252} h={150} colour="#6a4a2e" light={light} />
      <Pelt x={230} y={252} h={130} colour="#9a8a72" light={light} />
      <Pelt x={320} y={252} h={160} colour="#3a2a1e" light={light} />
      <FishString x={820} y={256} n={5} light={light} />
      <FishString x={880} y={256} n={4} light={light} />
      <Pelt x={980} y={252} h={140} colour="#a07448" light={light} />
      <Post x={70} top={110} bottom={900} w={60} light={light} warm={0.4} fireSide="right" carved={false} />
      <Post x={OPEN_X} top={110} bottom={FLOOR + 30} w={52} light={light} warm={0.5} fireSide="left" carved={false} />
      <Post x={1540} top={110} bottom={900} w={64} light={light} warm={0.2} fireSide="left" carved={false} />
      <Torch uid={uid} x={OPEN_X - 40} y={330} light={light} />

      {/* Goods landed from the ship by the open side: bales of furs and wool, a coil of rope, a pair of sacks. */}
      <Bales x={1290} y={830} light={light} />
      <Sack x={1440} y={860} w={96} h={118} light={light} />
      <Sack x={1505} y={846} w={80} h={96} light={light} />
      <ellipse cx={1170} cy={862} rx={62} ry={20} fill="none" stroke={lit(light, '#9a8a62', 0.3)} strokeWidth={9} />
      <ellipse cx={1170} cy={858} rx={40} ry={12} fill="none" stroke={lit(light, '#8a7a52', 0.3)} strokeWidth={8} />

      {/* The merchant among his goods, his open chest beside him. */}
      <Person x={560} y={850} h={470} pose="standing" hold="keys" light={light} warmSide="right" warm={0.6} look={{ tunic: '#8a5a2a', trim: '#c9a04a', cloak: '#2f4a44', fur: true, beard: 'short', hair: '#7a4a24', build: 'stout', head: 'band', trousers: '#4a3a2e', skin: '#c8946a' }} />
      <Chest x={820} y={872} w={200} h={110} light={light} warm={0.6} open />
      {/* Amber beads and a silver arm-ring on the chest's edge. */}
      {Array.from({ length: 7 }, (_, i) => (
        <circle key={i} cx={760 + i * 13} cy={770 - Math.sin(i * 0.5) * 4} r={5} fill={lit(light, '#d88a2a', 0.7)} stroke={shade('#d88a2a', 0.4)} strokeWidth={1} />
      ))}
      <ellipse cx={880} cy={766} rx={22} ry={8} fill="none" stroke={lit(light, '#d8dcd8', 0.7)} strokeWidth={4} />
    </RoomSvg>
  );
}

/** The Market: its painting and its one person. */
export const marketRoom: InteriorRoomDef = {
  id: 'market',
  titleKey: 'hub.building.market.name',
  assetId: 'hub.interior.market',
  Painting: MarketPainting,
  people: [{ id: 'merchant', x: 565, y: 870, w: 300, h: 520, nameKey: 'hub.interior.market.merchant.name', greetingKey: 'hub.interior.market.merchant.greeting', icon: 'silver', wide: true }],
};
