/**
 * Inline SVG icon set (24×24, currentColor). Every colour-coded state in the UI also carries one of
 * these glyphs (§25.7: icons for every colour-coded state), so meaning never relies on hue alone.
 * Icons are decorative by default (aria-hidden); pass `label` to expose one to assistive tech.
 */
import type { ReactElement, SVGProps } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'currentColor', stroke: 'none' } as const;

const ICONS = {
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" {...F} />
      <rect x="14" y="5" width="4" height="14" rx="1" {...F} />
    </>
  ),
  play: <path d="M7 5l12 7-12 7z" {...F} />,
  fast: (
    <>
      <path d="M3 6l9 6-9 6z" {...F} />
      <path d="M12 6l9 6-9 6z" {...F} />
    </>
  ),
  faster: (
    <>
      <path d="M1.5 7l7 5-7 5z" {...F} />
      <path d="M8.5 7l7 5-7 5z" {...F} />
      <path d="M15.5 7l7 5-7 5z" {...F} />
    </>
  ),
  silver: (
    <>
      <ellipse cx="12" cy="12" rx="8.5" ry="8.5" {...S} />
      <ellipse cx="12" cy="12" rx="4" ry="4" {...S} />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" {...S} strokeWidth={1.2} />
    </>
  ),
  men: (
    <>
      <path d="M8 4.5c2.6 0 4.2 1.8 4.2 4.4v1.6H3.8V8.9C3.8 6.3 5.4 4.5 8 4.5z" {...S} />
      <path d="M8 4.5v6" {...S} strokeWidth={1.2} />
      <path d="M2.8 20c.6-3.6 2.6-5.6 5.2-5.6s4.6 2 5.2 5.6" {...S} />
      <path d="M16 6.5c2.1 0 3.5 1.5 3.5 3.6v1.3h-7v-1.3c0-2.1 1.4-3.6 3.5-3.6z" {...S} />
      <path d="M14.2 15.3c.6-.3 1.2-.4 1.8-.4 2.3 0 4 1.8 4.6 5.1" {...S} />
    </>
  ),
  food: (
    <>
      <path d="M12 21V9" {...S} />
      <path d="M12 9c-2.5-.5-4-2.5-4-5 2.5.5 4 2.5 4 5zM12 9c2.5-.5 4-2.5 4-5-2.5.5-4 2.5-4 5z" {...S} />
      <path d="M12 14c-2.5-.5-4-2.5-4-5 2.5.5 4 2.5 4 5zM12 14c2.5-.5 4-2.5 4-5-2.5.5-4 2.5-4 5z" {...S} />
      <path d="M12 19c-2.5-.5-4-2.5-4-5 2.5.5 4 2.5 4 5zM12 19c2.5-.5 4-2.5 4-5-2.5.5-4 2.5-4 5z" {...S} />
    </>
  ),
  renown: <path d="M12 2.5l2.4 6.1 6.6.4-5.1 4.2 1.7 6.4L12 16l-5.6 3.6 1.7-6.4L3 9l6.6-.4z" {...S} />,
  honor: (
    <>
      <path d="M12 2.8l7.5 2.7v6c0 4.8-3.2 8.2-7.5 9.8-4.3-1.6-7.5-5-7.5-9.8v-6z" {...S} />
      <path d="M12 7v9M8.5 10.5h7" {...S} />
    </>
  ),
  dread: (
    <>
      <path d="M12 3c4.4 0 7.5 3 7.5 7.1 0 2.4-1.1 4.1-2.8 5.1V19H7.3v-3.8C5.6 14.2 4.5 12.5 4.5 10.1 4.5 6 7.6 3 12 3z" {...S} />
      <circle cx="9" cy="10.5" r="1.7" {...F} />
      <circle cx="15" cy="10.5" r="1.7" {...F} />
      <path d="M10.5 19v2M13.5 19v2M12 13.5l-1 2h2z" {...S} strokeWidth={1.3} />
    </>
  ),
  favor: (
    <>
      <path d="M6 4h12v5H6z" {...S} />
      <path d="M12 9v12" {...S} />
      <path d="M10 21h4" {...S} />
    </>
  ),
  character: (
    <>
      <circle cx="12" cy="8" r="4" {...S} />
      <path d="M4 21c.8-4.5 3.8-7 8-7s7.2 2.5 8 7" {...S} />
    </>
  ),
  family: (
    <>
      <circle cx="12" cy="4.5" r="2.2" {...S} />
      <circle cx="5.5" cy="19" r="2.2" {...S} />
      <circle cx="12" cy="19" r="2.2" {...S} />
      <circle cx="18.5" cy="19" r="2.2" {...S} />
      <path d="M12 6.7v10M12 11.5H5.5v5.3M12 11.5h6.5v5.3" {...S} />
    </>
  ),
  ledger: (
    <>
      <path d="M12 3v18M7 21h10" {...S} />
      <path d="M4 7h16" {...S} />
      <path d="M6.5 7L4 13h5zM17.5 7L15 13h5z" {...S} strokeWidth={1.5} />
      <path d="M4 13a2.5 1.5 0 005 0M15 13a2.5 1.5 0 005 0" {...S} strokeWidth={1.5} />
    </>
  ),
  chronicle: (
    <>
      <path d="M7 4h11a2 2 0 012 2v0a2 2 0 01-2 2h-1v10a2 2 0 01-2 2H6a2 2 0 01-2-2v0a2 2 0 012-2h1z" {...S} />
      <path d="M7 4v12M10 9h4M10 12h4" {...S} />
    </>
  ),
  saga: (
    <>
      <path d="M8 21V7.5C8 5 9.8 3 12 3s4 2 4 4.5V21z" {...S} />
      <path d="M12 7v10M12 9l2-1.5M12 12l-2-1.5M12 14.5l2-1.5" {...S} strokeWidth={1.4} />
      <path d="M5 21h14" {...S} />
    </>
  ),
  codex: (
    <>
      <path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6z" {...S} />
      <path d="M12 6v14.5" {...S} />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" {...S} />,
  inbox: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" {...S} />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" {...S} />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" {...S} strokeWidth={2.2} />,
  check: <path d="M4.5 12.5l4.5 4.5 10-10" {...S} strokeWidth={2.2} />,
  warning: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" {...S} />
      <path d="M12 9.5v5" {...S} strokeWidth={2.2} />
      <circle cx="12" cy="17.3" r="1.1" {...F} />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" {...S} />
      <path d="M12 11v6" {...S} strokeWidth={2.2} />
      <circle cx="12" cy="7.6" r="1.2" {...F} />
    </>
  ),
  critical: (
    <>
      <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" {...S} />
      <path d="M12 7.5v6" {...S} strokeWidth={2.2} />
      <circle cx="12" cy="16.6" r="1.2" {...F} />
    </>
  ),
  important: (
    <>
      <path d="M5 21V4" {...S} />
      <path d="M5 4.5h12l-2.5 4 2.5 4H5" {...S} />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" {...S} />
      <path
        d="M12 2.8l1.6 2.4 2.8-.7.7 2.8 2.4 1.6-1.2 2.6 1.2 2.6-2.4 1.6-.7 2.8-2.8-.7L12 21.2l-1.6-2.4-2.8.7-.7-2.8-2.4-1.6 1.2-2.6-1.2-2.6 2.4-1.6.7-2.8 2.8.7z"
        {...S}
      />
    </>
  ),
  save: (
    <>
      <path d="M3.5 9.5h17v10.5h-17z" {...S} />
      <path d="M3.5 9.5L5.5 5h13l2 4.5" {...S} />
      <path d="M10 13.5h4" {...S} strokeWidth={2.2} />
    </>
  ),
  load: (
    <>
      <path d="M3.5 11h17v9h-17z" {...S} />
      <path d="M12 3v11M8 7l4-4 4 4" {...S} />
    </>
  ),
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" {...S} />
      <circle cx="8" cy="8" r="1.4" {...F} />
      <circle cx="16" cy="8" r="1.4" {...F} />
      <circle cx="12" cy="12" r="1.4" {...F} />
      <circle cx="8" cy="16" r="1.4" {...F} />
      <circle cx="16" cy="16" r="1.4" {...F} />
    </>
  ),
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" {...F} />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" {...S} />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" {...S} />,
  chevronDown: <path d="M6 9l6 6 6-6" {...S} />,
  chevronUp: <path d="M6 15l6-6 6 6" {...S} />,
  chevronLeft: <path d="M15 6l-6 6 6 6" {...S} />,
  chevronRight: <path d="M9 6l6 6-6 6" {...S} />,
  ship: (
    <>
      <path d="M2.5 15.5c3 3.2 16 3.2 19 0l-1-1.5H3.5z" {...S} />
      <path d="M2.5 15.5L1.5 12M21.5 15.5l1-3.5" {...S} />
      <path d="M12 14V3.5" {...S} />
      <path d="M12 4.5c3.5.8 5.5 2.6 6 6.5H12z" {...S} />
    </>
  ),
  sword: (
    <>
      <path d="M14.5 3.5H20.5V9.5L9 21 3 15z" {...S} />
      <path d="M6 12l6 6M3.5 20.5l2.5-2.5" {...S} />
    </>
  ),
  crown: <path d="M3 18h18M4 16l-1-9 5 4 4-6 4 6 5-4-1 9z" {...S} />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" {...S} />
      <path d="M10 20.5a2 2 0 004 0" {...S} />
    </>
  ),
  quill: (
    <>
      <path d="M20 3.5C11 4.5 6.5 10 5 20.5 8 15 12 11 20 3.5z" {...S} />
      <path d="M5 20.5L3.5 22M9 13h5" {...S} />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" {...S} />
      <circle cx="12" cy="12" r="3" {...S} />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" {...S} />
      <path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" {...S} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" {...S} />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" {...S} />
    </>
  ),
  wind: <path d="M3 9h11a3 3 0 10-3-3M3 13h15a3 3 0 11-3 3M3 17h7" {...S} />,
  moon: <path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" {...S} />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" {...S} />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" {...S} strokeWidth={2.2} />,
  minus: <path d="M5 12h14" {...S} strokeWidth={2.2} />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" {...S} />
      <path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10" {...S} />
    </>
  ),
  gamepad: (
    <>
      <path d="M7 8h10a4.5 4.5 0 014.4 5.4l-.8 3.7a2 2 0 01-3.4.9L15 15.5H9L6.8 18a2 2 0 01-3.4-.9l-.8-3.7A4.5 4.5 0 017 8z" {...S} />
      <path d="M7.5 11v3M6 12.5h3" {...S} />
      <circle cx="16" cy="11.5" r="1" {...F} />
      <circle cx="18" cy="13.5" r="1" {...F} />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" {...S} />
      <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" {...S} />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" {...S} />
      <path d="M6.5 9l3 3-3 3M12 15h5" {...S} />
    </>
  ),
  reset: (
    <>
      <path d="M4.5 12a7.5 7.5 0 102.2-5.3" {...S} />
      <path d="M4 3.5v4h4" {...S} />
    </>
  ),
  link: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" {...S} />
      <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" {...S} />
    </>
  ),
  feather: <path d="M20 4c-6 0-12 4-14 12l-2 4 4-2C16 16 20 10 20 4zM6 16l8-8" {...S} />,
  shieldRound: (
    <>
      <circle cx="12" cy="12" r="9" {...S} />
      <circle cx="12" cy="12" r="2.2" {...F} />
      <path d="M12 3v6.8M12 14.2V21M3 12h6.8M14.2 12H21" {...S} strokeWidth={1.2} />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof ICONS;

/** Every icon name (dev gallery and tests). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Size in em (default 1.15). */
  size?: number;
  /** Accessible label; omit for decorative icons. */
  label?: string;
}

/** An inline SVG icon that inherits the text colour. */
export function Icon({ name, size = 1.15, label, className, ...rest }: IconProps): ReactElement {
  const dim = `${size}em`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={dim}
      height={dim}
      className={['icon', className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
