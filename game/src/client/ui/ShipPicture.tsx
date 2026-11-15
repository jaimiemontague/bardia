/**
 * ShipPicture: a small painted ship under sail for cards and pickers (planner, shipyard, fleet lists).
 * Drawn inline per ship type (hull length, freeboard, shields, dragon prow), so it needs no asset file.
 */
import { memo, type ReactElement } from 'react';

interface Look {
  len: number;
  shields: boolean;
  high: boolean;
  dragon: boolean;
  sail: [string, string];
}

const LOOKS: Readonly<Record<string, Look>> = {
  karvi: { len: 0.74, shields: false, high: false, dragon: false, sail: ['#c9b48a', '#8a3a2a'] },
  snekkja: { len: 0.88, shields: true, high: false, dragon: false, sail: ['#d8c79e', '#a3392b'] },
  drakkar: { len: 1, shields: true, high: false, dragon: true, sail: ['#e2d3a8', '#7c2a20'] },
  knarr: { len: 0.8, shields: false, high: true, dragon: false, sail: ['#cdbb93', '#3d5f7a'] },
  galley: { len: 0.95, shields: false, high: false, dragon: false, sail: ['#d6c49a', '#5b4a2a'] },
  riverboat: { len: 0.6, shields: false, high: false, dragon: false, sail: ['#c4b088', '#6b5a3a'] },
};

export interface ShipPictureProps {
  /** Ship type id ('snekkja', 'knarr', …); unknown types get a plain hull. */
  type: string;
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name; omit when a visible label names the ship. */
  title?: string;
  className?: string;
}

/** A small ship under sail on a strip of sea. */
export const ShipPicture = memo(function ShipPicture({ type, size = 'md', title, className }: ShipPictureProps): ReactElement {
  const look = LOOKS[type] ?? { len: 0.85, shields: false, high: false, dragon: false, sail: ['#cdbb93', '#6b4b2c'] as [string, string] };
  const L = 92 * look.len;
  const cx = 60;
  const wl = 58; // waterline
  const fb = look.high ? 13 : 9; // freeboard
  const x0 = cx - L / 2;
  const x1 = cx + L / 2;
  const hull = `M${x0} ${wl - fb - 6} C ${x0 + L * 0.1} ${wl - 2}, ${x0 + L * 0.25} ${wl + 3}, ${cx} ${wl + 3} C ${x1 - L * 0.25} ${wl + 3}, ${x1 - L * 0.1} ${wl - 2}, ${x1} ${wl - fb - 6} C ${x1 - L * 0.08} ${wl - fb + 1}, ${x0 + L * 0.08} ${wl - fb + 1}, ${x0} ${wl - fb - 6} Z`;
  const mastTop = 12;
  const sailW = L * 0.42;
  const sailTop = mastTop + 4;
  const sailBot = wl - fb - 4;
  const stripes = 5;
  const shields = [];
  if (look.shields) {
    const n = Math.max(4, Math.round(L / 12));
    for (let i = 0; i < n; i++) {
      const sx = x0 + L * 0.2 + (i * L * 0.6) / Math.max(1, n - 1);
      shields.push(<circle key={i} cx={sx} cy={wl - fb + 1} r={3.2} fill={i % 2 === 0 ? '#b8402f' : '#e8d6a0'} stroke="#1a110a" strokeWidth={0.8} />);
    }
  }
  return (
    <svg
      viewBox="0 0 120 72"
      className={['ship-picture', `ship-picture-${size}`, className].filter(Boolean).join(' ')}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect x="0" y={wl - 2} width="120" height={72 - wl + 2} fill="#1f3b47" />
      <path d={`M0 ${wl + 5} q 10 -3 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`} stroke="#5a9b95" strokeWidth="1.2" fill="none" opacity="0.6" />
      <path d={`M0 ${wl + 11} q 10 -3 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`} stroke="#5a9b95" strokeWidth="1" fill="none" opacity="0.35" />
      <line x1={cx} y1={mastTop} x2={cx} y2={wl - fb} stroke="#4a3220" strokeWidth="2" />
      <line x1={cx - sailW / 2 - 3} y1={sailTop} x2={cx + sailW / 2 + 3} y2={sailTop} stroke="#4a3220" strokeWidth="1.6" />
      <g>
        {Array.from({ length: stripes }, (_, i) => (
          <rect
            key={i}
            x={cx - sailW / 2 + (i * sailW) / stripes}
            y={sailTop}
            width={sailW / stripes + 0.3}
            height={sailBot - sailTop}
            fill={i % 2 === 0 ? look.sail[0] : look.sail[1]}
          />
        ))}
        <path d={`M${cx - sailW / 2} ${sailBot} Q ${cx} ${sailBot + 3} ${cx + sailW / 2} ${sailBot}`} stroke="#1a110a" strokeWidth="0.8" fill="none" />
        <rect x={cx - sailW / 2} y={sailTop} width={sailW} height={sailBot - sailTop} fill="none" stroke="#1a110a" strokeWidth="0.8" />
      </g>
      <path d={hull} fill="#3a2414" stroke="#1a110a" strokeWidth="1.2" />
      <path d={`M${x0 + 3} ${wl - fb - 2} C ${x0 + L * 0.3} ${wl - fb + 4}, ${x1 - L * 0.3} ${wl - fb + 4}, ${x1 - 3} ${wl - fb - 2}`} stroke="#7d5c39" strokeWidth="1" fill="none" />
      <path d={`M${x1} ${wl - fb - 6} q 3 -6 -1 -9`} stroke="#3a2414" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d={`M${x0} ${wl - fb - 6} q -3 -6 1 -9`} stroke="#3a2414" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {look.dragon && <path d={`M${x1 - 1} ${wl - fb - 15} l 5 -1 l -2 3 Z`} fill="#3a2414" stroke="#1a110a" strokeWidth="0.6" />}
      {shields}
    </svg>
  );
});
