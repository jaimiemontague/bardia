/**
 * Pure helpers of the sea-battle scene (no React, no Pixi, unit tested in node): picking a ship
 * under the pointer, the formation a group keeps when sent across the water, which engine order an
 * attack style becomes, who is winning, what a ship is doing in plain words, and the after-battle
 * summary seen from the player's side.
 */
import type { SeaBattleResult, SeaBattleSetup, SeaSideSetup } from '@sim/core/state';
import type { SeaOrderKind, SeaRenderState, SeaShipView, SeaSideKey } from '@sim/seabattle/index';

/** How a ship goes about an enemy it is sent against. */
export type AttackStyle = 'board' | 'shoot' | 'ram';
export const ATTACK_STYLES: readonly AttackStyle[] = ['board', 'shoot', 'ram'];

/** Terrain codes of the arena grid (src/sim/seabattle/arena.ts TERRAIN). */
const LAND = 2;
const ROCK = 3;

/** Compass heading (degrees, 0 = north, clockwise) → screen unit vectors (y grows south). */
export function forwardOf(headingDeg: number): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  return [Math.sin(h), -Math.cos(h)];
}

/** Shortest-way interpolation of compass headings (degrees). */
export function lerpHeading(a: number, b: number, t: number): number {
  let d = (((b - a) % 360) + 540) % 360 - 180;
  if (!Number.isFinite(d)) d = 0;
  return a + d * t;
}

/** Distance from a point to a ship's hull (a capsule along its heading), in metres; 0 inside. */
export function hullDistance(s: Pick<SeaShipView, 'x' | 'y' | 'heading' | 'lengthM' | 'beamM'>, x: number, y: number, inflate = 1): number {
  const [fx, fy] = forwardOf(s.heading);
  const half = Math.max(0, (s.lengthM * inflate - s.beamM * inflate) / 2);
  const r = (s.beamM * inflate) / 2;
  const dx = x - s.x;
  const dy = y - s.y;
  const along = Math.max(-half, Math.min(half, dx * fx + dy * fy));
  const px = s.x + fx * along;
  const py = s.y + fy * along;
  return Math.max(0, Math.hypot(x - px, y - py) - r);
}

/** Ships still on the water (shown and clickable). */
export function onWater(s: Pick<SeaShipView, 'status'>): boolean {
  return s.status === 'active' || s.status === 'struck' || s.status === 'captured';
}

/**
 * The ship under a world point: the nearest hull within `tolM` metres (the view passes its pick
 * tolerance and the drawing inflation), preferring `side` when two overlap. −1 when none.
 */
export function shipAt(snap: Pick<SeaRenderState, 'ships'>, x: number, y: number, tolM: number, inflate = 1, prefer?: SeaSideKey): number {
  let best = -1;
  let bestScore = Infinity;
  for (const s of snap.ships) {
    if (!onWater(s)) continue;
    const d = hullDistance(s, x, y, inflate);
    if (d > tolM) continue;
    const score = d - (prefer !== undefined && s.side === prefer ? tolM * 0.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s.idx;
    }
  }
  return best;
}

/** Own active ships whose centre lies in the world rectangle. */
export function shipsInRect(snap: Pick<SeaRenderState, 'ships'>, side: SeaSideKey, x0: number, y0: number, x1: number, y1: number): number[] {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  return snap.ships.filter((s) => s.side === side && s.status === 'active' && s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by).map((s) => s.idx);
}

/** Is the arena cell under (x, y) land or rock (no ship can be sent there)? */
export function isLandAt(arena: SeaRenderState['arena'], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= arena.sizeM || y >= arena.sizeM) return false;
  const cx = Math.min(arena.w - 1, Math.floor(x / arena.cellM));
  const cy = Math.min(arena.h - 1, Math.floor(y / arena.cellM));
  const code = arena.terrain[cy * arena.w + cx];
  return code === LAND || code === ROCK;
}

/**
 * Destinations for a group sent to (tx, ty): each ship keeps its place relative to the group's centre,
 * squeezed into `maxSpreadM` and spread to at least `minGapM` between neighbours, so a fleet arrives
 * as a fleet instead of piling onto one point. One ship goes exactly where it was sent.
 */
