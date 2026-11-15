import { getContent } from '@content/index';
import { testState } from '@sim/testing';
import type { RulerCreation } from '@sim/core/state';
import { describe, expect, it } from 'vitest';
import { buildCreation, creationTraits } from './creation';
import { module } from './index';

const content = getContent();
const ch = content.balance.character;

const choices: RulerCreation = {
  upbringing: 'fisherFolk',
  takeStartingTrait: true,
  positiveTrait: content.upbringings.fisherFolk.traitOptions[0] ?? null,
  negativeTrait: 'craven',
  skills: { seafaring: 4, command: 3, melee: 3 },
  attributes: { vigor: 2, wits: 1 },
  slainParent: 'mother',
};

describe('the first ruler from the New Saga choices (§5.1)', () => {
  it('stores allocation + upbringing + homeland bonuses; traits stay modifiers', () => {
    const r = buildCreation(content, 'skarn', choices);
    expect(r.upbringing).toBe('fisherFolk');
    const sea = r.skills.seafaring;
    expect(sea.allocated).toBe(4);
    expect(sea.upbringing).toBe(ch.upbringingSkillBonus);
    expect(sea.culture).toBe(1); // Skarn: Fjord-born
    expect(sea.stored).toBe(4 + ch.upbringingSkillBonus + 1);
    expect(sea.total).toBe(Math.min(ch.skillMax, sea.stored + sea.traits));
    expect(r.attributes.vigor.stored).toBe(ch.attributeStart + 2);
    expect(r.traits).toContain(content.upbringings.fisherFolk.startingTrait);
    expect(r.traits).toContain('craven');
  });

  it('rejects what the wizard would not offer: unknown ids, virtues from other upbringings, opposed flaws, over-cap points', () => {
    const other = content.upbringings.shieldBorn.traitOptions.find((t) => !content.upbringings.fisherFolk.traitOptions.includes(t));
    expect(creationTraits(content, { upbringing: 'fisherFolk', positiveTrait: other ?? null })).toEqual([]);
    expect(creationTraits(content, { upbringing: 'nope', takeStartingTrait: true, positiveTrait: 'brave' })).toEqual([]);
    expect(creationTraits(content, { upbringing: 'shieldBorn', positiveTrait: 'brave', negativeTrait: 'craven' })).toEqual(['brave']);
    expect(creationTraits(content, { negativeTrait: 'brave' })).toEqual([]);
    const r = buildCreation(content, 'skarn', { skills: { melee: 99 }, attributes: { might: 99 } });
    expect(r.skills.melee.allocated).toBe(ch.skillCreationCap);
    expect(r.attributes.might.stored).toBe(ch.attributeCreationCap);
  });

  it('init builds the ruler once from player.creation', () => {
    const st = testState({ modules: [module], player: { name: 'Sigrun', culture: 'skarn', creation: choices } });
    const ruler = st.characters[st.player.rulerId];
    const r = buildCreation(content, 'skarn', choices);
    expect(ruler?.skills).toEqual(Object.fromEntries(Object.entries(r.skills).map(([k, v]) => [k, v.stored])));
    expect(ruler?.attributes.vigor).toBe(r.attributes.vigor.stored);
    expect(ruler?.traits).toEqual(r.traits);
    expect(ruler?.upbringingId).toBe('fisherFolk');
    expect(st.player.creation?.applied).toBe(true);
  });

  it('leaves a game without creation choices alone', () => {
    const st = testState({ modules: [module] });
    expect(st.player.creation).toBeUndefined();
    expect(st.characters[st.player.rulerId]?.upbringingId).toBeUndefined();
  });
});
