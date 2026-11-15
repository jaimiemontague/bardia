import { describe, expect, it } from 'vitest';
import { checkInvariants } from '@sim/core/env';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import type { SimEnv } from '@sim/core/module';
import { advance } from '@sim/core/scheduler';
import type { FactionId, FleetId, GameState, PendingDecisionOf, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR } from '@sim/core/time';
import { inDraft, missingEventKeys } from '../../testing';
import { storyletInbox, storyletView } from './api';
import { choice, narrativeWorld, storylet, type TunablesOverride } from './testing';
import type { StoryletSpec } from './types';

const ALWAYS: TunablesOverride = {
  monthly: {
    player: { chance: 1, max: 1 },
    holding: { chance: 1, max: 1 },
    settlement: { chance: 1, max: 1 },
    faction: { chance: 1, max: 1 },
    character: { chance: 1, max: 1 },
    fleet: { chance: 1, max: 1 },
  },
  triggerChance: { onArrival: 1, onSeasonStart: 1, onVoyageDay: 1, onNewsHeard: 1, onRelationThreshold: 1 },
  triggerChanceDefault: 1,
};

function world(defs: StoryletSpec[], tunables: TunablesOverride = {}, settlementsPerFaction = 1) {
  return narrativeWorld({ storylets: defs, tunables: { ...ALWAYS, ...tunables }, settlementsPerFaction });
}

function pendingStorylet(state: GameState): PendingDecisionOf<'storylet'> {
  const p = state.pending;
  if (!p || p.kind !== 'storylet') throw new Error(`expected a storylet decision, got ${p?.kind ?? 'none'}`);
  return p;
}

function choose(state: GameState, env: SimEnv, instanceId: string, c: number | 'default' | 'later') {
  return dispatch(state, { type: 'storyletChoice', instanceId, choice: c }, env);
}

function ok(state: GameState, env: SimEnv, instanceId: string, c: number | 'default' | 'later'): { state: GameState; events: SimEvent[] } {
  const r = choose(state, env, instanceId, c);
  if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}

function emitEvent(state: GameState, env: SimEnv, type: string, payload: Record<string, unknown>) {
  return inDraft(state, env, (_d, ctx) => ctx.emit({ type, ...payload } as unknown as SimEvent));
}

function capitalOf(state: GameState): SettlementId {
  return state.player.capitalId;
}

function loyalty(state: GameState, id: SettlementId): number {
  return state.settlements[id]?.holding?.loyalty ?? Number.NaN;
}

const petition = (extra: Partial<StoryletSpec> = {}): StoryletSpec =>
  storylet({
    id: 'testPetition',
    scope: 'holding',
    trigger: 'monthly',
    cooldownDays: 60,
    expiresInDays: 10,
    defaultChoice: 1,
    titleKey: 'narrative.test.title',
    vars: { cost: 'floor(holding.pop / 100)' },
    choices: [
      choice({ labelKey: 'narrative.test.pay', when: 'player.treasury >= vars.cost', effects: [{ op: 'addSilver', amount: { $expr: '-vars.cost' } }, { op: 'changeLoyalty', amount: 5, settlementId: '$holding' }] }),
      choice({ labelKey: 'narrative.test.steward', effects: [{ op: 'changeLoyalty', amount: 1, settlementId: '$holding' }] }),
      choice({ labelKey: 'narrative.test.never', when: 'false', effects: [] }),
    ],
    ...extra,
  });

