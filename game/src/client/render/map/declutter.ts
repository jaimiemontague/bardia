/**
 * Label declutter (pure): places as many labels as fit without overlapping, highest priority first. Each label may
 * try several placements around its anchor (right of a settlement icon, then left, above, below); icons are fixed
 * obstacles (a label never covers another settlement's icon, but may sit beside its own). A small priority bonus
 * for labels shown last time (hysteresis) keeps labels from flickering while panning and zooming.
 */

export type LabelPlacement = 'center' | 'right' | 'left' | 'above' | 'below';

export interface LabelCandidate {
  id: string;
  /** Anchor in screen pixels (an icon centre, or the label centre for 'center'). */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  /** Placements to try, in order (default ['center']). */
  placements?: readonly LabelPlacement[];
  /** Gap between the anchor and the label for non-centre placements (px). */
  offset?: number;
}

/** A screen rectangle that labels must avoid; `owner` is a label id that may overlap it (its own icon). */
export interface Obstacle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  owner?: string;
}

export interface PlacedLabel {
  id: string;
  placement: LabelPlacement;
  /** Top-left corner (px). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeclutterOptions {
  /** Extra spacing around each label (px). */
  padding?: number;
  /** Spatial-hash bucket size (px). */
  bucket?: number;
  /** Labels placed in the previous pass (they get `stickiness` extra priority). */
  previous?: ReadonlySet<string>;
  stickiness?: number;
  /** How far outside the viewport a label's centre may be and still be placed (px). */
  overscan?: number;
}

/** The label rectangle (top-left) for a placement. */
export function placementRect(c: LabelCandidate, p: LabelPlacement): { x: number; y: number } {
  const off = c.offset ?? 0;
  switch (p) {
    case 'right':
      return { x: c.x + off, y: c.y - c.height / 2 };
    case 'left':
      return { x: c.x - off - c.width, y: c.y - c.height / 2 };
    case 'above':
      return { x: c.x - c.width / 2, y: c.y - off - c.height };
    case 'below':
      return { x: c.x - c.width / 2, y: c.y + off };
    default:
      return { x: c.x - c.width / 2, y: c.y - c.height / 2 };
  }
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  owner?: string;
}

class SpatialHash {
  private readonly buckets = new Map<number, Rect[]>();
  constructor(private readonly size: number) {}

  private key(bx: number, by: number): number {
    return (by + 4096) * 16384 + (bx + 4096);
  }

  add(r: Rect): void {
    const s = this.size;
    for (let by = Math.floor(r.y0 / s); by <= Math.floor(r.y1 / s); by++) {
      for (let bx = Math.floor(r.x0 / s); bx <= Math.floor(r.x1 / s); bx++) {
        const k = this.key(bx, by);
        const list = this.buckets.get(k);
        if (list) list.push(r);
        else this.buckets.set(k, [r]);
      }
    }
  }

  hits(r: Rect, ignoreOwner: string): boolean {
    const s = this.size;
    for (let by = Math.floor(r.y0 / s); by <= Math.floor(r.y1 / s); by++) {
      for (let bx = Math.floor(r.x0 / s); bx <= Math.floor(r.x1 / s); bx++) {
        const list = this.buckets.get(this.key(bx, by));
        if (!list) continue;
        for (const o of list) {
          if (o.owner !== undefined && o.owner === ignoreOwner) continue;
          if (o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Places labels greedily by priority (ties broken by id, so the result is deterministic). Returns the placed
 * labels in placement order.
 */
export function declutterLabels(candidates: readonly LabelCandidate[], view: { width: number; height: number }, obstacles: readonly Obstacle[] = [], opts: DeclutterOptions = {}): PlacedLabel[] {
  const pad = opts.padding ?? 2;
  const overscan = opts.overscan ?? 0;
  const sticky = opts.stickiness ?? 0.5;
  const prev = opts.previous;
  const hash = new SpatialHash(Math.max(8, opts.bucket ?? 64));
  for (const o of obstacles) hash.add(o);

  const order = candidates
    .map((c) => ({ c, p: c.priority + (prev?.has(c.id) ? sticky : 0) }))
    .sort((a, b) => b.p - a.p || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));

  const placed: PlacedLabel[] = [];
  for (const { c } of order) {
    if (!(c.width > 0) || !(c.height > 0)) continue;
    for (const p of c.placements ?? ['center']) {
      const { x, y } = placementRect(c, p);
      const cx = x + c.width / 2;
      const cy = y + c.height / 2;
      if (cx < -overscan || cy < -overscan || cx > view.width + overscan || cy > view.height + overscan) continue;
      const rect: Rect = { x0: x - pad, y0: y - pad, x1: x + c.width + pad, y1: y + c.height + pad };
      if (hash.hits(rect, c.id)) continue;
      hash.add(rect);
      placed.push({ id: c.id, placement: p, x, y, width: c.width, height: c.height });
      break;
    }
  }
  return placed;
}

/** Rough width of a label in pixels for a font size (used before the real text metrics are known). */
export function estimateTextWidth(text: string, fontSize: number, letterSpacing = 0, widthFactor = 0.52): number {
  return text.length * (fontSize * widthFactor + letterSpacing);
}
