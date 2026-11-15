/**
 * A settlement on its shore, painted for the arrival, visit and aftermath scenes: houses in rows up the
 * slope (their number and look follow the tier and the culture), the hall or keep, a church, temple or
 * warehouses where the tier calls for them, walls by fort tier, the strand with a jetty and moored ships,
 * smoke, lamplight and people; charred and smoking when it was raided, aflame when it has just fallen.
 */
import type { ReactElement } from 'react';
import type { SettlementTierId } from '@content/schemas/ids';
import { Figure, Tree } from './land';
import { Smoke } from './layers';
import { aerial, BONE, INK, mix, rng, shade, type Light } from './paint';
import { SideShip, shipPaint } from './ships';

/** Building styles by culture. */
export type BuildStyle = 'north' | 'west' | 'south' | 'east' | 'sun' | 'steppe';

export function styleOfCulture(culture: string | undefined): BuildStyle {
  switch (culture) {
    case 'albric':
    case 'cael':
      return 'west';
    case 'corvani':
      return 'south';
    case 'velkar':
      return 'east';
    case 'saraleonese':
      return 'sun';
    case 'kurgai':
      return 'steppe';
    default:
      return 'north';
  }
}

interface TierPlan {
  rows: readonly number[];
  width: number;
  hall: 'none' | 'hall' | 'great' | 'keep';
  church: boolean;
  temple: boolean;
  warehouses: number;
  boats: number;
  jetties: number;
  garth: boolean;
}

const PLANS: Readonly<Record<SettlementTierId, TierPlan>> = {
  hamlet: { rows: [3], width: 300, hall: 'none', church: false, temple: false, warehouses: 0, boats: 1, jetties: 1, garth: false },
  village: { rows: [4, 3], width: 470, hall: 'hall', church: false, temple: false, warehouses: 0, boats: 2, jetties: 1, garth: false },
  town: { rows: [6, 5, 3], width: 660, hall: 'hall', church: false, temple: false, warehouses: 1, boats: 3, jetties: 1, garth: false },
  city: { rows: [8, 7, 6], width: 840, hall: 'great', church: true, temple: false, warehouses: 2, boats: 4, jetties: 2, garth: false },
  capital: { rows: [8, 8, 7], width: 880, hall: 'great', church: false, temple: false, warehouses: 2, boats: 5, jetties: 2, garth: false },
  cloister: { rows: [2], width: 440, hall: 'none', church: true, temple: false, warehouses: 0, boats: 1, jetties: 1, garth: true },
  fortress: { rows: [3, 2], width: 540, hall: 'keep', church: false, temple: false, warehouses: 0, boats: 2, jetties: 1, garth: false },
  emporium: { rows: [6, 5, 3], width: 860, hall: 'hall', church: false, temple: false, warehouses: 4, boats: 6, jetties: 3, garth: false },
  templeStead: { rows: [3, 2], width: 540, hall: 'none', church: false, temple: true, warehouses: 0, boats: 1, jetties: 1, garth: false },
};

export function tierPlan(tier: string): TierPlan {
  return (PLANS as Record<string, TierPlan>)[tier] ?? PLANS.village;
}

const STYLE_COLOURS: Readonly<Record<BuildStyle, { wall: string; roof: string; trim: string }>> = {
  north: { wall: '#4d3826', roof: '#353a24', trim: '#6b4b2c' },
  west: { wall: '#a39274', roof: '#8a6a3a', trim: '#5a4630' },
  south: { wall: '#bfae8e', roof: '#8e3f2a', trim: '#7a6a52' },
  east: { wall: '#5e4331', roof: '#3d3229', trim: '#7a5a3a' },
  sun: { wall: '#d6cdb9', roof: '#c9bfa6', trim: '#8a7a62' },
  steppe: { wall: '#b5a588', roof: '#9c8c6e', trim: '#5a4a36' },
};

/** How the hour darkens walls and roofs (lamps take over at night). */
function dusk(light: Light): number {
  return light.tod === 'day' ? 0.05 : light.tod === 'night' ? 0.62 : 0.32;
}

interface HouseProps {
  x: number;
  y: number;
  w: number;
  h: number;
  style: BuildStyle;
  light: Light;
  d: number;
  burnt: boolean;
  lamp: boolean;
  seed: number;
}

