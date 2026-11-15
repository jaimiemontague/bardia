/**
 * Grid floods used by the map build: multi-source geodesic labelling with integer chamfer weights (5 orthogonal,
 * 7 diagonal; Dial's bucket queue, O(cells)), 4-connected component labelling, and a typed-array binary min-heap
 * for A*. Diagonal steps never cut corners: both orthogonal neighbours must be passable (the same rule ships use).
 */

/** Chamfer weights: a diagonal step costs 7/5 ≈ 1.4 orthogonal steps. */
export const CHAMFER_ORTHO = 5;
export const CHAMFER_DIAG = 7;

/** An extra edge between two cells (portages); `cost` in chamfer units (rounded to an integer ≥ 1). */
export interface FloodLink {
  a: number;
  b: number;
  cost: number;
  /** Recorded in `viaLink` for cells reached through this link (e.g. the portage index). */
  tag: number;
}

export interface GeodesicResult {
  /** Label of the nearest source (−1: unreached or impassable). */
  label: Int32Array;
  /** Chamfer distance to that source (−1: unreached). */
  dist: Int32Array;
  /** Cell the flood arrived from (−1 for sources and unreached cells). */
  from: Int32Array;
  /** Link tag used to arrive (−1 if the last step was a grid step). */
  viaLink: Int32Array;
}

/**
 * Multi-source geodesic flood over `passable` cells (non-zero = passable). Sources are processed in the order
 * given; ties keep the first label to arrive, so results are deterministic. `links` add symmetric extra edges.
 * `maxDist` (chamfer units) stops the flood early.
 */
export function geodesicFlood(
  width: number,
  height: number,
  passable: Uint8Array,
  sources: readonly number[],
  sourceLabels: readonly number[],
  links: readonly FloodLink[] = [],
  maxDist = 0x3fffffff,
): GeodesicResult {
  const size = width * height;
  const label = new Int32Array(size).fill(-1);
  const dist = new Int32Array(size).fill(-1);
  const from = new Int32Array(size).fill(-1);
  const viaLink = new Int32Array(size).fill(-1);
  // Link lookup: linkHead[cell] = first index in linkList, chained by linkNext.
  let linkHead: Int32Array | undefined;
  const linkOther: number[] = [];
  const linkCost: number[] = [];
  const linkTag: number[] = [];
  const linkNext: number[] = [];
  if (links.length > 0) {
    linkHead = new Int32Array(size).fill(-1);
    const add = (cell: number, other: number, cost: number, tag: number): void => {
      linkOther.push(other);
      linkCost.push(cost);
      linkTag.push(tag);
      linkNext.push((linkHead as Int32Array)[cell] as number);
      (linkHead as Int32Array)[cell] = linkOther.length - 1;
    };
    for (const l of links) {
      const w = Math.max(1, Math.round(l.cost));
      add(l.a, l.b, w, l.tag);
      add(l.b, l.a, w, l.tag);
    }
  }
  // Dial's algorithm. Bucket count must exceed the largest edge weight.
  let maxEdge = CHAMFER_DIAG;
  for (const w of linkCost) if (w > maxEdge) maxEdge = w;
  const nb = maxEdge + 1;
  const buckets: number[][] = [];
  for (let i = 0; i < nb; i++) buckets.push([]);
  let pending = 0;
  for (let s = 0; s < sources.length; s++) {
    const cell = sources[s] as number;
    if (cell < 0 || cell >= size || passable[cell] === 0 || dist[cell] === 0) continue;
    dist[cell] = 0;
    label[cell] = sourceLabels[s] as number;
    (buckets[0] as number[]).push(cell);
    pending++;
  }
  let cur = 0;
  let bi = 0;
  let c = 0;
  let lab = 0;
  const relax = (n: number, w: number, link: number): void => {
    const nd = cur + w;
    const od = dist[n] as number;
    if (od === -1 || nd < od) {
      dist[n] = nd;
      label[n] = lab;
      from[n] = c;
      viaLink[n] = link;
      (buckets[(bi + w) % nb] as number[]).push(n);
      pending++;
    }
  };
  let spare: number[] = [];
  while (pending > 0) {
    const items = buckets[bi] as number[];
    if (items.length === 0) {
      cur++;
      bi = bi + 1 === nb ? 0 : bi + 1;
      if (cur > maxDist) break;
      continue;
    }
    // Swap in an empty bucket; FIFO order within a bucket keeps source order for ties.
    buckets[bi] = spare;
    pending -= items.length;
    for (let k = 0; k < items.length; k++) {
      c = items[k] as number;
      if (dist[c] !== cur) continue;
      const x = c % width;
      const y = (c - x) / width;
      lab = label[c] as number;
      const left = x > 0 && passable[c - 1] !== 0;
      const right = x < width - 1 && passable[c + 1] !== 0;
      const up = y > 0 && passable[c - width] !== 0;
      const down = y < height - 1 && passable[c + width] !== 0;
      if (right) relax(c + 1, CHAMFER_ORTHO, -1);
      if (down) relax(c + width, CHAMFER_ORTHO, -1);
      if (left) relax(c - 1, CHAMFER_ORTHO, -1);
      if (up) relax(c - width, CHAMFER_ORTHO, -1);
      if (right && down && passable[c + width + 1] !== 0) relax(c + width + 1, CHAMFER_DIAG, -1);
      if (left && down && passable[c + width - 1] !== 0) relax(c + width - 1, CHAMFER_DIAG, -1);
      if (left && up && passable[c - width - 1] !== 0) relax(c - width - 1, CHAMFER_DIAG, -1);
      if (right && up && passable[c - width + 1] !== 0) relax(c - width + 1, CHAMFER_DIAG, -1);
      if (linkHead !== undefined) {
        for (let li = linkHead[c] as number; li !== -1; li = linkNext[li] as number) {
          const n = linkOther[li] as number;
          if (passable[n] !== 0) relax(n, linkCost[li] as number, linkTag[li] as number);
        }
      }
    }
    items.length = 0;
    spare = items;
  }
  return { label, dist, from, viaLink };
}

