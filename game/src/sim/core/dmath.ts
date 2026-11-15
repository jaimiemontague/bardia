/**
 * Deterministic transcendental math (design §29.3 "dmath").
 *
 * JS engines may implement Math.exp/log/pow/sin/cos/atan2/tanh with different last-bit results,
 * which would desynchronise replays across browsers. These versions use only IEEE-754 basic
 * operations (+ − × ÷, Math.sqrt, Math.floor, Math.abs — all correctly rounded and therefore
 * bit-identical everywhere) plus exact power-of-two scaling via DataView.
 *
 * Accuracy target: within 1e-9 relative (or absolute near zero) of Math.*; in practice ~1e-15.
 * Domain notes: dsin/dcos use a Cody–Waite reduction for |x| < 2^19 and an exact Payne–Hanek
 * reduction (BigInt arithmetic, also bit-identical everywhere) beyond, so they are accurate over the
 * whole double range. dpow follows the ECMAScript special-value rules of Math.pow; dhypot rescales
 * to avoid overflow and underflow.
 */

export const PI = 3.141592653589793;
export const HALF_PI = 1.5707963267948966;
export const TWO_PI = 6.283185307179586;
export const LN2 = 0.6931471805599453;
export const SQRT2 = 1.4142135623730951;

// fdlibm split constants.
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.4426950408889634;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_3 = 2.0222662487111665558e-21;
const INV_PIO2 = 6.36619772367581382433e-1;
const EXP_OVERFLOW = 709.782712893384;
const EXP_UNDERFLOW = -745.1332191019412;

const view = new DataView(new ArrayBuffer(8));

/** Exact 2^k for integer k in [-1022, 1023]. */
function pow2(k: number): number {
  view.setUint32(0, ((k + 1023) << 20) >>> 0);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

/** x · 2^k with a single final rounding (handles subnormal and near-overflow results). */
function scale2(x: number, k: number): number {
  if (k > 1023) return x * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return x * pow2(k + 600) * pow2(-600);
  return x * pow2(k);
}

// Inverse factorials 1/n! for n = 0..22, computed once with correctly rounded division.
const INV_FACT: number[] = (() => {
  const out: number[] = [1];
  let f = 1;
  for (let n = 1; n <= 22; n++) {
    f *= n;
    out.push(1 / f);
  }
  return out;
})();

function invFact(n: number): number {
  return INV_FACT[n] as number;
}

/** Clamp x into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Deterministic e^x. */
export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > EXP_OVERFLOW) return Infinity;
  if (x < EXP_UNDERFLOW) return 0;
  if (x === 0) return 1;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO;
  // Taylor series of e^r for |r| <= 0.3466, Horner form up to r^14.
  let p = invFact(14);
  for (let n = 13; n >= 0; n--) p = p * r + invFact(n);
  return scale2(p, k);
}

/** Deterministic e^x − 1, accurate for small |x|. */
export function dexpm1(x: number): number {
  if (x !== x) return NaN;
  const a = Math.abs(x);
  if (a >= 1) return dexp(x) - 1;
  if (a === 0) return x;
  // x + x²/2! + … + x^21/21!
  let p = invFact(21);
  for (let n = 20; n >= 1; n--) p = p * x + invFact(n);
  return p * x;
}

/** Deterministic natural logarithm. */
export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let eAdj = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54, exact
    eAdj = -54;
  }
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  let e = ((hi >>> 20) & 0x7ff) - 1023 + eAdj;
  view.setUint32(0, ((hi & 0x800fffff) | (1023 << 20)) >>> 0);
  let m = view.getFloat64(0); // [1, 2)
  if (m > SQRT2) {
    m *= 0.5;
    e += 1;
  }
  const s = (m - 1) / (m + 1); // |s| <= 0.1716
  const z = s * s;
  // atanh series: 2s (1 + z/3 + z²/5 + … + z^11/23)
  let p = 1 / 23;
  for (let k = 10; k >= 0; k--) p = p * z + 1 / (2 * k + 1);
  const logm = 2 * s * p;
  return e * LN2_HI + (logm + e * LN2_LO);
}

/** Deterministic log base 2. */
export function dlog2(x: number): number {
  return dlog(x) / LN2;
}

function isOddInteger(y: number): boolean {
  return Number.isInteger(y) && Math.abs(y % 2) === 1;
}

/**
 * Deterministic x^y with the ECMAScript Math.pow special-value rules (Number::exponentiate),
 * including signed zeros, infinities and pow(±1, ±Infinity) = NaN. Small integer exponents use
 * exact repeated squaring.
 */
