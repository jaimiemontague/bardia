/**
 * The battlefield ground: a pure RGBA raster of the tile map (terrain with hash noise, hills, furrows,
 * roads, water, walls, towers, stakes and the extraction zone) and a browser bake that paints trees and
 * beached ships over it into a canvas the view uses as a texture. Buildings, gates, fire and everything
 * that changes during the battle are drawn live by the view, not baked.
 */
import { S, T, Z, type BattleMap } from '@sim/battle/map/grid';
import { EXTRACT_RGB, SHIP_RGB, STAKES_RGB, TERRAIN_RGB, TOWER_RGB, WALL_RGB, WALL_TOP_RGB, mixRgb, type Rgb } from './palette';

/** Deterministic 0..1 noise for a pixel (render only). */
export function hash01(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function tileRgb(map: BattleMap, i: number): Rgb {
  const s = map.struct[i]!;
  if (s === S.wall) return WALL_RGB;
  if (s === S.tower) return TOWER_RGB;
  if (s === S.stakes) return STAKES_RGB;
  return TERRAIN_RGB[map.terrain[i]!] ?? [255, 0, 255];
}

/**
 * Rasterises the map at `px` pixels per tile (RGBA, row-major, width map.w × px). Pure: the same map
 * always gives the same pixels.
 */
export function rasterizeGround(map: BattleMap, px: number): Uint8ClampedArray {
  const W = map.w * px;
  const H = map.h * px;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx;
      const terrain = map.terrain[i]!;
      const struct = map.struct[i]!;
      const base = tileRgb(map, i);
      const height = map.height[i]!;
      // Hill shading: lighter on high ground, a darker edge on the south/east slope.
      const southLower = ty + 1 < map.h && map.height[i + map.w]! < height;
      const eastLower = tx + 1 < map.w && map.height[i + 1]! < height;
      const extract = (map.zone[i]! & Z.extractA) !== 0 || (map.zone[i]! & Z.extractD) !== 0;
      for (let py = 0; py < px; py++) {
        for (let pxi = 0; pxi < px; pxi++) {
          const X = tx * px + pxi;
          const Y = ty * px + py;
          const n = hash01(X, Y) - 0.5;
          const coarse = hash01(Math.floor(X / 5), Math.floor(Y / 5), 7) - 0.5;
          let r = base[0];
          let g = base[1];
          let b = base[2];
          let k = 1 + n * 0.07 + coarse * 0.06;
          if (struct === S.none || struct === S.building || struct === S.gate || struct === S.ship) {
            if (terrain === T.farm && Y % 4 === 0) k *= 0.86;
            if (terrain === T.water) k = 1 + n * 0.03 + Math.sin((X + Y * 0.6) * 0.35) * 0.04;
            if (terrain === T.road && (pxi === 0 || pxi === px - 1 || py === 0 || py === px - 1)) k *= 0.97;
          }
          if (struct === S.wall) {
            // Masonry: a lighter walkway band, darker joints.
            const joint = (X % 4 === 0 && Y % 3 !== 0) || Y % 3 === 0;
            const top = py > 1 && py < px - 2 && pxi > 1 && pxi < px - 2;
            const c = top ? WALL_TOP_RGB : WALL_RGB;
            r = c[0];
            g = c[1];
            b = c[2];
            k = joint ? 0.8 : 1 + n * 0.08;
          }
          if (struct === S.tower) k = (pxi + py) % 3 === 0 ? 0.85 : 1.05;
          if (struct === S.stakes) k = pxi % 3 === 1 ? 1.25 : 0.7;
          k += height * 0.045;
          if ((southLower && py >= px - 2) || (eastLower && pxi >= px - 2)) k *= 0.82;
          let rr = r * k;
          let gg = g * k;
          let bb = b * k;
          if (extract) {
            const edge = (X + Y) % 6 < 2;
            const m = edge ? 0.38 : 0.16;
            rr = rr * (1 - m) + EXTRACT_RGB[0] * m;
            gg = gg * (1 - m) + EXTRACT_RGB[1] * m;
            bb = bb * (1 - m) + EXTRACT_RGB[2] * m;
          }
          const o = (Y * W + X) * 4;
          out[o] = rr;
          out[o + 1] = gg;
          out[o + 2] = bb;
          out[o + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** Tiles of the map that hold woods (for tree canopies), as tile indices. */
export function woodTiles(map: BattleMap): number[] {
  const out: number[] = [];
  for (let i = 0; i < map.w * map.h; i++) if (map.terrain[i] === T.woods && map.struct[i] === S.none) out.push(i);
  return out;
}

/** Bakes the ground into a canvas (browser only): the raster, tree canopies and ship hulls. */
export function bakeGround(map: BattleMap, px: number): HTMLCanvasElement {
  const W = map.w * px;
  const H = map.h * px;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('battle view: no 2D canvas context');
  const img = ctx.createImageData(W, H);
  img.data.set(rasterizeGround(map, px));
  ctx.putImageData(img, 0, 0);
  // Tree canopies: two or three overlapping crowns per wooded tile.
  for (const i of woodTiles(map)) {
    const tx = i % map.w;
    const ty = Math.floor(i / map.w);
    const crowns = 2 + Math.floor(hash01(tx, ty, 3) * 2);
    for (let k = 0; k < crowns; k++) {
      const cx = (tx + 0.2 + hash01(tx, ty, 11 + k) * 0.6) * px;
      const cy = (ty + 0.2 + hash01(tx, ty, 21 + k) * 0.6) * px;
      const r = px * (0.32 + hash01(tx, ty, 31 + k) * 0.18);
      const shade = mixRgb([30, 62, 34], [58, 96, 50], hash01(tx, ty, 41 + k));
      ctx.fillStyle = 'rgba(10, 24, 12, 0.45)';
      ctx.beginPath();
      ctx.arc(cx + px * 0.08, cy + px * 0.1, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${shade[0]}, ${shade[1]}, ${shade[2]})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Beached ships: a pointed hull with a mast and a striped sail furled along it.
  for (const s of map.ships) {
    const vertical = s.h >= s.w;
    const len = (vertical ? s.h : s.w) * px;
    const beam = (vertical ? s.w : s.h) * px;
    ctx.save();
    ctx.translate((s.x + s.w / 2) * px, (s.y + s.h / 2) * px);
    if (vertical) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    hull(ctx, len, beam, 2);
    ctx.fillStyle = `rgb(${SHIP_RGB[0]}, ${SHIP_RGB[1]}, ${SHIP_RGB[2]})`;
    hull(ctx, len, beam, 0);
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.9)';
    ctx.lineWidth = Math.max(1, px * 0.12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150, 110, 70, 0.8)';
    ctx.lineWidth = Math.max(1, px * 0.06);
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(-len * 0.38, (-beam / 2) * 0.8 + (beam * 0.8 * k) / 4);
      ctx.lineTo(len * 0.38, (-beam / 2) * 0.8 + (beam * 0.8 * k) / 4);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgb(176, 52, 40)';
    ctx.fillRect(-len * 0.3, -beam * 0.08, len * 0.6, beam * 0.16);
    ctx.restore();
  }
  return canvas;
}

function hull(ctx: CanvasRenderingContext2D, len: number, beam: number, off: number): void {
  ctx.beginPath();
  ctx.moveTo(-len / 2 + off, off);
  ctx.quadraticCurveTo(-len * 0.3 + off, -beam / 2 + off, 0 + off, -beam / 2 + off);
  ctx.quadraticCurveTo(len * 0.3 + off, -beam / 2 + off, len / 2 + off, off);
  ctx.quadraticCurveTo(len * 0.3 + off, beam / 2 + off, 0 + off, beam / 2 + off);
  ctx.quadraticCurveTo(-len * 0.3 + off, beam / 2 + off, -len / 2 + off, off);
  ctx.closePath();
  ctx.fill();
}
