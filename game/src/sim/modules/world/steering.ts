/**
 * Steering and landfall by touch (owner play-test 2026-11-14; ARCHITECTURE §20.8 "the player steers"). Pure helpers
 * used by movement.ts:
 *
 *   - the eight compass headings and their unit vectors (y grows southward);
 *   - `steerMove`: moves a position along a heading in sub-steps over passable cells only. A step blocked by the
 *     coast (or the shore, for a war-band) slides along it when a neighbouring heading within 45° is open, else the
 *     mover stops there. A diagonal step never cuts between two blocked cells;
 *   - the touch index: settlement harbours bucketed on a coarse grid, so the few movers that can touch a place
 *     (the player's expedition fleet, steered war-bands) find nearby harbours without scanning the settlement table.
 */
import { baseState } from '@sim/core/context';
import type { GameState, MapPos, SettlementId } from '@sim/core/state';
import { plain } from './knowledge';
import type { StaticWorld } from './map';
import type { SteerDir } from './types';

/** Headings clockwise from north. */
export const STEER_DIRS: readonly SteerDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const D = Math.SQRT1_2;
/** Unit vectors per heading index (STEER_DIRS order). */
const UNIT: readonly (readonly [number, number])[] = [
  [0, -1],
  [D, -D],
  [1, 0],
  [D, D],
  [0, 1],
  [-D, D],
  [-1, 0],
  [-D, -D],
];

/** Index of a heading in STEER_DIRS (−1 for anything else). */
export function steerIndex(dir: string): number {
  return STEER_DIRS.indexOf(dir as SteerDir);
}

/** Unit vector of a heading. */
export function steerVector(dir: SteerDir): readonly [number, number] {
  return UNIT[steerIndex(dir)] as readonly [number, number];
}

/** Compass bearing (0 = north, 90 = east) of a heading. */
export function steerBearing(dir: SteerDir): number {
  return steerIndex(dir) * 45;
}

function cellOf(sw: StaticWorld, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x < sw.width && y < sw.height)) return -1;
  return Math.floor(y) * sw.width + Math.floor(x);
}

/** Can a mover step from (x, y) to (nx, ny)? The target cell must pass; a diagonal cell change may not cut a corner. */
function canStep(sw: StaticWorld, pass: (c: number) => boolean, x: number, y: number, nx: number, ny: number): boolean {
  const to = cellOf(sw, nx, ny);
  if (to < 0 || !pass(to)) return false;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = Math.floor(nx);
  const ty = Math.floor(ny);
  if (fx !== tx && fy !== ty) {
    const a = cellOf(sw, nx, y);
    const b = cellOf(sw, x, ny);
    if (!(a >= 0 && pass(a)) && !(b >= 0 && pass(b))) return false;
  }
  return true;
}

/** Result of a steered move. */
export interface SteerMove {
  pos: MapPos;
  /** Cells actually travelled. */
  moved: number;
  /** The way ahead (and both slides) is closed: the mover stopped before using all its distance. */
  blocked: boolean;
  /** Heading of the last sub-step (the commanded one, or a slide). */
  lastDir: number;
}

/**
 * Moves `pos` along heading `dir` (index into STEER_DIRS) by up to `dist` cells over cells that `pass`, in sub-steps of
 * at most `subStep` cells. A blocked sub-step tries the two headings 45° either side (the one with open water a
 * cell further first, clockwise on a tie) and otherwise stops. Deterministic; positions rounded to 1/1000 cell.
 */
export function steerMove(sw: StaticWorld, pos: MapPos, dir: number, dist: number, pass: (c: number) => boolean, subStep: number): SteerMove {
  let x = pos.x;
  let y = pos.y;
  let left = Math.max(0, dist);
  let moved = 0;
  let blocked = false;
  let lastDir = dir;
  const cw = (dir + 1) % 8;
  const ccw = (dir + 7) % 8;
  while (left > 1e-9) {
    const s = Math.min(subStep, left);
    let stepped = false;
    const order = [dir];
    const ahead = (d: number): boolean => {
      const [vx, vy] = UNIT[d] as readonly [number, number];
      return canStep(sw, pass, x, y, x + vx * s, y + vy * s);
    };
    if (!ahead(dir)) {
      const further = (d: number): boolean => {
        const [vx, vy] = UNIT[d] as readonly [number, number];
        const c = cellOf(sw, x + vx * (s + 1), y + vy * (s + 1));
        return c >= 0 && pass(c);
      };
      const a = ahead(cw);
      const b = ahead(ccw);
      if (a && b) order.push(...(further(ccw) && !further(cw) ? [ccw, cw] : [cw, ccw]));
      else if (a) order.push(cw);
      else if (b) order.push(ccw);
    }
    for (const d of order) {
      if (!ahead(d)) continue;
      const [vx, vy] = UNIT[d] as readonly [number, number];
      x += vx * s;
      y += vy * s;
      lastDir = d;
      stepped = true;
      break;
    }
    if (!stepped) {
      blocked = true;
      break;
    }
    left -= s;
    moved += s;
  }
  return { pos: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }, moved, blocked, lastDir };
}

