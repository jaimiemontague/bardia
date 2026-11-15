import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { BattleId, CharId, GameState } from '@sim/core/state';
import { inDraft, testWorld } from '@sim/testing';
import { battleData } from './data';
import { assignLeaders, buildBattleSetup, canNightRaid, sergeantSquads, templateFor, type UnitPool } from './setup';
import type { StartBattleEffect } from './types';

const content = getContent();
const data = battleData(content);
const ids = { id: 'bat_1' as BattleId, seed: 'seed' };

function pool(unit: string, men: number, kind: 'fleet' | 'settlement' = 'fleet', id = 'flt_1'): UnitPool {
  return { unit, men, sources: [{ kind, id, men }] };
}

describe('squad formation', () => {
  it('named leaders take one unit type each, up to 20 + 6 × Command; the first takes the best men', () => {
    const p = [pool('bondi', 100), pool('huscarls', 30), pool('archers', 25)];
    const squads = assignLeaders(data, [
      { id: 'chr_a' as CharId, command: 2 },
      { id: 'chr_b' as CharId, command: 5 },
      { id: 'chr_c' as CharId, command: 0 },
    ], p);
    expect(squads.map((s) => [s.leaderId, s.unit, s.men])).toEqual([
      ['chr_a', 'huscarls', 30],
      ['chr_b', 'bondi', 50],
      ['chr_c', 'bondi', 20],
    ]);
    expect(p.find((x) => x.unit === 'bondi')!.men).toBe(30);
    for (const s of squads) expect(s.sources!.reduce((a, x) => a + x.men, 0)).toBe(s.men);
  });

  it('sergeant squads grow to fit the squad limit and never pass the 80-man cap', () => {
    const p = [pool('bondi', 600, 'settlement', 'set_1'), pool('archers', 120, 'settlement', 'set_1'), pool('thegns', 50, 'settlement', 'set_1')];
    const squads = sergeantSquads(data, p, 10, 'chr_x' as CharId);
    expect(squads.length).toBeLessThanOrEqual(10);
    for (const s of squads) {
      expect(s.men).toBeLessThanOrEqual(80);
      expect(s.unnamed).toBe(true);
    }
    // The strongest unit comes first (the chief's bodyguard is picked from these).
    expect(squads[0]!.unit).toBe('thegns');
    const small = sergeantSquads(data, [pool('bondi', 70, 'settlement', 'set_1')], 10, 'chr_x' as CharId);
    expect(small.map((s) => s.men)).toEqual([35, 35]);
    const bear = sergeantSquads(data, [pool('greatBear', 1, 'settlement', 'set_1')], 10, 'chr_x' as CharId);
    expect(bear.map((s) => s.men)).toEqual([1]);
  });
});

describe('buildBattleSetup', () => {
  function world() {
    const w = testWorld({ factions: 3 });
    const player = w.factionIds[0]!;
    const ai = w.factionIds[1]!;
    return { ...w, playerFleet: w.fleetIds[player]![0]!, aiTown: w.settlementIds[ai]![0]!, ai };
  }
  function build(state: GameState, e: Partial<StartBattleEffect>) {
    return buildBattleSetup(state, content, { kind: 'assault', attacker: {}, defender: {}, origin: 'test', ...e } as StartBattleEffect, ids);
  }

  it('an assault on walls brings out the militia (10% of the people) beside the garrison', () => {
    const w = world();
    const town = w.state.settlements[w.aiTown]!;
    expect(town.fortTier).toBeGreaterThanOrEqual(1);
    const s = build(w.state, { kind: 'assault', attacker: { fleetId: w.playerFleet }, settlementId: w.aiTown });
    const militia = Math.round(town.pop * data.b.militiaPopShare);
    const total = s.defender.squads.reduce((a, q) => a + q.men, 0);
    expect(total).toBe(40 + militia);
    expect(s.defender.squads.some((q) => q.sources!.some((x) => x.kind === 'explicit' && x.id === town.id))).toBe(true);
    expect(s.fortTier).toBe(town.fortTier);
    expect(s.lootCeiling).toBe(content.balance.loot.assaultMaxShare);
    // A raid only meets the garrison.
    const r = build(w.state, { kind: 'raid', attacker: { fleetId: w.playerFleet }, settlementId: w.aiTown });
    expect(r.defender.squads.reduce((a, q) => a + q.men, 0)).toBe(40);
  });

  it('a cloister adds monks who carry the treasure; equipment comes from the garrison', () => {
    const w = world();
    const s0 = inDraft(w.state, w.env, (d) => {
      const t = d.settlements[w.aiTown]!;
      t.tier = 'cloister';
      t.pop = 80;
      t.armourTier = 2;
      t.weaponTier = 3;
    }).state;
    const s = build(s0, { kind: 'cloister', attacker: { fleetId: w.playerFleet }, settlementId: w.aiTown });
    expect(s.mapTemplate).toBe('cloister');
    const monks = s.defender.squads.find((q) => q.unit === content.tunables.battle.monks.unit)!;
    expect(monks.men).toBe(Math.max(6, Math.min(20, Math.round(80 * content.tunables.battle.monks.popShare))));
    expect(s.defender.armourTier).toBe(2);
    expect(s.defender.weaponTier).toBe(3);
  });

  it('the player keeps spare crews with the ships; a night raid needs Wildcraft or Wolf-coats', () => {
    const w = world();
    const captain = w.state.fleets[w.playerFleet]!.leaderId;
    const s = build(w.state, { kind: 'raid', attacker: { fleetId: w.playerFleet, characterIds: [captain] }, settlementId: w.aiTown });
    expect(s.attacker.squads).toHaveLength(1);
    expect(s.attacker.squads[0]!.leaderId).toBe(captain);
    const men = s.attacker.squads[0]!.men;
    expect(men).toBeLessThan(50);
    expect(Object.values(s.attacker.available!).reduce((a, v) => a + v, 0)).toBe(50);
    expect(canNightRaid(s, content)).toBe(false);
  });

  it('field battles pick open, forest or river ground by the place; sites by their kind', () => {
    const picks = new Set<string>();
    for (let k = 0; k < 40; k++) picks.add(templateFor(data, { kind: 'field' }, undefined, undefined, `seed|bat_${k}`));
    expect([...picks].sort()).toEqual(['field', 'forest', 'riverCrossing']);
    expect(templateFor(data, { kind: 'field', mapTemplate: 'beach' }, undefined, undefined, 'x')).toBe('beach');
    expect(templateFor(data, { kind: 'ambush' }, undefined, undefined, 'x')).toBe('forest');
  });

  it('is deterministic and reads only state', () => {
    const w = world();
    const e = { kind: 'raid' as const, attacker: { fleetId: w.playerFleet }, settlementId: w.aiTown };
    const before = JSON.stringify(w.state);
    expect(JSON.stringify(build(w.state, e))).toBe(JSON.stringify(build(w.state, e)));
    expect(JSON.stringify(w.state)).toBe(before);
  });
});
