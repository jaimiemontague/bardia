/**
 * The backdrop layers every scene shares: the SVG canvas with its gradients, the sky (stars, sun or moon,
 * clouds), far hills, the sea with a slow swell and glitter, fog banks and rain. Animated parts carry
 * `scn-*` classes (scenes.css), which reduced motion switches off.
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { aerial, mix, rng, shade, VIEW_H, VIEW_W, type Light } from './paint';

/** A DOM-safe id prefix for one scene's gradients (several scenes may be on screen in the gallery). */
export function useSceneUid(): string {
  return `scn${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** The scene canvas: 1600 × 900, sliced to fill its box, decorative for assistive tech. */
export function SceneSvg({ uid, light, horizon, children, testId }: { uid: string; light: Light; horizon: number; children: ReactNode; testId?: string }): ReactElement {
  return (
    <svg className="scn-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-testid={testId} data-tod={light.tod}>
      <defs>
        <linearGradient id={`${uid}-sky`} gradientUnits="userSpaceOnUse" x1="0" y1="-60" x2="0" y2={horizon}>
          <stop offset="0" stopColor={light.sky[0]} />
          <stop offset="0.42" stopColor={light.sky[1]} />
          <stop offset="0.8" stopColor={light.sky[2]} />
          <stop offset="1" stopColor={light.sky[3]} />
        </linearGradient>
        <linearGradient id={`${uid}-sea`} gradientUnits="userSpaceOnUse" x1="0" y1={horizon} x2="0" y2={VIEW_H}>
          <stop offset="0" stopColor={light.sea[0]} />
          <stop offset="0.22" stopColor={light.sea[1]} />
          <stop offset="1" stopColor={light.sea[2]} />
        </linearGradient>
        <linearGradient id={`${uid}-haze`} gradientUnits="userSpaceOnUse" x1="0" y1={horizon - 160} x2="0" y2={horizon + 60}>
          <stop offset="0" stopColor={light.haze} stopOpacity="0" />
          <stop offset="0.7" stopColor={light.haze} stopOpacity={0.55 * light.hazeAmount + 0.1} />
          <stop offset="1" stopColor={light.haze} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-orb`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={light.orb.glow} />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <radialGradient id={`${uid}-lamp`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,176,84,0.75)" />
          <stop offset="0.4" stopColor="rgba(255,150,60,0.25)" />
          <stop offset="1" stopColor="rgba(255,140,50,0)" />
        </radialGradient>
        <radialGradient id={`${uid}-fire`} cx="0.5" cy="0.6" r="0.5">
          <stop offset="0" stopColor="rgba(255,190,90,0.9)" />
          <stop offset="0.35" stopColor="rgba(240,110,40,0.45)" />
          <stop offset="1" stopColor="rgba(200,60,20,0)" />
        </radialGradient>
        <linearGradient id={`${uid}-vignette`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.35" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>
      {children}
      <rect x={-200} y={-200} width={VIEW_W + 400} height={VIEW_H + 400} fill={`url(#${uid}-vignette)`} pointerEvents="none" />
    </svg>
  );
}

/** Sky, stars, the sun or moon, and two decks of cloud. */
export function Sky({ uid, light, horizon, seed }: { uid: string; light: Light; horizon: number; seed: number }): ReactElement {
  const r = rng(seed ^ 0x51ed);
  const stars: ReactElement[] = [];
  if (light.stars > 0) {
    for (let i = 0; i < 70; i++) {
      const x = r() * (VIEW_W + 200) - 100;
      const y = r() * (horizon - 120) - 40;
      stars.push(<circle key={i} cx={x} cy={y} r={r() < 0.12 ? 1.9 : 1.1} fill="#f1e8d4" opacity={light.stars * (0.35 + r() * 0.65) * (1 - y / horizon)} />);
    }
  }
  const clouds: ReactElement[] = [];
  const n = 6 + Math.round(light.cloudOpacity * 6);
  for (let i = 0; i < n; i++) {
    const cx = r() * (VIEW_W + 400) - 200;
    const cy = 60 + r() * (horizon - 190);
    const w = 160 + r() * 340 * (0.6 + cy / horizon);
    const h = w * (0.12 + r() * 0.08);
    const lit = cy / horizon;
    clouds.push(
      <g key={i} className={i % 2 === 0 ? 'scn-cloud' : 'scn-cloud scn-cloud-b'} opacity={light.cloudOpacity * (0.5 + 0.5 * lit)}>
        <path
          d={`M${cx - w / 2} ${cy} q ${w * 0.12} ${-h * 1.4} ${w * 0.3} ${-h * 0.7} q ${w * 0.14} ${-h * 1.3} ${w * 0.34} ${-h * 0.4} q ${w * 0.2} ${-h * 0.6} ${w * 0.36} ${h * 1.1} Z`}
          fill={mix(light.cloud, light.cloudLit, lit * 0.7)}
        />
        <path d={`M${cx - w * 0.42} ${cy - 1} L${cx + w * 0.46} ${cy - 1} L${cx + w * 0.38} ${cy + h * 0.25} L${cx - w * 0.3} ${cy + h * 0.25} Z`} fill={light.cloudLit} opacity={0.35 * lit} />
      </g>,
    );
  }
  const o = light.orb;
  return (
    <g>
      <rect x={-200} y={-200} width={VIEW_W + 400} height={horizon + 220} fill={`url(#${uid}-sky)`} />
      {stars}
      {!light.rain && <circle cx={o.x} cy={o.y} r={o.r * 7} fill={`url(#${uid}-orb)`} />}
      {!light.rain && <circle cx={o.x} cy={o.y} r={o.r} fill={o.colour} opacity={o.moon ? 0.92 : 0.88} />}
      {!light.rain && o.moon && <circle cx={o.x + o.r * 0.42} cy={o.y - o.r * 0.18} r={o.r * 0.92} fill={light.sky[1]} opacity="0.9" />}
      {clouds}
    </g>
  );
}