describe('monthly storylets and the storylet decision', () => {
  it('raises a storylet decision on the month boundary with resolved keys, vars and choice views', () => {
    const w = world([petition()]);
    const r = advance(w.state, HOURS_PER_MONTH, w.env);
    expect(r.hoursAdvanced).toBe(HOURS_PER_MONTH);
    const p = pendingStorylet(r.state);
    const cap = r.state.settlements[capitalOf(r.state)];
    expect(p.source).toBe('narrative');
    expect(p.payload).toMatchObject({
      storyletId: 'testPetition',
      scope: { kind: 'holding', id: capitalOf(r.state) },
      textKey: 'narrative.test.text',
      titleKey: 'narrative.test.title',
      defaultChoice: 1,
      canDefer: true,
      vars: { holdingName: cap?.name, cost: Math.floor((cap?.pop ?? 0) / 100), year: 812 },
    });
    expect(p.payload.choices?.map((c) => c.available)).toEqual([true, true, false]);
    const fired = r.events.find((e) => e.type === 'StoryletFired');
    expect(fired).toMatchObject({ storyletId: 'testPetition', delivery: 'pending', trigger: 'monthly' });
    expect(r.state.storylets.cooldowns.testPetition).toBe(HOURS_PER_MONTH + 60 * HOURS_PER_DAY);
    expect(checkInvariants(r.state, w.env)).toEqual([]);
  });

  it('applies the chosen effects with placeholders, clears the decision and lets time run again', () => {
    const w = world([petition()]);
    const s1 = advance(w.state, HOURS_PER_MONTH, w.env).state;
    const p = pendingStorylet(s1);
    const cost = p.payload.vars.cost as number;
    const before = { silver: s1.factions[s1.player.factionId]?.treasury ?? 0, loyalty: loyalty(s1, capitalOf(s1)) };
    const r = ok(s1, w.env, p.payload.instanceId as string, 0);
    expect(r.state.pending).toBeNull();
    expect(r.state.factions[r.state.player.factionId]?.treasury).toBe(before.silver - cost);
    expect(loyalty(r.state, capitalOf(r.state))).toBe(Math.min(100, before.loyalty + 5));
    expect(r.events.find((e) => e.type === 'StoryletResolved')).toMatchObject({ storyletId: 'testPetition', choice: 0, how: 'chosen' });
    expect(Object.keys(r.state.storylets.instances ?? {})).toEqual([]);
    expect(checkInvariants(r.state, w.env)).toEqual([]);
    const next = advance(r.state, HOURS_PER_DAY, w.env);
    expect(next.hoursAdvanced).toBe(HOURS_PER_DAY);
  });

  it('respects cooldowns: not next month, again once the cooldown has run out', () => {
    const w = world([petition()]);
    let s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    s = ok(s, w.env, pendingStorylet(s).payload.instanceId as string, 1).state;
    const m2 = advance(s, HOURS_PER_MONTH, w.env);
    expect(m2.state.pending).toBeNull();
    expect(m2.hoursAdvanced).toBe(HOURS_PER_MONTH);
    const m3 = advance(m2.state, HOURS_PER_MONTH, w.env);
    expect(pendingStorylet(m3.state).payload.storyletId).toBe('testPetition');
  });

  it('respects `once` and the scope budget chance', () => {
    const once = storylet({ id: 'testOnce', trigger: 'monthly', once: true, cooldownDays: 0 });
    const w = world([once]);
    let s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    s = ok(s, w.env, pendingStorylet(s).payload.instanceId as string, 0).state;
    expect(s.storylets.onceFired).toEqual(['testOnce']);
    const later = advance(s, 6 * HOURS_PER_MONTH, w.env);
    expect(later.state.pending).toBeNull();
    const never = world([storylet({ id: 'testNever', trigger: 'monthly' })], { monthly: { player: { chance: 0, max: 1 } } });
    expect(advance(never.state, 3 * HOURS_PER_MONTH, never.env).state.pending).toBeNull();
  });

  it('honours conditions: a false `when` never fires', () => {
    const w = world([storylet({ id: 'testNo', trigger: 'monthly', when: 'house.renown > 1000' })]);
    expect(advance(w.state, 3 * HOURS_PER_MONTH, w.env).state.pending).toBeNull();
  });

  it('draws by weight (deterministically for a seed)', () => {
    const light = storylet({ id: 'testLight', scope: 'holding', trigger: 'onEnterBuilding', weight: 1, cooldownDays: 0, defaultChoice: 0 });
    const heavy = storylet({ id: 'testHeavy', scope: 'holding', trigger: 'onEnterBuilding', weight: 9, cooldownDays: 0, defaultChoice: 0 });
    const w = world([light, heavy]);
    const s = dispatch(w.state, { type: 'setPolicy', policy: 'petitions', value: 'delegate' }, w.env).state;
    const run = () =>
      inDraft(s, w.env, (_d, ctx) => {
        for (let i = 0; i < 400; i++) ctx.applyEffects([{ op: 'fireStoryletTrigger', trigger: 'onEnterBuilding', scope: { kind: 'holding', id: s.player.capitalId } }]);
      }).events.filter((e) => e.type === 'StoryletFired');
    const fired = run();
    expect(fired).toHaveLength(400);
    const heavyShare = fired.filter((e) => e.type === 'StoryletFired' && e.storyletId === 'testHeavy').length / 400;
    expect(heavyShare).toBeGreaterThan(0.84);
    expect(heavyShare).toBeLessThan(0.96);
    expect(run().map((e) => (e.type === 'StoryletFired' ? e.storyletId : ''))).toEqual(fired.map((e) => (e.type === 'StoryletFired' ? e.storyletId : '')));
  });
});

