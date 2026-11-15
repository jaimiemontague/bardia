/**
 * The Seer's hut, small and dark: a low roof close overhead with bundles of herbs drying from the beams, walls of
 * dark planks and wattle, a low fire glowing at the back under a hanging pot, a shelf of jars and an ox skull, a
 * raven on its perch. In front stands the seer's table, lit by two tallow candles: a wooden bowl, carved rune-sticks
 * cast on a cloth, small bones, clay jars and the rune-bag.
 *
 * One person: the Seer, standing behind the table with her staff, leaning to the light. She reads the omens and
 * tends the wounded.
 */
import type { ReactElement } from 'react';
import { BONE, INK, mix, rng, shade } from '../../scenes/paint';
import { lit, type RoomLight } from '../light';
import { Beam, FireGlow, Flames, Floor, Hearth, PlankedWall, Post, RoomSvg, SmokeHaze, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

const BACK_TOP = 190;
const FLOOR = 600;
const TABLE_Y = 566;
const FIRE_X = 320;

/** Bundles of herbs hanging head-down on strings from a beam. */
function Herbs({ y, xs, light, seed }: { y: number; xs: readonly number[]; light: RoomLight; seed: number }): ReactElement {
  const r = rng(seed);
  return (
    <g>
      {xs.map((x, i) => {
        const l = 30 + r() * 50;
        const w = 16 + r() * 16;
        const c = lit(light, i % 3 === 0 ? '#6a7a3a' : i % 3 === 1 ? '#8a7a4a' : '#5a5a3a', 0.35, 0.1);
        const by = y + l;
        return (
          <g key={x}>
            <line x1={x} y1={y} x2={x} y2={by} stroke={lit(light, '#8a7a5a', 0.3)} strokeWidth={1.4} />
            <rect x={x - 5} y={by - 2} width={10} height={6} fill={lit(light, '#6a4a2a', 0.3)} />
            <path d={`M${x - 4} ${by + 2} Q ${x - w} ${by + 40} ${x - w * 0.6} ${by + 70 + r() * 20} L${x + w * 0.6} ${by + 66 + r() * 20} Q ${x + w} ${by + 40} ${x + 4} ${by + 2} Z`} fill={c} />
            {Array.from({ length: 4 }, (_, k) => (
              <line key={k} x1={x + (k - 1.5) * 3} y1={by + 6} x2={x + (k - 1.5) * w * 0.35} y2={by + 70} stroke={shade(c, 0.35)} strokeWidth={1.2} opacity={0.7} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** A candle with its flame and a small pool of light. */
function Candle({ uid, x, y, h, light }: { uid: string; x: number; y: number; h: number; light: RoomLight }): ReactElement {
  const wax = lit(light, '#e8dcb8', 0.9);
  return (
    <g>
      <FireGlow uid={uid} x={x} y={y - h - 10} rx={190} ry={150} light={light} strength={0.9} />
      <path d={`M${x - 9} ${y} L${x - 8} ${y - h} Q ${x} ${y - h - 4} ${x + 8} ${y - h} L${x + 9} ${y} Z`} fill={wax} />
      <path d={`M${x - 8} ${y - h} q 2 14 -1 22`} stroke={shade(wax, 0.15)} strokeWidth={3} fill="none" />
      <ellipse cx={x} cy={y} rx={16} ry={4} fill={shade(wax, 0.3)} />
      <line x1={x} y1={y - h} x2={x} y2={y - h - 6} stroke={INK} strokeWidth={1.4} />
      <Flames uid={uid} x={x + 1} y={y - h - 2} w={14} h={30} />
    </g>
  );
}

/** A clay jar (round belly, narrow neck, lip). */
function Jar({ x, y, w, h, colour, light, warm = 0.5 }: { x: number; y: number; w: number; h: number; colour: string; light: RoomLight; warm?: number }): ReactElement {
  const c = lit(light, colour, warm);
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w * 0.5} ry={w * 0.1} fill="#000" opacity={0.35} />
      <path d={`M${x - w * 0.18} ${y - h} L${x - w * 0.16} ${y - h * 0.8} Q ${x - w * 0.62} ${y - h * 0.6} ${x - w * 0.42} ${y - h * 0.12} Q ${x} ${y + h * 0.05} ${x + w * 0.42} ${y - h * 0.12} Q ${x + w * 0.62} ${y - h * 0.6} ${x + w * 0.16} ${y - h * 0.8} L${x + w * 0.18} ${y - h} Z`} fill={c} />
      <path d={`M${x - w * 0.16} ${y - h * 0.8} Q ${x - w * 0.62} ${y - h * 0.6} ${x - w * 0.42} ${y - h * 0.12} Q ${x - w * 0.25} ${y - h * 0.02} ${x - w * 0.1} ${y - h * 0.04} Z`} fill={shade(c, 0.35)} />
      <ellipse cx={x} cy={y - h} rx={w * 0.22} ry={w * 0.06} fill={shade(c, 0.5)} />
    </g>
  );
}

/** An ox skull with its horns, hung on the wall or laid on a shelf. */
function Skull({ x, y, s, light }: { x: number; y: number; s: number; light: RoomLight }): ReactElement {
  const bone = lit(light, BONE, 0.3, 0.1);
  const k = s / 100;
  return (
    <g>
      <path d={`M${x - 14 * k} ${y - 30 * k} Q ${x - 50 * k} ${y - 40 * k} ${x - 58 * k} ${y - 66 * k} Q ${x - 36 * k} ${y - 48 * k} ${x - 12 * k} ${y - 44 * k} Z`} fill={shade(bone, 0.15)} />
      <path d={`M${x + 14 * k} ${y - 30 * k} Q ${x + 50 * k} ${y - 40 * k} ${x + 58 * k} ${y - 66 * k} Q ${x + 36 * k} ${y - 48 * k} ${x + 12 * k} ${y - 44 * k} Z`} fill={shade(bone, 0.15)} />
      <path d={`M${x - 20 * k} ${y - 44 * k} Q ${x} ${y - 52 * k} ${x + 20 * k} ${y - 44 * k} L${x + 12 * k} ${y} Q ${x} ${y + 6 * k} ${x - 12 * k} ${y} Z`} fill={bone} />
      <ellipse cx={x - 9 * k} cy={y - 30 * k} rx={5 * k} ry={6 * k} fill={INK} />
      <ellipse cx={x + 9 * k} cy={y - 30 * k} rx={5 * k} ry={6 * k} fill={INK} />
      <path d={`M${x - 4 * k} ${y - 6 * k} l 2 4 M${x + 4 * k} ${y - 6 * k} l -2 4`} stroke={INK} strokeWidth={1.5} />
    </g>
  );
}

/** A raven on a perch, head turned toward the room. */
function Raven({ x, y, s, light }: { x: number; y: number; s: number; light: RoomLight }): ReactElement {
  const k = s / 100;
  const black = lit(light, '#1a1a22', 0.3);
  const sheen = lit(light, '#3a4a6a', 0.3);
  const p = (px: number, py: number) => `${(x + px * k).toFixed(1)} ${(y + py * k).toFixed(1)}`;
  return (
    <g>
      <path d={`M${p(-14, -6)} Q ${p(-20, -40)} ${p(4, -52)} Q ${p(22, -56)} ${p(20, -40)} Q ${p(26, -20)} ${p(14, -4)} L${p(30, 28)} L${p(16, 26)} L${p(6, 0)} Z`} fill={black} />
      <path d={`M${p(-6, -30)} Q ${p(8, -36)} ${p(14, -14)}`} stroke={sheen} strokeWidth={3 * k} fill="none" opacity={0.7} />
      <path d={`M${p(16, -50)} L${p(34, -46)} L${p(18, -42)} Z`} fill={lit(light, '#2a2a2a', 0.4)} />
      <circle cx={x + 12 * k} cy={y - 48 * k} r={2.2 * k} fill={mix(light.fireTint, '#fff', 0.4)} />
      <path d={`M${p(-4, -4)} L${p(-6, 6)} M${p(4, -4)} L${p(6, 6)}`} stroke={lit(light, '#2a2a2a', 0.4)} strokeWidth={2 * k} />
    </g>
  );
}

/** The seer's table: a heavy plank top, a cloth, the things of her craft, two candles. */
function SeerTable({ uid, x, y, w, light }: { uid: string; x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const top = lit(light, '#5a3e26', 0.75);
  const dark = shade(top, 0.5);
  const bone = lit(light, BONE, 0.8);
  const stick = lit(light, '#c8a870', 0.8);
  const left = x - w / 2;
  const right = x + w / 2;
  const sticks = [-0.2, -0.12, -0.05, 0.03, 0.1];
  return (
    <g>
      {/* Legs and the front of the top. */}
      <ellipse cx={x} cy={y + 262} rx={w * 0.56} ry={22} fill="#000" opacity={0.45} />
      <rect x={left + 26} y={y + 30} width={30} height={232} fill={dark} />
      <rect x={right - 56} y={y + 30} width={30} height={232} fill={dark} />
      <rect x={left + 60} y={y + 200} width={w - 120} height={14} fill={shade(dark, 0.2)} />
      <polygon points={`${left + 20},${y - 40} ${right - 20},${y - 40} ${right},${y} ${left},${y}`} fill={top} />
      <rect x={left} y={y} width={w} height={30} fill={shade(top, 0.3)} />
      <line x1={left} y1={y} x2={right} y2={y} stroke={lit(light, '#a8743e', 0.9)} strokeWidth={2} opacity={0.7} />
      {/* A dark cloth with a border, the rune-sticks cast on it. */}
      <polygon points={`${x - 170},${y - 34} ${x + 60},${y - 34} ${x + 74},${y - 6} ${x - 180},${y - 6}`} fill={lit(light, '#3a2a3e', 0.6)} />
      <polyline points={`${x - 170},${y - 30} ${x + 62},${y - 30} ${x + 72},${y - 9} ${x - 178},${y - 9} ${x - 170},${y - 30}`} fill="none" stroke={lit(light, '#c9a04a', 0.6)} strokeWidth={1.5} opacity={0.6} />
      {sticks.map((f, i) => {
        const sx = x - 60 + f * 300;
        const a = -14 + i * 9;
        return (
          <g key={f} transform={`rotate(${a} ${sx} ${y - 20})`}>
            <rect x={sx - 34} y={y - 23} width={68} height={6} rx={2} fill={stick} />
            {[-20, -6, 8, 20].map((m) => (
              <path key={m} d={`M${sx + m} ${y - 23} l 3 6 M${sx + m + 3} ${y - 23} l -3 6`} stroke={shade(stick, 0.55)} strokeWidth={1} />
            ))}
          </g>
        );
      })}
      {/* Small bones and knuckle-bones. */}
      {[[-240, -16], [-218, -10], [130, -14], [150, -24], [168, -12]].map(([dx, dy], i) => (
        <g key={i} transform={`rotate(${i * 37} ${x + (dx ?? 0)} ${y + (dy ?? 0)})`}>
          <rect x={x + (dx ?? 0) - 12} y={y + (dy ?? 0) - 2.5} width={24} height={5} rx={2.5} fill={bone} />
          <circle cx={x + (dx ?? 0) - 12} cy={y + (dy ?? 0)} r={4} fill={bone} />
          <circle cx={x + (dx ?? 0) + 12} cy={y + (dy ?? 0)} r={4} fill={bone} />
        </g>
      ))}
      {/* The wooden bowl with something dark in it. */}
      <path d={`M${x + 80} ${y - 40} Q ${x + 130} ${y + 4} ${x + 180} ${y - 40} Z`} fill={lit(light, '#6a4a2a', 0.8)} />
      <ellipse cx={x + 130} cy={y - 40} rx={50} ry={10} fill={lit(light, '#4a1a14', 0.7)} />
      <ellipse cx={x + 120} cy={y - 42} rx={18} ry={3} fill={light.fireTint} opacity={0.4} />
      {/* The rune-bag. */}
      <path d={`M${x - 280} ${y - 10} Q ${x - 300} ${y - 50} ${x - 268} ${y - 70} L${x - 252} ${y - 72} Q ${x - 222} ${y - 52} ${x - 236} ${y - 10} Z`} fill={lit(light, '#6a4a30', 0.6)} />
      <path d={`M${x - 270} ${y - 66} q 10 6 20 -2`} stroke={lit(light, '#c9a04a', 0.6)} strokeWidth={2} fill="none" />
      {/* Jars at the right end, the candles. */}
      <Jar x={right - 90} y={y - 14} w={70} h={90} colour="#8a5a3a" light={light} warm={0.7} />
      <Jar x={right - 40} y={y - 8} w={46} h={60} colour="#5a5a4a" light={light} warm={0.7} />
      <Candle uid={uid} x={x - 210} y={y - 22} h={70} light={light} />
      <Candle uid={uid} x={x + 220} y={y - 30} h={50} light={light} />
    </g>
  );
}

/** The procedural Seer's hut (1600 × 900). */
export function SeerPainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const wall = '#3a2a1c';
  return (
    <RoomSvg uid={uid} light={light} testId="interior-painting-seer">
      {/* Everything far from a flame is dark in here, whatever the hour. */}
      <rect x={-100} y={-100} width={1800} height={1100} fill={lit(light, '#140e0a', 0.1, 0.5)} />
      {/* The low roof: two slopes meeting just above the view, rafters close together. */}
      <polygon points={`-100,${BACK_TOP + 60} 800,-60 1700,${BACK_TOP + 60} 1700,-100 -100,-100`} fill={lit(light, '#20160e', 0.1, 0.5)} />
      {Array.from({ length: 9 }, (_, i) => {
        const f = i / 8;
        return <Beam key={`raf${i}`} a={[-100 + f * 900, BACK_TOP + 60 - f * 250]} b={[-100 + f * 900, -100]} t={10} light={light} warm={0.1} depth={0.45} />;
      })}

      {/* The back wall: planks with wattle patches, the side walls closing in. */}
      <PlankedWall corners={[[260, BACK_TOP], [1340, BACK_TOP], [1340, FLOOR], [260, FLOOR]]} colour={wall} light={light} count={18} warm={0.35} depth={0.3} />
      <PlankedWall corners={[[-100, 40], [260, BACK_TOP], [260, FLOOR], [-100, 900]]} colour="#33251a" light={light} count={6} warm={0.2} depth={0.35} />
      <PlankedWall corners={[[1340, BACK_TOP], [1700, 40], [1700, 900], [1340, FLOOR]]} colour="#33251a" light={light} count={6} warm={0.2} depth={0.35} />
      {/* A patch of wattle where the planks have gone. */}
      <g opacity={0.8}>
        <rect x={290} y={230} width={130} height={190} fill={lit(light, '#4a3a28', 0.25, 0.3)} />
        {Array.from({ length: 7 }, (_, i) => (
          <path key={i} d={`M290 ${240 + i * 26} q 32 -10 65 0 q 32 10 65 0`} stroke={lit(light, '#6a5034', 0.25, 0.3)} strokeWidth={6} fill="none" />
        ))}
      </g>

      {/* The shelf on the back wall: jars, the ox skull. */}
      <rect x={930} y={330} width={330} height={14} fill={lit(light, '#4a3220', 0.4, 0.2)} />
      <Jar x={980} y={330} w={54} h={70} colour="#7a5236" light={light} warm={0.4} />
      <Jar x={1040} y={330} w={40} h={52} colour="#5a5a48" light={light} warm={0.4} />
      <Skull x={1130} y={330} s={90} light={light} />
      <Jar x={1215} y={330} w={44} h={62} colour="#8a6a44" light={light} warm={0.4} />

      {/* The floor, the low fire at the back with its pot. */}
      <Floor y={FLOOR} light={light} kind="earth" seed={seed} warmAt={[400, 660]} />
      {/* Inside the hut it is dark whatever the hour: only the fire and the candles light it. */}
      <rect x={-100} y={-100} width={1800} height={1100} fill="#080504" opacity={0.25 + 0.25 * light.daylight} />
      <line x1={FIRE_X} y1={BACK_TOP + 10} x2={FIRE_X} y2={520} stroke={lit(light, '#3a3a3a', 0.5)} strokeWidth={3} strokeDasharray="6 3" />
      <path d={`M${FIRE_X - 44} 526 L${FIRE_X + 44} 526 L${FIRE_X + 36} 560 Q ${FIRE_X} 574 ${FIRE_X - 36} 560 Z`} fill={lit(light, '#3a3632', 0.8)} />
      <ellipse cx={FIRE_X} cy={526} rx={44} ry={7} fill={lit(light, '#1a1612', 0.6)} />
      <Hearth uid={uid} x={FIRE_X} y={640} rx={100} ry={22} light={light} flame={0.75} />

      {/* Spare staffs and a broom leaning in the corner, a hide hung up to dry. */}
      <line x1={1300} y1={250} x2={1350} y2={700} stroke={lit(light, '#5a3a22', 0.3, 0.2)} strokeWidth={8} strokeLinecap="round" />
      <line x1={1330} y1={290} x2={1360} y2={700} stroke={lit(light, '#4a3220', 0.3, 0.2)} strokeWidth={6} strokeLinecap="round" />
      <path d={`M1380 230 Q 1460 220 1500 250 L1490 420 Q 1440 450 1390 420 Z`} fill={lit(light, '#6a5038', 0.25, 0.3)} />

      {/* The raven on its perch at the right. */}
      <line x1={1230} y1={520} x2={1240} y2={880} stroke={lit(light, '#4a3220', 0.4, 0.1)} strokeWidth={10} />
      <rect x={1180} y={512} width={110} height={12} rx={5} fill={lit(light, '#4a3220', 0.45, 0.1)} />
      <Raven x={1230} y={512} s={120} light={light} />

      <Post x={120} top={-40} bottom={900} w={70} light={light} warm={0.3} fireSide="right" depth={0.2} />
      <Post x={1480} top={-40} bottom={900} w={70} light={light} warm={0.3} fireSide="left" depth={0.2} />
      <Beam a={[-100, 150]} b={[1700, 150]} t={34} light={light} warm={0.25} depth={0.2} />
      <Herbs y={166} xs={[320, 380, 470, 560, 1020, 1090, 1170, 1260]} light={light} seed={seed + 3} />

      <SmokeHaze uid={uid} y={300} opacity={0.85} />

      {/* The Seer behind her table. */}
      <Person x={800} y={TABLE_Y + 70} h={470} hold="staff" light={light} warmSide="left" warm={0.85} look={{ tunic: '#3e3644', cloak: '#2a2632', head: 'hood', hair: '#c8c4bc', hairStyle: 'long', beard: 'none', build: 'slim', trim: '#8a6a3a', skin: '#c49a7e', trousers: '#2e2a30' }} />
      {/* The table stands in front of her. */}
      <SeerTable uid={uid} x={790} y={TABLE_Y} w={700} light={light} />
    </RoomSvg>
  );
}

/** The Seer's hut: its painting and its one person. */
export const seerRoom: InteriorRoomDef = {
  id: 'seer',
  titleKey: 'hub.building.seer.name',
  assetId: 'hub.interior.seer',
  Painting: SeerPainting,
  people: [
    {
      id: 'seer',
      x: 810,
      y: 604,
      w: 260,
      h: 420,
      nameKey: 'faith.interior.seer.seer.name',
      greetingKey: 'faith.interior.seer.seer.greeting',
      icon: 'eye',
    },
  ],
};
