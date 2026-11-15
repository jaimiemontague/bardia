/**
 * People for rooms, drawn larger and with more character than the scenes' silhouettes: a face (eyes, brows,
 * nose), hair and beard, clothes with a lit side and a shadow side (the fire's side is warm), and a pose with
 * something in hand.
 *
 *   <Person x={800} y={560} h={220} pose="seated" hold="sword" light={light} warmSide="left"
 *           look={{ tunic: '#6a2a20', cloak: '#2a3a4a', fur: true, beard: 'long', hair: '#7a5a3a', build: 'broad' }} />
 *
 * `x, y` is the centre of the feet; `h` the height from the feet to the top of the head (seated people are
 * shorter: give their seated height). Poses: standing, seated, working (a hammer raised over an anvil). Things in
 * hand: staff, keys, hammer (with tongs in the other hand), sword (point down, both hands on the pommel), horn,
 * cup. `depth` (0..1) darkens background folk; `flip` mirrors the figure.
 */
import type { ReactElement } from 'react';
import { BONE, INK, mix, shade } from '../scenes/paint';
import { lit, type RoomLight } from './light';

/** What a person wears and looks like (every field but the tunic has a default). */
export interface PersonLook {
  tunic: string;
  skin?: string;
  hair?: string;
  hairStyle?: 'short' | 'long' | 'bald' | 'braid';
  beard?: 'none' | 'short' | 'long' | 'forked';
  trousers?: string;
  /** A cloak pinned at the shoulder (its colour). */
  cloak?: string;
  /** A fur collar over the shoulders. */
  fur?: boolean;
  /** An edging colour on hem and cuffs (gold for the rich). */
  trim?: string;
  /** A leather apron (the smith). */
  apron?: boolean;
  head?: 'bare' | 'hood' | 'cap' | 'band';
  /** The cap's colour (default a madder red). */
  hat?: string;
  build?: 'slim' | 'normal' | 'broad' | 'stout';
  /** A gold chain across the chest. */
  chain?: boolean;
  /** Short sleeves and bare forearms. */
  bareArms?: boolean;
}

export type PersonPose = 'standing' | 'seated' | 'working';
export type PersonHold = 'none' | 'staff' | 'keys' | 'hammer' | 'sword' | 'horn' | 'cup';

type P = readonly [number, number];

const HALF: Readonly<Record<NonNullable<PersonLook['build']>, number>> = { slim: 12, normal: 13.5, broad: 15.5, stout: 15 };