export function dpow(x: number, y: number): number {
  if (y !== y) return NaN;
  if (y === 0) return 1;
  if (x !== x) return NaN;
  if (x === Infinity) return y > 0 ? Infinity : 0;
  if (x === -Infinity) {
    if (y > 0) return isOddInteger(y) ? -Infinity : Infinity;
    return isOddInteger(y) ? -0 : 0;
  }
  if (x === 0) {
    const negZero = Object.is(x, -0);
    if (y > 0) return negZero && isOddInteger(y) ? -0 : 0;
    return negZero && isOddInteger(y) ? -Infinity : Infinity;
  }
  if (y === Infinity || y === -Infinity) {
    const a = Math.abs(x);
    if (a === 1) return NaN;
    return (a > 1) === (y > 0) ? Infinity : 0;
  }
  if (x === 1) return 1;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let n = Math.abs(y);
    let base = x;
    let acc = 1;
    while (n > 0) {
      if (n % 2 === 1) acc *= base;
      base *= base;
      n = Math.floor(n / 2);
    }
    return y < 0 ? 1 / acc : acc;
  }
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const mag = dexp(y * dlog(-x));
    return y % 2 === 0 ? mag : -mag;
  }
  return dexp(y * dlog(x));
}

// sin/cos kernels on |r| <= ~pi/4: Horner evaluation of the Taylor series.
// sin r = r · Σ_{k=0..8} (−1)^k z^k / (2k+1)!,  cos r = Σ_{k=0..9} (−1)^k z^k / (2k)!,  z = r².
const SIN_C: number[] = Array.from({ length: 9 }, (_, k) => (k % 2 === 0 ? 1 : -1) * invFact(2 * k + 1));
const COS_C: number[] = Array.from({ length: 10 }, (_, k) => (k % 2 === 0 ? 1 : -1) * invFact(2 * k));
const ATAN_C: number[] = Array.from({ length: 13 }, (_, k) => (k % 2 === 0 ? 1 : -1) / (2 * k + 1));

function horner(coeffs: number[], z: number): number {
  let p = coeffs[coeffs.length - 1] as number;
  for (let k = coeffs.length - 2; k >= 0; k--) p = p * z + (coeffs[k] as number);
  return p;
}

function sinKernel(r: number): number {
  return r * horner(SIN_C, r * r);
}

function cosKernel(r: number): number {
  return horner(COS_C, r * r);
}

/** Above this magnitude the Cody–Waite reduction is no longer exact enough; use Payne–Hanek. */
const CODY_WAITE_LIMIT = 524288; // 2^19

/** Fixed-point bits of 2/π used by the large-argument reduction (covers every double exponent). */
const TWO_OVER_PI_BITS = 1200;
let twoOverPiFixed: bigint | undefined;

/** arctan(1/k) · 2^scaleBits as a BigInt (alternating Taylor series, truncating divisions). */
function atanInvFixed(k: bigint, scaleBits: bigint): bigint {
  const k2 = k * k;
  let power = (1n << scaleBits) / k; // 1/k^(2n+1)
  let sum = power;
  let n = 1n;
  let negative = true;
  while (power !== 0n) {
    power /= k2;
    const term = power / (2n * n + 1n);
    sum = negative ? sum - term : sum + term;
    negative = !negative;
    n += 1n;
  }
  return sum;
}

/** floor(2/π · 2^TWO_OVER_PI_BITS), computed once from Machin's formula with exact integers. */
export function twoOverPiFixedPoint(): bigint {
  if (twoOverPiFixed === undefined) {
    const q = BigInt(TWO_OVER_PI_BITS + 100); // guard bits
    const pi = 16n * atanInvFixed(5n, q) - 4n * atanInvFixed(239n, q); // π · 2^q
    twoOverPiFixed = (2n << (BigInt(TWO_OVER_PI_BITS) + q)) / pi;
  }
  return twoOverPiFixed;
}

const TWO_POW_M128 = 2.938735877055719e-39; // 2^-128, exact

/**
 * Payne–Hanek reduction for |x| ≥ 2^19: x·(2/π) is computed exactly enough with BigInt arithmetic
 * (x = m·2^e with a 53-bit integer m), giving the quadrant and the fractional part to ~120 bits.
 */
function reduceLarge(x: number): [number, number] {
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponent = ((hi >>> 20) & 0x7ff) - 1075; // |x| = m · 2^exponent
  const mantissa = (BigInt((hi & 0xfffff) | 0x100000) << 32n) | BigInt(lo);
  const product = mantissa * twoOverPiFixedPoint(); // |x|·2/π = product · 2^(exponent − BITS)
  const shift = BigInt(TWO_OVER_PI_BITS - exponent); // ≥ 229 for every finite double
  let q = Number((product >> shift) & 3n);
  const one = 1n << shift;
  let frac = product & (one - 1n); // fractional part · 2^shift, in [0, 1)
  let negative = false;
  if (frac >= one >> 1n) {
    // Round to the nearest quadrant: the remainder becomes negative, |remainder| ≤ 1/2.
    frac = one - frac;
    q = (q + 1) & 3;
    negative = true;
  }
  const f = Number(frac >> (shift - 128n)) * TWO_POW_M128;
  let r = f * HALF_PI;
  if (negative) r = -r;
  if (x < 0) {
    r = -r;
    q = (4 - q) & 3;
  }
  return [r, q];
}

