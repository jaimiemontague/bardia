/**
 * 16-bit PCM WAV encoding of rendered placeholder audio (pure; used by the offline placeholder
 * generators so the asset gallery / tools can audition or export a placeholder as a file).
 */

/** Encodes channels of float samples (−1..1, equal lengths) as a 16-bit PCM WAV file. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const numCh = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * numCh * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true); // byte rate
  view.setUint16(32, numCh * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = channels[c]?.[i] ?? 0;
      const s = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
      view.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      o += 2;
    }
  }
  return out;
}
