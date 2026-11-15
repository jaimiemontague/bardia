import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { CULTURE_IDS } from '@content/schemas/ids';
import {
  PLACEHOLDER_HOME_FLAG,
  createCharacter,
  createFaction,
  createFleet,
  createPlaceholderPlayer,
  createProvince,
  createSettlement,
  createShip,
  getOrCreateRelation,
  recomputeOpinion,
  relationKey,
} from './factory';
import { createEmptyState } from './initialState';
import { coreInvariants } from './builtins';
import { factoryStreams } from './factory';
import { inDraft, testEnv, testState } from '../testing';
import { generatePersonalName, generatePlaceName, generateShipName, joinSyllables } from './names';
import { ageInYears } from './time';
import type { GameState } from './state';

const content = getContent();
const deps = { content };

function fresh(seed = 'factory-test'): GameState {
  return createEmptyState({ seed });
}

describe('names', () => {
  it('generate plausible names for every culture, deterministically', () => {
    for (const c of CULTURE_IDS) {
      const a = fresh('names');
      const b = fresh('names');
      const naming = content.cultures[c].naming;
      const na = Array.from({ length: 20 }, (_, i) => generatePersonalName(a, naming, i % 2 ? 'male' : 'female'));
      const nb = Array.from({ length: 20 }, (_, i) => generatePersonalName(b, naming, i % 2 ? 'male' : 'female'));
      expect(na).toEqual(nb);
      for (const n of na) expect(n).toMatch(/^[A-Z][a-z]+$/);
      const place = generatePlaceName(a, naming);
      expect(place).toMatch(/^[A-Z][a-z]*( [A-Z][a-z]+)?$/);
    }
  });

  it('only consume the names stream', () => {
    const s = fresh();
    generatePersonalName(s, content.cultures.skarn.naming, 'male');
    generateShipName(s, content.names, 'Kolvik');
    expect(Object.keys(s.rng)).toEqual(['names']);
  });

  it('joins syllables without stutters', () => {
    expect(joinSyllables('Brand', 'dis')).toBe('Brandis');
    expect(joinSyllables('Hall', 'vard')).toBe('Hallvard');
    expect(joinSyllables('Sig', '')).toBe('Sig');
  });

  it('ship names follow the patterns', () => {
    const s = fresh();
    for (let i = 0; i < 30; i++) expect(generateShipName(s, content.names, 'Brimstad')).toMatch(/^[A-Z][a-z]+[- ][A-Z][a-z]+( of Brimstad)?$/);
  });
});

