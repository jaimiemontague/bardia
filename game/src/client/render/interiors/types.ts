/**
 * The shapes a room is made of: the painting's size, one person (or spot) the player can click, and the room
 * definition that ties a painting to its table of people. See index.ts for the worked example.
 */
import type { ComponentType } from 'react';
import type { Ambience } from '../scenes/pictures';
import type { IconName } from '../../ui/index';
import type { RoomLight } from './light';

/** Every room paints into the same 1600 × 900 viewBox (16:9). Keep people between x 200 and 1400. */
export const ROOM_W = 1600;
export const ROOM_H = 900;

/** Which side the person's panel opens on ('auto': the side away from the person). */
export type PanelSide = 'left' | 'right' | 'auto';

/** One person (or spot) in a room: a real button over the painting, placed in viewBox units. */
export interface InteriorPerson {
  /** Unique within the room; test id `interior-person-<id>`, route param `{ person: '<id>' }`. */
  id: string;
  /** Centre of the feet (bottom centre of the click box), viewBox units. */
  x: number;
  y: number;
  /** Click box: width, and height up from the feet (cover the whole figure and the prop they stand by). */
  w: number;
  h: number;
  /** Locale key of the role ("The Steward"): the name plate, the panel title, the button's name. */
  nameKey: string;
  /** Locale key of one short line of greeting shown under the panel title. */
  greetingKey: string;
  /** Icon on the name plate. */
  icon?: IconName;
  /** Name plate above the head (default) or below the feet. */
  plate?: 'above' | 'below';
  /** Where the panel opens (default 'auto'). */
  panel?: PanelSide;
  /** A wider panel (about 56% of the view) for a menu with a grid of cards; the default is about 46%. */
  wide?: boolean;
  /** 'place' for a spot that is not somebody (the ships on the strand): its button reads "Go to …", not "Speak with …". */
  kind?: 'person' | 'place';
}

/** What a room painting receives: the room's light (hour, season, weather, firelight) and a layout seed. */
export interface RoomPaintingProps {
  light: RoomLight;
  seed: number;
}

/** A room: its painting, its people, its title and its final-art id. */
export interface InteriorRoomDef {
  /** The building id (`HallBuildingId`): test id `interior-<id>`, gallery `/?interiors=<id>`. */
  id: string;
  /** Locale key of the building's name on the title plate. */
  titleKey: string;
  /** Asset id of a final painting (manifest); while none exists the procedural `Painting` is drawn. */
  assetId: string;
  /** The procedural painting (1600 × 900, no hotspots in it: they come from `people`). */
  Painting: ComponentType<RoomPaintingProps>;
  /** People and spots, in key order (digit 1 picks the first). The first is the room's main person. */
  people: readonly InteriorPerson[];
}

/** Time of day, season and weather for a room (the scenes' Ambience). */
export type RoomAmbience = Ambience;
