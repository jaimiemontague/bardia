/**
 * The New Saga wizard's choices reach the game (§5.1): every choice made in the wizard is what the
 * new campaign's ruler, family, home and options turn out to be, and the wizard's preview agrees
 * with the created ruler. Runs the full module registry (people and world build the ruler).
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { ATTRIBUTE_IDS, SKILL_IDS } from '@content/schemas/ids';
import { UPBRINGING_IDS } from '@content/schemas/upbringings';
import { Rng } from '@sim/core/rng';
import type { Character, GameState } from '@sim/core/state';
import { GameSession } from '@sim/index';
import { effectiveAttribute, effectiveSkill } from '@sim/modules/people/util';
import { negativeTraitIds, previewCharacter, quickStartChoices, randomizeStep, reconcile, toNewGameOptions, traitConflicts, chosenTraits, validateStep, WIZARD_STEPS, type NewSagaChoices } from './model';
import { bundledJarldoms } from './provinces';

const content = getContent();
const jarldoms = bundledJarldoms();

function ruler(st: GameState): Character {
  const c = st.characters[st.player.rulerId];
  if (!c) throw new Error('no ruler');
  return c;
}

/** A fully random but valid saga (every step's "Random"). */
function randomChoices(seed: string): NewSagaChoices {
  const rng = new Rng(seed);
  let c = quickStartChoices(content, rng, jarldoms);
  for (const step of WIZARD_STEPS) c = randomizeStep(step, c, content, rng, jarldoms);
  // A flaw or a new preset changes the budgets: spend them again last, as a player would.
  c = randomizeStep('skills', reconcile(c, content), content, rng, jarldoms);
  c = randomizeStep('attributes', c, content, rng, jarldoms);
  return reconcile(c, content);
}

function expectAgreement(c: NewSagaChoices): Character {
  expect(validateStep('confirm', c, content, jarldoms)).toEqual([]);
  const preview = previewCharacter(c, content);
  const st = GameSession.newGame(toNewGameOptions(c, content)).getState();
  const r = ruler(st);
  for (const s of SKILL_IDS) {
    expect(r.skills[s], s).toBe(preview.skills[s].stored);
    expect(effectiveSkill(r, s, content), s).toBe(preview.skills[s].total);
  }
  for (const a of ATTRIBUTE_IDS) {
    expect(r.attributes[a], a).toBe(preview.attributes[a].stored);
    expect(effectiveAttribute(r, a, content), a).toBe(preview.attributes[a].total);
  }
  expect([...r.traits].sort()).toEqual([...preview.traits].sort());
  expect(r.upbringingId).toBe(c.upbringing);
  expect(r.name).toBe(c.name.replace(/\s+/g, ' ').trim());
  expect(r.sex).toBe(c.sex);
  expect(r.culture).toBe(c.culture);
  expect(r.portrait.seed).toBe(c.portrait.seed);
  expect(st.player.creation?.applied).toBe(true);
  // The slain parent.
  const father = r.family.fatherId !== undefined ? st.characters[r.family.fatherId] : undefined;
  const mother = r.family.motherId !== undefined ? st.characters[r.family.motherId] : undefined;
  const slain = c.slainParent === 'father' ? father : mother;
  const survivor = c.slainParent === 'father' ? mother : father;
  expect(slain?.alive).toBe(false);
  expect(survivor?.alive).toBe(true);
  // Difficulty, toggles, seed and the chosen jarldom.
  expect(st.meta.difficulty).toBe(c.difficulty);
  expect(st.meta.seed).toBe(c.seed.trim());
  for (const [k, v] of Object.entries(c.toggles)) expect(st.meta.options[k as keyof typeof st.meta.options], k).toBe(v);
  if (c.startProvinceId !== null) {
    const capital = st.settlements[st.player.capitalId];
    expect(capital?.provinceId).toBe(st.worldIndex?.provinceByGeoId[c.startProvinceId]);
  }
  return r;
}

describe('New Saga choices reach the game', () => {
  it('the wizard preview and the created ruler agree for random sagas', () => {
    for (const seed of ['agree-1', 'agree-2', 'agree-3', 'agree-4', 'agree-5', 'agree-6']) expectAgreement(randomChoices(seed));
  });

  it('a hand-made saga: upbringing, starting trait, virtue, flaw, slain mother, chosen jarldom', () => {
    let c = randomChoices('hand');
    const upbringing = 'seerTouched';
    c = reconcile({ ...c, upbringing, takeStartingTrait: true, positiveTrait: content.upbringings[upbringing].traitOptions[0] ?? null, slainParent: 'mother' }, content);
    const flaw = negativeTraitIds(content).find((t) => !traitConflicts(t, chosenTraits({ ...c, negativeTrait: null }, content), content)) ?? null;
    c = reconcile({ ...c, negativeTrait: flaw, skills: { ...c.skills } }, content);
    // Spend the flaw's extra points on runecraft so the budget is exact.
    const mine = jarldoms.filter((j) => j.culture === c.culture);
    c = { ...c, startProvinceId: mine[mine.length - 1]?.provinceId ?? null };
    const left = SKILL_IDS.reduce((s, k) => s - c.skills[k], content.balance.difficulty[c.difficulty].skillPoints + (flaw ? content.balance.character.negativeTraitSkillPoints : 0));
    let skills = { ...c.skills };
    for (let i = 0; i < left; i++) {
      const open = SKILL_IDS.find((k) => skills[k] < content.balance.character.skillCreationCap);
      if (open) skills = { ...skills, [open]: skills[open] + 1 };
    }
    c = { ...c, skills };
    const r = expectAgreement(c);
    expect(r.traits).toContain(content.upbringings[upbringing].startingTrait);
    if (flaw) expect(r.traits).toContain(flaw);
    expect(r.skills.runecraft).toBeGreaterThanOrEqual(content.balance.character.upbringingSkillBonus);
  });

  it('Quick Start makes varied, complete rulers through the same path', () => {
    const ups = new Set<string>();
    const traits = new Set<string>();
    for (const seed of ['qs-1', 'qs-2', 'qs-3', 'qs-4', 'qs-5', 'qs-6', 'qs-7', 'qs-8']) {
      const c = quickStartChoices(content, new Rng(seed), jarldoms);
      const r = expectAgreement(c);
      expect(SKILL_IDS.reduce((s, k) => s + r.skills[k], 0)).toBeGreaterThan(0);
      expect(r.traits.length).toBeGreaterThan(0);
      ups.add(r.upbringingId ?? '');
      for (const t of r.traits) traits.add(t);
    }
    expect(ups.size).toBeGreaterThan(2);
    expect(traits.size).toBeGreaterThan(3);
    expect([...ups].every((u) => (UPBRINGING_IDS as readonly string[]).includes(u))).toBe(true);
  });

  it('a game created without creation choices keeps the old behaviour', () => {
    const st = GameSession.newGame({ seed: 'no-creation', player: { name: 'Sigrun' } }).getState();
    const r = ruler(st);
    expect(st.player.creation).toBeUndefined();
    expect(r.upbringingId).toBeUndefined();
    expect(SKILL_IDS.every((s) => r.skills[s] === 0)).toBe(true);
  });

  it('the record survives a save round trip and is not applied twice', () => {
    const c = quickStartChoices(content, new Rng('round'), jarldoms);
    const s = GameSession.newGame(toNewGameOptions(c, content));
    const blob = s.save();
    const loaded = GameSession.load(blob);
    expect(loaded.save()).toBe(blob);
    expect(ruler(loaded.getState()).skills).toEqual(ruler(s.getState()).skills);
  });
});
