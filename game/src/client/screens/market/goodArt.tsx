/**
 * Small painted pictures of the trade goods (original inline SVG, 32×32), for the market's goods tiles and the
 * deal panel. Decorative: the good's name is always written beside the picture.
 */
import type { ReactElement, ReactNode } from 'react';

const INK = '#2a1c12';

const ART: Record<string, ReactNode> = {
  rations: (
    <>
      <path d="M9 9c0-3 3-4 7-4s7 1 7 4l2 15c0 3-4 4-9 4s-9-1-9-4z" fill="#b89668" stroke={INK} strokeWidth="1.2" />
      <path d="M11 8c2 1 8 1 10 0" stroke={INK} strokeWidth="1.2" fill="none" />
      <path d="M13 15l1 7M19 15l-1 7M16 14v8" stroke="#e7c76c" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  salt: (
    <>
      <path d="M4 25c3-8 7-13 12-13s9 5 12 13z" fill="#ece8de" stroke={INK} strokeWidth="1.2" />
      <path d="M10 22l2-3M16 20l1-4M21 22l-1-3" stroke="#b8b2a4" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="20" y="6" width="5" height="5" transform="rotate(20 22 8)" fill="#f7f4ec" stroke={INK} strokeWidth="1" />
    </>
  ),
  timber: (
    <>
      <rect x="4" y="17" width="22" height="7" rx="3.5" fill="#9a6a3c" stroke={INK} strokeWidth="1.2" />
      <rect x="7" y="9" width="22" height="7" rx="3.5" fill="#b07a46" stroke={INK} strokeWidth="1.2" />
      <circle cx="26" cy="12.5" r="2.4" fill="#e0b47a" stroke={INK} strokeWidth="1" />
      <circle cx="23" cy="20.5" r="2.4" fill="#d6a86c" stroke={INK} strokeWidth="1" />
    </>
  ),
  iron: (
    <>
      <path d="M5 22l4-7h16l4 7z" fill="#6f7478" stroke={INK} strokeWidth="1.2" />
      <path d="M8 15l3-5h12l3 5z" fill="#8b9195" stroke={INK} strokeWidth="1.2" />
      <path d="M12 12h9" stroke="#c4cacd" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  pitch: (
    <>
      <path d="M8 7h16c1 6 1 13 0 19H8C7 20 7 13 8 7z" fill="#5a3b22" stroke={INK} strokeWidth="1.2" />
      <path d="M7.6 11h16.8M7.6 22h16.8" stroke="#2e2318" strokeWidth="1.6" />
      <path d="M12 7c1-2 3 1 4-1s3 1 4 0" stroke="#111" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </>
  ),
  furs: (
    <>
      <path d="M7 9c3-2 5 0 9-1s6-2 9 1l-2 4 2 6c-3 3-6 1-9 2s-6 3-9 0l2-6z" fill="#8a5a34" stroke={INK} strokeWidth="1.2" />
      <path d="M11 13c2 1 4 0 6 1s4 0 5 1" stroke="#c48a56" strokeWidth="1.2" fill="none" />
      <path d="M16 21l-1 6" stroke="#8a5a34" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  ivory: (
    <>
      <path d="M6 25C9 14 16 7 26 5c-6 5-10 12-12 21z" fill="#f1e6cc" stroke={INK} strokeWidth="1.2" />
      <path d="M11 22c2-5 5-9 9-12" stroke="#cbbd9a" strokeWidth="1.1" fill="none" />
    </>
  ),
  amber: (
    <>
      <path d="M16 4c5 6 8 11 8 15a8 8 0 01-16 0c0-4 3-9 8-15z" fill="#e3912a" stroke={INK} strokeWidth="1.2" />
      <path d="M12 18c0-3 2-6 4-8" stroke="#ffd08a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  ),
  cloth: (
    <>
      <rect x="5" y="9" width="22" height="13" rx="2" fill="#5f7fa3" stroke={INK} strokeWidth="1.2" />
      <path d="M5 13h22M5 18h22" stroke="#9db6cf" strokeWidth="1.1" />
      <path d="M22 22l3 5-6-2" fill="#5f7fa3" stroke={INK} strokeWidth="1.1" />
    </>
  ),
  wine: (
    <>
      <path d="M13 4h6v4c4 2 6 6 6 10 0 5-4 9-9 9s-9-4-9-9c0-4 2-8 6-10z" fill="#7a2434" stroke={INK} strokeWidth="1.2" />
      <path d="M11 15c1-2 2-3 4-4" stroke="#c8606f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <rect x="12.5" y="3" width="7" height="2.5" rx="1" fill="#b89668" stroke={INK} strokeWidth="1" />
    </>
  ),
  mead: (
    <>
      <path d="M4 9c6 1 13 5 17 13l3 4c1 2-2 3-3 1-6-6-12-10-17-12z" fill="#e9dcc0" stroke={INK} strokeWidth="1.2" />
      <path d="M4 9c-1 2-1 4 0 5" stroke={INK} strokeWidth="1.2" fill="#d9a441" />
      <path d="M8 11c4 1 8 4 11 8" stroke="#c9a24a" strokeWidth="1.6" fill="none" />
    </>
  ),
  honey: (
    <>
      <path d="M9 11h14c2 3 2 12-1 15H10c-3-3-3-12-1-15z" fill="#c98a2e" stroke={INK} strokeWidth="1.2" />
      <path d="M8 8h16v3H8z" fill="#8a5a34" stroke={INK} strokeWidth="1.1" />
      <path d="M13 11v5a1.5 1.5 0 003 0v-2" stroke="#f4c45a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  ),
  jewelry: (
    <>
      <path d="M6 16a10 7 0 0120 0" stroke="#e1b84a" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M6 16a10 7 0 0120 0" stroke={INK} strokeWidth="0.8" fill="none" />
      <circle cx="6" cy="17" r="2.6" fill="#e1b84a" stroke={INK} strokeWidth="1" />
      <circle cx="26" cy="17" r="2.6" fill="#e1b84a" stroke={INK} strokeWidth="1" />
      <circle cx="16" cy="24" r="3" fill="#9c2a3a" stroke={INK} strokeWidth="1" />
    </>
  ),
  silk: (
    <>
      <path d="M5 21c4-9 9-13 14-13 4 0 7 2 8 5-4 0-6 2-9 5s-8 5-13 3z" fill="#c2577e" stroke={INK} strokeWidth="1.2" />
      <path d="M10 18c3-4 6-6 10-7" stroke="#f0a8c2" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
  weapons: (
    <>
      <path d="M8 24L22 6l3 1-1 3L10 26z" fill="#b9c0c4" stroke={INK} strokeWidth="1.2" />
      <path d="M6 21l5 5M7 27l-2-2" stroke="#8a5a34" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 24L10 6l-3 1 1 3 14 16z" fill="#a7aeb2" stroke={INK} strokeWidth="1.2" />
      <path d="M26 21l-5 5M25 27l2-2" stroke="#8a5a34" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
};

/** A trade good's picture (a plain crate for a good without one). */
export function GoodArt({ good, size = 'md' }: { good: string; size?: 'sm' | 'md' | 'lg' }): ReactElement {
  return (
    <svg className={`good-art good-art-${size}`} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {ART[good] ?? <rect x="6" y="8" width="20" height="17" rx="2" fill="#9a6a3c" stroke={INK} strokeWidth="1.2" />}
    </svg>
  );
}
