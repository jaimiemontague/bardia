import { getContent } from '@content/index';
import { missingLocaleKeys } from '@content/locales/index';
import { GOD_IDS } from '@content/schemas/ids';
import { schema as faithTunablesSchema } from '@content/schemas/tunables/faith';
import type { Command } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import { upgradeLoadedState } from '@sim/core/lifecycle';
import { Rng } from '@sim/core/rng';
import { advance } from '@sim/core/scheduler';
import type { FactionId, GameState, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY, HOURS_PER_MONTH } from '@sim/core/time';
import { inDraft, testEnv, testState, testWorld } from '@sim/testing';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deedGods } from './favor';
import { module as faith } from './index';

const content = getContent();
const t = content.tunables.faith;

describe('faith module wiring', () => {
  it('initialises a new game: house omens and chapels, the faith slice, AI Favor', () => {
    const w = testWorld({ modules: [faith], factions: 4 });
    const s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    expect(s.player.house.omens).toBeDefined();
    expect(s.player.house.chapels).toEqual([]);
    expect(s.faith?.wrathLevel).toBe(0);
    for (const id of w.factionIds) {
      const f = s.factions[id];
      if (id === s.player.factionId || !f) continue;
      if (f.faith === 'oldways') expect(Object.keys(f.favor ?? {}).sort()).toEqual([...GOD_IDS].sort());
      else expect(f.favor).toBeUndefined();
    }
    expect(checkInvariants(s, w.env)).toEqual([]);
  });

  it('catches up a save made before the module existed (init on load)', () => {
    const old = testState({ modules: [] });
    expect(old.faith).toBeUndefined();
    const up = upgradeLoadedState(old, testEnv([faith])).state;
    expect(up.faith).toBeDefined();
    expect(up.meta.moduleVersions['faith']).toBe(1);
    expect(up.player.house.omens).toEqual({});
    expect(checkInvariants(up, testEnv([faith]))).toEqual([]);
  });

  it('registers its own commands, effects and condition functions', () => {
    const env = testEnv([faith]);
    for (const c of ['sacrifice', 'readOmen', 'convertHouse', 'giveAlms', 'foundChapel']) expect(env.handlers.get(c)?.moduleId).toBe('faith');
    for (const e of ['faithDeed', 'changeFaithWrath', 'changePiety', 'buildChapel']) expect(env.effects.get(e)?.moduleId).toBe('faith');
    for (const f of ['favor', 'omen', 'faithWrath', 'piety', 'isConverted', 'hasChapel', 'canConvert', 'recentLanternContact']) {
      expect(env.conditionFns.get(f)?.moduleId).toBe('faith');
    }
    expect(validateEffects(env, [{ op: 'faithDeed', deed: 'pilgrimage' }, { op: 'changeFaithWrath', amount: -10 }, { op: 'buildChapel' }])).toEqual([]);
    expect(validateEffects(env, [{ op: 'faithDeed', deed: 'x', god: 'odin' }, { op: 'changePiety' }])).toHaveLength(2);
  });

  it('condition functions read the player’s faith', () => {
    const env = testEnv([faith]);
    const s = inDraft(testState({ modules: [faith] }), env, (d) => {
      d.player.house.favor.saltha = 17;
      d.player.house.omens = { voyage: { omen: 'ill', score: -3, readHour: 0, untilHour: 48 } };
    }).state;
    const ev = (name: string, args: (string | number)[] = []) => env.conditionFns.get(name)?.fn.evaluate(args, { state: s, env, scope: {} });
    expect(ev('favor', ['saltha'])).toBe(17);
    expect(ev('omen', ['voyage'])).toBe('ill');
    expect(ev('omen', ['battle'])).toBe('none');
    expect(ev('faithWrath')).toBe(0);
    expect(ev('isConverted')).toBe(false);
    expect(ev('hasChapel')).toBe(false);
    expect(ev('canConvert')).toBe(false);
    const expired = { ...s, time: { hour: 48 } };
    expect(env.conditionFns.get('omen')?.fn.evaluate(['voyage'], { state: expired, env, scope: {} })).toBe('none');
  });
});

