import { describe, expect, it } from 'vitest';
import { formationSpots, generateArena, hazardDistance, lineOfSight, TERRAIN, terrainAt } from './arena';
import { testSeaContent } from './testing';

const content = testSeaContent();
const t = content.tunables;
const size = content.balance.seaBattle.arenaM;

function count(terrain: Uint8Array, code: number): number {
  let n = 0;
  for (const c of terrain) if (c === code) n++;
  return n;
}

describe('arena generation (§15.2: ~2 × 2 km, islands, rocks, shallows)', () => {
  it('builds every template with clear water at both starts', () => {
    for (const templateId of Object.keys(t.arenas)) {
      for (const seed of ['a1', 'a2', 'a3']) {
        const a = generateArena({ seed, templateId, sizeM: size, tunables: t });
        expect(a.template).toBe(templateId);
        expect(a.w * a.cellM).toBe(size);
        for (const s of a.spawn) {
          expect(hazardDistance(a, s.x, s.y, true)).toBeGreaterThan(t.battle.spawnClearM * 0.7);
          expect(s.x).toBeGreaterThan(0);
          expect(s.x).toBeLessThan(size);
        }
        const tpl = t.arenas[templateId]!;
        if (tpl.coasts > 0) expect(count(a.terrain, TERRAIN.land)).toBeGreaterThan(a.w * 10);
        if (tpl.rocks[0] > 0) expect(count(a.terrain, TERRAIN.rock)).toBeGreaterThan(0);
        if (tpl.shallowsM > 0 && tpl.coasts > 0) expect(count(a.terrain, TERRAIN.shallow)).toBeGreaterThan(0);
      }
    }
  });

  it('puts the coast on the edge the encounter names', () => {
    const east = generateArena({ seed: 'c', templateId: 'coastal', coastBearing: 90, sizeM: size, tunables: t });
    expect(terrainAt(east, size - 5, size / 2)).toBe(TERRAIN.land);
    expect(terrainAt(east, 5, size / 2)).not.toBe(TERRAIN.land);
    const north = generateArena({ seed: 'c', templateId: 'coastal', coastBearing: 10, sizeM: size, tunables: t });
    expect(terrainAt(north, size / 2, 5)).toBe(TERRAIN.land);
    // The fleets meet along the coast, not into it.
    const dx = east.spawn[1].x - east.spawn[0].x;
    const dy = east.spawn[1].y - east.spawn[0].y;
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx));
  });

  it('falls back to the default template for unknown ids', () => {
    expect(generateArena({ seed: 'x', templateId: 'nowhere', sizeM: size, tunables: t }).template).toBe(t.arenaGen.fallback);
  });

  it('land blocks arrows; open water does not', () => {
    const a = generateArena({ seed: 'los', templateId: 'coastal', coastBearing: 90, sizeM: size, tunables: t });
    expect(lineOfSight(a, 100, 1000, 300, 1000, 6)).toBe(true);
    expect(lineOfSight(a, size - 400, 1000, size + 50, 1000, 12)).toBe(false);
  });

  it('places a large fleet on open water in formation', () => {
    const a = generateArena({ seed: 'f', templateId: 'skerries', sizeM: size, tunables: t });
    const spots = formationSpots(a, 0, 14, t.battle.lineSpacingM, t.battle.rowSpacingM, t.battle.shipsPerRow);
    expect(spots).toHaveLength(14);
    for (const s of spots) expect(hazardDistance(a, s.x, s.y, true)).toBeGreaterThanOrEqual(30);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y)).toBeGreaterThan(5);
  });

  it('a chased side starts in the centre with its pursuers close behind', () => {
    const a = generateArena({ seed: 'chase', templateId: 'openSea', sizeM: size, tunables: t, chased: 1 });
    expect(Math.hypot(a.spawn[1].x - size / 2, a.spawn[1].y - size / 2)).toBeLessThan(1);
    expect(Math.hypot(a.spawn[0].x - a.spawn[1].x, a.spawn[0].y - a.spawn[1].y)).toBeCloseTo(t.battle.chaseSpawnSeparationM, 6);
  });
});