/** One house (x: centre, y: ground). */
function House({ x, y, w, h, style, light, d, burnt, lamp, seed }: HouseProps): ReactElement {
  const r = rng(seed);
  const col = STYLE_COLOURS[style];
  const k = dusk(light);
  const wall = aerial(light, shade(mix(col.wall, light.rim, 0.06), k + r() * 0.08), d);
  const roof = aerial(light, shade(col.roof, k + r() * 0.1), d);
  const ink = aerial(light, INK, d);
  const char = aerial(light, '#161210', d * 0.6);
  const glow = lamp && light.lamps > 0 && !burnt ? light.lamps : 0;
  const win = glow > 0 ? <rect x={x - w * 0.08} y={y - h * 0.55} width={w * 0.12} height={h * 0.4} fill="#ffb658" opacity={glow * 0.9} /> : null;
  const sw = Math.max(0.6, w / 60);
  switch (style) {
    case 'steppe':
      return (
        <g>
          <path d={`M${x - w * 0.42} ${y} L${x - w * 0.42} ${y - h * 0.55} Q ${x} ${y - h * 1.5} ${x + w * 0.42} ${y - h * 0.55} L${x + w * 0.42} ${y} Z`} fill={burnt ? char : wall} stroke={ink} strokeWidth={sw} />
          <path d={`M${x - w * 0.42} ${y - h * 0.55} Q ${x} ${y - h * 1.5} ${x + w * 0.42} ${y - h * 0.55}`} stroke={roof} strokeWidth={sw * 3} fill="none" />
          <rect x={x - w * 0.08} y={y - h * 0.45} width={w * 0.16} height={h * 0.45} fill={glow > 0 ? '#ffb658' : ink} opacity={glow > 0 ? glow * 0.85 : 0.7} />
        </g>
      );
    case 'sun':
      return (
        <g>
          <rect x={x - w / 2} y={y - h * 1.1} width={w} height={h * 1.1} fill={burnt ? char : wall} stroke={ink} strokeWidth={sw} />
          <rect x={x - w / 2 - sw} y={y - h * 1.14} width={w + 2 * sw} height={h * 0.08} fill={shade(wall, 0.15)} />
          {r() < 0.3 && !burnt && <path d={`M${x - w * 0.22} ${y - h * 1.1} A ${w * 0.22} ${w * 0.22} 0 0 1 ${x + w * 0.22} ${y - h * 1.1} Z`} fill={roof} stroke={ink} strokeWidth={sw} />}
          <path d={`M${x - w * 0.1} ${y} L${x - w * 0.1} ${y - h * 0.4} A ${w * 0.1} ${w * 0.1} 0 0 1 ${x + w * 0.1} ${y - h * 0.4} L${x + w * 0.1} ${y} Z`} fill={glow > 0 ? '#ffb658' : shade(wall, 0.5)} opacity={glow > 0 ? glow * 0.85 : 1} />
          <rect x={x + w * 0.22} y={y - h * 0.85} width={w * 0.1} height={h * 0.18} fill={glow > 0 ? '#ffb658' : shade(wall, 0.55)} opacity={glow > 0 ? glow * 0.7 : 1} />
        </g>
      );
    default: {
      // Pitched roofs: north (low, bowed turf), west (steep thatch), south (low tiles), east (steep timber).
      const roofH = style === 'west' ? h * 1.25 : style === 'east' ? h * 1.4 : style === 'south' ? h * 0.55 : h * 0.95;
      const wallH = style === 'north' ? h * 0.55 : h;
      const top = y - wallH;
      const eave = w * (style === 'south' ? 0.56 : 0.54);
      const roofPath =
        style === 'north'
          ? `M${x - eave} ${top + 2} Q ${x - w * 0.2} ${top - roofH * 1.15} ${x} ${top - roofH} Q ${x + w * 0.2} ${top - roofH * 1.15} ${x + eave} ${top + 2} Z`
          : `M${x - eave} ${top + 2} L${x - w * 0.12} ${top - roofH} L${x + w * 0.12} ${top - roofH} L${x + eave} ${top + 2} Z`;
      return (
        <g>
          <rect x={x - w / 2} y={top} width={w} height={wallH} fill={burnt ? char : wall} stroke={ink} strokeWidth={sw} />
          {burnt ? (
            <g stroke={char} strokeWidth={sw * 2}>
              <line x1={x - eave * 0.8} y1={top} x2={x - w * 0.1} y2={top - roofH * 0.8} />
              <line x1={x + eave * 0.6} y1={top} x2={x + w * 0.05} y2={top - roofH * 0.6} />
              <line x1={x - w * 0.3} y1={top - roofH * 0.4} x2={x + w * 0.25} y2={top - roofH * 0.45} />
            </g>
          ) : (
            <path d={roofPath} fill={roof} stroke={ink} strokeWidth={sw} />
          )}
          {!burnt && <path d={roofPath} fill="none" stroke={aerial(light, light.rim, d)} strokeWidth={sw} opacity={0.18} />}
          {style === 'north' && !burnt && (
            <g stroke={ink} strokeWidth={sw * 1.2}>
              <line x1={x - eave * 0.96} y1={top} x2={x - eave * 1.08} y2={top - h * 0.3} />
              <line x1={x + eave * 0.96} y1={top} x2={x + eave * 1.08} y2={top - h * 0.3} />
            </g>
          )}
          <rect x={x - w * 0.08} y={y - wallH * 0.8} width={w * 0.16} height={wallH * 0.8} fill={glow > 0 ? '#ffb658' : shade(wall, 0.55)} opacity={glow > 0 ? glow * 0.85 : 1} />
          {style !== 'north' && win}
        </g>
      );
    }
  }
}

