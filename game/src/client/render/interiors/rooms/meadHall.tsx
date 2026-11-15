/**
 * The Mead-hall, wholly indoors: a low, smoky timber hall seen from the door end. A long hearth burns down the
 * middle with a cauldron hung over it from a tripod; benches run along both walls; a serving girl carries a cup at
 * the back and a few drinkers sit in the gloom. In the right foreground the hall-keeper stands before his counter
 * by the great ale vat; on the left two travellers sit at a table over their cups; at the back, in the shadows by
 * their spears and shields, a pair of sellswords wait for work.
 *
 * People: the Hall-keeper (news, a round, what has been heard of other places), the Travellers (what they say of
 * the ports nearby), the Sellswords (fighters to hire).
 */
import type { ReactElement } from 'react';
import { mix } from '../../scenes/paint';
import { lit, type RoomLight } from '../light';
import { Barrel, Beam, FireGlow, Flames, Floor, Hanging, Hearth, PlankedWall, Post, RoomSvg, Shield, SideBench, SmokeHaze, Table, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

// One-point perspective down the hall, a little to the left of centre so the keeper's wall shows.
const VX = 760;
const VY = 400;
const FAR = { left: 520, right: 1000, eave: 300, floor: 600, ridge: 180 } as const;
const at = (dx: number, dy: number, s: number): [number, number] => [VX + dx * s, VY + dy * s];

/** A torch on the wall: a stick, flames and its pool of light. */
function Torch({ uid, x, y, light, s = 1 }: { uid: string; x: number; y: number; light: RoomLight; s?: number }): ReactElement {
  return (
    <g>
      <FireGlow uid={uid} x={x} y={y - 20 * s} rx={170 * s} ry={150 * s} light={light} strength={0.85} />
      <line x1={x} y1={y} x2={x + 6 * s} y2={y + 56 * s} stroke={lit(light, '#3a2414', 0.8)} strokeWidth={7 * s} strokeLinecap="round" />
      <Flames uid={uid} x={x} y={y + 4 * s} w={24 * s} h={42 * s} />
    </g>
  );
}

/** A cauldron hung on a chain from a tripod over the fire, steaming. */
function Cauldron({ x, y, light }: { x: number; y: number; light: RoomLight }): ReactElement {
  const leg = lit(light, '#3a2a1a', 0.8);
  const iron = lit(light, '#2a2826', 0.9);
  const apex = y - 230;
  return (
    <g>
      <line x1={x - 120} y1={y + 20} x2={x} y2={apex} stroke={leg} strokeWidth={9} strokeLinecap="round" />
      <line x1={x + 120} y1={y + 20} x2={x} y2={apex} stroke={leg} strokeWidth={9} strokeLinecap="round" />
      <line x1={x + 18} y1={y - 6} x2={x} y2={apex} stroke={leg} strokeWidth={7} strokeLinecap="round" />
      <line x1={x} y1={apex} x2={x} y2={y - 96} stroke={lit(light, '#5a5a5a', 0.8)} strokeWidth={3} strokeDasharray="6 3" />
      <path d={`M${x - 48} ${y - 92} Q ${x} ${y - 132} ${x + 48} ${y - 92}`} stroke={iron} strokeWidth={3} fill="none" />
      <path d={`M${x - 52} ${y - 90} Q ${x - 58} ${y - 30} ${x} ${y - 26} Q ${x + 58} ${y - 30} ${x + 52} ${y - 90} Z`} fill={iron} />
      <ellipse cx={x} cy={y - 90} rx={52} ry={10} fill="#140c08" />
      <path d={`M${x - 52} ${y - 60} Q ${x} ${y - 36} ${x + 52} ${y - 60}`} stroke={light.fireTint} strokeWidth={3} fill="none" opacity={0.45 * light.fire} />
      {[-18, 6, 26].map((dx, i) => (
        <path key={dx} d={`M${x + dx} ${y - 98} q -12 -24 4 -44 q 14 -18 0 -40`} stroke="#d8d0c4" strokeWidth={6 + i * 2} fill="none" opacity={0.12} strokeLinecap="round" />
      ))}
    </g>
  );
}

/** Three spears leaning against the wall (`s` scales them for depth). */
function SpearRack({ x, y, s = 1, light }: { x: number; y: number; s?: number; light: RoomLight }): ReactElement {
  const shaft = lit(light, '#5a3e24', 0.3, 0.2);
  const steel = lit(light, '#9a9ea2', 0.4, 0.2);
  return (
    <g>
      {[0, 22, 40].map((d, i) => {
        const dx = d * s;
        return (
          <g key={d} transform={`rotate(${-8 + i * 4} ${x + dx} ${y})`}>
            <line x1={x + dx} y1={y} x2={x + dx} y2={y - 420 * s} stroke={shaft} strokeWidth={7 * s} strokeLinecap="round" />
            <path d={`M${x + dx - 8 * s} ${y - 418 * s} L${x + dx} ${y - 470 * s} L${x + dx + 8 * s} ${y - 418 * s} Z`} fill={steel} />
          </g>
        );
      })}
    </g>
  );
}

/** A spear held upright beside a standing man's hand. */
function HeldSpear({ x, y, h, light }: { x: number; y: number; h: number; light: RoomLight }): ReactElement {
  const shaft = lit(light, '#5a3e24', 0.35);
  const steel = lit(light, '#a8acb0', 0.45);
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - h} stroke={shaft} strokeWidth={h * 0.016} strokeLinecap="round" />
      <path d={`M${x - h * 0.022} ${y - h + 2} L${x} ${y - h - h * 0.12} L${x + h * 0.022} ${y - h + 2} Z`} fill={steel} />
    </g>
  );
}

