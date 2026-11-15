import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { Character } from '@sim/core/state';
import {
  allowedWeapons,
  armourReduction,
  buildProfile,
  defaultWeapon,
  duelHpMax,
  duelRating,
  duelShieldMax,
  duelStaminaMax,
  duelStyle,
  effectiveStats,
  mercyChance,
  nervePct,
  parryWindowMs,
  strikeDamage,
  windupSpeedMult,
  yieldThreshold,
} from './stats';
import { testDuelContent, testProfileInput } from './testing';

const content = testDuelContent();
const b = content.balance;
const t = content.tunables.duel;

function character(over: Partial<Character> = {}): Character {
  return {
    id: 'chr_1',
    name: 'Test',
    sex: 'male',
    culture: 'skarn',
    faith: 'oldways',
    birthHour: 0,
    alive: true,
    attributes: { might: 4, agility: 4, wits: 4, vigor: 4 },
    skills: { melee: 3, archery: 0, command: 0, seafaring: 0, wildcraft: 0, speechcraft: 0, stewardship: 0, runecraft: 0 },
    traits: [],
    feats: [],
    level: 1,
    xp: 0,
    health: { hpPct: 100, wound: 'none', injuries: [] },
    family: { spouseIds: [], childIds: [] },
    portrait: { seed: 1 },
    location: { kind: 'none' },
    ...over,
  };
}

describe('§14.3 bars', () => {
  it('HP and stamina follow 100 × (1 + 0.08 × (Vigor − 4))', () => {
    expect(duelHpMax(b, 4)).toBeCloseTo(100);
    expect(duelHpMax(b, 6)).toBeCloseTo(116);
    expect(duelHpMax(b, 1)).toBeCloseTo(76);
    expect(duelStaminaMax(b, 9)).toBeCloseTo(140);
  });

  it('Shield HP = 40 + 10 × (armourTier − 1); two-handed weapons carry none', () => {
    expect(duelShieldMax(b, 'axe', 1)).toBe(40);
    expect(duelShieldMax(b, 'sword', 4)).toBe(70);
    expect(duelShieldMax(b, 'daneAxe', 5)).toBe(0);
  });
});

describe('§14.5 damage formula', () => {
  it('weaponDmg × (1 + 0.04 × (Might − 4)) × (1 + 0.03 × Melee) × moveMult × (1 − 0.06 × (armourTier − 1)), plus weapon tier', () => {
    const a = buildProfile(content, testProfileInput('chr_1', { stats: { might: 6, melee: 5 }, weapon: 'axe', weaponTier: 1 }));
    const d = buildProfile(content, testProfileInput('chr_2', { armourTier: 3 }));
    const expected = 14 * (1 + 0.04 * 2) * (1 + 0.03 * 5) * 2.0 * (1 - 0.06 * 2);
    expect(strikeDamage(a, d, 2.0)).toBeCloseTo(expected, 9);
    // Weapon tier 3 adds tunables.weaponTierDamagePct per tier above 1.
    const a3 = buildProfile(content, testProfileInput('chr_1', { stats: { might: 6, melee: 5 }, weapon: 'axe', weaponTier: 3 }));
    expect(strikeDamage(a3, d, 2.0)).toBeCloseTo(expected * (1 + (2 * t.weaponTierDamagePct) / 100), 9);
  });

  it('trait and feat duel.damagePct stack (Wrathful +10, Duelist +10)', () => {
    const plain = buildProfile(content, testProfileInput('chr_1', { weaponTier: 1 }));
    const fierce = buildProfile(content, testProfileInput('chr_1', { weaponTier: 1, traits: ['wrathful'], feats: ['duelist'] }));
    expect(fierce.damageBase / plain.damageBase).toBeCloseTo(1.2, 9);
  });

  it('armour reduction is 6% per tier above 1', () => {
    expect(armourReduction(b, 1)).toBe(0);
    expect(armourReduction(b, 5)).toBeCloseTo(0.24);
  });
});

