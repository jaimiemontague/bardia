import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import type { SimEvent } from '@sim/core/events';
import type { CharId, FactionId } from '@sim/core/state';
import { testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { module as people } from './index';
import { build, linkParent, makePerson, peopleTestEnv, peopleTestState, testHouse } from './testing';

const content = getContent();
const b = content.balance;

/** Events of other modules are emitted here exactly as their owners would (the kernel routes them by name). */
function foreign(event: Record<string, unknown>): SimEvent {
  return event as unknown as SimEvent;
}

describe('reactions to sub-simulation results', () => {
  it('subscribes to BattleEnded, DuelEnded, SeaBattleEnded and StandingChanged', () => {
    const env = peopleTestEnv();
    for (const type of ['BattleEnded', 'DuelEnded', 'SeaBattleEnded', 'StandingChanged']) {
      expect(env.reactions.get(type)?.some((r) => r.moduleId === 'people')).toBe(true);
    }
  });

  it('BattleEnded: XP from result.xp; leader fates wound, capture and kill', () => {
    const w = testWorld({ modules: [people], factions: 2, seed: 'battle' });
    const enemy = w.factionIds[1] as FactionId;
    const enemyTown = w.settlementIds[enemy]![0]!;
    const r = build(w.state, w.env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      const lt = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' }, attributes: { wits: 4 } });
      const chief = makePerson(draft, ctx, { ageYears: 40, factionId: enemy });
      const fallen = makePerson(draft, ctx, { ageYears: 25, factionId: enemy });
      ctx.emit(
        foreign({
          type: 'BattleEnded',
          battleId: 'bat_1',
          kind: 'raid',
          origin: 'test',
          settlementId: enemyTown,
          attackerFactionId: draft.player.factionId,
          defenderFactionId: enemy,
          playerSide: 'attacker',
          setup: { attacker: { factionId: draft.player.factionId }, defender: { factionId: enemy, chiefId: chief.id } },
          result: {
            winner: 'attacker',
            xp: { [me.id]: 100, [lt.id]: 100 },
            leaderFates: { [lt.id]: 'seriouslyWounded', [fallen.id]: 'dead' },
            playerFate: 'wounded',
            chief: { killed: false, captured: true },
          },
        }),
      );
      return { lt: lt.id, chief: chief.id, fallen: fallen.id };
    });
    const s = r.state;
    const me = s.characters[s.player.rulerId]!;
    expect(me.xp).toBe(100);
    expect(me.level).toBe(2);
    expect(me.health.wound).toBe('minor');
    const lt = s.characters[r.value.lt]!;
    expect(lt.xp).toBe(75);
    expect(lt.health.wound).toBe('serious');
    expect(s.characters[r.value.chief]!.captivity).toMatchObject({ byFactionId: s.player.factionId });
    expect(s.characters[r.value.fallen]!.alive).toBe(false);
    expect(s.characters[r.value.fallen]!.death?.cause).toBe('battle');
  });

  it('DuelEnded: the duel module applies the consequences; people adds the XP without doubling them', () => {
    const w = testWorld({ modules: [people], factions: 2, seed: 'duel' });
    const enemy = w.factionIds[1] as FactionId;
    const r = build(w.state, w.env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      const foe = makePerson(draft, ctx, { ageYears: 30, factionId: enemy, level: 3 });
      // What the duel module applies before announcing DuelEnded:
      ctx.applyEffects([
        { op: 'woundCharacter', charId: me.id, wound: 'minor', injury: 'brokenHand', cause: 'duel' },
        { op: 'kill', charId: foe.id, cause: 'duel', killerId: me.id },
      ]);
      const xp = b.xp.sources.duelWinBase + b.xp.sources.duelWinPerLevel * 3;
      ctx.emit(
        foreign({
          type: 'DuelEnded',
          duelId: 'duel_1',
          origin: 'tavern',
          playerSide: 'a',
          winnerId: me.id,
          loserId: foe.id,
          setup: { a: { charId: me.id }, b: { charId: foe.id } },
          result: { winnerId: me.id, loserId: foe.id, loserFate: 'killed', injuries: [{ charId: me.id, injury: 'brokenHand' }], renown: 20, autoResolved: false, xp: { [me.id]: xp } },
        }),
      );
      return { foe: foe.id, xp };
    });
    const me = r.state.characters[r.state.player.rulerId]!;
    expect(me.xp).toBe(r.value.xp);
    expect(r.state.characters[r.value.foe]!.alive).toBe(false);
    expect(r.events.filter((e) => e.type === 'Death')).toHaveLength(1);
    expect(r.events.filter((e) => e.type === 'CharacterWounded' && (e as { injury?: string }).injury === 'brokenHand')).toHaveLength(1);
    expect(me.health.injuries.map((i) => i.id)).toEqual(['brokenHand']);
  });

  it('DuelEnded without xp computes 50 + 10 × loser level and applies an unapplied capture', () => {
    const w = testWorld({ modules: [people], factions: 2, seed: 'duel2' });
    const enemy = w.factionIds[1] as FactionId;
    const r = build(w.state, w.env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      const foe = makePerson(draft, ctx, { ageYears: 30, factionId: enemy, level: 2 });
      ctx.emit(foreign({ type: 'DuelEnded', winnerId: me.id, loserId: foe.id, result: { winnerId: me.id, loserFate: 'captured', injuries: [] }, setup: { a: { charId: me.id }, b: { charId: foe.id } } }));
      return foe.id;
    });
    expect(r.state.characters[r.state.player.rulerId]!.xp).toBe(b.xp.sources.duelWinBase + 2 * b.xp.sources.duelWinPerLevel);
    expect(r.state.characters[r.value]!.captivity?.byFactionId).toBe(r.state.player.factionId);
  });

  it('SeaBattleEnded: XP for the crew and the captains’ duel', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      ctx.emit(foreign({ type: 'SeaBattleEnded', result: { winner: 'attacker', xp: { [me.id]: 40 } } }));
    });
    expect(r.state.characters[r.state.player.rulerId]!.xp).toBe(40);
  });
});