describe('content', () => {
  it('the tunables validate and every favor deed reaches at least one god', () => {
    expect(faithTunablesSchema.safeParse(JSON.parse(readFileSync(new URL('../../../content/data/tunables/faith.json', import.meta.url), 'utf8'))).success).toBe(true);
    for (const [key, def] of Object.entries(t.deeds)) {
      if (def.amount !== undefined || def.balanceKey !== undefined) expect(deedGods(content, key, def).length, key).toBeGreaterThan(0);
    }
  });

  it('every deed, omen, wrath and error key has an English string', () => {
    const keys: string[] = [];
    for (const d of Object.keys(t.deeds)) keys.push(`faith.deed.${d}`);
    for (const a of ['voyage', 'battle', 'duel', 'harvest']) {
      for (const o of ['ill', 'uncertain', 'fair', 'blessed']) keys.push(`faith.omen.runes.${a}.${o}`, `faith.omen.signs.${a}.${o}`);
    }
    for (const l of ['sermons', 'muster', 'ban']) keys.push(`faith.wrath.rose.${l}`, `faith.wrath.fell.${l}`, `faith.chronicle.wrath.${l}`);
    for (const g of GOD_IDS) keys.push(`faith.god.${g}`);
    const errors = [
      'noRuler', 'notAtSettlement', 'notThere', 'notEnoughSilver', 'notEnoughLivestock', 'wrongFaith', 'noGrove', 'hostile',
      'noSeer', 'noPriest', 'seerCooldown', 'alreadyConverted', 'noChapel', 'lanternOpinionTooLow', 'notYourHolding', 'chapelExists',
    ];
    for (const e of errors) keys.push(`faith.error.${e}`);
    expect(missingLocaleKeys(keys)).toEqual([]);
    // Every CommandError code thrown in commands.ts / conversion.ts is listed above.
    const src = readFileSync(new URL('./commands.ts', import.meta.url), 'utf8') + readFileSync(new URL('./conversion.ts', import.meta.url), 'utf8');
    const thrown = [...src.matchAll(/CommandError\('([a-zA-Z]+)'/g), ...src.matchAll(/out\.push\('([a-zA-Z]+)'\)/g)].map((m) => m[1] as string);
    for (const code of thrown) expect(errors, code).toContain(code);
  });
});

/** A scripted campaign: random faith commands and foreign events over two years. */
function script(seed: string): { state: GameState; events: SimEvent[] } {
  const w = testWorld({ modules: [faith], factions: 5, seed });
  const rng = new Rng(`script|${seed}`);
  let s = w.state;
  const events: SimEvent[] = [];
  const lantern = w.factionIds.filter((id) => w.state.factions[id]?.faith === 'lantern');
  const cloister = w.settlementIds[lantern[0] as FactionId]?.[1] as SettlementId;
  s = inDraft(s, w.env, (d) => {
    const c = d.settlements[cloister];
    if (c) c.tier = 'cloister';
  }).state;
  const gods = GOD_IDS;
  for (let day = 0; day < 720; day += 3) {
    const roll = rng.int(0, 9);
    let cmd: Command | undefined;
    if (roll === 0) cmd = { type: 'readOmen' };
    else if (roll <= 2) cmd = { type: 'sacrifice', god: rng.pick(gods), kind: rng.chance(0.5) ? 'silver' : 'livestock', size: rng.pick(['modest', 'generous', 'lavish'] as const) };
    else if (roll === 3) cmd = { type: 'giveAlms', size: 'modest' };
    else if (roll === 4 && rng.chance(0.2)) cmd = { type: 'convertHouse' };
    if (cmd) {
      const r = dispatch(s, cmd, w.env);
      s = r.state;
      events.push(...r.events);
    }
    if (roll === 5) {
      const fate = rng.pick(['sackAndBurn', 'plunderAndLeave', 'takeCaptives', 'spare']);
      s = inDraft(s, w.env, (_d, ctx) => ctx.runAs('settlements', () => ctx.emit({ type: 'SettlementFate', settlementId: cloister, fate } as unknown as SimEvent))).state;
    }
    if (roll === 6) {
      const winner = rng.chance(0.5) ? 'attacker' : 'defender';
      const ev = { type: 'BattleEnded', attackerFactionId: s.player.factionId, defenderFactionId: w.factionIds[1], result: { winner, buildingsBurned: rng.int(0, 2) } };
      const r = inDraft(s, w.env, (_d, ctx) => ctx.runAs('battle', () => ctx.emit(ev as unknown as SimEvent)));
      s = r.state;
      events.push(...r.events);
    }
    if (roll === 7) {
      s = inDraft(s, w.env, (d, ctx) => {
        for (const id of lantern) ctx.applyEffects([{ op: 'changeOpinion', a: d.player.factionId, b: id, amount: 6, reason: 'script' }]);
        if (rng.chance(0.3)) ctx.applyEffects([{ op: 'buildChapel' }]);
      }).state;
    }
    const r = advance(s, 3 * HOURS_PER_DAY, w.env);
    s = r.state;
    events.push(...r.events);
    expect(checkInvariants(s, w.env), `day ${day}`).toEqual([]);
  }
  return { state: s, events };
}

describe('determinism and invariants', () => {
  it('the same seed and inputs give identical state and events', () => {
    const a = script('det-1');
    const b = script('det-1');
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(missingLocaleKeys(a.events.flatMap((e) => (e.type === 'Notification' || e.type === 'NarrationLine' ? [e.key] : e.type === 'ChronicleAdded' ? [e.entry.textKey] : [])))).toEqual([]);
  });

  it('different seeds diverge', () => {
    expect(JSON.stringify(script('det-2').state)).not.toBe(JSON.stringify(script('det-3').state));
  });
});