/** The keeper's counter along the right wall in perspective: a thick plank top on a boarded front. */
function Counter({ light }: { light: RoomLight }): ReactElement {
  const near: [number, number] = [1350, 612];
  const far: [number, number] = [1080, 548];
  const nearH = 160;
  const farH = 92;
  const top = lit(light, '#6a4a2c', 0.6);
  const front = lit(light, '#4a3220', 0.55);
  const boards = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const x = near[0] + (far[0] - near[0]) * t;
    const y = near[1] + (far[1] - near[1]) * t;
    const h = nearH + (farH - nearH) * t;
    return <line key={i} x1={x} y1={y + 6} x2={x} y2={y + h} stroke={mix(front, '#000000', 0.35)} strokeWidth={2} />;
  });
  return (
    <g>
      <polygon points={`${near[0]},${near[1]} ${far[0]},${far[1]} ${far[0]},${far[1] + farH} ${near[0]},${near[1] + nearH}`} fill={front} />
      {boards}
      <polygon points={`${near[0] - 10},${near[1] - 6} ${far[0] - 8},${far[1] - 5} ${far[0] + 30},${far[1] - 14} ${near[0] + 56},${near[1] - 22}`} fill={top} />
      <line x1={near[0] - 10} y1={near[1] - 6} x2={far[0] - 8} y2={far[1] - 5} stroke={lit(light, '#c49a62', 0.6)} strokeWidth={3} />
      {/* Cups and a horn on the counter. */}
      {[0.22, 0.4, 0.62].map((t) => {
        const x = near[0] + (far[0] - near[0]) * t;
        const y = near[1] + (far[1] - near[1]) * t - 10;
        return <path key={t} d={`M${x - 10} ${y} l 3 -22 l 14 0 l 3 22 Z`} fill={lit(light, '#8a8478', 0.7)} />;
      })}
    </g>
  );
}

