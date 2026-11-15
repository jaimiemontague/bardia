/**
 * Layered procedural portraits (design §27.2 "painted, layered for variation and aging").
 *
 * A portrait is decided once from its seed and the character's sex, culture, age, rank, faith and
 * traits (`decidePortraitLook`), then drawn slot by slot in a fixed z-order (`PORTRAIT_SLOTS`). Each
 * slot/variant pair is also an asset-manifest id (`portraits.layer.<slot>.<variant>`), so the owner's
 * final painted layer pieces replace the procedural ones one at a time (`finalLayers` option) — see
 * ASSET_DROP_IN.md for the canvas layout and tinting rules.
 *
 * Every feature draws from its own seeded fork, so the same character keeps the same face, eyes and
 * hair as they age: only greying, lines, baldness, proportions (children) and beard growth change.
 */
import type { CultureId, FaithId } from '@content/schemas/ids';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { ArtRng } from '../svg/rng';
import { circle, el, ellipse, esc, g, linearGradient, n, n2, path, radialGradient, rect, smoothClosed, smoothOpen, svgDoc } from '../svg/svg';
import {
  CULTURE_GROUP,
  CULTURE_PALETTE,
  EYE_COLOURS,
  EYES_BY_GROUP,
  GREY_HAIR,
  HAIR_BY_GROUP,
  HAIR_COLOURS,
  SKIN_BY_GROUP,
  SKIN_TONES,
  desaturate,
  mix,
  shade,
  type CultureGroup,
} from '../svg/palette';
import { grainFilter, mottleFilter, vignetteGradient, watermark, type WatermarkMode } from '../svg/paint';
import { bool, list, num, oneOf, seedOf } from './params';

// ---------------------------------------------------------------------------------------------
// Vocabulary

/** Canonical portrait canvas (final layer pieces are painted at exactly this size). */
export const PORTRAIT_SIZE = [512, 640] as const;
const W = 512;
const H = 640;

export const PORTRAIT_SEXES = ['male', 'female'] as const;
export type PortraitSex = (typeof PORTRAIT_SEXES)[number];

export const PORTRAIT_RANKS = ['common', 'warrior', 'noble', 'ruler', 'clergy', 'seer'] as const;
export type PortraitRank = (typeof PORTRAIT_RANKS)[number];

export const AGE_STAGES = ['child', 'youth', 'adult', 'middle', 'old'] as const;
export type AgeStage = (typeof AGE_STAGES)[number];

export const CULTURE_GROUPS: readonly CultureGroup[] = ['north', 'west', 'south', 'east', 'steppe', 'far'];

export const FACE_SHAPES = ['oval', 'round', 'square', 'long', 'heart', 'broad'] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

export const HAIR_STYLES = [
  'cropped',
  'swept',
  'shoulder',
  'longLoose',
  'warriorTail',
  'balding',
  'tonsure',
  'braidedBack',
  'braidsTwo',
  'plaitSingle',
  'crownBraid',
  'bun',
  'longWavy',
  'loose',
  'childShort',
  'childBraids',
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Styles that have hair behind the head and shoulders (the `hairBack` slot). */
export const HAIR_BACK_STYLES = ['shoulder', 'longLoose', 'warriorTail', 'braidedBack', 'plaitSingle', 'longWavy', 'loose', 'bun'] as const;

export const BEARD_STYLES = ['stubble', 'short', 'full', 'long', 'forked', 'braided', 'moustache', 'goatee'] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

export const SCAR_STYLES = ['cheekLeft', 'cheekRight', 'brow', 'lip', 'nose', 'chin', 'eyePatch', 'blindEye'] as const;
export type ScarStyle = (typeof SCAR_STYLES)[number];

export const HEADWEAR_STYLES = [
  'helmetSpectacle',
  'helmetConical',
  'helmetRidge',
  'hood',
  'headscarf',
  'veil',
  'furHat',
  'pointedCap',
  'circlet',
  'diadem',
  'furHood',
] as const;
export type HeadwearStyle = (typeof HEADWEAR_STYLES)[number];

export const ACCESSORY_STYLES = ['hammer', 'flame', 'riverFish', 'sunDisc', 'beads', 'torc', 'earrings', 'bandage'] as const;
export type AccessoryStyle = (typeof ACCESSORY_STYLES)[number];

/** Clothing ranks with their own body piece (ruler → noble; clergy/seer have robes). */
export const BODY_RANKS = ['common', 'warrior', 'noble'] as const;
export type BodyRank = (typeof BODY_RANKS)[number];

/** Draw order. Each slot is one layer piece in the final art. */
export const PORTRAIT_SLOTS = ['background', 'hairBack', 'body', 'face', 'scar', 'age', 'beard', 'hair', 'headwear', 'accessory'] as const;
export type PortraitSlot = (typeof PORTRAIT_SLOTS)[number];

/** How a final layer piece is tinted (multiply) so one painted piece serves every colour. */
export type LayerTint = 'hair' | 'skin' | 'cloth' | 'none';

const ALL_CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese', 'isafolder', 'rime'];
const ALL_FAITHS: readonly FaithId[] = ['oldways', 'lantern', 'goldenLantern', 'riverSpirits', 'highSky'];
const DEFAULT_FAITH: Readonly<Record<CultureGroup, FaithId>> = { north: 'oldways', west: 'lantern', south: 'lantern', east: 'riverSpirits', steppe: 'highSky', far: 'oldways' };

/** Age in years → stage (child < 12 ≤ youth < 18 ≤ adult < 35 ≤ middle < 55 ≤ old). */
export function ageStage(age: number): AgeStage {
  if (age < 12) return 'child';
  if (age < 18) return 'youth';
  if (age < 35) return 'adult';
  if (age < 55) return 'middle';
  return 'old';
}

// ---------------------------------------------------------------------------------------------
// Params and the decided look

/** Portrait inputs (all optional except the seed; see `portraitParamsFromCharacter`). */
export interface PortraitParams {
  seed: number | string;
  sex?: PortraitSex;
  culture?: CultureId;
  /** Age in years. */
  age?: number;
  rank?: PortraitRank;
  faith?: FaithId;
  /** Trait ids (scarred, oneEyed, towering, slight, sickly, …). */
  traits?: readonly string[];
  /** Explicit picks: slot or feature name → index into its vocabulary (PortraitSpec.layers). */
  layers?: Readonly<Record<string, number>>;
  wounded?: boolean;
  dead?: boolean;
  /** Draw the painted background (default true; false gives a transparent cut-out). */
  background?: boolean;
}

/** Every visual decision for one portrait. */
export interface PortraitLook {
  seed: number;
  sex: PortraitSex;
  culture: CultureId;
  group: CultureGroup;
  age: number;
  stage: AgeStage;
  rank: PortraitRank;
  faith: FaithId;
  bodyRank: BodyRank | 'clergy' | 'seer';
  skin: string;
  skinIndex: number;
  hairBase: string;
  hair: string;
  beardColour: string;
  brow: string;
  eye: string;
  greyT: number;
  face: FaceShape;
  hairStyle: HairStyle | 'bald';
  beard: BeardStyle | 'none';
  nose: number;
  mouth: number;
  brows: number;
  eyeShape: number;
  smile: number;
  freckles: boolean;
  cloth: string;
  cloth2: string;
  trim: string;
  metal: string;
  headwear: HeadwearStyle | 'none';
  accessories: AccessoryStyle[];
  scars: ScarStyle[];
  dead: boolean;
  background: boolean;
  towering: boolean;
  slight: boolean;
  sickly: boolean;
}

function pickIndexed<T>(rng: ArtRng, items: readonly T[], explicit: number | undefined): T {
  if (explicit !== undefined && Number.isInteger(explicit) && explicit >= 0) return items[explicit % items.length] as T;
  return rng.pick(items);
}

/** Reads loose generator params into PortraitParams. */
export function portraitParamsFrom(p: GeneratorParams): PortraitParams {
  const layers: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('layer.') && typeof v === 'number') layers[k.slice(6)] = v;
  }
  const out: PortraitParams = {
    seed: typeof p.seed === 'string' ? p.seed : seedOf(p, 'portrait'),
    sex: oneOf(p, 'sex', PORTRAIT_SEXES, 'male'),
    culture: oneOf(p, 'culture', ALL_CULTURES, 'skarn'),
    age: num(p, 'age', 30, 0, 110),
    rank: oneOf(p, 'rank', PORTRAIT_RANKS, 'common'),
    traits: list(p, 'traits'),
    wounded: bool(p, 'wounded', false),
    dead: bool(p, 'dead', false),
    background: bool(p, 'background', true),
  };
  const faith = oneOf<FaithId | ''>(p, 'faith', ALL_FAITHS, '');
  if (faith !== '') out.faith = faith;
  if (Object.keys(layers).length > 0) out.layers = layers;
  return out;
}

/** Decides every feature of a portrait (pure, deterministic). */
export function decidePortraitLook(params: PortraitParams): PortraitLook {
  const root = new ArtRng(typeof params.seed === 'number' ? params.seed >>> 0 : params.seed);
  const seed = typeof params.seed === 'number' ? params.seed >>> 0 : root.fork('n').int(0, 2 ** 31);
  const culture: CultureId = params.culture && ALL_CULTURES.includes(params.culture) ? params.culture : 'skarn';
  const group = CULTURE_GROUP[culture];
  const sex: PortraitSex = params.sex === 'female' ? 'female' : 'male';
  const age = typeof params.age === 'number' && Number.isFinite(params.age) ? Math.max(0, Math.min(110, params.age)) : 30;
  const stage = ageStage(age);
  const rank: PortraitRank = params.rank && PORTRAIT_RANKS.includes(params.rank) ? params.rank : 'common';
  const faith: FaithId = params.faith && ALL_FAITHS.includes(params.faith) ? params.faith : DEFAULT_FAITH[group];
  // Direct callers (the shell's Portrait slot) pass loose recipes: accept a comma list for traits and
  // keep only finite, non-negative integer layer picks.
  const rawTraits: unknown = params.traits;
  const traits: readonly string[] = Array.isArray(rawTraits) ? rawTraits.filter((t): t is string => typeof t === 'string') : typeof rawTraits === 'string' ? rawTraits.split(',').map((t) => t.trim()) : [];
  const L: Record<string, number> = {};
  for (const [k, v] of Object.entries(params.layers ?? {})) if (typeof v === 'number' && Number.isFinite(v)) L[k] = Math.abs(Math.floor(v));
  const pal = CULTURE_PALETTE[culture];

  const skinIndex = L.skin !== undefined ? Math.abs(L.skin) % SKIN_TONES.length : root.fork('skin').weighted(SKIN_BY_GROUP[group]);
  const baseSkin = SKIN_TONES[skinIndex] as string;
  const skin = mix(baseSkin, '#c8a088', root.fork('skin2').range(0, 0.12));
  const hairId = root.fork('hairColour').weighted(HAIR_BY_GROUP[group]);
  const hairBase = mix(HAIR_COLOURS[hairId], '#000000', root.fork('hairShade').range(-0.05, 0.12));
  const eyeId = root.fork('eyes').weighted(EYES_BY_GROUP[group]);
  const greyOnset = 34 + root.fork('greyOnset').range(-8, 14);
  const greyT = Math.max(0, Math.min(0.94, (age - greyOnset) / 28));
  const hair = mix(hairBase, GREY_HAIR, greyT);
  const beardColour = mix(mix(hairBase, '#a8532a', hairId === 'blond' || hairId === 'flaxen' ? 0.15 : 0.05), GREY_HAIR, Math.min(0.97, greyT + 0.12));
  const brow = mix(shade(hairBase, -0.15), GREY_HAIR, greyT * 0.6);

  const face = pickIndexed(root.fork('face'), FACE_SHAPES, L.face);

  // Hair style: a stable per-person preference, adjusted for age, baldness and rank.
  let hairStyle: HairStyle | 'bald';
  const hr = root.fork('hairStyle');
  const maleStyles: readonly (readonly [HairStyle, number])[] =
    group === 'steppe'
      ? [['braidedBack', 6], ['cropped', 1], ['longLoose', 1]]
      : group === 'south'
        ? [['cropped', 5], ['swept', 3], ['shoulder', 1]]
        : group === 'far'
          ? [['shoulder', 3], ['longLoose', 3], ['cropped', 1]]
          : [['cropped', 2], ['swept', 2], ['shoulder', 3], ['longLoose', 2], ['warriorTail', 3]];
  const femaleStyles: readonly (readonly [HairStyle, number])[] =
    group === 'north'
      ? [['braidsTwo', 3], ['plaitSingle', 3], ['crownBraid', 2], ['bun', 2], ['longWavy', 2], ['loose', 1]]
      : group === 'south'
        ? [['bun', 5], ['crownBraid', 2], ['longWavy', 2]]
        : [['braidsTwo', 3], ['plaitSingle', 2], ['longWavy', 3], ['loose', 2], ['bun', 2]];
  if (L.hair !== undefined) hairStyle = HAIR_STYLES[Math.abs(L.hair) % HAIR_STYLES.length] as HairStyle;
  else if (stage === 'child') hairStyle = sex === 'female' ? 'childBraids' : 'childShort';
  else hairStyle = hr.weighted(sex === 'female' ? femaleStyles : maleStyles);
  if (L.hair === undefined && sex === 'male' && rank === 'clergy' && group !== 'south') hairStyle = 'tonsure';
  if (L.hair === undefined && sex === 'male' && stage !== 'child' && stage !== 'youth' && hairStyle !== 'tonsure') {
    const baldness = Math.max(0, (age - 30) / 50) * (group === 'steppe' || group === 'far' ? 0.6 : 1);
    const threshold = root.fork('bald').next();
    if (baldness > threshold * 1.4) hairStyle = 'bald';
    else if (baldness > threshold) hairStyle = 'balding';
  }

  // Beard.
  let beard: BeardStyle | 'none' = 'none';
  const br = root.fork('beard');
  const pref: readonly (readonly [BeardStyle | 'none', number])[] =
    group === 'north'
      ? [['full', 4], ['short', 3], ['long', 2], ['forked', 1.5], ['braided', 1.5], ['moustache', 0.6], ['none', 0.4]]
      : group === 'west'
        ? [['moustache', 4], ['short', 2], ['full', 1], ['none', 2]]
        : group === 'south'
          ? [['short', 3], ['full', 2], ['none', 3], ['goatee', 1]]
          : group === 'east'
            ? [['full', 3], ['short', 2], ['moustache', 2], ['long', 1]]
            : group === 'steppe'
              ? [['moustache', 4], ['goatee', 3], ['none', 2], ['short', 1]]
              : [['short', 2], ['none', 3], ['moustache', 2], ['goatee', 1]];
  const preferred = br.weighted(pref);
  if (sex === 'male') {
    if (L.beard !== undefined) {
      const idx = Math.abs(L.beard) % (BEARD_STYLES.length + 1);
      beard = idx === BEARD_STYLES.length ? 'none' : (BEARD_STYLES[idx] as BeardStyle);
    } else if (stage === 'youth') beard = age >= 15 && preferred !== 'none' ? 'stubble' : 'none';
    else if (stage !== 'child') beard = rank === 'clergy' && group !== 'south' ? 'none' : preferred;
  }

  // Body.
  const bodyRank: PortraitLook['bodyRank'] =
    rank === 'clergy' ? 'clergy' : rank === 'seer' ? 'seer' : rank === 'warrior' ? 'warrior' : rank === 'noble' || rank === 'ruler' ? 'noble' : 'common';
  const cr = root.fork('cloth');
  const cloth = mix(cr.pick(pal.cloth), '#000000', cr.range(0, 0.15));
  let cloth2 = mix(cr.pick(pal.cloth), '#e8dcc0', cr.range(0.05, 0.3));
  if (cloth2 === cloth) cloth2 = shade(cloth, 0.25);

  // Headwear.
  let headwear: HeadwearStyle | 'none' = 'none';
  const hw = root.fork('headwear');
  const roll = hw.next();
  if (L.headwear !== undefined) {
    const idx = Math.abs(L.headwear) % (HEADWEAR_STYLES.length + 1);
    headwear = idx === HEADWEAR_STYLES.length ? 'none' : (HEADWEAR_STYLES[idx] as HeadwearStyle);
  } else if (stage !== 'child') {
    if (rank === 'ruler') headwear = group === 'south' ? 'diadem' : group === 'steppe' ? 'pointedCap' : 'circlet';
    else if (rank === 'warrior' && roll < 0.6)
      headwear = group === 'north' ? 'helmetSpectacle' : group === 'east' || group === 'steppe' ? 'helmetConical' : group === 'far' ? 'furHood' : 'helmetRidge';
    else if (rank === 'seer' && roll < 0.65) headwear = 'hood';
    else if (rank === 'clergy' && roll < 0.3) headwear = 'hood';
    else if (group === 'far' && roll < 0.65) headwear = 'furHood';
    else if (sex === 'female' && age >= 20) {
      if (group === 'north' && roll < 0.35) headwear = 'headscarf';
      else if (group === 'west' && roll < 0.6) headwear = 'veil';
      else if (group === 'south' && roll < 0.7) headwear = 'veil';
      else if (group === 'east' && roll < 0.55) headwear = 'headscarf';
      else if (group === 'steppe' && roll < 0.45) headwear = 'furHat';
    } else if (sex === 'male') {
      if (group === 'east' && roll < 0.35) headwear = 'furHat';
      else if (group === 'steppe' && roll < 0.5) headwear = 'pointedCap';
    }
  }

  // Accessories.
  const accessories: AccessoryStyle[] = [];
  const ar = root.fork('accessories');
  if (L.accessory !== undefined) accessories.push(ACCESSORY_STYLES[Math.abs(L.accessory) % ACCESSORY_STYLES.length] as AccessoryStyle);
  else {
    const amulet: AccessoryStyle | undefined =
      faith === 'oldways' ? 'hammer' : faith === 'lantern' || faith === 'goldenLantern' ? 'flame' : faith === 'riverSpirits' ? 'riverFish' : faith === 'highSky' ? 'sunDisc' : undefined;
    if (amulet && stage !== 'child' && (rank === 'clergy' || rank === 'seer' || ar.chance(0.35))) accessories.push(amulet);
    if (sex === 'female' && group === 'north' && stage !== 'child' && bodyRank !== 'seer') accessories.push('beads');
    if ((rank === 'noble' || rank === 'ruler') && (group === 'north' || group === 'west') && ar.chance(0.5)) accessories.push('torc');
    if ((group === 'south' || group === 'east' || group === 'steppe') && (sex === 'female' || ar.chance(0.25)) && stage !== 'child') accessories.push('earrings');
  }
  if (params.wounded) accessories.push('bandage');

  // Scars from traits (and an occasional old scar on warriors).
  const scars: ScarStyle[] = [];
  const sr = root.fork('scars');
  if (L.scar !== undefined) scars.push(SCAR_STYLES[Math.abs(L.scar) % SCAR_STYLES.length] as ScarStyle);
  if (traits.includes('scarred')) scars.push(sr.pick(['cheekLeft', 'cheekRight', 'brow', 'lip', 'nose', 'chin'] as const));
  if (traits.includes('scarred') && sr.chance(0.35)) scars.push(sr.pick(['cheekRight', 'chin', 'brow'] as const));
  if (rank === 'warrior' && stage !== 'child' && stage !== 'youth' && sr.chance(0.2)) scars.push(sr.pick(['cheekLeft', 'brow', 'chin'] as const));
  if (traits.includes('oneEyed')) scars.push(sr.chance(0.55) ? 'eyePatch' : 'blindEye');

  const fr = root.fork('freckles');
  const freckles = skinIndex <= 1 && (group === 'west' || group === 'north') && fr.chance(group === 'west' ? 0.45 : 0.25);

  return {
    seed,
    sex,
    culture,
    group,
    age,
    stage,
    rank,
    faith,
    bodyRank,
    skin,
    skinIndex,
    hairBase,
    hair,
    beardColour,
    brow,
    eye: EYE_COLOURS[eyeId],
    greyT,
    face,
    hairStyle,
    beard,
    nose: L.nose !== undefined ? Math.abs(L.nose) % 5 : root.fork('nose').int(0, 4),
    mouth: L.mouth !== undefined ? Math.abs(L.mouth) % 4 : root.fork('mouth').int(0, 3),
    brows: L.brows !== undefined ? Math.abs(L.brows) % 4 : root.fork('brows').int(0, 3),
    eyeShape: L.eyeShape !== undefined ? Math.abs(L.eyeShape) % 4 : root.fork('eyeShape').int(0, 3),
    smile: root.fork('smile').range(-1, 1),
    freckles,
    cloth,
    cloth2,
    trim: pal.trim,
    metal: pal.metal,
    headwear,
    accessories: [...new Set(accessories)],
    scars: [...new Set(scars)],
    dead: params.dead === true,
    background: params.background !== false,
    towering: traits.includes('towering') || traits.includes('strong'),
    slight: traits.includes('slight'),
    sickly: traits.includes('sickly'),
  };
}

