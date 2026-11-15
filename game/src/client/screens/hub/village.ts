/**
 * The ONE layout table of the home village (SCR-05). Every building and its label/hotspot are placed here in
 * the panorama's own viewBox units (VIEW_W × VIEW_H). The SVG draws each building at (x, y) and the hotspot
 * button is positioned at (labelX, labelY) as a percentage of the same box, and that box always keeps the
 * viewBox aspect ratio (it is letterboxed inside the scene, never cropped), so a label cannot drift off its
 * building at any window size.
 */
import type { GameState, Ship } from '@sim/core/state';
import type { IconName } from '../../ui/index';

/** Panorama size in viewBox units (aspect 1.3, between the hub's centre column at 1280×720 and 1920×1080). */
export const VIEW_W = 1300;
export const VIEW_H = 1000;

/** Hotspot ids (test ids `hotspot-<id>`, routes `building.<id>`). */
export type HallBuildingId =
  'greatHall' | 'longhouse' | 'meadHall' | 'smithy' | 'shipyard' | 'market' | 'seer' | 'grove';

/** One building of the village. */
export interface HallSpot {
  id: HallBuildingId;
  /** Key in `settlement.buildings` that gives its tier (null: always standing, no tier, e.g. the family longhouse). */
  building: string | null;
  icon: IconName;
  /** Ground centre of the building (viewBox units). */
  x: number;
  y: number;
  /** Footprint width and height at tier 1 (viewBox units): the building's box, also its click area. */
  w: number;
  h: number;
  /** Centre of the label/hotspot (viewBox units). */
  labelX: number;
  labelY: number;
}

/** The village, in drawing order (back to front). */
export const VILLAGE: readonly HallSpot[] = [
  {
    id: 'seer',
    building: 'seersHut',
    icon: 'eye',
    x: 1170,
    y: 470,
    w: 120,
    h: 115,
    labelX: 1170,
    labelY: 340,
  },
  {
    id: 'grove',
    building: 'grove',
    icon: 'feather',
    x: 150,
    y: 600,
    w: 210,
    h: 150,
    labelX: 150,
    labelY: 438,
  },
  {
    id: 'greatHall',
    building: 'hall',
    icon: 'crown',
    x: 700,
    y: 650,
    w: 400,
    h: 215,
    labelX: 700,
    labelY: 412,
  },
  {
    id: 'longhouse',
    building: null,
    icon: 'family',
    x: 382,
    y: 712,
    w: 230,
    h: 120,
    labelX: 382,
    labelY: 562,
  },
  {
    id: 'meadHall',
    building: 'meadhall',
    icon: 'chronicle',
    x: 1012,
    y: 716,
    w: 230,
    h: 180,
    labelX: 1012,
    labelY: 512,
  },
  {
    id: 'shipyard',
    building: 'shipyard',
    icon: 'ship',
    x: 505,
    y: 900,
    w: 200,
    h: 125,
    labelX: 505,
    labelY: 758,
  },
  {
    id: 'market',
    building: 'market',
    icon: 'silver',
    x: 775,
    y: 928,
    w: 240,
    h: 92,
    labelX: 775,
    labelY: 800,
  },
  {
    id: 'smithy',
    building: 'smithy',
    icon: 'sword',
    x: 1150,
    y: 930,
    w: 190,
    h: 160,
    labelX: 1150,
    labelY: 750,
  },
];

/** Where ships lie drawn up on the strand below the shipyard (back to front). */
export const SHIP_SLOTS: readonly { x: number; y: number }[] = [
  { x: 215, y: 842 },
  { x: 95, y: 900 },
  { x: 255, y: 930 },
  { x: 120, y: 985 },
];

/** A building's tier at a settlement (the longhouse always stands: tier 1). */
export function spotTier(buildings: Readonly<Record<string, number>> | undefined, spot: HallSpot): number {
  if (spot.building === null) return 1;
  const v = buildings?.[spot.building];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** The player's ships lying at a settlement (drawn on the strand), in a stable order. */
export function shipsAtHome(state: GameState, settlementId: string): Ship[] {
  const out: Ship[] = [];
  for (const ship of Object.values(state.ships)) {
    if (
      ship &&
      ship.ownerId === state.player.factionId &&
      ship.dockedAt === settlementId &&
      ship.locationFleetId === undefined
    )
      out.push(ship);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
