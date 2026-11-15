import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { dpow } from '@sim/core/dmath';
import { battleData, equipMult, fortDefMult, gateHp, lootPoolValue, resolveUnit, squadCap, unitOf } from './data';
import {
  chargeMult,
  effectiveRange,
  effStat,
  fatigueMult,
  fireSpreadChance,
  flankArc,
  flankMult,
  formationDef,
  frontage,
  meleeCasualtiesPerS,
  moraleFromLosses,
  moraleMult,
  moraleStart,
  playerWoundHp,
  rangedAccuracy,
  squadPower,
  volleyHits,
  winProbability,
} from './formulas';

const content = getContent();
const data = battleData(content);
const b = data.b;

describe('§31.8 melee', () => {
  it('casualties/sec = K_m × min(men, frontage) × atk/def × flank × charge', () => {
    // Sanity check from the design: 50 vs 50 bondi in line at frontage 20 lose ~0.6 men/s each.
    expect(meleeCasualtiesPerS(b, 50, 'line', 4, 4, 1, 1)).toBeCloseTo(0.6, 10);
    expect(meleeCasualtiesPerS(b, 10, 'line', 4, 4, 1, 1)).toBeCloseTo(0.03 * 10, 10);
    expect(meleeCasualtiesPerS(b, 50, 'shieldWall', 7, 8, 1.6, 1.5)).toBeCloseTo(0.03 * 24 * (7 / 8) * 1.6 * 1.5, 10);
    expect(meleeCasualtiesPerS(b, 0, 'line', 4, 4, 1, 1)).toBe(0);
  });

  it('frontage per formation: line 20, shield wall 24, wedge 12, loose 10', () => {
    expect([frontage(b, 'line'), frontage(b, 'shieldWall'), frontage(b, 'wedge'), frontage(b, 'loose')]).toEqual([20, 24, 12, 10]);
  });

  it('atk_eff/def_eff: equipment 1 + 0.12 (tier − 1), command +2%/pt, veterancy +5%/star, fatigue 0.8 below 30', () => {
    expect(equipMult(data.balance, 1)).toBeCloseTo(1, 10);
    expect(equipMult(data.balance, 3)).toBeCloseTo(1.24, 10);
    expect(equipMult(data.balance, 5)).toBeCloseTo(1.48, 10);
    const x = effStat(b, { base: 4, equipMult: 1.24, command: 5, vetStars: 2, stamina: 100, extra: 1 });
    expect(x).toBeCloseTo(4 * 1.24 * 1.1 * 1.1, 10);
    expect(effStat(b, { base: 4, equipMult: 1, command: 0, vetStars: 0, stamina: 29, extra: 1 })).toBeCloseTo(3.2, 10);
    expect(fatigueMult(b, 30)).toBe(1);
    expect(fatigueMult(b, 29.9)).toBe(0.8);
  });

  it('morale multiplier: ≥30 steady, wavering 0.75, routing 0.3', () => {
    expect(moraleMult(b, 30, false)).toBe(1);
    expect(moraleMult(b, 29, false)).toBe(0.75);
    expect(moraleMult(b, 80, true)).toBe(0.3);
  });

  it('flank: front 1.0, side 1.3 (1.4 against a wedge), rear 1.6', () => {
    const cosFront = Math.cos((60 * Math.PI) / 180);
    const cosRear = Math.cos((120 * Math.PI) / 180);
    // Defender faces +x.
    expect(flankArc(1, 0, 5, 0, cosFront, cosRear)).toBe(0);
    expect(flankArc(1, 0, 0, 5, cosFront, cosRear)).toBe(1);
    expect(flankArc(1, 0, -5, 0.5, cosFront, cosRear)).toBe(2);
    expect(flankMult(b, 0, 'line')).toBe(1);
    expect(flankMult(b, 1, 'line')).toBe(1.3);
    expect(flankMult(b, 1, 'wedge')).toBe(1.4);
    expect(flankMult(b, 2, 'line')).toBe(1.6);
  });

  it('charge: infantry 1.5 (wedge ×1.25), Strand-Riders 1.5, Corvani horsemen 1.6; an intact front shield wall negates it', () => {
    expect(chargeMult(b, unitOf(data, 'bondi'), 'line', false)).toBe(1.5);
    expect(chargeMult(b, unitOf(data, 'huscarls'), 'wedge', false)).toBeCloseTo(1.875, 10);
    expect(chargeMult(b, unitOf(data, 'strandRiders'), 'line', false)).toBe(1.5);
    expect(chargeMult(b, unitOf(data, 'horsemen'), 'line', false)).toBe(1.6);
    expect(chargeMult(b, unitOf(data, 'horsemen'), 'line', true)).toBe(1);
    expect(b.charge.chargerCasualtyMult).toBe(1.5);
    expect(b.charge.durationS).toBe(3);
    expect(b.charge.runTiles).toBe(6);
  });

  it('specials: bondi ×1.5 against cavalry, skirmishers ×1.5 against a shield wall', () => {
    expect(resolveUnit(content, 'bondi').vsCavalryAtkMult).toBe(1.5);
    expect(resolveUnit(content, 'skirmishers').vsShieldWallAtkMult).toBe(1.5);
  });
});