export function formationTargets(ships: readonly { idx: number; x: number; y: number }[], tx: number, ty: number, minGapM = 45, maxSpreadM = 160): { idx: number; x: number; y: number }[] {
  if (ships.length === 0) return [];
  if (ships.length === 1) return [{ idx: ships[0]!.idx, x: tx, y: ty }];
  const cx = ships.reduce((a, s) => a + s.x, 0) / ships.length;
  const cy = ships.reduce((a, s) => a + s.y, 0) / ships.length;
  let spread = 0;
  let nearest = Infinity;
  for (const s of ships) spread = Math.max(spread, Math.hypot(s.x - cx, s.y - cy));
  for (let i = 0; i < ships.length; i++)
    for (let j = i + 1; j < ships.length; j++) nearest = Math.min(nearest, Math.hypot(ships[i]!.x - ships[j]!.x, ships[i]!.y - ships[j]!.y));
  if (!(nearest > 1e-6)) {
    // Stacked on one point: fan them out in a line abreast.
    return ships.map((s, i) => ({ idx: s.idx, x: tx + (i - (ships.length - 1) / 2) * minGapM, y: ty }));
  }
  // Squeeze a scattered group, but never closer than the gap (keeping the gap wins).
  let k = spread > maxSpreadM ? maxSpreadM / spread : 1;
  if (nearest * k < minGapM) k = minGapM / nearest;
  return ships.map((s) => ({ idx: s.idx, x: tx + (s.x - cx) * k, y: ty + (s.y - cy) * k }));
}

/** Can this ship ram (a galley with its beak)? */
export function canRam(s: Pick<SeaShipView, 'type'>, galleyTypes: readonly string[]): boolean {
  return galleyTypes.includes(s.type);
}

/** The style a ship starts with: rams for galleys, boarding for crews with boarders, else the bow. */
export function defaultStyle(s: Pick<SeaShipView, 'type' | 'boarders' | 'archers'>, galleyTypes: readonly string[]): AttackStyle {
  if (canRam(s, galleyTypes)) return 'ram';
  return s.boarders >= s.archers ? 'board' : 'shoot';
}

/** The engine order an attack style becomes ('ram' falls back to boarding for ships without a ram). */
export function orderForStyle(style: AttackStyle, ram: boolean): SeaOrderKind {
  if (style === 'ram') return ram ? 'attack' : 'board';
  return style === 'shoot' ? 'shoot' : 'board';
}

/** Fighting strength of one side's ships on the water (crew, weighed by hull and spirit). */
export function sideStrength(snap: Pick<SeaRenderState, 'ships'>, side: SeaSideKey): number {
  let sum = 0;
  for (const s of snap.ships) {
    if (s.side !== side || s.status !== 'active') continue;
    sum += s.crew * (0.5 + 0.5 * s.hullPct) * (s.routed ? 0.4 : 1);
  }
  return sum;
}

/** The player's share of the fighting strength on the water (0..1; 0.5 when nobody is left). */
export function strengthShare(snap: Pick<SeaRenderState, 'ships'>, side: SeaSideKey): number {
  const own = sideStrength(snap, side);
  const foe = sideStrength(snap, side === 'attacker' ? 'defender' : 'attacker');
  return own + foe > 0 ? own / (own + foe) : 0.5;
}

/** The word for who is winning. */
export function balanceWord(share: number): 'winning' | 'ahead' | 'even' | 'behind' | 'losing' {
  if (share >= 0.72) return 'winning';
  if (share >= 0.57) return 'ahead';
  if (share > 0.43) return 'even';
  if (share > 0.28) return 'behind';
  return 'losing';
}

/** What a ship is doing, as a locale key under seaView.doing. */
export function doingKey(s: SeaShipView, grappled: boolean): string {
  if (s.status !== 'active') return `seaView.doing.status.${s.status}`;
  if (grappled) return 'seaView.doing.boarding';
  if (s.grounded) return 'seaView.doing.grounded';
  if (s.routed) return 'seaView.doing.routed';
  if (s.dousing) return 'seaView.doing.dousing';
  switch (s.goal) {
    case 'flee':
      return 'seaView.doing.withdraw';
    case 'ram':
      return 'seaView.doing.ram';
    case 'seaFire':
      return 'seaView.doing.seaFire';
    case 'board':
    case 'capture':
      return 'seaView.doing.board';
    case 'range':
      return 'seaView.doing.shoot';
    case 'follow':
    case 'screen':
      return 'seaView.doing.follow';
    case 'hold':
      return 'seaView.doing.hold';
    case 'moveTo':
      return 'seaView.doing.sail';
    default:
      if (s.moveTo) return 'seaView.doing.sail';
      return s.speedMs > 0.5 ? 'seaView.doing.underway' : 'seaView.doing.idle';
  }
}

// ---- summary --------------------------------------------------------------------------------

export type SeaOutcome = 'victory' | 'defeat' | 'escaped' | 'draw';