// ---------------------------------------------------------------------------------------------
// Layer plan (the manifest contract)

/** One layer of a portrait: the slot, its variant and the manifest id of its final piece. */
export interface PortraitLayer {
  slot: PortraitSlot;
  variant: string;
  assetId: string;
  tint: LayerTint;
}

/** Manifest id of a layer piece. */
export function portraitLayerId(slot: PortraitSlot, variant: string): string {
  return `portraits.layer.${slot}.${variant}`;
}

/** Final-file path of a layer piece (under public/assets/). */
export function portraitLayerPath(slot: PortraitSlot, variant: string): string {
  const file = variant.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `portraits/layers/${slot.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}/${file}.png`;
}

const SLOT_TINT: Readonly<Record<PortraitSlot, LayerTint>> = {
  background: 'none',
  hairBack: 'hair',
  body: 'cloth',
  face: 'skin',
  scar: 'none',
  age: 'none',
  beard: 'hair',
  hair: 'hair',
  headwear: 'none',
  accessory: 'none',
};

/** Every layer piece the generator can use (one manifest entry each). */
export function portraitLayerCatalog(): PortraitLayer[] {
  const out: PortraitLayer[] = [];
  const add = (slot: PortraitSlot, variant: string): void => {
    out.push({ slot, variant, assetId: portraitLayerId(slot, variant), tint: SLOT_TINT[slot] });
  };
  for (const gr of CULTURE_GROUPS) add('background', gr);
  for (const s of HAIR_BACK_STYLES) add('hairBack', s);
  for (const gr of CULTURE_GROUPS) for (const sex of PORTRAIT_SEXES) for (const r of BODY_RANKS) add('body', `${gr}-${sex}-${r}`);
  add('body', 'robe-clergy');
  add('body', 'robe-seer');
  for (const f of FACE_SHAPES) for (const sex of PORTRAIT_SEXES) add('face', `${f}-${sex}`);
  for (const s of SCAR_STYLES) add('scar', s);
  for (const s of AGE_STAGES) add('age', s);
  for (const s of BEARD_STYLES) add('beard', s);
  for (const s of HAIR_STYLES) add('hair', s);
  for (const s of HEADWEAR_STYLES) add('headwear', s);
  for (const s of ACCESSORY_STYLES) add('accessory', s);
  return out;
}

/** The layers of one portrait, bottom to top. */
export function portraitLayerPlan(look: PortraitLook): PortraitLayer[] {
  const out: PortraitLayer[] = [];
  const add = (slot: PortraitSlot, variant: string): void => {
    out.push({ slot, variant, assetId: portraitLayerId(slot, variant), tint: SLOT_TINT[slot] });
  };
  if (look.background) add('background', look.group);
  if (look.hairStyle !== 'bald' && (HAIR_BACK_STYLES as readonly string[]).includes(look.hairStyle)) add('hairBack', look.hairStyle);
  add('body', look.bodyRank === 'clergy' ? 'robe-clergy' : look.bodyRank === 'seer' ? 'robe-seer' : `${look.group}-${look.sex}-${look.bodyRank}`);
  add('face', `${look.face}-${look.sex}`);
  for (const s of look.scars) add('scar', s);
  add('age', look.stage);
  if (look.beard !== 'none') add('beard', look.beard);
  if (look.hairStyle !== 'bald') add('hair', look.hairStyle);
  if (look.headwear !== 'none') add('headwear', look.headwear);
  for (const a of look.accessories) add('accessory', a);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Geometry

interface Head {
  cx: number;
  top: number;
  L: number;
  tw: number;
  cw: number;
  jw: number;
  chw: number;
  eyeY: number;
  noseY: number;
  mouthY: number;
  chinY: number;
  hairlineY: number;
  eyeDx: number;
  eyeW: number;
  eyeH: number;
  neckW: number;
  neckTop: number;
  shoulderY: number;
  sw: number;
  mw: number;
}

const FACE_DIMS: Readonly<Record<FaceShape, { tw: number; cw: number; jw: number; chw: number; L: number }>> = {
  oval: { tw: 88, cw: 98, jw: 78, chw: 34, L: 262 },
  round: { tw: 92, cw: 104, jw: 90, chw: 46, L: 248 },
  square: { tw: 92, cw: 100, jw: 95, chw: 54, L: 256 },
  long: { tw: 84, cw: 90, jw: 72, chw: 34, L: 282 },
  heart: { tw: 96, cw: 102, jw: 68, chw: 26, L: 256 },
  broad: { tw: 98, cw: 112, jw: 98, chw: 50, L: 252 },
};

function headOf(look: PortraitLook): Head {
  const d = FACE_DIMS[look.face];
  const fem = look.sex === 'female';
  const st = look.stage;
  const k = st === 'child' ? 0.85 : st === 'youth' ? 0.96 : 1;
  const L = d.L * (fem ? 0.96 : 1) * (st === 'child' ? 0.86 : k);
  const wk = (fem ? 0.93 : 1) * k * (look.slight ? 0.97 : 1) * (look.towering ? 1.02 : 1);
  const old = st === 'old' ? 1.03 : 1;
  const cw = d.cw * wk;
  const tw = d.tw * wk;
  const jw = d.jw * wk * (fem ? 0.9 : 1) * (st === 'child' ? 0.86 : 1) * old;
  const chw = d.chw * wk * (fem ? 0.88 : 1);
  const top = st === 'child' ? 178 : st === 'youth' ? 140 : 126;
  const chinY = top + L;
  const eyeY = top + L * (st === 'child' ? 0.54 : 0.465);
  const noseY = top + L * (st === 'child' ? 0.69 : 0.675);
  const mouthY = top + L * (st === 'child' ? 0.81 : 0.805);
  const hairlineY = top + L * (st === 'child' ? 0.26 : 0.2);
  const eyeW = (st === 'child' ? 35 : 31) * (fem ? 1.05 : 1);
  const eyeH = (st === 'child' ? 15.5 : 12.5) * (fem ? 1.06 : 1) * (st === 'old' ? 0.88 : 1);
  return {
    cx: W / 2,
    top,
    L,
    tw,
    cw,
    jw,
    chw,
    eyeY,
    noseY,
    mouthY,
    chinY,
    hairlineY,
    eyeDx: cw * 0.43,
    eyeW,
    eyeH,
    neckW: jw * (fem ? 0.5 : 0.6) * (st === 'child' ? 0.82 : 1) * (look.towering ? 1.1 : 1),
    neckTop: chinY - L * 0.28,
    shoulderY: chinY + (st === 'child' ? 52 : st === 'youth' ? 62 : 70),
    sw: (st === 'child' ? 150 : fem ? 182 : 208) * (look.towering ? 1.07 : 1) * (look.slight ? 0.93 : 1),
    mw: (st === 'child' ? 19 : fem ? 24 : 23) * (look.mouth === 2 ? 1.12 : look.mouth === 3 ? 0.9 : 1),
  };
}

function mirrorPts(right: readonly number[], cx: number): number[] {
  const out: number[] = [];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(2 * cx - (right[i] as number), right[i + 1] as number);
  return out;
}

function faceOutline(h: Head, sag = 0): string {
  const { cx, top, L, tw, cw, jw, chw, eyeY, noseY, mouthY, chinY } = h;
  const right = [
    cx + tw * 0.7, top + L * 0.04,
    cx + tw, top + L * 0.2,
    cx + cw, eyeY + L * 0.02,
    cx + cw * 0.95, noseY + L * 0.01,
    cx + jw, mouthY + sag,
    cx + chw, chinY - L * 0.045 + sag * 0.5,
  ];
  return smoothClosed([cx, top, ...right, cx, chinY + sag * 0.3, ...mirrorPts(right, cx)]);
}

// ---------------------------------------------------------------------------------------------
// Drawing context

interface Ctx {
  look: PortraitLook;
  h: Head;
  defs: string[];
  rng: ArtRng;
}

function hairFill(c: Ctx, id: string, colour: string): string {
  c.defs.push(linearGradient(id, [[0, shade(colour, 0.22)], [0.45, colour], [1, shade(colour, -0.35)]], { x1: 0.2, y1: 0, x2: 0.8, y2: 1 }));
  return `url(#${id})`;
}

/** Thin strand strokes inside a clip, for painted hair/fur texture. */
function strands(c: Ctx, clipId: string, colour: string, count: number, box: { x: number; y: number; w: number; h: number }, opts: { flow?: number; light?: boolean; rngKey: string; width?: number }): string {
  const r = c.rng.fork(opts.rngKey);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = box.x + r.next() * box.w;
    const y = box.y + r.next() * box.h * 0.6;
    const len = box.h * r.range(0.25, 0.6);
    const bend = (opts.flow ?? 0) * len * 0.4 + r.jitter(len * 0.15);
    const light = opts.light !== false && r.chance(0.35);
    out.push(
      path(`M${n(x)} ${n(y)}Q${n(x + bend)} ${n(y + len * 0.5)} ${n(x + bend * 0.6)} ${n(y + len)}`, {
        fill: 'none',
        stroke: light ? shade(colour, 0.3) : shade(colour, -0.35),
        'stroke-width': n2((opts.width ?? 1.6) * r.range(0.6, 1.3)),
        'stroke-opacity': n2(light ? 0.45 : 0.55),
        'stroke-linecap': 'round',
      }),
    );
  }
  return g({ 'clip-path': `url(#${clipId})` }, out);
}

// ---------------------------------------------------------------------------------------------
// Slots

const BG: Readonly<Record<CultureGroup, [string, string]>> = {
  north: ['#5d6f80', '#1d2630'],
  west: ['#6f7a62', '#232a20'],
  south: ['#a07a4a', '#3a2614'],
  east: ['#8a5f48', '#2e1c14'],
  steppe: ['#6a8a88', '#1f2e30'],
  far: ['#8a98a6', '#2a323a'],
};

