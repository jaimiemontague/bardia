/**
 * The Smithy, open to the weather: we stand under the timber overhang of the smith's work-shelter. The stone
 * forge glows on the left with its hood and bellows, tools hang from the front beam, a rack of finished arms
 * leans on the right post beside a rack of spear blades, and past the posts, beyond the village roofs, the land runs away to snow-capped mountains under the sky of the
 * hour. The smith stands at his anvil with the hammer raised and a bar of hot iron in the tongs.
 */
import type { ReactElement } from 'react';
import { Smoke } from '../../scenes/layers';
import { mix, shade } from '../../scenes/paint';
import { lit, outside, type RoomLight } from '../light';
import { Anvil, Barrel, Beam, Floor, Forge, Landscape, Overhang, Post, RoomSvg, Shield, ToolRack, useRoomUid } from '../paint';
import { Person } from '../people';
import type { InteriorRoomDef, RoomPaintingProps } from '../types';

const HORIZON = 500;
const GROUND = 690;

/** The village beyond the yard: turf-roofed houses on the rise, a little smoke from a roof-hole. */
function Houses({ light }: { light: RoomLight }): ReactElement {
  const wall = outside(light, '#5e4a32', 0.5);
  const roof = outside(light, light.winter ? '#dfe3e6' : '#56602e', 0.5);
  const lamp = light.tod === 'day' ? 0 : light.tod === 'night' ? 0.9 : 0.6;
  const houses = [
    { x: 860, y: 572, w: 110 },
    { x: 1000, y: 580, w: 150 },
    { x: 1165, y: 590, w: 190 },
    { x: 1330, y: 578, w: 130 },
  ];
  return (
    <g>
      {houses.map(({ x, y, w }) => (
        <g key={x}>
          <rect x={x - w / 2} y={y - w * 0.22} width={w} height={w * 0.22} fill={wall} />
          <path d={`M${x - w / 2 - 10} ${y - w * 0.18} Q ${x - w * 0.42} ${y - w * 0.5} ${x} ${y - w * 0.52} Q ${x + w * 0.42} ${y - w * 0.5} ${x + w / 2 + 10} ${y - w * 0.18} Z`} fill={roof} />
          <path d={`M${x - w * 0.42} ${y - w * 0.36} Q ${x} ${y - w * 0.58} ${x + w * 0.42} ${y - w * 0.36}`} stroke={shade(roof, 0.25)} strokeWidth={2} fill="none" />
          <rect x={x - w * 0.08} y={y - w * 0.16} width={w * 0.1} height={w * 0.16} fill={lamp > 0 ? light.fireTint : shade(wall, 0.45)} opacity={lamp > 0 ? lamp : 1} />
        </g>
      ))}
      <Smoke x={1180} y={490} h={90} w={6} light={light.outdoor} />
    </g>
  );
}

/** A low rack of spear blades and axe heads waiting for their shafts. */
function BladeRack({ x, y, w, light }: { x: number; y: number; w: number; light: RoomLight }): ReactElement {
  const steel = lit(light, '#9a9ea2', 0.35);
  const wood = lit(light, '#4a3220', 0.3);
  return (
    <g>
      <rect x={x - w / 2} y={y - 60} width={w} height={14} fill={wood} />
      <rect x={x - w / 2 + 6} y={y - 50} width={10} height={50} fill={shade(wood, 0.3)} />
      <rect x={x + w / 2 - 16} y={y - 50} width={10} height={50} fill={shade(wood, 0.3)} />
      {Array.from({ length: Math.floor(w / 28) }, (_, i) => {
        const bx = x - w / 2 + 18 + i * 28;
        return i % 3 === 2 ? (
          <path key={i} d={`M${bx} ${y - 60} l 0 -22 q 14 -6 16 10 q -8 -2 -16 4 Z`} fill={steel} />
        ) : (
          <path key={i} d={`M${bx - 5} ${y - 60} L${bx - 4} ${y - 86} L${bx} ${y - 110} L${bx + 4} ${y - 86} L${bx + 5} ${y - 60} Z`} fill={steel} stroke={shade(steel, 0.4)} strokeWidth={1} />
        );
      })}
    </g>
  );
}

/** Finished swords and shields on a rack against the right post. */
function ArmsRack({ x, y, light }: { x: number; y: number; light: RoomLight }): ReactElement {
  const steel = lit(light, '#a8acb0', 0.4);
  const wood = lit(light, '#4a3220', 0.3);
  return (
    <g>
      <rect x={x - 70} y={y - 210} width={140} height={10} fill={wood} />
      <rect x={x - 70} y={y - 40} width={140} height={10} fill={wood} />
      {[-48, -20, 8, 36].map((dx, i) => (
        <g key={dx} transform={`rotate(${-6 + i * 3} ${x + dx} ${y})`}>
          <path d={`M${x + dx - 4} ${y - 30} L${x + dx + 4} ${y - 30} L${x + dx + 3} ${y - 236} L${x + dx} ${y - 250} L${x + dx - 3} ${y - 236} Z`} fill={steel} />
          <rect x={x + dx - 12} y={y - 30} width={24} height={6} fill={lit(light, '#c9a04a', 0.4)} />
          <rect x={x + dx - 3} y={y - 24} width={6} height={22} fill={lit(light, '#3a2414', 0.4)} />
        </g>
      ))}
      <Shield x={x - 20} y={y + 30} r={64} colour="#9e2f22" design="quarter" light={light} warm={0.3} />
      <Shield x={x + 46} y={y + 46} r={58} colour="#2f4f7a" design="cross" light={light} warm={0.3} />
    </g>
  );
}