describe('entity factories', () => {
  it('createCharacter is deterministic and fills defaults from balance', () => {
    const run = () => {
      const s = fresh();
      s.time.hour = 1000;
      const c = createCharacter(s, deps, { culture: 'hvarn', age: 16 });
      return { s, c };
    };
    const { s, c } = run();
    expect(run().c).toEqual(c);
    expect(c.id).toBe('chr_1');
    expect(s.characters[c.id]).toBe(c);
    expect(ageInYears(c.birthHour, 1000)).toBe(16);
    expect(c.attributes).toEqual({ might: 4, agility: 4, wits: 4, vigor: 4 });
    expect(c.faith).toBe('oldways');
    expect(c.skills.melee).toBe(0);
    expect(Object.keys(c.skills)).toHaveLength(8);
    expect(c.level).toBe(1);
    expect(c.alive).toBe(true);
  });

  it('createCharacter honours explicit options', () => {
    const s = fresh();
    const c = createCharacter(s, deps, {
      culture: 'albric',
      sex: 'female',
      name: 'Aelfwyn',
      birthHour: -5000,
      level: 5,
      skills: { speechcraft: 3, melee: 99 },
      traits: ['brave'],
      loyalty: 55,
    });
    expect(c).toMatchObject({ name: 'Aelfwyn', sex: 'female', birthHour: -5000, level: 5, xp: 1060, faith: 'lantern', loyalty: 55 });
    expect(c.skills.melee).toBe(10); // clamped to skillMax
    expect(c.traits).toEqual(['brave']);
  });

  it('createFaction creates a ruler when none is given', () => {
    const s = fresh();
    const f = createFaction(s, deps, { culture: 'corvani', kind: 'realm', treasury: 500 });
    const ruler = s.characters[f.rulerId];
    expect(ruler?.role?.kind).toBe('ruler');
    expect(ruler?.factionId).toBe(f.id);
    expect(f.faith).toBe('lantern');
    expect(f.treasury).toBe(500);
  });

  it('createSettlement wires province, faction and leader', () => {
    const s = fresh();
    const f = createFaction(s, deps, { culture: 'skarn', kind: 'jarldom' });
    const p = createProvince(s, { name: 'Saltnes', regionId: 'skarnheim', homeland: true });
    const set = createSettlement(s, deps, { culture: 'skarn', provinceId: p.id, factionId: f.id, tier: 'town', pop: 1200, mapPos: { x: 5, y: 6 } });
    expect(p.settlementIds).toEqual([set.id]);
    expect(p.capitalId).toBe(set.id);
    expect(f.holdingIds).toEqual([set.id]);
    const leader = s.characters[set.leaderId];
    expect(leader?.location).toEqual({ kind: 'settlement', id: set.id });
    expect(set.name).toMatch(/^[A-Z]/);
  });

  it('createShip/createFleet use balance ship defs and link ships to the fleet', () => {
    const s = fresh();
    const f = createFaction(s, deps, { culture: 'eyjar', kind: 'jarldom' });
    const ship = createShip(s, deps, { type: 'drakkar', ownerId: f.id, dockedAt: 'set_99' });
    expect(ship.hullHp).toBe(content.balance.ships.drakkar.hull);
    expect(ship.sailHp).toBe(content.balance.ships.drakkar.sail);
    const fleet = createFleet(s, deps, { ownerId: f.id, leaderId: f.rulerId, pos: { x: 1, y: 2 }, shipIds: [ship.id], men: { bondi: 30 } });
    expect(s.ships[ship.id]?.locationFleetId).toBe(fleet.id);
    expect(s.ships[ship.id]?.dockedAt).toBeUndefined();
    expect(fleet.men).toEqual({ bondi: 30 });
  });

  it('createFleet moves ships out of their previous fleet (a ship is never in two fleets)', () => {
    const s = fresh();
    const f = createFaction(s, deps, { culture: 'skarn', kind: 'jarldom' });
    const a = createShip(s, deps, { type: 'snekkja', ownerId: f.id });
    const b = createShip(s, deps, { type: 'knarr', ownerId: f.id });
    const first = createFleet(s, deps, { ownerId: f.id, leaderId: f.rulerId, pos: { x: 0, y: 0 }, shipIds: [a.id, b.id, a.id] });
    expect(first.shipIds).toEqual([a.id, b.id]);
    const second = createFleet(s, deps, { ownerId: f.id, leaderId: f.rulerId, pos: { x: 0, y: 0 }, shipIds: [a.id] });
    expect(s.fleets[first.id]?.shipIds).toEqual([b.id]);
    expect(second.shipIds).toEqual([a.id]);
    expect(s.ships[a.id]?.locationFleetId).toBe(second.id);
    expect(coreInvariants(s)).toEqual([]);
    s.fleets[first.id]!.shipIds.push(a.id); // corrupt on purpose
    expect(coreInvariants(s).join(' | ')).toMatch(/in both fleet/);
  });

  it('inside an operation, factories draw from the calling module’s own streams', () => {
    const env = testEnv();
    const { state } = inDraft(testState(), env, (d, ctx) => {
      ctx.runAs('economy', () => createCharacter(d, ctx, { culture: 'albric', age: 30 }));
    });
    expect(Object.keys(state.rng)).toEqual(expect.arrayContaining(['economy:factory', 'economy:names']));
    const before = testState().rng;
    expect(state.rng.factory).toEqual(before.factory);
    expect(state.rng.names).toEqual(before.names);
    expect(factoryStreams({ moduleId: 'core' })).toEqual({ factory: 'factory', names: 'names' });
    expect(factoryStreams({ moduleId: 'world' })).toEqual({ factory: 'world:factory', names: 'world:names' });
  });

  it('createPlaceholderPlayer builds a consistent house from the difficulty preset', () => {
    const s = createEmptyState({ seed: 'p', difficulty: 'hearthside' });
    createPlaceholderPlayer(s, deps, { culture: 'eyjar', name: 'Thyra', sex: 'female' });
    const p = s.player;
    const capital = s.settlements[p.capitalId]!;
    expect(s.characters[p.rulerId]?.name).toBe('Thyra');
    expect(s.factions[p.factionId]?.treasury).toBe(3500);
    expect(capital.garrison).toEqual({ bondi: 60, archers: 30 });
    expect(capital.fortTier).toBe(0); // Eyjar "Open Shores"
    expect(capital.holding?.foodMonths).toBe(8);
    expect(Object.values(s.ships).map((x) => x.type).sort()).toEqual(['knarr', 'snekkja', 'snekkja']);
    expect(Object.values(s.characters).filter((c) => c.role?.kind === 'lieutenant')).toHaveLength(3);
    expect(p.house.honor).toBe(10);
    expect(Object.values(p.house.favor).every((v) => v === 5)).toBe(true);
    expect(s.flags[PLACEHOLDER_HOME_FLAG]).toBe(capital.id);
  });
});

describe('relations', () => {
  it('relationKey is order independent', () => {
    expect(relationKey('fac_2', 'fac_10')).toBe(relationKey('fac_10', 'fac_2'));
    expect(relationKey('fac_2', 'fac_10')).toBe('fac_10|fac_2');
    expect(() => relationKey('fac_1', 'fac_1')).toThrow();
  });

  it('getOrCreateRelation + recomputeOpinion clamp the modifier sum', () => {
    const s = fresh();
    const r = getOrCreateRelation(s, 'fac_b', 'fac_a');
    expect(r).toMatchObject({ a: 'fac_a', b: 'fac_b', opinion: 0, stance: 'neutral' });
    r.modifiers.push({ reason: 'x', value: 80, decayPerMonth: 0 }, { reason: 'y', value: 50, decayPerMonth: 0 });
    expect(recomputeOpinion(r)).toBe(100);
    expect(getOrCreateRelation(s, 'fac_a', 'fac_b')).toBe(r);
  });
});
