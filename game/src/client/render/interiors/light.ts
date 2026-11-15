/**
 * The light inside a room: the hour outside (the scenes' `lightFor`, used for anything seen through a door,
 * a smoke-hole or an open side) and the firelight that rules indoors after dark. `lit()` shades any painted
 * colour for that light, so a whole room darkens and warms with one call per colour.
 */
import { lightFor, mix, shade, type Light, type TimeOfDay } from '../scenes/paint';
import type { Ambience } from '../scenes/pictures';

/** Every value a room painting needs to light itself. */
export interface RoomLight {
  /** The light outside (sky, land, haze, snow, rain). */
  outdoor: Light;
  tod: TimeOfDay;
  /** How much daylight reaches in (1 by day, 0.15 at night). */
  daylight: number;
  /** How strongly the fire colours things (0.45 by day, 1 at night). */
  fire: number;
  /** The fire's colour (a warm amber) and its hot core. */
  fireTint: string;
  fireCore: string;
  /** Winter outside (snow on the land, frost at the door). */
  winter: boolean;
}

/** The light inside a room for an hour, season and weather. */
export function roomLight(ambience: Ambience): RoomLight {
  const outdoor = lightFor(ambience.hourOfDay, ambience.season, ambience.weather);
  const tod = outdoor.tod;
  const grey = ambience.weather.storm || ambience.weather.wind === 'gale' ? 0.25 : ambience.weather.fog ? 0.15 : 0;
  const base = tod === 'day' ? 1 : tod === 'night' ? 0.15 : 0.5;
  return {
    outdoor,
    tod,
    daylight: Math.max(0.1, base - grey),
    fire: tod === 'day' ? 0.45 : tod === 'night' ? 1 : 0.75,
    fireTint: '#f0a04a',
    fireCore: '#ffd890',
    winter: ambience.season === 'winter',
  };
}

/**
 * A painted colour as it looks in this room: darkened as the daylight fails, warmed toward the fire.
 * `warm` (0..1) is how close the thing stands to a fire; `depth` (0..1) darkens far corners.
 */
export function lit(light: RoomLight, colour: string, warm = 0.3, depth = 0): string {
  const dark = (1 - light.daylight) * 0.55 + depth * 0.4;
  const warmed = mix(colour, light.fireTint, Math.max(0, Math.min(1, warm)) * light.fire * 0.32);
  return shade(warmed, Math.min(0.85, dark * (1 - warm * light.fire * 0.5)));
}

/** A colour as seen outdoors through an opening (the scenes' haze at a distance 0..1). */
export function outside(light: RoomLight, colour: string, distance = 0.4): string {
  const o = light.outdoor;
  const dim = o.tod === 'day' ? 0 : o.tod === 'night' ? 0.55 : 0.28;
  return mix(shade(colour, dim), o.haze, Math.max(0, Math.min(1, distance)) * o.hazeAmount);
}
