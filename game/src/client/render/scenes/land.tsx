/**
 * Land for the scenes: people (fighting men, townsfolk) as silhouettes, trees and a wood's edge, and the
 * heath with a road winding off toward the horizon, seen from where the war-band stands.
 */
import type { ReactElement } from 'react';
import { aerial, BONE, INK, mix, rng, shade, VIEW_W, type Light } from './paint';

/**
 * One person as a silhouette: a hooded or helmeted head, shoulders and a tunic that flares at the hem, two
 * legs in stride, an arm holding a spear, a bow or a banner, a round shield on the other arm. Rim-lit by
 * the sky behind when near.
 */
export function Figure({ x, y, h, colour, shield, gear = 'spear', light, distance, flip = false }: { x: number; y: number; h: number; colour: string; shield?: string; gear?: 'spear' | 'bow' | 'none' | 'banner'; light: Light; distance: number; flip?: boolean }): ReactElement {
  const dim = light.tod === 'day' ? 0 : light.tod === 'night' ? 0.5 : 0.25;
  const c = (col: string) => aerial(light, shade(col, dim), distance);
  const body = c(colour);
  const ink = c(INK);
  const rim = h > 60 ? <path d={silhouette(h)} fill="none" stroke={light.rim} strokeWidth={Math.max(1, h * 0.012)} opacity={0.32} /> : null;
  const s = flip ? -1 : 1;
  const armed = gear !== 'none';
  const pole = Math.max(0.8, h * 0.03);
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s} 1)`}>
      {gear === 'spear' && (
        <g>
          <line x1={h * 0.2} y1={-h * 0.05} x2={h * 0.26} y2={-h * 1.32} stroke={c('#2a2018')} strokeWidth={pole} />
          <path d={`M${h * 0.26} ${-h * 1.42} l ${-h * 0.035} ${h * 0.11} l ${h * 0.07} 0 Z`} fill={c('#a4a8aa')} />
        </g>
      )}
      {gear === 'banner' && (
        <g>
          <line x1={h * 0.2} y1={-h * 0.05} x2={h * 0.2} y2={-h * 1.6} stroke={c('#2a2018')} strokeWidth={pole} />
          <path className="scn-flag" d={`M${h * 0.2} ${-h * 1.6} L${h * 0.72} ${-h * 1.52} L${h * 0.58} ${-h * 1.4} L${h * 0.72} ${-h * 1.28} L${h * 0.2} ${-h * 1.24} Z`} fill={c(shield ?? colour)} />
        </g>
      )}
      {gear === 'bow' && <path d={`M${h * 0.2} ${-h * 1.08} Q ${h * 0.42} ${-h * 0.66} ${h * 0.2} ${-h * 0.24}`} stroke={c('#3a2a1c')} strokeWidth={pole} fill="none" />}
      {gear === 'bow' && <line x1={h * 0.2} y1={-h * 1.08} x2={h * 0.2} y2={-h * 0.24} stroke={c('#9a8a70')} strokeWidth={pole * 0.4} />}
      <path d={silhouette(h)} fill={body} />
      {armed && <path d={`M${-h * 0.04} ${-h * 1.0} Q 0 ${-h * 1.1} ${h * 0.05} ${-h * 1.0} L${h * 0.07} ${-h * 0.93} L${-h * 0.07} ${-h * 0.93} Z`} fill={c('#4a4844')} />}
      {rim}
      {shield && (
        <g>
          <circle cx={-h * 0.1} cy={-h * 0.6} r={h * 0.2} fill={c(shield)} stroke={ink} strokeWidth={Math.max(0.6, h * 0.022)} />
          {h > 40 && <circle cx={-h * 0.1} cy={-h * 0.6} r={h * 0.17} fill="none" stroke={c(shade(shield, 0.35))} strokeWidth={Math.max(0.5, h * 0.012)} />}
          <circle cx={-h * 0.1} cy={-h * 0.6} r={h * 0.045} fill={c('#8a8478')} />
        </g>
      )}
    </g>
  );
}

/** The outline of a standing figure, feet at 0, head at -h. */
function silhouette(h: number): string {
  const k = (v: number) => (v * h).toFixed(1);
  return [
    `M${k(-0.115)} 0 L${k(-0.075)} ${k(-0.36)}`,
    `L${k(-0.15)} ${k(-0.4)} L${k(-0.13)} ${k(-0.62)} Q ${k(-0.14)} ${k(-0.78)} ${k(-0.07)} ${k(-0.81)}`,
    `L${k(-0.04)} ${k(-0.84)} Q ${k(-0.075)} ${k(-0.93)} ${k(-0.03)} ${k(-0.99)} Q 0 ${k(-1.01)} ${k(0.03)} ${k(-0.99)} Q ${k(0.075)} ${k(-0.93)} ${k(0.04)} ${k(-0.84)}`,
    `L${k(0.07)} ${k(-0.81)} Q ${k(0.14)} ${k(-0.78)} ${k(0.15)} ${k(-0.7)} L${k(0.2)} ${k(-0.5)} L${k(0.17)} ${k(-0.48)} L${k(0.12)} ${k(-0.62)}`,
    `L${k(0.15)} ${k(-0.4)} L${k(0.075)} ${k(-0.36)} L${k(0.13)} 0 L${k(0.06)} 0 L${k(0.01)} ${k(-0.3)} L${k(-0.04)} 0 Z`,
  ].join(' ');
}

/** A conifer or a broadleaf tree. */
export function Tree({ x, y, h, colour, kind = 'pine' }: { x: number; y: number; h: number; colour: string; kind?: 'pine' | 'oak' }): ReactElement {
  if (kind === 'oak') {
    return (
      <g>
        <line x1={x} y1={y} x2={x} y2={y - h * 0.45} stroke={shade(colour, 0.3)} strokeWidth={h * 0.07} />
        <ellipse cx={x} cy={y - h * 0.62} rx={h * 0.34} ry={h * 0.3} fill={colour} />
        <ellipse cx={x - h * 0.16} cy={y - h * 0.52} rx={h * 0.22} ry={h * 0.2} fill={colour} />
      </g>
    );
  }
  return <path d={`M${x} ${y - h} L${x + h * 0.2} ${y - h * 0.55} L${x + h * 0.12} ${y - h * 0.55} L${x + h * 0.27} ${y - h * 0.12} L${x - h * 0.27} ${y - h * 0.12} L${x - h * 0.12} ${y - h * 0.55} L${x - h * 0.2} ${y - h * 0.55} Z M${x - h * 0.03} ${y - h * 0.12} L${x + h * 0.03} ${y - h * 0.12} L${x + h * 0.03} ${y} L${x - h * 0.03} ${y} Z`} fill={colour} />;
}

/** A wood's edge: a band of trees along a line, fading with distance. */
export function Woods({ x0, x1, y, h, light, distance, seed, snow = false }: { x0: number; x1: number; y: number; h: number; light: Light; distance: number; seed: number; snow?: boolean }): ReactElement {
  const r = rng(seed);
  const trees: ReactElement[] = [];
  const base = aerial(light, mix('#1d2a1a', light.mid, 0.4), distance);
  for (let x = x0; x < x1; x += h * (0.16 + r() * 0.16)) {
    const th = h * (0.7 + r() * 0.5);
    const ty = y + r() * h * 0.12;
    trees.push(<Tree key={trees.length} x={x} y={ty} h={th} colour={shade(base, r() * 0.25)} kind={r() < 0.2 ? 'oak' : 'pine'} />);
    if (snow && r() < 0.6) trees.push(<path key={`s${trees.length}`} d={`M${x - th * 0.1} ${ty - th * 0.62} L${x} ${ty - th * 0.9} L${x + th * 0.1} ${ty - th * 0.62} Z`} fill="#e6eaee" opacity={0.5} />);
  }
  return <g>{trees}</g>;
}

/** Heath and a track winding from the foreground off to the horizon. */
export function Heath({ light, horizon, seed }: { light: Light; horizon: number; seed: number }): ReactElement {
  const r = rng(seed);
  const ground = light.snow ? mix(light.mid, '#c9ced2', 0.4) : mix(light.mid, '#3c3a22', 0.45);
  const nearGround = light.snow ? mix(light.near, '#a8b0b6', 0.35) : mix(light.near, '#2a2614', 0.5);
  const road = mix(ground, light.snow ? '#e6e8ea' : '#8a7a58', 0.45);
  const tufts: ReactElement[] = [];
  for (let i = 0; i < 70; i++) {
    const t = r();
    const y = horizon + 30 + Math.pow(t, 1.5) * 480;
    const x = r() * (VIEW_W + 200) - 100;
    const w = 6 + t * 40;
    tufts.push(<path key={i} d={`M${x - w} ${y} Q ${x - w * 0.3} ${y - w * 0.9} ${x} ${y - w * 0.2} Q ${x + w * 0.4} ${y - w} ${x + w} ${y} Z`} fill={shade(nearGround, 0.1 + r() * 0.2)} opacity={0.75} />);
  }
  return (
    <g>
      <path d={`M-200 ${horizon + 40} C 300 ${horizon + 10}, 700 ${horizon + 50}, 1000 ${horizon + 24} C 1250 ${horizon + 6}, 1500 ${horizon + 30}, ${VIEW_W + 200} ${horizon + 16} L${VIEW_W + 200} 1100 L-200 1100 Z`} fill={ground} />
      <path d={`M-200 ${horizon + 190} C 300 ${horizon + 150}, 900 ${horizon + 220}, ${VIEW_W + 200} ${horizon + 170} L${VIEW_W + 200} 1100 L-200 1100 Z`} fill={nearGround} />
      {/* The track: wide at our feet, a thread on the far rise. */}
      <path d={`M560 1000 C 700 860, 1180 800, 1060 ${horizon + 120} C 980 ${horizon + 80}, 1120 ${horizon + 50}, 1100 ${horizon + 24} L1110 ${horizon + 24} C 1140 ${horizon + 52}, 1010 ${horizon + 84}, 1110 ${horizon + 120} C 1280 790, 980 880, 900 1000 Z`} fill={road} opacity={0.75} />
      {tufts}
    </g>
  );
}

/** Our own spears and a shield rim at the bottom of the view (the band we stand among). */
export function OwnSpears({ light, colour }: { light: Light; colour: string }): ReactElement {
  const dark = shade(mix('#2a2018', light.sky[1], 0.1), 0.2);
  return (
    <g>
      {[1260, 1340, 1430, 1510].map((x, i) => (
        <g key={x}>
          <line x1={x - 30} y1={980} x2={x + 20} y2={520 + i * 30} stroke={dark} strokeWidth={9} strokeLinecap="round" />
          <path d={`M${x + 20} ${520 + i * 30} l -8 46 l 18 2 Z`} fill={mix('#8a9096', light.rim, 0.25)} />
        </g>
      ))}
      <circle cx={1440} cy={1010} r={250} fill={shade(colour, 0.45)} stroke={INK} strokeWidth={8} />
      <circle cx={1440} cy={1010} r={232} fill="none" stroke={shade(BONE, 0.5)} strokeWidth={10} opacity={0.6} />
      <circle cx={1440} cy={1010} r={250} fill="none" stroke={light.rim} strokeWidth={3} opacity={0.35} />
      <circle cx={1440} cy={1010} r={40} fill={mix('#6f6a62', light.rim, 0.2)} stroke={INK} strokeWidth={5} />
    </g>
  );
}
