/**
 * The sea-battle camera (pure): world units are arena metres; `scale` is screen pixels per metre and
 * (x, y) the point at the centre of the viewport. Zoom keeps the point under the cursor fixed; the
 * camera can frame a rectangle (the auto-follow on the fleets) inside the part of the screen the HUD
 * leaves free.
 */

export interface SeaCamera {
  x: number;
  y: number;
  scale: number;
}

export interface SeaViewport {
  width: number;
  height: number;
}

/** Screen margins the HUD covers (pixels), kept out of auto-framing. */
export interface SeaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Closest zoom (pixels per metre). */
export const MAX_SCALE = 9;
/** Smallest frame the auto-follow keeps around the fleets (metres). */
export const MIN_FRAME_M = 260;

/** The scale at which the whole arena (plus a margin) fits. */
export function minSeaScale(view: SeaViewport, sizeM: number): number {
  return Math.min(view.width, view.height) / (sizeM * 1.08);
}

/** Keeps the scale in range and the centre over the arena. */
export function clampSeaCamera(cam: SeaCamera, view: SeaViewport, sizeM: number): SeaCamera {
  const scale = Math.max(minSeaScale(view, sizeM), Math.min(MAX_SCALE, cam.scale));
  const halfW = view.width / 2 / scale;
  const halfH = view.height / 2 / scale;
  const margin = 120;
  const axis = (v: number, half: number) => (half * 2 >= sizeM + 2 * margin ? sizeM / 2 : Math.max(half - margin, Math.min(sizeM - half + margin, v)));
  return { x: axis(cam.x, halfW), y: axis(cam.y, halfH), scale };
}

export function toScreen(cam: SeaCamera, view: SeaViewport, x: number, y: number): [number, number] {
  return [(x - cam.x) * cam.scale + view.width / 2, (y - cam.y) * cam.scale + view.height / 2];
}

export function toWorld(cam: SeaCamera, view: SeaViewport, sx: number, sy: number): [number, number] {
  return [(sx - view.width / 2) / cam.scale + cam.x, (sy - view.height / 2) / cam.scale + cam.y];
}

/** Zooms by `factor` around the screen point (sx, sy). */
export function zoomAround(cam: SeaCamera, view: SeaViewport, factor: number, sx: number, sy: number, sizeM: number): SeaCamera {
  const [wx, wy] = toWorld(cam, view, sx, sy);
  const scale = Math.max(minSeaScale(view, sizeM), Math.min(MAX_SCALE, cam.scale * factor));
  return clampSeaCamera({ x: wx - (sx - view.width / 2) / scale, y: wy - (sy - view.height / 2) / scale, scale }, view, sizeM);
}

/**
 * The camera that frames the world rectangle inside the free part of the screen (`insets` removed),
 * never closer than `maxScale` and never tighter than MIN_FRAME_M.
 */
export function frameRect(view: SeaViewport, insets: SeaInsets, x0: number, y0: number, x1: number, y1: number, sizeM: number, maxScale = 4.5, minFrameM = MIN_FRAME_M): SeaCamera {
  const freeW = Math.max(80, view.width - insets.left - insets.right);
  const freeH = Math.max(80, view.height - insets.top - insets.bottom);
  let w = Math.max(minFrameM, x1 - x0);
  let h = Math.max(minFrameM * (freeH / freeW), y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  w = Math.max(w, 1);
  h = Math.max(h, 1);
  const scale = Math.min(maxScale, freeW / w, freeH / h);
  // Shift the centre so the rectangle sits in the middle of the free area, not of the whole screen.
  const offX = (insets.left - insets.right) / 2 / scale;
  const offY = (insets.top - insets.bottom) / 2 / scale;
  return clampSeaCamera({ x: cx - offX, y: cy - offY, scale }, view, sizeM);
}

/** Moves a camera toward a target (exponential smoothing; `k` per second). */
export function easeCamera(cam: SeaCamera, target: SeaCamera, dtS: number, k = 2.2): SeaCamera {
  const a = 1 - Math.exp(-k * Math.max(0, dtS));
  const ls = Math.log(cam.scale) + (Math.log(target.scale) - Math.log(cam.scale)) * a;
  return { x: cam.x + (target.x - cam.x) * a, y: cam.y + (target.y - cam.y) * a, scale: Math.exp(ls) };
}

/**
 * How much ships are drawn larger than life so they always read as ships (at least `minPx` long for
 * a 20 m hull); 1 when zoomed in close enough.
 */
export function shipInflation(scale: number, minPx = 80): number {
  return Math.max(1, minPx / (20 * Math.max(1e-6, scale)));
}