describe('roles', () => {
  it('assigns governors, captains, stewards and seers; refuses the ruler, minors and strangers', () => {
    const w = testWorld({ modules: [people], factions: 2 });
    const house = testHouse(w.state, w.env, { rulerAge: 40, childAges: [12] });
    const made = build(house.state, w.env, (draft, ctx) => {
      const a = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' } });
      const b2 = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' } });
      const stranger = makePerson(draft, ctx, { ageYears: 30, factionId: w.factionIds[1] as FactionId });
      return { a: a.id, b: b2.id, stranger: stranger.id };
    });
    let s = made.state;
    const capital = s.player.capitalId;
    const fleet = w.fleetIds[s.player.factionId]![0]!;
    const assign = (cmd: Parameters<typeof dispatch>[1]) => dispatch(s, cmd, w.env);
    expect(assign({ type: 'assignRole', charId: s.player.rulerId, role: 'steward' }).error?.code).toBe('isRuler');
    expect(assign({ type: 'assignRole', charId: house.childIds[0]!, role: 'lieutenant' }).error?.code).toBe('minor');
    expect(assign({ type: 'assignRole', charId: made.value.stranger, role: 'lieutenant' }).error?.code).toBe('notYours');
    expect(assign({ type: 'assignRole', charId: made.value.a, role: 'governor' }).error?.code).toBe('notAHolding');
    // A client could still send the forbidden role; the command schema rejects it.
    const regent = { type: 'assignRole', charId: made.value.a, role: 'regent' } as unknown as Parameters<typeof dispatch>[1];
    expect(assign(regent).error?.code).toBe('invalidCommand');
    s = assign({ type: 'assignRole', charId: made.value.a, role: 'governor', holdingId: capital }).state;
    expect(s.settlements[capital]!.holding!.governorId).toBe(made.value.a);
    s = assign({ type: 'assignRole', charId: made.value.b, role: 'governor', holdingId: capital }).state;
    expect(s.characters[made.value.a]!.role?.kind).toBe('lieutenant');
    s = assign({ type: 'assignRole', charId: made.value.a, role: 'captain', fleetId: fleet }).state;
    expect(s.characters[made.value.a]!.role).toMatchObject({ kind: 'captain', fleetId: fleet });
    s = assign({ type: 'assignRole', charId: made.value.a, role: 'steward' }).state;
    s = assign({ type: 'assignRole', charId: house.spouseId, role: 'steward' }).state;
    expect(s.characters[made.value.a]!.role?.kind).toBe('lieutenant');
    expect(s.characters[house.spouseId]!.role?.kind).toBe('steward');
    const seer = assign({ type: 'assignRole', charId: made.value.a, role: 'seer' });
    expect(seer.events.some((e) => e.type === 'RoleAssigned')).toBe(true);
  });
});

