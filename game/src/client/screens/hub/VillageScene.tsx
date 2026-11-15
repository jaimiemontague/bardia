/**
 * The home village at dusk (procedural SVG). Every building is drawn at its entry in the VILLAGE layout table
 * (village.ts), at its tier from `capital.buildings` (tier 0: an empty staked plot), and the player's ships
 * lie on the strand below the shipyard (count and types from state). Purely decorative for assistive tech:
 * the hotspot buttons drawn over it by the hub are the accessible controls. Clicking a building also opens it.
 */
import { memo, type ReactElement } from 'react';
import type { ShipTypeId } from '@sim/core/state';
import { SHIP_SLOTS, VIEW_H, VIEW_W, VILLAGE, type HallBuildingId, type HallSpot } from './village';

const WOOD = '#3d2a1a';
const WOOD_DARK = '#2a1c12';
const ROOF = '#24170e';
const TURF = '#3b3a22';
const GLOW = '#f0a04a';
const INK = '#0f0b08';

interface DrawProps {
  x: number;
  y: number;
  /** Scale (1 at tier 1). */
  s: number;
  tier: number;
}

/** A warm window or door light. */
function Light({
  x,
  y,
  w,
  h,
  o = 0.7,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  o?: number;
}): ReactElement {
  return <rect x={x} y={y} width={w} height={h} fill={GLOW} opacity={o} rx={Math.min(w, h) * 0.2} />;
}

/** A rising smoke wisp from (x, y). */
function Smoke({ x, y, h, w = 10 }: { x: number; y: number; h: number; w?: number }): ReactElement {
  return (
    <path
      className="hv-smoke"
      d={`M${x} ${y} C ${x - 12} ${y - h * 0.3}, ${x + 18} ${y - h * 0.55}, ${x + 4} ${y - h * 0.75} S ${x + 22} ${y - h}, ${x + 10} ${y - h * 1.15}`}
      stroke="#b8aca0"
      strokeWidth={w}
      strokeLinecap="round"
      fill="none"
      opacity="0.18"
      filter="url(#hv-blur)"
    />
  );
}

/** A ground pool of light in front of a door. */
function Pool({ x, y, r }: { x: number; y: number; r: number }): ReactElement {
  return <ellipse cx={x} cy={y} rx={r} ry={r * 0.28} fill="url(#hv-pool)" />;
}

function Banner({ x, y, h, colour }: { x: number; y: number; h: number; colour: string }): ReactElement {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - h} stroke={INK} strokeWidth="4" />
      <path
        d={`M${x} ${y - h} L${x + h * 0.42} ${y - h + h * 0.1} L${x + h * 0.3} ${y - h + h * 0.2} L${x + h * 0.42} ${y - h + h * 0.3} L${x} ${y - h + h * 0.32} Z`}
        fill={colour}
      />
    </g>
  );
}

function GreatHall({ x, y, s, tier }: DrawProps): ReactElement {
  const W = 170 * s;
  const H = 100 * s;
  const top = y - H;
  const planks = [];
  for (let px = x - W + 16 * s; px < x + W; px += 18 * s)
    planks.push(
      <line key={px} x1={px} y1={top + 4} x2={px} y2={y} stroke={WOOD_DARK} strokeWidth={2} opacity="0.55" />,
    );
  return (
    <g>
      <Pool x={x} y={y + 6} r={150 * s} />
      <path d={`M${x - W} ${y} L${x - W} ${top} L${x + W} ${top} L${x + W} ${y} Z`} fill={WOOD} />
      {planks}
      {/* Bowed roof with shingle rows and crossed gable boards. */}
      <path
        d={`M${x - W - 36 * s} ${top + 10 * s} L${x - W + 4 * s} ${top - 86 * s} Q ${x} ${top - 112 * s} ${x + W - 4 * s} ${top - 86 * s} L${x + W + 36 * s} ${top + 10 * s} Z`}
        fill={ROOF}
      />
      {[0.3, 0.55, 0.8].map((f) => (
        <path
          key={f}
          d={`M${x - W - 36 * s + 40 * s * f} ${top + 10 * s - 96 * s * f} Q ${x} ${top + 10 * s - 122 * s * f} ${x + W + 36 * s - 40 * s * f} ${top + 10 * s - 96 * s * f}`}
          stroke="#3a2617"
          strokeWidth={3}
          fill="none"
        />
      ))}
      {[-1, 1].map((d) => (
        <g key={d} stroke={ROOF} strokeWidth={7 * s} strokeLinecap="round" fill="none">
          <path
            d={`M${x + d * (W - 4 * s)} ${top - 86 * s} q ${d * 18 * s} ${-26 * s} ${d * 8 * s} ${-44 * s} q ${-d * 6 * s} ${-8 * s} ${-d * 14 * s} ${-2 * s}`}
          />
          <path
            d={`M${x + d * (W - 24 * s)} ${top - 84 * s} q ${d * 4 * s} ${-26 * s} ${-d * 12 * s} ${-40 * s}`}
          />
        </g>
      ))}
      {/* Doors and windows. */}
      <path
        d={`M${x - 30 * s} ${y} L${x - 30 * s} ${y - 58 * s} Q ${x} ${y - 82 * s} ${x + 30 * s} ${y - 58 * s} L${x + 30 * s} ${y} Z`}
        fill="#120b07"
      />
      <path
        d={`M${x - 22 * s} ${y} L${x - 22 * s} ${y - 52 * s} Q ${x} ${y - 70 * s} ${x + 22 * s} ${y - 52 * s} L${x + 22 * s} ${y} Z`}
        fill={GLOW}
        opacity="0.6"
      />
      {[-120, -70, 70, 120].map((dx) => (
        <Light key={dx} x={x + dx * s - 8 * s} y={top + 30 * s} w={16 * s} h={10 * s} o={0.62} />
      ))}
      <rect x={x - 46 * s} y={y - 4 * s} width={92 * s} height={8 * s} fill={WOOD_DARK} />
      <Smoke x={x} y={top - 104 * s} h={150 * s} w={14} />
      <Banner x={x + W - 30 * s} y={top - 80 * s} h={70 * s} colour="#9e2f22" />
      {tier >= 2 && <Banner x={x - W + 30 * s} y={top - 80 * s} h={70 * s} colour="#9e2f22" />}
      {tier >= 3 && (
        <path
          d={`M${x - W + 4 * s} ${top - 86 * s} Q ${x} ${top - 112 * s} ${x + W - 4 * s} ${top - 86 * s}`}
          stroke="#d4a74f"
          strokeWidth={4}
          fill="none"
        />
      )}
    </g>
  );
}

