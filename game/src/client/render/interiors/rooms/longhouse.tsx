/**
 * The Longhouse, wholly indoors: the house where the ruler's own household eats and sleeps. We stand on the
 * floor beside the long hearth and look across the hall at the long wall: the sleeping benches run along it with
 * furs and a sleeper or two, the household sit and talk on them, a long woven band hangs above, round shields and
 * a stag's antlers on the planks. A warp-weighted loom leans against the wall on the left with a woman at it, a
 * soapstone pot hangs over the fire, a hound sleeps by the hearth. Daylight falls through the smoke-hole by day.
 *
 * One person: the House-elder on his carved chair at the end of the hearth, beside the empty seat kept for the
 * ruler, the hound at his feet. He knows every man and woman of the hird: the offices are his to explain.
 */
import type { ReactElement } from 'react';
import { BONE, INK, mix, rng, shade } from '../../scenes/paint';
import { lit, type RoomLight } from '../light';
import { Beam, Flames, FireGlow, Floor, Hanging, Hearth, PlankedWall, Post, RoomSvg, Shield, SmokeHaze, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

const WALL_TOP = 150;
const BENCH_TOP = 528;
const BENCH_FRONT = 574;
const FLOOR = 630;

/** A carved chair seen from the front: a tall back with an arched rail, knob-headed posts, a seat; a fur on it. */
function CarvedChair({ x, y, w, h, light, warm = 0.5, fur = true }: { x: number; y: number; w: number; h: number; light: RoomLight; warm?: number; fur?: boolean }): ReactElement {
  const wood = lit(light, '#5a3a20', warm);
  const dark = shade(wood, 0.45);
  const carve = lit(light, '#a8743e', warm + 0.2);
  const post = (px: number) => (
    <g>
      <rect x={px - w * 0.06} y={y - h} width={w * 0.12} height={h} fill={wood} />
      <rect x={px - w * 0.06} y={y - h} width={w * 0.04} height={h} fill={dark} opacity={0.7} />
      <ellipse cx={px} cy={y - h - w * 0.05} rx={w * 0.09} ry={w * 0.08} fill={wood} stroke={carve} strokeWidth={2} />
      {[0.2, 0.36].map((f) => (
        <path key={f} d={`M${px - w * 0.05} ${y - h * (1 - f)} q ${w * 0.05} ${-h * 0.05} ${w * 0.1} 0`} stroke={carve} strokeWidth={2} fill="none" opacity={0.75} />
      ))}
    </g>
  );
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx={w * 0.62} ry={w * 0.08} fill="#000" opacity={0.35} />
      {/* The back: an arched board with an interlace carved on it. */}
      <path d={`M${x - w * 0.42} ${y - h * 0.4} L${x - w * 0.42} ${y - h * 0.88} Q ${x} ${y - h * 1.04} ${x + w * 0.42} ${y - h * 0.88} L${x + w * 0.42} ${y - h * 0.4} Z`} fill={shade(wood, 0.12)} />
      <path d={`M${x - w * 0.3} ${y - h * 0.82} C ${x - w * 0.1} ${y - h * 0.98}, ${x + w * 0.1} ${y - h * 0.62}, ${x + w * 0.3} ${y - h * 0.8} M${x - w * 0.3} ${y - h * 0.62} C ${x - w * 0.1} ${y - h * 0.82}, ${x + w * 0.1} ${y - h * 0.46}, ${x + w * 0.3} ${y - h * 0.64}`} stroke={carve} strokeWidth={3} fill="none" opacity={0.7} />
      {/* Seat and legs. */}
      <rect x={x - w * 0.48} y={y - h * 0.42} width={w * 0.96} height={h * 0.07} fill={wood} />
      <rect x={x - w * 0.44} y={y - h * 0.35} width={w * 0.88} height={h * 0.12} fill={dark} />
      <rect x={x - w * 0.4} y={y - h * 0.23} width={w * 0.08} height={h * 0.23} fill={wood} />
      <rect x={x + w * 0.32} y={y - h * 0.23} width={w * 0.08} height={h * 0.23} fill={wood} />
      {fur && <path d={`M${x - w * 0.36} ${y - h * 0.44} Q ${x - w * 0.18} ${y - h * 0.52} ${x} ${y - h * 0.46} Q ${x + w * 0.2} ${y - h * 0.52} ${x + w * 0.38} ${y - h * 0.44} L${x + w * 0.42} ${y - h * 0.3} Q ${x} ${y - h * 0.26} ${x - w * 0.4} ${y - h * 0.3} Z`} fill={lit(light, '#8a6a4a', warm)} />}
      {post(x - w * 0.5)}
      {post(x + w * 0.5)}
    </g>
  );
}