describe('parry window and speed', () => {
  it('180 ms + 10 ms/Agility + 8 ms/Melee + feats, accessibility extension capped at +220 ms', () => {
    expect(parryWindowMs(b, 4, 3, 0)).toBe(180 + 40 + 24);
    expect(parryWindowMs(b, 6, 0, 40)).toBe(180 + 60 + 40);
    expect(parryWindowMs(b, 4, 3, 0, 500)).toBe(244 + b.duel.accessibilityParryMaxMs);
    const duelist = buildProfile(content, testProfileInput('chr_1', { feats: ['duelist'] }));
    expect(duelist.parryWindowMs).toBe(244 + 40);
  });

  it('Agility and Melee shorten wind-ups (tempo) within the tunable bounds', () => {
    expect(windupSpeedMult(b, t, 4)).toBe(1);
    expect(windupSpeedMult(b, t, 4, t.meleeSpeedPivot)).toBe(1);
    expect(windupSpeedMult(b, t, 6)).toBeCloseTo(1 - (2 * t.agilitySpeedPct) / 100);
    expect(windupSpeedMult(b, t, 4, t.meleeSpeedPivot + 2)).toBeCloseTo(1 - (2 * t.meleeSpeedPct) / 100);
    expect(windupSpeedMult(b, t, 6, t.meleeSpeedPivot + 1)).toBeCloseTo(1 - (2 * t.agilitySpeedPct + t.meleeSpeedPct) / 100);
    expect(windupSpeedMult(b, t, 50)).toBe(t.speedMultMin);
    expect(windupSpeedMult(b, t, 1, 0)).toBe(Math.min(t.speedMultMax, 1 + (3 * t.agilitySpeedPct + 3 * t.meleeSpeedPct) / 100));
    // A practised fighter's profile carries the faster wind-up (and so the faster recovery).
    const novice = buildProfile(content, testProfileInput('chr_1', { stats: { melee: t.meleeSpeedPivot } }));
    const veteran = buildProfile(content, testProfileInput('chr_2', { stats: { melee: t.meleeSpeedPivot + 2 } }));
    expect(veteran.windupMs).toBeCloseTo(novice.windupMs * (1 - (2 * t.meleeSpeedPct) / 100));
  });
});

describe('nerve (duel omen + traits)', () => {
  it('sums the omen’s and the traits’ duel.nervePct, clamped to ±maxAbsPct', () => {
    expect(nervePct(content, 0, [], [])).toBe(0);
    expect(nervePct(content, 10, [], [])).toBe(10);
    expect(nervePct(content, -10, [], [])).toBe(-10);
    expect(nervePct(content, 1000, [], [])).toBe(t.nerve.maxAbsPct);
    expect(nervePct(content, -1000, [], [])).toBe(-t.nerve.maxAbsPct);
  });

  it('confidence is staying power: stamina and the auto-resolve rating scale with nerve', () => {
    const calm = buildProfile(content, testProfileInput('chr_1'));
    const blessed = buildProfile(content, { ...testProfileInput('chr_1'), omenNervePct: 10 });
    const ill = buildProfile(content, { ...testProfileInput('chr_1'), omenNervePct: -10 });
    expect(calm.nervePct).toBeUndefined();
    expect(blessed.nervePct).toBe(10);
    expect(blessed.staminaMax).toBeCloseTo(calm.staminaMax * (1 + (10 * t.nerve.staminaPctPerNervePct) / 100));
    expect(ill.staminaMax).toBeCloseTo(calm.staminaMax * (1 - (10 * t.nerve.staminaPctPerNervePct) / 100));
    expect(blessed.rating - calm.rating).toBeCloseTo(10 * t.nerve.ratingPerNervePct);
    expect(blessed.hpMax).toBe(calm.hpMax);
    expect(blessed.damageBase).toBe(calm.damageBase);
  });
});

describe('§14.8 DuelRating', () => {
  it('2×Melee + Might + Agility + Vigor/2 + 3×(weaponTier−1) + 3×(armourTier−1) + level/2 + traits + relics', () => {
    const stats = { might: 5, agility: 6, wits: 4, vigor: 4, melee: 4, level: 6 };
    const gear = { weapon: 'axe' as const, armourTier: 3, weaponTier: 2, ratingBonus: 1 };
    expect(duelRating(b, stats, gear, 0)).toBe(8 + 5 + 6 + 2 + 3 + 6 + 3 + 1);
  });

  it('trait terms come from traits.json duel.rating (Brave +2, Towering +3, Wrathful +2, Craven −3)', () => {
    const base = buildProfile(content, testProfileInput('chr_1', {})).rating;
    expect(buildProfile(content, testProfileInput('chr_1', { traits: ['brave'] })).rating - base).toBe(2);
    expect(buildProfile(content, testProfileInput('chr_1', { traits: ['craven'] })).rating - base).toBe(-3);
    expect(buildProfile(content, testProfileInput('chr_1', { traits: ['wrathful'] })).rating - base).toBe(2);
    expect(buildProfile(content, testProfileInput('chr_1', { traits: ['towering'] })).rating - base).toBe(3);
    // The balance.json copy of the trait weights agrees with traits.json (single source: traits.json).
    for (const [trait, w] of Object.entries(b.duel.rating.traits)) expect(getContent().traits[trait]?.modifiers['duel.rating']).toBe(w);
  });
});