describe('delegation, the inbox and expiry', () => {
  it('the steward applies defaultChoice at once under the delegate policy', () => {
    const w = world([petition()]);
    const s = dispatch(w.state, { type: 'setPolicy', policy: 'petitions', value: 'delegate' }, w.env).state;
    const before = loyalty(s, capitalOf(s));
    const r = advance(s, HOURS_PER_MONTH, w.env);
    expect(r.state.pending).toBeNull();
    expect(loyalty(r.state, capitalOf(r.state))).toBe(before + 1);
    expect(r.events.find((e) => e.type === 'StoryletFired')).toMatchObject({ delivery: 'delegated' });
    expect(r.events.find((e) => e.type === 'StoryletResolved')).toMatchObject({ how: 'delegated', choice: 1 });
    expect(r.events.some((e) => e.type === 'Notification' && e.key === 'narrative.notify.delegated')).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('player-scope storylets are never delegated', () => {
    const w = world([storylet({ id: 'testPlayer', trigger: 'monthly', defaultChoice: 0 })]);
    const s = dispatch(w.state, { type: 'setPolicy', policy: 'petitions', value: 'delegate' }, w.env).state;
    expect(pendingStorylet(advance(s, HOURS_PER_MONTH, w.env).state).payload.storyletId).toBe('testPlayer');
  });

  function abroad(w: ReturnType<typeof world>): GameState {
    const fleetId = (w.fleetIds[w.factionIds[0] as FactionId] as FleetId[])[0] as FleetId;
    return inDraft(w.state, w.env, (d) => {
      const ruler = d.characters[d.player.rulerId];
      if (ruler) ruler.location = { kind: 'fleet', id: fleetId };
      d.player.expeditionFleetId = fleetId;
    }).state;
  }

  it('while the ruler is away, petitions wait in the inbox and expire to the default choice', () => {
    const w = world([petition()]);
    const s = abroad(w);
    const before = loyalty(s, capitalOf(s));
    const r = advance(s, HOURS_PER_MONTH, w.env);
    expect(r.state.pending).toBeNull();
    const inbox = storyletInbox(r.state);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ status: 'waiting', expiresHour: HOURS_PER_MONTH + 10 * HOURS_PER_DAY });
    expect(r.events.some((e) => e.type === 'Notification' && e.key === 'narrative.notify.inbox' && e.vars.count === 1)).toBe(true);
    expect(storyletView(r.state, w.env, inbox[0]?.id as string)).toBeUndefined(); // the bundled library does not know test storylets
    const view = storyletView(r.state, w.env, inbox[0]?.id as string, w.module.library(w.env));
    expect(view).toMatchObject({ textKey: 'narrative.test.text', titleKey: 'narrative.test.title', canDefer: false, defaultChoice: 1, expiresHour: HOURS_PER_MONTH + 10 * HOURS_PER_DAY });
    expect(view?.choices.map((c) => c.available)).toEqual([true, true, false]);
    const e = advance(r.state, 10 * HOURS_PER_DAY, w.env);
    expect(storyletInbox(e.state)).toEqual([]);
    expect(loyalty(e.state, capitalOf(e.state))).toBe(before + 1);
    expect(e.events.find((x) => x.type === 'StoryletResolved')).toMatchObject({ how: 'expired', choice: 1 });
    expect(e.events.some((x) => x.type === 'Notification' && x.key === 'narrative.notify.expired')).toBe(true);
    expect(checkInvariants(e.state, w.env)).toEqual([]);
  });

  it('an inbox item can be answered directly, and lapses when its holding is lost', () => {
    const w = world([petition()]);
    const r = advance(abroad(w), HOURS_PER_MONTH, w.env);
    const id = storyletInbox(r.state)[0]?.id as string;
    const answered = ok(r.state, w.env, id, 0);
    expect(storyletInbox(answered.state)).toEqual([]);
    expect(answered.events.find((x) => x.type === 'StoryletResolved')).toMatchObject({ how: 'chosen', choice: 0 });
    const other = w.factionIds[1] as FactionId;
    const lost = inDraft(r.state, w.env, (d) => {
      const s = d.settlements[d.player.capitalId];
      if (s) s.factionId = other;
    }).state;
    const e = advance(lost, 10 * HOURS_PER_DAY, w.env);
    expect(e.events.find((x) => x.type === 'StoryletResolved')).toMatchObject({ how: 'lapsed', choice: null });
    expect(e.events.some((x) => x.type === 'Notification' && x.key === 'narrative.notify.lapsed')).toBe(true);
  });

  it('caps the inbox: beyond maxInbox the oldest is settled by the steward', () => {
    const a = petition({ id: 'testA', cooldownDays: 0 });
    const b = petition({ id: 'testB', cooldownDays: 0 });
    const w = world([a, b], { maxInbox: 1, monthly: { holding: { chance: 1, max: 2 } } });
    const r = advance(abroad(w), HOURS_PER_MONTH, w.env);
    expect(storyletInbox(r.state)).toHaveLength(1);
    expect(r.events.filter((x) => x.type === 'StoryletResolved' && x.how === 'expired')).toHaveLength(1);
  });

  it("'later' defers a pending storylet to the inbox (only when it can expire)", () => {
    const w = world([petition(), storylet({ id: 'testNoDefer', trigger: 'monthly', cooldownDays: 0 })], { monthly: { holding: { chance: 1, max: 1 }, player: { chance: 1, max: 1 } } });
    const s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    const first = pendingStorylet(s);
    expect(first.payload.storyletId).toBe('testNoDefer');
    expect(choose(s, w.env, first.payload.instanceId as string, 'later').error?.code).toBe('cannotDefer');
    const s2 = ok(s, w.env, first.payload.instanceId as string, 0).state;
    const second = pendingStorylet(s2);
    expect(second.payload.storyletId).toBe('testPetition');
    const deferred = ok(s2, w.env, second.payload.instanceId as string, 'later');
    expect(deferred.state.pending).toBeNull();
    expect(storyletInbox(deferred.state)[0]).toMatchObject({ storyletId: 'testPetition', status: 'waiting' });
    expect(checkInvariants(deferred.state, w.env)).toEqual([]);
  });
});

