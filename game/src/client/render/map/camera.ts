/**
 * Map camera math (pure). The camera looks at world point (x, y) (cells) at `scale` screen pixels per cell; the
 * viewport is the map canvas in CSS pixels. Zoom levels (§8.10): world (the whole chart), region, local.
 */
import type { Vec2, ZoomBand } from './types';

export interface Viewport {
  width: number;
  height: number;
}

export interface Camera {
  /** World point at the centre of the viewport (cells). */
  x: number;
  y: number;
  /** Screen pixels per cell. */
  scale: number;
}

export interface CameraLimits {
  worldWidth: number;
  worldHeight: number;
  minScale: number;
  maxScale: number;
}

/** Scale thresholds between zoom bands (screen px per cell). */
export const BAND_THRESHOLDS = { region: 3, local: 7.5 } as const;
/** Scale of the region and local presets (world = fit the chart). */
export const BAND_PRESETS = { region: 4.6, local: 11 } as const;
/** Closest zoom (px per cell). */
export const MAX_SCALE = 18;

/** Scale at which the whole world fits the viewport. */
export function fitScale(view: Viewport, worldWidth: number, worldHeight: number): number {
  if (view.width <= 0 || view.height <= 0) return 1;
  return Math.min(view.width / worldWidth, view.height / worldHeight);
}

/** Zoom limits for a viewport: from slightly wider than "fit" to MAX_SCALE. */
export function cameraLimits(view: Viewport, worldWidth: number, worldHeight: number): CameraLimits {
  const fit = fitScale(view, worldWidth, worldHeight);
  return { worldWidth, worldHeight, minScale: Math.min(fit * 0.9, MAX_SCALE), maxScale: Math.max(MAX_SCALE, fit) };
}

/**
 * Keeps the camera inside the chart: the scale within limits and the centre such that the world covers the view
 * along each axis where it is large enough (otherwise the world is centred on that axis).
 */
export function clampCamera(cam: Camera, view: Viewport, lim: CameraLimits): Camera {
  const scale = Math.min(lim.maxScale, Math.max(lim.minScale, Number.isFinite(cam.scale) ? cam.scale : lim.minScale));
  const halfW = view.width / 2 / scale;
  const halfH = view.height / 2 / scale;
  const cx = Number.isFinite(cam.x) ? cam.x : lim.worldWidth / 2;
  const cy = Number.isFinite(cam.y) ? cam.y : lim.worldHeight / 2;
  const x = halfW * 2 >= lim.worldWidth ? lim.worldWidth / 2 : Math.min(lim.worldWidth - halfW, Math.max(halfW, cx));
  const y = halfH * 2 >= lim.worldHeight ? lim.worldHeight / 2 : Math.min(lim.worldHeight - halfH, Math.max(halfH, cy));
  return { x, y, scale };
}

/** Screen position of a world point. */
export function worldToScreen(cam: Camera, view: Viewport, p: Vec2): [number, number] {
  return [(p[0] - cam.x) * cam.scale + view.width / 2, (p[1] - cam.y) * cam.scale + view.height / 2];
}

/** World point under a screen position. */
export function screenToWorld(cam: Camera, view: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - view.width / 2) / cam.scale + cam.x, (sy - view.height / 2) / cam.scale + cam.y];
}

/** Zooms by `factor` keeping the world point under (sx, sy) fixed (clamped). */
export function zoomAt(cam: Camera, view: Viewport, lim: CameraLimits, factor: number, sx: number, sy: number): Camera {
  const [wx, wy] = screenToWorld(cam, view, sx, sy);
  const scale = Math.min(lim.maxScale, Math.max(lim.minScale, cam.scale * factor));
  const x = wx - (sx - view.width / 2) / scale;
  const y = wy - (sy - view.height / 2) / scale;
  return clampCamera({ x, y, scale }, view, lim);
}

/** Pans by a screen-pixel delta (dragging the chart right moves the camera left). */
export function panBy(cam: Camera, view: Viewport, lim: CameraLimits, dx: number, dy: number): Camera {
  return clampCamera({ x: cam.x - dx / cam.scale, y: cam.y - dy / cam.scale, scale: cam.scale }, view, lim);
}

/** Centres on a world point (optionally at a new scale). */
export function centreOn(cam: Camera, view: Viewport, lim: CameraLimits, p: Vec2, scale = cam.scale): Camera {
  return clampCamera({ x: p[0], y: p[1], scale }, view, lim);
}

/** Zoom band of a scale. */
export function zoomBand(scale: number): ZoomBand {
  if (scale >= BAND_THRESHOLDS.local) return 'local';
  if (scale >= BAND_THRESHOLDS.region) return 'region';
  return 'world';
}

/** Preset scale of a zoom band in this viewport (world = fit). */
export function bandScale(band: ZoomBand, view: Viewport, lim: CameraLimits): number {
  const fit = fitScale(view, lim.worldWidth, lim.worldHeight);
  const s = band === 'world' ? fit : BAND_PRESETS[band];
  return Math.min(lim.maxScale, Math.max(lim.minScale, s));
}

/** World rectangle visible in the viewport. */
export function visibleBounds(cam: Camera, view: Viewport): { minX: number; minY: number; maxX: number; maxY: number } {
  const halfW = view.width / 2 / cam.scale;
  const halfH = view.height / 2 / cam.scale;
  return { minX: cam.x - halfW, minY: cam.y - halfH, maxX: cam.x + halfW, maxY: cam.y + halfH };
}

/** Interpolates two cameras (position linearly in screen terms, scale geometrically) for fly-to animations. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const k = Math.max(0, Math.min(1, t));
  const scale = a.scale * (b.scale / a.scale) ** k;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, scale };
}

/** Smoothstep easing for camera animations. */
export function easeInOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/** True when two cameras differ visibly (sub-pixel moves are ignored). */
export function cameraChanged(a: Camera, b: Camera): boolean {
  return Math.abs(a.scale - b.scale) / Math.max(a.scale, 1e-6) > 1e-4 || Math.abs(a.x - b.x) * a.scale > 0.05 || Math.abs(a.y - b.y) * a.scale > 0.05;
}

/** Wheel delta (DOM WheelEvent deltaY in pixels or lines) → zoom factor. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-300, Math.min(300, px));
  return 2 ** (-clamped / 360);
}
