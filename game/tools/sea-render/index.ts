/**
 * Renders one frame of a headless sea battle to a PNG (debugging the arena generator, formations,
 * AI movement and effects without the client):
 *
 *   npm run tool -- sea-render                                  coastal arena, 150 battle seconds in
 *   npm run tool -- sea-render --arena skerries --seed s2 --at 300
 *   npm run tool -- sea-render --arena fjord --coast 90 --attacker drakkar,snekkja --defender galley --defender-culture saraleonese
 *   npm run tool -- sea-render --zoom 1000,1000,400 --out test-results/sea-render/zoom.png
 *
 * Options: --size <px> (default 1000), --ship-scale <×> (default 3; ships are drawn enlarged in the
 * full view so they stay visible), --wind <dir>,<str>, --merchants (defender flees).
 * The frame shows terrain (deep, shallow, land, rock), a 250 m grid, the wind arrow, ships coloured
 * by side (player gold outline, flagships ringed), sails (white set, orange burning), hull fire,
 * grapples and the volleys of the last few seconds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { getContent } from '../../src/content/index';
import type { CultureId, ShipTypeId, WindStrength } from '../../src/sim/core/state';
import { TERRAIN } from '../../src/sim/seabattle/arena';
import { SeaBattleEngine } from '../../src/sim/seabattle/engine';
import type { SeaEvent } from '../../src/sim/seabattle/engineTypes';
import { makeSeaSetup, testSeaContent, type TestSeaSide } from '../../src/sim/seabattle/testing';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type RGB = [number, number, number];
const COLORS = {
  deep: [24, 52, 84] as RGB,
  deepEdge: [32, 66, 102] as RGB,
  shallow: [64, 128, 140] as RGB,
  land: [96, 112, 64] as RGB,
  landHigh: [122, 128, 82] as RGB,
  rock: [120, 116, 110] as RGB,
  grid: [255, 255, 255] as RGB,
  attacker: [196, 60, 48] as RGB,
  defender: [52, 110, 200] as RGB,
  player: [240, 196, 64] as RGB,
  sail: [236, 232, 220] as RGB,
  fire: [255, 140, 30] as RGB,
  dead: [40, 40, 44] as RGB,
  captured: [150, 150, 150] as RGB,
  volley: [250, 240, 200] as RGB,
  fireVolley: [255, 120, 40] as RGB,
  wind: [255, 255, 255] as RGB,
};

class Canvas {
  readonly png: PNG;
  constructor(
    readonly size: number,
    readonly x0: number,
    readonly y0: number,
    readonly metres: number,
  ) {
    this.png = new PNG({ width: size, height: size });
  }
  /** Metres → pixel. */
  px(x: number): number {
    return ((x - this.x0) / this.metres) * this.size;
  }
  py(y: number): number {
    return ((y - this.y0) / this.metres) * this.size;
  }
  /** Pixel → metres. */
  mx(px: number): number {
    return this.x0 + ((px + 0.5) / this.size) * this.metres;
  }
  my(py: number): number {
    return this.y0 + ((py + 0.5) / this.size) * this.metres;
  }
  set(x: number, y: number, c: RGB, a = 1): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.size || iy >= this.size) return;
    const i = (iy * this.size + ix) * 4;
    const d = this.png.data;
    d[i] = Math.round(d[i]! * (1 - a) + c[0] * a);
    d[i + 1] = Math.round(d[i + 1]! * (1 - a) + c[1] * a);
    d[i + 2] = Math.round(d[i + 2]! * (1 - a) + c[2] * a);
    d[i + 3] = 255;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1, width = 1): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      for (let w = 0; w < width; w++) for (let v = 0; v < width; v++) this.set(x + w - (width - 1) / 2, y + v - (width - 1) / 2, c, a);
    }
  }
  disc(x: number, y: number, r: number, c: RGB, a = 1): void {
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r) this.set(x + dx, y + dy, c, a);
  }
  ring(x: number, y: number, r: number, c: RGB): void {
    const n = Math.max(12, Math.ceil(r * 8));
    for (let k = 0; k < n; k++) this.set(x + r * Math.sin((k / n) * 2 * Math.PI), y - r * Math.cos((k / n) * 2 * Math.PI), c);
  }
}

function shipsArg(v: string | undefined, fallback: ShipTypeId[]): ShipTypeId[] {
  return v ? (v.split(',').map((s) => s.trim()).filter(Boolean) as ShipTypeId[]) : fallback;
}