describe('storyletChoice validation', () => {
  it('rejects unknown instances, bad or unavailable choices, missing defaults and queued decisions', () => {
    const w = world([petition(), storylet({ id: 'testQueued', trigger: 'monthly', cooldownDays: 0 })]);
    const s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    const current = pendingStorylet(s);
    expect(s.pendingQueue).toHaveLength(1);
    const queued = s.pendingQueue[0] as PendingDecisionOf<'storylet'>;
    expect(choose(s, w.env, 'stl_9999', 0).error?.code).toBe('unknownStorylet');
    expect(choose(s, w.env, queued.payload.instanceId as string, 0).error?.code).toBe('notCurrent');
    expect(current.payload.storyletId).toBe('testQueued');
    expect(choose(s, w.env, current.payload.instanceId as string, 'default').error?.code).toBe('noDefault');
    expect(choose(s, w.env, current.payload.instanceId as string, 5).error?.code).toBe('badChoice');
    const s2 = ok(s, w.env, current.payload.instanceId as string, 0).state;
    const p2 = pendingStorylet(s2);
    expect(p2.payload.storyletId).toBe('testPetition');
    expect(choose(s2, w.env, p2.payload.instanceId as string, 2).error?.code).toBe('choiceUnavailable');
    expect(dispatch(s2, { type: 'storyletChoice', instanceId: p2.payload.instanceId as string, choice: -1 }, w.env).error?.code).toBe('invalidCommand');
    const d = ok(s2, w.env, p2.payload.instanceId as string, 'default');
    expect(d.events.find((x) => x.type === 'StoryletResolved')).toMatchObject({ how: 'default', choice: 1 });
  });

  it('turns an effect failure into a rejected command (state untouched)', () => {
    const broken = storylet({ id: 'testBroken', trigger: 'monthly', choices: [choice({ effects: [{ op: 'addRations', count: 5 }] })] });
    const w = world([broken]);
    const s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    const r = choose(s, w.env, pendingStorylet(s).payload.instanceId as string, 0);
    expect(r.error?.code).toBe('effectFailed');
    expect(r.state).toBe(s);
  });
});

