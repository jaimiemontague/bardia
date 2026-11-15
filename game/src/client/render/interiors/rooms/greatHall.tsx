/**
 * The Great hall, wholly indoors: looking down the long timber hall to the high seat at the far end. Posts and
 * tie-beams march toward it, the roof is lost in smoke above, a fire burns in the foreground, shields and
 * hangings line the walls and a few of the household sit on the side benches. Daylight falls through the
 * smoke-hole by day; at night only the fire and two torches light the hall.
 *
 * People: the Hirdmaster on the high seat (keeps it for the ruler; the realm, the muster, the next voyage), the
 * Steward by the open strongbox (the ledger), the Lawspeaker with his staff (affairs of state). Two of the hird
 * stand guard before the seat and a woven runner leads to it: the hall is holding court.
 */
import type { ReactElement } from 'react';
import { mix } from '../../scenes/paint';
import { lit, type RoomLight } from '../light';
import { Beam, Chest, Flames, FireGlow, Floor, Hanging, Hearth, HighSeat, PlankedWall, Post, RoomSvg, Shield, SideBench, SmokeHaze, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

// One-point perspective down the hall: the vanishing point, the far wall, and how a depth s ≥ 1 maps a point.
const VX = 800;
const VY = 380;
const FAR = { left: 500, right: 1100, eave: 250, floor: 620, ridge: 90 } as const;
const at = (dx: number, dy: number, s: number): [number, number] => [VX + dx * s, VY + dy * s];

/** A torch in an iron holder on the wall: a stick, flames and its pool of light. */
function Torch({ uid, x, y, light }: { uid: string; x: number; y: number; light: RoomLight }): ReactElement {
  return (
    <g>
      <FireGlow uid={uid} x={x} y={y - 20} rx={170} ry={150} light={light} strength={0.9} />
      <line x1={x} y1={y} x2={x + 6} y2={y + 60} stroke={lit(light, '#3a2414', 0.8)} strokeWidth={8} strokeLinecap="round" />
      <rect x={x - 9} y={y + 14} width={18} height={6} fill={lit(light, '#4a4a4a', 0.8)} />
      <Flames uid={uid} x={x} y={y + 4} w={26} h={46} />
    </g>
  );
}

/** The procedural Great hall (1600 × 900). */
export function GreatHallPainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const wood = '#4a3322';
  const o = light.outdoor;
  // Far wall (the gable end behind the high seat).
  const far = `M${FAR.left} ${FAR.floor} L${FAR.left} ${FAR.eave} L${VX} ${FAR.ridge} L${FAR.right} ${FAR.eave} L${FAR.right} ${FAR.floor} Z`;
  const S_NEAR = 3.2;
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
  const depths = [1.18, 1.6, 2.6];
  const shields = [
    { s: 1.15, c: '#9e2f22', d: 'quarter' as const },
    { s: 1.45, c: '#2f4f7a', d: 'cross' as const },
    { s: 1.85, c: '#d4a74f', d: 'spiral' as const },
    { s: 2.4, c: '#3f6a3a', d: 'half' as const },
  ];
  const shaft = 0.22 * light.daylight;
  return (
    <RoomSvg uid={uid} light={light} testId="interior-painting-greatHall">
      {/* Roof planes rising into the dark, with rafters and purlins. */}
      <rect x={-100} y={-100} width={1800} height={1100} fill={lit(light, '#1c130c', 0.1, 0.4)} />
      <polygon points={`${FAR.left},${FAR.eave} ${VX},${FAR.ridge} ${nearRidge[0]},${nearRidge[1]} ${nearEaveL[0]},${nearEaveL[1]}`} fill={lit(light, '#2a1d13', 0.15, 0.3)} />
      <polygon points={`${FAR.right},${FAR.eave} ${VX},${FAR.ridge} ${nearRidge[0]},${nearRidge[1]} ${nearEaveR[0]},${nearEaveR[1]}`} fill={lit(light, '#241810', 0.1, 0.35)} />
      {[1, 1.3, 1.7, 2.2, 2.9].map((s) => (
        <g key={`r${s}`}>
          <Beam a={at(dxL, dyE, s)} b={at(0, dyR, s)} t={7 * s} light={light} warm={0.15} depth={0.3} />
          <Beam a={at(dxR, dyE, s)} b={at(0, dyR, s)} t={7 * s} light={light} warm={0.15} depth={0.3} />
        </g>
      ))}
      {[0.35, 0.7].map((f) => {
        const a1 = at(dxL * (1 - f), dyE + (dyR - dyE) * f, 1);
        const a2 = at(dxL * (1 - f), dyE + (dyR - dyE) * f, S_NEAR);
        const b1 = at(dxR * (1 - f), dyE + (dyR - dyE) * f, 1);
        const b2 = at(dxR * (1 - f), dyE + (dyR - dyE) * f, S_NEAR);
        return (
          <g key={`p${f}`}>
            <line x1={a1[0]} y1={a1[1]} x2={a2[0]} y2={a2[1]} stroke={lit(light, '#3a2818', 0.1, 0.3)} strokeWidth={9} />
            <line x1={b1[0]} y1={b1[1]} x2={b2[0]} y2={b2[1]} stroke={lit(light, '#3a2818', 0.1, 0.3)} strokeWidth={9} />
          </g>
        );
      })}
      {/* The smoke-hole: the sky shows through it, and by day a shaft of light falls in. */}
      <polygon points={`${VX - 34},${FAR.ridge - 66} ${VX + 34},${FAR.ridge - 66} ${VX + 26},${FAR.ridge - 22} ${VX - 26},${FAR.ridge - 22}`} fill={mix(o.sky[1], o.sky[2], 0.5)} opacity={0.5 + 0.5 * light.daylight} />
      {shaft > 0.05 && <polygon points={`${VX - 30},${FAR.ridge - 40} ${VX + 30},${FAR.ridge - 40} ${VX + 170},${FAR.floor + 40} ${VX - 10},${FAR.floor + 40}`} fill={mix(o.sky[3], '#fff4d6', 0.5)} opacity={shaft} style={{ mixBlendMode: 'screen' }} />}

      {/* The far wall: planks, two hangings, two torches. */}
      <path d={far} fill={lit(light, wood, 0.35, 0.15)} />
      <PlankedWall corners={[[FAR.left, FAR.eave], [FAR.right, FAR.eave], [FAR.right, FAR.floor], [FAR.left, FAR.floor]]} colour={wood} light={light} count={16} warm={0.35} depth={0.15} />
      <path d={`M${FAR.left} ${FAR.eave} L${VX} ${FAR.ridge} L${FAR.right} ${FAR.eave}`} stroke={lit(light, '#2a1c12', 0.2)} strokeWidth={14} fill="none" />
      <Hanging x={612} y={300} w={112} h={210} colour="#2f4f6a" light={light} motif="knot" warm={0.45} depth={0.1} />
      <Hanging x={988} y={300} w={112} h={210} colour="#2f4f6a" light={light} motif="knot" warm={0.45} depth={0.1} />
      <Hanging x={VX} y={170} w={180} h={110} colour="#7a2a1e" light={light} motif="diamond" warm={0.4} depth={0.1} />

      {/* Side walls in perspective, with shields hung along them. */}
      <PlankedWall corners={[nearEaveL, [FAR.left, FAR.eave], [FAR.left, FAR.floor], nearFloorL]} colour="#3d2a1a" light={light} count={14} warm={0.3} depth={0.05} />
      <PlankedWall corners={[[FAR.right, FAR.eave], nearEaveR, nearFloorR, [FAR.right, FAR.floor]]} colour="#3d2a1a" light={light} count={14} warm={0.3} depth={0.05} />
      {shields.map(({ s, c, d }) => {
        const [lx, ly] = at(dxL + 8, -40, s);
        const [rx, ry] = at(dxR - 8, -40, s);
        return (
          <g key={`sh${s}`}>
            <Shield x={lx} y={ly} r={30 * s} colour={c} design={d} squash={0.5} light={light} warm={0.35} />
            <Shield x={rx} y={ry} r={30 * s} colour={c === '#d4a74f' ? '#9e2f22' : c} design={d} squash={0.5} light={light} warm={0.35} />
          </g>
        );
      })}

      {/* The floor, and the raised benches along both walls. */}
      <Floor y={FAR.floor} light={light} kind="earth" seed={seed} />
      <SideBench near={at(-232, 200, 2.7)} far={at(-232, 200, 1)} nearH={40 * 2.7} farH={40} nearD={-68 * 2.7} farD={-68} light={light} warm={0.45} />
      <SideBench near={at(232, 200, 2.7)} far={at(232, 200, 1)} nearH={40 * 2.7} farH={40} nearD={68 * 2.7} farD={68} light={light} warm={0.45} />

      {/* The high seat on its dais, the torches either side. */}
      <Torch uid={uid} x={566} y={350} light={light} />
      <Torch uid={uid} x={1034} y={350} light={light} />
      <HighSeat x={VX} y={612} w={196} h={300} light={light} warm={0.55} />

      {/* Household folk on the benches (not people you can speak with: dim and small). */}
      <Person x={at(-262, 196, 1.06)[0]} y={at(-262, 196, 1.06)[1]} h={76} pose="seated" hold="cup" look={{ tunic: '#5a5040', hair: '#6a4a2a', beard: 'short' }} light={light} warmSide="right" depth={0.5} />
      <Person x={at(262, 196, 1.08)[0]} y={at(262, 196, 1.08)[1]} h={78} pose="seated" hold="horn" look={{ tunic: '#6a3a2a', hair: '#3a2a1a', beard: 'long' }} light={light} warmSide="left" depth={0.5} />

      {/* A woven runner from the fire to the dais. */}
      <polygon points={`${VX - 70},${FAR.floor + 40} ${VX + 70},${FAR.floor + 40} ${VX + 150},820 ${VX - 150},820`} fill={lit(light, '#6a2a1e', 0.6)} opacity={0.85} />
      {[0.15, 0.4, 0.65, 0.9].map((f) => {
        const ry = FAR.floor + 40 + (820 - FAR.floor - 40) * f;
        const hw = 70 + 80 * f;
        return <path key={`run${f}`} d={`M${VX - hw * 0.5} ${ry} L${VX} ${ry - 10 - 12 * f} L${VX + hw * 0.5} ${ry} L${VX} ${ry + 10 + 12 * f} Z`} fill="none" stroke={lit(light, '#c9a04a', 0.6)} strokeWidth={2 + 2 * f} opacity={0.7} />;
      })}
      <polygon points={`${VX - 70},${FAR.floor + 40} ${VX - 60},${FAR.floor + 40} ${VX - 136},820 ${VX - 150},820`} fill={lit(light, '#c9a04a', 0.6)} opacity={0.6} />
      <polygon points={`${VX + 60},${FAR.floor + 40} ${VX + 70},${FAR.floor + 40} ${VX + 150},820 ${VX + 136},820`} fill={lit(light, '#c9a04a', 0.6)} opacity={0.6} />

      {/* The posts and tie-beams down the hall. */}
      {depths.map((s) => {
        const w = 20 * s;
        const [lx, lb] = at(-212, dyF, s);
        const [rx] = at(212, dyF, s);
        const top = VY - 200 * s;
        const tie = at(0, -175, s)[1];
        return (
          <g key={`post${s}`}>
            <Beam a={[lx - w, tie]} b={[rx + w, tie]} t={11 * s} light={light} warm={0.25} depth={0.15} />
            <Post x={lx} top={top} bottom={lb} w={w} light={light} warm={0.45} fireSide="right" />
            <Post x={rx} top={top} bottom={lb} w={w} light={light} warm={0.45} fireSide="left" />
          </g>
        );
      })}

      {/* The Hirdmaster on the high seat. */}
      <Person x={VX} y={606} h={236} pose="seated" hold="sword" light={light} warmSide="left" warm={0.6} look={{ tunic: '#7a2a1e', trim: '#d4a74f', cloak: '#26303e', fur: true, beard: 'long', hair: '#8a6a48', hairStyle: 'long', build: 'broad', head: 'band' }} />

      {/* Two of the hird stand guard before the seat: the court is in session. */}
      <Person x={636} y={668} h={214} hold="staff" look={{ tunic: '#3e4a5a', cloak: '#5a2a22', beard: 'short', hair: '#5a4028', build: 'broad', head: 'band', trim: '#8a7a5a' }} light={light} warmSide="right" warm={0.5} depth={0.15} />
      <Person x={964} y={668} h={214} hold="staff" flip look={{ tunic: '#3e4a5a', cloak: '#5a2a22', beard: 'long', hair: '#8a6a3a', build: 'broad', head: 'band', trim: '#8a7a5a' }} light={light} warmSide="left" warm={0.5} depth={0.15} />

      <SmokeHaze uid={uid} y={240} opacity={0.75} />

      {/* The Steward by his strongbox (left), the Lawspeaker with his staff (right). */}
      <Chest x={575} y={826} w={170} h={104} light={light} warm={0.7} open />
      <Person x={410} y={818} h={404} pose="standing" hold="keys" light={light} warmSide="right" warm={0.65} look={{ tunic: '#2f5a46', trim: '#d4a74f', cloak: '#2a2f50', fur: true, chain: true, beard: 'short', hair: '#5a3a20', build: 'stout', head: 'cap', hat: '#5a1a2a', trousers: '#3a3530' }} />
      <Person x={1215} y={808} h={420} pose="standing" hold="staff" flip light={light} warmSide="left" warm={0.65} look={{ tunic: '#6a6658', cloak: '#3e4a44', beard: 'forked', hair: '#c8c4bc', hairStyle: 'long', build: 'slim', head: 'hood', trousers: '#40403a' }} />

      {/* The fire in the foreground. */}
      <Hearth uid={uid} x={VX} y={872} rx={210} ry={52} light={light} />
    </RoomSvg>
  );
}

/** The Great hall: its painting and its people (digit order: the Hirdmaster first). */
export const greatHallRoom: InteriorRoomDef = {
  id: 'greatHall',
  titleKey: 'hub.building.greatHall.name',
  assetId: 'hub.interior.greatHall',
  Painting: GreatHallPainting,
  people: [
    { id: 'hirdmaster', x: 800, y: 640, w: 260, h: 360, nameKey: 'hub.interior.greatHall.hirdmaster.name', greetingKey: 'hub.interior.greatHall.hirdmaster.greeting', icon: 'crown', panel: 'right', wide: true },
    { id: 'steward', x: 470, y: 836, w: 340, h: 446, nameKey: 'hub.interior.greatHall.steward.name', greetingKey: 'hub.interior.greatHall.steward.greeting', icon: 'silver' },
    { id: 'lawspeaker', x: 1200, y: 826, w: 250, h: 530, nameKey: 'hub.interior.greatHall.lawspeaker.name', greetingKey: 'hub.interior.greatHall.lawspeaker.greeting', icon: 'quill' },
  ],
};