function Longhouse({ x, y, s }: DrawProps): ReactElement {
  const W = 112 * s;
  return (
    <g>
      <Pool x={x - 40 * s} y={y + 4} r={70 * s} />
      <path
        d={`M${x - W} ${y} L${x - W + 4 * s} ${y - 46 * s} L${x + W - 4 * s} ${y - 46 * s} L${x + W} ${y} Z`}
        fill={WOOD}
      />
      <path
        d={`M${x - W - 12 * s} ${y - 38 * s} Q ${x - W} ${y - 112 * s} ${x} ${y - 118 * s} Q ${x + W} ${y - 112 * s} ${x + W + 12 * s} ${y - 38 * s} Z`}
        fill={TURF}
      />
      <path
        d={`M${x - W - 4 * s} ${y - 70 * s} Q ${x - W + 8 * s} ${y - 110 * s} ${x} ${y - 115 * s} Q ${x + W - 8 * s} ${y - 110 * s} ${x + W + 4 * s} ${y - 70 * s}`}
        stroke="#5b5a31"
        strokeWidth={4}
        fill="none"
        opacity="0.8"
      />
      {[-80, -30, 30, 80].map((dx) => (
        <path
          key={dx}
          d={`M${x + dx * s} ${y - 112 * s} l -4 -8 m 4 8 l 5 -9`}
          stroke="#6a6a38"
          strokeWidth={2}
        />
      ))}
      <rect x={x - 52 * s} y={y - 38 * s} width={22 * s} height={38 * s} fill="#120b07" />
      <rect x={x - 48 * s} y={y - 33 * s} width={14 * s} height={20 * s} fill={GLOW} opacity="0.55" />
      <Light x={x + 10 * s} y={y - 32 * s} w={12 * s} h={8 * s} />
      <Light x={x + 58 * s} y={y - 32 * s} w={12 * s} h={8 * s} />
      {/* Woodpile. */}
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={x + W + 16 * s + i * 9 * s}
          cy={y - 6 * s}
          r={5 * s}
          fill="#4a3220"
          stroke={INK}
          strokeWidth={1}
        />
      ))}
      <Smoke x={x + 20 * s} y={y - 118 * s} h={110 * s} w={9} />
    </g>
  );
}

function MeadHall({ x, y, s, tier }: DrawProps): ReactElement {
  const W = 100 * s;
  return (
    <g>
      <Pool x={x} y={y + 4} r={100 * s} />
      <rect x={x - W} y={y - 66 * s} width={2 * W} height={66 * s} fill="#43301f" />
      <path
        d={`M${x - W - 18 * s} ${y - 60 * s} L${x} ${y - 160 * s} L${x + W + 18 * s} ${y - 60 * s} Z`}
        fill="#2a1a10"
      />
      <path
        d={`M${x - W - 18 * s} ${y - 60 * s} L${x} ${y - 160 * s} L${x + W + 18 * s} ${y - 60 * s}`}
        stroke="#4f3622"
        strokeWidth={5}
        fill="none"
      />
      <path
        d={`M${x} ${y - 158 * s} l -16 -22 M${x} ${y - 158 * s} l 16 -22`}
        stroke="#2a1a10"
        strokeWidth={6}
        strokeLinecap="round"
      />
      {/* Wide doors, lit, and a hanging drinking-horn sign. */}
      <rect x={x - 26 * s} y={y - 50 * s} width={52 * s} height={50 * s} fill="#120b07" />
      <rect x={x - 20 * s} y={y - 44 * s} width={40 * s} height={44 * s} fill={GLOW} opacity="0.72" />
      <Light x={x - 75 * s} y={y - 46 * s} w={18 * s} h={12 * s} />
      <Light x={x + 57 * s} y={y - 46 * s} w={18 * s} h={12 * s} />
      <line
        x1={x - W - 4 * s}
        y1={y - 58 * s}
        x2={x - W - 34 * s}
        y2={y - 58 * s}
        stroke={INK}
        strokeWidth={3}
      />
      <path
        d={`M${x - W - 30 * s} ${y - 56 * s} q 8 ${26 * s} ${24 * s} ${26 * s} l 2 -7 q -12 -2 -18 ${-19 * s} Z`}
        fill="#d9c08a"
        stroke={INK}
        strokeWidth={1.5}
      />
      {/* Barrels. */}
      {[0, 1].map((i) => (
        <g key={i}>
          <rect
            x={x + W + 6 * s + i * 20 * s}
            y={y - 24 * s}
            width={18 * s}
            height={24 * s}
            rx={4 * s}
            fill="#5c4329"
            stroke={INK}
            strokeWidth={1.5}
          />
          <line
            x1={x + W + 6 * s + i * 20 * s}
            y1={y - 12 * s}
            x2={x + W + 24 * s + i * 20 * s}
            y2={y - 12 * s}
            stroke={INK}
            strokeWidth={1.5}
          />
        </g>
      ))}
      <Smoke x={x + 30 * s} y={y - 130 * s} h={100 * s} w={9} />
      {tier >= 2 && <circle cx={x + 40 * s} cy={y - 62 * s} r={6 * s} fill={GLOW} />}
    </g>
  );
}

