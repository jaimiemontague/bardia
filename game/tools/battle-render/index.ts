/**
 * Dumps PNG frames of battle maps (terrain, height, buildings, walls, gates, zones, caches) and the
 * squads/figures after an optional stretch of headless simulation, so map templates and battles
 * can be inspected by eye.
 *
 *   npm run tool -- battle-render [--template village] [--kind raid] [--seed s] [--culture albric]
 *       [--fort 0..4] [--t seconds] [--scale 6] [--out dir] [--all] [--site cave]
 *
 * --all renders one frame per template (and fort tiers 0–4 of the town). Files are written to
 * --out (default: the system temp dir, battle-render/).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pngjs from 'pngjs';
import { getContent } from '../../src/content/index';
import type { BattleTemplateId } from '../../src/content/schemas/tunables/battle';
import { BATTLE_TEMPLATE_IDS } from '../../src/content/schemas/tunables/battle';
import type { BattleKind, CultureId, SiteKind } from '../../src/sim/core/state';
import { BattleEngine } from '../../src/sim/battle/engine/engine';
import { S, T, Z } from '../../src/sim/battle/map/grid';
import { validateBattleMap } from '../../src/sim/battle/map/validate';
import { makeTestSetup, type FixtureOptions } from '../../src/sim/battle/testing';

const { PNG } = pngjs;

type RGB = [number, number, number];
const TERRAIN_RGB: Record<number, RGB> = {
  [T.open]: [112, 142, 72],
  [T.farm]: [168, 152, 82],
  [T.road]: [152, 128, 92],
  [T.woods]: [42, 88, 44],
  [T.marsh]: [88, 112, 94],
  [T.sand]: [218, 202, 152],
  [T.ford]: [104, 154, 184],
  [T.water]: [40, 82, 142],
  [T.rubble]: [112, 102, 92],
  [T.ditch]: [92, 82, 62],
  [T.rock]: [70, 66, 70],
  [T.bridge]: [142, 112, 72],
  [T.floor]: [132, 122, 112],
};
const BUILDING_RGB: Record<string, RGB> = {
  longhall: [124, 72, 40],
  keep: [118, 116, 120],
  house: [154, 94, 62],
  storehouse: [136, 104, 60],
  church: [196, 190, 176],
  shrine: [124, 62, 96],
  barracks: [120, 84, 58],
  workshop: [146, 110, 80],
  stable: [160, 120, 70],
  granary: [184, 150, 80],
  tent: [196, 176, 140],
  cloisterHall: [180, 172, 150],
  boathouse: [110, 84, 60],
};

interface Args {
  template?: BattleTemplateId;
  kind: BattleKind;
  seed: string;
  culture: CultureId;
  fort: 0 | 1 | 2 | 3 | 4;
  t: number;
  scale: number;
  out: string;
  all: boolean;
  site?: SiteKind;
  approach: 'night' | 'dawn' | 'challenge';
}

function parse(argv: string[]): Args {
  const a: Args = { kind: 'raid', seed: 'render', culture: 'albric', fort: 0, t: 0, scale: 6, out: join(tmpdir(), 'battle-render'), all: false, approach: 'dawn' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i] ?? '';
    if (k === '--template') a.template = v() as BattleTemplateId;
    else if (k === '--kind') a.kind = v() as BattleKind;
    else if (k === '--seed') a.seed = v();
    else if (k === '--culture') a.culture = v() as CultureId;
    else if (k === '--fort') a.fort = Math.max(0, Math.min(4, Number(v()))) as Args['fort'];
    else if (k === '--t') a.t = Number(v());
    else if (k === '--scale') a.scale = Math.max(2, Number(v()));
    else if (k === '--out') a.out = v();
    else if (k === '--all') a.all = true;
    else if (k === '--site') a.site = v() as SiteKind;
    else if (k === '--approach') a.approach = v() as Args['approach'];
  }
  return a;
}

function kindFor(template: BattleTemplateId, fallback: BattleKind): BattleKind {
  switch (template) {
    case 'cloister':
      return 'cloister';
    case 'fortress':
      return 'fortress';
    case 'field':
      return 'field';
    case 'forest':
      return fallback === 'ambush' ? 'ambush' : 'field';
    case 'riverCrossing':
      return 'field';
    case 'beach':
      return 'beach';
    case 'caveMouth':
      return 'guardian';
    default:
      return fallback;
  }
}

/** Renders the engine's current state to a PNG buffer. */
export function renderPng(engine: BattleEngine, scale: number): Buffer {
  const st = engine.state;
  const map = st.map;
  const W = map.w * scale;
  const H = map.h * scale;
  const png = new PNG({ width: W, height: H });
  const put = (x: number, y: number, c: RGB, alpha = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    const d = png.data;
    d[o] = Math.round(d[o]! * (1 - alpha) + c[0] * alpha);
    d[o + 1] = Math.round(d[o + 1]! * (1 - alpha) + c[1] * alpha);
    d[o + 2] = Math.round(d[o + 2]! * (1 - alpha) + c[2] * alpha);
    d[o + 3] = 255;
  };
  const fillTile = (tx: number, ty: number, c: RGB, alpha = 1, inset = 0) => {
    for (let y = inset; y < scale - inset; y++) for (let x = inset; x < scale - inset; x++) put(tx * scale + x, ty * scale + y, c, alpha);
  };
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx;
      let c = TERRAIN_RGB[map.terrain[i]!] ?? [255, 0, 255];
      const h = map.height[i]!;
      c = [Math.min(255, c[0] + h * 7), Math.min(255, c[1] + h * 6), Math.min(255, c[2] + h * 3)];
      const s = map.struct[i]!;
      if (s === S.wall) c = [62, 56, 50];
      else if (s === S.gate) c = st.gates[map.structId[i]!]?.burning ? [230, 120, 30] : [134, 92, 40];
      else if (s === S.tower) c = [92, 86, 80];
      else if (s === S.stakes) c = [104, 72, 40];
      else if (s === S.ship) c = [92, 60, 30];
      fillTile(tx, ty, c);
      if (s === S.none && map.terrain[i] === T.woods) fillTile(tx, ty, [28, 66, 30], 0.6, Math.floor(scale / 3));
      if (st.smoke[i] === 1) fillTile(tx, ty, [70, 70, 70], 0.35);
      const z = map.zone[i]!;
      if (z & Z.extractA) put(tx * scale + 1, ty * scale + 1, [0, 255, 255]);
      if (z & Z.extractD) put(tx * scale + 1, ty * scale + 1, [255, 0, 255]);
      if (z & Z.deployA) put(tx * scale + scale - 2, ty * scale + 1, [80, 140, 255]);
      if (z & Z.deployD) put(tx * scale + scale - 2, ty * scale + scale - 2, [255, 90, 90]);
    }
  // Buildings with outlines.
  for (const b of st.buildings) {
    const base = BUILDING_RGB[b.kind] ?? [200, 0, 200];
    const stone = map.buildings[b.idx]?.stone === true;
    const c: RGB = b.collapsed ? [100, 90, 80] : b.burning ? [235, 110 + Math.round(60 * (1 - b.burnT / 30)), 30] : stone ? [Math.round(base[0] * 0.7 + 50), Math.round(base[1] * 0.7 + 50), Math.round(base[2] * 0.7 + 55)] : base;
    for (let y = b.y * scale; y < (b.y + b.h) * scale; y++)
      for (let x = b.x * scale; x < (b.x + b.w) * scale; x++) {
        const edge = y === b.y * scale || x === b.x * scale || y === (b.y + b.h) * scale - 1 || x === (b.x + b.w) * scale - 1;
        put(x, y, edge ? [30, 22, 16] : c);
      }
    if (b.isKeep || b.isTreasury) for (let k = 2; k < scale * 2; k++) put(Math.round(b.cx * scale) - scale + k, Math.round(b.cy * scale), [255, 230, 60]);
    // Door.
    fillTile(b.doorX, b.doorY, [60, 40, 20], 0.5, Math.floor(scale / 3));
  }
  // Caches.
  for (const c of st.caches) {
    if (c.value <= 0.5) continue;
    const cx = Math.round(c.x * scale);
    const cy = Math.round(c.y * scale);
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) put(cx + x, cy + y, c.treasury ? [255, 255, 255] : [255, 215, 0]);
  }
  // Objective.
  if (map.objective.kind !== 'none') {
    const ox = Math.round(map.objective.x * scale);
    const oy = Math.round(map.objective.y * scale);
    for (let k = -scale; k <= scale; k++) {
      put(ox + k, oy + k, [255, 255, 255]);
      put(ox + k, oy - k, [255, 255, 255]);
    }
  }
  // Figures and squads.
  const f = st.figures;
  for (let i = 0; i < f.n; i++) {
    if (f.alive[i] !== 1) continue;
    const s = st.squads[f.squad[i]!]!;
    const c: RGB = s.side === 0 ? (s.status === 'routing' ? [150, 190, 255] : [30, 70, 230]) : s.status === 'routing' ? [255, 170, 160] : s.status === 'asleep' ? [120, 40, 40] : [220, 30, 30];
    const px = Math.round(f.x[i]! * scale);
    const py = Math.round(f.y[i]! * scale);
    const r = Math.max(1, Math.floor(scale / 3));
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) put(px + x, py + y, c);
  }
  for (const s of st.squads) {
    if (s.status !== 'active' && s.status !== 'routing' && s.status !== 'asleep') continue;
    const c: RGB = s.side === 0 ? [180, 210, 255] : [255, 200, 120];
    // Facing tick.
    for (let k = 0; k < scale * 3; k++) put(Math.round((s.x + s.fx * (s.hd + k / scale)) * scale), Math.round((s.y + s.fy * (s.hd + k / scale)) * scale), c);
    // Footprint outline (sampled).
    const steps = 48;
    for (let k = 0; k < steps; k++) {
      const u = (k / steps) * 4;
      const e = Math.floor(u);
      const fr = u - e;
      const lr = e === 0 ? -1 + 2 * fr : e === 1 ? 1 : e === 2 ? 1 - 2 * fr : -1;
      const lf = e === 0 ? 1 : e === 1 ? 1 - 2 * fr : e === 2 ? -1 : -1 + 2 * fr;
      const wx = s.x + -s.fy * lr * s.hw + s.fx * lf * s.hd;
      const wy = s.y + s.fx * lr * s.hw + s.fy * lf * s.hd;
      put(Math.round(wx * scale), Math.round(wy * scale), c, 0.8);
    }
  }
  // Arrows.
  const p = st.projectiles;
  for (let i = 0; i < p.n; i++) {
    const tt = Math.min(1, (st.timeS - p.t0[i]!) / Math.max(1e-6, p.dur[i]!));
    const x = p.x0[i]! + (p.x1[i]! - p.x0[i]!) * tt;
    const y = p.y0[i]! + (p.y1[i]! - p.y0[i]!) * tt;
    put(Math.round(x * scale), Math.round(y * scale), p.fire[i] ? [255, 140, 0] : [20, 20, 20]);
  }
  return PNG.sync.write(png);
}

