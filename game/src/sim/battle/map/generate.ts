/**
 * Battle map generation (§13.3): templates per battle type and culture style, seeded by the place
 * (campaign seed + settlement/site id), so a settlement always looks the same.
 *
 * Layout convention: attackers come from the south (bottom edge): from their ships on a beach
 * when the place is coastal, otherwise over land; defenders' routes of escape lead north (top
 * edge). Ambushes are the exception: ambushers wait in the woods on both flanks of a road.
 *
 * Pipeline: base terrain (hills, woods, marsh from value noise) → coast or land edge → river →
 * settlement (roads, walls by fort tier with gates/ditch/towers, buildings on roads) or the
 * template's own features (camp, forest road, crossing, strand, cave mouth / barrow) → zones and
 * guard posts → connectivity repair (every door, post and zone reachable) .
 */
import { Rng } from '@sim/core/rng';
import type { BattleKind, SiteKind } from '@sim/core/state';
import type { BattleBuildingKind, BattleMapStyle, BattleTemplateId } from '@content/schemas/tunables/battle';
import type { BattleData } from '../data';
import { gateHp } from '../data';
import { PathGrid } from '../path';
import { createGrid, S, T, TERRAIN_INFO, Z, type BattleMap, type GuardPost, type GuardRole, type MapBuilding, type MapRect } from './grid';
import { noiseField, quantile } from './noise';

/** Everything the generator needs to know about the place. */
export interface MapGenParams {
  template: BattleTemplateId;
  /** Map seed: campaign seed + settlement/site id. */
  seed: string;
  style: BattleMapStyle;
  kind: BattleKind;
  fortTier: number;
  oldStoneWalls: boolean;
  church: boolean;
  /** Attackers arrive by sea (ships on a beach at the bottom). */
  coastal: boolean;
  siteKind?: SiteKind;
}

const HALF_PI = Math.PI / 2;
/** Facing toward the attackers (south, +y) and toward the defenders (north, −y). */
const FACE_SOUTH = HALF_PI;
const FACE_NORTH = -HALF_PI;

class Gen {
  readonly w: number;
  readonly h: number;
  /** First sand row per column (coastal maps), else h. */
  shoreY: Int16Array;
  shoreMin: number;
  cx = 0;
  cy = 0;
  rx = 0;
  ry = 0;
  /** Main road column per row (−1 where there is none). */
  mainRoadX: Int16Array;
  tier = 0;
  hall: MapBuilding | null = null;
  hallY = 0;

  constructor(
    readonly map: BattleMap,
    readonly rng: Rng,
    readonly p: MapGenParams,
    readonly data: BattleData,
  ) {
    this.w = map.w;
    this.h = map.h;
    this.shoreY = new Int16Array(map.w).fill(map.h);
    this.shoreMin = map.h;
    this.mainRoadX = new Int16Array(map.h).fill(-1);
  }

