/**
 * Placeholder panorama of the home hall at dusk (asset id 'ui.hub.placeholderPanorama'; the owner's
 * painting can drop in at its manifest path). Procedural, deterministic SVG.
 */
import { memo, type ReactElement } from 'react';
import { AssetImage } from '../../ui/index';

function House({ x, y, w, h, roof = '#2a1b12', wall = '#3d2a1a' }: { x: number; y: number; w: number; h: number; roof?: string; wall?: string }): ReactElement {
  return (
    <g>
      <rect x={x} y={y - h} width={w} height={h} fill={wall} />
      <path d={`M${x - w * 0.08} ${y - h} Q ${x + w / 2} ${y - h - h * 1.25} ${x + w * 1.08} ${y - h} Z`} fill={roof} />
      <rect x={x + w * 0.42} y={y - h * 0.62} width={w * 0.16} height={h * 0.62} fill="#120b07" />
      <rect x={x + w * 0.45} y={y - h * 0.55} width={w * 0.1} height={h * 0.2} fill="#e8a54a" opacity="0.65" />
    </g>
  );
}

const Scene = memo(function Scene(): ReactElement {
  return (
    <svg className="hall-panorama" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2230" />
          <stop offset="0.5" stopColor="#4a3a3a" />
          <stop offset="0.8" stopColor="#b36a3a" />
          <stop offset="1" stopColor="#d99a52" />
        </linearGradient>
        <linearGradient id="hp-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5d4a3a" />
          <stop offset="1" stopColor="#141819" />
        </linearGradient>
        <linearGradient id="hp-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a1c" />
          <stop offset="1" stopColor="#12120c" />
        </linearGradient>
        <radialGradient id="hp-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,190,110,0.5)" />
          <stop offset="1" stopColor="rgba(255,190,110,0)" />
        </radialGradient>
        <filter id="hp-smoke">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <rect width="1200" height="600" fill="url(#hp-sky)" />
      <circle cx="880" cy="330" r="60" fill="#f2c47a" opacity="0.55" />
      <path d="M0 330 L120 250 L210 300 L330 210 L460 290 L560 240 L700 300 L820 230 L960 290 L1080 220 L1200 280 L1200 400 L0 400 Z" fill="#2c2a32" />
      <path d="M0 360 L160 300 L300 350 L420 300 L600 360 L760 310 L900 350 L1050 300 L1200 340 L1200 420 L0 420 Z" fill="#221f24" />
      <rect y="390" width="1200" height="210" fill="url(#hp-sea)" />
      <path d="M760 392 L1000 392 L1100 600 L660 600 Z" fill="#f2c47a" opacity="0.12" />
      <path d="M0 430 C 200 405, 380 415, 520 440 C 700 470, 900 440, 1200 455 L1200 600 L0 600 Z" fill="url(#hp-ground)" />
      <g stroke="#0f0b08" strokeWidth="5">
        {Array.from({ length: 46 }, (_, i) => (
          <line key={i} x1={40 + i * 24} y1={520 - Math.sin(i / 4) * 6} x2={40 + i * 24} y2={492 - Math.sin(i / 4) * 6} />
        ))}
      </g>
      <g className="hall-smoke" opacity="0.22" filter="url(#hp-smoke)" fill="none" stroke="#b8aca0" strokeLinecap="round">
        <path d="M600 300 C 590 260, 625 240, 612 200 S 640 150, 628 110" strokeWidth="14" />
        <path d="M345 428 C 340 400, 362 386, 352 360 S 370 320, 362 296" strokeWidth="8" />
        <path d="M848 424 C 842 396, 866 382, 856 356 S 876 316, 868 292" strokeWidth="8" />
      </g>
      <circle cx="600" cy="400" r="160" fill="url(#hp-glow)" />
      {/* The great hall: long, bowed roof with crossed gable boards. */}
      <path d="M430 440 L770 440 L770 360 L430 360 Z" fill="#3b2818" />
      <path d="M410 362 Q 600 230 790 362 Z" fill="#24170e" />
      <path d="M410 362 L398 332 M410 362 L424 334 M790 362 L802 332 M790 362 L776 334" stroke="#24170e" strokeWidth="8" strokeLinecap="round" />
      <path d="M560 440 L640 440 L640 384 Q 600 360 560 384 Z" fill="#120b07" />
      <rect x="575" y="396" width="50" height="44" fill="#f0a04a" opacity="0.55" />
      <g fill="#e8a54a" opacity="0.6">
        <rect x="470" y="392" width="16" height="10" />
        <rect x="714" y="392" width="16" height="10" />
      </g>
      <House x={300} y={470} w={90} h={48} />
      <House x={220} y={492} w={70} h={38} roof="#2d1d13" />
      <House x={800} y={470} w={96} h={50} />
      <House x={910} y={500} w={74} h={40} roof="#2d1d13" />
      <House x={120} y={510} w={64} h={34} />
      {/* Ships drawn up on the strand. */}
      <g fill="#0d0a08">
        <path d="M960 560 C 1000 580, 1120 580, 1160 560 L 1150 552 C 1110 566, 1010 566, 970 552 Z" />
        <path d="M960 560 C 952 546, 950 532, 958 520 L 970 552 Z" />
        <rect x="1058" y="470" width="4" height="86" />
        <path d="M1010 480 L1110 480 L1104 540 L1016 540 Z" fill="#3a1f18" opacity="0.85" />
        <path d="M1010 600 C 1040 590, 1110 590, 1150 600 Z" />
      </g>
    </svg>
  );
});

/** The hall panorama (final art via asset id, procedural fallback). */
export function HallPanorama(): ReactElement {
  return (
    <div className="hall-panorama-wrap" aria-hidden="true">
      <AssetImage id="ui.hub.placeholderPanorama" alt="" cover fallback={<Scene />} />
    </div>
  );
}