describe('scheduling, follow-ups and chronicle', () => {
  it('fires scheduled storylets when due, with the scheduler vars', () => {
    const later = storylet({ id: 'testLater', vars: { gift: 'vars.amount * 2' }, choices: [choice({ effects: [{ op: 'addSilver', amount: { $var: 'gift' } }] })] });
    const w = world([later]);
    const s = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'scheduleStorylet', storyletId: 'testLater', inDays: 2, vars: { amount: 7 } }])).state;
    const early = advance(s, 2 * HOURS_PER_DAY - 1, w.env);
    expect(early.state.pending).toBeNull();
    const r = advance(early.state, 1, w.env);
    const p = pendingStorylet(r.state);
    expect(p.payload.vars).toMatchObject({ amount: 7, gift: 14 });
    expect(r.state.storylets.scheduled).toEqual([]);
    const before = r.state.factions[r.state.player.factionId]?.treasury ?? 0;
    const done = ok(r.state, w.env, p.payload.instanceId as string, 0);
    expect(done.state.factions[done.state.player.factionId]?.treasury).toBe(before + 14);
  });

  it('drops scheduled entries whose storylet or scope is gone', () => {
    const w = world([storylet({ id: 'testHold', scope: 'holding' })]);
    const s = inDraft(w.state, w.env, (_d, ctx) =>
      ctx.applyEffects([
        { op: 'scheduleStorylet', storyletId: 'noSuchStorylet', inDays: 0 },
        { op: 'scheduleStorylet', storyletId: 'testHold', inDays: 0 },
        { op: 'scheduleStorylet', storyletId: 'testHold', inDays: 0, scope: { kind: 'holding', id: 'set_99999' } },
      ]),
    ).state;
    const r = advance(s, 1, w.env);
    expect(r.state.pending).toBeNull();
    expect(r.state.storylets.scheduled).toEqual([]);
  });

  it('chains follow-ups with the same scope and vars, and writes chronicle entries', () => {
    const first = storylet({ id: 'testFirst', trigger: 'monthly', vars: { tag: '3' }, choices: [choice({ followUp: 'testSecond', chronicleKey: 'narrative.storylet.skaldsDraft.self.chronicle' })] });
    const second = storylet({ id: 'testSecond', importance: 3, chronicleKey: 'narrative.storylet.skaldsDraft.fallen.chronicle', choices: [choice()] });
    const w = world([first, second]);
    const s = advance(w.state, HOURS_PER_MONTH, w.env).state;
    const r1 = ok(s, w.env, pendingStorylet(s).payload.instanceId as string, 0);
    const p2 = pendingStorylet(r1.state);
    expect(p2.payload.storyletId).toBe('testSecond');
    expect(p2.payload.vars.tag).toBe(3);
    expect(r1.events.find((e) => e.type === 'ChronicleAdded')).toMatchObject({ entry: { kind: 'storylet', textKey: 'narrative.storylet.skaldsDraft.self.chronicle', importance: 1 } });
    const r2 = ok(r1.state, w.env, p2.payload.instanceId as string, 0);
    expect(r2.state.chronicle.at(-1)).toMatchObject({ kind: 'storylet', textKey: 'narrative.storylet.skaldsDraft.fallen.chronicle', importance: 3 });
    expect(r2.state.storylets.marks?.['chronicle:storylet']).toBe(HOURS_PER_MONTH);
    expect(r2.state.storylets.tallies?.['chronicle:storylet']).toBe(2);
    expect(missingEventKeys([...r1.events, ...r2.events])).toEqual([]);
  });

  it('caps delegated follow-up loops at maxFollowUpChain', () => {
    const a = storylet({ id: 'testLoopA', scope: 'holding', trigger: 'monthly', cooldownDays: 0, defaultChoice: 0, choices: [choice({ followUp: 'testLoopB' })] });
    const b = storylet({ id: 'testLoopB', scope: 'holding', cooldownDays: 0, defaultChoice: 0, choices: [choice({ followUp: 'testLoopA' })] });
    const w = world([a, b], { maxFollowUpChain: 5 });
    const s = dispatch(w.state, { type: 'setPolicy', policy: 'petitions', value: 'delegate' }, w.env).state;
    const r = advance(s, HOURS_PER_MONTH, w.env);
    expect(r.events.filter((e) => e.type === 'StoryletResolved')).toHaveLength(6);
    expect(r.state.pending).toBeNull();
  });
});