  get tpl() {
    return this.data.t.templates[this.p.template];
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  setT(x: number, y: number, t: number): void {
    if (this.inb(x, y)) this.map.terrain[this.idx(x, y)] = t;
  }
  terrain(x: number, y: number): number {
    return this.map.terrain[this.idx(x, y)]!;
  }
  free(x: number, y: number): boolean {
    if (!this.inb(x, y)) return false;
    const i = this.idx(x, y);
    return this.map.struct[i] === S.none && TERRAIN_INFO[this.map.terrain[i]!]!.walkable;
  }

  // ---------------------------------------------------------------------------------------------
  // Base terrain

  baseTerrain(): void {
    const { w, h, map } = this;
    const tpl = this.tpl;
    const seed = this.p.seed;
    const hill = noiseField(w, h, 16, 3, `${seed}|hills`);
    const t3 = quantile(hill, 1 - tpl.hills / 3);
    const t2 = quantile(hill, 1 - tpl.hills);
    const t1 = quantile(hill, 1 - Math.min(0.95, tpl.hills * 1.8));
    for (let i = 0; i < w * h; i++) {
      const v = hill[i]!;
      map.height[i] = v >= t3 ? 3 : v >= t2 ? 2 : v >= t1 ? 1 : 0;
    }
    if (tpl.woods > 0) {
      const wood = noiseField(w, h, 9, 3, `${seed}|woods`);
      const tw = quantile(wood, 1 - tpl.woods);
      for (let i = 0; i < w * h; i++) if (wood[i]! >= tw) map.terrain[i] = T.woods;
    }
    if (tpl.marsh > 0) {
      const marsh = noiseField(w, h, 7, 2, `${seed}|marsh`);
      const tm = quantile(marsh, tpl.marsh * 2.2, (i) => map.height[i] === 0);
      for (let i = 0; i < w * h; i++) if (map.height[i] === 0 && marsh[i]! < tm) map.terrain[i] = T.marsh;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Coast (sea along the bottom) or land edge

  coast(widthSand = 3): void {
    const { w, h, map } = this;
    const shoreNoise = noiseField(w, 1, 14, 2, `${this.p.seed}|shore`);
    const base = h - 9 - (widthSand - 3);
    for (let x = 0; x < w; x++) {
      const sy = base + Math.round((shoreNoise[x]! - 0.5) * 4);
      this.shoreY[x] = sy;
      this.shoreMin = Math.min(this.shoreMin, sy);
      for (let y = sy; y < h; y++) {
        const i = this.idx(x, y);
        const d = y - sy;
        map.terrain[i] = d < widthSand ? T.sand : d < widthSand + 2 ? T.ford : T.water;
        map.height[i] = 0;
      }
      // Low ground behind the strand.
      for (let y = Math.max(0, sy - 3); y < sy; y++) {
        const i = this.idx(x, y);
        map.height[i] = Math.min(map.height[i]!, 1);
        if (map.terrain[i] === T.marsh && y >= sy - 1) map.terrain[i] = T.sand;
      }
    }
    // Ships drawn up in the shallows, bows to the beach.
    const ships = 2 + this.rng.int(0, 1) + (this.p.template === 'beach' ? 1 : 0);
    const span = Math.min(w - 16, ships * 11);
    const x0 = Math.round(w / 2 - span / 2);
    for (let s = 0; s < ships; s++) {
      const sx = x0 + Math.round((s + 0.5) * (span / ships)) - 3 + this.rng.int(-1, 1);
      const sy = this.shoreY[Math.min(w - 1, Math.max(0, sx + 3))]! + widthSand + 1;
      const rect: MapRect = { x: sx, y: sy, w: 7, h: 2 };
      for (let y = rect.y; y < rect.y + rect.h; y++)
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (!this.inb(x, y)) continue;
          const i = this.idx(x, y);
          map.terrain[i] = T.water;
          map.struct[i] = S.ship;
          map.structId[i] = s;
        }
      map.ships.push(rect);
    }
    // Extraction: beach and shallows within reach of a ship.
    for (const r of map.ships) {
      for (let y = r.y - 5; y <= r.y + r.h + 1; y++)
        for (let x = r.x - 3; x <= r.x + r.w + 2; x++) {
          if (!this.inb(x, y)) continue;
          const i = this.idx(x, y);
          if (map.struct[i] === S.none && (map.terrain[i] === T.sand || map.terrain[i] === T.ford)) map.zone[i]! |= Z.extractA;
        }
    }
  }

  landEdge(): void {
    const { w, h, map } = this;
    for (let x = 0; x < w; x++)
      for (let y = h - 2; y < h; y++) {
        const i = this.idx(x, y);
        if (map.terrain[i] === T.water) map.terrain[i] = T.ford;
        map.zone[i]! |= Z.extractA;
      }
  }

  // ---------------------------------------------------------------------------------------------
  // River

  river(horizontal: boolean): void {
    const { w, h, map, rng } = this;
    const width = 2 + rng.int(0, 1);
    const noise = noiseField(horizontal ? w : h, 1, 18, 2, `${this.p.seed}|river`);
    const tiles: number[] = [];
    if (horizontal) {
      const base = Math.round(h * 0.48);
      for (let x = 0; x < w; x++) {
        const c = base + Math.round((noise[x]! - 0.5) * 12);
        for (let y = c; y < c + width; y++) if (this.inb(x, y)) tiles.push(this.idx(x, y));
      }
    } else {
      const base = Math.round(w * (0.18 + rng.float() * 0.18) + (rng.chance(0.5) ? w * 0.46 : 0));
      const bottom = this.shoreMin < h ? this.shoreMin + 3 : h;
      for (let y = 0; y < bottom; y++) {
        const c = base + Math.round((noise[y]! - 0.5) * 14);
        for (let x = c; x < c + width; x++) if (this.inb(x, y)) tiles.push(this.idx(x, y));
      }
    }
    for (const i of tiles) {
      if (map.struct[i] !== S.none) continue;
      map.terrain[i] = T.water;
      map.height[i] = 0;
    }
    // Banks: marsh and low ground.
    for (const i of tiles) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!this.inb(x + dx, y + dy)) continue;
          const j = this.idx(x + dx, y + dy);
          if (map.terrain[j] === T.water) continue;
          map.height[j] = Math.min(map.height[j]!, 1);
          if (map.terrain[j] === T.woods && rng.chance(0.25)) map.terrain[j] = T.marsh;
        }
    }
    // Fords: one or two shallow stretches (more are added by the connectivity repair if needed).
    const fords = horizontal ? 1 : 1 + rng.int(0, 1);
    for (let f = 0; f < fords; f++) {
      if (horizontal) {
        const fx = Math.round(w * (0.2 + 0.6 * rng.float()));
        this.crossRiverAt(fx, true, 5, T.ford);
      } else {
        const fy = Math.round(h * (0.15 + 0.35 * rng.float()));
        this.crossRiverAt(fy, false, 5, T.ford);
      }
    }
  }

  /** Turns a stretch of river at column (horizontal river) or row (vertical) `at` into `kind`. */
  crossRiverAt(at: number, horizontalRiver: boolean, width: number, kind: number): void {
    const { w, h, map } = this;
    const half = Math.floor(width / 2);
    if (horizontalRiver) {
      for (let x = at - half; x <= at + half; x++) {
        if (x < 0 || x >= w) continue;
        for (let y = 0; y < h; y++) {
          const i = this.idx(x, y);
          if (map.terrain[i] === T.water && map.struct[i] === S.none && y < this.shoreMin) map.terrain[i] = kind;
        }
      }
    } else {
      for (let y = at - half; y <= at + half; y++) {
        if (y < 0 || y >= h || y >= this.shoreMin) continue;
        for (let x = 0; x < w; x++) {
          const i = this.idx(x, y);
          if (map.terrain[i] === T.water && map.struct[i] === S.none) map.terrain[i] = kind;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Roads

  /** Draws a road tile, turning water into a bridge. */
  roadTile(x: number, y: number): void {
    if (!this.inb(x, y)) return;
    const i = this.idx(x, y);
    if (this.map.struct[i] !== S.none) return;
    const t = this.map.terrain[i]!;
    if (t === T.water || t === T.ford) this.map.terrain[i] = this.shoreMin <= y ? T.ford : T.bridge;
    else if (t !== T.sand && t !== T.rock) this.map.terrain[i] = T.road;
  }

  /** A wandering north–south road from y0 to y1 near column x (width 1–2). Records mainRoadX. */
  verticalRoad(x: number, y0: number, y1: number, width: number, lockX0 = -1, lockX1 = -1, lockY0 = -1, lockY1 = -1): void {
    let cx = x;
    for (let y = y0; y <= y1; y++) {
      const locked = y >= lockY0 && y <= lockY1;
      if (!locked && y % 4 === 0) cx += this.rng.int(-1, 1);
      if (locked && lockX0 >= 0) cx = Math.min(lockX1, Math.max(lockX0, cx));
      cx = Math.min(this.w - 3, Math.max(2, cx));
      for (let k = 0; k < width; k++) this.roadTile(cx + k, y);
      if (y >= 0 && y < this.h && this.mainRoadX[y] === -1) this.mainRoadX[y] = cx;
    }
  }

  horizontalRoad(y: number, x0: number, x1: number, width: number): void {
    let cy = y;
    for (let x = x0; x <= x1; x++) {
      for (let k = 0; k < width; k++) this.roadTile(x, cy + k);
      if (x % 6 === 0 && (x < this.cx - this.rx - 3 || x > this.cx + this.rx + 3)) cy = Math.min(this.h - 4, Math.max(2, cy + this.rng.int(-1, 1)));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Settlement

  settlement(): void {
    const { w, h, map, rng } = this;
    const tpl = this.tpl;
    const p = this.p;
    let [rx, ry] = tpl.core;
    rx = Math.min(rx, Math.floor(w / 2) - 6);
    ry = Math.min(ry, Math.floor(h / 2) - 8);
    const tier = Math.max(p.fortTier, tpl.minFortTier);
    map.fortTier = tier;
    const margin = tier > 0 ? 5 : 2;
    const cx = Math.round(w / 2) + rng.int(-4, 4);
    const maxCy = (this.shoreMin < h ? this.shoreMin : h - 4) - ry - margin - 6;
    const cy = Math.max(ry + margin + 3, Math.min(Math.round(h * 0.42) + rng.int(-2, 2), maxCy));
    this.cx = cx;
    this.cy = cy;
    this.rx = rx;
    this.ry = ry;

    // Clear and level the core (and the ground just around the walls).
    const clearX0 = cx - rx - margin;
    const clearX1 = cx + rx + margin;
    const clearY0 = cy - ry - margin;
    const clearY1 = cy + ry + margin;
    const level = Math.min(1, map.height[this.idx(cx, cy)]!);
    for (let y = clearY0; y <= clearY1; y++)
      for (let x = clearX0; x <= clearX1; x++) {
        if (!this.inb(x, y)) continue;
        const i = this.idx(x, y);
        if (map.terrain[i] === T.water) continue; // rivers run through towns (bridged by the roads)
        map.terrain[i] = T.open;
        map.height[i] = level;
      }

    // Fields around villages and towns.
    if (p.template === 'village' || p.template === 'town') this.farmland(cx, cy, rx + margin + 2, ry + margin + 2);

    // Roads: the main road from the attackers' edge through the core to the north edge.
    const roadBottom = this.shoreMin < h ? this.shoreMin : h - 1;
    const mainW = p.template === 'village' || p.template === 'cloister' ? 1 : 2;
    this.verticalRoad(cx, 0, roadBottom, mainW, cx - 1, cx + 1, cy - ry - margin, cy + ry + margin);
    const crossY = cy + Math.round(ry * 0.25);
    this.horizontalRoad(crossY, p.template === 'village' || p.template === 'cloister' ? cx - rx : 0, p.template === 'village' || p.template === 'cloister' ? cx + rx : w - 1, 1);
    this.tier = tier;
    // The chief's hall, the church and the reliquary claim their plots before the street grid.
    this.keyBuildings();
    if (tpl.streetSpacing > 0) {
      const sp = tpl.streetSpacing;
      for (let x = cx - sp; x >= cx - rx + 2; x -= sp) this.straightRoadV(x, cy - ry + 1, cy + ry - 1);
      for (let x = cx + sp; x <= cx + rx - 2; x += sp) this.straightRoadV(x, cy - ry + 1, cy + ry - 1);
      for (let y = crossY - sp; y >= cy - ry + 2; y -= sp) this.straightRoadH(y, cx - rx + 1, cx + rx - 1);
      for (let y = crossY + sp; y <= cy + ry - 2; y += sp) this.straightRoadH(y, cx - rx + 1, cx + rx - 1);
    }

    if (tier > 0) this.walls(tier, crossY);
    this.otherBuildings(crossY);
  }

  straightRoadV(x: number, y0: number, y1: number): void {
    for (let y = y0; y <= y1; y++) this.roadTile(x, y);
  }
  straightRoadH(y: number, x0: number, x1: number): void {
    for (let x = x0; x <= x1; x++) this.roadTile(x, y);
  }

  farmland(cx: number, cy: number, rx: number, ry: number): void {
    const { map } = this;
    const noise = noiseField(this.w, this.h, 6, 2, `${this.p.seed}|farm`);
    for (let y = cy - ry - 8; y <= cy + ry + 8; y++)
      for (let x = cx - rx - 10; x <= cx + rx + 10; x++) {
        if (!this.inb(x, y) || y >= this.shoreMin - 1) continue;
        const i = this.idx(x, y);
        const inCore = Math.abs(x - cx) <= rx && Math.abs(y - cy) <= ry;
        if (inCore || map.terrain[i] !== T.open || map.height[i]! >= 2) continue;
        if (noise[i]! > 0.52) map.terrain[i] = T.farm;
      }
  }

  walls(tier: number, crossY: number): void {
    const { map } = this;
    const b = this.data.balance;
    const thick = tier >= 4 ? 2 : 1;
    // The ring's inner face stands two tiles outside the core, leaving a lane behind the wall.
    const off = 1 + thick;
    const x0 = this.cx - this.rx - off;
    const x1 = this.cx + this.rx + off;
    const y0 = this.cy - this.ry - off;
    const y1 = this.cy + this.ry + off;
    map.ring = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const chamfer = 2;
    const onRing = (x: number, y: number): boolean => {
      for (let t = 0; t < thick; t++) {
        const ax0 = x0 + t;
        const ax1 = x1 - t;
        const ay0 = y0 + t;
        const ay1 = y1 - t;
        if (x < ax0 || x > ax1 || y < ay0 || y > ay1) continue;
        const dx = Math.min(x - ax0, ax1 - x);
        const dy = Math.min(y - ay0, ay1 - y);
        if (dx + dy === chamfer && dx <= chamfer && dy <= chamfer) return true;
        if (dx + dy < chamfer) continue;
        if (dx === 0 || dy === 0) return true;
      }
      return false;
    };
    const insideRing = (x: number, y: number): boolean => {
      if (x <= x0 || x >= x1 || y <= y0 || y >= y1) return false;
      const dx = Math.min(x - x0, x1 - x);
      const dy = Math.min(y - y0, y1 - y);
      return dx + dy > chamfer;
    };
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.inb(x, y)) continue;
        const i = this.idx(x, y);
        if (onRing(x, y)) {
          map.struct[i] = S.wall;
          map.terrain[i] = T.open;
        } else if (insideRing(x, y)) map.zone[i]! |= Z.inside;
      }
    // Ditch-and-bank for ring-forts and burhs.
    if (tier === 2 || tier === 3) {
      for (let y = y0 - 1; y <= y1 + 1; y++)
        for (let x = x0 - 1; x <= x1 + 1; x++) {
          if (!this.inb(x, y)) continue;
          if (x !== x0 - 1 && x !== x1 + 1 && y !== y0 - 1 && y !== y1 + 1) continue;
          const i = this.idx(x, y);
          if (map.struct[i] === S.none && map.terrain[i] !== T.water) map.terrain[i] = T.ditch;
        }
    }
    // Gates where the roads cross the ring.
    const hp = gateHp(b, tier);
    const gateW = tier >= 4 ? 4 : 3;
    const southX = this.mainRoadX[y1] ?? this.cx;
    const northX = this.mainRoadX[y0] ?? this.cx;
    this.gate(southX >= 0 ? southX : this.cx, y1 - thick + 1, gateW, thick, true, 1, hp);
    this.gate(northX >= 0 ? northX : this.cx, y0, gateW, thick, true, -1, hp);
    if (this.p.template === 'town' || this.p.template === 'cityQuarter') {
      this.gate(x0, crossY, thick, gateW, false, -1, hp);
      this.gate(x1 - thick + 1, crossY, thick, gateW, false, 1, hp);
    }
    // Towers (archer platforms) inside the corners and beside the main gate.
    if (tier >= 2) {
      const ins = thick + 1;
      const spots: [number, number][] = [
        [x0 + ins + 1, y0 + ins + 1],
        [x1 - ins - 2, y0 + ins + 1],
        [x0 + ins + 1, y1 - ins - 2],
        [x1 - ins - 2, y1 - ins - 2],
        [southX - 3, y1 - ins - 1],
        [southX + gateW + 1, y1 - ins - 1],
      ];
      for (const [tx, ty] of spots) this.tower(tx, ty);
    }
    // Cover just inside the walls.
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.inb(x, y)) continue;
        const i = this.idx(x, y);
        if ((map.zone[i]! & Z.inside) === 0) continue;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (this.inb(nx, ny) && map.struct[this.idx(nx, ny)] === S.wall) map.zone[i]! |= Z.wallCover;
        }
      }
  }

  /**
   * A gate in the wall: a run of `w`×`h` tiles at (x, y) (x is the road column for horizontal
   * walls, y the road row for vertical walls). `outward` is +1 when outside lies toward +y/+x.
   */
  gate(x: number, y: number, w: number, h: number, horizontal: boolean, outward: number, hp: number): void {
    const { map } = this;
    const gx = horizontal ? x - Math.floor((w - 2) / 2) : x;
    const gy = horizontal ? y : y - Math.floor((h - 2) / 2);
    const id = map.gates.length;
    for (let yy = gy; yy < gy + h; yy++)
      for (let xx = gx; xx < gx + w; xx++) {
        if (!this.inb(xx, yy)) continue;
        const i = this.idx(xx, yy);
        map.struct[i] = S.gate;
        map.structId[i] = id;
        map.terrain[i] = T.road;
        map.zone[i]! &= ~Z.inside;
      }
    const midX = gx + Math.floor(w / 2);
    const midY = gy + Math.floor(h / 2);
    const outX = horizontal ? midX : outward > 0 ? gx + w : gx - 1;
    const outY = horizontal ? (outward > 0 ? gy + h : gy - 1) : midY;
    const inX = horizontal ? midX : outward > 0 ? gx - 1 : gx + w;
    const inY = horizontal ? (outward > 0 ? gy - 1 : gy + h) : midY;
    // A causeway over the ditch in front of the gate.
    const span = horizontal ? w : h;
    for (let k = 0; k < span; k++)
      for (let d = 0; d < 2; d++) {
        const ox = horizontal ? gx + k : outX + outward * d;
        const oy = horizontal ? outY + outward * d : gy + k;
        if (!this.inb(ox, oy)) continue;
        const i = this.idx(ox, oy);
        if (map.struct[i] === S.none && (map.terrain[i] === T.ditch || map.terrain[i] === T.water)) map.terrain[i] = T.road;
      }
    map.gates.push({ id: `g${id}`, x: gx, y: gy, w, h, hp, outX, outY, inX, inY });
    const facing = horizontal ? (outward > 0 ? FACE_SOUTH : FACE_NORTH) : outward > 0 ? 0 : Math.PI;
    map.guards.push({ x: inX + 0.5 - (horizontal ? 0 : outward * 1.5), y: inY + 0.5 - (horizontal ? outward * 1.5 : 0), role: 'gate', facing });
  }

  tower(x: number, y: number): void {
    const { map } = this;
    for (let yy = y; yy < y + 2; yy++)
      for (let xx = x; xx < x + 2; xx++) {
        if (!this.inb(xx, yy)) return;
        const i = this.idx(xx, yy);
        if (map.struct[i] !== S.none) return;
      }
    for (let yy = y; yy < y + 2; yy++)
      for (let xx = x; xx < x + 2; xx++) {
        const i = this.idx(xx, yy);
        map.struct[i] = S.tower;
        map.height[i] = 3;
        map.terrain[i] = T.floor;
      }
    map.guards.push({ x: x + 1, y: y + 1, role: 'tower', facing: FACE_SOUTH });
  }

  // ---------------------------------------------------------------------------------------------
  // Buildings

  /** Footprint size for a kind in this style. */
  sizeOf(kind: BattleBuildingKind): [number, number] {
    const base = this.data.t.buildings[kind].size;
    let [bw, bh] = base;
    if (this.p.style === 'cael' && (kind === 'house' || kind === 'storehouse')) bw = bh = Math.max(bw, bh) - 1;
    if ((this.p.style === 'saraleonese' || this.p.style === 'corvani') && kind === 'house') [bw, bh] = [4, 4];
    if (this.p.style === 'velkar' && kind === 'house') [bw, bh] = [4, 4];
    return [bw, bh];
  }

  /** Tries to place a building of `kind` near (tx, ty) within the region; returns it or null. */
  place(kind: BattleBuildingKind, tx: number, ty: number, region: MapRect, opts: { isKeep?: boolean; isTreasury?: boolean; tries?: number; preferRoad?: boolean } = {}): MapBuilding | null {
    const { map, rng } = this;
    let [bw, bh] = this.sizeOf(kind);
    if (kind === 'house' || kind === 'storehouse' || kind === 'workshop') if (rng.chance(0.4)) [bw, bh] = [bh, bw];
    let best: { x: number; y: number; score: number; door: [number, number] } | null = null;
    const tries = opts.tries ?? 140;
    for (let k = 0; k < tries; k++) {
      const spread = 2 + Math.floor((k / tries) * Math.max(region.w, region.h));
      const x = Math.round(tx - bw / 2) + rng.int(-spread, spread);
      const y = Math.round(ty - bh / 2) + rng.int(-spread, spread);
      if (x < region.x || y < region.y || x + bw > region.x + region.w || y + bh > region.y + region.h) continue;
      if (!this.footprintFree(x, y, bw, bh)) continue;
      const door = this.doorFor(x, y, bw, bh);
      if (!door) continue;
      const onRoad = map.terrain[this.idx(door[0], door[1])] === T.road;
      const dist = Math.abs(x + bw / 2 - tx) + Math.abs(y + bh / 2 - ty);
      const score = dist + (opts.preferRoad !== false && !onRoad ? 6 : 0);
      if (!best || score < best.score) best = { x, y, score, door };
      if (score < 2) break;
    }
    if (!best) return null;
    const def = this.data.t.buildings[kind];
    const styleMult = this.data.t.styleFlammabilityMult[this.p.style];
    const stone =
      (this.p.style === 'saraleonese' && kind !== 'tent' && kind !== 'stable' && kind !== 'granary') ||
      (this.p.style === 'corvani' && (kind === 'keep' || kind === 'church' || kind === 'storehouse')) ||
      kind === 'keep';
    const flammability = Math.min(1, def.flammability * styleMult * (stone ? 0.6 : 1));
    const id = map.buildings.length;
    const bld: MapBuilding = {
      id: `b${id}`,
      kind,
      x: best.x,
      y: best.y,
      w: bw,
      h: bh,
      doorX: best.door[0],
      doorY: best.door[1],
      flammability,
      lootWeight: def.lootWeight,
      stone,
      isKeep: opts.isKeep === true,
      isTreasury: opts.isTreasury === true,
    };
    for (let yy = bld.y; yy < bld.y + bh; yy++)
      for (let xx = bld.x; xx < bld.x + bw; xx++) {
        const i = this.idx(xx, yy);
        map.struct[i] = S.building;
        map.structId[i] = id;
        if (map.terrain[i] === T.woods || map.terrain[i] === T.marsh || map.terrain[i] === T.farm) map.terrain[i] = T.open;
      }
    const di = this.idx(bld.doorX, bld.doorY);
    if (map.terrain[di] === T.woods || map.terrain[di] === T.marsh) map.terrain[di] = T.open;
    map.buildings.push(bld);
    return bld;
  }

  footprintFree(x: number, y: number, bw: number, bh: number): boolean {
    const { map } = this;
    for (let yy = y - 1; yy <= y + bh; yy++)
      for (let xx = x - 1; xx <= x + bw; xx++) {
        if (!this.inb(xx, yy)) return false;
        const i = this.idx(xx, yy);
        const inner = xx >= x && xx < x + bw && yy >= y && yy < y + bh;
        const s = map.struct[i]!;
        if (s !== S.none) return false;
        const t = map.terrain[i]!;
        if (inner && (t === T.road || t === T.bridge || t === T.water || t === T.ford || t === T.sand || t === T.ditch || t === T.rock)) return false;
        if (!inner && (t === T.water || t === T.rock)) continue;
        if (inner && map.height[i]! >= 3) return false;
      }
    return true;
  }

  /** The best door tile: the middle of a side facing a road, else any walkable side. */
  doorFor(x: number, y: number, bw: number, bh: number): [number, number] | null {
    const cands: [number, number][] = [
      [x + Math.floor(bw / 2), y + bh],
      [x + Math.floor(bw / 2), y - 1],
      [x - 1, y + Math.floor(bh / 2)],
      [x + bw, y + Math.floor(bh / 2)],
    ];
    let pick: [number, number] | null = null;
    for (const c of cands) {
      if (!this.free(c[0], c[1])) continue;
      if (this.terrain(c[0], c[1]) === T.road) return c;
      pick ??= c;
    }
    return pick;
  }

  /** The settlement core (inside the walls when there are any: the ring runs 2 tiles outside it). */
  innerRect(): MapRect {
    const { cx, cy, rx, ry } = this;
    return { x: cx - rx, y: cy - ry, w: rx * 2 + 1, h: ry * 2 + 1 };
  }

  keyBuildings(): void {
    const { map, cx, cy, rx, ry } = this;
    const tpl = this.tpl;
    const p = this.p;
    const inner = this.innerRect();
    // The chief's hall (keep or longhall), north of the cross road, door onto the main road.
    const keepKind: BattleBuildingKind =
      p.template === 'fortress' || ((p.template === 'cityQuarter' || p.style === 'corvani' || p.style === 'saraleonese') && map.fortTier >= 3) ? 'keep' : 'longhall';
    const hallY = p.template === 'fortress' ? cy : cy - Math.round(ry * 0.45);
    const hall = this.place(keepKind, cx + (keepKind === 'keep' ? 0 : 4), hallY, inner, { isKeep: true, tries: 220 });
    this.hall = hall;
    this.hallY = hallY;
    if (hall) {
      map.guards.push({ x: hall.doorX + 0.5, y: hall.doorY + 0.5, role: 'chief', facing: FACE_SOUTH });
      map.objective = { kind: p.template === 'fortress' ? 'keep' : 'none', x: hall.doorX + 0.5, y: hall.doorY + 0.5 };
    }
    if (p.template === 'cloister') {
      const hallC = this.place('cloisterHall', cx - 3, cy - Math.round(ry * 0.3), inner, { isTreasury: true, tries: 220 });
      if (hallC) {
        map.objective = { kind: 'reliquary', x: hallC.doorX + 0.5, y: hallC.doorY + 0.5 };
        map.guards.push({ x: hallC.doorX + 0.5, y: hallC.doorY + 0.5, role: 'monks', facing: FACE_SOUTH });
      }
    }
    if (p.church || tpl.extras.includes('church') || p.template === 'cloister') {
      const ch = this.place('church', cx + Math.round(rx * 0.45), cy - Math.round(ry * 0.1), inner, { isTreasury: p.template !== 'cloister' });
      if (ch && p.template !== 'cloister') map.guards.push({ x: ch.doorX + 0.5, y: ch.doorY + 0.5, role: 'cache', facing: FACE_SOUTH });
    }
  }

  otherBuildings(crossY: number): void {
    const { map, rng, cx, cy, rx, ry } = this;
    const tpl = this.tpl;
    const p = this.p;
    const walled = map.ring !== null;
    const inner = this.innerRect();
    const outer: MapRect = { x: Math.max(1, cx - rx - 10), y: Math.max(1, cy - ry - 8), w: rx * 2 + 21, h: ry * 2 + 16 };
    outer.w = Math.min(outer.w, this.w - 1 - outer.x);
    outer.h = Math.min(outer.h, (this.shoreMin < this.h ? this.shoreMin - 1 : this.h - 1) - outer.y);
    const hall = this.hall;
    const hallY = this.hallY;
    const stores = rng.int(tpl.storehouses[0], tpl.storehouses[1]);
    for (let s = 0; s < stores; s++) {
      const b = this.place('storehouse', cx + rng.int(-Math.floor(rx / 2), Math.floor(rx / 2)), hallY + rng.int(-2, 6), inner);
      if (b) map.guards.push({ x: b.doorX + 0.5, y: b.doorY + 0.5, role: 'cache', facing: FACE_SOUTH });
    }
    for (const extra of tpl.extras) {
      if (extra === 'church' || extra === 'cloisterHall') continue;
      if (extra === 'boathouse') {
        if (this.shoreMin < this.h) {
          const bx = cx + (rng.chance(0.5) ? -1 : 1) * (rx + 4 + rng.int(0, 6));
          this.place('boathouse', bx, this.shoreMin - 3, { x: 1, y: this.shoreMin - 8, w: this.w - 2, h: 7 }, { preferRoad: false });
        }
        continue;
      }
      this.place(extra, cx + rng.int(-rx, rx), cy + rng.int(-ry, ry), inner);
    }
    const houseKind: BattleBuildingKind = p.style === 'kurgai' ? 'tent' : 'house';
    const houses = rng.int(tpl.houses[0], tpl.houses[1]);
    for (let k = 0; k < houses; k++) {
      const region = walled || k < houses * 0.7 ? inner : outer;
      this.place(houseKind, cx + rng.int(-rx, rx), cy + rng.int(-ry, ry), region);
    }
    // Patrol posts on the cross road and main road.
    map.guards.push({ x: cx + 0.5, y: crossY + 0.5, role: 'patrol', facing: FACE_SOUTH });
    map.guards.push({ x: cx - Math.round(rx * 0.6) + 0.5, y: crossY + 0.5, role: 'patrol', facing: FACE_SOUTH });
    map.guards.push({ x: cx + Math.round(rx * 0.6) + 0.5, y: crossY + 0.5, role: 'patrol', facing: FACE_SOUTH });
    map.guards.push({ x: cx + 0.5, y: cy + ry - 1.5, role: 'line', facing: FACE_SOUTH });
    // Reinforcements: from the hall when walled, else down the roads from the north edge.
    if (walled && hall) map.waveSpawns.push({ x: hall.doorX + 0.5, y: hall.doorY + 1.5, role: 'reserve', facing: FACE_SOUTH });
    else {
      const top = this.mainRoadX[1] ?? cx;
      map.waveSpawns.push({ x: (top >= 0 ? top : cx) + 0.5, y: 2.5, role: 'reserve', facing: FACE_SOUTH });
      map.waveSpawns.push({ x: 2.5, y: crossY + 0.5, role: 'reserve', facing: 0 });
      map.waveSpawns.push({ x: this.w - 2.5, y: crossY + 0.5, role: 'reserve', facing: Math.PI });
    }
  }

  /** A few farmsteads somewhere on the map (field and beach templates). */
  farmstead(houses: number, nearX: number, nearY: number): void {
    if (houses <= 0) return;
    const region: MapRect = { x: Math.max(2, nearX - 12), y: Math.max(2, nearY - 8), w: 24, h: 16 };
    region.w = Math.min(region.w, this.w - 2 - region.x);
    region.h = Math.min(region.h, (this.shoreMin < this.h ? this.shoreMin - 2 : this.h - 2) - region.y);
    for (let k = 0; k < houses; k++) this.place(this.p.style === 'kurgai' ? 'tent' : 'house', nearX + this.rng.int(-6, 6), nearY + this.rng.int(-4, 4), region, { preferRoad: false });
  }

  // ---------------------------------------------------------------------------------------------
  // Template features

  field(): void {
    const { w, h, rng } = this;
    const tpl = this.tpl;
    const roadX = Math.round(w * (0.35 + rng.float() * 0.3));
    this.verticalRoad(roadX, 0, (this.shoreMin < h ? this.shoreMin : h) - 1, 1);
    // Keep the two deployment bands open enough to form up.
    this.thin(0, 4, w, 12, 0.6);
    this.thin(0, h - 16, w, 12, 0.6);
    const houses = rng.int(tpl.houses[0], tpl.houses[1]);
    this.farmstead(houses, roadX + (rng.chance(0.5) ? -8 : 8), Math.round(h * 0.5));
    if (this.p.siteKind === 'tower' || this.p.siteKind === 'ruinedHall') {
      const kind: BattleBuildingKind = this.p.siteKind === 'tower' ? 'keep' : 'longhall';
      const region: MapRect = { x: 8, y: 6, w: w - 16, h: Math.round(h * 0.4) };
      const b = this.place(kind, Math.round(w / 2), Math.round(h * 0.25), region, { isKeep: true, preferRoad: false, tries: 300 });
      if (b) {
        this.map.objective = { kind: 'keep', x: b.doorX + 0.5, y: b.doorY + 0.5 };
        this.map.guards.push({ x: b.doorX + 0.5, y: b.doorY + 1.5, role: 'objective', facing: FACE_SOUTH });
      }
    }
    if (this.p.kind === 'sortie') this.camp();
  }

  /** The besiegers' camp for a sortie: tents in the defenders' band behind a line of stakes. */
  camp(): void {
    const { w, map, rng } = this;
    const cy = 10;
    const region: MapRect = { x: 6, y: 3, w: w - 12, h: 14 };
    const tents = 5 + rng.int(0, 3);
    for (let k = 0; k < tents; k++) this.place('tent', Math.round(w / 2) + rng.int(-18, 18), cy + rng.int(-3, 3), region, { preferRoad: false });
    const sy = 19;
    for (let x = 8; x < w - 8; x++) {
      if ((x - 8) % 12 >= 9) continue; // gaps to sally through
      const i = this.idx(x, sy);
      if (map.struct[i] === S.none && TERRAIN_INFO[map.terrain[i]!]!.walkable && map.terrain[i] !== T.road) {
        map.struct[i] = S.stakes;
        if (this.inb(x, sy - 1)) map.zone[this.idx(x, sy - 1)]! |= Z.wallCover;
      }
    }
  }

  /** Clears a share of woods/marsh in a rectangle (deployment room). */
  thin(x0: number, y0: number, rw: number, rh: number, share: number): void {
    const { map, rng } = this;
    for (let y = y0; y < y0 + rh; y++)
      for (let x = x0; x < x0 + rw; x++) {
        if (!this.inb(x, y)) continue;
        const i = this.idx(x, y);
        if ((map.terrain[i] === T.woods || map.terrain[i] === T.marsh) && rng.chance(share)) map.terrain[i] = T.open;
      }
  }

  forest(): void {
    const { w, h, map, rng } = this;
    const roadX = Math.round(w / 2) + rng.int(-6, 6);
    this.verticalRoad(roadX, 0, h - 1, 1);
    // Clearings along the road.
    const clearings = 2 + rng.int(0, 2);
    for (let c = 0; c < clearings; c++) {
      const y = Math.round(h * ((c + 1) / (clearings + 1))) + rng.int(-3, 3);
      const x = (this.mainRoadX[Math.min(h - 1, Math.max(0, y))] ?? roadX) + rng.int(-8, 8);
      const r = 4 + rng.int(0, 4);
      for (let yy = y - r; yy <= y + r; yy++)
        for (let xx = x - r - 2; xx <= x + r + 2; xx++) {
          if (!this.inb(xx, yy)) continue;
          const dx = (xx - x) / (r + 2);
          const dy = (yy - y) / r;
          if (dx * dx + dy * dy <= 1) {
            const i = this.idx(xx, yy);
            if (map.terrain[i] === T.woods || map.terrain[i] === T.marsh) map.terrain[i] = T.open;
          }
        }
    }
    if (this.p.kind !== 'ambush') {
      this.thin(0, h - 14, w, 12, 0.5);
      this.thin(0, 3, w, 12, 0.4);
    }
    if (this.p.siteKind === 'shrine') {
      const region: MapRect = { x: 6, y: 4, w: w - 12, h: Math.round(h * 0.4) };
      const b = this.place('shrine', roadX, Math.round(h * 0.25), region, { tries: 300 });
      if (b) {
        map.objective = { kind: 'keep', x: b.doorX + 0.5, y: b.doorY + 0.5 };
        map.guards.push({ x: b.doorX + 0.5, y: b.doorY + 1.5, role: 'objective', facing: FACE_SOUTH });
      }
    }
  }

  riverCrossing(): void {
    const { w, h, map, rng } = this;
    // Bridge on the road, ford elsewhere.
    const roadX = Math.round(w * (0.3 + rng.float() * 0.4));
    let bridgeAt = roadX;
    this.verticalRoad(roadX, 0, h - 1, 2);
    bridgeAt = this.mainRoadX[Math.round(h / 2)] ?? roadX;
    const fordX = bridgeAt < w / 2 ? Math.round(w * 0.75) + rng.int(-4, 4) : Math.round(w * 0.25) + rng.int(-4, 4);
    this.crossRiverAt(fordX, true, 6, T.ford);
    // Defenders on the north bank, near the crossings.
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const i = this.idx(x, y);
        if (map.terrain[i] === T.water) {
          map.height[i] = 0;
        }
      }
    const bankY = this.riverNorthBank(bridgeAt) - 3;
    const fordBankY = this.riverNorthBank(fordX) - 3;
    map.guards.push({ x: bridgeAt + 1, y: bankY, role: 'line', facing: FACE_SOUTH });
    map.guards.push({ x: fordX + 0.5, y: fordBankY, role: 'line', facing: FACE_SOUTH });
    this.thin(0, h - 14, w, 12, 0.6);
  }

  riverNorthBank(x: number): number {
    for (let y = 0; y < this.h; y++) {
      const t = this.terrain(Math.min(this.w - 1, Math.max(0, x)), y);
      if (t === T.water || t === T.ford || t === T.bridge) return y;
    }
    return Math.round(this.h / 2);
  }

  beach(): void {
    const { w, rng } = this;
    const tpl = this.tpl;
    // Dunes behind the strand.
    for (let x = 0; x < w; x++) {
      const sy = this.shoreY[x]!;
      for (let y = Math.max(0, sy - 7); y < sy - 2; y++) {
        const i = this.idx(x, y);
        if ((x * 7 + y * 3) % 11 < 4) this.map.height[i] = Math.max(this.map.height[i]!, 1 + (rng.chance(0.3) ? 1 : 0));
        if (this.map.terrain[i] === T.woods && rng.chance(0.5)) this.map.terrain[i] = T.open;
      }
    }
    const roadX = Math.round(w / 2) + rng.int(-10, 10);
    this.verticalRoad(roadX, 0, this.shoreMin - 1, 1);
    const houses = rng.int(tpl.houses[0], tpl.houses[1]);
    this.farmstead(houses, roadX + (rng.chance(0.5) ? -9 : 9), Math.round(this.shoreMin * 0.45));
    if (tpl.storehouses[1] > 0 && houses > 0) {
      const region: MapRect = { x: 2, y: 2, w: w - 4, h: this.shoreMin - 6 };
      this.place('storehouse', roadX + 4, Math.round(this.shoreMin * 0.4), region);
    }
    if (tpl.extras.includes('boathouse')) this.place('boathouse', roadX - 12, this.shoreMin - 3, { x: 1, y: this.shoreMin - 8, w: w - 2, h: 7 }, { preferRoad: false });
    if (this.p.siteKind === 'wreck' || this.p.siteKind === 'seaStack') {
      const ox = Math.round(w * (rng.chance(0.5) ? 0.25 : 0.75));
      const oy = this.shoreY[ox]! - 1;
      if (this.p.siteKind === 'seaStack') {
        for (let y = oy - 3; y <= oy; y++) for (let x = ox - 2; x <= ox + 2; x++) if (this.inb(x, y) && (x - ox) * (x - ox) + (y - oy + 1.5) * (y - oy + 1.5) < 6) this.setT(x, y, T.rock);
        this.map.objective = { kind: 'cave', x: ox + 0.5, y: oy - 4.5 };
      } else {
        this.map.objective = { kind: 'cave', x: ox + 0.5, y: oy + 0.5 };
      }
      this.map.guards.push({ x: this.map.objective.x, y: this.map.objective.y - 3, role: 'objective', facing: FACE_SOUTH });
    }
    // Defenders hold the strand (beach landings) facing the sea.
    for (let k = -2; k <= 2; k++) {
      const x = Math.round(w / 2 + k * 9);
      const y = this.shoreY[Math.min(w - 1, Math.max(0, x))]! - 3;
      this.map.guards.push({ x: x + 0.5, y: y + 0.5, role: 'line', facing: FACE_SOUTH });
    }
  }

  caveMouth(): void {
    const { w, h, map, rng } = this;
    const barrow = this.p.siteKind === 'barrow';
    if (!barrow) {
      // Rock walls on both sides of a valley that narrows toward the cave at the top.
      const edge = noiseField(h, 2, 6, 2, `${this.p.seed}|cliff`);
      for (let y = 0; y < h; y++) {
        const t = y / h;
        const half = 9 + t * 14;
        const left = Math.round(w / 2 - half + (edge[y]! - 0.5) * 8);
        const right = Math.round(w / 2 + half + (edge[h + y]! - 0.5) * 8);
        for (let x = 0; x < w; x++) {
          if (x < left || x > right) {
            const i = this.idx(x, y);
            map.terrain[i] = T.rock;
            map.height[i] = 3;
          }
        }
      }
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < w; x++) {
          if (Math.abs(x - w / 2) <= 2 && y >= 2) continue;
          map.terrain[this.idx(x, y)] = T.rock;
          map.height[this.idx(x, y)] = 3;
        }
      for (let y = 2; y < 8; y++)
        for (let x = Math.round(w / 2) - 2; x <= Math.round(w / 2) + 2; x++) {
          map.terrain[this.idx(x, y)] = T.floor;
          map.height[this.idx(x, y)] = 1;
        }
      map.objective = { kind: 'cave', x: w / 2, y: 4.5 };
      for (let x = Math.round(w / 2) - 2; x <= Math.round(w / 2) + 2; x++) map.zone[this.idx(x, 2)]! |= Z.extractD;
    } else {
      // A barrow mound at the north with its entrance facing south.
      const mx = Math.round(w / 2) + rng.int(-4, 4);
      const my = 10;
      for (let y = my - 7; y <= my + 7; y++)
        for (let x = mx - 9; x <= mx + 9; x++) {
          if (!this.inb(x, y)) continue;
          const dx = (x - mx) / 9;
          const dy = (y - my) / 7;
          const d = dx * dx + dy * dy;
          if (d <= 1) {
            const i = this.idx(x, y);
            map.height[i] = d < 0.25 ? 3 : d < 0.6 ? 2 : 1;
            map.terrain[i] = T.open;
            if (d < 0.35) {
              map.terrain[i] = T.rock;
            }
          }
        }
      map.objective = { kind: 'barrow', x: mx + 0.5, y: my + 3.5 };
      for (let y = my + 2; y <= my + 5; y++) for (let x = mx - 1; x <= mx + 1; x++) if (this.inb(x, y)) map.terrain[this.idx(x, y)] = T.floor;
    }
    this.thin(0, h - 12, w, 10, 0.7);
    map.guards.push({ x: map.objective.x, y: map.objective.y + 4, role: 'objective', facing: FACE_SOUTH });
    map.guards.push({ x: map.objective.x - 6, y: map.objective.y + 8, role: 'line', facing: FACE_SOUTH });
    map.guards.push({ x: map.objective.x + 6, y: map.objective.y + 8, role: 'line', facing: FACE_SOUTH });
  }

  // ---------------------------------------------------------------------------------------------
  // Zones and posts

  zones(): void {
    const { w, h, map } = this;
    const ambush = this.p.kind === 'ambush';
    map.attackFrom = ambush ? 'sides' : 'south';
    // Defender extraction: the north edge (unless the template set its own, e.g. the cave mouth).
    let hasExtractD = false;
    for (let i = 0; i < w * h; i++) if ((map.zone[i]! & Z.extractD) !== 0) hasExtractD = true;
    if (!hasExtractD) {
      for (let x = 0; x < w; x++)
        for (let y = 0; y < 2; y++) {
          const i = this.idx(x, y);
          if (TERRAIN_INFO[map.terrain[i]!]!.walkable) map.zone[i]! |= Z.extractD;
        }
      if (ambush) {
        for (let x = 0; x < w; x++)
          for (let y = h - 2; y < h; y++) {
            const i = this.idx(x, y);
            map.zone[i]! &= ~Z.extractA;
            if (TERRAIN_INFO[map.terrain[i]!]!.walkable) map.zone[i]! |= Z.extractD;
          }
      }
    }
    if (ambush) {
      for (let y = 0; y < h; y++)
        for (const x of [0, 1, w - 2, w - 1]) {
          const i = this.idx(x, y);
          if (TERRAIN_INFO[map.terrain[i]!]!.walkable) map.zone[i]! |= Z.extractA;
        }
    }
    // Attacker deployment posts.
    const postsA: GuardPost[] = [];
    if (ambush) {
      for (let k = 0; k < 10; k++) {
        const y = Math.round(h * 0.3 + (k >> 1) * (h * 0.4 / 5));
        const rx = this.mainRoadX[Math.min(h - 1, y)] ?? Math.round(w / 2);
        const side = k % 2 === 0 ? -1 : 1;
        const x = (rx >= 0 ? rx : Math.round(w / 2)) + side * (6 + (k % 3));
        postsA.push({ x: x + 0.5, y: y + 0.5, role: 'line', facing: side < 0 ? 0 : Math.PI });
      }
    } else if (map.ships.length > 0) {
      for (const r of map.ships) {
        const sx = r.x + Math.floor(r.w / 2);
        postsA.push({ x: sx + 0.5, y: this.shoreY[Math.min(w - 1, sx)]! - 2.5, role: 'line', facing: FACE_NORTH });
      }
      const mid = Math.round(w / 2);
      for (let k = 1; k <= 4; k++)
        for (const sgn of [-1, 1]) {
          const x = mid + sgn * (k * 7 + 3);
          if (x < 3 || x > w - 4) continue;
          postsA.push({ x: x + 0.5, y: this.shoreY[x]! - 3.5, role: 'line', facing: FACE_NORTH });
        }
    } else {
      const mid = Math.round(w / 2);
      const y = h - 5.5;
      postsA.push({ x: mid + 0.5, y, role: 'line', facing: FACE_NORTH });
      for (let k = 1; k <= 5; k++) for (const sgn of [-1, 1]) postsA.push({ x: mid + sgn * k * 8 + 0.5, y: y - (k % 2) * 4, role: 'line', facing: FACE_NORTH });
    }
    map.deploy[0] = postsA.filter((p) => p.x > 1 && p.x < w - 1 && p.y > 1 && p.y < h - 1);
    // Defender deployment: the guard plan, then a line across the north band.
    const postsD: GuardPost[] = [];
    if (ambush) {
      for (let k = 0; k < 10; k++) {
        const y = Math.round(h * 0.32 + k * (h * 0.36 / 10));
        const rx = this.mainRoadX[Math.min(h - 1, y)] ?? Math.round(w / 2);
        postsD.push({ x: (rx >= 0 ? rx : w / 2) + 0.5, y: y + 0.5, role: 'line', facing: FACE_SOUTH });
      }
    } else {
      const mid = Math.round(w / 2);
      const y = this.p.template === 'caveMouth' ? Math.min(h - 10, map.objective.y + 10) : Math.round(h * 0.2);
      postsD.push({ x: mid + 0.5, y: y + 0.5, role: 'line', facing: FACE_SOUTH });
      for (let k = 1; k <= 5; k++) for (const sgn of [-1, 1]) postsD.push({ x: mid + sgn * k * 8 + 0.5, y: y + 0.5 + (k % 2) * 3, role: 'line', facing: FACE_SOUTH });
    }
    map.deploy[1] = postsD.filter((p) => p.x > 1 && p.x < w - 1 && p.y > 1 && p.y < h - 1);
    for (const p of map.deploy[0]) this.markZone(p.x, p.y, 3, Z.deployA);
    for (const p of map.deploy[1]) this.markZone(p.x, p.y, 3, Z.deployD);
    for (const g of map.guards) this.markZone(g.x, g.y, 2, Z.deployD);
    if (ambush || this.p.kind === 'guardian') {
      for (const p of ambush ? map.deploy[0] : map.guards) this.markZone(p.x, p.y, 3, Z.ambush);
    }
    if (map.waveSpawns.length === 0) map.waveSpawns.push({ x: Math.round(w / 2) + 0.5, y: 2.5, role: 'reserve', facing: FACE_SOUTH });
  }

  markZone(px: number, py: number, r: number, bit: number): void {
    const { map } = this;
    const x0 = Math.floor(px - r);
    const y0 = Math.floor(py - r);
    for (let y = y0; y <= Math.floor(py + r); y++)
      for (let x = x0; x <= Math.floor(px + r); x++) if (this.inb(x, y)) map.zone[this.idx(x, y)]! |= bit;
  }

  // ---------------------------------------------------------------------------------------------
  // Connectivity repair

  /** Moves posts that landed on blocked tiles to the nearest walkable tile; drops posts deep in rock. */
  fixPosts(): void {
    const fix = (p: GuardPost): boolean => {
      const t = this.nearestWalkable(Math.floor(p.x), Math.floor(p.y), 8);
      if (t < 0) return false;
      const x = t % this.w;
      const y = (t - x) / this.w;
      if (x !== Math.floor(p.x) || y !== Math.floor(p.y)) {
        p.x = x + 0.5;
        p.y = y + 0.5;
      }
      return true;
    };
    const m = this.map;
    m.deploy[0] = m.deploy[0].filter(fix);
    m.deploy[1] = m.deploy[1].filter(fix);
    m.guards = m.guards.filter(fix);
    m.waveSpawns = m.waveSpawns.filter(fix);
  }

  nearestWalkable(x: number, y: number, maxR: number): number {
    for (let r = 0; r <= maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.free(x + dx, y + dy)) return this.idx(x + dx, y + dy);
        }
    return -1;
  }

  /**
   * Makes every door, post, extraction zone and the objective reachable from the attackers'
   * deployment (gates count as open): unreachable targets get a carved track (water → ford,
   * rock → floor) along the cheapest route that does not cut through structures.
   */
  repair(): void {
    const { w, h, map } = this;
    const n = w * h;
    const pg = new PathGrid(w, h);
    const walkCost = new Float32Array(n);
    const carveCost = new Float32Array(n);
    const refresh = () => {
      for (let i = 0; i < n; i++) {
        const s = map.struct[i]!;
        const passStruct = s === S.none || s === S.tower || s === S.gate;
        walkCost[i] = passStruct && TERRAIN_INFO[map.terrain[i]!]!.walkable ? 1 : Infinity;
        const t = map.terrain[i]!;
        carveCost[i] = !passStruct ? Infinity : t === T.water ? (i >= this.idx(0, Math.max(0, this.shoreMin)) && this.shoreMin < h ? Infinity : 6) : t === T.rock ? 10 : 1;
      }
    };
    refresh();
    const starts = map.deploy[0].map((p) => this.idx(Math.floor(p.x), Math.floor(p.y))).filter((i) => Number.isFinite(walkCost[i]!));
    if (starts.length === 0) return;
    const field = new Float32Array(n);
    const targets: number[] = [];
    for (const b of map.buildings) targets.push(this.idx(b.doorX, b.doorY));
    for (const list of [map.deploy[1], map.guards, map.waveSpawns]) for (const p of list) targets.push(this.idx(Math.floor(p.x), Math.floor(p.y)));
    if (map.objective.kind !== 'none') {
      const t = this.nearestWalkable(Math.floor(map.objective.x), Math.floor(map.objective.y), 6);
      if (t >= 0) targets.push(t);
    }
    // One tile of each extraction zone.
    for (const bit of [Z.extractA, Z.extractD]) {
      let pick = -1;
      for (let i = 0; i < n && pick < 0; i++) if ((map.zone[i]! & bit) !== 0 && Number.isFinite(walkCost[i]!)) pick = i;
      if (pick >= 0) targets.push(pick);
    }
    const path: number[] = [];
    for (let pass = 0; pass < 3; pass++) {
      pg.field(walkCost, starts, field);
      let carved = false;
      for (const t of targets) {
        if (Number.isFinite(field[t]!)) continue;
        const status = pg.findPath(carveCost, starts[0]!, t, path, 1);
        if (status !== 1) continue;
        for (const i of path) {
          const tt = map.terrain[i]!;
          if (tt === T.water) map.terrain[i] = T.ford;
          else if (tt === T.rock) map.terrain[i] = T.floor;
        }
        carved = true;
      }
      if (!carved) break;
      refresh();
    }
    // Posts the repair could not connect (pockets between walls and houses) are dropped.
    pg.field(walkCost, starts, field);
    const ok = (p: GuardPost) => Number.isFinite(field[this.idx(Math.floor(p.x), Math.floor(p.y))]!);
    map.deploy[1] = map.deploy[1].filter(ok);
    map.guards = map.guards.filter(ok);
    map.waveSpawns = map.waveSpawns.filter(ok);
  }
}