describe('effective stats', () => {
  it('adds trait/feat attribute and skill modifiers', () => {
    const s = effectiveStats(content, character({ traits: ['towering', 'hirdTrained'] }), 0);
    expect(s.might).toBe(6);
    expect(s.melee).toBe(4);
  });

  it('applies temporary injuries until they heal, then wound penalties', () => {
    const ch = character({ health: { hpPct: 100, wound: 'none', injuries: [{ id: 'brokenHand', untilHour: 100 }, { id: 'crackedRibs' }] } });
    expect(effectiveStats(content, ch, 50).melee).toBe(0);
    expect(effectiveStats(content, ch, 50).vigor).toBe(3);
    expect(effectiveStats(content, ch, 100).melee).toBe(3);
    const hurt = effectiveStats(content, character({ health: { hpPct: 60, wound: 'serious', injuries: [] } }), 0);
    expect(hurt.might).toBeCloseTo(4 * 0.75);
    expect(hurt.melee).toBeCloseTo(3 * 0.75);
  });

  it('a hurt fighter starts with less HP, floored at minStartHpPct', () => {
    const p = buildProfile(content, testProfileInput('chr_1', { hpPct: 60 }));
    expect(p.hpStart).toBeCloseTo(60);
    const q = buildProfile(content, testProfileInput('chr_1', { hpPct: 1 }));
    expect(q.hpStart).toBeCloseTo(t.fighter.minStartHpPct);
  });

  it('Lame reduces dodge; Towering lengthens reach', () => {
    expect(buildProfile(content, testProfileInput('chr_1', { traits: ['lame'] })).dodgeMult).toBeCloseTo(0.7);
    const tall = buildProfile(content, testProfileInput('chr_1', { traits: ['towering'] }));
    const plain = buildProfile(content, testProfileInput('chr_1', {}));
    expect(tall.reachM).toBeGreaterThan(plain.reachM);
  });

  it('holmgang fighters carry three shields; two-handed fighters none', () => {
    expect(buildProfile(content, testProfileInput('chr_1', {}, 'yield', true)).shields).toBe(b.duel.holmgang.shields);
    expect(buildProfile(content, testProfileInput('chr_1', { weapon: 'daneAxe' }, 'yield', true)).shields).toBe(0);
    expect(buildProfile(content, testProfileInput('chr_1', {}, 'yield', false)).shields).toBe(1);
  });
});

describe('weapons and personality', () => {
  it('swords need weapon tier 3', () => {
    expect(allowedWeapons(b, 1)).not.toContain('sword');
    expect(allowedWeapons(b, 3)).toContain('sword');
  });

  it('default weapon: style preference, then culture, then the first allowed', () => {
    expect(defaultWeapon(content, 'spear', 1)).toBe('spear');
    expect(defaultWeapon(content, 'sword', 1)).toBe('axe');
    expect(defaultWeapon(content, 'spear', 1, 'brute')).toBe('daneAxe');
  });

  it('style follows personality and traits', () => {
    expect(duelStyle(t, { aggression: 90, greed: 50, honor: 50, caution: 10, ambition: 50, piety: 50 }, [], 4)).toBe('aggressive');
    expect(duelStyle(t, { aggression: 10, greed: 50, honor: 50, caution: 90, ambition: 50, piety: 50 }, [], 4)).toBe('defensive');
    expect(duelStyle(t, undefined, ['deceitful', 'quick'], 4)).toBe('tricky');
    expect(duelStyle(t, undefined, ['towering'], 6)).toBe('brute');
  });

  it('mercy rises with honour and just/honest traits, falls with ruthlessness and death stakes', () => {
    const honourable = mercyChance(t, { aggression: 50, greed: 50, honor: 90, caution: 50, ambition: 50, piety: 50 }, ['just'], 'yield');
    const cruel = mercyChance(t, { aggression: 50, greed: 50, honor: 10, caution: 50, ambition: 50, piety: 50 }, ['ruthless'], 'death');
    expect(honourable).toBeGreaterThan(0.8);
    expect(cruel).toBe(t.fighter.mercy.min);
  });

  it('the Brave never ask for quarter; the Craven ask sooner', () => {
    expect(yieldThreshold(content, undefined, ['brave'], [])).toBe(0);
    expect(yieldThreshold(content, undefined, ['craven'], [])).toBeGreaterThan(yieldThreshold(content, undefined, [], []));
  });
});
