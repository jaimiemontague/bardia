/**
 * The baked sea: the arena's terrain grid painted once into an RGBA image (deep water, shoals, sandy
 * shores, green land, grey rock), softened at the water's edges. Pure (`bakeSeaPixels`) so it is
 * tested in node; `bakeSeaCanvas` puts it on a canvas for Pixi.
 */
import { hash01, SEA, type Rgb } from './palette';

const DEEP = 0;
const LAND = 2;
const ROCK = 3;

export interface TerrainGrid {
  w: number;
  h: number;
  terrain: Uint8Array;
}

/** Pixels per terrain cell in the baked image. */
export const SEA_PX = 5;

/** RGBA pixels (g.w × px by g.h × px) of the arena. */
export function bakeSeaPixels(g: TerrainGrid, px = SEA_PX): { width: number; height: number; data: Uint8ClampedArray } {
  const W = g.w * px;
  const H = g.h * px;
  // 1. Water colour per cell (deep vs shoal), blurred so shoals fade into the deep.
  const water = new Float32Array(g.w * g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const c = g.terrain[i] ?? DEEP;
    water[i] = c === DEEP ? 0 : 1;
  }
  const blur = (src: Float32Array): Float32Array => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
            sum += src[yy * g.w + xx]!;
            n++;
          }
        out[y * g.w + x] = sum / n;
      }
    return out;
  };
  const soft = blur(blur(water));
  // Land and rock masks, sampled smoothly between cell centres so coasts are curves, not steps.
  const landM = new Float32Array(g.w * g.h);
  const rockM = new Float32Array(g.w * g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const c = g.terrain[i] ?? DEEP;
    landM[i] = c === LAND || c === ROCK ? 1 : 0;
    rockM[i] = c === ROCK ? 1 : 0;
  }
  const data = new Uint8ClampedArray(W * H * 4);
  const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let py = 0; py < H; py++) {
    for (let pxx = 0; pxx < W; pxx++) {
      const fx = (pxx + 0.5) / px - 0.5;
      const fy = (py + 0.5) / px - 0.5;
      const x0 = Math.max(0, Math.min(g.w - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(g.h - 1, Math.floor(fy)));
      const x1 = Math.min(g.w - 1, x0 + 1);
      const y1 = Math.min(g.h - 1, y0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      const ty = Math.max(0, Math.min(1, fy - y0));
      const bil = (m: Float32Array) => m[y0 * g.w + x0]! * (1 - tx) * (1 - ty) + m[y0 * g.w + x1]! * tx * (1 - ty) + m[y1 * g.w + x0]! * (1 - tx) * ty + m[y1 * g.w + x1]! * tx * ty;
      const s = bil(soft);
      const rough = (hash01(pxx >> 1, py >> 1, 13) - 0.5) * 0.16;
      const land = bil(landM) + rough;
      const rock = bil(rockM) + rough;
      const noise = (hash01(pxx >> 1, py >> 1, 7) - 0.5) * 6;
      let rgb: [number, number, number];
      if (land > 0.5) {
        if (rock > 0.5) rgb = mix(SEA.rock, SEA.rockDark, hash01(pxx >> 2, py >> 2, 3) * 0.7);
        else if (land < 0.64) rgb = mix(SEA.sand, SEA.land, hash01(pxx >> 1, py >> 1, 5) * 0.25);
        else rgb = mix(SEA.land, SEA.landDark, hash01(pxx >> 3, py >> 3, 9) * 0.8);
      } else {
        const deep = mix(SEA.deeper, SEA.deep, 0.5 + 0.5 * Math.sin((pxx * 0.011 + py * 0.007) * 3.1) * 0.6);
        rgb = mix(deep, SEA.shallow, Math.min(1, s * 1.15));
        // Surf on the shore.
        if (land > 0.38) rgb = mix(rgb, [222, 236, 230], (land - 0.38) / 0.12 * 0.55);
      }
      const o = (py * W + pxx) * 4;
      data[o] = rgb[0] + noise;
      data[o + 1] = rgb[1] + noise;
      data[o + 2] = rgb[2] + noise;
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** The baked sea on a canvas (browser only). */
export function bakeSeaCanvas(g: TerrainGrid, px = SEA_PX): HTMLCanvasElement {
  const img = bakeSeaPixels(g, px);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const id = ctx.createImageData(img.width, img.height);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
  }
  return canvas;
}