function renderOne(args: Args, template: BattleTemplateId, fort: Args['fort'], label: string): void {
  const content = getContent();
  const kind = args.template ? args.kind : kindFor(template, args.kind);
  const opts: FixtureOptions = { kind, template, seed: args.seed, culture: args.culture, fortTier: fort, approach: args.approach, hasRam: true, hasPitch: true };
  if (args.site) opts.siteKind = args.site;
  else if (template === 'caveMouth') opts.siteKind = 'cave';
  const setup = makeTestSetup(content, opts);
  const engine = BattleEngine.create(setup, content, { humanSides: [] });
  const issues = validateBattleMap(engine.state.map);
  const ticks = Math.round(args.t * content.balance.battle.tickHz);
  engine.step(ticks);
  if (engine.status === 'duelRequested') engine.autoResolveDuel();
  mkdirSync(args.out, { recursive: true });
  const file = join(args.out, `${label}.png`);
  writeFileSync(file, renderPng(engine, args.scale));
  const st = engine.state;
  console.log(
    `${file}  ${st.map.w}x${st.map.h} buildings=${st.buildings.length} gates=${st.gates.length} caches=${st.caches.length} squads=${st.squads.length} t=${st.timeS.toFixed(1)}s status=${st.status}${issues.length ? `  ISSUES: ${issues.join('; ')}` : ''}`,
  );
}

function main(): void {
  const args = parse(process.argv.slice(2));
  if (args.all) {
    for (const template of BATTLE_TEMPLATE_IDS) renderOne(args, template, template === 'fortress' ? 2 : template === 'cloister' ? 1 : 0, `${template}-${args.culture}-${args.seed}`);
    for (const fort of [1, 2, 3, 4] as const) renderOne(args, 'town', fort, `town-fort${fort}-${args.culture}-${args.seed}`);
    return;
  }
  const template = args.template ?? 'village';
  renderOne(args, template, args.fort, `${template}-${args.kind}-fort${args.fort}-${args.culture}-${args.seed}-t${args.t}`);
}

main();