describe('event triggers', () => {
  const afterBattle = storylet({ id: 'testAfterBattle', trigger: 'onBattleEnd', triggerParams: { player: true }, when: 'event.winner == "attacker"', cooldownDays: 0 });

  it('reacts to domain events generically when the player is involved', () => {
    const w = world([afterBattle]);
    const other = w.factionIds[1] as FactionId;
    const theirs = (w.settlementIds[other] as SettlementId[])[0] as SettlementId;
    const notMine = emitEvent(w.state, w.env, 'BattleEnded', { battleId: 'bat_1', winner: 'attacker', setup: { attacker: { factionId: other }, settlementId: theirs } });
    expect(notMine.state.pending).toBeNull();
    expect(notMine.state.storylets.tallies?.BattleEnded).toBe(1);
    const mine = emitEvent(w.state, w.env, 'BattleEnded', { battleId: 'bat_2', winner: 'attacker', setup: { attacker: { factionId: w.state.player.factionId }, defender: { factionId: other }, settlementId: theirs } });
    const p = pendingStorylet(mine.state);
    expect(p.payload.storyletId).toBe('testAfterBattle');
    const inst = mine.state.storylets.instances?.[p.payload.instanceId as string];
    expect(inst?.bindings).toMatchObject({ settlement: theirs, faction: other });
    expect(inst?.event).toMatchObject({ winner: 'attacker', player: true, setup: { settlementId: theirs } });
    expect(p.payload.vars).toMatchObject({ settlementName: mine.state.settlements[theirs]?.name, factionName: mine.state.factions[other]?.name });
    const lost = emitEvent(w.state, w.env, 'BattleEnded', { winner: 'defender', isPlayer: true });
    expect(lost.state.pending).toBeNull();
  });

  it('fires onRelationThreshold when an opinion crosses the threshold', () => {
    const grudge = storylet({ id: 'testGrudge', scope: 'faction', trigger: 'onRelationThreshold', triggerParams: { threshold: -20, direction: 'down' }, cooldownDays: 0 });
    const w = world([grudge]);
    const other = w.factionIds[1] as FactionId;
    const small = inDraft(w.state, w.env, (d, ctx) => ctx.applyEffects([{ op: 'changeOpinion', a: d.player.factionId, b: other, amount: -10, reason: 'testInsult' }]));
    expect(small.state.pending).toBeNull();
    const big = inDraft(small.state, w.env, (d, ctx) => ctx.applyEffects([{ op: 'changeOpinion', a: other, b: d.player.factionId, amount: -15, reason: 'testInsult' }]));
    const p = pendingStorylet(big.state);
    expect(p.payload.scope).toEqual({ kind: 'faction', id: other });
  });

  it('fires effect triggers (fireStoryletTrigger) matching triggerParams', () => {
    const hall = storylet({ id: 'testMeadhall', scope: 'settlement', trigger: 'onEnterBuilding', triggerParams: { building: 'meadhall' }, cooldownDays: 0 });
    const w = world([hall]);
    const fire = (building: string) =>
      inDraft(w.state, w.env, (d, ctx) => ctx.applyEffects([{ op: 'fireStoryletTrigger', trigger: 'onEnterBuilding', scope: { kind: 'settlement', id: d.player.capitalId }, params: { building } }]));
    expect(fire('smithy').state.pending).toBeNull();
    const p = pendingStorylet(fire('meadhall').state);
    expect(p.payload.scope).toEqual({ kind: 'settlement', id: w.state.player.capitalId });
  });

  it('fires birthdays for the court and voyage days for the expedition', () => {
    const bday = storylet({ id: 'testBirthday', scope: 'character', trigger: 'onBirthday', when: 'character.isRuler && event.age == 16', cooldownDays: 0 });
    const voyage = storylet({ id: 'testVoyage', scope: 'fleet', trigger: 'onVoyageDay', triggerParams: { player: true }, when: 'event.voyageDays >= 2', cooldownDays: 0 });
    const w = world([bday, voyage]);
    const s = inDraft(w.state, w.env, (d) => {
      const ruler = d.characters[d.player.rulerId];
      if (ruler) ruler.birthHour = -16 * HOURS_PER_YEAR + 2 * HOURS_PER_DAY;
    }).state;
    const r = advance(s, 2 * HOURS_PER_DAY, w.env);
    const p = pendingStorylet(r.state);
    expect(p.payload).toMatchObject({ storyletId: 'testBirthday', scope: { kind: 'character', id: s.player.rulerId } });
    const fleetId = (w.fleetIds[w.factionIds[0] as FactionId] as FleetId[])[0] as FleetId;
    const sailing = inDraft(w.state, w.env, (d) => {
      d.player.expeditionFleetId = fleetId;
      const f = d.fleets[fleetId];
      if (f) {
        f.mode = 'sailing';
        f.voyageDays = 1;
      }
    }).state;
    expect(advance(sailing, HOURS_PER_DAY, w.env).state.pending).toBeNull();
    const two = inDraft(sailing, w.env, (d) => {
      const f = d.fleets[fleetId];
      if (f) f.voyageDays = 2;
    }).state;
    expect(pendingStorylet(advance(two, HOURS_PER_DAY, w.env).state).payload).toMatchObject({ storyletId: 'testVoyage', scope: { kind: 'fleet', id: fleetId } });
  });
});