/** A ridge line across the view (mountains far off, or hills), seeded. */
export function Ridge({ y, height, colour, seed, roughness = 1, snowCaps = false, step = 60 }: { y: number; height: number; colour: string; seed: number; roughness?: number; snowCaps?: boolean; step?: number }): ReactElement {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let x = -260; x <= VIEW_W + 260; x += step * (0.6 + r() * 0.8)) pts.push([x, y - height * (0.25 + r() * 0.75 * roughness)]);
  const d = `M-260 ${y + 40} ${pts.map(([x, py]) => `L${x.toFixed(1)} ${py.toFixed(1)}`).join(' ')} L${VIEW_W + 260} ${y + 40} Z`;
  const caps = snowCaps
    ? pts
        .filter(([, py]) => py < y - height * 0.7)
        .map(([x, py], i) => <path key={i} d={`M${x - 26} ${py + 22} L${x} ${py} L${x + 26} ${py + 22} L${x + 10} ${py + 16} L${x} ${py + 24} L${x - 12} ${py + 15} Z`} fill="#e8ecf0" opacity="0.55" />)
    : null;
  return (
    <g>
      <path d={d} fill={colour} />
      {caps}
    </g>
  );
}

/** The sea from the horizon down, with swell bands that drift and a path of light under the sun or moon. */
export function Sea({ uid, light, horizon, top = horizon }: { uid: string; light: Light; horizon: number; top?: number }): ReactElement {
  const bands: ReactElement[] = [];
  const crest = mix(light.sea[0], '#ffffff', light.tod === 'night' ? 0.12 : 0.28);
  const trough = shade(light.sea[1], 0.35);
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const y = horizon + 6 + Math.pow(t, 1.7) * (VIEW_H - horizon + 40);
    const wl = 40 + t * 260;
    const amp = (1.5 + t * 9) * (0.5 + light.rough);
    let d = `M${-wl * 2} ${y}`;
    for (let x = -wl * 2; x < VIEW_W + wl * 2; x += wl) d += ` q ${wl / 4} ${-amp} ${wl / 2} 0 t ${wl / 2} 0`;
    bands.push(
      <g key={i} className={`scn-swell scn-swell-${i % 3}`} style={{ ['--swell' as string]: `${wl}px` }}>
        <path d={d} stroke={i % 2 === 0 ? crest : trough} strokeWidth={0.8 + t * 3.2} fill="none" opacity={(0.1 + t * 0.22) * (0.7 + light.rough * 0.6)} />
      </g>,
    );
  }
  const caps: ReactElement[] = [];
  if (light.rough >= 0.6) {
    const r = rng(77);
    for (let i = 0; i < 26; i++) {
      const t = r();
      const y = horizon + 10 + Math.pow(t, 1.6) * (VIEW_H - horizon);
      const x = r() * VIEW_W;
      const w = 6 + t * 46;
      caps.push(<path key={i} className="scn-cap" d={`M${x} ${y} q ${w / 2} ${-w * 0.25} ${w} 0`} stroke="#eef0ee" strokeWidth={1 + t * 2} fill="none" opacity={0.35 + 0.25 * t} />);
    }
  }
  const o = light.orb;
  const glitter = o.glow !== 'rgba(0,0,0,0)' && !light.rain;
  const glint = o.moon ? 0.55 : 1;
  const dashes: ReactElement[] = [];
  if (glitter) {
    const r = rng(9);
    for (let i = 0; i < 34; i++) {
      const t = r();
      const y = horizon + 4 + Math.pow(t, 1.3) * (VIEW_H - horizon) * 0.8;
      const spread = 30 + t * 220;
      const x = o.x + (r() - 0.5) * spread * 2;
      dashes.push(<rect key={i} className="scn-glint" x={x} y={y} width={8 + t * 50} height={1 + t * 2.5} fill={o.colour} opacity={(0.18 + 0.4 * (1 - t)) * glint} style={{ animationDelay: `${(i % 7) * 0.5}s` }} />);
    }
  }
  return (
    <g>
      <rect x={-200} y={top} width={VIEW_W + 400} height={VIEW_H - top + 200} fill={`url(#${uid}-sea)`} />
      {glitter && <path d={`M${o.x - 26} ${horizon} L${o.x + 26} ${horizon} L${o.x + 260} ${VIEW_H + 40} L${o.x - 260} ${VIEW_H + 40} Z`} fill={o.colour} opacity={(light.tod === 'day' ? 0.08 : 0.12) * glint} />}
      {bands}
      {dashes}
      {caps}
    </g>
  );
}

