import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { MANIFEST_FRAGMENTS } from '@content/assets/index';
import { getLinePools, getVerseBank, RAW_LINE_PACKS, RAW_VERSE_BANK, validateLinePacks, validateVerseBank } from '@content/lines';
import { englishStrings, missingLocaleKeys } from '@content/locales/index';
import { getStorylets, RAW_STORYLET_PACKS, validateStoryletPacks } from '@content/storylets';
import { validateNarrativeContent } from './api';
import { buildLibrary, bundledContent, STANDARD_VARS } from './library';
import { choice, narrativeTestEnv, storylet } from './testing';
import type { StoryletSpec } from './types';

const { env } = narrativeTestEnv();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Standard vars an instance of this scope always has. */
function varsFor(def: StoryletSpec): Record<string, string | number> {
  const vars: Record<string, string | number> = { rulerName: 'Sigrun', rulerSex: 'female', capitalName: 'Hvalnes', year: 812, season: 'winter' };
  if (def.scope === 'holding') Object.assign(vars, { holdingName: 'Hvalnes', settlementName: 'Hvalnes', factionName: 'House' });
  if (def.scope === 'settlement') Object.assign(vars, { settlementName: 'Hvalnes', factionName: 'House' });
  if (def.scope === 'faction') Object.assign(vars, { factionName: 'House' });
  if (def.scope === 'character') Object.assign(vars, { characterName: 'Ketil', characterSex: 'male' });
  if (def.scope === 'fleet') Object.assign(vars, { fleetLeaderName: 'Ketil', factionName: 'House' });
  for (const name of Object.keys(def.vars ?? {})) vars[name] = 12;
  return vars;
}

function storyletKeys(def: StoryletSpec): string[] {
  const keys = [def.textKey];
  if (def.titleKey) keys.push(def.titleKey);
  if (def.chronicleKey) keys.push(def.chronicleKey);
  for (const c of def.choices) {
    keys.push(c.labelKey);
    if (c.previewKey) keys.push(c.previewKey);
    if (c.chronicleKey) keys.push(c.chronicleKey);
    for (const e of c.effects) if (e.op === 'narrate' || e.op === 'notify') keys.push(String((e as { key: unknown }).key));
  }
  return keys;
}

describe('bundled narrative content', () => {
  it('ships at least six storylets and two line pools, all valid against core + narrative', () => {
    expect(getStorylets().length).toBeGreaterThanOrEqual(6);
    expect(getLinePools().length).toBeGreaterThanOrEqual(2);
    expect(validateNarrativeContent(env)).toEqual([]);
    const lib = buildLibrary(env, bundledContent());
    expect(lib.storylets.all.length).toBe(getStorylets().length);
    expect(Object.keys(lib.pools).sort()).toEqual(['keeper.greeting', 'smith.greeting']);
  });

  it('covers holding petitions, a player storylet, a fleet trigger, an event trigger, scheduling and follow-ups', () => {
    const defs = bundledContent().storylets;
    expect(defs.some((d) => d.scope === 'holding' && d.trigger === 'monthly' && d.defaultChoice !== undefined && d.expiresInDays !== undefined)).toBe(true);
    expect(defs.some((d) => d.scope === 'player' && d.trigger === 'monthly')).toBe(true);
    expect(defs.some((d) => d.scope === 'fleet' && d.trigger === 'onVoyageDay')).toBe(true);
    expect(defs.some((d) => d.trigger === 'onBattleEnd')).toBe(true);
    expect(defs.some((d) => d.choices.some((c) => c.followUp !== undefined))).toBe(true);
    expect(defs.some((d) => d.choices.some((c) => c.effects.some((e) => e.op === 'scheduleStorylet')))).toBe(true);
  });

  it('every text key has an English string, and every message formats with the vars its storylet provides', () => {
    const strings = englishStrings();
    const problems: string[] = [];
    for (const def of bundledContent().storylets) {
      const keys = storyletKeys(def);
      for (const k of missingLocaleKeys(keys)) problems.push(`${def.id}: missing ${k}`);
      for (const key of keys) {
        const msg = strings[key];
        if (msg === undefined) continue;
        try {
          new IntlMessageFormat(msg, 'en').format(varsFor(def));
        } catch (e) {
          problems.push(`${def.id}: ${key}: ${(e as Error).message}`);
        }
      }
    }
    for (const pool of getLinePools()) {
      for (const line of pool.lines) {
        const msg = strings[line.textKey];
        if (msg === undefined) problems.push(`${pool.id}: missing ${line.textKey}`);
        else new IntlMessageFormat(msg, 'en').format({ rulerName: 'Sigrun', rulerSex: 'female', settlementName: 'X', characterName: 'Y' });
      }
    }
    for (const key of ['narrative.notify.inbox', 'narrative.notify.delegated', 'narrative.notify.expired', 'narrative.notify.lapsed', 'narrative.notify.failed']) {
      if (strings[key] === undefined) problems.push(`missing ${key}`);
    }
    expect(problems).toEqual([]);
    expect(STANDARD_VARS).toContain('holdingName');
  });

  it('verse templates use only their slots and needed vars; every kenning has a string', () => {
    const strings = englishStrings();
    const bank = getVerseBank();
    const problems: string[] = [];
    for (const [group, templates] of Object.entries(bank.templates)) {
      for (const t of templates) {
        const msg = strings[t.key];
        if (msg === undefined) {
          problems.push(`${group}: missing ${t.key}`);
          continue;
        }
        const vars: Record<string, string | number> = {};
        for (const slot of Object.keys(t.slots ?? {})) vars[slot] = 'the whale-road';
        for (const need of t.needs ?? []) vars[need] = need === 'year' ? 812 : 'X';
        try {
          new IntlMessageFormat(msg, 'en').format(vars);
        } catch (e) {
          problems.push(`${t.key}: ${(e as Error).message}`);
        }
      }
    }
    for (const [b, entries] of Object.entries(bank.kennings)) for (const k of entries) if (strings[k.key] === undefined) problems.push(`kenning ${b}: missing ${k.key}`);
    expect(problems).toEqual([]);
  });

  it('every illustration is an asset-manifest id of the narrative fragment', () => {
    const manifest = MANIFEST_FRAGMENTS.narrative as Record<string, { kind: string }>;
    for (const def of bundledContent().storylets) {
      if (def.illustration === undefined) continue;
      expect({ id: def.id, kind: manifest[def.illustration]?.kind }).toEqual({ id: def.id, kind: 'image' });
    }
  });

  it('stays in the grounded register: no fantasy beings or working magic in the English text', () => {
    const strings = englishStrings();
    const narrative = Object.entries(strings).filter(([k]) => k.startsWith('narrative.'));
    const banned = /\b(dragon|troll|draugr?|undead|ghost|wraith|giant|elf|elves|dwarf|wizard|witch|spell|curse[sd]?|magic|monster)\b/i;
    expect(narrative.filter(([, v]) => banned.test(v)).map(([k]) => k)).toEqual([]);
  });
});

