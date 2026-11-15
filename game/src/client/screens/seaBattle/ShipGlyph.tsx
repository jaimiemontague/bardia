/**
 * A ship seen from the side, drawn in SVG (original art): a longship with its curled stem, shields on
 * the rail and a striped square sail; the deep-bellied knarr; the long galley with oars and a beak.
 * Used by the Before-the-Sea-Battle card and the after-battle summary. The stripes and shields take
 * the side's colour; `fate` greys out or sinks a lost ship.
 */
import type { ReactElement } from 'react';

export interface ShipGlyphProps {
  type: string;
  side: 'own' | 'foe';
  /** Face left (the enemy's ships face the player's). */
  flip?: boolean;
  fate?: 'fine' | 'damaged' | 'sunk' | 'taken' | 'escaped' | 'won';
  /** Width in px (height follows). */
  size?: number;
  title?: string;
}

const COLORS = {
  own: { stripe: '#2f63b8', shield: '#3d7fe0', shield2: '#a8ccff' },
  foe: { stripe: '#a8321f', shield: '#d2412f', shield2: '#ffb3a6' },
} as const;

export function ShipGlyph({ type, side, flip = false, fate = 'fine', size = 96, title }: ShipGlyphProps): ReactElement {
  const c = COLORS[side];
  const kind = type === 'knarr' ? 'knarr' : type === 'galley' ? 'galley' : 'longship';
  const big = type === 'drakkar' ? 1.12 : type === 'karvi' || type === 'riverboat' ? 0.88 : 1;
  const sunk = fate === 'sunk';
  const taken = fate === 'taken';
  const hull = '#5e3d22';
  const dark = '#3a2412';
  let body: ReactElement;
  if (kind === 'knarr') {
    body = (
      <>
        <path d="M14 50 Q20 66 60 67 Q100 66 106 50 L98 50 Q60 56 22 50 Z" fill={hull} stroke={dark} strokeWidth="1.5" />
        <path d="M14 50 Q10 42 16 38" fill="none" stroke={dark} strokeWidth="3" strokeLinecap="round" />
        <path d="M106 50 Q110 42 104 38" fill="none" stroke={dark} strokeWidth="3" strokeLinecap="round" />
        <line x1="60" y1="52" x2="60" y2="10" stroke={dark} strokeWidth="2.5" />
        <path d="M38 14 L82 14 Q86 32 82 46 L38 46 Q34 32 38 14 Z" fill="#e9dfc6" stroke={dark} strokeWidth="1" />
        <path d="M48 14 L48 46 M60 14 L60 46 M72 14 L72 46" stroke={c.stripe} strokeWidth="5" />
        <rect x="44" y="44" width="10" height="7" fill="#8a6a3a" />
        <rect x="66" y="44" width="12" height="7" fill="#7a5a30" />
      </>
    );
  } else if (kind === 'galley') {
    body = (
      <>
        {[...Array(9)].map((_, i) => (
          <line key={i} x1={26 + i * 9} y1="54" x2={22 + i * 9} y2="68" stroke={dark} strokeWidth="1.6" />
        ))}
        <path d="M8 48 L112 48 L118 54 L104 56 Q60 62 14 56 Z" fill={hull} stroke={dark} strokeWidth="1.5" />
        <path d="M112 52 L124 55 L110 57 Z" fill="#b08a3e" />
        <path d="M8 48 Q2 40 8 34" fill="none" stroke={dark} strokeWidth="3" strokeLinecap="round" />
        <line x1="64" y1="50" x2="64" y2="12" stroke={dark} strokeWidth="2.5" />
        <path d="M44 16 L86 16 Q89 30 86 42 L44 42 Q41 30 44 16 Z" fill="#e9dfc6" stroke={dark} strokeWidth="1" />
        <path d="M44 22 L86 22 M44 36 L86 36" stroke={c.stripe} strokeWidth="5" />
        <path d="M14 48 L108 48" stroke={c.shield} strokeWidth="2.5" />
      </>
    );
  } else {
    body = (
      <>
        <path d="M14 48 Q30 62 60 62 Q90 62 106 48 Z" fill={hull} stroke={dark} strokeWidth="1.5" />
        <path d="M106 48 Q114 40 112 28 Q110 22 104 24" fill="none" stroke={dark} strokeWidth="3.5" strokeLinecap="round" />
        <path d="M14 48 Q6 40 9 30 Q11 25 16 27" fill="none" stroke={dark} strokeWidth="3.5" strokeLinecap="round" />
        {type === 'drakkar' && <circle cx="104" cy="24" r="3.5" fill="#f2c94c" stroke={dark} strokeWidth="1" />}
        <line x1="60" y1="50" x2="60" y2="6" stroke={dark} strokeWidth="2.5" />
        <path d="M36 10 L84 10 Q88 28 84 42 L36 42 Q32 28 36 10 Z" fill="#e9dfc6" stroke={dark} strokeWidth="1" />
        <path d="M44 10 L44 42 M54 10 L54 42 M66 10 L66 42 M76 10 L76 42" stroke={c.stripe} strokeWidth="5" />
        {[...Array(8)].map((_, i) => (
          <circle key={i} cx={27 + i * 9.4} cy="49" r="4" fill={i % 2 === 0 ? c.shield : c.shield2} stroke={dark} strokeWidth="1" />
        ))}
      </>
    );
  }
  const w = size;
  const h = size * (80 / 128);
  return (
    <svg viewBox="0 0 128 80" width={w * big} height={h * big} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={`ship-glyph fate-${fate}`}>
      {title && <title>{title}</title>}
      <g transform={`${flip ? 'translate(128 0) scale(-1 1)' : ''}${sunk ? ' rotate(14 64 60) translate(0 10)' : ''}`} opacity={sunk ? 0.45 : taken ? 0.6 : 1} style={taken ? { filter: 'grayscale(0.7)' } : undefined}>
        {body}
      </g>
      <path d="M0 64 Q16 59 32 64 T64 64 T96 64 T128 64 L128 80 L0 80 Z" fill="#1f5566" opacity="0.9" />
      <path d="M0 64 Q16 59 32 64 T64 64 T96 64 T128 64" fill="none" stroke="#d8eef0" strokeWidth="1.2" opacity="0.6" />
    </svg>
  );
}