/** The hall, great hall or keep at the heart of the place, flying its lord's banner. */
function Hall({ x, y, s, kind, style, light, d, burnt, colour }: { x: number; y: number; s: number; kind: 'hall' | 'great' | 'keep'; style: BuildStyle; light: Light; d: number; burnt: boolean; colour: string }): ReactElement {
  const k = dusk(light);
  const col = STYLE_COLOURS[style];
  const ink = aerial(light, INK, d);
  const char = aerial(light, '#161210', d * 0.6);
  const lamp = light.lamps > 0 && !burnt;
  const banner = (bx: number, by: number, h: number) => (
    <g>
      <line x1={bx} y1={by} x2={bx} y2={by - h} stroke={ink} strokeWidth={2 * s} />
      {!burnt && <path className="scn-flag" d={`M${bx} ${by - h} L${bx + h * 0.5} ${by - h + h * 0.08} L${bx + h * 0.36} ${by - h + h * 0.2} L${bx + h * 0.5} ${by - h + h * 0.32} L${bx} ${by - h + h * 0.34} Z`} fill={aerial(light, colour, d)} />}
    </g>
  );
  if (style === 'sun' && kind !== 'keep') {
    // A whitewashed hall under a dome, arcades along its front.
    const wall = aerial(light, shade(mix('#ddd4c0', light.rim, 0.1), k), d);
    const dome = aerial(light, shade('#c8b48a', k), d);
    const w = (kind === 'great' ? 200 : 150) * s;
    const h = 56 * s;
    return (
      <g>
        <rect x={x - w / 2} y={y - h} width={w} height={h} fill={burnt ? char : wall} stroke={ink} strokeWidth={1.4 * s} />
        {!burnt && <path d={`M${x - w * 0.24} ${y - h} A ${w * 0.24} ${w * 0.26} 0 0 1 ${x + w * 0.24} ${y - h} Z`} fill={dome} stroke={ink} strokeWidth={1.4 * s} />}
        {!burnt && <line x1={x} y1={y - h - w * 0.26} x2={x} y2={y - h - w * 0.34} stroke={ink} strokeWidth={2 * s} />}
        {Array.from({ length: 5 }, (_, i) => (
          <path key={i} d={`M${x - w * 0.4 + i * w * 0.2 - 8 * s} ${y} l 0 ${-22 * s} a ${8 * s} ${8 * s} 0 0 1 ${16 * s} 0 l 0 ${22 * s} Z`} fill={lamp ? '#ffb658' : shade(wall, 0.5)} opacity={lamp ? light.lamps * 0.85 : 1} />
        ))}
        {banner(x + w * 0.42, y - h, 44 * s)}
      </g>
    );
  }
  if (style === 'steppe' && kind !== 'keep') {
    // The chief's great tent, its door flap open.
    const felt = aerial(light, shade('#c2b08c', k), d);
    const w = 150 * s;
    return (
      <g>
        <path d={`M${x - w / 2} ${y} L${x - w / 2} ${y - 40 * s} Q ${x} ${y - 120 * s} ${x + w / 2} ${y - 40 * s} L${x + w / 2} ${y} Z`} fill={burnt ? char : felt} stroke={ink} strokeWidth={1.4 * s} />
        <path d={`M${x - w / 2} ${y - 40 * s} Q ${x} ${y - 120 * s} ${x + w / 2} ${y - 40 * s}`} fill="none" stroke={aerial(light, '#7a3a2a', d)} strokeWidth={5 * s} />
        <rect x={x - 12 * s} y={y - 34 * s} width={24 * s} height={34 * s} fill={lamp ? '#ffb658' : ink} opacity={lamp ? light.lamps : 0.8} />
        {banner(x, y - 80 * s, 50 * s)}
      </g>
    );
  }
  if (kind === 'keep' || (style === 'south' && kind === 'great')) {
    const stone = aerial(light, shade(mix('#8d867a', light.rim, 0.1), k), d);
    const w = 70 * s;
    const h = 150 * s;
    const merl = [];
    for (let i = 0; i < 5; i++) merl.push(<rect key={i} x={x - w / 2 + i * (w / 4.5)} y={y - h - 10 * s} width={w / 9} height={10 * s} fill={burnt ? char : stone} />);
    return (
      <g>
        <rect x={x - w / 2} y={y - h} width={w} height={h} fill={burnt ? char : stone} stroke={ink} strokeWidth={1.4 * s} />
        {merl}
        <rect x={x - w * 0.1} y={y - h * 0.62} width={w * 0.12} height={h * 0.12} fill={lamp ? '#ffb658' : shade(stone, 0.6)} opacity={lamp ? light.lamps * 0.9 : 1} />
        <rect x={x + w * 0.18} y={y - h * 0.4} width={w * 0.1} height={h * 0.1} fill={lamp ? '#ffb658' : shade(stone, 0.6)} opacity={lamp ? light.lamps * 0.8 : 1} />
        {banner(x, y - h - 10 * s, 50 * s)}
      </g>
    );
  }
  const big = kind === 'great' ? 1.35 : 1;
  const w = 170 * s * big;
  const wallH = (style === 'north' ? 34 : 46) * s * big;
  const roofH = (style === 'north' ? 56 : 64) * s * big;
  const wall = aerial(light, shade(mix(col.wall, light.rim, 0.08), k), d);
  const roof = aerial(light, shade(col.roof, k + 0.05), d);
  const top = y - wallH;
  return (
    <g>
      <rect x={x - w / 2} y={top} width={w} height={wallH} fill={burnt ? char : wall} stroke={ink} strokeWidth={1.4 * s} />
      {!burnt && (
        <g stroke={aerial(light, shade(col.trim, k), d)} strokeWidth={2 * s} opacity={0.7}>
          {Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1={x - w / 2 + (i + 1) * (w / 10)} y1={top + 2} x2={x - w / 2 + (i + 1) * (w / 10)} y2={y} />
          ))}
        </g>
      )}
      {burnt ? (
        <g stroke={char} strokeWidth={3 * s}>
          <line x1={x - w * 0.5} y1={top} x2={x - w * 0.15} y2={top - roofH * 0.8} />
          <line x1={x + w * 0.45} y1={top} x2={x + w * 0.1} y2={top - roofH * 0.7} />
          <line x1={x - w * 0.3} y1={top - roofH * 0.35} x2={x + w * 0.3} y2={top - roofH * 0.4} />
        </g>
      ) : (
        <path d={`M${x - w * 0.56} ${top + 3} Q ${x - w * 0.25} ${top - roofH * 1.1} ${x} ${top - roofH} Q ${x + w * 0.25} ${top - roofH * 1.1} ${x + w * 0.56} ${top + 3} Z`} fill={roof} stroke={ink} strokeWidth={1.4 * s} />
      )}
      {!burnt && style === 'north' && (
        <g stroke={ink} strokeWidth={4 * s} strokeLinecap="round" fill="none">
          <path d={`M${x - w * 0.53} ${top} q ${-10 * s} ${-26 * s} ${6 * s} ${-36 * s}`} />
          <path d={`M${x + w * 0.53} ${top} q ${10 * s} ${-26 * s} ${-6 * s} ${-36 * s}`} />
        </g>
      )}
      <rect x={x - 12 * s} y={y - wallH * 0.82} width={24 * s} height={wallH * 0.82} fill={lamp ? '#ffb658' : shade(wall, 0.6)} opacity={lamp ? light.lamps : 1} />
      {banner(x + w * 0.38, top - roofH * 0.55, 46 * s)}
    </g>
  );
}

