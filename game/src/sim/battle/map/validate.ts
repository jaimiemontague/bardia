/**
 * Structural checks for generated battle maps (used by tests, the battle-render tool and debug
 * builds): bounds, overlaps, gates on the ring, zones present and connected, every door, post and
 * the objective reachable from the attackers' deployment with the gates open.
 */
import { PathGrid } from '../path';
import { S, T, TERRAIN_INFO, Z, type BattleMap } from './grid';

/** Returns human-readable problems; empty when the map is valid. */
export function validateBattleMap(map: BattleMap): string[] {
  const issues: string[] = [];
  const { w, h } = map;
  const n = w * h;
  if (map.terrain.length !== n || map.struct.length !== n || map.zone.length !== n || map.height.length !== n) issues.push('array sizes do not match w×h');

  // Buildings: in bounds, footprint tiles point back at them, doors walkable.
  map.buildings.forEach((b, k) => {
    if (b.x < 0 || b.y < 0 || b.x + b.w > w || b.y + b.h > h) issues.push(`${b.id} out of bounds`);
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = y * w + x;
        if (map.struct[i] !== S.building || map.structId[i] !== k) issues.push(`${b.id} tile (${x},${y}) not owned`);
        if (map.terrain[i] === T.water) issues.push(`${b.id} stands in water`);
      }
    const d = b.doorY * w + b.doorX;
    if (b.doorX < 0 || b.doorY < 0 || b.doorX >= w || b.doorY >= h || map.struct[d] !== S.none || !TERRAIN_INFO[map.terrain[d]!]!.walkable) issues.push(`${b.id} door blocked`);
    if (!(b.flammability >= 0 && b.flammability <= 1)) issues.push(`${b.id} flammability out of range`);
  });
  // Gates: on the ring, owned tiles.
  map.gates.forEach((g, k) => {
    if (!map.ring) issues.push(`${g.id} without walls`);
    for (let y = g.y; y < g.y + g.h; y++)
      for (let x = g.x; x < g.x + g.w; x++) {
        const i = y * w + x;
        if (map.struct[i] !== S.gate || map.structId[i] !== k) issues.push(`${g.id} tile (${x},${y}) not owned`);
      }
    if (!(g.hp > 0)) issues.push(`${g.id} has no hp`);
  });
  if (map.fortTier > 0 && map.ring && map.gates.length === 0) issues.push('walls without a gate');
  if (map.fortTier > 0 && !map.ring) issues.push('fort tier without walls');

  // Zones exist.
  let deployA = 0;
  let extractA = 0;
  let extractD = 0;
  for (let i = 0; i < n; i++) {
    const z = map.zone[i]!;
    if (z & Z.deployA) deployA++;
    if (z & Z.extractA) extractA++;
    if (z & Z.extractD) extractD++;
  }
  if (deployA === 0 || map.deploy[0].length === 0) issues.push('no attacker deployment');
  if (map.deploy[1].length === 0 && map.guards.length === 0) issues.push('no defender deployment');
  if (extractA === 0) issues.push('no attacker extraction zone');
  if (extractD === 0) issues.push('no defender extraction zone');

  // Reachability with the gates open.
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = map.struct[i]!;
    cost[i] = (s === S.none || s === S.tower || s === S.gate) && TERRAIN_INFO[map.terrain[i]!]!.walkable ? 1 : Infinity;
  }
  const tileOf = (x: number, y: number) => Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)));
  const starts = map.deploy[0].map((p) => tileOf(p.x, p.y));
  for (const s of starts) if (!Number.isFinite(cost[s]!)) issues.push(`attacker post at tile ${s} is blocked`);
  const field = new Float32Array(n);
  new PathGrid(w, h).field(cost, starts.filter((s) => Number.isFinite(cost[s]!)), field);
  const reach = (i: number, what: string) => {
    if (!Number.isFinite(field[i]!)) issues.push(`${what} unreachable from the attackers' deployment`);
  };
  for (const b of map.buildings) reach(b.doorY * w + b.doorX, `${b.id} door`);
  map.deploy[1].forEach((p, k) => reach(tileOf(p.x, p.y), `defender post ${k}`));
  map.guards.forEach((p, k) => reach(tileOf(p.x, p.y), `guard post ${k} (${p.role})`));
  map.waveSpawns.forEach((p, k) => reach(tileOf(p.x, p.y), `wave spawn ${k}`));
  let reachA = false;
  let reachD = false;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(field[i]!)) continue;
    if (map.zone[i]! & Z.extractA) reachA = true;
    if (map.zone[i]! & Z.extractD) reachD = true;
  }
  if (!reachA) issues.push('attacker extraction unreachable');
  if (!reachD) issues.push('defender extraction unreachable');
  return issues;
}
