/**
 * The painted home villages: one placement table per painting. A homeland's final painting
 * (`hub.panorama.home.<culture>`, 1300×1000, exactly the village viewBox, so a pixel of the file is a viewBox unit)
 * replaces the procedural village; every building's label and click area, the ships on the strand and the
 * water line are placed here on that painting.
 *
 * Seasons: a season's own painting (`…-winter.jpg`, see render/scenes/finalArt.tsx) is a new painting and its
 * buildings may sit a little apart, so the tables are keyed by the `variant` shown. A variant without its own
 * table uses its homeland's base table (the spring, autumn and winter paintings made by editing a base painting
 * line up with it). Adding a season's painting that moved things is one more table here.
 */
import type { SeasonId } from '@content/schemas/ids';
import type { PaintingVariant } from '../../render/scenes/finalArt';
import type { HallBuildingId } from './village';

/** A box in viewBox units: [left, top, right, bottom]. */
export type Box = readonly [number, number, number, number];

/** One building on a painting. */
export interface PaintedSpot {
  /** Its click area (the painted building). */
  box: Box;
  /** Centre of its label (on or just above the painted building). */
  label: readonly [number, number];
}

/** Everything placed over one painting. */
export interface PaintedLayout {
  buildings: Readonly<Record<HallBuildingId, PaintedSpot>>;
  /** The ships drawn up on the strand (the ships' click area). */
  ships: Box;
  /** Where open water begins (y): ice is laid from here down when the harbour is iced in. */
  water: number;
}

/** The homeland cultures that have a home painting slot (`hub.panorama.home.<culture>`). */
export const PAINTED_HOMES = ['skarn', 'hvarn', 'eyjar'] as const;
export type PaintedHome = (typeof PAINTED_HOMES)[number];

/** The asset id of a homeland's village painting. */
export function homePaintingId(culture: string): string {
  return `hub.panorama.home.${culture}`;
}

const SKARN: PaintedLayout = {
  buildings: {
    grove: { box: [20, 225, 300, 362], label: [160, 250] },
    longhouse: { box: [70, 370, 468, 472], label: [290, 400] },
    greatHall: { box: [470, 212, 846, 415], label: [690, 205] },
    meadHall: { box: [848, 342, 1216, 446], label: [1050, 375] },
    seer: { box: [1135, 283, 1262, 338], label: [1170, 262] },
    shipyard: { box: [58, 476, 430, 640], label: [255, 505] },
    market: { box: [432, 596, 852, 825], label: [630, 625] },
    smithy: { box: [995, 528, 1300, 705], label: [1150, 560] },
  },
  ships: [0, 645, 372, 790],
  water: 800,
};

/** #002, the winter skarn village: painted from its own prompt, its buildings a few per cent off. */
const SKARN_WINTER: PaintedLayout = {
  buildings: {
    grove: { box: [20, 225, 300, 362], label: [160, 250] },
    longhouse: { box: [68, 366, 468, 470], label: [290, 396] },
    greatHall: { box: [470, 210, 850, 415], label: [690, 203] },
    meadHall: { box: [852, 340, 1216, 446], label: [1050, 372] },
    seer: { box: [1135, 283, 1258, 336], label: [1170, 262] },
    shipyard: { box: [58, 474, 430, 655], label: [255, 503] },
    market: { box: [432, 600, 852, 835], label: [630, 628] },
    smithy: { box: [988, 525, 1300, 702], label: [1145, 557] },
  },
  ships: [0, 660, 385, 785],
  water: 805,
};

const HVARN: PaintedLayout = {
  buildings: {
    grove: { box: [20, 225, 300, 362], label: [160, 250] },
    longhouse: { box: [65, 368, 470, 476], label: [290, 398] },
    greatHall: { box: [472, 205, 848, 416], label: [690, 198] },
    meadHall: { box: [850, 345, 1220, 456], label: [1050, 378] },
    seer: { box: [1140, 285, 1255, 340], label: [1170, 264] },
    shipyard: { box: [55, 480, 402, 655], label: [235, 510] },
    market: { box: [405, 605, 812, 850], label: [610, 632] },
    smithy: { box: [900, 540, 1225, 695], label: [1040, 570] },
  },
  ships: [0, 660, 400, 830],
  water: 830,
};

const EYJAR: PaintedLayout = {
  buildings: {
    grove: { box: [20, 225, 300, 362], label: [160, 250] },
    longhouse: { box: [65, 370, 465, 472], label: [290, 400] },
    greatHall: { box: [467, 210, 853, 415], label: [680, 203] },
    meadHall: { box: [855, 345, 1216, 450], label: [1050, 378] },
    seer: { box: [1140, 288, 1258, 340], label: [1170, 266] },
    shipyard: { box: [58, 476, 383, 640], label: [235, 505] },
    market: { box: [385, 598, 890, 835], label: [640, 625] },
    smithy: { box: [1000, 525, 1300, 705], label: [1150, 557] },
  },
  ships: [0, 645, 380, 790],
  water: 810,
};

/** Every placement table: a homeland's base painting, and a season's painting that needs its own. */
export const PAINTED_VILLAGES: Readonly<Record<PaintedHome, { base: PaintedLayout } & Partial<Record<SeasonId, PaintedLayout>>>> = {
  skarn: { base: SKARN, winter: SKARN_WINTER },
  hvarn: { base: HVARN },
  eyjar: { base: EYJAR },
};

/** The table for the painting shown (the season's own table, else the homeland's base table); null: no table. */
export function paintedLayout(culture: string, variant: PaintingVariant): PaintedLayout | null {
  if (!Object.hasOwn(PAINTED_VILLAGES, culture)) return null;
  const home = PAINTED_VILLAGES[culture as PaintedHome];
  return (variant === 'base' ? undefined : home[variant]) ?? home.base;
}

/**
 * The light grade over a painting: only a base painting shown in a season that has no painting of its own is
 * graded (lightly), never a season's own painting. The hour of day is not graded: the hub's clock mostly stands
 * at midnight (waits are whole days), and the village is the player's home seen by day, as the procedural
 * village keeps its own fixed light.
 */
export function paintingGrade(variant: PaintingVariant, season: SeasonId | null): string | undefined {
  if (variant !== 'base' || season === null) return undefined;
  switch (season) {
    case 'spring':
      return 'saturate(0.9) brightness(1.03)';
    case 'autumn':
      return 'sepia(0.22) saturate(1.08) hue-rotate(-6deg)';
    case 'winter':
      return 'saturate(0.55) brightness(1.06) contrast(0.95)';
    case 'summer':
      return undefined;
  }
}

/** True when two boxes share any area. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