function Smithy({ x, y, s, tier }: DrawProps): ReactElement {
  return (
    <g>
      <circle cx={x - 20 * s} cy={y - 30 * s} r={80 * s} fill="url(#hv-forge)" />
      {/* Back wall, posts and a lean-to roof. */}
      <rect x={x - 92 * s} y={y - 82 * s} width={172 * s} height={82 * s} fill="#2b1d13" />
      <line x1={x - 92 * s} y1={y} x2={x - 92 * s} y2={y - 86 * s} stroke={WOOD} strokeWidth={7 * s} />
      <line x1={x + 78 * s} y1={y} x2={x + 78 * s} y2={y - 104 * s} stroke={WOOD} strokeWidth={7 * s} />
      <path
        d={`M${x - 108 * s} ${y - 80 * s} L${x + 96 * s} ${y - 112 * s} L${x + 96 * s} ${y - 100 * s} L${x - 108 * s} ${y - 68 * s} Z`}
        fill={ROOF}
      />
      {/* Stone chimney with a glowing mouth. */}
      <rect
        x={x - 82 * s}
        y={y - 150 * s}
        width={30 * s}
        height={150 * s}
        fill="#4a4540"
        stroke="#2c2b29"
        strokeWidth={2}
      />
      <rect x={x - 82 * s} y={y - 154 * s} width={30 * s} height={8 * s} fill="#ff9a3a" opacity="0.85" />
      {/* Forge with coals, anvil, sparks. */}
      <rect
        x={x - 54 * s}
        y={y - 36 * s}
        width={54 * s}
        height={36 * s}
        fill="#57524b"
        stroke="#2c2b29"
        strokeWidth={2}
      />
      <ellipse cx={x - 27 * s} cy={y - 36 * s} rx={24 * s} ry={7 * s} fill="#ff8a2a" />
      <ellipse cx={x - 27 * s} cy={y - 38 * s} rx={14 * s} ry={4 * s} fill="#ffd27a" />
      <path
        d={`M${x + 18 * s} ${y - 26 * s} h ${40 * s} l ${-8 * s} ${8 * s} h ${-6 * s} v ${12 * s} h ${10 * s} v ${6 * s} h ${-32 * s} v ${-6 * s} h ${10 * s} v ${-12 * s} h ${-6 * s} Z`}
        fill="#1d1c1b"
      />
      {[
        [-20, -60],
        [-6, -72],
        [-34, -78],
        [4, -54],
        [-12, -90],
      ].map(([dx, dy]) => (
        <circle
          key={`${dx}${dy}`}
          className="hv-spark"
          cx={x + (dx ?? 0) * s}
          cy={y + (dy ?? 0) * s}
          r={2.2}
          fill="#ffcf6a"
        />
      ))}
      <Smoke x={x - 67 * s} y={y - 156 * s} h={90 * s} w={10} />
      {tier >= 2 && <rect x={x + 40 * s} y={y - 130 * s} width={22 * s} height={30 * s} fill="#4a4540" />}
    </g>
  );
}