/** A stone church with a lantern-cage on its tower (the Lantern faith), or a tiered timber temple (the old ways). */
function HolyHouse({ x, y, s, kind, light, d, burnt }: { x: number; y: number; s: number; kind: 'church' | 'temple'; light: Light; d: number; burnt: boolean }): ReactElement {
  const k = dusk(light);
  const ink = aerial(light, INK, d);
  const char = aerial(light, '#161210', d * 0.6);
  const lamp = light.lamps > 0 && !burnt;
  if (kind === 'church') {
    const stone = aerial(light, shade(mix('#a59c8a', light.rim, 0.12), k), d);
    const roof = aerial(light, shade('#4a4038', k), d);
    return (
      <g>
        <rect x={x - 70 * s} y={y - 54 * s} width={110 * s} height={54 * s} fill={burnt ? char : stone} stroke={ink} strokeWidth={1.4 * s} />
        {!burnt && <path d={`M${x - 76 * s} ${y - 52 * s} L${x - 15 * s} ${y - 92 * s} L${x + 46 * s} ${y - 52 * s} Z`} fill={roof} stroke={ink} strokeWidth={1.4 * s} />}
        <rect x={x + 30 * s} y={y - 130 * s} width={40 * s} height={130 * s} fill={burnt ? char : stone} stroke={ink} strokeWidth={1.4 * s} />
        {/* The lantern-cage on the tower. */}
        <rect x={x + 36 * s} y={y - 156 * s} width={28 * s} height={26 * s} fill="none" stroke={ink} strokeWidth={2 * s} />
        <path d={`M${x + 32 * s} ${y - 156 * s} L${x + 50 * s} ${y - 176 * s} L${x + 68 * s} ${y - 156 * s} Z`} fill={burnt ? char : roof} stroke={ink} strokeWidth={1.4 * s} />
        <circle className={lamp ? 'scn-flicker' : undefined} cx={x + 50 * s} cy={y - 143 * s} r={7 * s} fill={lamp ? '#ffd27a' : aerial(light, '#c9a24a', d)} opacity={lamp ? 0.95 : 0.6} />
        {lamp && <circle cx={x + 50 * s} cy={y - 143 * s} r={30 * s} fill="rgba(255,190,100,0.22)" />}
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${x - 58 * s + i * 30 * s} ${y - 18 * s} l 0 ${-20 * s} a ${6 * s} ${6 * s} 0 0 1 ${12 * s} 0 l 0 ${20 * s} Z`} fill={lamp ? '#ffb658' : shade(stone, 0.55)} opacity={lamp ? light.lamps * 0.75 : 1} />
        ))}
      </g>
    );
  }
  const wood = aerial(light, shade('#4a3220', k), d);
  const roof = aerial(light, shade('#2b2018', k), d);
  const tiers = [0, 1, 2];
  return (
    <g>
      <rect x={x - 46 * s} y={y - 40 * s} width={92 * s} height={40 * s} fill={burnt ? char : wood} stroke={ink} strokeWidth={1.4 * s} />
      {!burnt &&
        tiers.map((i) => {
          const ww = (110 - i * 30) * s;
          const yy = y - 40 * s - i * 34 * s;
          return (
            <g key={i}>
              <path d={`M${x - ww / 2} ${yy} L${x - ww * 0.28} ${yy - 26 * s} L${x + ww * 0.28} ${yy - 26 * s} L${x + ww / 2} ${yy} Z`} fill={roof} stroke={ink} strokeWidth={1.2 * s} />
              {i < 2 && <rect x={x - ww * 0.3} y={yy - 34 * s} width={ww * 0.6} height={10 * s} fill={wood} />}
              <path d={`M${x - ww / 2} ${yy} q ${-8 * s} ${-4 * s} ${-6 * s} ${-14 * s}`} stroke={ink} strokeWidth={2.5 * s} fill="none" />
              <path d={`M${x + ww / 2} ${yy} q ${8 * s} ${-4 * s} ${6 * s} ${-14 * s}`} stroke={ink} strokeWidth={2.5 * s} fill="none" />
            </g>
          );
        })}
      {!burnt && <line x1={x} y1={y - 128 * s} x2={x} y2={y - 150 * s} stroke={ink} strokeWidth={3 * s} />}
      <rect x={x - 9 * s} y={y - 30 * s} width={18 * s} height={30 * s} fill={lamp ? '#ffb658' : shade(wood, 0.6)} opacity={lamp ? light.lamps : 1} />
    </g>
  );
}

/** Long low warehouses along the strand. */
function Warehouse({ x, y, s, light, d, burnt }: { x: number; y: number; s: number; light: Light; d: number; burnt: boolean }): ReactElement {
  const k = dusk(light);
  const wall = aerial(light, shade('#5a4430', k), d);
  const roof = aerial(light, shade('#3a3026', k), d);
  const ink = aerial(light, INK, d);
  return (
    <g>
      <rect x={x - 60 * s} y={y - 22 * s} width={120 * s} height={22 * s} fill={burnt ? aerial(light, '#161210', d) : wall} stroke={ink} strokeWidth={s} />
      {!burnt && <path d={`M${x - 64 * s} ${y - 20 * s} L${x - 50 * s} ${y - 40 * s} L${x + 50 * s} ${y - 40 * s} L${x + 64 * s} ${y - 20 * s} Z`} fill={roof} stroke={ink} strokeWidth={s} />}
      <rect x={x - 12 * s} y={y - 16 * s} width={24 * s} height={16 * s} fill={shade(wall, 0.6)} />
      <rect x={x + 34 * s} y={y - 8 * s} width={10 * s} height={8 * s} rx={2 * s} fill={aerial(light, '#7d5f38', d)} />
      <rect x={x + 22 * s} y={y - 8 * s} width={10 * s} height={8 * s} rx={2 * s} fill={aerial(light, '#6b4b2c', d)} />
    </g>
  );
}

/** Walls by fort tier: 1 palisade, 2 palisade on a bank with gate towers, 3 stone, 4 stone with towers. */
function Walls({ x0, x1, y: groundY, s, fortTier, light, d, gapX, burnt }: { x0: number; x1: number; y: number; s: number; fortTier: number; light: Light; d: number; gapX: number; burnt: boolean }): ReactElement | null {
  if (fortTier <= 0) return null;
  let y = groundY;
  const k = dusk(light);
  const ink = aerial(light, INK, d);
  const gap = 34 * s;
  const parts: ReactElement[] = [];
  if (fortTier <= 3) {
    // 1 palisade; 2 ditch and rampart with gate towers; 3 a ring-fort: a high earth bank, stakes and towers.
    const wood = aerial(light, shade('#3d2a1a', k), d);
    const h = (fortTier === 1 ? 26 : fortTier === 2 ? 32 : 36) * s;
    const bank = fortTier === 3 ? 18 * s : fortTier === 2 ? 8 * s : 0;
    if (bank > 0) parts.push(<path key="bank" d={`M${x0 - 30 * s} ${y + 12 * s} C ${x0} ${y - bank}, ${x1} ${y - bank}, ${x1 + 30 * s} ${y + 12 * s} Z`} fill={aerial(light, shade(light.snow ? '#9aa0a2' : '#3f3b26', k), d)} stroke={aerial(light, INK, d)} strokeWidth={0.8 * s} />);
    y -= bank * 0.7;
    const stakes: string[] = [];
    for (let px = x0; px <= x1; px += 7 * s) {
      if (Math.abs(px - gapX) < gap) continue;
      const broken = burnt && rng(Math.round(px))() < 0.25;
      const top = y - (broken ? h * 0.5 : h);
      stakes.push(`M${px.toFixed(1)} ${y} L${px.toFixed(1)} ${top.toFixed(1)} L${(px + 3 * s).toFixed(1)} ${(top - 5 * s).toFixed(1)} L${(px + 6 * s).toFixed(1)} ${top.toFixed(1)} L${(px + 6 * s).toFixed(1)} ${y}`);
    }
    parts.push(<path key="stakes" d={stakes.join(' ')} fill={wood} stroke={ink} strokeWidth={0.8 * s} />);
    if (fortTier >= 2) {
      const towers = fortTier === 3 ? [x0 + 30 * s, gapX - gap - 10 * s, gapX + gap + 4 * s, x1 - 40 * s] : [gapX - gap - 10 * s, gapX + gap + 4 * s];
      for (const tx of towers) {
        parts.push(<rect key={`t${tx}`} x={tx - 8 * s} y={y - h - 22 * s} width={22 * s} height={h + 22 * s} fill={wood} stroke={ink} strokeWidth={s} />);
        parts.push(<path key={`r${tx}`} d={`M${tx - 12 * s} ${y - h - 22 * s} L${tx + 3 * s} ${y - h - 38 * s} L${tx + 18 * s} ${y - h - 22 * s} Z`} fill={aerial(light, shade('#2b2018', k), d)} stroke={ink} strokeWidth={s} />);
      }
    }
  } else {
    const stone = aerial(light, shade(mix('#8a8276', light.rim, 0.1), k), d);
    const h = (fortTier === 4 ? 48 : 38) * s;
    const seg = (a: number, b: number, key: string) => {
      const merl: ReactElement[] = [];
      for (let mx = a; mx < b - 6 * s; mx += 14 * s) merl.push(<rect key={mx} x={mx} y={y - h - 8 * s} width={7 * s} height={8 * s} fill={stone} />);
      return (
        <g key={key}>
          <rect x={a} y={y - h} width={b - a} height={h} fill={stone} stroke={ink} strokeWidth={s} />
          {merl}
        </g>
      );
    };
    parts.push(seg(x0, gapX - gap, 'wl'));
    parts.push(seg(gapX + gap, x1, 'wr'));
    parts.push(<path key="gate" d={`M${gapX - gap} ${y} L${gapX - gap} ${y - h * 0.7} A ${gap} ${gap} 0 0 1 ${gapX + gap} ${y - h * 0.7} L${gapX + gap} ${y}`} fill="none" stroke={stone} strokeWidth={6 * s} />);
    if (fortTier === 4) {
      const n = Math.max(2, Math.round((x1 - x0) / (170 * s)));
      for (let i = 0; i <= n; i++) {
        const tx = x0 + (i * (x1 - x0)) / n;
        if (Math.abs(tx - gapX) < gap + 20 * s) continue;
        parts.push(<rect key={`T${i}`} x={tx - 16 * s} y={y - h - 34 * s} width={32 * s} height={h + 34 * s} fill={stone} stroke={ink} strokeWidth={s} />);
        parts.push(<path key={`Tr${i}`} d={`M${tx - 20 * s} ${y - h - 34 * s} L${tx} ${y - h - 62 * s} L${tx + 20 * s} ${y - h - 34 * s} Z`} fill={aerial(light, shade('#3a3028', k), d)} stroke={ink} strokeWidth={s} />);
      }
    }
  }
  return <g>{parts}</g>;
}

export interface SettlementViewProps {
  light: Light;
  tier: string;
  fortTier: number;
  style: BuildStyle;
  /** The church tower for Lantern lands. */
  lantern: boolean;
  seed: number;
  /** Centre of the place and the strand line it stands on. */
  cx: number;
  baseY: number;
  /** Scale (1: seen from the sea; larger from the quay). */
  s: number;
  /** Distance for atmospheric fade (0 near … 1 far). */
  d: number;
  /** Lord's banner colour. */
  colour: string;
  raided: boolean;
  burning: boolean;
  /** The strand, jetties and moored ships (coastal places). */
  harbour: boolean;
  people: boolean;
  /** Draw the near strand and jetty (false when the quay foreground covers them). */
  strand?: boolean;
}

/** The settlement (see the file header). */
export function SettlementView(p: SettlementViewProps): ReactElement {
  const { light, s, d, cx, baseY } = p;
  const plan = tierPlan(p.tier);
  const r = rng(p.seed);
  const burnt = p.raided || p.burning;
  const W = plan.width * s;
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const back: ReactElement[] = [];
  const smoke: ReactElement[] = [];
  const fires: ReactElement[] = [];
  // Ground the place sits on: a low rise above the strand.
  const ground = light.snow ? mix(light.mid, '#c9ced2', 0.35) : mix(light.mid, '#3a3a24', 0.4);
  back.push(<path key="rise" d={`M${x0 - 260 * s} ${baseY + 4} C ${x0} ${baseY - 50 * s}, ${cx - 100 * s} ${baseY - 120 * s}, ${cx + 40 * s} ${baseY - 118 * s} C ${x1 - 40 * s} ${baseY - 110 * s}, ${x1 + 120 * s} ${baseY - 40 * s}, ${x1 + 300 * s} ${baseY + 4} Z`} fill={aerial(light, ground, d + 0.1)} />);
  // Trees on the rise around the place (fewer around big ones); none on the steppe.
  if (p.style !== 'steppe') {
    const n = plan.rows.reduce((a, b) => a + b, 0) > 12 ? 4 : 9;
    const treeCol = aerial(light, shade(mix('#24301e', light.mid, 0.35), dusk(light) * 0.6), d + 0.12);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tx = side < 0 ? x0 - r() * 220 * s : x1 + r() * 220 * s;
      const ty = baseY - (20 + r() * 70) * s;
      const th = (40 + r() * 34) * s;
      if (p.style === 'sun' || p.style === 'south') back.push(<ellipse key={`tr${i}`} cx={tx} cy={ty - th * 0.5} rx={th * 0.12} ry={th * 0.5} fill={treeCol} />);
      else back.push(<Tree key={`tr${i}`} x={tx} y={ty} h={th} colour={treeCol} kind={r() < 0.3 ? 'oak' : 'pine'} />);
    }
  }
  // House rows, back to front.
  const rows = plan.rows;
  const wallLift = p.fortTier <= 0 ? 0 : p.fortTier === 1 ? 16 : p.fortTier === 2 ? 22 : 30;
  const special = plan.hall !== 'none' || plan.church || plan.temple;
  for (let ri = rows.length - 1; ri >= 0; ri--) {
    const n = rows[ri] ?? 0;
    // Rows climb the slope; walls push them further up so the wall never hides the first row.
    const ry = baseY - (ri * 44 + 10 + wallLift) * s;
    const rs = s * (1 - ri * 0.1);
    const rd = d + ri * 0.08;
    const rw = W * (1 - ri * 0.12);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      let hx = cx - rw / 2 + u * rw + (r() - 0.5) * 18 * s;
      // Leave room for the hall (row 1, or row 0 in a one-row place).
      if (special && ri === Math.min(1, rows.length - 1) && Math.abs(hx - cx) < 100 * s) hx += hx < cx ? -60 * s : 60 * s;
      const w = (44 + r() * 26) * rs;
      const h = (20 + r() * 8) * rs;
      const seed = Math.floor(r() * 1e9);
      const isBurnt = burnt && r() < (p.burning ? 0.8 : 0.6);
      back.push(<House key={`h${ri}-${i}`} x={hx} y={ry} w={w} h={h} style={p.style} light={light} d={rd} burnt={isBurnt} lamp={r() < 0.6} seed={seed} />);
      if (!burnt && r() < 0.35) smoke.push(<Smoke key={`sm${ri}-${i}`} x={hx + w * 0.1} y={ry - h * 1.6} h={70 * rs + r() * 50 * rs} w={6 * rs} light={light} delay={r() * 6} />);
      if (isBurnt && r() < 0.7) smoke.push(<Smoke key={`ds${ri}-${i}`} x={hx} y={ry - h} h={160 * rs + r() * 120 * rs} w={11 * rs} dark light={light} delay={r() * 6} />);
      if (p.burning && isBurnt && r() < 0.6) fires.push(<ellipse key={`f${ri}-${i}`} className="scn-fire" cx={hx} cy={ry - h} rx={w * 0.7} ry={h * 1.3} fill="rgba(255,140,50,0.55)" style={{ animationDelay: `${r()}s` }} />);
      if (p.raided && isBurnt && !p.burning && r() < 0.4) fires.push(<circle key={`e${ri}-${i}`} className="scn-flicker" cx={hx} cy={ry - 3 * rs} r={4 * rs} fill="#ff7a2a" opacity={0.7} />);
    }
    // The hall, keep, church or temple stands in the second row (or the only row).
    if (ri === Math.min(1, rows.length - 1)) {
      if (plan.hall !== 'none') back.push(<Hall key="hall" x={cx} y={ry} s={rs * (plan.hall === 'keep' ? 1.1 : 1)} kind={plan.hall === 'keep' ? 'keep' : plan.hall === 'great' ? 'great' : 'hall'} style={p.style} light={light} d={rd} burnt={p.burning} colour={p.colour} />);
      if (plan.church || (p.lantern && (p.tier === 'city' || p.tier === 'capital' || p.tier === 'town')))
        back.push(<HolyHouse key="church" x={plan.hall === 'none' ? cx : cx + W * 0.3} y={ry} s={rs * (plan.hall === 'none' ? 1.25 : 0.9)} kind="church" light={light} d={rd} burnt={p.burning} />);
      if (plan.temple) back.push(<HolyHouse key="temple" x={cx} y={ry} s={rs * 1.35} kind="temple" light={light} d={rd} burnt={p.burning} />);
    }
  }
  // A cloister's garth wall; a temple's grove.
  if (plan.garth) back.push(<path key="garth" d={`M${cx - 150 * s} ${baseY} L${cx - 150 * s} ${baseY - 16 * s} L${cx + 150 * s} ${baseY - 16 * s} L${cx + 150 * s} ${baseY}`} fill="none" stroke={aerial(light, shade('#8a8276', dusk(light)), d)} strokeWidth={6 * s} />);
  // Walls, then warehouses along the strand.
  const gapX = cx + (r() - 0.5) * 40 * s;
  const walls = <Walls key="walls" x0={x0 - 20 * s} x1={x1 + 20 * s} y={baseY + 4 * s} s={s} fortTier={p.fortTier} light={light} d={d} gapX={gapX} burnt={p.raided} />;
  const sheds: ReactElement[] = [];
  for (let i = 0; i < plan.warehouses; i++) sheds.push(<Warehouse key={`w${i}`} x={x0 + W * (0.15 + (i * 0.7) / Math.max(1, plan.warehouses - 1 || 1))} y={baseY + 22 * s} s={s * 0.9} light={light} d={d} burnt={p.burning} />);
  // Strand, jetties and moored ships.
  const harbour: ReactElement[] = [];
  if (p.harbour && p.strand !== false) {
    const sand = light.snow ? '#d8dcdc' : mix('#8a7a5a', light.sky[3], 0.15);
    harbour.push(<path key="strand" d={`M${x0 - 300 * s} ${baseY + 10 * s} C ${x0} ${baseY + 2 * s}, ${x1} ${baseY + 4 * s}, ${x1 + 320 * s} ${baseY + 12 * s} L${x1 + 320 * s} ${baseY + 30 * s} C ${x1} ${baseY + 34 * s}, ${x0} ${baseY + 30 * s}, ${x0 - 300 * s} ${baseY + 28 * s} Z`} fill={aerial(light, shade(sand, dusk(light) * 0.8), d)} />);
    const ships = p.raided ? Math.max(0, plan.boats - 2) : plan.boats;
    for (let j = 0; j < plan.jetties; j++) {
      const jx = cx + (j - (plan.jetties - 1) / 2) * 220 * s + 90 * s;
      const jy = baseY + 22 * s;
      const len = 70 * s;
      harbour.push(<path key={`j${j}`} d={`M${jx - 8 * s} ${jy} L${jx + 8 * s} ${jy} L${jx + 18 * s} ${jy + len} L${jx - 18 * s} ${jy + len} Z`} fill={aerial(light, shade('#5c4329', dusk(light)), d)} stroke={aerial(light, INK, d)} strokeWidth={s} />);
      for (let pi = 0; pi < 4; pi++) harbour.push(<line key={`p${j}-${pi}`} x1={jx - 12 * s - pi * 2 * s} y1={jy + (pi + 1) * len * 0.22} x2={jx - 12 * s - pi * 2 * s} y2={jy + (pi + 1) * len * 0.22 + 10 * s} stroke={aerial(light, INK, d)} strokeWidth={2 * s} />);
    }
    for (let b = 0; b < ships; b++) {
      const side = b % 2 === 0 ? -1 : 1;
      const bx = cx + 90 * s + side * (60 + Math.floor(b / 2) * 120) * s + (r() - 0.5) * 20 * s;
      const by = baseY + (44 + (b % 3) * 12) * s;
      harbour.push(<SideShip key={`b${b}`} x={bx} y={by} L={(80 + r() * 40) * s} type={r() < 0.5 ? 'knarr' : 'karvi'} paint={shipPaint(r() < 0.5 ? p.colour : undefined)} light={light} distance={d} facing={side < 0 ? 1 : -1} furled lit={light.lamps > 0.5 && !p.raided} bob={r() * 4} />);
    }
  }
  // People on the strand (not where it burned).
  const folk: ReactElement[] = [];
  if (p.people && !burnt) {
    const n = Math.min(10, 2 + rows.reduce((a, b) => a + b, 0) / 3);
    const coats = ['#6b4b2c', '#4a5a6a', '#7a3a2a', '#5a5a3a', BONE];
    for (let i = 0; i < n; i++) {
      folk.push(<Figure key={`f${i}`} x={x0 + r() * W} y={baseY + (14 + r() * 10) * s} h={(18 + r() * 4) * s} colour={shade(coats[i % coats.length] ?? BONE, dusk(light) * 0.9)} gear="none" light={light} distance={d} flip={r() < 0.5} />);
    }
  }
  return (
    <g data-tier={p.tier}>
      {back}
      {smoke}
      {fires}
      {walls}
      {sheds}
      {harbour}
      {folk}
    </g>
  );
}