// ---------------------------------------------------------------------------------------------
// The touch index.

/** A place a mover can touch. */
export interface TouchPlace {
  settlementId: SettlementId;
  /** Where a fleet touches it: the harbour cell's centre, or the settlement's own cell when it has no harbour. */
  sea: MapPos | null;
  /** The harbour is the settlement's own cell (a port-less coastal settlement): a fleet touches it from alongside. */
  portless: boolean;
  /** Where a war-band touches it: the settlement's cell centre. */
  land: MapPos;
}

const BUCKET = 8;

interface TouchIndex {
  src: unknown;
  count: number;
  width: number;
  bw: number;
  bh: number;
  places: TouchPlace[];
  buckets: number[][];
}

let touchCache: TouchIndex | undefined;

/**
 * The bucketed touch index for a state (rebuilt when the world index object changes or grows; derived purely from
 * state, so replays see the same places).
 */
export function touchIndex(draft: GameState, sw: StaticWorld): TouchIndex | undefined {
  const idx = draft.worldIndex;
  if (!idx) return undefined;
  const src = baseState(idx.settlements);
  const count = Reflect.ownKeys(idx.settlements).length;
  if (touchCache && touchCache.src === src && touchCache.count === count && touchCache.width === sw.width) return touchCache;
  const geo = plain(idx.settlements);
  const settlements = plain(draft.settlements);
  const bw = Math.ceil(sw.width / BUCKET);
  const bh = Math.ceil(sw.height / BUCKET);
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  const places: TouchPlace[] = [];
  const centre = (cell: number): MapPos => ({ x: (cell % sw.width) + 0.5, y: Math.floor(cell / sw.width) + 0.5 });
  for (const id of Object.keys(geo) as SettlementId[]) {
    const g = geo[id];
    const s = Object.hasOwn(settlements, id) ? settlements[id] : undefined;
    if (!g || !s) continue;
    const land = g.cell >= 0 ? centre(g.cell) : { x: s.mapPos.x, y: s.mapPos.y };
    let sea: MapPos | null = null;
    let portless = false;
    if (g.port >= 0) sea = centre(g.port);
    else if (s.coastal) {
      sea = land;
      portless = true;
    }
    const i = places.length;
    places.push({ settlementId: id, sea, portless, land });
    for (const p of sea && (sea.x !== land.x || sea.y !== land.y) ? [sea, land] : [land]) {
      const b = Math.min(bh - 1, Math.max(0, Math.floor(p.y / BUCKET))) * bw + Math.min(bw - 1, Math.max(0, Math.floor(p.x / BUCKET)));
      const list = buckets[b] as number[];
      if (!list.includes(i)) list.push(i);
    }
  }
  touchCache = { src, count, width: sw.width, bw, bh, places, buckets };
  return touchCache;
}

/** Places whose sea (fleets) or land (war-bands) touch point lies within `radius` of `pos`, nearest first. */
export function placesNear(index: TouchIndex, pos: MapPos, radius: number, kind: 'fleet' | 'army'): { place: TouchPlace; d2: number }[] {
  const out: { place: TouchPlace; d2: number }[] = [];
  const reach = radius + 0.5;
  const x0 = Math.max(0, Math.floor((pos.x - reach) / BUCKET));
  const x1 = Math.min(index.bw - 1, Math.floor((pos.x + reach) / BUCKET));
  const y0 = Math.max(0, Math.floor((pos.y - reach) / BUCKET));
  const y1 = Math.min(index.bh - 1, Math.floor((pos.y + reach) / BUCKET));
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      for (const i of index.buckets[by * index.bw + bx] ?? []) {
        const place = index.places[i] as TouchPlace;
        const p = kind === 'fleet' ? place.sea : place.land;
        if (!p) continue;
        // A port-less settlement is touched from alongside its coast (the fleet cannot enter its land cell).
        const r = kind === 'fleet' && place.portless ? radius + 0.5 : radius;
        const d2 = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2;
        if (d2 <= r * r && !out.some((o) => o.place === place)) out.push({ place, d2 });
      }
    }
  }
  out.sort((a, b) => a.d2 - b.d2 || (a.place.settlementId < b.place.settlementId ? -1 : 1));
  return out;
}