function Shipyard({ x, y, s, building }: DrawProps & { building: boolean }): ReactElement {
  return (
    <g>
      {/* Slipway running from the shed door down the strand into the water. */}
      <path
        d={`M${x - 40 * s} ${y - 2} L${x + 6 * s} ${y + 6 * s} L${x - 130 * s} ${y + 66 * s} L${x - 182 * s} ${y + 50 * s} Z`}
        fill="#4a3220"
        stroke={INK}
        strokeWidth={1.5}
      />
      {[0.15, 0.32, 0.5, 0.68, 0.86].map((f) => (
        <line
          key={f}
          x1={x - 40 * s - 142 * s * f}
          y1={y - 2 + 52 * s * f}
          x2={x + 6 * s - 136 * s * f}
          y2={y + 6 * s + 60 * s * f}
          stroke={INK}
          strokeWidth={2}
        />
      ))}
      {building && (
        <g stroke="#9a7448" strokeWidth={4} fill="none" strokeLinecap="round">
          <path
            d={`M${x - 150 * s} ${y + 50 * s} Q ${x - 100 * s} ${y + 52 * s} ${x - 40 * s} ${y + 12 * s}`}
          />
          {[0.2, 0.45, 0.7].map((f) => (
            <path
              key={f}
              d={`M${x - 150 * s + 110 * s * f} ${y + 50 * s - 38 * s * f} q ${-10 * s} ${-26 * s} ${6 * s} ${-40 * s}`}
            />
          ))}
        </g>
      )}
      {/* The boat-shed: an open gable facing the strand. */}
      <rect x={x - 80 * s} y={y - 56 * s} width={160 * s} height={56 * s} fill={WOOD} />
      <path
        d={`M${x - 94 * s} ${y - 50 * s} L${x} ${y - 122 * s} L${x + 94 * s} ${y - 50 * s} Z`}
        fill={ROOF}
      />
      <path
        d={`M${x - 44 * s} ${y} L${x - 44 * s} ${y - 50 * s} L${x} ${y - 84 * s} L${x + 44 * s} ${y - 50 * s} L${x + 44 * s} ${y} Z`}
        fill="#120b07"
      />
      <path
        d={`M${x - 30 * s} ${y - 14 * s} Q ${x} ${y + 2 * s} ${x + 30 * s} ${y - 14 * s} L${x + 24 * s} ${y - 4 * s} Q ${x} ${y + 8 * s} ${x - 24 * s} ${y - 4 * s} Z`}
        fill="#3a2617"
      />
      <path
        d={`M${x} ${y - 122 * s} l -10 -18 M${x} ${y - 122 * s} l 10 -18`}
        stroke={ROOF}
        strokeWidth={5}
        strokeLinecap="round"
      />
      {/* Timber stack. */}
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          cx={x + 98 * s + (i % 3) * 11 * s}
          cy={y - 6 * s - Math.floor(i / 3) * 10 * s}
          r={6 * s}
          fill="#6b4b2c"
          stroke={INK}
          strokeWidth={1.2}
        />
      ))}
      <Light x={x + 50 * s} y={y - 38 * s} w={12 * s} h={8 * s} o={0.5} />
    </g>
  );
}

function Market({ x, y, s, tier }: DrawProps): ReactElement {
  const stalls = tier >= 2 ? [-110, -36, 38, 112] : [-80, 0, 80];
  const colours = ['#9e2f22', '#3f70aa', '#a67b2f', '#4f8a3c'];
  return (
    <g>
      <Pool x={x} y={y + 2} r={120 * s} />
      {stalls.map((dx, i) => {
        const cx = x + dx * s;
        const c = colours[i % colours.length] as string;
        return (
          <g key={dx}>
            <line x1={cx - 30 * s} y1={y} x2={cx - 30 * s} y2={y - 70 * s} stroke={INK} strokeWidth={3} />
            <line x1={cx + 30 * s} y1={y} x2={cx + 30 * s} y2={y - 70 * s} stroke={INK} strokeWidth={3} />
            <path
              d={`M${cx - 38 * s} ${y - 62 * s} L${cx - 26 * s} ${y - 84 * s} L${cx + 26 * s} ${y - 84 * s} L${cx + 38 * s} ${y - 62 * s} Z`}
              fill={c}
            />
            {[-19, 0, 19].map((sx) => (
              <path
                key={sx}
                d={`M${cx + sx * s - 5 * s} ${y - 84 * s} L${cx + sx * s + 5 * s} ${y - 84 * s} L${cx + sx * s * 1.3 + 6 * s} ${y - 62 * s} L${cx + sx * s * 1.3 - 6 * s} ${y - 62 * s} Z`}
                fill="#eadbb4"
                opacity="0.85"
              />
            ))}
            <rect x={cx - 32 * s} y={y - 30 * s} width={64 * s} height={10 * s} fill="#5c4329" />
            <rect x={cx - 28 * s} y={y - 20 * s} width={56 * s} height={20 * s} fill="#3d2a1a" />
            <circle cx={cx - 14 * s} cy={y - 35 * s} r={6 * s} fill="#c9a24a" />
            <circle cx={cx + 2 * s} cy={y - 36 * s} r={7 * s} fill="#8d6b3b" />
            <circle cx={cx + 16 * s} cy={y - 35 * s} r={5 * s} fill="#b33d2e" />
          </g>
        );
      })}
      <rect
        x={x + (stalls[stalls.length - 1] ?? 0) * s + 44 * s}
        y={y - 22 * s}
        width={22 * s}
        height={22 * s}
        fill="#6b4b2c"
        stroke={INK}
        strokeWidth={1.5}
      />
      <Light x={x - 6 * s} y={y - 98 * s} w={10 * s} h={10 * s} o={0.75} />
    </g>
  );
}