/**
 * 4-connected component labelling of cells where `member(i)` is true. Returns per-cell component ids (−1 for
 * non-members) numbered in scan order, plus each component's size.
 */
export function components4(width: number, height: number, member: (i: number) => boolean): { id: Int32Array; sizes: number[] } {
  const size = width * height;
  const id = new Int32Array(size).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(size);
  for (let start = 0; start < size; start++) {
    if (id[start] !== -1 || !member(start)) continue;
    const comp = sizes.length;
    let sp = 0;
    let count = 0;
    stack[sp++] = start;
    id[start] = comp;
    while (sp > 0) {
      const c = stack[--sp] as number;
      count++;
      const x = c % width;
      if (x > 0 && id[c - 1] === -1 && member(c - 1)) {
        id[c - 1] = comp;
        stack[sp++] = c - 1;
      }
      if (x < width - 1 && id[c + 1] === -1 && member(c + 1)) {
        id[c + 1] = comp;
        stack[sp++] = c + 1;
      }
      if (c >= width && id[c - width] === -1 && member(c - width)) {
        id[c - width] = comp;
        stack[sp++] = c - width;
      }
      if (c + width < size && id[c + width] === -1 && member(c + width)) {
        id[c + width] = comp;
        stack[sp++] = c + width;
      }
    }
    sizes.push(count);
  }
  return { id, sizes };
}

/** Binary min-heap of (key, cell) pairs on typed arrays; grows as needed. Ties pop in insertion-independent but deterministic order. */
export class CellHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity = 4096) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    const keys = this.keys;
    const vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p] as number;
      if (pk < key || (pk === key && (vals[p] as number) <= val)) break;
      keys[i] = pk;
      vals[i] = vals[p] as number;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Smallest key (only valid when size > 0). */
  peekKey(): number {
    return this.keys[0] as number;
  }

  /** Removes and returns the cell with the smallest key (ties: smaller cell first). */
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0] as number;
    const n = --this.size;
    if (n > 0) {
      const key = keys[n] as number;
      const val = vals[n] as number;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        let m = l;
        if (r < n) {
          const lk = keys[l] as number;
          const rk = keys[r] as number;
          if (rk < lk || (rk === lk && (vals[r] as number) < (vals[l] as number))) m = r;
        }
        const mk = keys[m] as number;
        if (mk > key || (mk === key && (vals[m] as number) >= val)) break;
        keys[i] = mk;
        vals[i] = vals[m] as number;
        i = m;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