/** The procedural Mead-hall (1600 × 900). */
export function MeadHallPainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const wood = '#4a3322';
  const o = light.outdoor;
  const S_NEAR = 3.4;
  const dxL = FAR.left - VX;
  const dxR = FAR.right - VX;
  const dyE = FAR.eave - VY;
  const dyF = FAR.floor - VY;
  const dyR = FAR.ridge - VY;
  const nearEaveL = at(dxL, dyE, S_NEAR);
  const nearEaveR = at(dxR, dyE, S_NEAR);
  const nearFloorL = at(dxL, dyF, S_NEAR);
  const nearFloorR = at(dxR, dyF, S_NEAR);
  const nearRidge = at(0, dyR, S_NEAR);
  const far = `M${FAR.left} ${FAR.floor} L${FAR.left} ${FAR.eave} L${VX} ${FAR.ridge} L${FAR.right} ${FAR.eave} L${FAR.right} ${FAR.floor} Z`;
  const door = { x: VX, w: 74, top: 470 };
  return (
    <RoomSvg uid={uid} light={light} testId="interior-painting-meadHall">
      {/* The roof lost in smoke, rafters and purlins. */}
      <rect x={-100} y={-100} width={1800} height={1100} fill={lit(light, '#1a120b', 0.15, 0.4)} />
      <polygon points={`${FAR.left},${FAR.eave} ${VX},${FAR.ridge} ${nearRidge[0]},${nearRidge[1]} ${nearEaveL[0]},${nearEaveL[1]}`} fill={lit(light, '#2a1d13', 0.2, 0.3)} />
      <polygon points={`${FAR.right},${FAR.eave} ${VX},${FAR.ridge} ${nearRidge[0]},${nearRidge[1]} ${nearEaveR[0]},${nearEaveR[1]}`} fill={lit(light, '#241810', 0.15, 0.35)} />
      {[1, 1.35, 1.8, 2.4, 3.1].map((s) => (
        <g key={`r${s}`}>
          <Beam a={at(dxL, dyE, s)} b={at(0, dyR, s)} t={8 * s} light={light} warm={0.2} depth={0.3} />
          <Beam a={at(dxR, dyE, s)} b={at(0, dyR, s)} t={8 * s} light={light} warm={0.2} depth={0.3} />
        </g>
      ))}

      {/* The far gable: planks, the door standing open on the hour outside, drinking horns on pegs. */}
      <path d={far} fill={lit(light, wood, 0.4, 0.15)} />
      <PlankedWall corners={[[FAR.left, FAR.eave], [FAR.right, FAR.eave], [FAR.right, FAR.floor], [FAR.left, FAR.floor]]} colour={wood} light={light} count={14} warm={0.4} depth={0.15} />
      <path d={`M${door.x - door.w / 2} ${FAR.floor} L${door.x - door.w / 2} ${door.top + 20} Q ${door.x} ${door.top - 14} ${door.x + door.w / 2} ${door.top + 20} L${door.x + door.w / 2} ${FAR.floor} Z`} fill={mix(o.sky[2], o.sky[3], 0.5)} opacity={0.35 + 0.6 * light.daylight} />
      <path d={`M${door.x + door.w / 2} ${FAR.floor} L${door.x + door.w / 2} ${door.top + 20} L${door.x + door.w / 2 + 30} ${door.top + 30} L${door.x + door.w / 2 + 30} ${FAR.floor + 6} Z`} fill={lit(light, '#3a2818', 0.3, 0.1)} />
      {[580, 620, 660, 880, 920, 960].map((x, i) => (
        <path key={x} d={`M${x} 404 q 8 ${i % 2 === 0 ? 12 : 15} 22 12 l 1 -4 q -12 1 -19 -10 Z`} fill={lit(light, '#a89870', 0.35, 0.3)} />
      ))}
      <Hanging x={VX} y={318} w={150} h={90} colour="#5a2a1e" light={light} motif="stripes" warm={0.45} depth={0.1} />

      {/* Side walls in perspective, shields along the left one. */}
      <PlankedWall corners={[nearEaveL, [FAR.left, FAR.eave], [FAR.left, FAR.floor], nearFloorL]} colour="#3d2a1a" light={light} count={14} warm={0.35} depth={0.05} />
      <PlankedWall corners={[[FAR.right, FAR.eave], nearEaveR, nearFloorR, [FAR.right, FAR.floor]]} colour="#3d2a1a" light={light} count={14} warm={0.4} depth={0.05} />
      {[1.2, 1.6].map((s, i) => {
        const [lx, ly] = at(dxL + 8, -30, s);
        return <Shield key={s} x={lx} y={ly} r={28 * s} colour={i === 0 ? '#3f6a3a' : '#9e2f22'} design={i === 0 ? 'cross' : 'quarter'} squash={0.5} light={light} warm={0.35} />;
      })}

      <Floor y={FAR.floor} light={light} kind="earth" seed={seed} warmAt={[VX, 700]} />
      <SideBench near={at(-222, 200, 2.2)} far={at(-222, 200, 1)} nearH={40 * 2.2} farH={40} nearD={-70 * 2.2} farD={-70} light={light} warm={0.45} />
      <SideBench near={at(222, 200, 1.6)} far={at(222, 200, 1)} nearH={40 * 1.6} farH={40} nearD={70 * 1.6} farD={70} light={light} warm={0.45} />

      {/* Torches on the far wall and along the right wall. */}
      <Torch uid={uid} x={560} y={350} light={light} />
      <Torch uid={uid} x={1150} y={300} light={light} s={1.3} />

      {/* Drinkers in the gloom, and the serving girl with her jug. */}
      <Person x={at(-250, 196, 1.08)[0]} y={at(-250, 196, 1.08)[1]} h={80} pose="seated" hold="horn" look={{ tunic: '#5a5040', hair: '#6a4a2a', beard: 'short' }} light={light} warmSide="right" depth={0.5} />
      <Person x={at(-250, 196, 1.3)[0]} y={at(-250, 196, 1.3)[1]} h={96} pose="seated" hold="cup" look={{ tunic: '#3e4a5a', hair: '#2a1a10', beard: 'long' }} light={light} warmSide="right" depth={0.45} />
      <Person x={at(246, 196, 1.1)[0]} y={at(246, 196, 1.1)[1]} h={82} pose="seated" hold="cup" flip look={{ tunic: '#6a3a2a', hair: '#8a6a3a', beard: 'short' }} light={light} warmSide="left" depth={0.5} />
      <Person x={610} y={622} h={170} pose="standing" hold="cup" look={{ tunic: '#7a5a3a', trim: '#c9a04a', hair: '#c89a52', hairStyle: 'braid', beard: 'none', build: 'slim', skin: '#d8a882', trousers: '#5a3a2a' }} light={light} warmSide="right" warm={0.55} depth={0.2} />

      {/* The sellswords in the shadows at the back, by their spears and shields. */}
      <SpearRack x={1030} y={630} s={0.5} light={light} />
      <Shield x={1050} y={560} r={34} colour="#2f4f7a" design="spiral" squash={0.6} light={light} warm={0.3} depth={0.2} />
      <Person x={840} y={642} h={218} pose="standing" light={light} warmSide="left" warm={0.4} depth={0.25} look={{ tunic: '#4a4a3a', cloak: '#5a2a22', beard: 'forked', hair: '#3a2a1a', build: 'broad', head: 'cap', hat: '#6a6a6c', trim: '#8a7a5a' }} />
      <HeldSpear x={840 + 16.5 * 2.18} y={646} h={270} light={light} />
      <Person x={935} y={636} h={206} pose="standing" flip light={light} warmSide="left" warm={0.35} depth={0.3} look={{ tunic: '#3e4a3a', fur: true, beard: 'long', hair: '#8a6a3a', hairStyle: 'long', build: 'broad', head: 'band', trim: '#7a2a1e' }} />
      <Shield x={935 - 16 * 2.06} y={636 - 48 * 2.06} r={34} colour="#9e2f22" design="quarter" squash={0.75} light={light} warm={0.4} depth={0.25} />

      {/* The posts and tie-beams down the hall. */}
      {[1.25, 1.75, 2.7].map((s) => {
        const w = 20 * s;
        const [lx, lb] = at(-200, dyF, s);
        const [rx] = at(200, dyF, s);
        const top = VY - 210 * s;
        const tie = at(0, -180, s)[1];
        return (
          <g key={`post${s}`}>
            <Beam a={[lx - w, tie]} b={[rx + w, tie]} t={11 * s} light={light} warm={0.3} depth={0.15} />
            <Post x={lx} top={top} bottom={lb} w={w} light={light} warm={0.5} fireSide="right" />
            {s < 2.5 && <Post x={rx} top={top} bottom={lb} w={w} light={light} warm={0.5} fireSide="left" />}
          </g>
        );
      })}


      {/* The keeper's counter along the right wall, the cups on the shelf above it. */}
      <rect x={1160} y={366} width={190} height={10} fill={lit(light, '#5a3e24', 0.5)} />
      {[1180, 1210, 1240, 1270, 1300, 1330].map((x, i) => (
        <path key={x} d={`M${x - 9} 366 l 2 -${20 + (i % 2) * 6} l 14 0 l 2 ${20 + (i % 2) * 6} Z`} fill={lit(light, i % 3 === 0 ? '#8a8478' : '#7a5a3a', 0.5)} />
      ))}
      <Counter light={light} />

      {/* The long hearth and the cauldron. */}
      <Hearth uid={uid} x={680} y={712} rx={180} ry={34} light={light} />
      <Cauldron x={680} y={712} light={light} />

      <SmokeHaze uid={uid} y={260} opacity={0.8} />

      {/* The travellers at a table on the left, over their cups. */}
      <Person x={300} y={824} h={250} pose="seated" hold="horn" light={light} warmSide="right" warm={0.7} look={{ tunic: '#5a3a2a', cloak: '#6a5a44', fur: true, beard: 'long', hair: '#a0663a', build: 'broad', trousers: '#4a3a2e' }} />
      <Person x={450} y={820} h={238} pose="seated" hold="cup" flip light={light} warmSide="right" warm={0.65} look={{ tunic: '#4a5a6a', cloak: '#3a3a44', beard: 'short', hair: '#4a3a2a', head: 'hood', build: 'slim', trousers: '#3a3a36' }} />
      <Table x={380} y={746} w={430} h={150} light={light} warm={0.7} />

      {/* The keeper in front of his counter, by the great ale vat. */}
      <Barrel x={1440} y={884} w={250} h={300} light={light} warm={0.55} />
      <path d="M1318 742 l -26 0 l 0 10 l 10 0 l 0 14 l 8 0 l 0 -14 l 8 0 Z" fill={lit(light, '#7a6a4a', 0.6)} />
      <Barrel x={1560} y={700} w={150} h={180} light={light} warm={0.4} />
      <Person x={1200} y={872} h={450} pose="standing" hold="cup" flip light={light} warmSide="left" warm={0.7} look={{ tunic: '#6a4a2e', apron: true, bareArms: true, beard: 'short', hairStyle: 'bald', hair: '#7a5a3a', build: 'stout', trousers: '#3e3428', skin: '#c88e66' }} />
    </RoomSvg>
  );
}

/** The Mead-hall: its painting and its people (digit order: the Hall-keeper first). */
export const meadHallRoom: InteriorRoomDef = {
  id: 'meadHall',
  titleKey: 'hub.building.meadHall.name',
  assetId: 'hub.interior.meadHall',
  Painting: MeadHallPainting,
  people: [
    { id: 'keeper', x: 1205, y: 884, w: 280, h: 510, nameKey: 'hub.interior.meadHall.keeper.name', greetingKey: 'hub.interior.meadHall.keeper.greeting', icon: 'quill' },
    { id: 'travellers', x: 380, y: 890, w: 380, h: 340, nameKey: 'hub.interior.meadHall.travellers.name', greetingKey: 'hub.interior.meadHall.travellers.greeting', icon: 'eye' },
    { id: 'sellswords', x: 885, y: 650, w: 240, h: 300, nameKey: 'hub.interior.meadHall.sellswords.name', greetingKey: 'hub.interior.meadHall.sellswords.greeting', icon: 'sword' },
  ],
};