describe('§31.9 formations and forts', () => {
  it('shield wall defence: bondi 1.3, huscarls 1.6, Fjord-Wall +20% further', () => {
    expect(formationDef(b, 'shieldWall', unitOf(data, 'bondi'))).toBeCloseTo(1.3, 10);
    expect(formationDef(b, 'shieldWall', unitOf(data, 'huscarls'))).toBeCloseTo(1.6, 10);
    expect(formationDef(b, 'shieldWall', unitOf(data, 'fjordWallHuscarls'))).toBeCloseTo(1.6 * 1.2, 10);
    expect(formationDef(b, 'wedge', unitOf(data, 'huscarls'))).toBe(0.9);
    expect(formationDef(b, 'loose', unitOf(data, 'archers'))).toBe(0.85);
  });

  it('fort ring ×1.15 / 1.3 / 1.5 / 1.8 and gate HP 300 / 600 / 1000 / 2000 (§9.3)', () => {
    expect([1, 2, 3, 4].map((t) => fortDefMult(data.balance, t))).toEqual([1.15, 1.3, 1.5, 1.8]);
    expect([1, 2, 3, 4].map((t) => gateHp(data.balance, t))).toEqual([300, 600, 1000, 2000]);
    expect(fortDefMult(data.balance, 0)).toBe(1);
  });

  it('squad cap 20 + 6 × Command, at most 80, and the unit cap (Wolf-coats 25, Strand-Riders 30)', () => {
    expect(squadCap(data.balance, 0)).toBe(20);
    expect(squadCap(data.balance, 5)).toBe(50);
    expect(squadCap(data.balance, 12)).toBe(80);
    expect(squadCap(data.balance, 10, unitOf(data, 'wolfcoats'))).toBe(25);
    expect(squadCap(data.balance, 10, unitOf(data, 'strandRiders'))).toBe(30);
  });
});