/** A haze band along the horizon (thicker in fog). */
export function HorizonHaze({ uid, light, horizon }: { uid: string; light: Light; horizon: number }): ReactElement {
  return <rect x={-200} y={horizon - 160} width={VIEW_W + 400} height={220} fill={`url(#${uid}-haze)`} pointerEvents="none" />;
}

/** Drifting fog over the middle distance. */
export function FogBank({ light, y, opacity = 0.5 }: { light: Light; y: number; opacity?: number }): ReactElement {
  return (
    <g className="scn-fog" opacity={opacity} pointerEvents="none">
      {[0, 1, 2, 3, 4].map((i) => (
        <ellipse key={i} cx={-100 + i * 440} cy={y + (i % 2) * 30} rx={420} ry={70 + (i % 3) * 20} fill={light.haze} opacity={0.55} />
      ))}
    </g>
  );
}

/** Slanting rain over the whole picture. */
export function Rain({ light }: { light: Light }): ReactElement {
  const r = rng(404);
  const lines: ReactElement[] = [];
  for (let i = 0; i < 110; i++) {
    const x = r() * (VIEW_W + 300) - 150;
    const y = r() * VIEW_H;
    const l = 24 + r() * 40;
    lines.push(<line key={i} x1={x} y1={y} x2={x - l * 0.35} y2={y + l} />);
  }
  return (
    <g className="scn-rain" stroke={mix(light.haze, '#ffffff', 0.4)} strokeWidth={1.2} opacity={0.32} pointerEvents="none">
      {lines}
    </g>
  );
}

/** A rising smoke plume that widens as it climbs and leans with the wind (dark for a burning place). */
export function Smoke({ x, y, h, w = 12, dark = false, light, delay = 0 }: { x: number; y: number; h: number; w?: number; dark?: boolean; light: Light; delay?: number }): ReactElement {
  const colour = dark ? '#1b1715' : aerial(light, light.tod === 'night' ? '#5a5a62' : '#c8beb2', 0.3);
  // Centre line: a cubic that drifts right as it rises.
  const P = [
    [x, y],
    [x - w, y - h * 0.35],
    [x + w * 1.8, y - h * 0.6],
    [x + w * 2.4, y - h],
  ] as const;
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    const bx = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
    const by = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
    return [bx, by];
  };
  const left: string[] = [];
  const right: string[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [cx, cy] = at(t);
    const half = (w * (dark ? 0.8 : 0.45)) * (1 + t * (dark ? 2.2 : 2.2)) * (1 + 0.15 * Math.sin(i * 1.7));
    left.push(`${(cx - half).toFixed(1)} ${cy.toFixed(1)}`);
    right.unshift(`${(cx + half).toFixed(1)} ${cy.toFixed(1)}`);
  }
  return (
    <path
      className={dark ? 'scn-smoke scn-smoke-dark' : 'scn-smoke'}
      style={{ animationDelay: `${delay}s` }}
      d={`M${left.join(' L')} L${right.join(' L')} Z`}
      fill={colour}
      opacity={dark ? 0.38 : 0.2}
    />
  );
}
