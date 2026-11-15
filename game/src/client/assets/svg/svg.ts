/**
 * Tiny SVG string builders. Generators build plain strings (no DOM), so they run identically in the
 * browser, in Node tests and in tools, and the output is byte-stable for equal inputs.
 */

/** Formats a coordinate with at most one decimal (compact and deterministic; never "-0"). */
export function n(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

/** Formats a value with at most two decimals (opacities, gradient stops). */
export function n2(x: number): string {
  const r = Math.round(x * 100) / 100;
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

/** XML-escapes text and attribute values. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export type AttrValue = string | number | undefined | null | false;
export type Attrs = Readonly<Record<string, AttrValue>>;

/** Serialises attributes; numbers use one-decimal formatting, undefined/null/false are skipped. */
export function attrs(a: Attrs): string {
  let out = '';
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false) continue;
    out += ` ${k}="${typeof v === 'number' ? n(v) : esc(v)}"`;
  }
  return out;
}

/** An element; self-closing when it has no children. */
export function el(name: string, a: Attrs = {}, children?: string | readonly string[]): string {
  const body = children === undefined ? '' : typeof children === 'string' ? children : children.join('');
  return body === '' ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${body}</${name}>`;
}

/** A <g> group. */
export function g(a: Attrs, children: string | readonly string[]): string {
  return el('g', a, children);
}

/** A path element. */
export function path(d: string, a: Attrs = {}): string {
  return el('path', { d, ...a });
}

/** Rectangle. */
export function rect(x: number, y: number, w: number, h: number, a: Attrs = {}): string {
  return el('rect', { x, y, width: w, height: h, ...a });
}

/** Circle. */
export function circle(cx: number, cy: number, r: number, a: Attrs = {}): string {
  return el('circle', { cx, cy, r, ...a });
}

/** Ellipse. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, a: Attrs = {}): string {
  return el('ellipse', { cx, cy, rx, ry, ...a });
}

/** Polygon from flat [x0, y0, x1, y1, …] coordinates. */
export function polygon(points: readonly number[], a: Attrs = {}): string {
  return el('polygon', { points: pts(points), ...a });
}

/** Polyline from flat coordinates. */
export function polyline(points: readonly number[], a: Attrs = {}): string {
  return el('polyline', { points: pts(points), ...a });
}

/** Line. */
export function line(x1: number, y1: number, x2: number, y2: number, a: Attrs = {}): string {
  return el('line', { x1, y1, x2, y2, ...a });
}

/** Flat coordinate list → "x,y x,y". */
export function pts(points: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push(`${n(points[i] as number)},${n(points[i + 1] as number)}`);
  return out.join(' ');
}

/** Linear gradient definition. Stops: [offset 0..1, colour, opacity?]. */
export function linearGradient(
  id: string,
  stops: readonly (readonly [number, string, number?])[],
  dir: { x1?: number; y1?: number; x2?: number; y2?: number } = { x1: 0, y1: 0, x2: 0, y2: 1 },
  extra: Attrs = {},
): string {
  return el(
    'linearGradient',
    { id, x1: n2(dir.x1 ?? 0), y1: n2(dir.y1 ?? 0), x2: n2(dir.x2 ?? 0), y2: n2(dir.y2 ?? 1), ...extra },
    stops.map(([o, c, op]) => el('stop', { offset: n2(o), 'stop-color': c, 'stop-opacity': op === undefined ? undefined : n2(op) })),
  );
}

/** Radial gradient definition (objectBoundingBox units unless `extra` says otherwise). */
export function radialGradient(
  id: string,
  stops: readonly (readonly [number, string, number?])[],
  geo: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {},
  extra: Attrs = {},
): string {
  return el(
    'radialGradient',
    {
      id,
      cx: n2(geo.cx ?? 0.5),
      cy: n2(geo.cy ?? 0.5),
      r: n2(geo.r ?? 0.5),
      fx: geo.fx === undefined ? undefined : n2(geo.fx),
      fy: geo.fy === undefined ? undefined : n2(geo.fy),
      ...extra,
    },
    stops.map(([o, c, op]) => el('stop', { offset: n2(o), 'stop-color': c, 'stop-opacity': op === undefined ? undefined : n2(op) })),
  );
}

/** A complete standalone SVG document. */
export function svgDoc(opts: {
  width: number;
  height: number;
  viewBox: readonly [number, number, number, number];
  defs?: readonly string[];
  body: readonly string[] | string;
  title?: string;
  preserveAspectRatio?: string;
}): string {
  const defs = opts.defs && opts.defs.length > 0 ? el('defs', {}, opts.defs) : '';
  const title = opts.title ? el('title', {}, esc(opts.title)) : '';
  const body = typeof opts.body === 'string' ? opts.body : opts.body.join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${attrs({
      width: Math.round(opts.width),
      height: Math.round(opts.height),
      viewBox: opts.viewBox.map(n).join(' '),
      preserveAspectRatio: opts.preserveAspectRatio,
    })}>` +
    title +
    defs +
    body +
    '</svg>'
  );
}

/** SVG markup → data URL (percent-encoded; safe for <img src> and CSS). */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Smooth closed path through points (Catmull-Rom → cubic Bézier). Flat [x0,y0,…] input. */
export function smoothClosed(points: readonly number[], tension = 1): string {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) p.push([points[i] as number, points[i + 1] as number]);
  const len = p.length;
  if (len < 3) return '';
  const at = (i: number): [number, number] => p[((i % len) + len) % len] as [number, number];
  let d = `M${n(at(0)[0])} ${n(at(0)[1])}`;
  for (let i = 0; i < len; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

/** Smooth open path through points (Catmull-Rom → cubic Bézier). */
export function smoothOpen(points: readonly number[], tension = 1): string {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) p.push([points[i] as number, points[i + 1] as number]);
  if (p.length < 2) return '';
  const at = (i: number): [number, number] => p[Math.max(0, Math.min(p.length - 1, i))] as [number, number];
  let d = `M${n(at(0)[0])} ${n(at(0)[1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}