describe('pack validation rejects bad content', () => {
  it('storylet packs: schema, duplicates, defaultChoice, expiry, follow-ups', () => {
    const bad = clone(RAW_STORYLET_PACKS) as Record<string, { storylets: Record<string, unknown>[] }>;
    const petitions = bad.petitions as { storylets: Record<string, unknown>[] };
    petitions.storylets.push({ ...(petitions.storylets[0] as object) });
    (petitions.storylets[1] as Record<string, unknown>).defaultChoice = 9;
    (petitions.storylets[1] as Record<string, unknown>).typo = true;
    const personal = bad.personal as { storylets: Record<string, unknown>[] };
    (personal.storylets[0] as Record<string, unknown>).expiresInDays = 5;
    ((personal.storylets[0] as { choices: Record<string, unknown>[] }).choices[0] as Record<string, unknown>).followUp = 'nowhere';
    const r = validateStoryletPacks(bad);
    const text = r.issues.join('\n');
    expect(text).toMatch(/petitions: storylets\.1: Unrecognized key/);
    const r2 = validateStoryletPacks({ ...bad, petitions: { storylets: [petitions.storylets[0], petitions.storylets[0]] } });
    const text2 = r2.issues.join('\n');
    expect(text2).toMatch(/duplicate storylet id/);
    expect(text2).toMatch(/expiresInDays needs a defaultChoice/);
    expect(text2).toMatch(/follows up unknown storylet 'nowhere'/);
    const r3 = validateStoryletPacks({ x: { storylets: [{ ...(clone(petitions.storylets[0]) as object), defaultChoice: 9 }] } });
    expect(r3.issues.join('\n')).toMatch(/defaultChoice 9 is out of range/);
    expect(validateStoryletPacks({ x: { storylets: [{ id: 'Bad Id' }] } }).issues.join('\n')).toMatch(/camelCase/);
  });

  it('line packs and the verse bank: duplicates, ids, unknown banks, missing groups', () => {
    const bad = clone(RAW_LINE_PACKS) as Record<string, { pools: { id: string; lines: { id: string }[] }[] }>;
    const smith = bad.smith as { pools: { id: string; role?: string; lines: { id: string }[] }[] };
    (smith.pools[0] as { lines: { id: string }[] }).lines.push({ ...((smith.pools[0] as { lines: { id: string }[] }).lines[0] as { id: string }) });
    expect(validateLinePacks(bad).issues.join('\n')).toMatch(/duplicate line id 'sparks'/);
    expect(validateLinePacks({ a: RAW_LINE_PACKS.smith, b: RAW_LINE_PACKS.smith }).issues.join('\n')).toMatch(/duplicate pool 'smith.greeting'/);
    const mismatched = clone(RAW_LINE_PACKS.smith) as { pools: { role: string }[] };
    (mismatched.pools[0] as { role: string }).role = 'keeper';
    expect(validateLinePacks({ a: mismatched }).issues.join('\n')).toMatch(/role\.context/);
    const vb = clone(RAW_VERSE_BANK) as { templates: Record<string, { slots?: Record<string, string> }[]> };
    delete vb.templates['deed.default'];
    ((vb.templates['deed.battle'] as { slots?: Record<string, string> }[])[0] as { slots: Record<string, string> }).slots = { bird: 'dragons' };
    const v = validateVerseBank(vb).issues.join('\n');
    expect(v).toMatch(/missing template group 'deed.default'/);
    expect(v).toMatch(/unknown kenning bank 'dragons'/);
  });

  it('the library rejects bad expressions, effects, placeholders, triggers and scopes (and excludes them)', () => {
    const defs: StoryletSpec[] = [
      storylet({ id: 'badWhen', when: 'settlement.pop > ', trigger: 'monthly', scope: 'holding' }),
      storylet({ id: 'badPath', when: 'holding.loyality > 3', trigger: 'monthly', scope: 'holding' }),
      storylet({ id: 'badScope', scope: 'kingdom' as StoryletSpec['scope'] }),
      storylet({ id: 'badTrigger', trigger: 'onFullMoon' as StoryletSpec['trigger'] }),
      storylet({ id: 'badOp', choices: [choice({ effects: [{ op: 'summonSpirits' }] })] }),
      storylet({ id: 'badParams', choices: [choice({ effects: [{ op: 'addSilver', amount: 'lots' }] })] }),
      storylet({ id: 'unboundPlaceholder', choices: [choice({ effects: [{ op: 'changeLoyalty', amount: 1, settlementId: '$holding' }] })] }),
      storylet({ id: 'unknownPlaceholder', scope: 'holding', choices: [choice({ effects: [{ op: 'changeLoyalty', amount: 1, settlementId: '$holdng' }] })] }),
      storylet({ id: 'unknownVar', trigger: 'monthly', choices: [choice({ effects: [{ op: 'addSilver', amount: { $var: 'cost' } }] })] }),
      storylet({ id: 'badExprEffect', choices: [choice({ effects: [{ op: 'addSilver', amount: { $expr: 'house.renon * 2' } }] })] }),
      storylet({ id: 'randInChoice', choices: [choice({ when: 'rand() < 0.5' })] }),
      storylet({ id: 'eventInMonthly', trigger: 'monthly', when: 'event.x == 1' }),
      storylet({ id: 'badFollowUp', choices: [choice({ followUp: 'badWhen' })] }),
      storylet({ id: 'shadowVar', vars: { rulerName: '1' } }),
      storylet({ id: 'okHolding', scope: 'holding', trigger: 'monthly', vars: { cost: 'floor(holding.pop / 10)' }, choices: [choice({ effects: [{ op: 'addSilver', amount: { $var: 'cost' } }, { op: 'changeLoyalty', amount: 1, settlementId: '$holding' }] })] }),
    ];
    const lib = buildLibrary(env, { storylets: defs, pools: [], verse: getVerseBank() });
    const text = lib.issues.join('\n');
    expect(text).toMatch(/badWhen when: syntax/);
    expect(text).toMatch(/badPath when: .*'loyality'.*did you mean 'loyalty'/);
    expect(text).toMatch(/badScope: unknown scope 'kingdom'/);
    expect(text).toMatch(/badTrigger: unknown trigger 'onFullMoon'/);
    expect(text).toMatch(/badOp choice 0 effects\[0\]: unknown effect op 'summonSpirits'/);
    expect(text).toMatch(/badParams choice 0 effects\[0\] \(addSilver\): amount/);
    expect(text).toMatch(/unboundPlaceholder choice 0 effect 0: settlementId: '\$holding' is not bound/);
    expect(text).toMatch(/unknownPlaceholder choice 0 effect 0: settlementId: unknown placeholder '\$holdng'/);
    expect(text).toMatch(/unknownVar choice 0 effect 0: amount: unknown variable 'cost'/);
    expect(text).toMatch(/badExprEffect choice 0 effect 0: amount \$expr/);
    expect(text).toMatch(/randInChoice choice 0 when: .*rand\(\) is not allowed/);
    expect(text).toMatch(/eventInMonthly when: .*'event' is not available/);
    expect(text).toMatch(/badFollowUp choice 0: follow-up 'badWhen' is excluded/);
    expect(text).toMatch(/shadowVar vars\.rulerName: shadows a standard variable/);
    expect(text).not.toMatch(/okHolding/);
    expect(Object.keys(lib.storylets.byId).sort()).toEqual(['badFollowUp', 'okHolding']);
  });
});
