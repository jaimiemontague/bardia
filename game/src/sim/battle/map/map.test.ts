import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { BATTLE_MAP_STYLES, BATTLE_TEMPLATE_IDS, type BattleTemplateId } from '@content/schemas/tunables/battle';
import type { BattleKind, SiteKind } from '@sim/core/state';
import { battleData } from '../data';
import { PathGrid } from '../path';
import { generateBattleMap, type MapGenParams } from './generate';
import { S, T, Z } from './grid';
import { validateBattleMap } from './validate';

const data = battleData(getContent());

function kindOf(template: BattleTemplateId): BattleKind {
  switch (template) {
    case 'cloister':
      return 'cloister';
    case 'fortress':
      return 'fortress';
    case 'field':
    case 'riverCrossing':
      return 'field';
    case 'forest':
      return 'ambush';
    case 'beach':
      return 'beach';
    case 'caveMouth':
      return 'guardian';
    default:
      return 'raid';
  }
}

function params(template: BattleTemplateId, seed: string, extra: Partial<MapGenParams> = {}): MapGenParams {
  return { template, seed, style: 'north', kind: kindOf(template), fortTier: 0, oldStoneWalls: false, church: false, coastal: data.t.templates[template].coastal, ...extra };
}

describe('battle map templates', () => {
  for (const template of BATTLE_TEMPLATE_IDS) {
    it(`${template}: valid maps for several seeds`, () => {
      for (let k = 0; k < 6; k++) {
        const map = generateBattleMap(params(template, `seed-${template}-${k}`), data);
        expect(validateBattleMap(map), `${template} seed ${k}`).toEqual([]);
        expect(map.deploy[0].length).toBeGreaterThan(0);
        const [w, h] = data.t.templates[template].size ?? data.b.mapTiles;
        expect([map.w, map.h]).toEqual([w, h]);
      }
    });
  }

  it('settlement templates have buildings, a chief post and loot holders; walls follow the fort tier', () => {
    for (const template of ['village', 'town', 'cityQuarter'] as const) {
      const open = generateBattleMap(params(template, 'walls'), data);
      expect(open.buildings.length).toBeGreaterThan(4);
      expect(open.guards.some((g) => g.role === 'chief')).toBe(true);
      expect(open.buildings.some((b) => b.lootWeight > 0)).toBe(true);
      expect(open.ring).toBeNull();
      for (const fortTier of [1, 2, 3, 4]) {
        const walled = generateBattleMap(params(template, 'walls', { fortTier }), data);
        expect(walled.ring).not.toBeNull();
        expect(walled.gates.length).toBeGreaterThanOrEqual(2);
        expect(walled.gates.every((g) => g.hp === data.balance.fortTiers[fortTier]!.gateHp)).toBe(true);
        expect(validateBattleMap(walled)).toEqual([]);
        // Ring-forts and burhs have a ditch; tier ≥ 2 has towers.
        let ditch = 0;
        let towers = 0;
        for (let i = 0; i < walled.w * walled.h; i++) {
          if (walled.terrain[i] === T.ditch) ditch++;
          if (walled.struct[i] === S.tower) towers++;
        }
        if (fortTier === 2 || fortTier === 3) expect(ditch).toBeGreaterThan(0);
        if (fortTier >= 2) expect(towers).toBeGreaterThan(0);
      }
    }
    const cloister = generateBattleMap(params('cloister', 'c'), data);
    expect(cloister.objective.kind).toBe('reliquary');
    expect(cloister.buildings.some((b) => b.isTreasury)).toBe(true);
    const fortress = generateBattleMap(params('fortress', 'f'), data);
    expect(fortress.objective.kind).toBe('keep');
    expect(fortress.ring).not.toBeNull();
  });

  it('coastal maps have ships and an extraction zone on the strand; inland maps extract at the edge', () => {
    const coastal = generateBattleMap(params('village', 'coast', { coastal: true }), data);
    expect(coastal.ships.length).toBeGreaterThan(0);
    const inland = generateBattleMap(params('village', 'coast', { coastal: false }), data);
    expect(inland.ships.length).toBe(0);
    let edge = 0;
    for (let x = 0; x < inland.w; x++) if ((inland.zone[(inland.h - 1) * inland.w + x]! & Z.extractA) !== 0) edge++;
    expect(edge).toBeGreaterThan(inland.w / 2);
  });

  it('the river crossing has water, a bridge or ford, and both banks connected', () => {
    const map = generateBattleMap(params('riverCrossing', 'river'), data);
    let water = 0;
    let crossing = 0;
    for (let i = 0; i < map.w * map.h; i++) {
      if (map.terrain[i] === T.water) water++;
      if (map.terrain[i] === T.ford || map.terrain[i] === T.bridge) crossing++;
    }
    expect(water).toBeGreaterThan(map.w);
    expect(crossing).toBeGreaterThan(0);
    expect(validateBattleMap(map)).toEqual([]);
  });

  it('relic sites: barrow and cave objectives, shrine and tower keeps', () => {
    const cases: [BattleTemplateId, SiteKind, string][] = [
      ['caveMouth', 'cave', 'cave'],
      ['caveMouth', 'barrow', 'barrow'],
      ['forest', 'shrine', 'keep'],
      ['field', 'tower', 'keep'],
      ['beach', 'wreck', 'cave'],
    ];
    for (const [template, siteKind, objective] of cases) {
      const map = generateBattleMap(params(template, `site-${siteKind}`, { kind: 'guardian', siteKind }), data);
      expect(map.objective.kind, siteKind).toBe(objective);
      expect(validateBattleMap(map), siteKind).toEqual([]);
    }
  });

  it('is deterministic in its parameters and varies with the place', () => {
    const a = generateBattleMap(params('town', 'set_12', { fortTier: 2 }), data);
    const b = generateBattleMap(params('town', 'set_12', { fortTier: 2 }), data);
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
    expect(Buffer.from(a.struct).equals(Buffer.from(b.struct))).toBe(true);
    expect(a.buildings).toEqual(b.buildings);
    expect(a.guards).toEqual(b.guards);
    const c = generateBattleMap(params('town', 'set_13', { fortTier: 2 }), data);
    expect(Buffer.from(a.terrain).equals(Buffer.from(c.terrain))).toBe(false);
  });

  it('every culture style produces valid settlements (stone south, tents on the steppe)', () => {
    for (const style of BATTLE_MAP_STYLES) {
      const map = generateBattleMap(params('town', `style-${style}`, { style, fortTier: 2 }), data);
      expect(validateBattleMap(map), style).toEqual([]);
      if (style === 'saraleonese') expect(map.buildings.filter((b) => b.stone).length).toBeGreaterThan(map.buildings.length / 2);
      if (style === 'kurgai') expect(map.buildings.some((b) => b.kind === 'tent')).toBe(true);
    }
  });
});

describe('path search', () => {
  it('A* finds the way around a wall and reports partial paths to unreachable goals', () => {
    const w = 20;
    const h = 10;
    const cost = new Float32Array(w * h).fill(1);
    for (let y = 0; y < 8; y++) cost[y * w + 10] = Infinity;
    const pg = new PathGrid(w, h);
    const out: number[] = [];
    expect(pg.findPath(cost, 2 * w + 2, 2 * w + 17, out)).toBe(1);
    expect(out[out.length - 1]).toBe(2 * w + 17);
    expect(out.every((i) => Number.isFinite(cost[i]!))).toBe(true);
    expect(out.some((i) => Math.floor(i / w) >= 8)).toBe(true);
    for (let y = 0; y < h; y++) cost[y * w + 10] = Infinity;
    expect(pg.findPath(cost, 2 * w + 2, 2 * w + 17, out)).toBe(2);
    const field = new Float32Array(w * h);
    pg.field(cost, [2 * w + 2], field);
    expect(field[2 * w + 17]).toBe(Infinity);
    expect(field[2 * w + 3]).toBe(1);
  });
});
