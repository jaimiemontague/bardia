import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { ATTRIBUTE_IDS, SKILL_IDS } from '@content/schemas/ids';
import { UPBRINGING_IDS } from '@content/schemas/upbringings';
import { Rng } from '@sim/core/rng';
import { GameSession } from '@sim/session';
import {
  attributeAllocCap,
  attributePointsAvailable,
  chosenTraits,
  firstInvalidStep,
  initialChoices,
  negativeTraitIds,
  previewCharacter,
  quickStartChoices,
  randomizeStep,
  recommendStep,
  reconcile,
  skillPointsAvailable,
  skillPointsSpent,
  toNewGameOptions,
  traitConflicts,
  validateStep,
  WIZARD_STEPS,
  withDifficulty,
  attributePointsSpent,
  type NewSagaChoices,
} from './model';
import type { JarldomOption } from './provinces';

const content = getContent();
const jarldoms: JarldomOption[] = [
  { provinceId: 'brimvik', name: 'Brimvik', culture: 'skarn', kingdomId: 'skarnheim', kingdomName: 'Skarnheim', capitalName: 'Brimhaven', capitalTier: 'town', tags: ['iron'], difficultyPips: 1 },
  { provinceId: 'kaldnes', name: 'Kaldnes', culture: 'skarn', kingdomId: 'skarnheim', kingdomName: 'Skarnheim', capitalName: 'Kaldby', capitalTier: 'village', tags: ['straits'], difficultyPips: 3 },
  { provinceId: 'lyngey', name: 'Lyngey', culture: 'eyjar', kingdomId: 'eyjamark', kingdomName: 'Eyjamark', capitalName: 'Lyngby', capitalTier: 'town', tags: [], difficultyPips: 2 },
];

function fresh(seed = 'wizard-test'): NewSagaChoices {
  return initialChoices(content, new Rng(seed));
}