function Seer({ x, y, s }: DrawProps): ReactElement {
  return (
    <g>
      <circle cx={x} cy={y - 30 * s} r={60 * s} fill="url(#hv-pool)" opacity="0.6" />
      <path
        d={`M${x - 44 * s} ${y} L${x - 44 * s} ${y - 44 * s} Q ${x} ${y - 52 * s} ${x + 44 * s} ${y - 44 * s} L${x + 44 * s} ${y} Q ${x} ${y + 6 * s} ${x - 44 * s} ${y} Z`}
        fill="#3b2a1d"
      />
      <path
        d={`M${x - 58 * s} ${y - 38 * s} L${x} ${y - 112 * s} L${x + 58 * s} ${y - 38 * s} Q ${x} ${y - 30 * s} ${x - 58 * s} ${y - 38 * s} Z`}
        fill="#5a4a2a"
      />
      <path
        d={`M${x - 40 * s} ${y - 58 * s} L${x} ${y - 108 * s} M${x - 20 * s} ${y - 46 * s} L${x} ${y - 108 * s} M${x + 20 * s} ${y - 46 * s} L${x} ${y - 108 * s}`}
        stroke="#3e321c"
        strokeWidth={2}
      />
      <path
        d={`M${x - 12 * s} ${y} L${x - 12 * s} ${y - 26 * s} Q ${x} ${y - 34 * s} ${x + 12 * s} ${y - 26 * s} L${x + 12 * s} ${y} Z`}
        fill={GLOW}
        opacity="0.7"
      />
      {/* Rune-pole with a crossbar. */}
      <line x1={x + 70 * s} y1={y + 2} x2={x + 70 * s} y2={y - 96 * s} stroke="#2a1c12" strokeWidth={6 * s} />
      <line
        x1={x + 58 * s}
        y1={y - 82 * s}
        x2={x + 82 * s}
        y2={y - 82 * s}
        stroke="#2a1c12"
        strokeWidth={4 * s}
      />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${x + 67 * s} ${y - 60 * s + i * 16 * s} l 6 -6 l -6 -6`}
          stroke="#c9a24a"
          strokeWidth={1.5}
          fill="none"
        />
      ))}
      <Smoke x={x} y={y - 112 * s} h={80 * s} w={7} />
    </g>
  );
}

function Pine({ x, y, h, tone }: { x: number; y: number; h: number; tone: string }): ReactElement {
  return (
    <g>
      <rect x={x - h * 0.03} y={y - h * 0.18} width={h * 0.06} height={h * 0.18} fill="#1d140d" />
      <path
        d={`M${x} ${y - h} L${x + h * 0.2} ${y - h * 0.62} L${x + h * 0.12} ${y - h * 0.62} L${x + h * 0.28} ${y - h * 0.3} L${x + h * 0.16} ${y - h * 0.3} L${x + h * 0.34} ${y - h * 0.12} L${x - h * 0.34} ${y - h * 0.12} L${x - h * 0.16} ${y - h * 0.3} L${x - h * 0.28} ${y - h * 0.3} L${x - h * 0.12} ${y - h * 0.62} L${x - h * 0.2} ${y - h * 0.62} Z`}
        fill={tone}
      />
    </g>
  );
}

function Grove({ x, y, s, tier }: DrawProps): ReactElement {
  // A ring of trees open towards the viewer, a standing stone and a fire in the clearing.
  const ring = 9;
  const trees = Array.from({ length: ring }, (_, i) => {
    const a = (i / ring) * Math.PI * 2 - Math.PI / 2;
    return {
      tx: x + Math.cos(a) * 98 * s,
      ty: y - 26 * s + Math.sin(a) * 30 * s,
      front: Math.sin(a) > 0.2,
      open: Math.sin(a) > 0.85,
    };
  }).filter((t) => !t.open);
  const back = trees.filter((t) => !t.front).sort((a, b) => a.ty - b.ty);
  const front = trees.filter((t) => t.front).sort((a, b) => a.ty - b.ty);
  return (
    <g>
      {back.map((t, i) => (
        <Pine key={`b${i}`} x={t.tx} y={t.ty} h={112 * s} tone="#1d2a1d" />
      ))}
      <ellipse cx={x} cy={y - 22 * s} rx={78 * s} ry={20 * s} fill="#34391f" />
      <circle cx={x + 30 * s} cy={y - 26 * s} r={44 * s} fill="url(#hv-pool)" />
      <path
        d={`M${x - 14 * s} ${y - 18 * s} L${x - 12 * s} ${y - 78 * s} Q ${x} ${y - 90 * s} ${x + 12 * s} ${y - 78 * s} L${x + 14 * s} ${y - 18 * s} Z`}
        fill="#7d776c"
        stroke="#3a3632"
        strokeWidth={2}
      />
      <path
        d={`M${x - 4 * s} ${y - 66 * s} l 6 -6 l 0 14 m -6 4 l 8 -6`}
        stroke="#c9a24a"
        strokeWidth={1.5}
        fill="none"
      />
      {tier >= 2 &&
        [-58, -34, 34, 58].map((dx) => (
          <rect
            key={dx}
            x={x + dx * s - 6 * s}
            y={y - 46 * s}
            width={12 * s}
            height={26 * s}
            rx={3 * s}
            fill="#5f5a52"
          />
        ))}
      <path d={`M${x + 22 * s} ${y - 16 * s} q 8 -22 8 -4 q 6 -16 8 4 Z`} fill="#ffb24a" />
      <ellipse cx={x + 30 * s} cy={y - 15 * s} rx={12 * s} ry={4 * s} fill="#ff8a2a" />
      {front.map((t, i) => (
        <Pine key={`f${i}`} x={t.tx} y={t.ty} h={104 * s} tone="#243322" />
      ))}
    </g>
  );
}

/** An unbuilt plot: stakes and a rope on bare ground. */
function EmptyPlot({ x, y, w }: { x: number; y: number; w: number }): ReactElement {
  const hw = w * 0.4;
  const d = 26;
  const pts: [number, number][] = [
    [x - hw, y],
    [x + hw, y],
    [x + hw - 18, y - d],
    [x - hw + 18, y - d],
  ];
  return (
    <g>
      <path d={`M${pts.map((p) => p.join(' ')).join(' L')} Z`} fill="#3a3524" opacity="0.8" />
      <path
        d={`M${pts.map((p) => p.join(' ')).join(' L')} Z`}
        fill="none"
        stroke="#c2b293"
        strokeWidth={1.5}
        strokeDasharray="6 5"
      />
      {pts.map(([px, py]) => (
        <line key={`${px}-${py}`} x1={px} y1={py} x2={px} y2={py - 16} stroke="#6b4b2c" strokeWidth={4} />
      ))}
      <line x1={x} y1={y - 6} x2={x} y2={y - 46} stroke="#6b4b2c" strokeWidth={4} />
      <rect x={x - 16} y={y - 50} width={32} height={16} fill="#8d6b3b" stroke={INK} strokeWidth={1} />
    </g>
  );
}

/** Hull length factor and look per ship type. */
const SHIP_LOOK: Readonly<Record<string, { len: number; shields: boolean; high: boolean; oars: boolean }>> = {
  karvi: { len: 0.72, shields: false, high: false, oars: false },
  snekkja: { len: 0.9, shields: true, high: false, oars: false },
  drakkar: { len: 1.15, shields: true, high: false, oars: false },
  knarr: { len: 0.82, shields: false, high: true, oars: false },
  galley: { len: 1.0, shields: false, high: false, oars: true },
  riverboat: { len: 0.6, shields: false, high: false, oars: false },
};

/** A ship drawn up on the strand, sail furled on the yard. */
function ShipShape({
  x,
  y,
  type,
  flip,
}: {
  x: number;
  y: number;
  type: ShipTypeId | string;
  flip: boolean;
}): ReactElement {
  const look = SHIP_LOOK[type] ?? { len: 0.9, shields: false, high: false, oars: false };
  const L = 210 * look.len;
  const k = look.high ? 1.3 : 1;
  const g = -0.07 * L * k;
  const hull = `M${-0.5 * L} ${-0.24 * L} C ${-0.42 * L} ${-0.1 * L}, ${-0.32 * L} ${g}, ${-0.2 * L} ${g} L${0.2 * L} ${g} C ${0.32 * L} ${g}, ${0.42 * L} ${-0.1 * L}, ${0.5 * L} ${-0.24 * L} C ${0.46 * L} ${-0.08 * L}, ${0.34 * L} ${0.03 * L}, ${0.2 * L} ${0.03 * L} L${-0.2 * L} ${0.03 * L} C ${-0.34 * L} ${0.03 * L}, ${-0.46 * L} ${-0.08 * L}, ${-0.5 * L} ${-0.24 * L} Z`;
  const shields = [];
  if (look.shields) {
    const n = Math.max(4, Math.round(L / 20));
    for (let i = 0; i < n; i++) {
      const sx = -0.3 * L + (i * 0.6 * L) / Math.max(1, n - 1);
      shields.push(
        <circle
          key={i}
          cx={sx}
          cy={g + 1}
          r={5.5}
          fill={i % 2 === 0 ? '#b8402f' : '#e8d6a0'}
          stroke={INK}
          strokeWidth={1.2}
        />,
      );
    }
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <path d={hull} transform={`translate(0 ${0.08 * L}) scale(1 -0.45)`} fill={INK} opacity="0.28" />
      <path d={hull} fill="#33200f" stroke={INK} strokeWidth={2} />
      <path
        d={`M${-0.47 * L} ${-0.17 * L} C ${-0.36 * L} ${-0.02 * L}, ${0.36 * L} ${-0.02 * L}, ${0.47 * L} ${-0.17 * L}`}
        stroke="#5c4329"
        strokeWidth={2}
        fill="none"
      />
      {/* Stem and stern posts; a dragon's head on the drakkar. */}
      <path
        d={`M${0.5 * L} ${-0.24 * L} q ${0.03 * L} ${-0.08 * L} ${-0.02 * L} ${-0.12 * L}`}
        stroke="#33200f"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M${-0.5 * L} ${-0.24 * L} q ${-0.03 * L} ${-0.08 * L} ${0.02 * L} ${-0.12 * L}`}
        stroke="#33200f"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
      {type === 'drakkar' && (
        <path
          d={`M${0.48 * L} ${-0.36 * L} l ${0.06 * L} ${-0.02 * L} l ${-0.02 * L} ${0.04 * L} Z`}
          fill="#33200f"
          stroke={INK}
        />
      )}
      {shields}
      {look.oars &&
        Array.from({ length: 6 }, (_, i) => (
          <line
            key={i}
            x1={-0.25 * L + i * 0.1 * L}
            y1={g}
            x2={-0.3 * L + i * 0.1 * L}
            y2={0.12 * L}
            stroke="#5c4329"
            strokeWidth={2}
          />
        ))}
      {look.high && (
        <rect
          x={-0.14 * L}
          y={g - 0.07 * L}
          width={0.28 * L}
          height={0.07 * L}
          rx={3}
          fill="#8d6b3b"
          stroke={INK}
          strokeWidth={1}
        />
      )}
      <line x1={0} y1={g} x2={0} y2={-0.62 * L} stroke="#1d140d" strokeWidth={4} />
      <line
        x1={0}
        y1={-0.6 * L}
        x2={-0.42 * L}
        y2={-0.2 * L}
        stroke="#1d140d"
        strokeWidth={1.2}
        opacity="0.7"
      />
      <line
        x1={0}
        y1={-0.6 * L}
        x2={0.42 * L}
        y2={-0.2 * L}
        stroke="#1d140d"
        strokeWidth={1.2}
        opacity="0.7"
      />
      <rect
        x={-0.3 * L}
        y={-0.53 * L}
        width={0.6 * L}
        height={11}
        rx={5.5}
        fill="#cdb88c"
        stroke={INK}
        strokeWidth={1.2}
      />
      <rect x={-0.3 * L} y={-0.53 * L + 4} width={0.6 * L} height={3} fill="#9e2f22" opacity="0.85" />
    </g>
  );
}