function drawBackground(c: Ctx, variant: string): string {
  const [light, dark] = BG[(variant as CultureGroup) in BG ? (variant as CultureGroup) : 'north'];
  c.defs.push(radialGradient('p-bg', [[0, shade(light, 0.12)], [0.55, light], [1, dark]], { cx: 0.42, cy: 0.36, r: 0.75 }));
  c.defs.push(mottleFilter('p-bgm', c.look.seed, 0.008));
  const strokes: string[] = [];
  const r = c.rng.fork('bgStrokes');
  for (let i = 0; i < 14; i++) {
    const y = r.range(0, H);
    strokes.push(
      path(`M${n(r.range(-60, 100))} ${n(y)}Q${n(W / 2)} ${n(y + r.jitter(60))} ${n(r.range(W - 100, W + 60))} ${n(y + r.jitter(40))}`, {
        fill: 'none',
        stroke: r.chance(0.5) ? shade(light, 0.2) : shade(dark, 0.1),
        'stroke-width': n(r.range(18, 50)),
        'stroke-opacity': n2(r.range(0.04, 0.1)),
        'stroke-linecap': 'round',
      }),
    );
  }
  return g({}, [rect(0, 0, W, H, { fill: 'url(#p-bg)' }), ...strokes, rect(0, 0, W, H, { filter: 'url(#p-bgm)', opacity: '0.6', style: 'mix-blend-mode:multiply' })]);
}

function drawHairBack(c: Ctx, style: string): string {
  const { h, look } = c;
  const { cx, eyeY, chinY, cw, top } = h;
  const col = look.hair;
  const fill = hairFill(c, 'p-hb', shade(col, -0.18));
  let bottom = chinY + 120;
  let half = cw + 34;
  if (style === 'shoulder') bottom = chinY + 60;
  if (style === 'warriorTail' || style === 'braidedBack') {
    bottom = chinY + 150;
    half = cw * 0.75;
  }
  if (style === 'bun' || style === 'plaitSingle') {
    bottom = chinY + 10;
    half = cw + 6;
  }
  const d = smoothClosed([
    cx, top - 14,
    cx + cw * 0.9, top + 30,
    cx + half, eyeY,
    cx + half + 8, chinY,
    cx + half * 0.9, bottom,
    cx, bottom + 14,
    cx - half * 0.9, bottom,
    cx - half - 8, chinY,
    cx - half, eyeY,
    cx - cw * 0.9, top + 30,
  ]);
  c.defs.push(el('clipPath', { id: 'p-hbc' }, path(d)));
  const parts = [path(d, { fill })];
  parts.push(strands(c, 'p-hbc', col, 40, { x: cx - half - 10, y: top, w: half * 2 + 20, h: bottom - top + 20 }, { rngKey: 'hbStrands', flow: 0.1 }));
  if (style === 'braidedBack') {
    parts.push(braid(c, cx - cw * 0.95, eyeY + 30, cx - cw * 1.05, chinY + 150, col, 13, 'bbL'));
    parts.push(braid(c, cx + cw * 0.95, eyeY + 30, cx + cw * 1.05, chinY + 150, col, 13, 'bbR'));
  }
  return g({}, parts);
}

/** A braid from (x0,y0) to (x1,y1). */
function braid(c: Ctx, x0: number, y0: number, x1: number, y1: number, colour: string, width: number, key: string): string {
  const out: string[] = [];
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(3, Math.floor(len / (width * 1.05)));
  const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI - 90;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const w = width * (1 - t * 0.35);
    const side = i % 2 === 0 ? 1 : -1;
    out.push(
      ellipse(x + side * w * 0.18, y, w * 0.62, w * 0.72, {
        fill: i % 2 === 0 ? colour : shade(colour, -0.1),
        stroke: shade(colour, -0.45),
        'stroke-width': '1.2',
        transform: `rotate(${n(ang + side * 28)} ${n(x)} ${n(y)})`,
      }),
    );
  }
  out.push(ellipse(x1, y1 + 2, width * 0.42, width * 0.25, { fill: c.look.trim, stroke: shade(c.look.trim, -0.4), 'stroke-width': '1' }));
  out.push(path(`M${n(x1 - width * 0.35)} ${n(y1 + 4)}Q${n(x1)} ${n(y1 + width * 1.8)} ${n(x1 + width * 0.35)} ${n(y1 + 4)}Z`, { fill: shade(colour, -0.05) }));
  void key;
  return g({}, out);
}

/** Torso garment outline with a neckline cut-out. */
function torsoPath(h: Head, neckHalf: number, depth: number, widen = 0): string {
  const { cx, shoulderY, sw } = h;
  const y0 = shoulderY - 12;
  const s = sw + widen;
  return (
    `M${n(cx - neckHalf)} ${n(y0)}` +
    `C${n(cx - neckHalf - 40)} ${n(y0 + 4)} ${n(cx - s + 34)} ${n(y0 + 12)} ${n(cx - s)} ${n(y0 + 52)}` +
    `L${n(cx - s - 26)} ${n(H + 10)}L${n(cx + s + 26)} ${n(H + 10)}L${n(cx + s)} ${n(y0 + 52)}` +
    `C${n(cx + s - 34)} ${n(y0 + 12)} ${n(cx + neckHalf + 40)} ${n(y0 + 4)} ${n(cx + neckHalf)} ${n(y0)}` +
    `Q${n(cx)} ${n(y0 + depth * 2)} ${n(cx - neckHalf)} ${n(y0)}Z`
  );
}

function necklineCurve(h: Head, neckHalf: number, depth: number): string {
  const y0 = h.shoulderY - 12;
  return `M${n(h.cx - neckHalf)} ${n(y0)}Q${n(h.cx)} ${n(y0 + depth * 2)} ${n(h.cx + neckHalf)} ${n(y0)}`;
}

function trimStroke(d: string, colour: string, width: number, accent: string): string {
  return (
    path(d, { fill: 'none', stroke: shade(colour, -0.3), 'stroke-width': n(width + 2.5), 'stroke-linecap': 'round' }) +
    path(d, { fill: 'none', stroke: colour, 'stroke-width': n(width), 'stroke-linecap': 'round' }) +
    path(d, { fill: 'none', stroke: accent, 'stroke-width': n(width * 0.45), 'stroke-dasharray': `${n(width * 0.5)} ${n(width * 0.7)}`, 'stroke-linecap': 'round' })
  );
}

function brooch(kind: 'round' | 'oval' | 'penannular' | 'fibula', x: number, y: number, metal: string, scale = 1): string {
  const s = scale;
  const hi = shade(metal, 0.45);
  const lo = shade(metal, -0.45);
  switch (kind) {
    case 'oval':
      return g({}, [
        ellipse(x, y, 15 * s, 21 * s, { fill: lo }),
        ellipse(x - 1, y - 1, 13.5 * s, 19.5 * s, { fill: metal }),
        ellipse(x - 3 * s, y - 5 * s, 6 * s, 9 * s, { fill: hi, opacity: '0.6' }),
        path(`M${n(x)} ${n(y - 17 * s)}V${n(y + 17 * s)}M${n(x - 11 * s)} ${n(y)}H${n(x + 11 * s)}`, { stroke: lo, 'stroke-width': n(1.6 * s), opacity: '0.7' }),
        circle(x, y, 3 * s, { fill: lo }),
      ]);
    case 'penannular':
      return g({}, [
        path(`M${n(x + 10 * s)} ${n(y - 12 * s)}A${n(16 * s)} ${n(16 * s)} 0 1 1 ${n(x - 10 * s)} ${n(y - 12 * s)}`, { fill: 'none', stroke: lo, 'stroke-width': n(6 * s) }),
        path(`M${n(x + 10 * s)} ${n(y - 12 * s)}A${n(16 * s)} ${n(16 * s)} 0 1 1 ${n(x - 10 * s)} ${n(y - 12 * s)}`, { fill: 'none', stroke: metal, 'stroke-width': n(4 * s) }),
        path(`M${n(x - 4 * s)} ${n(y - 26 * s)}L${n(x + 6 * s)} ${n(y + 22 * s)}`, { stroke: hi, 'stroke-width': n(2.4 * s), 'stroke-linecap': 'round' }),
        circle(x + 10 * s, y - 12 * s, 3.2 * s, { fill: hi }),
        circle(x - 10 * s, y - 12 * s, 3.2 * s, { fill: hi }),
      ]);
    case 'fibula':
      return g({}, [
        rect(x - 14 * s, y - 10 * s, 28 * s, 6 * s, { rx: 3 * s, fill: metal, stroke: lo, 'stroke-width': '1' }),
        path(`M${n(x)} ${n(y - 6 * s)}Q${n(x + 7 * s)} ${n(y + 4 * s)} ${n(x)} ${n(y + 16 * s)}`, { fill: 'none', stroke: metal, 'stroke-width': n(5 * s), 'stroke-linecap': 'round' }),
        circle(x - 14 * s, y - 7 * s, 3 * s, { fill: hi }),
        circle(x + 14 * s, y - 7 * s, 3 * s, { fill: hi }),
        circle(x, y + 16 * s, 3 * s, { fill: hi }),
      ]);
    default:
      return g({}, [
        circle(x, y, 15 * s, { fill: lo }),
        circle(x - 0.8, y - 0.8, 13.5 * s, { fill: metal }),
        circle(x, y, 9 * s, { fill: 'none', stroke: lo, 'stroke-width': n(1.5 * s) }),
        circle(x, y, 3.5 * s, { fill: hi }),
        ...[0, 1, 2, 3, 4, 5].map((i) => circle(x + Math.cos((i * Math.PI) / 3) * 11 * s, y + Math.sin((i * Math.PI) / 3) * 11 * s, 1.6 * s, { fill: hi })),
      ]);
  }
}

function furBand(c: Ctx, d: string, colour: string, width: number, key: string): string {
  const r = c.rng.fork(key);
  const dashes: string[] = [];
  for (let i = 0; i < 3; i++) {
    dashes.push(
      path(d, {
        fill: 'none',
        stroke: i === 1 ? shade(colour, 0.25) : shade(colour, -0.3),
        'stroke-width': n(width * (0.9 - i * 0.2)),
        'stroke-dasharray': `${n(r.range(1.5, 3))} ${n(r.range(2, 4))}`,
        'stroke-linecap': 'round',
        opacity: '0.7',
      }),
    );
  }
  return path(d, { fill: 'none', stroke: colour, 'stroke-width': n(width), 'stroke-linecap': 'round' }) + dashes.join('');
}