/** A long hound lying asleep, head on its paws, facing left. */
function Hound({ x, y, s, light, warm = 0.6, coat = '#7a6650' }: { x: number; y: number; s: number; light: RoomLight; warm?: number; coat?: string }): ReactElement {
  const fur = lit(light, coat, warm);
  const dark = shade(fur, 0.35);
  const rim = mix(light.fireTint, '#fff0c8', 0.3);
  const k = s / 100;
  const p = (px: number, py: number) => `${(x + px * k).toFixed(1)} ${(y + py * k).toFixed(1)}`;
  return (
    <g>
      <ellipse cx={x} cy={y + 2 * k} rx={64 * k} ry={8 * k} fill="#000" opacity={0.4} />
      {/* Tail curled round the back. */}
      <path d={`M${p(46, -8)} Q ${p(70, -6)} ${p(64, 4)} Q ${p(52, 6)} ${p(36, 0)}`} stroke={dark} strokeWidth={5 * k} fill="none" strokeLinecap="round" />
      {/* Body and haunch. */}
      <path d={`M${p(-30, 0)} Q ${p(-34, -22)} ${p(-6, -26)} Q ${p(30, -30)} ${p(48, -16)} Q ${p(56, -4)} ${p(44, 0)} Z`} fill={fur} />
      <ellipse cx={x + 34 * k} cy={y - 12 * k} rx={18 * k} ry={13 * k} fill={shade(fur, 0.1)} />
      <path d={`M${p(-20, -2)} Q ${p(10, -10)} ${p(44, -2)}`} stroke={dark} strokeWidth={2 * k} fill="none" opacity={0.6} />
      {/* Fore-legs stretched out in front, the head laid on them. */}
      <path d={`M${p(-26, -4)} L${p(-62, -2)} L${p(-62, 2)} L${p(-24, 2)} Z`} fill={shade(fur, 0.05)} />
      <path d={`M${p(-34, -12)} Q ${p(-48, -24)} ${p(-60, -16)} L${p(-72, -10)} Q ${p(-74, -5)} ${p(-66, -4)} L${p(-46, -4)} Q ${p(-36, -4)} ${p(-34, -12)} Z`} fill={fur} />
      <path d={`M${p(-50, -20)} Q ${p(-44, -32)} ${p(-38, -18)} Z`} fill={dark} />
      <ellipse cx={x - 72 * k} cy={y - 8 * k} rx={2.4 * k} ry={1.8 * k} fill={INK} />
      <path d={`M${p(-58, -13)} q 3 1 6 0`} stroke={INK} strokeWidth={1.2} fill="none" />
      {/* Firelight along the back. */}
      <path d={`M${p(-34, -18)} Q ${p(-6, -28)} ${p(30, -28)}`} stroke={rim} strokeWidth={1.6 * k} fill="none" opacity={0.6 * light.fire} />
    </g>
  );
}

