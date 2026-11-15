/**
 * The menu backdrop: asset 'menu.backdrop.main' (the owner's painting drops in at its manifest path);
 * until then a procedural night fjord — layered mountains, a northern-light ribbon, a low moon, and a
 * longship under a square sail on a moonlit sea. Deterministic (seeded star field).
 */
import { memo, type ReactElement } from 'react';
import { AssetImage } from '../ui/index';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ridge(rand: () => number, y: number, amp: number, steps: number, w: number, h: number): string {
  let d = `M0 ${h} L0 ${y}`;
  let cur = y;
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * w;
    cur = Math.max(y - amp, Math.min(y + amp * 0.6, cur + (rand() - 0.55) * amp * 0.9));
    const peak = rand() < 0.3 ? cur - amp * (0.4 + rand() * 0.5) : cur;
    d += ` L${(x - w / steps / 2).toFixed(1)} ${peak.toFixed(1)} L${x.toFixed(1)} ${cur.toFixed(1)}`;
  }
  return `${d} L${w} ${h} Z`;
}

/** The procedural fjord scene (SVG, fills its container). */
export const ProceduralFjord = memo(function ProceduralFjord(): ReactElement {
  const W = 1600;
  const H = 900;
  const rand = mulberry(812);
  const stars = Array.from({ length: 140 }, () => ({ x: rand() * W, y: rand() * H * 0.55, r: rand() < 0.08 ? 1.6 : 0.6 + rand() * 0.7, o: 0.3 + rand() * 0.7 }));
  const far = ridge(mulberry(3), 470, 90, 26, W, H);
  const mid = ridge(mulberry(9), 540, 110, 18, W, H);
  const gr = mulberry(77);
  const glint = Array.from({ length: 46 }, (_, i) => {
    const f = i / 46;
    const y = 604 + Math.pow(f, 1.35) * 290 + gr() * 6;
    const w = (6 + gr() * 34) * (1 + f * 1.6);
    const x = 1140 + (gr() - 0.5) * (30 + f * 150) - w / 2;
    return { x, y, w, h: 1 + gr() * 1.6 + f, o: (0.25 + gr() * 0.55) * (1 - f * 0.55) };
  });
  const nearL = `M0 ${H} L0 520 L120 470 L210 520 L300 560 L380 640 L430 700 L470 ${H} Z`;
  const nearR = `M${W} ${H} L${W} 500 L1490 450 L1400 520 L1300 600 L1230 680 L1180 ${H} Z`;
  return (
    <svg className="fjord" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fj-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05080d" />
          <stop offset="0.45" stopColor="#0d1a24" />
          <stop offset="0.7" stopColor="#1d2a2c" />
          <stop offset="1" stopColor="#2c2620" />
        </linearGradient>
        <radialGradient id="fj-moon" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff6dc" />
          <stop offset="0.7" stopColor="#efdcab" />
          <stop offset="1" stopColor="#d9bf82" />
        </radialGradient>
        <radialGradient id="fj-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,236,190,0.35)" />
          <stop offset="1" stopColor="rgba(255,236,190,0)" />
        </radialGradient>
        <linearGradient id="fj-aurora" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(80,200,160,0)" />
          <stop offset="0.3" stopColor="rgba(90,210,170,0.28)" />
          <stop offset="0.6" stopColor="rgba(120,190,200,0.2)" />
          <stop offset="1" stopColor="rgba(80,200,160,0)" />
        </linearGradient>
        <linearGradient id="fj-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2426" />
          <stop offset="1" stopColor="#070a0b" />
        </linearGradient>
        <linearGradient id="fj-glint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,230,170,0.55)" />
          <stop offset="1" stopColor="rgba(255,230,170,0)" />
        </linearGradient>
        <filter id="fj-blur">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      <rect width={W} height={H} fill="url(#fj-sky)" />
      <g className="fjord-stars">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f4ecd6" opacity={s.o} />
        ))}
      </g>
      <g className="fjord-aurora" filter="url(#fj-blur)">
        <path d="M-50 210 C 300 120, 520 260, 820 170 S 1350 90, 1700 190 L1700 260 C 1350 170, 1100 300, 820 250 S 300 210, -50 300 Z" fill="url(#fj-aurora)" />
        <path d="M-50 140 C 260 60, 600 190, 900 110 S 1400 60, 1700 120 L1700 160 C 1400 110, 1150 210, 900 160 S 300 120, -50 200 Z" fill="url(#fj-aurora)" opacity="0.6" />
      </g>
      <circle cx="1140" cy="250" r="150" fill="url(#fj-halo)" />
      <circle cx="1140" cy="250" r="46" fill="url(#fj-moon)" />
      <circle cx="1124" cy="238" r="9" fill="#e6d29e" opacity="0.5" />
      <circle cx="1155" cy="265" r="6" fill="#e6d29e" opacity="0.45" />
      <path d={far} fill="#16222a" />
      <path d={mid} fill="#0f171c" />
      <rect y="600" width={W} height={H - 600} fill="url(#fj-sea)" />
      <ellipse cx="1140" cy="740" rx="70" ry="150" fill="url(#fj-glint)" opacity="0.35" filter="url(#fj-blur)" />
      <g className="fjord-glint" fill="#f6e2ae">
        {glint.map((d, i) => (
          <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h} rx={1} opacity={d.o} />
        ))}
      </g>
      <g className="fjord-waves" stroke="rgba(255,236,190,0.18)" strokeWidth="1.2" fill="none">
        {Array.from({ length: 14 }, (_, i) => {
          const y = 620 + i * 20 + i * i * 0.8;
          return <path key={i} d={`M${-40 + (i % 3) * 30} ${y} q 60 -5 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0`} opacity={0.25 + (i / 14) * 0.5} />;
        })}
      </g>
      <g className="fjord-ship" transform="translate(760 600)">
        <path d="M-150 0 C -110 26, 110 26, 150 0 L 138 -8 C 90 6, -90 6, -138 -8 Z" fill="#090c0e" />
        <path d="M-150 0 C -160 -20, -168 -40, -158 -58 C -152 -46, -150 -30, -138 -8 Z" fill="#090c0e" />
        <path d="M150 0 C 160 -20, 168 -40, 158 -58 C 152 -46, 150 -30, 138 -8 Z" fill="#090c0e" />
        <rect x="-3" y="-150" width="6" height="146" fill="#090c0e" />
        <path d="M-78 -138 L 78 -138 L 70 -26 L -70 -26 Z" fill="#14100c" stroke="#090c0e" strokeWidth="3" />
        <path d="M-74 -110 L 74 -110 M-72 -82 L 72 -82 M-71 -54 L 71 -54" stroke="#2b1c12" strokeWidth="9" opacity="0.8" />
        <g fill="#0c0f11">
          {Array.from({ length: 11 }, (_, i) => (
            <circle key={i} cx={-100 + i * 20} cy={-4} r={7} />
          ))}
        </g>
        <g stroke="#090c0e" strokeWidth="2.4">
          {Array.from({ length: 10 }, (_, i) => (
            <line key={i} x1={-92 + i * 20} y1={4} x2={-104 + i * 20} y2={34} />
          ))}
        </g>
      </g>
      <path d={nearL} fill="#06090b" />
      <path d={nearR} fill="#06090b" />
      <rect width={W} height={H} fill="url(#fj-sky)" opacity="0.08" />
    </svg>
  );
});

/** The menu backdrop with final-art drop-in. */
export function MenuBackdrop({ dim = false }: { dim?: boolean }): ReactElement {
  return (
    <div className={['menu-backdrop', dim && 'is-dim'].filter(Boolean).join(' ')} aria-hidden="true">
      <AssetImage id="menu.backdrop.main" alt="" cover fallback={<ProceduralFjord />} />
      <div className="menu-backdrop-vignette" />
    </div>
  );
}