function drawBody(c: Ctx, variant: string): string {
  const { h, look } = c;
  const { cx, shoulderY, sw } = h;
  const y0 = shoulderY - 12;
  const parts: string[] = [];
  const [grp, sex, rnk] = variant.split('-') as [string, string, string];
  const robe = grp === 'robe';
  const female = sex === 'female';
  const metal = look.metal;
  const cloth = look.cloth;
  const cloth2 = look.cloth2;
  const nh = h.neckW + 12;

  // Neck (drawn here so garments overlap it).
  const neckD = `M${n(cx - h.neckW)} ${n(h.neckTop)}L${n(cx - h.neckW * 1.12)} ${n(y0 + 40)}L${n(cx + h.neckW * 1.12)} ${n(y0 + 40)}L${n(cx + h.neckW)} ${n(h.neckTop)}Z`;
  c.defs.push(linearGradient('p-neck', [[0, shade(look.skin, -0.42)], [0.35, shade(look.skin, -0.12)], [1, shade(look.skin, -0.05)]], { x1: 0, y1: 0, x2: 0, y2: 1 }));
  parts.push(path(neckD, { fill: 'url(#p-neck)' }));
  if (look.stage === 'middle' || look.stage === 'old') {
    parts.push(path(`M${n(cx - h.neckW * 0.5)} ${n(h.chinY + 18)}Q${n(cx)} ${n(h.chinY + 28)} ${n(cx + h.neckW * 0.5)} ${n(h.chinY + 18)}`, { fill: 'none', stroke: shade(look.skin, -0.3), 'stroke-width': '1.5', opacity: '0.5' }));
  }

  c.defs.push(linearGradient('p-cloth', [[0, shade(cloth, 0.12)], [0.55, cloth], [1, shade(cloth, -0.35)]], { x1: 0, y1: 0, x2: 1, y2: 0.3 }));
  c.defs.push(linearGradient('p-cloth2', [[0, shade(cloth2, 0.1)], [1, shade(cloth2, -0.3)]], { x1: 0, y1: 0, x2: 1, y2: 0.3 }));

  if (robe) {
    const isSeer = sex === 'seer';
    const rc = isSeer ? mix('#24283a', cloth, 0.2) : look.group === 'south' ? '#d8cfbf' : mix('#5a4a3a', cloth, 0.2);
    c.defs.push(linearGradient('p-robe', [[0, shade(rc, 0.12)], [1, shade(rc, -0.35)]], { x1: 0, y1: 0, x2: 1, y2: 0.3 }));
    parts.push(path(torsoPath(h, nh - 4, 10, 6), { fill: 'url(#p-robe)' }));
    // Cowl folds around the neck.
    const cowl = `M${n(cx - nh - 30)} ${n(y0 + 6)}Q${n(cx)} ${n(y0 + 70)} ${n(cx + nh + 30)} ${n(y0 + 6)}`;
    parts.push(path(cowl, { fill: 'none', stroke: shade(rc, -0.2), 'stroke-width': '26', 'stroke-linecap': 'round' }));
    parts.push(path(cowl, { fill: 'none', stroke: shade(rc, 0.08), 'stroke-width': '14', 'stroke-linecap': 'round' }));
    for (let i = 0; i < 4; i++) {
      const x = cx - sw * 0.6 + i * sw * 0.4;
      parts.push(path(`M${n(x)} ${n(y0 + 70)}Q${n(x + 10)} ${n(y0 + 140)} ${n(x - 4)} ${n(H)}`, { fill: 'none', stroke: shade(rc, -0.3), 'stroke-width': '4', opacity: '0.35' }));
    }
    if (isSeer) {
      const beadsD = `M${n(cx - nh - 10)} ${n(y0 + 4)}Q${n(cx)} ${n(y0 + 110)} ${n(cx + nh + 10)} ${n(y0 + 4)}`;
      parts.push(path(beadsD, { fill: 'none', stroke: '#c9a227', 'stroke-width': '7', 'stroke-dasharray': '0.1 11', 'stroke-linecap': 'round' }));
      parts.push(path(beadsD, { fill: 'none', stroke: '#3a6a8a', 'stroke-width': '6', 'stroke-dasharray': '0.1 11', 'stroke-dashoffset': '5.5', 'stroke-linecap': 'round' }));
    }
    return g({}, parts);
  }

  const group = grp as CultureGroup;
  const warrior = rnk === 'warrior';
  const noble = rnk === 'noble';

  if (group === 'far') {
    // Fur parka with a ruff.
    const parka = mix('#7a6248', cloth, 0.25);
    c.defs.push(linearGradient('p-parka', [[0, shade(parka, 0.1)], [1, shade(parka, -0.35)]], { x1: 0, y1: 0, x2: 1, y2: 0.3 }));
    parts.push(path(torsoPath(h, nh, 8, 10), { fill: 'url(#p-parka)' }));
    parts.push(path(`M${n(cx)} ${n(y0 + 20)}V${n(H)}`, { stroke: shade(parka, -0.4), 'stroke-width': '3' }));
    for (let i = 0; i < 3; i++) parts.push(rect(cx - 9, y0 + 60 + i * 40, 18, 6, { rx: 3, fill: '#d8ccb0', stroke: '#5a4a3a', 'stroke-width': '1' }));
    parts.push(furBand(c, `M${n(cx - nh - 34)} ${n(y0 + 4)}Q${n(cx)} ${n(y0 + 56)} ${n(cx + nh + 34)} ${n(y0 + 4)}`, '#cfc2a8', 34, 'ruff'));
    if (noble) parts.push(trimStroke(`M${n(cx - sw + 10)} ${n(y0 + 120)}Q${n(cx)} ${n(y0 + 150)} ${n(cx + sw - 10)} ${n(y0 + 120)}`, look.trim, 10, '#8a2a20'));
    return g({}, parts);
  }

  if (female && group === 'north') {
    // Linen underdress, apron dress on straps, oval brooches and a bead festoon.
    const linen = '#d8ceb8';
    parts.push(path(torsoPath(h, nh - 6, 7, 0), { fill: linen }));
    parts.push(path(necklineCurve(h, nh - 6, 7), { fill: 'none', stroke: shade(linen, -0.25), 'stroke-width': '3' }));
    const apronTop = y0 + 46;
    const ax = sw * 0.66;
    parts.push(path(`M${n(cx - ax)} ${n(apronTop)}Q${n(cx)} ${n(apronTop + 14)} ${n(cx + ax)} ${n(apronTop)}L${n(cx + ax + 40)} ${n(H + 10)}L${n(cx - ax - 40)} ${n(H + 10)}Z`, { fill: 'url(#p-cloth)' }));
    parts.push(trimStroke(`M${n(cx - ax)} ${n(apronTop)}Q${n(cx)} ${n(apronTop + 14)} ${n(cx + ax)} ${n(apronTop)}`, look.trim, 8, cloth2));
    const bx = sw * 0.45;
    for (const s of [-1, 1]) {
      parts.push(path(`M${n(cx + s * bx)} ${n(apronTop + 4)}L${n(cx + s * (bx + 18))} ${n(y0 - 2)}`, { stroke: cloth, 'stroke-width': '16', 'stroke-linecap': 'round' }));
    }
    if (noble || warrior) {
      const cloak = mix(cloth2, '#2a2a3a', 0.3);
      parts.push(path(`M${n(cx - sw - 6)} ${n(y0 + 54)}Q${n(cx - sw + 40)} ${n(y0 + 6)} ${n(cx - nh - 10)} ${n(y0 - 2)}L${n(cx - sw * 0.7)} ${n(H)}L${n(cx - sw - 30)} ${n(H)}Z`, { fill: cloak }));
      parts.push(path(`M${n(cx + sw + 6)} ${n(y0 + 54)}Q${n(cx + sw - 40)} ${n(y0 + 6)} ${n(cx + nh + 10)} ${n(y0 - 2)}L${n(cx + sw * 0.7)} ${n(H)}L${n(cx + sw + 30)} ${n(H)}Z`, { fill: shade(cloak, -0.1) }));
      if (noble) parts.push(furBand(c, `M${n(cx - sw + 4)} ${n(y0 + 40)}Q${n(cx - sw * 0.5)} ${n(y0 - 4)} ${n(cx - nh - 8)} ${n(y0 - 2)}M${n(cx + nh + 8)} ${n(y0 - 2)}Q${n(cx + sw * 0.5)} ${n(y0 - 4)} ${n(cx + sw - 4)} ${n(y0 + 40)}`, '#8a6a4a', 20, 'nfur'));
    }
    parts.push(brooch('oval', cx - bx, apronTop + 2, metal));
    parts.push(brooch('oval', cx + bx, apronTop + 2, metal));
    const beadColours = ['#d88a2a', '#2f5f8a', '#8a2a2a', '#e0d0a0', '#3a7a5a'];
    const r = c.rng.fork('festoon');
    for (let row = 0; row < 2; row++) {
      const sag = 46 + row * 30;
      const count = 13 + row * 3;
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const x = cx - bx + 2 * bx * t;
        const y = apronTop + 10 + sag * 4 * t * (1 - t);
        parts.push(circle(x, y, 4.2, { fill: r.pick(beadColours), stroke: '#1a120c', 'stroke-width': '0.8' }));
      }
    }
    return g({}, parts);
  }

  // Base tunic / gown / caftan.
  const deep = female ? 12 : group === 'east' ? 6 : 9;
  parts.push(path(torsoPath(h, nh, deep, 0), { fill: 'url(#p-cloth)' }));

  if (warrior) {
    const lamellar = group === 'steppe' || (group === 'south' && look.culture === 'saraleonese');
    if (lamellar) {
      c.defs.push(
        el('pattern', { id: 'p-lam', width: '9', height: '14', patternUnits: 'userSpaceOnUse' }, [
          rect(0, 0, 9, 14, { fill: '#4a4e52' }),
          rect(0.8, 0.5, 7.4, 12.5, { rx: 3, fill: '#8a9096', stroke: '#2a2d30', 'stroke-width': '0.8' }),
        ]),
      );
      parts.push(path(torsoPath(h, nh + 4, deep, -6), { fill: 'url(#p-lam)', opacity: '0.95' }));
    } else {
      c.defs.push(
        el('pattern', { id: 'p-mail', width: '7', height: '5', patternUnits: 'userSpaceOnUse' }, [
          rect(0, 0, 7, 5, { fill: '#454a4f' }),
          path('M0 2.5a3.5 2.5 0 0 1 7 0', { fill: 'none', stroke: '#a8aeb4', 'stroke-width': '1.1' }),
          path('M-3.5 5a3.5 2.5 0 0 1 7 0M3.5 5a3.5 2.5 0 0 1 7 0', { fill: 'none', stroke: '#2a2d30', 'stroke-width': '0.9' }),
        ]),
      );
      parts.push(path(torsoPath(h, nh + 4, deep, -4), { fill: 'url(#p-mail)' }));
    }
    c.defs.push(linearGradient('p-armshade', [[0, '#ffffff', 0.12], [0.5, '#000000', 0], [1, '#000000', 0.45]], { x1: 0, y1: 0, x2: 1, y2: 0 }));
    parts.push(path(torsoPath(h, nh + 4, deep, -4), { fill: 'url(#p-armshade)' }));
    parts.push(path(necklineCurve(h, nh + 4, deep), { fill: 'none', stroke: '#5a3a24', 'stroke-width': '9', 'stroke-linecap': 'round' }));
  }

  if (group === 'steppe' || (group === 'east' && noble)) {
    // Crossover caftan lapel.
    const lap = `M${n(cx - nh)} ${n(y0 + 2)}Q${n(cx + sw * 0.1)} ${n(y0 + 90)} ${n(cx + sw * 0.42)} ${n(H + 10)}`;
    if (!warrior) parts.push(path(`${lap}L${n(cx + sw + 30)} ${n(H + 10)}L${n(cx + sw)} ${n(y0 + 52)}Z`, { fill: shade(cloth, -0.08), opacity: '0.7' }));
    parts.push(trimStroke(lap, look.trim, 12, '#8a2a20'));
    parts.push(trimStroke(`M${n(cx - sw - 10)} ${n(H - 70)}Q${n(cx)} ${n(H - 52)} ${n(cx + sw + 10)} ${n(H - 70)}`, '#3a2a1a', 14, metal));
  } else if (group === 'east') {
    // Side-slit shirt with embroidered collar.
    parts.push(path(`M${n(cx - 14)} ${n(y0 + deep * 1.6)}V${n(y0 + 62)}`, { stroke: '#8a2a20', 'stroke-width': '6' }));
    parts.push(trimStroke(necklineCurve(h, nh, deep), '#8a2a20', 9, '#e0c070'));
    parts.push(trimStroke(`M${n(cx - sw - 10)} ${n(H - 60)}Q${n(cx)} ${n(H - 44)} ${n(cx + sw + 10)} ${n(H - 60)}`, '#5a3a1a', 10, '#c8a050'));
  } else if (!warrior) {
    parts.push(trimStroke(necklineCurve(h, nh, deep), look.trim, female ? 7 : 8, cloth2));
  }

  if (group === 'south' && look.culture === 'saraleonese' && !warrior) {
    for (const s of [-1, 1]) parts.push(path(`M${n(cx + s * (nh + 16))} ${n(y0 + 4)}L${n(cx + s * (nh + 26))} ${n(H)}`, { stroke: noble ? '#6a1f4a' : '#7a3a2a', 'stroke-width': '12' }));
  }

  // Cloak (most men, west/south women, nobles everywhere).
  const cloakChance = c.rng.fork('cloak').next();
  const wantCloak = noble || warrior || (!female && cloakChance < 0.7) || (female && group !== 'east' && group !== 'steppe' && cloakChance < 0.45);
  if (wantCloak && group !== 'steppe') {
    const cloak = noble ? mix(cloth2, '#3a1a2a', 0.35) : mix(cloth2, '#3a3a3a', 0.35);
    c.defs.push(linearGradient('p-cloak', [[0, shade(cloak, 0.15)], [1, shade(cloak, -0.4)]], { x1: 0, y1: 0, x2: 1, y2: 0.4 }));
    const bx = cx - nh - 30;
    const by = y0 + 30;
    // Right panel (over the wearer's left shoulder), left panel pinned at the brooch.
    parts.push(path(`M${n(bx)} ${n(by)}Q${n(cx)} ${n(y0 - 16)} ${n(cx + nh + 24)} ${n(y0 - 6)}Q${n(cx + sw - 20)} ${n(y0 + 6)} ${n(cx + sw + 8)} ${n(y0 + 56)}L${n(cx + sw + 34)} ${n(H + 10)}L${n(cx + 30)} ${n(H + 10)}Q${n(cx - 10)} ${n(by + 90)} ${n(bx)} ${n(by)}Z`, { fill: 'url(#p-cloak)' }));
    parts.push(path(`M${n(bx)} ${n(by)}Q${n(cx - sw + 30)} ${n(y0 + 2)} ${n(cx - sw - 6)} ${n(y0 + 56)}L${n(cx - sw - 30)} ${n(H + 10)}L${n(cx - sw + 60)} ${n(H + 10)}Q${n(bx - 20)} ${n(by + 80)} ${n(bx)} ${n(by)}Z`, { fill: 'url(#p-cloak)' }));
    for (let i = 0; i < 3; i++) {
      const x = cx + 60 + i * 50;
      parts.push(path(`M${n(x)} ${n(y0 + 40 + i * 6)}Q${n(x + 12)} ${n(y0 + 120)} ${n(x + 4)} ${n(H)}`, { fill: 'none', stroke: shade(cloak, -0.45), 'stroke-width': '5', opacity: '0.35' }));
    }
    if (noble) parts.push(furBand(c, `M${n(bx + 6)} ${n(by - 6)}Q${n(cx)} ${n(y0 - 22)} ${n(cx + nh + 30)} ${n(y0 - 8)}Q${n(cx + sw - 30)} ${n(y0)} ${n(cx + sw)} ${n(y0 + 40)}`, look.group === 'south' ? '#d8c8a0' : '#7a5a3e', 22, 'cfur'));
    if (noble && group === 'south') {
      parts.push(rect(cx + 50, y0 + 70, 46, 56, { fill: '#c9a227', stroke: '#6a4a10', 'stroke-width': '2', opacity: '0.9' }));
      parts.push(rect(cx + 57, y0 + 77, 32, 42, { fill: 'none', stroke: '#6a1f4a', 'stroke-width': '3' }));
    }
    const kind: 'round' | 'penannular' | 'fibula' = group === 'west' ? (look.culture === 'cael' ? 'penannular' : 'round') : group === 'south' ? 'fibula' : 'round';
    parts.push(brooch(kind, bx, by, noble ? '#d4af37' : metal, 1.05));
  }

  if (noble && group === 'south' && look.culture === 'saraleonese') {
    const col = `M${n(cx - nh - 14)} ${n(y0 - 2)}Q${n(cx)} ${n(y0 + 60)} ${n(cx + nh + 14)} ${n(y0 - 2)}`;
    parts.push(path(col, { fill: 'none', stroke: '#c9a227', 'stroke-width': '20', 'stroke-linecap': 'round' }));
    parts.push(path(col, { fill: 'none', stroke: '#f3ecd8', 'stroke-width': '5', 'stroke-dasharray': '0.1 9', 'stroke-linecap': 'round' }));
    parts.push(path(col, { fill: 'none', stroke: '#8a1f3a', 'stroke-width': '7', 'stroke-dasharray': '0.1 27', 'stroke-dashoffset': '4', 'stroke-linecap': 'round' }));
  }
  return g({}, parts);
}