/** Argument reduction: returns [r, quadrant] with x ≡ r + quadrant·π/2 (mod 2π), |r| ≤ ~π/4. */
function reduceHalfPi(x: number): [number, number] {
  if (Math.abs(x) >= CODY_WAITE_LIMIT) return reduceLarge(x);
  const n = Math.floor(x * INV_PIO2 + 0.5);
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  const q = ((n % 4) + 4) % 4;
  return [r, q];
}

/** Deterministic sine. */
export function dsin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (Math.abs(x) < 1e-9) return x;
  const [r, q] = reduceHalfPi(x);
  switch (q) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

/** Deterministic cosine. */
export function dcos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const [r, q] = reduceHalfPi(x);
  switch (q) {
    case 0:
      return cosKernel(r);
    case 1:
      return -sinKernel(r);
    case 2:
      return -cosKernel(r);
    default:
      return sinKernel(r);
  }
}

/** atan on [0, 1] via two argument halvings and a Taylor series on |t| <= tan(pi/16). */
function atanUnit(a: number): number {
  let t = a / (1 + Math.sqrt(1 + a * a));
  t = t / (1 + Math.sqrt(1 + t * t));
  return 4 * t * horner(ATAN_C, t * t);
}

/** Deterministic arctangent. */
export function datan(x: number): number {
  if (x !== x) return NaN;
  if (x === Infinity) return HALF_PI;
  if (x === -Infinity) return -HALF_PI;
  const a = Math.abs(x);
  const r = a <= 1 ? atanUnit(a) : HALF_PI - atanUnit(1 / a);
  return x < 0 ? -r : r;
}

/** Deterministic atan2(y, x) with Math.atan2's quadrant and signed-zero conventions. */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  const yNeg = y < 0 || Object.is(y, -0);
  if (y === 0) {
    const xNeg = x < 0 || Object.is(x, -0);
    if (xNeg) return yNeg ? -PI : PI;
    return y; // ±0
  }
  if (x === 0) return yNeg ? -HALF_PI : HALF_PI;
  const yInf = y === Infinity || y === -Infinity;
  const xInf = x === Infinity || x === -Infinity;
  if (yInf && xInf) {
    const base = x > 0 ? PI / 4 : (3 * PI) / 4;
    return yNeg ? -base : base;
  }
  if (yInf) return yNeg ? -HALF_PI : HALF_PI;
  if (xInf) return x > 0 ? (yNeg ? -0 : 0) : yNeg ? -PI : PI;
  if (Math.abs(x) >= Math.abs(y)) {
    const a = datan(y / x);
    if (x > 0) return a;
    return yNeg ? a - PI : a + PI;
  }
  const a = datan(x / y);
  return y > 0 ? HALF_PI - a : -HALF_PI - a;
}

/** Deterministic hyperbolic tangent. */
export function dtanh(x: number): number {
  if (x !== x) return NaN;
  const a = Math.abs(x);
  if (a > 22) return x < 0 ? -1 : 1;
  let t: number;
  if (a < 0.5) {
    const e = dexpm1(2 * a);
    t = e / (e + 2);
  } else {
    const e = dexp(2 * a);
    t = 1 - 2 / (e + 1);
  }
  return x < 0 ? -t : t;
}

const HYPOT_BIG = 3.273390607896142e150; // 2^500: a sum of two squares above this could overflow
const HYPOT_SMALL = 1.4916681462400413e-154; // 2^-511: squares below this lose precision
const TWO_POW_600 = 4.149515568880993e180;
const TWO_POW_M600 = 2.409919865102884e-181;

/**
 * sqrt(x² + y²) using only correctly rounded ops (Math.hypot is not guaranteed bit-identical).
 * Very large or very small inputs are rescaled by an exact power of two first, so the result
 * neither overflows nor underflows when the true value is representable.
 */
export function dhypot(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return NaN;
  const m = ax > ay ? ax : ay;
  if (m > HYPOT_BIG) {
    const sx = ax * TWO_POW_M600;
    const sy = ay * TWO_POW_M600;
    return Math.sqrt(sx * sx + sy * sy) * TWO_POW_600;
  }
  if (m < HYPOT_SMALL && m > 0) {
    const sx = ax * TWO_POW_600;
    const sy = ay * TWO_POW_600;
    return Math.sqrt(sx * sx + sy * sy) * TWO_POW_M600;
  }
  return Math.sqrt(ax * ax + ay * ay);
}

/** Logistic 1 / (1 + e^(−x)), used by odds formulas (§31.14, §14.8). */
export function dsigmoid(x: number): number {
  return 1 / (1 + dexp(-x));
}