/** A warp-weighted loom leaning on the wall: two uprights, a beam with cloth woven down from it, threads and stones. */
function Loom({ x, top, bottom, w, light }: { x: number; top: number; bottom: number; w: number; light: RoomLight }): ReactElement {
  const wood = lit(light, '#4e3420', 0.3);
  const cloth = lit(light, '#8a5a3a', 0.35);
  const thread = lit(light, '#c8b48a', 0.35);
  const stone = lit(light, '#6a645a', 0.3);
  const lean = 16;
  const woven = top + (bottom - top) * 0.36;
  const weights = bottom - 46;
  const n = 18;
  return (
    <g>
      <line x1={x - w / 2 - lean} y1={top - 20} x2={x - w / 2 + lean} y2={bottom} stroke={wood} strokeWidth={12} strokeLinecap="round" />
      <line x1={x + w / 2 - lean} y1={top - 20} x2={x + w / 2 + lean} y2={bottom} stroke={wood} strokeWidth={12} strokeLinecap="round" />
      <rect x={x - w / 2 - lean - 14} y={top - 8} width={w + 28} height={14} rx={5} fill={shade(wood, 0.1)} />
      {/* The cloth woven so far: a red-brown band with a pattern. */}
      <path d={`M${x - w / 2 - lean + 8} ${top + 6} L${x + w / 2 - lean - 8} ${top + 6} L${x + w / 2 - lean * 0.3 - 8} ${woven} L${x - w / 2 - lean * 0.3 + 8} ${woven} Z`} fill={cloth} />
      {[0.3, 0.6].map((f) => (
        <line key={f} x1={x - w / 2 - lean + 10 + f * 6} y1={top + 6 + (woven - top) * f} x2={x + w / 2 - lean - 10 + f * 6} y2={top + 6 + (woven - top) * f} stroke={lit(light, '#c9a04a', 0.3)} strokeWidth={4} opacity={0.75} />
      ))}
      {/* Warp threads down to the weights. */}
      {Array.from({ length: n }, (_, i) => {
        const fx = x - w / 2 + 12 + ((w - 24) * i) / (n - 1);
        return <line key={i} x1={fx - lean * 0.3} y1={woven} x2={fx + lean * 0.5} y2={weights} stroke={thread} strokeWidth={1.2} opacity={0.75} />;
      })}
      {/* The shed rod across the threads. */}
      <line x1={x - w / 2 - lean * 0.1} y1={woven + 70} x2={x + w / 2 + lean * 0.1} y2={woven + 70} stroke={wood} strokeWidth={6} />
      {Array.from({ length: n / 2 }, (_, i) => {
        const fx = x - w / 2 + 16 + ((w - 32) * i) / (n / 2 - 1) + lean * 0.5;
        return <ellipse key={i} cx={fx} cy={weights + 10 + (i % 2) * 6} rx={8} ry={11} fill={i % 3 === 0 ? shade(stone, 0.2) : stone} stroke={shade(stone, 0.5)} strokeWidth={1} />;
      })}
    </g>
  );
}

/** A stag's skull and antlers mounted on the wall. */
function Antlers({ x, y, s, light }: { x: number; y: number; s: number; light: RoomLight }): ReactElement {
  const bone = lit(light, BONE, 0.35);
  const horn = lit(light, '#b89a6a', 0.35);
  const k = s / 100;
  const side = (d: -1 | 1) => (
    <path
      d={`M${x + d * 8 * k} ${y - 14 * k} Q ${x + d * 30 * k} ${y - 40 * k} ${x + d * 40 * k} ${y - 82 * k} M${x + d * 22 * k} ${y - 36 * k} L${x + d * 46 * k} ${y - 46 * k} M${x + d * 32 * k} ${y - 58 * k} L${x + d * 58 * k} ${y - 70 * k} M${x + d * 38 * k} ${y - 74 * k} L${x + d * 30 * k} ${y - 100 * k} M${x + d * 40 * k} ${y - 82 * k} L${x + d * 56 * k} ${y - 104 * k}`}
      stroke={horn}
      strokeWidth={5 * k}
      fill="none"
      strokeLinecap="round"
    />
  );
  return (
    <g>
      <ellipse cx={x} cy={y + 4 * k} rx={22 * k} ry={30 * k} fill={lit(light, '#3a2616', 0.3)} />
      {side(-1)}
      {side(1)}
      <path d={`M${x - 11 * k} ${y - 16 * k} Q ${x} ${y - 22 * k} ${x + 11 * k} ${y - 16 * k} L${x + 6 * k} ${y + 22 * k} Q ${x} ${y + 28 * k} ${x - 6 * k} ${y + 22 * k} Z`} fill={bone} />
      <ellipse cx={x - 5 * k} cy={y - 6 * k} rx={2.6 * k} ry={3 * k} fill={INK} />
      <ellipse cx={x + 5 * k} cy={y - 6 * k} rx={2.6 * k} ry={3 * k} fill={INK} />
    </g>
  );
}

