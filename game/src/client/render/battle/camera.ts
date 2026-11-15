/**
 * The battle camera (pure): world units are map tiles; `scale` is screen pixels per tile and (x, y)
 * the tile at the centre of the viewport. Zoom keeps the point under the cursor fixed; panning is
 * clamped so the battlefield never leaves the screen.
 */

export interface BattleCamera {
  x: number;
  y: number;
  scale: number;
}

export interface BattleViewport {
  width: number;
  height: number;
}

/** Smallest and largest zoom (pixels per tile). */
export const MIN_SCALE = 5;
export const MAX_SCALE = 48;

/** The scale that fits the whole map with a small margin. */
export function fitBattleScale(view: BattleViewport, mapW: number, mapH: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(view.width / (mapW + 2), view.height / (mapH + 2))));
}

/** Keeps the centre inside the map. */
export function clampBattleCamera(cam: BattleCamera, view: BattleViewport, mapW: number, mapH: number): BattleCamera {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale));
  const halfW = view.width / 2 / scale;
  const halfH = view.height / 2 / scale;
  const clampAxis = (v: number, half: number, size: number) => (half * 2 >= size ? size / 2 : Math.max(half - 2, Math.min(size - half + 2, v)));
  return { x: clampAxis(cam.x, halfW, mapW), y: clampAxis(cam.y, halfH, mapH), scale };
}

/** Screen pixel of a world point. */
export function toScreen(cam: BattleCamera, view: BattleViewport, x: number, y: number): [number, number] {
  return [(x - cam.x) * cam.scale + view.width / 2, (y - cam.y) * cam.scale + view.height / 2];
}

/** World point of a screen pixel. */
export function toWorld(cam: BattleCamera, view: BattleViewport, sx: number, sy: number): [number, number] {
  return [(sx - view.width / 2) / cam.scale + cam.x, (sy - view.height / 2) / cam.scale + cam.y];
}

/** Zooms by `factor` around the screen point (sx, sy). */
export function zoomAround(cam: BattleCamera, view: BattleViewport, factor: number, sx: number, sy: number, mapW: number, mapH: number): BattleCamera {
  const [wx, wy] = toWorld(cam, view, sx, sy);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
  const next = { x: wx - (sx - view.width / 2) / scale, y: wy - (sy - view.height / 2) / scale, scale };
  return clampBattleCamera(next, view, mapW, mapH);
}
