/**
 * Top-down sprite placeholders for the tactical battle and the sea battle (design §27.2):
 *   unitSprite — one soldier/rider/animal seen from above, culture-coloured shield and cloth, team
 *                ring for readability; animation strips (idle, walk, attack, shoot, die, rout) laid
 *                out horizontally when the manifest entry has `frames`.
 *   shipSprite — a hull seen from above (bow up) with oars, yard and square sail, shields along the
 *                gunwales and crew; damage and fire states.
 * Simple readable shapes first (§27.1 "clear silhouettes"); painted texture is kept light so many
 * sprites on screen stay cheap.
 */
import type { CultureId, ShipTypeId } from '@content/schemas/ids';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { circle, el, ellipse, g, line, linearGradient, n, n2, path, radialGradient, rect, svgDoc } from '../svg/svg';
import { CULTURE_PALETTE, mix, shade } from '../svg/palette';
import { watermark } from '../svg/paint';
import { ArtRng } from '../svg/rng';
import { num, oneOf, seedOf } from './params';

const ALL_CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese', 'isafolder', 'rime'];

/** Visual unit archetypes (balance.units ids map onto these). */
export const UNIT_KINDS = ['spear', 'axe', 'sword', 'bow', 'javelin', 'berserker', 'wolfcoat', 'rider', 'horseArcher', 'levy', 'wolf', 'bear'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** balance.units id → archetype. */
export const UNIT_KIND_OF: Readonly<Record<string, UnitKind>> = {
  bondi: 'levy',
  huscarls: 'axe',
  archers: 'bow',
  skirmishers: 'javelin',
  berserkers: 'berserker',
  wolfcoats: 'wolfcoat',
  fjordWallHuscarls: 'axe',
  elkBowArchers: 'bow',
  strandRiders: 'rider',
  fyrdSpearmen: 'spear',
  thegns: 'sword',
  albricBowmen: 'bow',
  caelRaiders: 'javelin',
  cloisterGuard: 'levy',
  horsemen: 'rider',
  javelinmen: 'javelin',
  menAtArms: 'sword',
  horseArchers: 'horseArcher',
  steppeHorseArchers: 'horseArcher',
  druzhina: 'sword',
  emberGuard: 'sword',
  outlaws: 'javelin',
  barrowWardens: 'spear',
  hermitClan: 'levy',
  wolfPack: 'wolf',
  greatBear: 'bear',
  wreckers: 'levy',
};

export const UNIT_ANIMS = ['idle', 'walk', 'attack', 'shoot', 'die', 'rout'] as const;
export type UnitAnim = (typeof UNIT_ANIMS)[number];
export const TEAMS = ['player', 'enemy', 'ally', 'neutral'] as const;
export type Team = (typeof TEAMS)[number];

/** Colour-blind-safe team rings (§27.1 readability). */
export const TEAM_COLOURS: Readonly<Record<Team, string>> = { player: '#3b82c4', enemy: '#d0602a', ally: '#5aa05a', neutral: '#c8c0a8' };

interface UnitLook {
  kind: UnitKind;
  culture: CultureId;
  team: Team;
  cloth: string;
  skin: string;
  hair: string;
  helmet: boolean;
  shieldA: string;
  shieldB: string;
  pattern: number;
  metal: string;
}

function unitLook(kind: UnitKind, culture: CultureId, team: Team, seed: number): UnitLook {
  const pal = CULTURE_PALETTE[culture];
  const r = new ArtRng(`unit|${kind}|${culture}|${seed}`);
  return {
    kind,
    culture,
    team,
    cloth: shade(r.pick(pal.cloth), r.range(-0.1, 0.05)),
    skin: r.pick(['#e8c4a4', '#d8a882', '#c8936c', '#b07a56']),
    hair: r.pick(['#c8a35e', '#8a6440', '#5e4028', '#3e2a1a']),
    helmet: kind === 'sword' || kind === 'axe' || kind === 'spear' || (kind === 'rider' && r.chance(0.6)) || r.chance(0.25),
    shieldA: pal.primary,
    shieldB: pal.secondary,
    pattern: r.int(0, 3),
    metal: pal.metal,
  };
}

/** Shield seen from above/front: a disc with a culture pattern. */
function shieldDisc(cx: number, cy: number, r: number, l: UnitLook): string {
  const parts = [circle(cx, cy, r, { fill: l.shieldA, stroke: '#1a120c', 'stroke-width': n(r * 0.18) })];
  if (l.pattern === 1) parts.push(path(`M${n(cx - r)} ${n(cy)}H${n(cx + r)}M${n(cx)} ${n(cy - r)}V${n(cy + r)}`, { stroke: l.shieldB, 'stroke-width': n(r * 0.35) }));
  if (l.pattern === 2) parts.push(path(`M${n(cx)} ${n(cy)}L${n(cx)} ${n(cy - r)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(cy)}ZM${n(cx)} ${n(cy)}L${n(cx)} ${n(cy + r)}A${n(r)} ${n(r)} 0 0 1 ${n(cx - r)} ${n(cy)}Z`, { fill: l.shieldB }));
  if (l.pattern === 3) parts.push(circle(cx, cy, r * 0.62, { fill: 'none', stroke: l.shieldB, 'stroke-width': n(r * 0.25) }));
  parts.push(circle(cx, cy, r * 0.3, { fill: l.metal, stroke: '#1a120c', 'stroke-width': n(r * 0.08) }));
  return parts.join('');
}

/** One unit frame centred on (0,0), facing up (−y). `t` is the animation phase 0..1. */
function drawUnit(l: UnitLook, anim: UnitAnim, t: number, s: number): string {
  const out: string[] = [];
  const outline = '#140e0a';
  const sw = n2(0.9 * s);
  const step = anim === 'walk' || anim === 'rout' ? Math.sin(t * Math.PI * 2) : 0;
  const swing = anim === 'attack' ? Math.sin(t * Math.PI) : 0;
  const draw = anim === 'shoot' ? Math.sin(t * Math.PI) : 0;

  if (l.kind === 'wolf' || l.kind === 'bear') {
    const big = l.kind === 'bear';
    const fur = big ? '#4a3424' : '#7a7468';
    const bodyL = (big ? 15 : 11) * s;
    const bodyW = (big ? 9.5 : 5) * s;
    for (const [fx, fy, ph] of [[-1, -1, 0], [1, -1, 0.5], [-1, 1, 0.5], [1, 1, 0]] as const) {
      const off = Math.sin((t + ph) * Math.PI * 2) * (anim === 'walk' || anim === 'attack' ? 2.5 * s : 0);
      out.push(ellipse(fx * bodyW * 0.85, fy * bodyL * 0.55 + off, 2.2 * s * (big ? 1.4 : 1), 3 * s, { fill: shade(fur, -0.3) }));
    }
    out.push(ellipse(0, 0, bodyW, bodyL, { fill: fur, stroke: outline, 'stroke-width': sw }));
    out.push(ellipse(0, -bodyL * 0.15, bodyW * 0.6, bodyL * 0.55, { fill: shade(fur, 0.15), opacity: '0.6' }));
    const hy = -bodyL - (big ? 3.5 : 3) * s - swing * 3 * s;
    out.push(ellipse(0, hy, (big ? 6.5 : 3.6) * s, (big ? 6 : 5.5) * s, { fill: shade(fur, -0.1), stroke: outline, 'stroke-width': sw }));
    out.push(ellipse(0, hy - (big ? 5 : 4.5) * s, (big ? 3 : 1.6) * s, (big ? 2.4 : 2.6) * s, { fill: shade(fur, -0.45) }));
    for (const ex of [-1, 1]) out.push(circle(ex * (big ? 4.6 : 2.6) * s, hy + (big ? 2.5 : 2.6) * s, (big ? 1.8 : 1.3) * s, { fill: shade(fur, -0.25) }));
    if (!big) out.push(path(`M0 ${n(bodyL * 0.9)}Q${n(3 * s * step)} ${n(bodyL * 1.4)} ${n(-2 * s)} ${n(bodyL * 1.7)}`, { fill: 'none', stroke: fur, 'stroke-width': n(2.4 * s), 'stroke-linecap': 'round' }));
    return out.join('');
  }

  const mounted = l.kind === 'rider' || l.kind === 'horseArcher';
  if (mounted) {
    const horse = mix('#6a4a30', '#3a2a1c', (l.pattern % 2) * 0.6);
    for (const [fx, fy, ph] of [[-1, -1, 0], [1, -1, 0.5], [-1, 1, 0.5], [1, 1, 0]] as const) {
      const off = Math.sin((t + ph) * Math.PI * 2) * (anim === 'walk' ? 3 * s : 0);
      out.push(ellipse(fx * 4.2 * s, fy * 9 * s + off, 1.8 * s, 2.6 * s, { fill: shade(horse, -0.35) }));
    }
    out.push(ellipse(0, 1 * s, 5.6 * s, 13 * s, { fill: horse, stroke: outline, 'stroke-width': sw }));
    out.push(ellipse(0, -14 * s, 2.8 * s, 5.5 * s, { fill: shade(horse, 0.05), stroke: outline, 'stroke-width': sw }));
    out.push(path(`M0 ${n(-9 * s)}V${n(-17 * s)}`, { stroke: shade(horse, -0.5), 'stroke-width': n(1.6 * s) }));
    out.push(path(`M0 ${n(13 * s)}Q${n(2 * s * step)} ${n(18 * s)} 0 ${n(21 * s)}`, { fill: 'none', stroke: shade(horse, -0.4), 'stroke-width': n(2.4 * s), 'stroke-linecap': 'round' }));
  } else {
    for (const side of [-1, 1]) out.push(ellipse(side * 2.6 * s, side * step * 3.5 * s, 2 * s, 3 * s, { fill: '#3a2a1c' }));
  }
  // Torso (shoulders) and head.
  const bodyY = mounted ? -1 * s : 0;
  const lean = anim === 'attack' ? -swing * 1.5 * s : 0;
  out.push(ellipse(0, bodyY + lean, 8.2 * s, 5.2 * s, { fill: l.kind === 'berserker' ? mix(l.skin, '#7a5636', 0.35) : l.cloth, stroke: outline, 'stroke-width': sw }));
  if (l.kind === 'wolfcoat') out.push(ellipse(0, bodyY + 1.5 * s, 8.6 * s, 6 * s, { fill: '#7a7468', stroke: outline, 'stroke-width': sw }));
  if (l.kind === 'berserker') out.push(ellipse(0, bodyY + 1 * s, 8.8 * s, 5.8 * s, { fill: 'none', stroke: '#4a3424', 'stroke-width': n(2 * s) }));
  const hy = bodyY - 0.6 * s + lean;
  out.push(circle(0, hy, 3.7 * s, { fill: l.helmet ? mix(l.metal, '#8a9096', 0.5) : l.kind === 'wolfcoat' ? '#6a645a' : l.hair, stroke: outline, 'stroke-width': sw }));
  if (l.helmet) out.push(path(`M0 ${n(hy - 3.7 * s)}V${n(hy + 3.7 * s)}M${n(-3.7 * s)} ${n(hy)}H${n(3.7 * s)}`, { stroke: shade(l.metal, -0.4), 'stroke-width': n(0.7 * s) }));
  if (l.kind === 'wolfcoat') for (const ex of [-1, 1]) out.push(path(`M${n(ex * 2 * s)} ${n(hy - 2.5 * s)}L${n(ex * 3.6 * s)} ${n(hy - 5.5 * s)}L${n(ex * 3.8 * s)} ${n(hy - 2 * s)}Z`, { fill: '#6a645a', stroke: outline, 'stroke-width': n2(0.6 * s) }));

  // Weapons and shield.
  const wood = '#7a5228';
  const steel = '#c9ccd1';
  const armR = 6.5 * s;
  switch (l.kind) {
    case 'spear':
    case 'levy': {
      const reach = anim === 'attack' ? swing * 6 * s : 0;
      out.push(line(armR, bodyY + 4 * s - reach, armR, bodyY - 18 * s - reach, { stroke: wood, 'stroke-width': n(1.3 * s) }));
      out.push(path(`M${n(armR)} ${n(bodyY - 22 * s - reach)}l${n(1.3 * s)} ${n(4 * s)}h${n(-2.6 * s)}Z`, { fill: steel }));
      out.push(shieldDisc(-5.5 * s, bodyY - 3.5 * s, 5.2 * s, l));
      break;
    }
    case 'axe':
    case 'sword': {
      const a = -30 + swing * 110;
      const len = l.kind === 'axe' ? 13 : 11;
      const blade =
        l.kind === 'axe'
          ? [line(0, 0, 0, -len * s, { stroke: wood, 'stroke-width': n(1.3 * s) }), path(`M0 ${n(-len * s)}h${n(3.6 * s)}q${n(1 * s)} ${n(2.4 * s)} 0 ${n(4.4 * s)}h${n(-3.6 * s)}Z`, { fill: steel, stroke: outline, 'stroke-width': n2(0.5 * s) })]
          : [line(0, 0, 0, -len * s, { stroke: steel, 'stroke-width': n(1.5 * s) }), line(-2 * s, -1.6 * s, 2 * s, -1.6 * s, { stroke: shade(l.metal, -0.2), 'stroke-width': n(1.1 * s) })];
      out.push(g({ transform: `translate(${n(armR)} ${n(bodyY)}) rotate(${n(a)})` }, blade));
      out.push(shieldDisc(-5.5 * s, bodyY - 3.5 * s, 5.4 * s, l));
      break;
    }
    case 'bow':
    case 'horseArcher': {
      const pull = draw * 4 * s;
      out.push(path(`M${n(-7 * s)} ${n(bodyY - 6 * s)}Q0 ${n(bodyY - 13 * s)} ${n(7 * s)} ${n(bodyY - 6 * s)}`, { fill: 'none', stroke: wood, 'stroke-width': n(1.4 * s), 'stroke-linecap': 'round' }));
      out.push(path(`M${n(-7 * s)} ${n(bodyY - 6 * s)}L0 ${n(bodyY - 6 * s + pull)}L${n(7 * s)} ${n(bodyY - 6 * s)}`, { fill: 'none', stroke: '#e8dcc0', 'stroke-width': n2(0.5 * s) }));
      if (anim === 'shoot' || anim === 'idle') out.push(line(0, bodyY - 6 * s + pull, 0, bodyY - 16 * s + pull, { stroke: '#d8c8a2', 'stroke-width': n2(0.7 * s) }));
      out.push(rect(4 * s, bodyY + 1 * s, 2.6 * s, 6 * s, { fill: '#5a3e24', rx: n(0.8 * s) }));
      break;
    }
    case 'javelin': {
      const throwT = anim === 'attack' || anim === 'shoot' ? Math.max(swing, draw) : 0;
      out.push(line(armR, bodyY + 6 * s - throwT * 8 * s, armR + 1 * s, bodyY - 12 * s - throwT * 8 * s, { stroke: wood, 'stroke-width': n(1 * s) }));
      out.push(line(armR - 1.6 * s, bodyY + 4 * s, armR - 0.6 * s, bodyY - 10 * s, { stroke: wood, 'stroke-width': n(1 * s), opacity: '0.85' }));
      out.push(shieldDisc(-5 * s, bodyY - 3 * s, 4.2 * s, l));
      break;
    }
    case 'berserker':
    case 'wolfcoat': {
      for (const side of [-1, 1]) {
        const a = side * (-25 + swing * 80);
        out.push(g({ transform: `translate(${n(side * armR)} ${n(bodyY)}) rotate(${n(a)})` }, [line(0, 0, 0, -10 * s, { stroke: wood, 'stroke-width': n(1.2 * s) }), path(`M0 ${n(-10 * s)}h${n(side * 3 * s)}v${n(3.6 * s)}h${n(-side * 3 * s)}Z`, { fill: steel })]));
      }
      break;
    }
    case 'rider': {
      const reach = anim === 'attack' ? swing * 8 * s : 0;
      out.push(line(armR - 1 * s, bodyY + 8 * s - reach, armR + 1 * s, bodyY - 22 * s - reach, { stroke: wood, 'stroke-width': n(1.2 * s) }));
      out.push(path(`M${n(armR + 1 * s)} ${n(bodyY - 25 * s - reach)}l${n(1.2 * s)} ${n(3.6 * s)}h${n(-2.4 * s)}Z`, { fill: steel }));
      out.push(shieldDisc(-5.5 * s, bodyY - 1 * s, 4.6 * s, l));
      break;
    }
    default:
      break;
  }
  return out.join('');
}

/** Renders a unit sprite strip (frames laid out horizontally). */
export function unitSpriteSvg(opts: {
  unit?: string;
  kind?: UnitKind;
  culture?: CultureId;
  team?: Team;
  anim?: UnitAnim;
  facing?: number;
  frames?: number;
  width?: number;
  height?: number;
  seed?: number;
  ring?: boolean;
  watermark?: 'off' | 'corner' | 'full';
  label?: string;
}): string {
  const kind: UnitKind = opts.kind ?? (opts.unit && Object.hasOwn(UNIT_KIND_OF, opts.unit) ? (UNIT_KIND_OF[opts.unit] as UnitKind) : 'spear');
  const culture: CultureId = opts.culture ?? 'skarn';
  const team: Team = opts.team ?? 'player';
  const anim: UnitAnim = opts.anim ?? 'idle';
  const frames = Math.max(1, Math.min(32, Math.round(opts.frames ?? 1)));
  const fw = opts.width ?? 64;
  const fh = opts.height ?? 64;
  const V = 64;
  const look = unitLook(kind, culture, team, opts.seed ?? 1);
  const mountedOrBig = kind === 'rider' || kind === 'horseArcher' || kind === 'bear';
  const s = mountedOrBig ? 1.25 : 1.6;
  const cells: string[] = [];
  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? 0.25 : i / frames;
    const dead = anim === 'die';
    const fall = dead ? Math.min(1, t * 1.6 + (frames === 1 ? 1 : 0)) : 0;
    const facing = (opts.facing ?? 0) + (anim === 'rout' ? 180 : 0);
    const ring = opts.ring === false ? '' : ellipse(0, 0, mountedOrBig ? 20 : 14, mountedOrBig ? 20 : 14, { fill: TEAM_COLOURS[team], 'fill-opacity': n2(0.28 * (1 - fall * 0.7)), stroke: TEAM_COLOURS[team], 'stroke-width': 1.6, 'stroke-opacity': n2(0.9 * (1 - fall * 0.7)) });
    const shadow = ellipse(1.5, 2.5, mountedOrBig ? 16 : 10, mountedOrBig ? 22 : 9, { fill: '#000000', opacity: '0.28' });
    let fig = drawUnit(look, dead ? 'idle' : anim, t, s);
    if (dead) fig = g({ transform: `rotate(${n(fall * 80)}) scale(${n2(1 - fall * 0.1)} ${n2(1 - fall * 0.45)})`, opacity: n2(1 - fall * 0.25) }, fig) + ellipse(4, 6, 8 * fall, 5 * fall, { fill: '#3a1410', opacity: n2(0.45 * fall) });
    cells.push(g({ transform: `translate(${n(i * V + V / 2)} ${n(V / 2)})` }, [ring, g({ transform: `rotate(${n(facing)})` }, [shadow, fig])]));
  }
  const body = [...cells];
  if (opts.watermark && opts.watermark !== 'off') body.push(watermark(V * frames, V, opts.label, 'corner'));
  return svgDoc({ width: fw * frames, height: fh, viewBox: [0, 0, V * frames, V], body });
}