/** What the scene needs from state. */
export interface VillageModel {
  tiers: Readonly<Record<HallBuildingId, number>>;
  ships: readonly { id: string; type: string }[];
  /** A ship is on the slipway (the capital's shipyard queue is not empty). */
  building: boolean;
  fortTier: number;
  /** The harbour is iced in (the weather module's flag): ice lies on the water. */
  iced: boolean;
}

function drawBuilding(spot: HallSpot, tier: number, building: boolean): ReactElement {
  if (tier <= 0) return <EmptyPlot x={spot.x} y={spot.y} w={spot.w} />;
  const p: DrawProps = { x: spot.x, y: spot.y, s: 1 + 0.08 * (Math.min(tier, 3) - 1), tier };
  switch (spot.id) {
    case 'greatHall':
      return <GreatHall {...p} />;
    case 'longhouse':
      return <Longhouse {...p} />;
    case 'meadHall':
      return <MeadHall {...p} />;
    case 'smithy':
      return <Smithy {...p} />;
    case 'shipyard':
      return <Shipyard {...p} building={building} />;
    case 'market':
      return <Market {...p} />;
    case 'seer':
      return <Seer {...p} />;
    case 'grove':
      return <Grove {...p} />;
  }
}

/** The village panorama. `onOpen` is called when a building's drawing is clicked. */
export const VillageScene = memo(function VillageScene({
  model,
  onOpen,
}: {
  model: VillageModel;
  onOpen(id: HallBuildingId): void;
}): ReactElement {
  const ships = model.ships.slice(0, SHIP_SLOTS.length);
  const extra = model.ships.length - ships.length;
  return (
    <svg
      className="hv-scene"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-testid="hub-village"
    >
      <defs>
        <linearGradient id="hv-sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="470">
          <stop offset="0" stopColor="#171c2c" />
          <stop offset="0.4" stopColor="#3e3346" />
          <stop offset="0.75" stopColor="#a35a3a" />
          <stop offset="1" stopColor="#e2a058" />
        </linearGradient>
        <linearGradient id="hv-sea" gradientUnits="userSpaceOnUse" x1="0" y1="456" x2="0" y2="1000">
          <stop offset="0" stopColor="#7a5848" />
          <stop offset="0.2" stopColor="#3a3338" />
          <stop offset="1" stopColor="#12171a" />
        </linearGradient>
        <linearGradient id="hv-land" gradientUnits="userSpaceOnUse" x1="0" y1="520" x2="0" y2="1000">
          <stop offset="0" stopColor="#3a3a24" />
          <stop offset="0.5" stopColor="#262618" />
          <stop offset="1" stopColor="#14130c" />
        </linearGradient>
        <linearGradient id="hv-hill" gradientUnits="userSpaceOnUse" x1="0" y1="460" x2="0" y2="640">
          <stop offset="0" stopColor="#43432c" />
          <stop offset="1" stopColor="#26261a" />
        </linearGradient>
        <linearGradient id="hv-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a3a48" />
          <stop offset="1" stopColor="#c27a4e" />
        </linearGradient>
        <radialGradient id="hv-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,180,90,0.42)" />
          <stop offset="1" stopColor="rgba(255,180,90,0)" />
        </radialGradient>
        <radialGradient id="hv-forge" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,140,40,0.55)" />
          <stop offset="1" stopColor="rgba(255,120,30,0)" />
        </radialGradient>
        <radialGradient id="hv-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,214,140,0.85)" />
          <stop offset="0.35" stopColor="rgba(255,190,110,0.35)" />
          <stop offset="1" stopColor="rgba(255,190,110,0)" />
        </radialGradient>
        <filter id="hv-blur">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* Sky, sun, far mountains, the sea. The backdrop bleeds far past the viewBox, so the letterbox around
          the picture (meet) shows more sky, sea and land, never a bar. */}
      <rect x={-1200} y={-800} width={3700} height={1300} fill="url(#hv-sky)" />
      {[
        [120, 60],
        [340, 110],
        [520, 40],
        [760, 90],
        [980, 50],
        [1180, 120],
        [60, 180],
        [640, 160],
        [-180, 90],
        [1460, 70],
        [-120, -60],
        [1500, -80],
      ].map(([sx, sy]) => (
        <circle key={`${sx}:${sy}`} cx={sx} cy={sy} r={1.6} fill="#f1e8d4" opacity="0.5" />
      ))}
      <circle cx={880} cy={392} r={210} fill="url(#hv-sun)" />
      <circle cx={880} cy={392} r={40} fill="#f8d08a" opacity="0.85" />
      <g fill="url(#hv-cloud)" opacity="0.55">
        <path d="M150 250 q 30 -34 80 -20 q 30 -30 80 -8 q 50 -6 60 28 Z" />
        <path d="M930 200 q 40 -40 100 -22 q 40 -34 96 -6 q 60 -4 70 34 Z" />
        <path d="M520 300 q 26 -24 64 -14 q 30 -22 70 -2 q 40 0 44 20 Z" />
        <path d="M-300 230 q 40 -34 100 -16 q 50 -24 110 6 Z" />
        <path d="M1420 280 q 40 -30 96 -12 q 40 -20 90 8 Z" />
      </g>
      <path
        d="M-1200 420 L-1000 340 L-860 390 L-700 320 L-520 380 L-380 330 L-200 390 L-80 350 L0 400 L90 330 L170 372 L290 290 L400 360 L470 330 L560 380 L680 300 L790 372 L900 330 L1010 390 L1120 312 L1210 350 L1300 320 L1420 380 L1560 300 L1700 370 L1880 320 L2050 390 L2300 330 L2500 380 L2500 480 L-1200 480 Z"
        fill="#2e2a34"
      />
      <path
        d="M-1200 446 L-900 412 L-640 440 L-380 408 L-160 444 L0 440 L140 400 L260 432 L380 404 L520 446 L700 410 L860 446 L1000 418 L1160 448 L1300 424 L1480 446 L1700 414 L1960 444 L2500 420 L2500 490 L-1200 490 Z"
        fill="#231f27"
      />
      <rect x={-1200} y={456} width={3700} height={1200} fill="url(#hv-sea)" />
      <path d="M800 458 L960 458 L1080 600 L680 600 Z" fill="#f2c47a" opacity="0.13" />

      {/* The land, with the strand and a fjord inlet in the lower left. */}
      <path
        d="M-1200 600 C -800 580, -300 566, 0 568 C 120 548, 260 552, 400 560 C 640 540, 920 528, 1300 522 L2500 512 L2500 1700 L820 1700 C 760 1400, 680 1100, 600 1000 C 520 940, 380 862, 210 806 C 130 782, 60 774, 0 772 C -400 770, -800 782, -1200 790 Z"
        fill="url(#hv-land)"
      />
      <path
        d="M820 1700 C 760 1400, 680 1100, 600 1000 C 520 940, 380 862, 210 806 C 130 782, 60 774, 0 772 C -400 770, -800 782, -1200 790 L-1200 806 C -800 798, -400 786, -10 788 C 70 790, 140 798, 200 820 C 360 872, 500 950, 570 1000 C 650 1100, 730 1400, 790 1700 Z"
        fill="#6b5a3e"
        opacity="0.55"
      />
      {model.iced && (
        <g data-testid="hub-ice">
          <rect x={-1200} y={456} width={3700} height={58} fill="#cfdde6" opacity="0.26" />
          <path
            d="M600 1000 C 520 940, 380 862, 210 806 C 130 782, 60 774, 0 772 C -400 770, -800 782, -1200 790 L-1200 1700 L820 1700 C 760 1400, 680 1100, 600 1000 Z"
            fill="#cfdde6"
            opacity="0.3"
          />
          {[
            [60, 830, 70],
            [250, 880, 50],
            [140, 950, 80],
            [380, 975, 60],
            [-120, 900, 90],
            [520, 1060, 70],
          ].map(([fx, fy, fw]) => (
            <ellipse
              key={`${fx}`}
              cx={fx}
              cy={fy}
              rx={fw}
              ry={(fw ?? 0) * 0.18}
              fill="#e8f0f4"
              opacity="0.55"
            />
          ))}
        </g>
      )}
      <path
        d="M930 600 C 1000 520, 1080 478, 1170 466 C 1230 460, 1270 468, 1300 476 C 1500 500, 1800 508, 2500 512 L2500 660 L930 660 Z"
        fill="url(#hv-hill)"
      />
      <g stroke="#b8a77f" strokeWidth={22} strokeLinecap="round" fill="none" opacity="0.12">
        <path d="M700 660 C 720 760, 760 840, 775 930" />
        <path d="M700 680 C 600 760, 540 820, 505 900" />
        <path d="M720 670 C 860 720, 980 760, 1150 930" />
        <path d="M640 660 C 520 700, 450 715, 382 718" />
        <path d="M760 655 C 880 640, 1060 560, 1170 474" strokeWidth={14} />
      </g>
      {model.fortTier >= 1 && (
        <g stroke="#1d140d" strokeWidth={6} strokeLinecap="round">
          {Array.from({ length: 34 }, (_, i) => {
            const px = 440 + i * 16;
            const py = 566 - Math.sin(i / 6) * 4;
            return <line key={i} x1={px} y1={py} x2={px} y2={py - 34} />;
          })}
        </g>
      )}

      {/* Buildings, back to front; each clickable. */}
      {VILLAGE.map((spot) => (
        <g
          key={spot.id}
          className="hv-building"
          data-building-id={spot.id}
          data-tier={model.tiers[spot.id]}
          onClick={() => onOpen(spot.id)}
        >
          {drawBuilding(spot, model.tiers[spot.id], model.building)}
          <rect
            className="hv-hit"
            x={spot.x - spot.w / 2}
            y={spot.y - spot.h}
            width={spot.w}
            height={spot.h}
            fill="transparent"
          />
        </g>
      ))}

      {/* The player's ships drawn up on the strand. */}
      <g
        data-testid="hub-ships"
        data-count={model.ships.length}
        onClick={() => onOpen('shipyard')}
        className="hv-building"
      >
        {ships.map((ship, i) => {
          const slot = SHIP_SLOTS[i] as { x: number; y: number };
          return <ShipShape key={ship.id} x={slot.x} y={slot.y} type={ship.type} flip={i % 2 === 1} />;
        })}
        {extra > 0 && (
          <text x={40} y={990} fill="#f3dfb0" fontSize={30} fontFamily="Cinzel, Georgia, serif">
            +{extra}
          </text>
        )}
      </g>
    </svg>
  );
});
