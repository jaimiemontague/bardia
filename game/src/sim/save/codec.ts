/** Pure-TS byte codecs for saves (no DOM/Node globals): base64 and CRC-32. */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

function b64(n: number): string {
  return B64.charAt(n & 63);
}

/** Standard base64 (RFC 4648, with padding). */
export function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    parts.push(b64(n >>> 18) + b64(n >>> 12) + b64(n >>> 6) + b64(n));
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    parts.push(b64(n >>> 18) + b64(n >>> 12) + '==');
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    parts.push(b64(n >>> 18) + b64(n >>> 12) + b64(n >>> 6) + '=');
  }
  return parts.join('');
}

/** Decodes standard base64; throws on invalid input. */
export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('base64: invalid length');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? (B64_LOOKUP[c] as number) : -1;
    if (v < 0) throw new Error(`base64: invalid character at ${i}`);
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >>> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3) of a byte array, as an unsigned integer. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