function main(): void {
  const content = testSeaContent(getContent());
  const arena = arg('arena') ?? 'coastal';
  const seed = arg('seed') ?? 's1';
  const at = Number(arg('at') ?? 150);
  const size = Number(arg('size') ?? 1000);
  const shipScale = Number(arg('ship-scale') ?? (arg('zoom') ? 1 : 3));
  const [wdir, wstr] = (arg('wind') ?? '60,fresh').split(',');
  const attacker: TestSeaSide = { ships: shipsArg(arg('attacker'), ['drakkar', 'snekkja', 'snekkja', 'karvi']), isPlayer: true, pitchT: 2 };
  const defender: TestSeaSide = { ships: shipsArg(arg('defender'), ['snekkja', 'snekkja', 'galley']) };
  if (arg('attacker-culture')) attacker.culture = arg('attacker-culture') as CultureId;
  defender.culture = (arg('defender-culture') ?? 'saraleonese') as CultureId;
  if (process.argv.includes('--merchants')) defender.role = 'merchant';
  const opts: Parameters<typeof makeSeaSetup>[0] = { seed, arena, attacker, defender, wind: { dir: Number(wdir), str: (wstr ?? 'fresh') as WindStrength } };
  if (arg('coast')) opts.coastBearing = Number(arg('coast'));
  const setup = makeSeaSetup(opts, content);
  const engine = new SeaBattleEngine(setup, content, { aiControlsPlayer: true });
  const recent: SeaEvent[] = [];
  const steps = Math.round(at / engine.w.dt);
  for (let i = 0; i < steps && engine.status !== 'ended'; i++) {
    engine.step();
    for (const e of engine.drainEvents()) recent.push(e);
  }
  const snap = engine.snapshot();
  const sizeM = snap.arena.sizeM;
  const zoom = arg('zoom')?.split(',').map(Number);
  const view = zoom && zoom.length === 3 ? { x0: zoom[0]! - zoom[2]! / 2, y0: zoom[1]! - zoom[2]! / 2, m: zoom[2]! } : { x0: 0, y0: 0, m: sizeM };
  const c = new Canvas(size, view.x0, view.y0, view.m);

  // Terrain.
  const a = engine.arena;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = c.mx(px);
      const y = c.my(py);
      const cx = Math.floor(x / a.cellM);
      const cy = Math.floor(y / a.cellM);
      const inside = cx >= 0 && cy >= 0 && cx < a.w && cy < a.h;
      const code = inside ? a.terrain[cy * a.w + cx]! : TERRAIN.deep;
      let col: RGB;
      if (code === TERRAIN.land) col = a.hazardDist[cy * a.w + cx]! === 0 && ((cx * 7 + cy * 13) % 5 === 0) ? COLORS.landHigh : COLORS.land;
      else if (code === TERRAIN.rock) col = COLORS.rock;
      else if (code === TERRAIN.shallow) col = COLORS.shallow;
      else col = inside ? COLORS.deep : COLORS.deepEdge;
      c.set(px, py, col);
    }
  }
  // Grid every 250 m and the arena boundary.
  for (let g = 0; g <= sizeM; g += 250) {
    c.line(c.px(g), c.py(0), c.px(g), c.py(sizeM), COLORS.grid, g === 0 || g === sizeM ? 0.6 : 0.12);
    c.line(c.px(0), c.py(g), c.px(sizeM), c.py(g), COLORS.grid, g === 0 || g === sizeM ? 0.6 : 0.12);
  }

  // Volleys of the last 6 battle seconds.
  for (const e of recent) {
    if (e.kind !== 'volley' || snap.timeS - e.t > 6) continue;
    const from = snap.ships[e.from]!;
    const to = snap.ships[e.to]!;
    c.line(c.px(from.x), c.py(from.y), c.px(to.x), c.py(to.y), e.fire ? COLORS.fireVolley : COLORS.volley, 0.55);
  }

  // Ships.
  for (const s of snap.ships) {
    if (s.status === 'fled') continue;
    const h = (s.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    const len = s.lengthM * shipScale;
    const beam = s.beamM * shipScale;
    const base: RGB = s.status === 'sunk' || s.status === 'burned' ? COLORS.dead : s.status === 'captured' || s.status === 'struck' ? COLORS.captured : s.side === 'attacker' ? COLORS.attacker : COLORS.defender;
    // Hull: pointed double-ended profile.
    const reach = len / 2 + 2;
    const bx0 = c.px(s.x - reach);
    const bx1 = c.px(s.x + reach);
    const by0 = c.py(s.y - reach);
    const by1 = c.py(s.y + reach);
    for (let py = Math.floor(by0); py <= Math.ceil(by1); py++) {
      for (let px = Math.floor(bx0); px <= Math.ceil(bx1); px++) {
        const dx = c.mx(px) - s.x;
        const dy = c.my(py) - s.y;
        const along = dx * fx + dy * fy;
        const across = -dx * fy + dy * fx;
        const u = Math.abs(along) / (len / 2);
        if (u > 1) continue;
        const half = (beam / 2) * Math.sqrt(Math.max(0, 1 - u * u)) * (u > 0.75 ? 1 - (u - 0.75) * 1.6 : 1);
        if (Math.abs(across) <= Math.max(half, 0.5 * (view.m / size))) c.set(px, py, base, s.status === 'sunk' || s.status === 'burned' ? 0.6 : 1);
      }
    }
    // Bow mark and course line.
    c.disc(c.px(s.x + fx * len * 0.45), c.py(s.y + fy * len * 0.45), Math.max(1, size / view.m), [250, 250, 250], 0.9);
    if (s.status === 'active') c.line(c.px(s.x + fx * len * 0.5), c.py(s.y + fy * len * 0.5), c.px(s.x + fx * (len * 0.5 + 12 * s.speedMs * shipScale)), c.py(s.y + fy * (len * 0.5 + 12 * s.speedMs * shipScale)), [255, 255, 255], 0.35);
    // Sail (a yard across the hull).
    if (s.sailPct > 0 && (s.status === 'active' || s.sailBurning)) {
      const yard = beam * 1.6;
      const col = s.sailBurning ? COLORS.fire : COLORS.sail;
      c.line(c.px(s.x - fy * yard), c.py(s.y + fx * yard), c.px(s.x + fy * yard), c.py(s.y - fx * yard), col, s.sailSet ? 1 : 0.4, s.sailSet ? 2 : 1);
    }
    if (s.hullBurning) c.disc(c.px(s.x), c.py(s.y), Math.max(2, (beam / view.m) * size), COLORS.fire, 0.8);
    if (s.isPlayer) c.ring(c.px(s.x), c.py(s.y), ((len / 2 + 6) / view.m) * size, COLORS.player);
    else if (s.isFlagship && s.status === 'active') c.ring(c.px(s.x), c.py(s.y), ((len / 2 + 6) / view.m) * size, [255, 255, 255]);
    if (s.grappledTo >= 0) {
      const o = snap.ships[s.grappledTo]!;
      c.line(c.px(s.x), c.py(s.y), c.px(o.x), c.py(o.y), [255, 230, 120], 1, 2);
    }
  }

  // Wind arrow (pointing where the wind goes) in the top-left corner.
  const wd = (snap.wind.dir * Math.PI) / 180;
  const ax = 50;
  const ay = 50;
  const dx = -Math.sin(wd);
  const dy = Math.cos(wd);
  c.line(ax - dx * 30, ay - dy * 30, ax + dx * 30, ay + dy * 30, COLORS.wind, 1, 3);
  c.line(ax + dx * 30, ay + dy * 30, ax + dx * 18 - dy * 9, ay + dy * 18 + dx * 9, COLORS.wind, 1, 3);
  c.line(ax + dx * 30, ay + dy * 30, ax + dx * 18 + dy * 9, ay + dy * 18 - dx * 9, COLORS.wind, 1, 3);
  const strengths: Record<string, number> = { calm: 0, light: 1, fresh: 2, strong: 3, gale: 4 };
  for (let k = 0; k <= (strengths[snap.wind.str] ?? 0); k++) c.disc(20 + k * 12, 95, 4, COLORS.wind);

  const out = resolve(arg('out') ?? `test-results/sea-render/${arena}-${seed}-t${Math.round(snap.timeS)}${zoom ? '-zoom' : ''}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(c.png));
  const active = snap.sides.map((sd) => `${sd.key}: ${sd.activeShips} ships, ${Math.round(sd.crew)} men${sd.retreating ? ' (retreating)' : ''}`).join(' · ');
  console.log(`sea-render: ${out}\n  arena '${snap.arena.template}', t = ${snap.timeS.toFixed(0)} s, status ${snap.status}${snap.winner ? ` (winner ${snap.winner})` : ''}\n  ${active}`);
}

main();