function drawFace(c: Ctx, variant: string): string {
  const { h, look } = c;
  const { cx, eyeY, noseY, mouthY, chinY, cw, eyeDx, eyeW, eyeH, mw } = h;
  const skin = look.sickly ? mix(look.skin, '#b8b8a0', 0.25) : look.skin;
  const dark = shade(skin, -0.38);
  const parts: string[] = [];
  void variant;
  const sag = look.stage === 'old' ? 6 : look.stage === 'middle' ? 2 : 0;
  const outline = faceOutline(h, sag);

  // Ears.
  for (const s of [-1, 1]) {
    const ex = cx + s * cw * 0.94;
    parts.push(
      path(`M${n(ex)} ${n(eyeY - 6)}C${n(ex + s * 22)} ${n(eyeY - 16)} ${n(ex + s * 24)} ${n(noseY + 4)} ${n(ex - s * 2)} ${n(noseY + 18)}Z`, {
        fill: shade(skin, -0.08),
        stroke: shade(skin, -0.35),
        'stroke-width': '1.4',
      }),
    );
    parts.push(path(`M${n(ex + s * 4)} ${n(eyeY + 2)}C${n(ex + s * 14)} ${n(eyeY - 2)} ${n(ex + s * 14)} ${n(noseY - 4)} ${n(ex + s * 3)} ${n(noseY + 6)}`, { fill: 'none', stroke: shade(skin, -0.4), 'stroke-width': '1.6', opacity: '0.6' }));
  }

  c.defs.push(radialGradient('p-skin', [[0, shade(skin, 0.1)], [0.55, skin], [1, shade(skin, -0.28)]], { cx: 0.42, cy: 0.4, r: 0.68 }));
  parts.push(path(outline, { fill: 'url(#p-skin)' }));
  c.defs.push(linearGradient('p-side', [[0, '#000000', 0], [0.62, '#000000', 0], [1, shade(skin, -0.6), 0.45]], { x1: 0, y1: 0, x2: 1, y2: 0 }));
  parts.push(path(outline, { fill: 'url(#p-side)' }));
  c.defs.push(el('clipPath', { id: 'p-facec' }, path(outline)));

  // Cheeks.
  const blush = look.sex === 'female' || look.stage === 'child' ? 0.2 : 0.12;
  c.defs.push(radialGradient('p-blush', [[0, '#d0645a', blush], [1, '#d0645a', 0]]));
  for (const s of [-1, 1]) parts.push(ellipse(cx + s * cw * 0.55, noseY - 4, 30, 22, { fill: 'url(#p-blush)' }));

  // Eye sockets.
  c.defs.push(radialGradient('p-socket', [[0, dark, 0.28], [1, dark, 0]]));
  for (const s of [-1, 1]) parts.push(ellipse(cx + s * eyeDx, eyeY - 2, eyeW * 0.95, eyeH * 1.6, { fill: 'url(#p-socket)' }));

  // Eyes.
  const tilt = look.eyeShape === 1 ? -2.5 : look.eyeShape === 2 ? 2 : 0;
  const eh = look.eyeShape === 3 ? eyeH * 0.78 : eyeH;
  c.defs.push(radialGradient('p-iris', [[0, shade(look.eye, 0.35)], [0.6, look.eye], [1, shade(look.eye, -0.5)]]));
  for (const s of [-1, 1]) {
    const ex = cx + s * eyeDx;
    const xi = ex - s * eyeW / 2;
    const xo = ex + s * eyeW / 2;
    const yo = eyeY + tilt;
    const eyeD = `M${n(xi)} ${n(eyeY)}Q${n(ex)} ${n(eyeY - eh * 1.15)} ${n(xo)} ${n(yo)}Q${n(ex)} ${n(eyeY + eh * 0.8)} ${n(xi)} ${n(eyeY)}Z`;
    const clip = s < 0 ? 'p-eyeL' : 'p-eyeR';
    c.defs.push(el('clipPath', { id: clip }, path(eyeD)));
    const blind = look.scars.includes('blindEye') && s > 0;
    parts.push(path(eyeD, { fill: mix('#f2ebe2', skin, 0.18) }));
    parts.push(
      g({ 'clip-path': `url(#${clip})` }, [
        circle(ex + s * 0.5, eyeY + 0.5, eh * 0.62, { fill: blind ? '#d8d4cc' : 'url(#p-iris)' }),
        blind ? '' : circle(ex + s * 0.5, eyeY + 0.5, eh * 0.26, { fill: '#120c08' }),
        circle(ex - 2, eyeY - 2.5, 1.7, { fill: '#ffffff', opacity: '0.85' }),
        path(`M${n(xi)} ${n(eyeY - eh * 0.3)}Q${n(ex)} ${n(eyeY - eh * 1.3)} ${n(xo)} ${n(yo - eh * 0.3)}`, { fill: 'none', stroke: '#000000', 'stroke-width': '5', opacity: '0.18' }),
      ]),
    );
    parts.push(path(`M${n(xi)} ${n(eyeY)}Q${n(ex)} ${n(eyeY - eh * 1.15)} ${n(xo)} ${n(yo)}`, { fill: 'none', stroke: '#2a1a12', 'stroke-width': look.sex === 'female' ? '2.8' : '2.2', 'stroke-linecap': 'round' }));
    parts.push(path(`M${n(xi + s * 3)} ${n(eyeY + 1)}Q${n(ex)} ${n(eyeY + eh * 0.85)} ${n(xo - s * 2)} ${n(yo + 1)}`, { fill: 'none', stroke: shade(skin, -0.3), 'stroke-width': '1', opacity: '0.7' }));
    parts.push(path(`M${n(xi + s * 2)} ${n(eyeY - eh * 0.9)}Q${n(ex)} ${n(eyeY - eh * 1.75)} ${n(xo + s * 1)} ${n(yo - eh * 0.6)}`, { fill: 'none', stroke: shade(skin, -0.25), 'stroke-width': '1.4', opacity: '0.55' }));
  }

  // Brows.
  const browY = eyeY - eyeH - 14;
  const thick = (look.sex === 'female' ? 3.6 : 5.6) * (look.brows === 2 ? 1.35 : 1) * (look.stage === 'child' ? 0.8 : 1);
  const arch = look.brows === 1 ? 5 : look.brows === 3 ? -1 : 2.5;
  for (const s of [-1, 1]) {
    const xi = cx + s * (eyeDx - eyeW * 0.6);
    const xp = cx + s * (eyeDx + 3);
    const xo = cx + s * (eyeDx + eyeW * 0.68);
    const d = `M${n(xi)} ${n(browY + 3)}Q${n(xp)} ${n(browY - 3 - arch)} ${n(xo)} ${n(browY + 4)}Q${n(xp)} ${n(browY - 3 - arch + thick)} ${n(xi)} ${n(browY + 3 + thick)}Z`;
    parts.push(path(d, { fill: look.brow, opacity: '0.92' }));
  }

  // Nose.
  const nw = eyeW * 0.5 * (look.nose === 3 ? 1.28 : look.nose === 4 ? 0.85 : look.nose === 2 ? 1.1 : 1) * (look.stage === 'child' ? 0.85 : 1);
  const tipY = noseY + (look.nose === 2 ? -6 : look.nose === 4 ? 4 : 0);
  parts.push(path(`M${n(cx + 7)} ${n(eyeY + 4)}C${n(cx + 10)} ${n(eyeY + 30)} ${n(cx + 12)} ${n(tipY - 26)} ${n(cx + nw * 0.7)} ${n(tipY - 4)}`, { fill: 'none', stroke: dark, 'stroke-width': '6', opacity: '0.22', 'stroke-linecap': 'round' }));
  if (look.nose === 1) parts.push(path(`M${n(cx + 3)} ${n(eyeY + 20)}Q${n(cx + 9)} ${n(eyeY + 34)} ${n(cx + 5)} ${n(tipY - 18)}`, { fill: 'none', stroke: dark, 'stroke-width': '2', opacity: '0.4' }));
  parts.push(ellipse(cx, tipY + 8, nw * 0.75, 4, { fill: dark, opacity: '0.18' }));
  for (const s of [-1, 1]) {
    parts.push(path(`M${n(cx + s * nw * 0.35)} ${n(tipY - 10)}Q${n(cx + s * nw * 1.2)} ${n(tipY - 4)} ${n(cx + s * nw * 0.55)} ${n(tipY + 4)}`, { fill: 'none', stroke: dark, 'stroke-width': '1.8', opacity: '0.55', 'stroke-linecap': 'round' }));
    parts.push(ellipse(cx + s * nw * 0.42, tipY + 2, 3.6, 2.1, { fill: shade(skin, -0.6), opacity: '0.55' }));
  }
  parts.push(ellipse(cx - 2, tipY - 6, 5, 3.5, { fill: '#ffffff', opacity: '0.22' }));

  // Mouth.
  const lipK = look.stage === 'old' ? 0.7 : 1;
  const upper = 5.5 * lipK * (look.mouth === 1 ? 1.25 : 1);
  const lower = (look.sex === 'female' ? 7 : 5.5) * lipK * (look.mouth === 1 ? 1.25 : 1);
  const corner = look.smile * 2.2 + (look.stage === 'old' ? 2 : 0);
  const lip = mix(skin, '#a04a3c', look.sex === 'female' ? 0.38 : 0.24);
  parts.push(
    path(
      `M${n(cx - mw)} ${n(mouthY + corner)}Q${n(cx - mw * 0.45)} ${n(mouthY - upper)} ${n(cx - mw * 0.12)} ${n(mouthY - upper * 0.8)}Q${n(cx)} ${n(mouthY - upper * 0.5)} ${n(cx + mw * 0.12)} ${n(mouthY - upper * 0.8)}Q${n(cx + mw * 0.45)} ${n(mouthY - upper)} ${n(cx + mw)} ${n(mouthY + corner)}Q${n(cx)} ${n(mouthY + 1.5)} ${n(cx - mw)} ${n(mouthY + corner)}Z`,
      { fill: shade(lip, -0.08) },
    ),
  );
  parts.push(path(`M${n(cx - mw * 0.9)} ${n(mouthY + corner * 0.8 + 0.5)}Q${n(cx)} ${n(mouthY + lower * 2)} ${n(cx + mw * 0.9)} ${n(mouthY + corner * 0.8 + 0.5)}Q${n(cx)} ${n(mouthY + 2)} ${n(cx - mw * 0.9)} ${n(mouthY + corner * 0.8 + 0.5)}Z`, { fill: shade(lip, 0.06) }));
  parts.push(path(`M${n(cx - mw)} ${n(mouthY + corner)}Q${n(cx)} ${n(mouthY + 1.8)} ${n(cx + mw)} ${n(mouthY + corner)}`, { fill: 'none', stroke: '#4a2a22', 'stroke-width': '1.7', 'stroke-linecap': 'round' }));
  parts.push(ellipse(cx, mouthY + lower * 2 + 6, mw * 0.5, 3.2, { fill: dark, opacity: '0.16' }));
  parts.push(ellipse(cx - 3, mouthY + lower * 1.1, mw * 0.3, 1.6, { fill: '#ffffff', opacity: '0.18' }));
  // Chin.
  parts.push(ellipse(cx, chinY - 14 + sag * 0.3, h.chw * 0.6, 7, { fill: '#ffffff', opacity: '0.08' }));

  if (look.freckles) {
    const r = c.rng.fork('freckleDots');
    const dots: string[] = [];
    for (let i = 0; i < 26; i++) {
      const s = r.chance(0.5) ? -1 : 1;
      dots.push(circle(cx + s * r.range(8, cw * 0.62), noseY - r.range(-6, 26), r.range(0.8, 1.7), { fill: '#8a5a3a', opacity: n2(r.range(0.2, 0.45)) }));
    }
    parts.push(g({ 'clip-path': 'url(#p-facec)' }, dots));
  }
  return g({}, parts);
}

function drawScar(c: Ctx, style: string): string {
  const { h, look } = c;
  const { cx, eyeY, noseY, mouthY, chinY, eyeDx, eyeW, eyeH } = h;
  const scarCol = mix(look.skin, '#e8b0a0', 0.5);
  const edge = shade(look.skin, -0.3);
  const scarLine = (d: string, stitches = true): string => {
    const out = [path(d, { fill: 'none', stroke: edge, 'stroke-width': '4.5', 'stroke-linecap': 'round', opacity: '0.45' }), path(d, { fill: 'none', stroke: scarCol, 'stroke-width': '2.4', 'stroke-linecap': 'round' })];
    if (stitches) out.push(path(d, { fill: 'none', stroke: edge, 'stroke-width': '7', 'stroke-dasharray': '1 7', opacity: '0.35' }));
    return out.join('');
  };
  switch (style) {
    case 'cheekLeft':
      return scarLine(`M${n(cx - eyeDx - 16)} ${n(eyeY + 16)}Q${n(cx - eyeDx + 4)} ${n(noseY + 4)} ${n(cx - eyeDx + 14)} ${n(mouthY - 8)}`);
    case 'cheekRight':
      return scarLine(`M${n(cx + eyeDx + 18)} ${n(eyeY + 20)}Q${n(cx + eyeDx)} ${n(noseY + 10)} ${n(cx + eyeDx - 12)} ${n(mouthY + 4)}`);
    case 'brow':
      return scarLine(`M${n(cx - eyeDx + 4)} ${n(eyeY - eyeH - 32)}L${n(cx - eyeDx - 6)} ${n(eyeY - eyeH + 2)}`, false) + scarLine(`M${n(cx - eyeDx - 7)} ${n(eyeY + eyeH + 2)}L${n(cx - eyeDx - 10)} ${n(eyeY + eyeH + 14)}`, false);
    case 'lip':
      return scarLine(`M${n(cx + 8)} ${n(noseY + 10)}L${n(cx + 3)} ${n(mouthY + 12)}`, false);
    case 'nose':
      return scarLine(`M${n(cx - 22)} ${n(eyeY + 22)}L${n(cx + 20)} ${n(eyeY + 34)}`);
    case 'chin':
      return scarLine(`M${n(cx - 26)} ${n(chinY - 22)}Q${n(cx)} ${n(chinY - 12)} ${n(cx + 18)} ${n(chinY - 30)}`);
    case 'eyePatch': {
      const ex = cx + eyeDx;
      return g({}, [
        path(`M${n(cx - h.cw - 4)} ${n(eyeY - 52)}L${n(cx + h.cw + 4)} ${n(eyeY + 26)}`, { stroke: '#2a1a12', 'stroke-width': '4' }),
        ellipse(ex, eyeY + 2, eyeW * 0.72, eyeH * 1.5, { fill: '#2e2018', stroke: '#140c08', 'stroke-width': '2' }),
        ellipse(ex - 5, eyeY - 4, eyeW * 0.3, eyeH * 0.5, { fill: '#5a4030', opacity: '0.5' }),
      ]);
    }
    case 'blindEye':
      return scarLine(`M${n(cx + eyeDx + 4)} ${n(eyeY - eyeH - 26)}L${n(cx + eyeDx - 4)} ${n(eyeY + eyeH + 18)}`, false);
    default:
      return '';
  }
}

function drawAge(c: Ctx, stage: string): string {
  const { h, look } = c;
  const { cx, top, L, eyeY, noseY, mouthY, chinY, eyeDx, eyeW, mw, hairlineY } = h;
  const line = shade(look.skin, -0.4);
  const parts: string[] = [];
  if (stage === 'child' || stage === 'youth') {
    c.defs.push(radialGradient('p-rosy', [[0, '#e0705a', stage === 'child' ? 0.22 : 0.12], [1, '#e0705a', 0]]));
    for (const s of [-1, 1]) parts.push(ellipse(cx + s * h.cw * 0.5, noseY, 26, 18, { fill: 'url(#p-rosy)' }));
    return g({}, parts);
  }
  const k = stage === 'old' ? 1 : stage === 'middle' ? 0.5 : 0;
  if (k === 0) return '';
  const op = (v: number): string => n2(v * k);
  const fy = Math.max(top + L * 0.12, hairlineY + 14);
  for (let i = 0; i < (stage === 'old' ? 3 : 2); i++) {
    const y = fy + i * 10;
    parts.push(path(`M${n(cx - h.tw * 0.55)} ${n(y + 3)}Q${n(cx)} ${n(y - 4)} ${n(cx + h.tw * 0.55)} ${n(y + 3)}`, { fill: 'none', stroke: line, 'stroke-width': '1.6', opacity: op(0.45) }));
  }
  for (const s of [-1, 1]) {
    const xo = cx + s * (eyeDx + eyeW * 0.55);
    for (let i = -1; i <= 1; i++) parts.push(path(`M${n(xo)} ${n(eyeY + i * 4)}l${n(s * 10)} ${n(i * 4 - 1)}`, { stroke: line, 'stroke-width': '1.3', opacity: op(0.5), 'stroke-linecap': 'round' }));
    parts.push(path(`M${n(cx + s * (eyeDx - eyeW * 0.4))} ${n(eyeY + 11)}Q${n(cx + s * eyeDx)} ${n(eyeY + 19)} ${n(cx + s * (eyeDx + eyeW * 0.45))} ${n(eyeY + 10)}`, { fill: 'none', stroke: line, 'stroke-width': '1.4', opacity: op(0.45) }));
    parts.push(path(`M${n(cx + s * 20)} ${n(noseY - 4)}Q${n(cx + s * (mw + 14))} ${n(noseY + 18)} ${n(cx + s * (mw + 8))} ${n(mouthY + 12)}`, { fill: 'none', stroke: line, 'stroke-width': '2', opacity: op(0.5) }));
    if (stage === 'old') parts.push(path(`M${n(cx + s * (mw + 6))} ${n(mouthY + 14)}Q${n(cx + s * (mw + 10))} ${n(chinY - 20)} ${n(cx + s * (h.chw + 10))} ${n(chinY - 6)}`, { fill: 'none', stroke: line, 'stroke-width': '1.6', opacity: op(0.4) }));
  }
  if (stage === 'old') {
    const r = c.rng.fork('ageSpots');
    for (let i = 0; i < 6; i++) parts.push(circle(cx + r.jitter(h.tw * 0.8), fy + r.range(-10, 30), r.range(2, 4), { fill: shade(look.skin, -0.25), opacity: '0.25' }));
  }
  return g({ 'clip-path': 'url(#p-facec)' }, parts);
}

const BEARD_LEN: Readonly<Record<string, number>> = { stubble: 2, short: 12, full: 36, long: 96, braided: 96, forked: 86, goatee: 0, moustache: 0 };

/**
 * The beard as a U-shaped region: down the jaw from the sideburns, round the chin (with the style's
 * length), and back up under the lower lip and round the mouth corners, so the lips stay visible.
 */
function beardRegion(h: Head, style: string): string {
  const { cx, eyeY, noseY, mouthY, chinY, cw, jw, chw, mw, L } = h;
  const len = BEARD_LEN[style] ?? 12;
  const sideTop = eyeY + L * 0.07;
  const outerR = [cx + cw * 0.95, sideTop, cx + cw * 0.97 + 1, noseY, cx + jw + 3 + len * 0.04, mouthY + 4, cx + chw + 8 + len * 0.18, chinY - 8 + len * 0.45];
  const bottom =
    style === 'forked'
      ? [cx + 15, chinY + len, cx, chinY + len * 0.72, cx - 15, chinY + len]
      : style === 'long' || style === 'braided'
        ? [cx + 13, chinY + len, cx - 13, chinY + len]
        : [cx, chinY + len + 2];
  const innerR = [cx + mw * 0.6, mouthY + 11, cx + mw + 4, mouthY + 1, cx + cw * 0.58, noseY + 4, cx + cw * 0.95 - 13, sideTop + 3];
  return smoothClosed([...outerR, ...bottom, ...mirrorPts(outerR, cx), ...mirrorPts(innerR, cx), cx, mouthY + 13, ...innerR], 0.75);
}