// ---------------------------------------------------------------------------------------------
// Ships

export const SHIP_TYPES: readonly ShipTypeId[] = ['karvi', 'snekkja', 'drakkar', 'knarr', 'galley', 'riverboat'];
export const SHIP_STATES = ['intact', 'damaged', 'burning', 'wrecked'] as const;
export type ShipState = (typeof SHIP_STATES)[number];
export const SAIL_STATES = ['set', 'furled'] as const;

interface HullSpec {
  len: number;
  beam: number;
  oars: number;
  tiers: number;
  ram: boolean;
  shields: boolean;
  sailW: number;
  crew: number;
  stern: number;
}

const HULLS: Readonly<Record<ShipTypeId, HullSpec>> = {
  karvi: { len: 150, beam: 34, oars: 7, tiers: 1, ram: false, shields: true, sailW: 50, crew: 12, stern: 0.5 },
  snekkja: { len: 172, beam: 32, oars: 10, tiers: 1, ram: false, shields: true, sailW: 54, crew: 18, stern: 0.5 },
  drakkar: { len: 184, beam: 40, oars: 13, tiers: 1, ram: false, shields: true, sailW: 70, crew: 26, stern: 0.5 },
  knarr: { len: 140, beam: 46, oars: 2, tiers: 1, ram: false, shields: false, sailW: 64, crew: 6, stern: 0.6 },
  galley: { len: 184, beam: 36, oars: 12, tiers: 2, ram: true, shields: false, sailW: 52, crew: 22, stern: 0.35 },
  riverboat: { len: 96, beam: 26, oars: 4, tiers: 1, ram: false, shields: false, sailW: 0, crew: 6, stern: 0.5 },
};