/** A soapstone pot hanging on a chain from the beam over the fire. */
function Pot({ uid, x, y, chainTop, light }: { uid: string; x: number; y: number; chainTop: number; light: RoomLight }): ReactElement {
  const stone = lit(light, '#5a5650', 0.8);
  const iron = lit(light, '#3e3e3e', 0.6);
  return (
    <g>
      <line x1={x} y1={chainTop} x2={x} y2={y - 46} stroke={iron} strokeWidth={3} strokeDasharray="6 3" />
      <path d={`M${x - 34} ${y - 40} Q ${x} ${y - 70} ${x + 34} ${y - 40}`} stroke={iron} strokeWidth={3} fill="none" />
      <path d={`M${x - 40} ${y - 40} L${x + 40} ${y - 40} L${x + 34} ${y - 6} Q ${x} ${y + 6} ${x - 34} ${y - 6} Z`} fill={stone} />
      <path d={`M${x - 40} ${y - 40} L${x - 18} ${y - 40} L${x - 16} ${y - 2} Q ${x - 28} ${y - 2} ${x - 34} ${y - 6} Z`} fill={shade(stone, 0.35)} />
      <ellipse cx={x} cy={y - 40} rx={40} ry={7} fill={shade(stone, 0.5)} />
      {/* Steam rising off it. */}
      <path d={`M${x - 8} ${y - 50} q -10 -20 4 -36 q 12 -16 -2 -34`} stroke="#d8d0c0" strokeWidth={5} fill="none" opacity={0.18} strokeLinecap="round" />
      <FireGlow uid={uid} x={x} y={y} rx={70} ry={30} light={light} strength={0.35} />
    </g>
  );
}

/** A sleeper under furs on the bench: a long hump and a head on a rolled cloak. */
function Sleeper({ x, y, w, light, fur = '#6a5038' }: { x: number; y: number; w: number; light: RoomLight; fur?: string }): ReactElement {
  const f = lit(light, fur, 0.3, 0.2);
  return (
    <g>
      <path d={`M${x - w / 2} ${y} Q ${x - w * 0.35} ${y - w * 0.22} ${x - w * 0.05} ${y - w * 0.2} Q ${x + w * 0.3} ${y - w * 0.24} ${x + w * 0.46} ${y - w * 0.06} L${x + w / 2} ${y} Z`} fill={f} />
      <path d={`M${x - w * 0.3} ${y - w * 0.12} q ${w * 0.2} ${-w * 0.06} ${w * 0.4} 0`} stroke={shade(f, 0.4)} strokeWidth={2} fill="none" />
      <ellipse cx={x - w * 0.5} cy={y - w * 0.06} rx={w * 0.09} ry={w * 0.06} fill={lit(light, '#5a4a6a', 0.3, 0.2)} />
      <ellipse cx={x - w * 0.47} cy={y - w * 0.12} rx={w * 0.06} ry={w * 0.055} fill={lit(light, '#c89a72', 0.35, 0.2)} />
      <path d={`M${x - w * 0.52} ${y - w * 0.17} q ${w * 0.05} ${-w * 0.03} ${w * 0.1} 0`} stroke={lit(light, '#8a5a2a', 0.3, 0.2)} strokeWidth={w * 0.03} fill="none" />
    </g>
  );
}