/** A vertical fade mask so the beard grows in softly from the cheek line. */
function beardFade(c: Ctx, id: string): void {
  const { h } = c;
  const gid = `${id}-g`;
  c.defs.push(
    el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: 0, y1: n(h.eyeY + h.L * 0.06), x2: 0, y2: n(h.noseY + 14) }, [
      el('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '0.15' }),
      el('stop', { offset: '1', 'stop-color': '#ffffff', 'stop-opacity': '1' }),
    ]),
  );
  c.defs.push(el('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${gid})` })));
}

function drawBeard(c: Ctx, style: string): string {
  const { h, look } = c;
  const { cx, noseY, mouthY, chinY, mw } = h;
  const col = look.beardColour;
  const parts: string[] = [];
  beardFade(c, 'p-beardm');
  if (style === 'stubble') {
    const region = beardRegion(h, 'short');
    return g({ mask: 'url(#p-beardm)' }, [path(region, { fill: col, opacity: '0.2' }), path(beardRegion(h, 'stubble'), { fill: shade(col, -0.2), opacity: '0.12' })]);
  }
  const droop = style === 'moustache' || style === 'goatee' ? 9 : 4;
  const moustache = `M${n(cx)} ${n(noseY + 10)}Q${n(cx - mw * 0.75)} ${n(noseY + 6)} ${n(cx - mw - 6)} ${n(mouthY + droop)}Q${n(cx - mw * 0.6)} ${n(mouthY - 2)} ${n(cx)} ${n(mouthY - 4)}Q${n(cx + mw * 0.6)} ${n(mouthY - 2)} ${n(cx + mw + 6)} ${n(mouthY + droop)}Q${n(cx + mw * 0.75)} ${n(noseY + 6)} ${n(cx)} ${n(noseY + 10)}Z`;
  const fill = hairFill(c, 'p-beardg', col);
  if (style !== 'moustache' && style !== 'goatee') {
    const region = beardRegion(h, style);
    c.defs.push(el('clipPath', { id: 'p-beardc' }, path(region)));
    parts.push(g({ mask: 'url(#p-beardm)' }, [
      path(region, { fill }),
      strands(c, 'p-beardc', col, style === 'short' ? 60 : 110, { x: cx - h.cw, y: noseY - 6, w: h.cw * 2, h: chinY + 120 - noseY }, { rngKey: 'beardStrands', width: 1.3 }),
    ]));
    parts.push(path(`M${n(cx - mw * 0.6)} ${n(mouthY + 11)}Q${n(cx)} ${n(mouthY + 15)} ${n(cx + mw * 0.6)} ${n(mouthY + 11)}`, { fill: 'none', stroke: shade(col, -0.45), 'stroke-width': '1.6', opacity: '0.5' }));
    if (style === 'braided') parts.push(braid(c, cx, chinY + 26, cx, chinY + 110, col, 15, 'beardBraid'));
  }
  if (style === 'goatee') {
    const d = `M${n(cx - mw * 0.55)} ${n(mouthY + 12)}Q${n(cx - h.chw * 0.85)} ${n(chinY - 4)} ${n(cx)} ${n(chinY + 20)}Q${n(cx + h.chw * 0.85)} ${n(chinY - 4)} ${n(cx + mw * 0.55)} ${n(mouthY + 12)}Q${n(cx)} ${n(mouthY + 16)} ${n(cx - mw * 0.55)} ${n(mouthY + 12)}Z`;
    parts.push(path(d, { fill }));
  }
  parts.push(path(moustache, { fill: shade(col, -0.05) }));
  parts.push(path(`M${n(cx - mw * 0.85)} ${n(mouthY + 1)}Q${n(cx)} ${n(mouthY - 5)} ${n(cx + mw * 0.85)} ${n(mouthY + 1)}`, { fill: 'none', stroke: shade(col, -0.45), 'stroke-width': '1.4', opacity: '0.55' }));
  return g({}, parts);
}

function capPath(h: Head, vTop: number, vSide: number, sideBottom: number, hairline: 'straight' | 'center' | 'side' | 'fringe' | 'receded'): string {
  const { cx, top, eyeY, cw, tw, hairlineY } = h;
  const R = cw + vSide;
  const outer = [cx - R + 4, sideBottom, cx - R, eyeY - (eyeY - top) * 0.45, cx - R * 0.78, top - vTop * 0.55 + 12, cx, top - vTop, cx + R * 0.78, top - vTop * 0.55 + 12, cx + R, eyeY - (eyeY - top) * 0.45, cx + R - 4, sideBottom];
  let mid: number[];
  switch (hairline) {
    case 'center':
      mid = [cx + 16, hairlineY - 2, cx, hairlineY - 10, cx - 16, hairlineY - 2];
      break;
    case 'side':
      mid = [cx + 24, hairlineY - 6, cx - 8, hairlineY + 2, cx - 34, hairlineY + 8];
      break;
    case 'fringe':
      mid = [cx + 30, hairlineY + 24, cx + 8, hairlineY + 30, cx - 14, hairlineY + 26, cx - 36, hairlineY + 30];
      break;
    case 'receded':
      mid = [cx + tw * 0.4, hairlineY - 26, cx, hairlineY - 18, cx - tw * 0.4, hairlineY - 26];
      break;
    default:
      mid = [cx, hairlineY];
  }
  const inner = [cx + cw - 3, sideBottom, cx + cw * 0.93, eyeY - 22, cx + tw * 0.82, hairlineY + 8, ...mid, cx - tw * 0.82, hairlineY + 8, cx - cw * 0.93, eyeY - 22, cx - cw + 3, sideBottom];
  return `${smoothOpen(outer)}L${smoothOpen(inner).slice(1)}Z`;
}

function lock(h: Head, side: -1 | 1, bottom: number, spread: number, wave = 0): string {
  const { cx, eyeY, chinY, cw, jw } = h;
  const s = side;
  const pts = [
    cx + s * (cw * 0.86), eyeY - 30,
    cx + s * (cw + 14), eyeY,
    cx + s * (cw + 20 + wave), chinY - 20,
    cx + s * (cw + 26 + spread * 0.5 - wave), (chinY + bottom) / 2,
    cx + s * (cw + 18 + spread), bottom,
    cx + s * (cw - 26 + spread * 0.6), bottom - 6,
    cx + s * (cw - 14 + wave), (chinY + bottom) / 2,
    cx + s * (jw + 2), chinY - 24,
    cx + s * (cw * 0.9), eyeY + 6,
  ];
  return smoothClosed(pts);
}

function drawHair(c: Ctx, style: string): string {
  const { h, look } = c;
  const { cx, top, eyeY, chinY, cw, hairlineY } = h;
  const col = look.hair;
  const fill = hairFill(c, 'p-hair', col);
  const parts: string[] = [];
  const shapes: string[] = [];
  const add = (d: string): void => {
    shapes.push(d);
  };
  switch (style) {
    case 'cropped':
      add(capPath(h, 9, 5, eyeY - 6, 'straight'));
      break;
    case 'childShort':
      add(capPath(h, 14, 8, eyeY - 2, 'fringe'));
      break;
    case 'swept':
      add(capPath(h, 26, 8, eyeY - 4, 'receded'));
      break;
    case 'shoulder':
      add(capPath(h, 15, 10, eyeY + 10, 'center'));
      add(lock(h, -1, chinY + 40, 6));
      add(lock(h, 1, chinY + 40, 6));
      break;
    case 'longLoose':
    case 'loose':
      add(capPath(h, 15, 10, eyeY + 10, style === 'loose' ? 'center' : 'side'));
      add(lock(h, -1, chinY + 150, 18));
      add(lock(h, 1, chinY + 150, 18));
      break;
    case 'longWavy':
      add(capPath(h, 20, 14, eyeY + 10, 'side'));
      add(lock(h, -1, chinY + 160, 26, 8));
      add(lock(h, 1, chinY + 160, 26, 8));
      break;
    case 'warriorTail':
      add(capPath(h, 10, 6, eyeY - 4, 'straight'));
      break;
    case 'braidedBack':
      add(capPath(h, 5, 4, eyeY - 8, 'receded'));
      break;
    case 'balding':
    case 'tonsure': {
      const R = cw + 6;
      const side = (s: -1 | 1): string =>
        smoothClosed([cx + s * (R - 2), eyeY - 2, cx + s * R, eyeY - (eyeY - top) * 0.5, cx + s * (R * 0.82), top + (eyeY - top) * 0.28, cx + s * (cw * 0.7), top + (eyeY - top) * 0.45, cx + s * (cw * 0.9), eyeY - 18]);
      add(side(-1));
      add(side(1));
      if (style === 'tonsure') add(`M${n(cx - h.tw * 0.75)} ${n(hairlineY + 8)}Q${n(cx)} ${n(hairlineY - 6)} ${n(cx + h.tw * 0.75)} ${n(hairlineY + 8)}Q${n(cx)} ${n(hairlineY + 18)} ${n(cx - h.tw * 0.75)} ${n(hairlineY + 8)}Z`);
      break;
    }
    case 'braidsTwo':
    case 'childBraids':
      add(capPath(h, 12, 8, eyeY + 4, 'center'));
      break;
    case 'plaitSingle':
      add(capPath(h, 12, 8, eyeY + 4, 'side'));
      break;
    case 'crownBraid':
      add(capPath(h, 10, 7, eyeY, 'center'));
      break;
    case 'bun':
      add(capPath(h, 8, 6, eyeY - 2, 'center'));
      break;
    default:
      add(capPath(h, 10, 6, eyeY - 4, 'straight'));
  }
  const all = shapes.join('');
  c.defs.push(el('clipPath', { id: 'p-hairc' }, shapes.map((d) => path(d))));
  if (style === 'bun') parts.push(ellipse(cx + cw * 0.15, top - 14, 34, 24, { fill, stroke: shade(col, -0.4), 'stroke-width': '1.5' }));
  for (const d of shapes) parts.push(path(d, { fill }));
  parts.push(strands(c, 'p-hairc', col, style === 'balding' || style === 'tonsure' ? 30 : 110, { x: cx - cw - 40, y: top - 30, w: cw * 2 + 80, h: chinY + 180 - top }, { rngKey: 'hairStrands', flow: style === 'swept' ? -0.6 : 0.1, width: 1.7 }));
  // Parting shadow and sheen.
  parts.push(path(`M${n(cx - cw * 0.5)} ${n(top + 12)}Q${n(cx)} ${n(top - 8)} ${n(cx + cw * 0.4)} ${n(top + 14)}`, { fill: 'none', stroke: shade(col, 0.5), 'stroke-width': '7', opacity: style === 'balding' || style === 'tonsure' ? '0' : '0.25', 'stroke-linecap': 'round' }));
  void all;
  if (style === 'braidsTwo' || style === 'childBraids') {
    const end = style === 'childBraids' ? chinY + 70 : chinY + 190;
    parts.push(braid(c, cx - cw * 0.98, eyeY + 6, cx - cw * 1.12, end, col, style === 'childBraids' ? 12 : 15, 'bL'));
    parts.push(braid(c, cx + cw * 0.98, eyeY + 6, cx + cw * 1.12, end, col, style === 'childBraids' ? 12 : 15, 'bR'));
  }
  if (style === 'plaitSingle') parts.push(braid(c, cx - cw * 0.95, eyeY + 10, cx - cw * 0.55, chinY + 200, col, 17, 'pS'));
  if (style === 'crownBraid') {
    const R = cw + 4;
    const pts: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      pts.push(cx + Math.cos(a) * R * 0.98, h.hairlineY + 6 + Math.sin(a) * (h.hairlineY - top + 6) * 0.9);
    }
    for (let i = 0; i + 3 < pts.length; i += 2) parts.push(braid(c, pts[i] as number, pts[i + 1] as number, pts[i + 2] as number, pts[i + 3] as number, col, 15, `cb${i}`));
  }
  return g({}, parts);
}