/** Renders a ship sprite (top-down, bow up). */
export function shipSpriteSvg(opts: {
  ship?: ShipTypeId;
  culture?: CultureId;
  team?: Team;
  state?: ShipState;
  sail?: 'set' | 'furled';
  oarPhase?: number;
  frames?: number;
  width?: number;
  height?: number;
  seed?: number;
  watermark?: 'off' | 'corner' | 'full';
  label?: string;
}): string {
  const type: ShipTypeId = opts.ship ?? 'karvi';
  const hs = HULLS[type];
  const culture: CultureId = opts.culture ?? (type === 'galley' ? 'saraleonese' : 'skarn');
  const pal = CULTURE_PALETTE[culture];
  const team: Team = opts.team ?? 'player';
  const state: ShipState = opts.state ?? 'intact';
  const sailSet = (opts.sail ?? 'set') === 'set' && hs.sailW > 0 && state !== 'wrecked';
  const frames = Math.max(1, Math.min(16, Math.round(opts.frames ?? 1)));
  const VW = 96;
  const VH = 200;
  const rng = new ArtRng(`ship|${type}|${culture}|${opts.seed ?? 1}`);
  const cx = VW / 2;
  const cy = VH / 2;
  const L = hs.len;
  const B = hs.beam;
  const bowY = cy - L / 2;
  const sternY = cy + L / 2;
  const hullD = `M${n(cx)} ${n(bowY)}C${n(cx + B * 0.45)} ${n(bowY + L * 0.12)} ${n(cx + B / 2)} ${n(cy - L * 0.18)} ${n(cx + B / 2)} ${n(cy)}C${n(cx + B / 2)} ${n(cy + L * 0.22)} ${n(cx + B * hs.stern)} ${n(sternY - L * 0.1)} ${n(cx)} ${n(sternY)}C${n(cx - B * hs.stern)} ${n(sternY - L * 0.1)} ${n(cx - B / 2)} ${n(cy + L * 0.22)} ${n(cx - B / 2)} ${n(cy)}C${n(cx - B / 2)} ${n(cy - L * 0.18)} ${n(cx - B * 0.45)} ${n(bowY + L * 0.12)} ${n(cx)} ${n(bowY)}Z`;
  const wood = type === 'galley' ? '#6a4a30' : '#7a5636';
  const defs = [
    linearGradient('s-hull', [[0, shade(wood, -0.35)], [0.3, wood], [0.55, shade(wood, 0.15)], [0.75, wood], [1, shade(wood, -0.4)]], { x1: 0, y1: 0, x2: 1, y2: 0 }),
    linearGradient('s-sail', [[0, shade(pal.secondary, -0.15)], [0.5, pal.secondary], [1, shade(pal.secondary, -0.3)]], { x1: 0, y1: 0, x2: 0, y2: 1 }),
    radialGradient('s-fire', [[0, '#fff2a0'], [0.4, '#f6b04a'], [0.8, '#d0401a', 0.8], [1, '#8a2010', 0]]),
    el('clipPath', { id: 's-hc' }, path(hullD)),
  ];
  const cellsOut: string[] = [];
  for (let f = 0; f < frames; f++) {
    const phase = (opts.oarPhase ?? 0) + (frames > 1 ? f / frames : 0);
    const parts: string[] = [];
    // Wake.
    if (state !== 'wrecked') parts.push(path(`M${n(cx - B * 0.4)} ${n(sternY - 6)}L${n(cx - B * 0.9)} ${n(VH)}M${n(cx + B * 0.4)} ${n(sternY - 6)}L${n(cx + B * 0.9)} ${n(VH)}`, { stroke: '#e8f0f2', 'stroke-opacity': '0.35', 'stroke-width': 3, fill: 'none' }));
    // Oars (both sides; swept with the stroke phase).
    if (state !== 'wrecked' && !(sailSet && type === 'knarr')) {
      for (let tier = 0; tier < hs.tiers; tier++) {
        for (let i = 0; i < hs.oars; i++) {
          const oy = cy - L * 0.3 + (L * 0.62 * (i + 0.5)) / hs.oars + tier * 3;
          const sweep = Math.sin((phase + i * 0.02) * Math.PI * 2) * 6;
          const broken = state === 'damaged' && rng.fork(`oar${tier}${i}`).chance(0.25);
          for (const side of [-1, 1]) {
            const reach = (broken ? 8 : 18 + tier * 4) * side;
            parts.push(line(cx + (side * B) / 2 - side * 2, oy, cx + (side * B) / 2 + reach, oy + sweep, { stroke: '#a88a5a', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
          }
        }
      }
    }
    if (hs.ram) parts.push(path(`M${n(cx - 3)} ${n(bowY + 6)}L${n(cx)} ${n(bowY - 12)}L${n(cx + 3)} ${n(bowY + 6)}Z`, { fill: '#a8743a', stroke: '#2e1c0c', 'stroke-width': 1 }));
    parts.push(path(hullD, { fill: 'url(#s-hull)', stroke: '#1e140c', 'stroke-width': 1.8 }));
    // Deck planks, thwarts and crew.
    const deck: string[] = [];
    for (let i = -2; i <= 2; i++) deck.push(line(cx + i * (B / 6), bowY, cx + i * (B / 6), sternY, { stroke: '#2e1c0c', 'stroke-opacity': '0.35', 'stroke-width': 0.8 }));
    for (let i = 0; i < hs.oars; i++) {
      const oy = cy - L * 0.3 + (L * 0.62 * (i + 0.5)) / hs.oars;
      deck.push(line(cx - B / 2, oy, cx + B / 2, oy, { stroke: '#2e1c0c', 'stroke-opacity': '0.45', 'stroke-width': 1.4 }));
    }
    const cr = rng.fork('crew');
    for (let i = 0; i < hs.crew && state !== 'wrecked'; i++) {
      const oy = cy - L * 0.3 + (L * 0.62 * ((i % Math.max(1, hs.oars)) + 0.5)) / Math.max(1, hs.oars);
      const ox = cx + (i % 2 === 0 ? -1 : 1) * B * cr.range(0.12, 0.3);
      deck.push(circle(ox, oy + 2.5, 2.6, { fill: cr.pick(pal.cloth), stroke: '#140e0a', 'stroke-width': 0.6 }));
    }
    parts.push(g({ 'clip-path': 'url(#s-hc)' }, deck));
    // Shields along the gunwales.
    if (hs.shields && state !== 'wrecked') {
      for (let i = 0; i < hs.oars; i++) {
        const oy = cy - L * 0.3 + (L * 0.62 * (i + 0.5)) / hs.oars;
        for (const side of [-1, 1]) {
          const colour = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? pal.primary : pal.secondary;
          parts.push(circle(cx + (side * B) / 2 - side * 0.5, oy - 2, 3.4, { fill: colour, stroke: '#140e0a', 'stroke-width': 0.8 }));
        }
      }
    }
    // Stems.
    parts.push(circle(cx, bowY + 4, 2.4, { fill: shade(wood, -0.4) }));
    parts.push(circle(cx, sternY - 4, 2.4, { fill: shade(wood, -0.4) }));
    // Mast, yard and sail.
    if (hs.sailW > 0 && state !== 'wrecked') {
      const my = cy - L * 0.05;
      if (sailSet) {
        const belly = 9;
        parts.push(path(`M${n(cx - hs.sailW / 2)} ${n(my)}Q${n(cx)} ${n(my - belly * 2.2)} ${n(cx + hs.sailW / 2)} ${n(my)}L${n(cx + hs.sailW / 2 - 2)} ${n(my + 5)}Q${n(cx)} ${n(my - belly)} ${n(cx - hs.sailW / 2 + 2)} ${n(my + 5)}Z`, { fill: 'url(#s-sail)', stroke: '#2e1c0c', 'stroke-width': 1 }));
        for (let i = 1; i < 4; i++) parts.push(line(cx - hs.sailW / 2 + (hs.sailW * i) / 4, my - belly * 0.7, cx - hs.sailW / 2 + (hs.sailW * i) / 4, my + 3, { stroke: pal.primary, 'stroke-width': n(hs.sailW / 10), opacity: '0.85' }));
      } else {
        parts.push(rect(cx - hs.sailW / 2, my - 2, hs.sailW, 4, { fill: shade(pal.secondary, -0.25), stroke: '#2e1c0c', 'stroke-width': 0.8, rx: 2 }));
      }
      parts.push(circle(cx, my, 2.6, { fill: '#3a2614' }));
    }
    // Damage and fire.
    if (state === 'damaged' || state === 'burning' || state === 'wrecked') {
      const dr = rng.fork('damage');
      const holes: string[] = [];
      for (let i = 0; i < (state === 'wrecked' ? 7 : 4); i++) holes.push(ellipse(cx + dr.jitter(B * 0.35), cy + dr.jitter(L * 0.4), dr.range(3, 7), dr.range(2, 5), { fill: '#120a06', opacity: '0.75' }));
      parts.push(g({ 'clip-path': 'url(#s-hc)' }, holes));
    }
    if (state === 'burning') {
      const fr = rng.fork(`fire${f}`);
      for (let i = 0; i < 6; i++) {
        const fx = cx + fr.jitter(B * 0.35);
        const fy = cy + fr.jitter(L * 0.35);
        parts.push(ellipse(fx + 6, fy + 8, 9, 14, { fill: '#2a2420', opacity: '0.35' }));
        parts.push(ellipse(fx, fy, fr.range(5, 9), fr.range(7, 12), { fill: 'url(#s-fire)' }));
      }
    }
    if (state === 'wrecked') parts.push(rect(0, 0, VW, VH, { fill: '#1d3a48', opacity: '0.35' }));
    // Team pennant at the stern for readability.
    parts.push(path(`M${n(cx)} ${n(sternY - 4)}l${n(-9)} ${n(5)}l${n(9)} ${n(4)}Z`, { fill: TEAM_COLOURS[team], stroke: '#140e0a', 'stroke-width': 0.8 }));
    cellsOut.push(g({ transform: `translate(${n(f * VW)} 0)` }, parts));
  }
  const fw = opts.width ?? VW;
  const fh = opts.height ?? VH;
  const body = [...cellsOut];
  if (opts.watermark && opts.watermark !== 'off') body.push(watermark(VW * frames, VH, opts.label, 'corner'));
  return svgDoc({ width: fw * frames, height: fh, viewBox: [0, 0, VW * frames, VH], defs, body });
}

export const unitSpriteGenerator: ImageGenerator = {
  id: 'unitSprite',
  kind: 'image',
  defaultSize: [64, 64],
  params: [
    { name: 'unit', type: 'string', note: 'balance.units id (bondi, huscarls, horsemen, wolfPack, …); picks the archetype' },
    { name: 'kind', type: 'enum', values: UNIT_KINDS, note: 'explicit archetype (overrides unit)' },
    { name: 'culture', type: 'enum', values: ALL_CULTURES, default: 'skarn' },
    { name: 'team', type: 'enum', values: TEAMS, default: 'player' },
    { name: 'anim', type: 'enum', values: UNIT_ANIMS, default: 'idle' },
    { name: 'facing', type: 'number', default: 0, note: 'degrees clockwise from north' },
    { name: 'ring', type: 'boolean', default: true },
    { name: 'seed', type: 'number' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    const kind = oneOf<UnitKind | ''>(params, 'kind', UNIT_KINDS, '');
    return unitSpriteSvg({
      unit: typeof params.unit === 'string' ? params.unit : undefined,
      kind: kind === '' ? undefined : kind,
      culture: oneOf(params, 'culture', ALL_CULTURES, 'skarn'),
      team: oneOf(params, 'team', TEAMS, 'player'),
      anim: oneOf(params, 'anim', UNIT_ANIMS, 'idle'),
      facing: num(params, 'facing', 0, -720, 720),
      frames: ctx.frames,
      width: ctx.width,
      height: ctx.height,
      seed: seedOf(params, 'unit'),
      ring: params.ring !== false && params.ring !== 'false',
      watermark: ctx.watermark,
      label: ctx.label,
    });
  },
  variants(): GeneratorParams[] {
    const out: GeneratorParams[] = [];
    const cultures: CultureId[] = ['skarn', 'albric', 'corvani', 'velkar', 'kurgai', 'saraleonese'];
    UNIT_KINDS.forEach((kind, i) => out.push({ kind, culture: cultures[i % cultures.length] as CultureId, team: i % 2 === 0 ? 'player' : 'enemy' }));
    return out;
  },
};

export const shipSpriteGenerator: ImageGenerator = {
  id: 'shipSprite',
  kind: 'image',
  defaultSize: [96, 200],
  params: [
    { name: 'ship', type: 'enum', values: SHIP_TYPES, default: 'karvi' },
    { name: 'culture', type: 'enum', values: ALL_CULTURES, default: 'skarn' },
    { name: 'team', type: 'enum', values: TEAMS, default: 'player' },
    { name: 'state', type: 'enum', values: SHIP_STATES, default: 'intact' },
    { name: 'sail', type: 'enum', values: SAIL_STATES, default: 'set' },
    { name: 'seed', type: 'number' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return shipSpriteSvg({
      ship: oneOf(params, 'ship', SHIP_TYPES, 'karvi'),
      culture: oneOf(params, 'culture', ALL_CULTURES, 'skarn'),
      team: oneOf(params, 'team', TEAMS, 'player'),
      state: oneOf(params, 'state', SHIP_STATES, 'intact'),
      sail: oneOf(params, 'sail', SAIL_STATES, 'set'),
      frames: ctx.frames,
      width: ctx.width,
      height: ctx.height,
      seed: seedOf(params, 'ship'),
      watermark: ctx.watermark,
      label: ctx.label,
    });
  },
  variants(): GeneratorParams[] {
    const out: GeneratorParams[] = SHIP_TYPES.map((ship) => ({ ship, culture: ship === 'galley' ? 'saraleonese' : ship === 'riverboat' ? 'velkar' : 'skarn' }));
    out.push({ ship: 'drakkar', culture: 'hvarn', state: 'damaged', sail: 'furled' }, { ship: 'snekkja', culture: 'eyjar', state: 'burning', team: 'enemy' }, { ship: 'knarr', culture: 'albric', state: 'wrecked', team: 'neutral' });
    return out;
  },
};