describe('New Saga model (§5.1)', () => {
  it('starts with a complete, valid saga (random identity, recommended mechanics)', () => {
    const c = fresh();
    expect(c.name.length).toBeGreaterThan(0);
    expect(firstInvalidStep(c, content, jarldoms)).toBeNull();
    expect(skillPointsSpent(c)).toBe(skillPointsAvailable(c, content));
    expect(validateStep('confirm', c, content)).toEqual([]);
  });

  it('is deterministic for the same dice', () => {
    expect(fresh('same')).toEqual(fresh('same'));
    expect(quickStartChoices(content, new Rng('qs'), jarldoms)).toEqual(quickStartChoices(content, new Rng('qs'), jarldoms));
  });

  it('validates names', () => {
    const c = fresh();
    expect(validateStep('identity', { ...c, name: '  ' }, content)).toEqual(['menu.newSaga.issue.nameEmpty']);
    expect(validateStep('identity', { ...c, name: 'x'.repeat(40) }, content)).toEqual(['menu.newSaga.issue.nameLong']);
    expect(validateStep('identity', { ...c, name: 'Sig<run>' }, content)).toEqual(['menu.newSaga.issue.nameChars']);
    expect(validateStep('identity', { ...c, name: "Ás-Ketil O'Brann" }, content)).toEqual([]);
  });

  it('enforces skill and attribute budgets and creation caps', () => {
    const c = fresh();
    const zero = Object.fromEntries(SKILL_IDS.map((s) => [s, 0])) as NewSagaChoices['skills'];
    expect(validateStep('skills', { ...c, skills: zero }, content)).toContain('menu.newSaga.issue.skillsLeft');
    expect(validateStep('skills', { ...c, skills: { ...zero, melee: 5, archery: 4 } }, content)).toEqual(expect.arrayContaining(['menu.newSaga.issue.skillsOver', 'menu.newSaga.issue.skillCap']));
    const attrs = Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, 0])) as NewSagaChoices['attributes'];
    expect(validateStep('attributes', { ...c, attributes: attrs }, content)).toContain('menu.newSaga.issue.attributesLeft');
    expect(validateStep('attributes', { ...c, attributes: { ...attrs, might: attributeAllocCap(content) + 1 } }, content)).toContain('menu.newSaga.issue.attributeCap');
  });

  it('a flaw grants extra skill points; removing it reconciles the overspend', () => {
    const c = fresh();
    const flaw = negativeTraitIds(content).find((t) => !traitConflicts(t, chosenTraits(c, content), content)) as string;
    const withFlaw = recommendStep('skills', reconcile({ ...c, negativeTrait: flaw }, content), content, []);
    expect(skillPointsAvailable(withFlaw, content)).toBe(skillPointsAvailable(c, content) + content.balance.character.negativeTraitSkillPoints);
    expect(skillPointsSpent(withFlaw)).toBe(skillPointsAvailable(withFlaw, content));
    const without = reconcile({ ...withFlaw, negativeTrait: null }, content);
    expect(skillPointsSpent(without)).toBe(skillPointsAvailable(without, content));
  });

  it('rejects conflicting traits and traits the upbringing does not offer', () => {
    const c = { ...fresh(), upbringing: 'shieldBorn' as const, positiveTrait: 'brave', takeStartingTrait: false };
    expect(validateStep('trait', { ...c, negativeTrait: 'craven' }, content)).toContain('menu.newSaga.issue.traitConflict');
    const notOffered = Object.keys(content.traits).find((t) => content.traits[t]?.creation === 'positive' && !content.upbringings.shieldBorn.traitOptions.includes(t)) as string;
    expect(validateStep('trait', { ...c, positiveTrait: notOffered }, content)).toContain('menu.newSaga.issue.traitNotOffered');
    expect(reconcile({ ...c, positiveTrait: notOffered }, content).positiveTrait).toBeNull();
  });

  it('every Random and Recommended fill keeps (or makes) its step valid', () => {
    const rng = new Rng('fill');
    let c = fresh('fill-base');
    for (let round = 0; round < 25; round++) {
      for (const step of WIZARD_STEPS) {
        c = randomizeStep(step, c, content, rng, jarldoms);
        c = reconcile(c, content);
        if (step === 'skills' || step === 'attributes' || step === 'trait') expect(validateStep(step, c, content, jarldoms), `${step} random`).toEqual([]);
      }
      for (const step of WIZARD_STEPS) c = recommendStep(step, c, content, jarldoms);
      expect(firstInvalidStep(c, content, jarldoms)).toBeNull();
    }
  });

  it('changing difficulty keeps a complete allocation complete and the player toggles intact', () => {
    const hard = withDifficulty(recommendStep('skills', recommendStep('attributes', { ...fresh(), difficulty: 'longWinter' }, content, []), content, []), 'longWinter', content);
    const custom = { ...hard, toggles: { ...hard.toggles, ironman: true, harshWinters: true } };
    for (const id of ['hearthside', 'raider', 'seaKing', 'longWinter'] as const) {
      const next = withDifficulty(custom, id, content);
      expect(next.difficulty).toBe(id);
      expect(skillPointsSpent(next)).toBe(skillPointsAvailable(next, content));
      expect(attributePointsSpent(next)).toBe(attributePointsAvailable(next, content));
      expect(next.toggles.ironman).toBe(true);
      expect(next.toggles.harshWinters).toBe(true);
      expect(next.toggles.duelAssist).toBe(content.balance.difficulty[id].duelAssistDefault);
      expect(validateStep('skills', next, content)).toEqual([]);
      expect(validateStep('attributes', next, content)).toEqual([]);
    }
    // A half-finished allocation is not rearranged behind the player's back.
    const partial = { ...custom, skills: { ...custom.skills, command: 0, melee: 0 } };
    const spent = skillPointsSpent(partial);
    expect(skillPointsSpent(withDifficulty(partial, 'hearthside', content))).toBe(spent);
  });

  it('recommends a gentle jarldom in the chosen homeland, or fate when there is none', () => {
    const c = { ...fresh(), culture: 'skarn' as const };
    expect(recommendStep('jarldom', c, content, jarldoms).startProvinceId).toBe('brimvik');
    expect(recommendStep('jarldom', { ...c, culture: 'hvarn' }, content, jarldoms).startProvinceId).toBeNull();
    expect(validateStep('jarldom', { ...c, startProvinceId: 'lyngey' }, content, jarldoms)).toEqual(['menu.newSaga.issue.jarldom']);
  });

  it('previews final stats with each source broken out', () => {
    const c = { ...fresh(), culture: 'skarn' as const, upbringing: 'fisherFolk' as const, takeStartingTrait: true, positiveTrait: 'patient', negativeTrait: null };
    const p = previewCharacter(reconcile(c, content), content);
    const sea = p.skills.seafaring;
    expect(sea.upbringing).toBe(content.balance.character.upbringingSkillBonus);
    expect(sea.culture).toBe(1);
    expect(sea.total).toBe(sea.allocated + sea.upbringing + sea.culture + sea.traits);
    expect(p.attributes.might.base).toBe(content.balance.character.attributeStart);
    expect(p.traits).toContain(content.upbringings.fisherFolk.startingTrait);
  });

  it('maps onto NewGameOptions that create a game with the chosen identity', () => {
    const c = { ...quickStartChoices(content, new Rng('map'), jarldoms), name: ' Sigrun   Ash ', difficulty: 'seaKing' as const };
    const opts = toNewGameOptions(reconcile(c, content), content);
    expect(opts).toMatchObject({ difficulty: 'seaKing', player: { name: 'Sigrun Ash', sex: c.sex, culture: c.culture } });
    expect(Object.keys(opts.player?.creation?.skills ?? {}).sort()).toEqual([...SKILL_IDS].sort());
    expect(opts.player?.creation?.upbringing).toBe(c.upbringing);
    expect(JSON.parse(JSON.stringify(opts))).toEqual(opts);
    const session = GameSession.newGame(opts, { modules: [] });
    const st = session.getState();
    expect(st.characters[st.player.rulerId]?.name).toBe('Sigrun Ash');
    expect(st.meta.difficulty).toBe('seaKing');
    expect(st.meta.options.ironman).toBe(c.toggles.ironman);
  });

  it('every upbringing offers traits the wizard can show', () => {
    for (const u of UPBRINGING_IDS) {
      const c = recommendStep('trait', reconcile({ ...fresh(), upbringing: u }, content), content, []);
      expect(validateStep('trait', c, content)).toEqual([]);
    }
    expect(attributePointsAvailable(fresh(), content)).toBe(content.balance.difficulty.raider.attributePoints);
  });
});
