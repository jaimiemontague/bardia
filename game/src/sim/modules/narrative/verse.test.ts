import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { getVerseBank } from '@content/lines';
import { englishStrings } from '@content/locales/index';
import { validateEffects } from '@sim/core/effects';
import { checkInvariants } from '@sim/core/env';
import { Rng } from '@sim/core/rng';
import type { TextVars } from '@sim/core/state';
import { inDraft, testState } from '../../testing';
import { narrativeTestEnv } from './testing';
import type { ComposeVerseParams, VerseDeed, VerseLine } from './types';
import { composeVerseLines, resolveVerseLine, selectDeeds, type VerseLimits } from './verse';

const bank = getVerseBank();
const { env, module, content } = narrativeTestEnv();
const limits: VerseLimits = content.tunables.narrative.verse;
const base = testState({ modules: [module] });

const deeds: VerseDeed[] = [
  { kind: 'battle', importance: 5, vars: { place: 'Selvikmere', foe: 'Jarl Hroald' } },
  { kind: 'raid', importance: 3, vars: { place: 'Tarnwick' } },
  { kind: 'marriage', importance: 4, vars: { spouse: 'Asta' } },
  { kind: 'battle', importance: 4, vars: { place: 'Grimvoll', foe: 'the men of Vad' } },
  { kind: 'battle', importance: 4.5, vars: { place: 'Hrafnvik' } },
  { kind: 'feasting', importance: 1 },
];

function render(line: VerseLine): string {
  const strings = englishStrings();
  return resolveVerseLine(line, (key, vars?: Readonly<TextVars>) => {
    const msg = strings[key];
    if (msg === undefined) throw new Error(`missing ${key}`);
    return vars ? String(new IntlMessageFormat(msg, 'en').format(vars as Record<string, string | number>)) : msg;
  });
}