function drawHeadwear(c: Ctx, style: string): string {
  const { h, look } = c;
  const { cx, top, eyeY, noseY, chinY, cw, hairlineY, eyeDx, eyeW, eyeH, shoulderY } = h;
  const iron = '#6a7078';
  const ironDk = '#2f3337';
  const parts: string[] = [];
  c.defs.push(linearGradient('p-iron', [[0, '#b8bec4'], [0.4, iron], [1, ironDk]], { x1: 0.1, y1: 0, x2: 0.9, y2: 1 }));
  const mailDef = (): void => {
    c.defs.push(
      el('pattern', { id: 'p-mailh', width: '7', height: '5', patternUnits: 'userSpaceOnUse' }, [
        rect(0, 0, 7, 5, { fill: '#454a4f' }),
        path('M0 2.5a3.5 2.5 0 0 1 7 0', { fill: 'none', stroke: '#a8aeb4', 'stroke-width': '1.1' }),
      ]),
    );
  };
  const R = cw + 10;
  const dome = (lift: number, bottomY: number): string => `M${n(cx - R)} ${n(bottomY)}C${n(cx - R)} ${n(top - lift * 0.4)} ${n(cx - R * 0.45)} ${n(top - lift)} ${n(cx)} ${n(top - lift)}C${n(cx + R * 0.45)} ${n(top - lift)} ${n(cx + R)} ${n(top - lift * 0.4)} ${n(cx + R)} ${n(bottomY)}Z`;
  switch (style) {
    case 'helmetSpectacle': {
      mailDef();
      const band = hairlineY + 6;
      parts.push(path(`M${n(cx - R - 4)} ${n(band)}L${n(cx - R - 18)} ${n(shoulderY + 10)}L${n(cx - cw * 0.72)} ${n(shoulderY)}L${n(cx - cw * 0.9)} ${n(band)}Z`, { fill: 'url(#p-mailh)' }));
      parts.push(path(`M${n(cx + R + 4)} ${n(band)}L${n(cx + R + 18)} ${n(shoulderY + 10)}L${n(cx + cw * 0.72)} ${n(shoulderY)}L${n(cx + cw * 0.9)} ${n(band)}Z`, { fill: 'url(#p-mailh)' }));
      parts.push(path(dome(26, band + 8), { fill: 'url(#p-iron)', stroke: ironDk, 'stroke-width': '2' }));
      parts.push(path(`M${n(cx)} ${n(top - 26)}V${n(band + 6)}`, { stroke: shade(look.metal, -0.1), 'stroke-width': '10' }));
      parts.push(path(`M${n(cx - R)} ${n(band + 2)}Q${n(cx)} ${n(band - 10)} ${n(cx + R)} ${n(band + 2)}`, { fill: 'none', stroke: look.metal, 'stroke-width': '9' }));
      // The spectacle guard: one plate from the brow to the cheekbones with two eye openings.
      const gx = eyeDx + eyeW * 0.95;
      const gy0 = band + 2;
      const gy1 = eyeY + eyeH * 1.7;
      const hole = (sx: number): string => {
        const rx = eyeW * 0.66;
        const ry = eyeH * 1.25;
        return `M${n(cx + sx * eyeDx - rx)} ${n(eyeY - 1)}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-rx * 2)} 0Z`;
      };
      for (const sx of [-1, 1]) parts.push(ellipse(cx + sx * eyeDx, eyeY - 1, eyeW * 0.66, eyeH * 1.25, { fill: '#000000', opacity: '0.35' }));
      const plate = `M${n(cx - gx)} ${n(gy0)}H${n(cx + gx)}Q${n(cx + gx + 6)} ${n(gy1 - 6)} ${n(cx + gx - 10)} ${n(gy1)}Q${n(cx + eyeDx)} ${n(gy1 + 6)} ${n(cx + 12)} ${n(gy1 - 2)}L${n(cx + 6)} ${n(noseY - 2)}H${n(cx - 6)}L${n(cx - 12)} ${n(gy1 - 2)}Q${n(cx - eyeDx)} ${n(gy1 + 6)} ${n(cx - gx + 10)} ${n(gy1)}Q${n(cx - gx - 6)} ${n(gy1 - 6)} ${n(cx - gx)} ${n(gy0)}Z`;
      parts.push(path(`${plate}${hole(-1)}${hole(1)}`, { fill: 'url(#p-iron)', 'fill-rule': 'evenodd', stroke: ironDk, 'stroke-width': '2' }));
      parts.push(path(`M${n(cx - gx + 4)} ${n(gy0 + 4)}H${n(cx + gx - 4)}`, { stroke: look.metal, 'stroke-width': '4', opacity: '0.8' }));
      break;
    }
    case 'helmetConical': {
      mailDef();
      const band = hairlineY + 4;
      parts.push(path(`M${n(cx - R - 2)} ${n(band)}L${n(cx - R - 16)} ${n(shoulderY + 10)}L${n(cx - cw * 0.72)} ${n(shoulderY)}L${n(cx - cw * 0.9)} ${n(band)}Z`, { fill: 'url(#p-mailh)' }));
      parts.push(path(`M${n(cx + R + 2)} ${n(band)}L${n(cx + R + 16)} ${n(shoulderY + 10)}L${n(cx + cw * 0.72)} ${n(shoulderY)}L${n(cx + cw * 0.9)} ${n(band)}Z`, { fill: 'url(#p-mailh)' }));
      parts.push(path(`M${n(cx - R)} ${n(band + 8)}Q${n(cx - R * 0.7)} ${n(top - 10)} ${n(cx)} ${n(top - 70)}Q${n(cx + R * 0.7)} ${n(top - 10)} ${n(cx + R)} ${n(band + 8)}Z`, { fill: 'url(#p-iron)', stroke: ironDk, 'stroke-width': '2' }));
      for (const s of [-0.5, 0, 0.5]) parts.push(path(`M${n(cx + s * R * 1.4)} ${n(band + 4)}Q${n(cx + s * R * 0.6)} ${n(top)} ${n(cx)} ${n(top - 66)}`, { fill: 'none', stroke: look.metal, 'stroke-width': '5' }));
      parts.push(path(`M${n(cx - R)} ${n(band + 4)}Q${n(cx)} ${n(band - 6)} ${n(cx + R)} ${n(band + 4)}`, { fill: 'none', stroke: look.metal, 'stroke-width': '9' }));
      parts.push(path(`M${n(cx)} ${n(band)}V${n(noseY - 2)}`, { stroke: 'url(#p-iron)', 'stroke-width': '9', 'stroke-linecap': 'round' }));
      break;
    }
    case 'helmetRidge': {
      const band = hairlineY + 6;
      parts.push(path(dome(20, band + 8), { fill: 'url(#p-iron)', stroke: ironDk, 'stroke-width': '2' }));
      parts.push(path(`M${n(cx)} ${n(top - 22)}V${n(band + 6)}`, { stroke: shade(look.metal, -0.05), 'stroke-width': '8' }));
      parts.push(path(`M${n(cx - R)} ${n(band + 4)}Q${n(cx)} ${n(band - 8)} ${n(cx + R)} ${n(band + 4)}`, { fill: 'none', stroke: look.metal, 'stroke-width': '8' }));
      for (const s of [-1, 1]) {
        parts.push(path(`M${n(cx + s * (R - 2))} ${n(band + 6)}L${n(cx + s * (cw * 0.62))} ${n(band + 14)}Q${n(cx + s * cw * 0.5)} ${n(noseY + 20)} ${n(cx + s * cw * 0.66)} ${n(chinY - 30)}L${n(cx + s * (R + 2))} ${n(chinY - 50)}Z`, { fill: 'url(#p-iron)', stroke: ironDk, 'stroke-width': '2' }));
        parts.push(circle(cx + s * cw * 0.78, noseY + 6, 3, { fill: look.metal }));
      }
      break;
    }
    case 'hood':
    case 'furHood': {
      const colr = style === 'furHood' ? '#7a6248' : look.bodyRank === 'seer' ? mix('#24283a', look.cloth, 0.2) : mix(look.cloth2, '#3a3a3a', 0.3);
      const outer = `M${n(cx - cw - 64)} ${n(shoulderY + 40)}C${n(cx - cw - 70)} ${n(top - 10)} ${n(cx - cw * 0.5)} ${n(top - 58)} ${n(cx)} ${n(top - 58)}C${n(cx + cw * 0.5)} ${n(top - 58)} ${n(cx + cw + 70)} ${n(top - 10)} ${n(cx + cw + 64)} ${n(shoulderY + 40)}Z`;
      const opening = smoothClosed([cx, hairlineY - 12, cx + cw * 0.95, hairlineY + 14, cx + cw * 1.02, eyeY + 30, cx + h.jw + 4, chinY - 10, cx, chinY + 30, cx - h.jw - 4, chinY - 10, cx - cw * 1.02, eyeY + 30, cx - cw * 0.95, hairlineY + 14]);
      c.defs.push(linearGradient('p-hood', [[0, shade(colr, 0.12)], [1, shade(colr, -0.4)]], { x1: 0, y1: 0, x2: 1, y2: 0.5 }));
      parts.push(path(`${outer}${opening}`, { fill: 'url(#p-hood)', 'fill-rule': 'evenodd' }));
      parts.push(path(opening, { fill: 'none', stroke: shade(colr, -0.5), 'stroke-width': '5', opacity: '0.6' }));
      if (style === 'furHood') parts.push(furBand(c, opening, '#d8ccb4', 26, 'hoodFur'));
      break;
    }
    case 'headscarf':
    case 'veil': {
      const colr = style === 'veil' ? (look.group === 'south' ? mix('#e8e0d0', look.cloth2, 0.25) : mix('#d8d0bc', look.cloth2, 0.3)) : mix(look.cloth2, '#d8c8a8', 0.35);
      c.defs.push(linearGradient('p-veil', [[0, shade(colr, 0.15)], [1, shade(colr, -0.3)]], { x1: 0, y1: 0, x2: 1, y2: 0.6 }));
      const bottom = style === 'veil' ? shoulderY + 70 : eyeY + 40;
      const outer = `M${n(cx - cw - 34)} ${n(bottom)}C${n(cx - cw - 44)} ${n(top - 10)} ${n(cx - cw * 0.5)} ${n(top - 34)} ${n(cx)} ${n(top - 34)}C${n(cx + cw * 0.5)} ${n(top - 34)} ${n(cx + cw + 44)} ${n(top - 10)} ${n(cx + cw + 34)} ${n(bottom)}`;
      const edge = style === 'veil' ? `L${n(cx + cw * 0.98)} ${n(bottom - 20)}L${n(cx + cw * 0.96)} ${n(eyeY)}Q${n(cx + cw * 0.9)} ${n(hairlineY - 2)} ${n(cx)} ${n(hairlineY - 6)}Q${n(cx - cw * 0.9)} ${n(hairlineY - 2)} ${n(cx - cw * 0.96)} ${n(eyeY)}L${n(cx - cw * 0.98)} ${n(bottom - 20)}Z` : `Q${n(cx + cw * 0.95)} ${n(eyeY - 30)} ${n(cx + cw * 0.92)} ${n(hairlineY + 10)}Q${n(cx)} ${n(hairlineY - 14)} ${n(cx - cw * 0.92)} ${n(hairlineY + 10)}Q${n(cx - cw * 0.95)} ${n(eyeY - 30)} ${n(cx - cw - 34)} ${n(bottom)}Z`;
      parts.push(path(outer + edge, { fill: 'url(#p-veil)' }));
      parts.push(path(`M${n(cx - cw * 0.9)} ${n(hairlineY + 6)}Q${n(cx)} ${n(hairlineY - 16)} ${n(cx + cw * 0.9)} ${n(hairlineY + 6)}`, { fill: 'none', stroke: shade(colr, -0.35), 'stroke-width': '3', opacity: '0.5' }));
      if (style === 'headscarf') parts.push(trimStroke(`M${n(cx - cw * 0.92)} ${n(hairlineY + 12)}Q${n(cx)} ${n(hairlineY - 12)} ${n(cx + cw * 0.92)} ${n(hairlineY + 12)}`, look.trim, 6, look.cloth));
      break;
    }
    case 'furHat':
    case 'pointedCap': {
      const capC = style === 'pointedCap' ? look.cloth2 : look.cloth;
      if (style === 'pointedCap') parts.push(path(`M${n(cx - cw * 0.92)} ${n(hairlineY)}Q${n(cx - cw * 0.5)} ${n(top - 70)} ${n(cx + 10)} ${n(top - 96)}Q${n(cx + cw * 0.5)} ${n(top - 40)} ${n(cx + cw * 0.92)} ${n(hairlineY)}Z`, { fill: capC, stroke: shade(capC, -0.4), 'stroke-width': '2' }));
      else parts.push(path(dome(30, hairlineY + 4), { fill: capC, stroke: shade(capC, -0.4), 'stroke-width': '2' }));
      parts.push(furBand(c, `M${n(cx - cw - 12)} ${n(hairlineY + 4)}Q${n(cx)} ${n(hairlineY - 20)} ${n(cx + cw + 12)} ${n(hairlineY + 4)}`, look.group === 'steppe' ? '#5a4030' : '#6a5038', 30, 'hatFur'));
      if (look.rank === 'ruler') parts.push(circle(cx, top - 20, 8, { fill: '#d4af37', stroke: '#6a4a10', 'stroke-width': '2' }));
      break;
    }
    case 'circlet':
    case 'diadem': {
      const gold = '#d4af37';
      const y = hairlineY + 10;
      const band = `M${n(cx - cw * 0.98)} ${n(y + 8)}Q${n(cx)} ${n(y - 14)} ${n(cx + cw * 0.98)} ${n(y + 8)}`;
      parts.push(path(band, { fill: 'none', stroke: '#6a4a10', 'stroke-width': style === 'diadem' ? '15' : '10' }));
      parts.push(path(band, { fill: 'none', stroke: gold, 'stroke-width': style === 'diadem' ? '12' : '7' }));
      parts.push(path(band, { fill: 'none', stroke: '#f6e7a8', 'stroke-width': '2', opacity: '0.7' }));
      parts.push(circle(cx, y - 3, style === 'diadem' ? 8 : 5.5, { fill: style === 'diadem' ? '#8a1f3a' : '#2f5f8a', stroke: '#6a4a10', 'stroke-width': '2' }));
      if (style === 'diadem') {
        for (const s of [-1, 1]) {
          parts.push(circle(cx + s * cw * 0.5, y - 1, 5, { fill: '#2f6a5a', stroke: '#6a4a10', 'stroke-width': '1.5' }));
          for (let i = 0; i < 5; i++) parts.push(circle(cx + s * cw * 0.96, y + 14 + i * 9, 3.4, { fill: '#f3ecd8', stroke: '#8a7a5a', 'stroke-width': '0.8' }));
        }
      }
      break;
    }
    default:
      break;
  }
  return g({}, parts);
}

function drawAccessory(c: Ctx, style: string): string {
  const { h, look } = c;
  const { cx, shoulderY, neckW, cw, eyeY, noseY, hairlineY } = h;
  const y0 = shoulderY - 12;
  const cord = (yEnd: number): string => path(`M${n(cx - neckW - 4)} ${n(y0 - 4)}Q${n(cx)} ${n(yEnd + 10)} ${n(cx + neckW + 4)} ${n(y0 - 4)}`, { fill: 'none', stroke: '#3a2a1a', 'stroke-width': '2' });
  const py = y0 + 46;
  switch (style) {
    case 'hammer':
      return g({}, [cord(py - 14), path(`M${n(cx - 12)} ${n(py - 10)}H${n(cx + 12)}L${n(cx + 8)} ${n(py - 2)}H${n(cx + 4)}V${n(py + 14)}L${n(cx + 9)} ${n(py + 20)}H${n(cx - 9)}L${n(cx - 4)} ${n(py + 14)}V${n(py - 2)}H${n(cx - 8)}Z`, { fill: '#b8bcc0', stroke: '#3a3d40', 'stroke-width': '1.5' })]);
    case 'flame':
      return g({}, [cord(py - 14), circle(cx, py, 12, { fill: 'none', stroke: '#c9a227', 'stroke-width': '3' }), path(`M${n(cx)} ${n(py - 9)}Q${n(cx + 7)} ${n(py + 1)} ${n(cx)} ${n(py + 8)}Q${n(cx - 7)} ${n(py + 1)} ${n(cx)} ${n(py - 9)}Z`, { fill: '#f0b040', stroke: '#8a5010', 'stroke-width': '1' })]);
    case 'riverFish':
      return g({}, [cord(py - 10), path(`M${n(cx - 14)} ${n(py)}Q${n(cx)} ${n(py - 10)} ${n(cx + 10)} ${n(py)}Q${n(cx)} ${n(py + 10)} ${n(cx - 14)} ${n(py)}ZM${n(cx + 10)} ${n(py)}L${n(cx + 18)} ${n(py - 7)}V${n(py + 7)}Z`, { fill: '#c0c4c8', stroke: '#3a3d40', 'stroke-width': '1.4' })]);
    case 'sunDisc': {
      const rays: string[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        rays.push(path(`M${n(cx + Math.cos(a) * 10)} ${n(py + Math.sin(a) * 10)}L${n(cx + Math.cos(a) * 16)} ${n(py + Math.sin(a) * 16)}`, { stroke: '#d4af37', 'stroke-width': '2.5', 'stroke-linecap': 'round' }));
      }
      return g({}, [cord(py - 14), ...rays, circle(cx, py, 8, { fill: '#d4af37', stroke: '#6a4a10', 'stroke-width': '1.5' })]);
    }
    case 'beads': {
      const beads: string[] = [];
      const r = c.rng.fork('neckBeads');
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        beads.push(circle(cx - neckW - 6 + (neckW * 2 + 12) * t, y0 - 2 + 26 * 4 * t * (1 - t), 4, { fill: r.pick(['#d88a2a', '#2f5f8a', '#e0d0a0', '#8a2a2a']), stroke: '#1a120c', 'stroke-width': '0.8' }));
      }
      return g({}, beads);
    }
    case 'torc': {
      const d = `M${n(cx - neckW - 8)} ${n(y0 - 16)}Q${n(cx)} ${n(y0 + 34)} ${n(cx + neckW + 8)} ${n(y0 - 16)}`;
      return g({}, [
        path(d, { fill: 'none', stroke: '#6a4a10', 'stroke-width': '12', 'stroke-linecap': 'round' }),
        path(d, { fill: 'none', stroke: '#d4af37', 'stroke-width': '9', 'stroke-linecap': 'round' }),
        path(d, { fill: 'none', stroke: '#8a6a20', 'stroke-width': '9', 'stroke-dasharray': '2 4', opacity: '0.6' }),
        circle(cx - 14, y0 + 8, 6, { fill: '#d4af37', stroke: '#6a4a10', 'stroke-width': '1.5' }),
        circle(cx + 14, y0 + 8, 6, { fill: '#d4af37', stroke: '#6a4a10', 'stroke-width': '1.5' }),
      ]);
    }
    case 'earrings': {
      if (look.headwear === 'hood' || look.headwear === 'furHood' || look.headwear === 'veil') return '';
      const out: string[] = [];
      for (const s of [-1, 1]) {
        const ex = cx + s * (cw * 0.96 + 6);
        out.push(circle(ex, noseY + 22, 6, { fill: 'none', stroke: '#d4af37', 'stroke-width': '2.5' }));
        out.push(circle(ex, noseY + 30, 3, { fill: '#8a1f3a' }));
      }
      return g({}, out);
    }
    case 'bandage': {
      const y = hairlineY + 18;
      return g({}, [
        path(`M${n(cx - cw - 6)} ${n(y + 16)}Q${n(cx)} ${n(y - 14)} ${n(cx + cw + 6)} ${n(y + 4)}`, { fill: 'none', stroke: '#8a8070', 'stroke-width': '24', opacity: '0.5' }),
        path(`M${n(cx - cw - 6)} ${n(y + 14)}Q${n(cx)} ${n(y - 16)} ${n(cx + cw + 6)} ${n(y + 2)}`, { fill: 'none', stroke: '#e6dcc6', 'stroke-width': '20' }),
        ellipse(cx + cw * 0.4, y - 2, 12, 7, { fill: '#8e2a23', opacity: '0.7' }),
        path(`M${n(cx - cw * 0.6)} ${n(y + 4)}l40 -8M${n(cx)} ${n(y - 4)}l30 -2`, { stroke: '#b8ae98', 'stroke-width': '1.5', opacity: '0.7' }),
      ]);
    }
    default:
      void eyeY;
      return '';
  }
}