export interface SeaShipFate {
  shipId: string;
  name: string;
  type: string;
  fate: 'fine' | 'damaged' | 'sunk' | 'taken' | 'escaped' | 'won';
}

export interface SeaSideTally {
  ships: number;
  men: number;
  killed: number;
  wounded: number;
  captured: number;
  fates: SeaShipFate[];
}

export interface SeaSummary {
  outcome: SeaOutcome;
  own: SeaSideTally;
  enemy: SeaSideTally;
  /** Enemy ships sunk or burned, and taken as prizes by the player's side. */
  enemySunk: number;
  enemyTaken: number;
  /** The player's own ships lost (sunk or taken). */
  ownLost: number;
  plunderSilver: number;
  plunderGoods: { good: string; tons: number }[];
  durationS: number;
}

export function outcomeFor(result: Pick<SeaBattleResult, 'winner' | 'retreated'>, side: SeaSideKey): SeaOutcome {
  if (result.winner === side) return 'victory';
  if (result.winner === 'none') return 'draw';
  return result.retreated ? 'escaped' : 'defeat';
}

function tally(setup: SeaSideSetup, key: SeaSideKey, result: SeaBattleResult, winner: boolean): SeaSideTally {
  const lost = result.crewLost.find((c) => c.side === key);
  const fates: SeaShipFate[] = setup.ships.map((s) => {
    const o = result.ships?.find((x) => x.shipId === s.shipId);
    const sunk = result.shipsSunk.includes(s.shipId);
    const taken = result.shipsCaptured.includes(s.shipId);
    const fled = result.shipsFled?.includes(s.shipId) === true;
    let fate: SeaShipFate['fate'] = 'fine';
    if (sunk) fate = 'sunk';
    else if (taken) fate = 'taken';
    else if (fled) fate = winner ? 'fine' : 'escaped';
    else if (o && o.hullHp < s.hullHp * 0.85) fate = 'damaged';
    return { shipId: s.shipId, name: s.name ?? s.type, type: s.type, fate };
  });
  return {
    ships: setup.ships.length,
    men: setup.ships.reduce((a, s) => a + s.crew, 0),
    killed: lost?.killed ?? 0,
    wounded: lost?.wounded ?? 0,
    captured: lost?.captured ?? 0,
    fates,
  };
}

/** The summary seen from `side` (pure: the setup and the engine's result). */
export function summarizeSea(setup: SeaBattleSetup, result: SeaBattleResult, side: SeaSideKey): SeaSummary {
  const enemyKey: SeaSideKey = side === 'attacker' ? 'defender' : 'attacker';
  const ownSetup = side === 'attacker' ? setup.attacker : setup.defender;
  const enemySetup = side === 'attacker' ? setup.defender : setup.attacker;
  const outcome = outcomeFor(result, side);
  const own = tally(ownSetup, side, result, outcome === 'victory');
  const enemy = tally(enemySetup, enemyKey, result, outcome === 'defeat');
  const enemyIds = enemySetup.ships.map((s) => s.shipId as string);
  const ownIds = ownSetup.ships.map((s) => s.shipId as string);
  const takenByUs: string[] = result.shipsCaptured.filter((id) => enemyIds.includes(id) && (result.capturedBy?.[id] ?? side) === side);
  for (const f of enemy.fates) if (f.fate === 'taken' && !takenByUs.includes(f.shipId)) f.fate = 'escaped';
  // Plunder: the prizes' share of their fleet's cargo and silver (as the module writes it back).
  let share = 0;
  for (const s of enemySetup.ships) if (takenByUs.includes(s.shipId)) share += s.cargoShare ?? 1 / Math.max(1, enemySetup.ships.length);
  share = Math.min(1, share);
  const plunderGoods = Object.entries(enemySetup.cargo ?? {})
    .map(([good, tons]) => ({ good, tons: Math.round((tons ?? 0) * share * 100) / 100 }))
    .filter((g) => g.tons > 0)
    .sort((a, b) => b.tons - a.tons);
  return {
    outcome,
    own,
    enemy,
    enemySunk: result.shipsSunk.filter((id) => enemyIds.includes(id)).length,
    enemyTaken: takenByUs.length,
    ownLost: [...result.shipsSunk, ...result.shipsCaptured].filter((id) => ownIds.includes(id)).length,
    plunderSilver: Math.floor((enemySetup.silver ?? 0) * share),
    plunderGoods,
    durationS: Math.round(result.durationS),
  };
}

/** m:ss */
export function clock(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** The 8-point compass word for a bearing (the wind blows FROM it). */
export function compassPoint(deg: number): 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' {
  const pts = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
  return pts[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}
