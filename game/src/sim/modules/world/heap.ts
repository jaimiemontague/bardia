/**
 * A binary min-heap of (key, value) pairs with typed-array storage, for the world module's Dijkstra passes.
 * Equal keys pop the smaller value first, so results never depend on insertion order.
 */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(Math.max(4, capacity));
    this.vals = new Int32Array(Math.max(4, capacity));
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

  /** Smallest key (size must be > 0). */
  peekKey(): number {
    return this.keys[0] as number;
  }

  /** Removes and returns the value with the smallest key (size must be > 0). */
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
        let c = l;
        if (r < n) {
          const lk = keys[l] as number;
          const rk = keys[r] as number;
          if (rk < lk || (rk === lk && (vals[r] as number) < (vals[l] as number))) c = r;
        }
        const ck = keys[c] as number;
        if (ck > key || (ck === key && (vals[c] as number) >= val)) break;
        keys[i] = ck;
        vals[i] = vals[c] as number;
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