describe('§31.10 ranged, morale, fire, player safety', () => {
  it('volley hits = K_r × shooters × (atk × weapon × (1 + 0.03 archery)) / (def × armour) × acc × mods', () => {
    const hits = volleyHits(b, { shooters: 30, rangedAtk: 5, weaponMult: 1.12, leaderArchery: 4, def: 4, armourMult: 1.24, accuracy: 0.7, mods: 0.5 });
    expect(hits).toBeCloseTo(((0.07 * 30 * (5 * 1.12 * 1.12)) / (4 * 1.24)) * 0.7 * 0.5, 10);
  });

  it('accuracy max(0.25, 1 − 0.6 d/range); elevation adds range ×1.2 and +0.1', () => {
    expect(rangedAccuracy(b, 0, 14, false)).toBe(1);
    expect(rangedAccuracy(b, 7, 14, false)).toBeCloseTo(0.7, 10);
    expect(rangedAccuracy(b, 14, 14, false)).toBeCloseTo(0.4, 10);
    expect(rangedAccuracy(b, 30, 14, false)).toBe(0.25);
    expect(rangedAccuracy(b, 7, 14, true)).toBeCloseTo(0.8, 10);
    expect(effectiveRange(b, 14, true)).toBeCloseTo(16.8, 10);
  });

  it('starting morale = base + 2 Cmd + 5 vet + omen + War-Horn 15 + Brave/Craven − Dread-drakkar 5', () => {
    expect(moraleStart(b, { base: 40, command: 3, vetStars: 1, warHorn: false, traitMod: 0, enemyDreadDrakkar: false, extra: 0 })).toBe(51);
    expect(moraleStart(b, { base: 40, command: 3, vetStars: 1, omen: 'blessed', warHorn: true, traitMod: 10, enemyDreadDrakkar: true, extra: 0 })).toBe(40 + 6 + 5 + 10 + 15 + 10 - 5);
    expect(moraleStart(b, { base: 40, command: 0, vetStars: 0, omen: 'ill', warHorn: false, traitMod: -10, enemyDreadDrakkar: false, extra: 0 })).toBe(20);
    expect(moraleStart(b, { base: 90, command: 10, vetStars: 3, warHorn: true, traitMod: 10, enemyDreadDrakkar: false, extra: 0 })).toBe(100);
  });

  it('losses cost −120 × casualties / starting men', () => {
    expect(moraleFromLosses(b, 5, 50)).toBeCloseTo(-12, 10);
    expect(moraleFromLosses(b, 1, 0)).toBe(0);
  });

  it('fire spread p = 0.25 × flammability × (1 + 0.75 cos θ × windStr), ×2 with the Ember-Cloak', () => {
    // Wind FROM the west (270°) blows toward the east (+x).
    const downwind = fireSpreadChance(b, 0.8, 270, 1, 10, 0, false, 1);
    const upwind = fireSpreadChance(b, 0.8, 270, 1, -10, 0, false, 1);
    const across = fireSpreadChance(b, 0.8, 270, 1, 0, 10, false, 1);
    expect(downwind).toBeCloseTo(0.25 * 0.8 * 1.75, 10);
    expect(upwind).toBeCloseTo(0.25 * 0.8 * 0.25, 10);
    expect(across).toBeCloseTo(0.25 * 0.8, 6);
    expect(fireSpreadChance(b, 0.8, 270, 1, 10, 0, true, 1)).toBeCloseTo(0.25 * 0.8 * 1.75 * 2, 10);
    expect(fireSpreadChance(b, 0.8, 0, 0, 10, 0, false, 1)).toBeCloseTo(0.2, 10);
    // North wind (from 0°) blows south (+y on the map).
    expect(fireSpreadChance(b, 1, 0, 1, 0, 5, false, 1)).toBeCloseTo(0.25 * 1.75, 10);
  });

  it('player wounds: roll × (1 − armour reduction per tier above 1)', () => {
    expect(playerWoundHp(20, 1, 0.06)).toBe(20);
    expect(playerWoundHp(20, 3, 0.06)).toBeCloseTo(20 * 0.88, 10);
  });
});

describe('§31.11 power', () => {
  it('squadPower = men × (atk + def + 0.6 rng) × morale/60; P(A) = r^2.2 / (r^2.2 + 1)', () => {
    expect(squadPower(0.6, 60, 50, 4, 4, 0, 60)).toBe(400);
    expect(squadPower(0.6, 60, 30, 3, 3, 5, 45)).toBeCloseTo(30 * (6 + 3) * 0.75, 10);
    expect(winProbability(2.2, 1, dpow)).toBeCloseTo(0.5, 12);
    expect(winProbability(2.2, 2, dpow)).toBeCloseTo(dpow(2, 2.2) / (dpow(2, 2.2) + 1), 12);
    expect(winProbability(2.2, 0, dpow)).toBe(0);
  });

  it('loot pool value: silver plus goods at base price', () => {
    expect(lootPoolValue(data.balance, { silver: 100, goods: { furs: 2, silk: 0.5 } })).toBe(100 + 800 + 1250);
    expect(lootPoolValue(data.balance, undefined)).toBe(0);
  });
});