/** The procedural Smithy (1600 × 900). */
export function SmithyPainting({ light, seed }: RoomPaintingProps): ReactElement {
  const uid = useRoomUid();
  const yard = light.winter ? '#b8bec2' : '#4a3e2a';
  return (
    <RoomSvg uid={uid} light={light} sky={{ horizon: HORIZON }} testId="interior-painting-smithy">
      <Landscape uid={uid} light={light} horizon={HORIZON} groundY={GROUND} seed={seed} />
      <Houses light={light} />
      {/* A log fence along the yard's edge. */}
      <g>
        <line x1={-100} y1={GROUND - 40} x2={1700} y2={GROUND - 48} stroke={outside(light, '#4a3622', 0.2)} strokeWidth={8} />
        <line x1={-100} y1={GROUND - 18} x2={1700} y2={GROUND - 24} stroke={outside(light, '#4a3622', 0.2)} strokeWidth={8} />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={i * 150 - 20} y={GROUND - 64} width={10} height={58} fill={outside(light, '#3a2a1a', 0.2)} />
        ))}
      </g>
      {/* The shelter's floor: trodden earth and cinders under the roof. */}
      <Floor y={GROUND} light={light} kind="earth" seed={seed + 5} />
      <rect x={-100} y={GROUND} width={1800} height={36} fill={lit(light, yard, 0.2)} opacity={0.55} />

      {/* Stone footing at the back left, behind the forge. */}
      <rect x={-100} y={420} width={760} height={GROUND - 420} fill={lit(light, '#4e4a44', 0.45)} />
      {Array.from({ length: 5 }, (_, row) => (
        <line key={row} x1={-100} y1={440 + row * 52} x2={660} y2={440 + row * 52} stroke={lit(light, '#2e2c28', 0.4)} strokeWidth={3} />
      ))}
      <Forge uid={uid} x={420} y={GROUND + 70} w={320} h={560} light={light} />
      <Smoke x={420} y={170} h={200} w={22} light={light.outdoor} />

      {/* The overhang, the posts and the tools on the front beam. */}
      <Overhang y={170} light={light} seed={seed} />
      <ToolRack x={760} y={168} w={260} light={light} />
      <Post x={110} top={120} bottom={880} w={64} light={light} warm={0.55} fireSide="right" carved={false} />
      <Post x={1500} top={120} bottom={880} w={64} light={light} warm={0.25} fireSide="left" carved={false} />
      <Beam a={[110, 300]} b={[260, 170]} t={26} light={light} warm={0.5} />
      <Beam a={[1500, 300]} b={[1350, 170]} t={26} light={light} warm={0.2} />
      <ArmsRack x={1370} y={760} light={light} />
      <BladeRack x={1200} y={760} w={230} light={light} />
      <Barrel x={1130} y={880} w={120} h={124} light={light} warm={0.35} water />

      {/* The smith at his anvil. */}
      <Person x={890} y={832} h={470} pose="working" hold="hammer" light={light} warmSide="left" warm={0.8} look={{ tunic: '#5e5040', apron: true, bareArms: true, beard: 'short', hair: '#2e2016', build: 'broad', head: 'band', trim: '#8a3a22', skin: '#c48a64', trousers: '#3e3428' }} />
      <Anvil uid={uid} x={880} y={872} s={232} light={light} hot />
      {/* A spare hammer and a punch lying on the anvil's face. */}
      <g transform="rotate(-8 790 660)">
        <rect x={720} y={656} width={92} height={7} rx={3} fill={lit(light, '#5a3a22', 0.7)} />
        <rect x={804} y={646} width={16} height={26} rx={2} fill={lit(light, '#5a5a5c', 0.8)} />
      </g>
      <rect x={930} y={652} width={40} height={6} rx={2} fill={lit(light, '#6a6a6c', 0.8)} />
      {/* Sparks off the hot iron. */}
      <g className="int-embers">
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx={850 + Math.cos(i * 1.9) * (30 + i * 9)} cy={630 - Math.abs(Math.sin(i * 2.3)) * (20 + i * 7)} r={2 + (i % 3)} fill={mix('#ffd890', '#ff8a30', (i % 4) / 4)} />
        ))}
      </g>
    </RoomSvg>
  );
}

/** The Smithy: its painting and its one person. */
export const smithyRoom: InteriorRoomDef = {
  id: 'smithy',
  titleKey: 'hub.building.smithy.name',
  assetId: 'hub.interior.smithy',
  Painting: SmithyPainting,
  people: [{ id: 'smith', x: 885, y: 880, w: 380, h: 640, nameKey: 'hub.interior.smithy.smith.name', greetingKey: 'hub.interior.smithy.smith.greeting', icon: 'sword' }],
};