/** Generates the battle map for a place. Deterministic in `params` and the content. */
export function generateBattleMap(params: MapGenParams, data: BattleData): BattleMap {
  const tpl = data.t.templates[params.template];
  const [w, h] = tpl.size ?? data.b.mapTiles;
  const map = createGrid(w, h, params.template, params.style, params.seed);
  const rng = new Rng(`${params.seed}|map|${params.template}`);
  const g = new Gen(map, rng, params, data);
  g.baseTerrain();
  const coastal = tpl.coastal && params.coastal;
  if (coastal) g.coast(params.template === 'beach' ? 6 : 3);
  else g.landEdge();
  if (params.template === 'riverCrossing') g.river(true);
  else if (tpl.river > 0 && rng.chance(tpl.river) && params.template !== 'caveMouth') g.river(false);
  if (tpl.core[0] > 0 && tpl.core[1] > 0) g.settlement();
  switch (params.template) {
    case 'field':
      g.field();
      break;
    case 'forest':
      g.forest();
      break;
    case 'riverCrossing':
      g.riverCrossing();
      break;
    case 'beach':
      g.beach();
      break;
    case 'caveMouth':
      g.caveMouth();
      break;
    default:
      break;
  }
  g.zones();
  g.fixPosts();
  g.repair();
  return map;
}

/** Guard posts of one role. */
export function postsOf(map: BattleMap, role: GuardRole): GuardPost[] {
  return map.guards.filter((p) => p.role === role);
}