function drawSlot(c: Ctx, layer: PortraitLayer): string {
  switch (layer.slot) {
    case 'background':
      return drawBackground(c, layer.variant);
    case 'hairBack':
      return drawHairBack(c, layer.variant);
    case 'body':
      return drawBody(c, layer.variant);
    case 'face':
      return drawFace(c, layer.variant);
    case 'scar':
      return drawScar(c, layer.variant);
    case 'age':
      return drawAge(c, layer.variant);
    case 'beard':
      return drawBeard(c, layer.variant);
    case 'hair':
      return drawHair(c, layer.variant);
    case 'headwear':
      return drawHeadwear(c, layer.variant);
    case 'accessory':
      return drawAccessory(c, layer.variant);
    default:
      return '';
  }
}

function tintColour(look: PortraitLook, tint: LayerTint): string | undefined {
  switch (tint) {
    case 'hair':
      return look.hair;
    case 'skin':
      return look.skin;
    case 'cloth':
      return look.cloth;
    default:
      return undefined;
  }
}

/** Render options for `portraitSvg`. */
export interface PortraitRenderOptions {
  width?: number;
  height?: number;
  watermark?: WatermarkMode;
  label?: string;
  /** Final layer pieces: manifest id → URL (data URLs, so the SVG stays self-contained). */
  finalLayers?: Readonly<Record<string, string>>;
  /** Draw only these slots (used to preview a single layer piece). */
  onlySlots?: readonly PortraitSlot[];
}

/** Renders a portrait to SVG markup. */
export function portraitSvg(params: PortraitParams, opts: PortraitRenderOptions = {}): string {
  const look = decidePortraitLook(params);
  return portraitSvgFromLook(look, opts);
}

/** Renders an already-decided look (lets callers inspect or tweak the look first). */
export function portraitSvgFromLook(look: PortraitLook, opts: PortraitRenderOptions = {}): string {
  const h = headOf(look);
  const c: Ctx = { look, h, defs: [], rng: new ArtRng(look.seed).fork('draw') };
  const plan = portraitLayerPlan(look).filter((l) => !opts.onlySlots || opts.onlySlots.includes(l.slot));
  const body: string[] = [];
  for (const layer of plan) {
    const finalUrl = opts.finalLayers?.[layer.assetId];
    if (finalUrl) {
      const tint = tintColour(look, layer.tint);
      let filter: string | undefined;
      if (tint) {
        const fid = `p-tint-${layer.slot}`;
        if (!c.defs.some((d) => d.includes(`id="${fid}"`))) {
          c.defs.push(
            el('filter', { id: fid, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' }, [
              el('feFlood', { 'flood-color': tint, result: 'f' }),
              el('feComposite', { in: 'f', in2: 'SourceGraphic', operator: 'in', result: 'fc' }),
              el('feBlend', { in: 'SourceGraphic', in2: 'fc', mode: 'multiply' }),
            ]),
          );
        }
        filter = `url(#${fid})`;
      }
      body.push(el('image', { href: finalUrl, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', filter }));
    } else {
      body.push(drawSlot(c, layer));
    }
  }
  // Lighting, paint texture and vignette (only on full portraits).
  const full = !opts.onlySlots;
  const overlay: string[] = [];
  if (full) {
    c.defs.push(linearGradient('p-light', [[0, '#fff2d8', 0.1], [0.45, '#000000', 0], [1, '#1a0e08', 0.32]], { x1: 0, y1: 0.2, x2: 1, y2: 0.8 }));
    c.defs.push(grainFilter('p-grain', look.seed, 0.85, 0.16));
    c.defs.push(vignetteGradient('p-vig', look.background ? 0.5 : 0));
    overlay.push(rect(0, 0, W, H, { fill: 'url(#p-light)', style: 'mix-blend-mode:multiply' }));
    overlay.push(rect(0, 0, W, H, { filter: 'url(#p-grain)', style: 'mix-blend-mode:multiply', opacity: look.background ? '0.9' : '0.4' }));
    if (look.background) overlay.push(rect(0, 0, W, H, { fill: 'url(#p-vig)' }));
  }
  let content = g({}, [...body, ...overlay]);
  if (look.dead) {
    c.defs.push(el('filter', { id: 'p-dead' }, el('feColorMatrix', { type: 'matrix', values: '0.28 0.5 0.12 0 0  0.26 0.48 0.11 0 0  0.24 0.44 0.1 0 0  0 0 0 1 0' })));
    content = g({ filter: 'url(#p-dead)' }, content);
  }
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  const wm = opts.watermark && opts.watermark !== 'off' ? g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark)) : '';
  return svgDoc({ width, height, viewBox: [0, 0, W, H], defs: c.defs, body: [content, wm], preserveAspectRatio: 'xMidYMid slice' });
}

/** A representative look that shows one layer piece (gallery and manifest previews). */
export function portraitLayerPreviewLook(slot: PortraitSlot, variant: string): PortraitLook {
  const base: PortraitParams = { seed: `layer|${slot}|${variant}`, sex: 'male', culture: 'skarn', age: 32, rank: 'common', background: false };
  const look = decidePortraitLook(base);
  const out: PortraitLook = { ...look, scars: [], accessories: [], headwear: 'none', background: slot === 'background' };
  switch (slot) {
    case 'background':
      return { ...out, group: variant as CultureGroup };
    case 'hairBack':
    case 'hair': {
      const fem = ['braidsTwo', 'plaitSingle', 'crownBraid', 'bun', 'longWavy', 'loose', 'childBraids'].includes(variant);
      const child = variant.startsWith('child');
      return { ...out, hairStyle: variant as HairStyle, sex: fem ? 'female' : 'male', stage: child ? 'child' : 'adult', age: child ? 9 : 30 };
    }
    case 'body': {
      const [grp, sex, rank] = variant.split('-') as [string, string, string];
      if (grp === 'robe') return { ...out, bodyRank: sex === 'seer' ? 'seer' : 'clergy' };
      const culture = (Object.entries(CULTURE_GROUP).find(([, v]) => v === grp)?.[0] ?? 'skarn') as CultureId;
      return { ...out, group: grp as CultureGroup, culture, sex: sex as PortraitSex, bodyRank: rank as BodyRank, metal: CULTURE_PALETTE[culture].metal, trim: CULTURE_PALETTE[culture].trim };
    }
    case 'face': {
      const [shape, sex] = variant.split('-') as [FaceShape, PortraitSex];
      return { ...out, face: shape, sex };
    }
    case 'scar':
      return { ...out, scars: [variant as ScarStyle] };
    case 'age': {
      const age = variant === 'child' ? 9 : variant === 'youth' ? 15 : variant === 'adult' ? 28 : variant === 'middle' ? 45 : 68;
      return { ...out, stage: variant as AgeStage, age };
    }
    case 'beard':
      return { ...out, beard: variant as BeardStyle };
    case 'headwear':
      return { ...out, headwear: variant as HeadwearStyle, rank: variant === 'circlet' || variant === 'diadem' ? 'ruler' : out.rank };
    case 'accessory':
      return { ...out, accessories: [variant as AccessoryStyle] };
    default:
      return out;
  }
}

/** SVG of a single layer piece on a transparent canvas (with a faint guide silhouette). */
export function portraitLayerSvg(slot: PortraitSlot, variant: string, opts: { width?: number; height?: number; watermark?: WatermarkMode; label?: string } = {}): string {
  const look = portraitLayerPreviewLook(slot, variant);
  const piece = portraitSvgFromLook(look, { onlySlots: [slot], width: opts.width, height: opts.height });
  if (slot === 'background' || slot === 'face' || slot === 'body') return wrapWatermark(piece, opts);
  // Guide: a faint head-and-shoulders under the piece so it reads in context.
  const guide = portraitSvgFromLook(look, { onlySlots: ['body', 'face'], width: opts.width, height: opts.height });
  const inner = (s: string): string => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  return svgDoc({
    width,
    height,
    viewBox: [0, 0, W, H],
    body: [g({ opacity: '0.28' }, el('svg', { x: 0, y: 0, width: W, height: H, viewBox: `0 0 ${W} ${H}` }, inner(guide).replace(/id="p-/g, 'id="gp-').replace(/url\(#p-/g, 'url(#gp-'))), el('svg', { x: 0, y: 0, width: W, height: H, viewBox: `0 0 ${W} ${H}` }, inner(piece)), opts.watermark && opts.watermark !== 'off' ? g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark)) : ''],
  });
}

function wrapWatermark(svg: string, opts: { width?: number; height?: number; watermark?: WatermarkMode; label?: string }): string {
  if (!opts.watermark || opts.watermark === 'off') return svg;
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  return svg.replace(/<\/svg>$/, `${g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark))}</svg>`);
}

/** A hooded unknown figure (unmet or hidden characters). */
export function silhouetteSvg(opts: { width?: number; height?: number; seed?: number; watermark?: WatermarkMode; label?: string } = {}): string {
  const defs = [
    radialGradient('s-bg', [[0, '#4a4f58'], [1, '#14171c']], { cx: 0.45, cy: 0.38, r: 0.75 }),
    linearGradient('s-fig', [[0, '#262a30'], [1, '#0e1013']], { x1: 0, y1: 0, x2: 1, y2: 1 }),
    grainFilter('s-grain', opts.seed ?? 7, 0.85, 0.16),
  ];
  const cx = W / 2;
  const fig = `M${n(cx - 230)} ${n(H + 10)}C${n(cx - 220)} 520 ${n(cx - 150)} 470 ${n(cx - 92)} 448C${n(cx - 150)} 380 ${n(cx - 140)} 150 ${n(cx)} 120C${n(cx + 140)} 150 ${n(cx + 150)} 380 ${n(cx + 92)} 448C${n(cx + 150)} 470 ${n(cx + 220)} 520 ${n(cx + 230)} ${n(H + 10)}Z`;
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  return svgDoc({
    width,
    height,
    viewBox: [0, 0, W, H],
    defs,
    body: [
      rect(0, 0, W, H, { fill: 'url(#s-bg)' }),
      path(fig, { fill: 'url(#s-fig)' }),
      ellipse(cx, 300, 70, 92, { fill: '#08090b', opacity: '0.85' }),
      el('text', { x: cx, y: 330, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 96, fill: '#6a6f78', opacity: '0.55' }, esc('?')),
      rect(0, 0, W, H, { filter: 'url(#s-grain)', style: 'mix-blend-mode:multiply' }),
      opts.watermark && opts.watermark !== 'off' ? g({ transform: `scale(${n2(W / width)} ${n2(H / height)})` }, watermark(width, height, opts.label, opts.watermark)) : '',
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// Generators

/** `portrait` generator: params as PortraitParams (seed, sex, culture, age, rank, faith, traits, …). */
export const portraitGenerator: ImageGenerator = {
  id: 'portrait',
  kind: 'image',
  defaultSize: PORTRAIT_SIZE,
  params: [
    { name: 'seed', type: 'number', note: 'character.portrait.seed (number or string)' },
    { name: 'sex', type: 'enum', values: PORTRAIT_SEXES, default: 'male' },
    { name: 'culture', type: 'enum', values: ALL_CULTURES, default: 'skarn' },
    { name: 'age', type: 'number', default: 30, note: 'years; stages child < 12 ≤ youth < 18 ≤ adult < 35 ≤ middle < 55 ≤ old' },
    { name: 'rank', type: 'enum', values: PORTRAIT_RANKS, default: 'common' },
    { name: 'faith', type: 'enum', values: ALL_FAITHS },
    { name: 'traits', type: 'list', note: 'comma-separated trait ids (scarred, oneEyed, towering, slight, sickly, strong)' },
    { name: 'wounded', type: 'boolean', default: false },
    { name: 'dead', type: 'boolean', default: false },
    { name: 'background', type: 'boolean', default: true },
    { name: 'layer.*', type: 'number', note: 'explicit picks (PortraitSpec.layers): layer.face, layer.hair, layer.beard, layer.headwear, layer.scar, layer.accessory, layer.skin, layer.nose, layer.mouth, layer.brows, layer.eyeShape' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return portraitSvg(portraitParamsFrom(params), { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label });
  },
  layers(params: GeneratorParams): string[] {
    return portraitLayerPlan(decidePortraitLook(portraitParamsFrom(params))).map((l) => l.assetId);
  },
  renderWithLayers(params: GeneratorParams, ctx: RenderContext, finals: Readonly<Record<string, string>>): string {
    return portraitSvg(portraitParamsFrom(params), { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label, finalLayers: finals });
  },
  variants(): GeneratorParams[] {
    const out: GeneratorParams[] = [];
    const cultures: CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'saraleonese', 'velkar', 'kurgai', 'rime', 'isafolder'];
    let i = 0;
    for (const culture of cultures) {
      for (const sex of PORTRAIT_SEXES) {
        out.push({ seed: 100 + i, culture, sex, age: [24, 38, 52, 70, 16, 30][i % 6] as number, rank: PORTRAIT_RANKS[i % PORTRAIT_RANKS.length] as PortraitRank });
        i++;
      }
    }
    return out;
  },
};

/** `portraitLayer` generator: one layer piece (params: slot, variant). */
export const portraitLayerGenerator: ImageGenerator = {
  id: 'portraitLayer',
  kind: 'image',
  defaultSize: PORTRAIT_SIZE,
  params: [
    { name: 'slot', type: 'enum', values: PORTRAIT_SLOTS, default: 'face' },
    { name: 'variant', type: 'string', note: 'variant id within the slot (see portraitLayerCatalog / ASSET_LIST.md)' },
  ],
  variants(): GeneratorParams[] {
    return portraitLayerCatalog().map((l) => ({ slot: l.slot, variant: l.variant }));
  },
  render(params: GeneratorParams, ctx: RenderContext): string {
    const slot = oneOf(params, 'slot', PORTRAIT_SLOTS, 'face');
    const variant = typeof params.variant === 'string' ? params.variant : 'oval-male';
    return portraitLayerSvg(slot, variant, { width: ctx.width, height: ctx.height, watermark: ctx.watermark, label: ctx.label });
  },
};

/** `silhouette` generator: the unknown figure. */
export const silhouetteGenerator: ImageGenerator = {
  id: 'silhouette',
  kind: 'image',
  defaultSize: PORTRAIT_SIZE,
  params: [{ name: 'seed', type: 'number', note: 'varies the paint grain only' }],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return silhouetteSvg({ width: ctx.width, height: ctx.height, seed: seedOf(params, 'silhouette'), watermark: ctx.watermark, label: ctx.label });
  },
};

/** Grey-out helper for callers drawing their own portrait frames (dead characters). */
export function deadTint(colour: string): string {
  return desaturate(shade(colour, -0.2), 0.8);
}