describe('condition functions', () => {
  it('read characters by id, scope binding or keyword', () => {
    const env = peopleTestEnv();
    const house = testHouse(peopleTestState(), env, { rulerAge: 30, childAges: [4, 13] });
    const s = build(house.state, env, (draft) => {
      draft.characters[house.rulerId]!.traits.push('brave');
    }).state;
    const fn = (name: string, args: (string | number)[], scope: Record<string, string> = {}) => env.conditionFns.get(name)!.fn.evaluate(args, { state: s, env, scope });
    expect(fn('hasTrait', ['ruler', 'Brave'])).toBe(true);
    expect(fn('hasTrait', [house.rulerId, 'brave'])).toBe(true);
    expect(fn('hasTrait', ['character', 'craven'], { character: house.rulerId })).toBe(false);
    expect(fn('age', ['ruler'])).toBe(30);
    expect(fn('isAdult', [house.childIds[0]!])).toBe(false);
    expect(fn('lifeStage', [house.childIds[0]!])).toBe('infant');
    expect(fn('lifeStage', [house.childIds[1]!])).toBe('youth');
    expect(fn('isMarried', ['ruler'])).toBe(true);
    expect(fn('hasHeir', [])).toBe(true);
    expect(fn('level', ['ruler'])).toBe(1);
    expect(fn('skill', ['ruler', 'melee'])).toBe(0);
    expect(fn('attribute', ['ruler', 'might'])).toBe(4);
    expect(fn('woundState', ['spouse'])).toBe('none');
    expect(fn('childCount', ['ruler'])).toBe(2);
    expect(fn('isKin', ['ruler', house.childIds[0]!])).toBe(true);
    expect(fn('isKin', ['ruler', 'spouse'])).toBe(false);
    expect(fn('canMarry', ['ruler', house.spouseId])).toBe(false);
    expect(fn('isAlive', ['chr_999999'])).toBe(false);
    expect(fn('age', ['nobody'])).toBe(0);
    expect(fn('hasFeat', ['ruler', 'seaWise'])).toBe(false);
    expect(fn('isCaptive', ['heir'])).toBe(false);
    expect(fn('isPregnant', ['spouse'])).toBe(false);
  });
});

describe('items and effect validation', () => {
  it('giveItem assigns special gear and moves it between characters', () => {
    const env = peopleTestEnv();
    const made = build(peopleTestState(), env, (draft, ctx) => makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId }).id);
    const s = build(made.state, env, (_d, ctx) => {
      ctx.applyEffects([
        { op: 'giveItem', itemId: 'ravenBanner' },
        { op: 'giveItem', charId: made.value, itemId: 'ravenBanner', fromCharId: made.state.player.rulerId },
      ]);
    }).state;
    expect(s.characters[s.player.rulerId]!.items).toBeUndefined();
    expect(s.characters[made.value]!.items).toEqual(['ravenBanner']);
    expect(() => build(s, env, (_d, ctx) => ctx.applyEffects([{ op: 'giveItem', itemId: 'famousSword', fromCharId: s.player.rulerId }]))).toThrow(/does not hold/);
  });

  it('content can validate people effects at load time', () => {
    const env = peopleTestEnv();
    expect(
      validateEffects(env, [
        { op: 'woundCharacter', rollInjury: true },
        { op: 'addTrait', trait: 'brave' },
        { op: 'kill', charId: 'chr_4', cause: 'oldAge' },
        { op: 'capture', charId: 'chr_4', byFactionId: 'fac_2' },
        { op: 'grantXp', amount: 50, source: 'quest' },
        { op: 'grantDeedName', key: 'people.deedName.unbroken' },
        { op: 'releaseCharacter', charId: 'chr_4' },
        { op: 'birth', motherId: 'chr_4' },
        { op: 'marry', spouseId: 'chr_9' },
        { op: 'giveItem', itemId: 'ravenBanner' },
        { op: 'removeTrait', trait: 'craven' },
      ]),
    ).toEqual([]);
    const issues = validateEffects(env, [
      { op: 'woundCharacter' },
      { op: 'capture', charId: 'chr_4' },
      { op: 'kill', cause: '' },
      { op: 'grantXp', amount: 0 },
      { op: 'marry', spouseId: 'fac_1' },
    ]);
    expect(issues).toHaveLength(5);
  });

  it('a kin’s child counts as kin for isKin (cousins within the search depth)', () => {
    const env = peopleTestEnv();
    const made = build(peopleTestState(), env, (draft, ctx) => {
      const ruler = draft.characters[draft.player.rulerId]!;
      const gp = makePerson(draft, ctx, { ageYears: 70, sex: 'male' });
      const parent = makePerson(draft, ctx, { ageYears: 45, sex: 'female' });
      const aunt = makePerson(draft, ctx, { ageYears: 42, sex: 'female' });
      const cousin = makePerson(draft, ctx, { ageYears: 18 });
      linkParent(gp, parent);
      linkParent(gp, aunt);
      linkParent(parent, ruler);
      linkParent(aunt, cousin);
      return cousin.id as CharId;
    });
    const fn = env.conditionFns.get('isKin')!.fn;
    expect(fn.evaluate(['ruler', made.value], { state: made.state, env, scope: {} })).toBe(true);
  });
});