/** The procedural Longhouse (1600 × 900). */
export function LonghousePainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const o = light.outdoor;
  const r = rng(seed + 11);
  const shaft = 0.1 * light.daylight;
  return (
    <RoomSvg uid={uid} light={light} testId="interior-painting-longhouse">
      {/* The roof: rafters running up into the smoke, a smoke-hole over the hearth. */}
      <rect x={-100} y={-100} width={1800} height={WALL_TOP + 100} fill={lit(light, '#1e150e', 0.12, 0.35)} />
      {Array.from({ length: 11 }, (_, i) => {
        const x = -60 + i * 170 + r() * 20;
        return <Beam key={`raf${i}`} a={[x, WALL_TOP]} b={[x + 90, -40]} t={18} light={light} warm={0.12} depth={0.35} />;
      })}
      <polygon points={`660,-10 740,-10 732,40 668,40`} fill={mix(o.sky[1], o.sky[2], 0.5)} opacity={0.4 + 0.5 * light.daylight} />

      {/* The long wall, the wall-plate and the bench along it. */}
      <PlankedWall corners={[[-100, WALL_TOP], [1700, WALL_TOP], [1700, BENCH_TOP], [-100, BENCH_TOP]]} colour="#45301e" light={light} count={30} warm={0.35} depth={0.1} />
      <Beam a={[-100, WALL_TOP + 6]} b={[1700, WALL_TOP + 6]} t={26} light={light} warm={0.3} depth={0.1} />
      {/* The long woven band under the wall-plate. */}
      <Hanging x={760} y={WALL_TOP + 34} w={1040} h={84} colour="#6a2a1e" light={light} motif="knot" warm={0.4} depth={0.1} />
      <Hanging x={1430} y={WALL_TOP + 34} w={240} h={84} colour="#2f4f6a" light={light} motif="diamond" warm={0.3} depth={0.15} />

      {/* Shields and the antlers on the wall. */}
      <Shield x={150} y={330} r={52} colour="#2f4f7a" design="cross" light={light} warm={0.25} depth={0.15} />
      <Shield x={870} y={330} r={50} colour="#d4a74f" design="spiral" light={light} warm={0.4} depth={0.1} />
      <Shield x={1010} y={336} r={46} colour="#9e2f22" design="quarter" light={light} warm={0.4} depth={0.1} />
      <Shield x={1500} y={330} r={52} colour="#3f6a3a" design="half" light={light} warm={0.25} depth={0.15} />
      <Antlers x={1200} y={360} s={120} light={light} />
      {/* A bow hung on a peg. */}
      <path d={`M680 290 Q 720 370 680 450`} stroke={lit(light, '#6a4a2a', 0.35)} strokeWidth={6} fill="none" />
      <line x1={680} y1={290} x2={680} y2={450} stroke={lit(light, '#c8b48a', 0.35)} strokeWidth={1.2} />

      {/* The floor of beaten earth, warm round the hearth. */}
      <Floor y={FLOOR} light={light} kind="earth" seed={seed} warmAt={[620, 760]} />
      {shaft > 0.05 && <polygon points={`670,-10 730,-10 800,${FLOOR + 120} 690,${FLOOR + 120}`} fill={mix(o.sky[3], '#fff4d6', 0.5)} opacity={shaft} style={{ mixBlendMode: 'screen' }} />}

      {/* The sleeping bench: its top, furs and sleepers, its front boards. */}
      <polygon points={`-100,${BENCH_TOP} 1700,${BENCH_TOP} 1700,${BENCH_FRONT} -100,${BENCH_FRONT}`} fill={lit(light, '#5a3e26', 0.35)} />
      <rect x={-100} y={BENCH_FRONT} width={1800} height={FLOOR - BENCH_FRONT} fill={lit(light, '#3a2716', 0.35)} />
      {Array.from({ length: 13 }, (_, i) => (
        <line key={`bl${i}`} x1={-80 + i * 140} y1={BENCH_FRONT} x2={-80 + i * 140} y2={FLOOR} stroke={lit(light, '#22160c', 0.3)} strokeWidth={4} />
      ))}
      <line x1={-100} y1={BENCH_FRONT} x2={1700} y2={BENCH_FRONT} stroke={lit(light, '#9a6a3a', 0.6)} strokeWidth={2} opacity={0.6} />
      {/* Furs thrown on the bench. */}
      {[60, 740, 1350].map((x, i) => (
        <path key={`fur${x}`} d={`M${x - 90} ${BENCH_FRONT} Q ${x - 80} ${BENCH_TOP - 6} ${x} ${BENCH_TOP - 4} Q ${x + 80} ${BENCH_TOP - 6} ${x + 100} ${BENCH_FRONT} Q ${x + 60} ${BENCH_FRONT + 24 + i * 4} ${x} ${BENCH_FRONT + 14} Q ${x - 50} ${BENCH_FRONT + 26} ${x - 90} ${BENCH_FRONT} Z`} fill={lit(light, i === 1 ? '#8a6e52' : '#6a5440', 0.35, 0.1)} />
      ))}
      <Sleeper x={1450} y={BENCH_FRONT - 12} w={190} light={light} />
      <Sleeper x={110} y={BENCH_FRONT - 12} w={160} light={light} fur="#5a4a3a" />

      {/* The household on the bench: talking, mending, a cup going round. */}
      <Person x={650} y={FLOOR} h={150} pose="seated" hold="cup" look={{ tunic: '#5a6a4a', hair: '#7a5a3a', beard: 'short', trousers: '#4a3e30' }} light={light} warmSide="right" warm={0.4} depth={0.35} />
      <Person x={760} y={FLOOR} h={140} pose="seated" look={{ tunic: '#7a4a3a', hair: '#c8a060', hairStyle: 'braid', beard: 'none', head: 'hood', cloak: '#6a5a4a' }} light={light} warmSide="left" warm={0.4} depth={0.35} />
      <Person x={890} y={FLOOR} h={152} pose="seated" hold="horn" look={{ tunic: '#3e4a5a', hair: '#3a2a1a', beard: 'long', build: 'broad' }} light={light} warmSide="left" warm={0.45} depth={0.3} flip />
      <Person x={1310} y={FLOOR} h={136} pose="seated" look={{ tunic: '#6a5a3a', hair: '#e0c890', hairStyle: 'long', beard: 'none' }} light={light} warmSide="left" warm={0.35} depth={0.35} />
      {/* A child sitting on the bench's edge. */}
      <Person x={1000} y={FLOOR - 4} h={100} pose="seated" look={{ tunic: '#8a6a3a', hair: '#d8b878', beard: 'none', build: 'slim' }} light={light} warmSide="left" warm={0.4} depth={0.3} />

      {/* The loom on the left and the woman weaving at it. */}
      <Loom x={330} top={230} bottom={FLOOR + 30} w={210} light={light} />
      <Person x={460} y={FLOOR + 50} h={250} hold="none" look={{ tunic: '#6a4a5a', hair: '#8a5a2a', hairStyle: 'braid', beard: 'none', head: 'hood', cloak: '#4a3a3a', trousers: '#4a3a3a', build: 'slim' }} light={light} warmSide="right" warm={0.5} depth={0.15} flip />

      {/* The roof posts standing on the floor in front of the bench. */}
      <Post x={40} top={WALL_TOP - 30} bottom={FLOOR + 140} w={58} light={light} warm={0.35} fireSide="right" />
      <Post x={1560} top={WALL_TOP - 30} bottom={FLOOR + 140} w={58} light={light} warm={0.35} fireSide="left" />
      <Beam a={[-100, 120]} b={[1700, 120]} t={30} light={light} warm={0.25} depth={0.1} />

      <SmokeHaze uid={uid} y={210} opacity={0.7} />

      {/* The empty seat kept for the ruler, and the House-elder beside it with the hound at his feet. */}
      <CarvedChair x={1330} y={820} w={150} h={300} light={light} warm={0.5} />
      <CarvedChair x={1150} y={830} w={160} h={310} light={light} warm={0.6} fur={false} />
      <Person x={1150} y={826} h={300} pose="seated" light={light} warmSide="left" warm={0.7} look={{ tunic: '#5a4a38', trim: '#c9a04a', cloak: '#34404e', fur: true, beard: 'long', hair: '#dcd8d0', hairStyle: 'long', build: 'slim', trousers: '#3e3830', skin: '#c49a7a' }} />

      {/* The long hearth, the pot over it, the hound asleep by the fire at the elder's feet. */}
      <Pot uid={uid} x={600} y={712} chainTop={120} light={light} />
      <Hearth uid={uid} x={560} y={800} rx={380} ry={38} light={light} flame={0.32} />
      {[300, 450, 590, 730].map((x, i) => (
        <Flames key={x} uid={uid} x={x} y={808} w={64 + (i % 2) * 18} h={64 + (i % 3) * 16} />
      ))}
      <Hound x={1000} y={814} s={150} light={light} />
    </RoomSvg>
  );
}

/** The Longhouse: its painting and its one person. */
export const longhouseRoom: InteriorRoomDef = {
  id: 'longhouse',
  titleKey: 'hub.building.longhouse.name',
  assetId: 'hub.interior.longhouse',
  Painting: LonghousePainting,
  people: [
    {
      id: 'houseElder',
      x: 1150,
      y: 840,
      w: 250,
      h: 360,
      nameKey: 'people.interior.longhouse.houseElder.name',
      greetingKey: 'people.interior.longhouse.houseElder.greeting',
      icon: 'family',
      wide: true,
    },
  ],
  // Measured on the final painting (hub/interior-longhouse.jpg, 1600 × 900: a pixel is a viewBox unit).
  final: {
    base: {
      houseElder: { x: 1152, y: 800, w: 345, h: 510 },
    },
  },
};