/** One person (see the file header). */
export function Person({
  x,
  y,
  h,
  pose = 'standing',
  hold = 'none',
  look,
  light,
  warmSide = 'left',
  warm = 0.5,
  depth = 0,
  flip = false,
}: {
  x: number;
  y: number;
  h: number;
  pose?: PersonPose;
  hold?: PersonHold;
  look: PersonLook;
  light: RoomLight;
  warmSide?: 'left' | 'right';
  warm?: number;
  depth?: number;
  flip?: boolean;
}): ReactElement {
  const seated = pose === 'seated';
  // Local units: a standing person is 100 tall (feet 0, crown -100); seated people are 85 tall.
  const k = h / (seated ? 85 : 100);
  const dy = seated ? 14 : 0; // the upper body sits 14 lower
  const b = HALF[look.build ?? 'normal'];
  const L = (c: string, w = warm) => lit(light, c, w, depth);
  const skin = L(look.skin ?? '#c89a72', warm + 0.2);
  const skinDark = shade(skin, 0.3);
  const hair = L(look.hair ?? '#4e3420');
  const tunic = L(look.tunic);
  const tunicDark = shade(tunic, 0.38);
  const trousers = L(look.trousers ?? '#4a4036');
  const boot = L('#2a1e14');
  const trim = look.trim ? L(look.trim, warm + 0.2) : undefined;
  const gold = L('#d8b058', warm + 0.3);
  const iron = L('#6a6a6c', warm + 0.2);
  const wood = L('#5a3a22');
  // The fire's side in local x (warmSide is given in the room's own left/right, so a flipped figure mirrors it).
  const ws = (warmSide === 'left' ? -1 : 1) * (flip ? -1 : 1);
  const rim = mix(light.fireTint, '#fff0c8', 0.3);
  const rimOpacity = 0.55 * light.fire * (1 - depth);

  // ---- arms: shoulder → elbow → hand, per side (−1 left, +1 right), in standing units (dy added below).
  const arm = (s: -1 | 1): { e: P; hand: P } => {
    if (seated) {
      if (hold === 'sword') return { e: [s * (b + 3), -52 + 0], hand: [s * 1.8, -51] };
      if (hold === 'horn' && s === 1) return { e: [b + 5, -60], hand: [b + 2, -72] };
      return { e: [s * (b + 3), -54], hand: [s * 8.5, -48] };
    }
    if (pose === 'working') return s === 1 ? { e: [b + 8, -90], hand: [b + 5, -103] } : { e: [-b - 3, -57], hand: [-4, -41] };
    if (hold === 'staff' && s === 1) return { e: [b + 4.5, -64], hand: [b + 6, -71] };
    if (hold === 'staff') return { e: [-b - 1.5, -63], hand: [-5, -57] };
    if (hold === 'keys' && s === 1) return { e: [b + 3, -62], hand: [b + 3.5, -50] };
    if (hold === 'keys') return { e: [-b - 4, -66], hand: [-b + 2.5, -57.5] };
    if (hold === 'cup' && s === 1) return { e: [b + 3, -62], hand: [b - 1, -64] };
    return { e: [s * (b + 1.5), -60], hand: [s * (b + 1), -45] };
  };
  const shoulder = (s: -1 | 1): P => [s * (b - 1.5), -78];
  const up = (p: P): P => [p[0], p[1] + dy];
  const pt = (p: P) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;

  const parts: ReactElement[] = [];
  const add = (el: ReactElement) => parts.push(el);

  // Ground shadow.
  add(<ellipse key="shadow" cx={0} cy={0.5} rx={seated ? b + 10 : b + 4} ry={3.2} fill="#000" opacity={0.42 * (1 - depth * 0.5)} />);

  // Cloak behind the body.
  if (look.cloak) {
    const c = L(look.cloak);
    const bottom = seated ? -26 : -22;
    add(<path key="cloak" d={`M${-b - 0.5} ${-81 + dy} Q ${-b - 6} ${-62 + dy} ${-b - 7.5} ${bottom} Q 0 ${bottom + 4} ${b + 7.5} ${bottom} Q ${b + 6} ${-62 + dy} ${b + 0.5} ${-81 + dy} Z`} fill={shade(c, 0.25)} />);
  }
  // Long hair falls behind the shoulders.
  if (look.hairStyle === 'long') add(<path key="hairback" d={`M-7.2 ${-94 + dy} Q -9.5 ${-82 + dy} -8.5 ${-73 + dy} L 8.5 ${-73 + dy} Q 9.5 ${-82 + dy} 7.2 ${-94 + dy} Z`} fill={shade(hair, 0.2)} />);

  // Legs.
  if (seated) {
    for (const s of [-1, 1] as const) {
      const cx = s * 7.5;
      add(<path key={`shin${s}`} d={`M${cx - 3.3} -31 L${cx + 3.3} -31 L${cx + 2.5} -7 L${cx - 2.5} -7 Z`} fill={s === -ws ? shade(trousers, 0.25) : trousers} />);
      add(<path key={`wrap${s}`} d={`M${cx - 3} -26 l 6 -2 M${cx - 2.9} -21 l 5.8 -2 M${cx - 2.8} -16 l 5.6 -2 M${cx - 2.7} -11 l 5.4 -2`} stroke={shade(trousers, 0.4)} strokeWidth={0.7} />);
      add(<path key={`boot${s}`} d={`M${cx - 3} -8 L${cx + 3} -8 L${cx + 3.5} 0 L${cx - 4.5} 0 Q ${cx - 5} -2 ${cx - 3} -3 Z`} fill={boot} />);
    }
  } else {
    const spread = pose === 'working' ? 3.5 : 0;
    for (const s of [-1, 1] as const) {
      const top0 = s * 1;
      const top1 = s * 10.5;
      const ank = s * (6 + spread);
      add(<path key={`leg${s}`} d={`M${top0} -40 L${top1} -40 L${ank + s * 2.6} -7 L${ank - s * 2.6} -7 Z`} fill={s === -ws ? shade(trousers, 0.25) : trousers} />);
      add(<path key={`wrap${s}`} d={`M${ank - 2.8} -20 l 5.6 -2 M${ank - 2.7} -15 l 5.4 -2 M${ank - 2.6} -10.5 l 5.2 -2`} stroke={shade(trousers, 0.4)} strokeWidth={0.7} />);
      add(<path key={`boot${s}`} d={`M${ank - 3} -8 L${ank + 3} -8 L${ank + 3.2 + s * 0.8} 0 L${ank - 3.2 + s * 0.8} 0 Q ${ank - 4 + s} -2 ${ank - 3} -3 Z`} fill={boot} />);
    }
  }

  // The tunic (with a lap over the knees when seated).
  const waist = -58 + dy;
  const stout = look.build === 'stout' ? 2.5 : 0;
  const tunicPath = seated
    ? `M${-b + 1} ${-80 + dy} Q ${-b - 1} ${-70 + dy} ${-b + 2 - stout} ${waist} L${-b - 5} -31 Q 0 -25 ${b + 5} -31 L${b - 2 + stout} ${waist} Q ${b + 1} ${-70 + dy} ${b - 1} ${-80 + dy} Q 0 ${-83 + dy} ${-b + 1} ${-80 + dy} Z`
    : `M${-b + 1} -80 Q ${-b - 1} -70 ${-b + 2 - stout} ${waist} L${-b - 2} -36 Q 0 -33 ${b + 2} -36 L${b - 2 + stout} ${waist} Q ${b + 1} -70 ${b - 1} -80 Q 0 -83 ${-b + 1} -80 Z`;
  add(<path key="tunic" d={tunicPath} fill={tunic} />);
  // Shadow side of the tunic.
  const hemY = seated ? -31 : -36;
  const sh = -ws;
  add(<path key="tunicShade" d={`M${sh * 2} ${-82 + dy} L${sh * (b - 1)} ${-80 + dy} Q ${sh * (b + 1)} ${-70 + dy} ${sh * (b - 2 + stout)} ${waist} L${sh * (b + (seated ? 5 : 2))} ${hemY} Q ${sh * 5} ${hemY + 2.5} ${sh * 3} ${hemY + 2.6} Z`} fill={tunicDark} opacity={0.65} />);
  // Lit edge on the fire's side.
  add(<path key="tunicRim" d={`M${ws * (b - 1)} ${-80 + dy} Q ${ws * (b + 1)} ${-70 + dy} ${ws * (b - 2 + stout)} ${waist} L${ws * (b + (seated ? 5 : 2))} ${hemY}`} stroke={rim} strokeWidth={1.1} fill="none" opacity={rimOpacity} />);
  // Folds.
  add(<path key="folds" d={`M-4 ${waist + 3} L-6 ${hemY} M3 ${waist + 3} L5 ${hemY} M0 ${-79 + dy} L0 ${-68 + dy}`} stroke={tunicDark} strokeWidth={0.8} opacity={0.5} />);
  if (trim) {
    add(<path key="trimHem" d={`M${-b - (seated ? 5 : 2)} ${hemY - 1.2} Q 0 ${hemY + (seated ? 4.8 : 1.8)} ${b + (seated ? 5 : 2)} ${hemY - 1.2}`} stroke={trim} strokeWidth={1.5} fill="none" />);
    add(<path key="trimNeck" d={`M-4.5 ${-81.5 + dy} L0 ${-75 + dy} L4.5 ${-81.5 + dy}`} stroke={trim} strokeWidth={1.3} fill="none" />);
  }

  // Leather apron.
  if (look.apron) {
    const ap = L('#5e3c22', warm + 0.1);
    add(<path key="apron" d={`M-9 ${-74 + dy} L9 ${-74 + dy} L12.5 ${hemY + 4} Q 0 ${hemY + 6.5} -12.5 ${hemY + 4} Z`} fill={ap} />);
    add(<path key="apronShade" d={`M${sh * 2} ${-74 + dy} L${sh * 9} ${-74 + dy} L${sh * 12.5} ${hemY + 4} L${sh * 3} ${hemY + 5.5} Z`} fill={shade(ap, 0.35)} opacity={0.6} />);
    add(<path key="apronStraps" d={`M-8 ${-74 + dy} L-3.5 ${-84 + dy} M8 ${-74 + dy} L3.5 ${-84 + dy}`} stroke={shade(ap, 0.3)} strokeWidth={1.3} />);
    add(<path key="apronScorch" d={`M-3 ${-50 + dy} q 2 -2 4 0 q 1 2 -1 3`} stroke={shade(ap, 0.5)} strokeWidth={0.8} fill="none" />);
  }

  // Belt (and a purse at the hip for the keys-holder).
  add(<rect key="belt" x={-b + 1.2 - stout} y={waist - 1.5} width={(b - 1.2 + stout) * 2} height={3.2} fill={L('#2a1a10')} />);
  add(<rect key="buckle" x={-1.6} y={waist - 1.8} width={3.2} height={3.8} rx={0.6} fill={trim ? gold : iron} />);
  if (hold === 'keys') add(<path key="purse" d={`M${-b + 3} ${waist + 1.5} q -4 1 -3.5 6 q 2.5 3 6 0 q 0.5 -5 -2.5 -6 Z`} fill={L('#6a4426', warm + 0.2)} stroke={shade(wood, 0.4)} strokeWidth={0.6} />);

  // Cloak drape over one shoulder (in front) and its brooch.
  if (look.cloak) {
    const c = L(look.cloak);
    const side = -ws; // drape on the shadow side so the lit chest shows
    add(<path key="drape" d={`M${side * (b + 1)} ${-82 + dy} L${side * 3} ${-80.5 + dy} Q ${side * (b - 3)} ${-58 + dy} ${side * (b - 1)} ${(seated ? -34 : -40)} L${side * (b + 6)} ${seated ? -30 : -27} Q ${side * (b + 4)} ${-60 + dy} ${side * (b + 1)} ${-82 + dy} Z`} fill={c} />);
    add(<path key="drapeShade" d={`M${side * (b - 1)} ${(seated ? -34 : -40)} L${side * (b + 6)} ${seated ? -30 : -27} Q ${side * (b + 4)} ${-60 + dy} ${side * (b + 2)} ${-74 + dy} Z`} fill={shade(c, 0.35)} opacity={0.7} />);
    add(<circle key="brooch" cx={side * (b - 3.5)} cy={-78 + dy} r={1.9} fill={gold} stroke={INK} strokeWidth={0.4} />);
  }

  // Chain of office.
  if (look.chain) {
    add(<path key="chain" d={`M${-b + 3.5} ${-79 + dy} Q 0 ${-62 + dy} ${b - 3.5} ${-79 + dy}`} stroke={gold} strokeWidth={1.1} fill="none" strokeDasharray="1.4 0.8" />);
    add(<circle key="pendant" cx={0} cy={-70 + dy} r={1.8} fill={gold} stroke={INK} strokeWidth={0.4} />);
  }

  // Fur collar.
  if (look.fur) {
    const f = L('#7a5e44', warm + 0.1);
    add(<path key="fur" d={`M${-b - 2.5} ${-79.5 + dy} Q ${-b} ${-86.5 + dy} -6 ${-84.5 + dy} Q 0 ${-81.5 + dy} 6 ${-84.5 + dy} Q ${b} ${-86.5 + dy} ${b + 2.5} ${-79.5 + dy} Q ${b} ${-73 + dy} ${b - 4} ${-75.5 + dy} Q 0 ${-72 + dy} ${-b + 4} ${-75.5 + dy} Q ${-b} ${-73 + dy} ${-b - 2.5} ${-79.5 + dy} Z`} fill={f} />);
    add(<path key="furTufts" d={`M${-b + 1} ${-76 + dy} l -1 2 M${-b + 6} ${-75 + dy} l 0 2.2 M-2 ${-74 + dy} l 0.5 2 M4 ${-74.5 + dy} l 0.5 2 M${b - 3} ${-76 + dy} l 1 2`} stroke={shade(f, 0.4)} strokeWidth={0.9} />);
    add(<path key="furLit" d={`M${ws * (b + 2)} ${-79.5 + dy} Q ${ws * b} ${-86 + dy} ${ws * 6} ${-84.3 + dy}`} stroke={mix(f, BONE, 0.35)} strokeWidth={1} fill="none" opacity={0.7} />);
  }

  // Neck and head.
  const hy = -91.5 + dy;
  add(<rect key="neck" x={-2.7} y={-86 + dy} width={5.4} height={7} fill={skinDark} />);
  add(<ellipse key="earL" cx={-6.3} cy={hy + 0.5} rx={1.3} ry={2} fill={skinDark} />);
  add(<ellipse key="earR" cx={6.3} cy={hy + 0.5} rx={1.3} ry={2} fill={skinDark} />);
  add(<ellipse key="head" cx={0} cy={hy} rx={6.3} ry={7.8} fill={skin} />);
  add(<path key="faceShade" d={`M${sh * 0.5} ${hy - 7.8} Q ${sh * 7.6} ${hy - 6} ${sh * 6.3} ${hy + 1} Q ${sh * 5} ${hy + 7.5} ${sh * 0.5} ${hy + 7.8} Q ${sh * 4.2} ${hy} ${sh * 0.5} ${hy - 7.8} Z`} fill={skinDark} opacity={0.75} />);
  add(<path key="faceRim" d={`M${ws * 3} ${hy - 7.2} Q ${ws * 6.8} ${hy - 3} ${ws * 5.8} ${hy + 3}`} stroke={rim} strokeWidth={0.8} fill="none" opacity={rimOpacity} />);
  // Eyes, brows, nose.
  const browC = shade(hair, 0.2);
  add(<ellipse key="eyeL" cx={-2.4} cy={hy - 0.9} rx={1.15} ry={0.62} fill="#1a120c" />);
  add(<ellipse key="eyeR" cx={2.4} cy={hy - 0.9} rx={1.15} ry={0.62} fill="#1a120c" />);
  add(<ellipse key="glintL" cx={-2.1} cy={hy - 1.05} rx={0.3} ry={0.22} fill={BONE} opacity={0.6} />);
  add(<ellipse key="glintR" cx={2.7} cy={hy - 1.05} rx={0.3} ry={0.22} fill={BONE} opacity={0.6} />);
  add(<path key="brows" d={`M-4 ${hy - 2.7} Q -2.4 ${hy - 3.6} -0.9 ${hy - 2.8} M0.9 ${hy - 2.8} Q 2.4 ${hy - 3.6} 4 ${hy - 2.7}`} stroke={browC} strokeWidth={0.9} fill="none" strokeLinecap="round" />);
  add(<path key="nose" d={`M0.2 ${hy - 1.2} L${-ws * 0.9} ${hy + 2.6} L${ws * 0.6} ${hy + 2.9}`} stroke={shade(skin, 0.4)} strokeWidth={0.7} fill="none" strokeLinecap="round" />);
  add(<path key="mouth" d={`M-1.7 ${hy + 4.6} Q 0 ${hy + 5.1} 1.7 ${hy + 4.6}`} stroke={shade(skin, 0.5)} strokeWidth={0.6} fill="none" />);

  // Hair.
  const style = look.hairStyle ?? 'short';
  if (style !== 'bald') add(<path key="hair" d={`M-6.7 ${hy + 0.5} Q -7.4 ${hy - 9.4} 0 ${hy - 9.1} Q 7.4 ${hy - 9.4} 6.7 ${hy + 0.5} Q 5.2 ${hy - 5.2} 0 ${hy - 5.4} Q -5.2 ${hy - 5.2} -6.7 ${hy + 0.5} Z`} fill={hair} />);
  else add(<path key="hair" d={`M-6.6 ${hy + 1.5} Q -7 ${hy - 3} -5.6 ${hy - 4} L -5 ${hy + 1} Z M6.6 ${hy + 1.5} Q 7 ${hy - 3} 5.6 ${hy - 4} L 5 ${hy + 1} Z`} fill={hair} />);
  if (style === 'braid') add(<path key="braid" d={`M${sh * 6} ${hy} q ${sh * 1.5} 5 ${sh * 0.5} 11 q ${-sh * 1} 2 0 4`} stroke={hair} strokeWidth={2.2} fill="none" strokeLinecap="round" />);
  if (style === 'long') add(<path key="hairSide" d={`M-6.7 ${hy} Q -7.6 ${hy + 6} -7 ${hy + 12} M6.7 ${hy} Q 7.6 ${hy + 6} 7 ${hy + 12}`} stroke={hair} strokeWidth={2} fill="none" />);

  // Beard and moustache.
  const beard = look.beard ?? 'short';
  if (beard !== 'none') {
    const end = beard === 'short' ? hy + 10 : hy + 18;
    const d =
      beard === 'forked'
        ? `M-6.3 ${hy + 1.5} Q -7 ${hy + 10} -3.5 ${end - 2} L-2 ${end + 1} L0 ${hy + 13} L2 ${end + 1} L3.5 ${end - 2} Q 7 ${hy + 10} 6.3 ${hy + 1.5} Q 4 ${hy + 5.8} 0 ${hy + 5.9} Q -4 ${hy + 5.8} -6.3 ${hy + 1.5} Z`
        : beard === 'long'
          ? `M-6.3 ${hy + 1.5} Q -7.2 ${hy + 11} -3 ${end - 2} L0 ${end + 1.5} L3 ${end - 2} Q 7.2 ${hy + 11} 6.3 ${hy + 1.5} Q 4 ${hy + 5.8} 0 ${hy + 5.9} Q -4 ${hy + 5.8} -6.3 ${hy + 1.5} Z`
          : `M-6.3 ${hy + 1.5} Q -6.6 ${hy + 7.5} -3 ${hy + 9} Q 0 ${end + 0.5} 3 ${hy + 9} Q 6.6 ${hy + 7.5} 6.3 ${hy + 1.5} Q 4 ${hy + 5.8} 0 ${hy + 5.9} Q -4 ${hy + 5.8} -6.3 ${hy + 1.5} Z`;
    add(<path key="beard" d={d} fill={hair} />);
    add(<path key="beardShade" d={`M${sh * 0.5} ${hy + 5.9} Q ${sh * 4} ${hy + 5.8} ${sh * 6.3} ${hy + 1.5} Q ${sh * 6.8} ${hy + 9} ${sh * 2.5} ${end - 1} Z`} fill={shade(hair, 0.35)} opacity={0.6} />);
    add(<path key="moustache" d={`M-3.8 ${hy + 4.9} Q 0 ${hy + 2.6} 3.8 ${hy + 4.9} Q 0 ${hy + 3.9} -3.8 ${hy + 4.9} Z`} fill={shade(hair, 0.15)} />);
    add(<path key="beardLines" d={`M-2 ${hy + 7} l -0.3 3 M1.5 ${hy + 7.5} l 0.2 3`} stroke={shade(hair, 0.35)} strokeWidth={0.5} />);
  }

  // Headwear.
  if (look.head === 'hood') {
    const c = L(look.cloak ?? look.tunic);
    add(<path key="hood" d={`M-8.3 ${hy + 7.5} Q -10 ${hy - 10.5} 0 ${hy - 11.5} Q 10 ${hy - 10.5} 8.3 ${hy + 7.5} L 6.6 ${hy + 3.5} Q 6.4 ${hy - 6.4} 0 ${hy - 6.8} Q -6.4 ${hy - 6.4} -6.6 ${hy + 3.5} Z`} fill={c} />);
    add(<path key="hoodShade" d={`M${sh * 0.5} ${hy - 11.3} Q ${sh * 10} ${hy - 10.5} ${sh * 8.3} ${hy + 7.5} L ${sh * 6.6} ${hy + 3.5} Q ${sh * 6.4} ${hy - 6.4} ${sh * 0.5} ${hy - 6.8} Z`} fill={shade(c, 0.35)} opacity={0.7} />);
  } else if (look.head === 'cap') {
    const c = L(look.hat ?? '#7a2a1e');
    add(<path key="cap" d={`M-6.9 ${hy - 3.8} Q -6.4 ${hy - 12.5} 0.8 ${hy - 14.2} Q 6.4 ${hy - 10.8} 6.9 ${hy - 3.8} Q 0 ${hy - 5.6} -6.9 ${hy - 3.8} Z`} fill={c} />);
    add(<path key="capBand" d={`M-6.9 ${hy - 3.8} Q 0 ${hy - 5.6} 6.9 ${hy - 3.8}`} stroke={trim ?? shade(c, 0.4)} strokeWidth={1.4} fill="none" />);
  } else if (look.head === 'band') {
    add(<path key="band" d={`M-6.6 ${hy - 3} Q 0 ${hy - 5.2} 6.6 ${hy - 3}`} stroke={trim ?? L('#7a2a1e')} strokeWidth={1.3} fill="none" />);
  }

  // Things held behind the hands: the seated man's sword, the staff.
  if (hold === 'sword') {
    const steel = L('#a8acb0', warm + 0.3);
    add(<path key="blade" d={`M-1.3 ${-34} L1.3 -34 L0.9 -3 L0 -0.5 L-0.9 -3 Z`} fill={steel} />);
    add(<line key="fuller" x1={0} y1={-33} x2={0} y2={-6} stroke={shade(steel, 0.35)} strokeWidth={0.5} />);
    add(<rect key="guard" x={-5.5} y={-36} width={11} height={2.2} rx={0.8} fill={gold} />);
    add(<rect key="grip" x={-1.1} y={-41.5} width={2.2} height={5.6} fill={L('#3a2414')} />);
    add(<ellipse key="pommel" cx={0} cy={-42.6} rx={2.4} ry={1.7} fill={gold} />);
  }
  if (hold === 'staff') {
    const sx = b + 6;
    add(<line key="staff" x1={sx} y1={-121} x2={sx + 0.6} y2={0} stroke={wood} strokeWidth={2.4} strokeLinecap="round" />);
    add(<path key="staffHead" d={`M${sx} -121 q -4.5 -2 -3 -6.5 q 2.5 -3 5 -0.5 q 1.5 2.5 -1 3.5`} stroke={wood} strokeWidth={2.2} fill="none" strokeLinecap="round" />);
    add(<line key="staffLit" x1={sx + ws * 0.8} y1={-118} x2={sx + ws * 0.8 + 0.5} y2={-4} stroke={rim} strokeWidth={0.6} opacity={rimOpacity} />);
    add(<rect key="staffBand" x={sx - 1.6} y={-112} width={3.4} height={2} fill={gold} />);
  }

  // Arms.
  for (const s of [-1, 1] as const) {
    const sp = up(shoulder(s));
    const { e: e0, hand: h0 } = arm(s);
    const e = up(e0);
    const hd = seated && hold === 'sword' ? ([h0[0], -41] as P) : seated ? ([h0[0], h0[1] + dy] as P) : up(h0);
    const sleeve = s === -ws ? tunicDark : tunic;
    if (look.bareArms) {
      add(<path key={`upper${s}`} d={`M${pt(sp)} L${pt(e)}`} stroke={sleeve} strokeWidth={6.4} strokeLinecap="round" fill="none" />);
      add(<path key={`fore${s}`} d={`M${pt(e)} L${pt(hd)}`} stroke={s === -ws ? skinDark : skin} strokeWidth={4.8} strokeLinecap="round" fill="none" />);
    } else {
      add(<path key={`arm${s}`} d={`M${pt(sp)} L${pt(e)} L${pt(hd)}`} stroke={sleeve} strokeWidth={5.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />);
      if (trim) add(<circle key={`cuff${s}`} cx={hd[0] + (e[0] - hd[0]) * 0.18} cy={hd[1] + (e[1] - hd[1]) * 0.18} r={3} fill="none" stroke={trim} strokeWidth={1.1} />);
    }
    if (s === ws) add(<path key={`armRim${s}`} d={`M${pt([sp[0] + s * 2.6, sp[1]])} L${pt([e[0] + s * 2.6, e[1]])}`} stroke={rim} strokeWidth={0.9} fill="none" opacity={rimOpacity} />);
    add(<circle key={`hand${s}`} cx={hd[0]} cy={hd[1]} r={2.5} fill={s === -ws ? skinDark : skin} />);

    // What the hand holds.
    if (s === 1 && hold === 'keys') {
      add(<circle key="ring" cx={hd[0] + 0.5} cy={hd[1] + 3.6} r={2.1} fill="none" stroke={iron} strokeWidth={0.8} />);
      add(<path key="keyset" d={`M${hd[0] - 0.5} ${hd[1] + 5.5} l -1.2 6 l 1.5 0 M${hd[0] + 1} ${hd[1] + 5.6} l 0.5 7 l 1.4 -0.4 M${hd[0] + 2.2} ${hd[1] + 5} l 2 5`} stroke={L('#b8a070', warm + 0.4)} strokeWidth={0.9} fill="none" />);
    }
    if (s === 1 && hold === 'cup') add(<path key="cup" d={`M${hd[0] - 2.5} ${hd[1] - 6} l 5 0 l -0.8 5 l -3.4 0 Z`} fill={L('#9a9488', warm + 0.4)} />);
    if (s === 1 && hold === 'horn') add(<path key="horn" d={`M${hd[0] - 1} ${hd[1] - 1} q 6 -6 4 -14 l 3 0 q 2 9 -5 16 Z`} fill={L(BONE, warm + 0.3)} stroke={gold} strokeWidth={0.6} />);
    if (s === 1 && hold === 'hammer') {
      const end: P = [hd[0] - 6, hd[1] - 13];
      const dx = end[0] - hd[0];
      const dyy = end[1] - hd[1];
      const len = Math.hypot(dx, dyy) || 1;
      const ux = dx / len;
      const uy = dyy / len;
      const nx = -uy;
      const ny = ux;
      const head = [
        [end[0] + nx * 5.5 - ux * 1.5, end[1] + ny * 5.5 - uy * 1.5],
        [end[0] + nx * 5.5 + ux * 3.5, end[1] + ny * 5.5 + uy * 3.5],
        [end[0] - nx * 4 + ux * 3.5, end[1] - ny * 4 + uy * 3.5],
        [end[0] - nx * 4 - ux * 1.5, end[1] - ny * 4 - uy * 1.5],
      ];
      add(<line key="haft" x1={hd[0] + ux * -3} y1={hd[1] + uy * -3} x2={end[0]} y2={end[1]} stroke={wood} strokeWidth={1.9} strokeLinecap="round" />);
      add(<polygon key="hammerHead" points={head.map(([a, c]) => `${(a ?? 0).toFixed(2)},${(c ?? 0).toFixed(2)}`).join(' ')} fill={iron} stroke={INK} strokeWidth={0.4} />);
    }
    if (s === -1 && hold === 'hammer') add(<path key="tongs" d={`M${hd[0]} ${hd[1]} L${hd[0] + 13} ${hd[1] + 1.4} M${hd[0]} ${hd[1] + 1} L${hd[0] + 13} ${hd[1] + 2.4}`} stroke={iron} strokeWidth={1} />);
  }

  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(flip ? -k : k).toFixed(4)} ${k.toFixed(4)})`} data-pose={pose}>
      {parts}
    </g>
  );
}