describe('composeVerseLines (pure)', () => {
  it('ranks deeds by importance under the diversity caps', () => {
    const picked = selectDeeds(deeds, 'yearEnd', limits);
    expect(picked.map((d) => d.kind)).toEqual(['battle', 'battle', 'marriage', 'raid']);
    expect(picked[1]?.vars?.place).toBe('Hrafnvik');
    const epitaph = selectDeeds(deeds, 'epitaph', limits);
    expect(epitaph).toHaveLength(5);
    expect(epitaph.filter((d) => d.kind === 'battle')).toHaveLength(2);
  });

  it('composes opening, deed lines and closing; deterministic for a seed', () => {
    const req = { kind: 'yearEnd' as const, deeds, subject: { name: 'Sigrun', sex: 'female' as const }, year: 813 };
    const a = composeVerseLines(bank, req, new Rng('verse-1'), limits);
    const b = composeVerseLines(bank, req, new Rng('verse-1'), limits);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1 + 4 + 1);
    expect(a[0]?.key.startsWith('narrative.verse.yearEnd.open.')).toBe(true);
    expect(a.at(-1)?.key.startsWith('narrative.verse.yearEnd.close.')).toBe(true);
    expect(a[1]?.key.startsWith('narrative.verse.deed.battle.')).toBe(true);
    for (const line of a) expect(render(line)).not.toMatch(/narrative\.|\{|\}/);
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => JSON.stringify(composeVerseLines(bank, req, new Rng(s), limits)));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('never repeats a kenning or a template within one verse while alternatives remain', () => {
    for (const seed of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']) {
      const lines = composeVerseLines(bank, { kind: 'epitaph', deeds, subject: { name: 'Ketil' } }, new Rng(seed), limits);
      const kennings = lines.flatMap((l) => l.keyVars.map((k) => l.vars[k] as string));
      expect(new Set(kennings).size).toBe(kennings.length);
      const keys = lines.map((l) => l.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('alliterates: kennings whose stave matches the place are strongly preferred', () => {
    const strong: VerseLimits = { ...limits, staveBonus: 10000 };
    for (const seed of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      const [, line] = composeVerseLines(bank, { kind: 'yearEnd', deeds: [{ kind: 'battle', vars: { place: 'Selvikmere', foe: 'Hroald' } }], year: 813 }, new Rng(seed), strong);
      if (line?.key === 'narrative.verse.deed.battle.fed') expect(line.vars.battleKenning).toBe('narrative.kenning.battle.spearStorm');
      if (line?.key === 'narrative.verse.deed.battle.stood') {
        expect(line.vars.bloodKenning).toBe('narrative.kenning.blood.swordDew');
        expect(line.vars.warriorKenning).toBe('narrative.kenning.warrior.shieldTree');
      }
    }
  });

  it('falls back to deed.default for unknown kinds or missing vars, and uses tiered epitaph closings', () => {
    const lines = composeVerseLines(bank, { kind: 'yearEnd', deeds: [{ kind: 'feasting' }, { kind: 'marriage' }], year: 813 }, new Rng('f'), limits);
    expect(lines.map((l) => l.key)).toEqual(expect.arrayContaining(['narrative.verse.deed.default.meter']));
    expect(lines.filter((l) => l.key === 'narrative.verse.deed.default.meter')).toHaveLength(2);
    const tier4 = composeVerseLines(bank, { kind: 'epitaph', deeds: [], subject: { name: 'Ketil' }, tier: 4 }, new Rng('t'), limits);
    expect(tier4.at(-1)?.key).toBe('narrative.verse.epitaph.close.tier4');
    const tier2 = composeVerseLines(bank, { kind: 'epitaph', deeds: [], subject: { name: 'Ketil' }, tier: 2 }, new Rng('t'), limits);
    expect(tier2.at(-1)?.key.startsWith('narrative.verse.epitaph.close.')).toBe(true);
    expect(tier2.at(-1)?.key).not.toMatch(/tier/);
    expect(render(tier4.at(-1) as VerseLine)).toMatch(/Ketil/);
  });
});

describe('composeVerse effect', () => {
  const params = (targetKey: string): ComposeVerseParams => ({ kind: 'yearEnd', deeds, targetKey, subject: { name: 'Sigrun' }, year: 812 });

  it('writes the verse for its requester and announces it', () => {
    const r = inDraft(base, env, (_d, ctx) => ctx.applyEffects([{ op: 'composeVerse', ...params('yearEnd:812') }]));
    const verse = r.state.storylets.verses?.['yearEnd:812'];
    expect(verse?.kind).toBe('yearEnd');
    expect(verse?.lines.length).toBe(6);
    expect(r.events.find((e) => e.type === 'VerseComposed')).toMatchObject({ targetKey: 'yearEnd:812', kind: 'yearEnd', lines: 6 });
    expect(checkInvariants(r.state, env)).toEqual([]);
    const again = inDraft(base, env, (_d, ctx) => ctx.applyEffects([{ op: 'composeVerse', ...params('yearEnd:812') }]));
    expect(again.state.storylets.verses).toEqual(r.state.storylets.verses);
  });

  it('validates its parameters', () => {
    expect(validateEffects(env, [{ op: 'composeVerse', ...params('ok') }])).toEqual([]);
    expect(validateEffects(env, [{ op: 'composeVerse', ...params('__proto__') }]).join()).toMatch(/targetKey/);
    expect(validateEffects(env, [{ op: 'composeVerse', kind: 'dirge', deeds: [], targetKey: 'x' }]).join()).toMatch(/kind/);
  });

  it('keeps at most maxStored verses, dropping the oldest', () => {
    const small = narrativeTestEnv({ tunables: { verse: { ...limits, maxStored: 2 } } });
    let s = testState({ modules: [small.module], content: small.content });
    for (const [i, key] of ['v1', 'v2', 'v3'].entries()) {
      s = inDraft(s, small.env, (d, ctx) => {
        d.time.hour = i * 10;
        ctx.applyEffects([{ op: 'composeVerse', ...params(key) }]);
      }).state;
    }
    expect(Object.keys(s.storylets.verses ?? {}).sort()).toEqual(['v2', 'v3']);
  });
});
