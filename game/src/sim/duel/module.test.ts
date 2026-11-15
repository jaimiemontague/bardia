import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects, type EffectData } from '@sim/core/effects';
import type { SimEvent } from '@sim/core/events';
import type { CharId, DuelId, FactionId, GameState } from '@sim/core/state';
import { inDraft, missingEventKeys, testWorld, type TestWorld } from '@sim/testing';
import { module } from './index';
import { testCreateFighter, testPeopleCalls, testPeopleModule } from './testing';
import type { DuelEndedEvent, DuelFightSummary } from './types';

function world(options: { gentleMode?: boolean } = {}): TestWorld & { foe: CharId; foeFaction: FactionId } {
  const base = testWorld({ modules: [module, testPeopleModule()], factions: 3, options });
  // Renown floors at 0 and a new house starts with none: give it some so losses and refusals show.
  const tw = { ...base, state: inDraft(base.state, base.env, (draft) => void (draft.player.house.renown = 100)).state };
  const foeFaction = tw.factionIds[1] as FactionId;
  const foe = tw.state.factions[foeFaction]!.rulerId;
  return { ...tw, foe, foeFaction };
}

function effect(tw: TestWorld, state: GameState, e: EffectData): { state: GameState; events: SimEvent[] } {
  return inDraft(state, tw.env, (_draft, ctx) => ctx.applyEffects([e]));
}

function send(tw: TestWorld, state: GameState, cmd: Command): { state: GameState; events: SimEvent[]; error?: { code: string } } {
  return dispatch(state, cmd, tw.env);
}

function ok(r: { state: GameState; events: SimEvent[]; error?: { code: string; message?: string } }) {
  expect(r.error).toBeUndefined();
  expect(module.invariants!(r.state)).toEqual([]);
  expect(missingEventKeys(r.events)).toEqual([]);
  return r;
}

const duelEnded = (events: SimEvent[]) => events.find((e): e is Extract<SimEvent, { type: 'DuelEnded' }> => e.type === 'DuelEnded') as DuelEndedEvent | undefined;
const pendingDuelId = (s: GameState): DuelId => {
  if (s.pending?.kind !== 'duel') throw new Error('no duel decision');
  return s.pending.payload.duelId;
};

function challenge(tw: ReturnType<typeof world>, state: GameState, over: Partial<EffectData> = {}) {
  return ok(effect(tw, state, { op: 'startDuel', a: 'player', b: tw.foe, stakes: 'yield', arena: 'hall', origin: 'tavern', ...over }));
}

const WIN: DuelFightSummary = { winner: 'a', reason: 'down', durationS: 41, hpPct: { a: 55, b: 0 }, tauntsLanded: { a: 1, b: 0 } };

describe('startDuel effect', () => {
  it('a duel of the player’s house raises the duel decision with a full setup', () => {
    const tw = world();
    const r = challenge(tw, tw.state, { ref: 'tavern:1' });
    const p = r.state.pending;
    expect(p?.kind).toBe('duel');
    const slot = r.state.subsims.duel!;
    expect(slot.status).toBe('setup');
    expect(p?.kind === 'duel' && p.payload).toMatchObject({ duelId: slot.id, origin: 'tavern', stakes: 'yield', lethal: false, declinable: true, fighterId: r.state.player.rulerId, opponentId: tw.foe });
    const s = slot.setup;
    expect(s).toMatchObject({ playerSide: 'a', champion: false, origin: 'tavern', ref: 'tavern:1', lethal: false, gentle: false, difficulty: 'raider' });
    expect(s.tiers).toEqual({ a: 2, b: 2 });
    expect(s.profiles!.a.charId).toBe(r.state.player.rulerId);
    expect(s.profiles!.a.sex).toBe(r.state.characters[r.state.player.rulerId]!.sex);
    expect(s.profiles!.b.hpMax).toBeGreaterThan(0);
    expect(s.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(r.events.some((e) => e.type === 'PendingRaised')).toBe(true);
  });

  it('a duel to the death is flagged lethal', () => {
    const tw = world();
    const r = challenge(tw, tw.state, { stakes: 'death', origin: 'battle' });
    expect(r.state.subsims.duel!.setup.lethal).toBe(true);
    expect(r.state.pending?.kind === 'duel' && r.state.pending.payload.lethal).toBe(true);
    expect(r.state.subsims.duel!.setup.declinable).toBe(false);
  });

  it('two NPCs are auto-resolved at once: DuelEnded, no decision, no slot', () => {
    const tw = world();
    const other = tw.state.factions[tw.factionIds[2] as FactionId]!.rulerId;
    const r = ok(effect(tw, tw.state, { op: 'startDuel', a: tw.foe, b: other, stakes: 'death', arena: 'field', origin: 'nemesis', ref: 'x' }));
    expect(r.state.pending).toBeNull();
    expect(r.state.subsims.duel).toBeUndefined();
    const ended = duelEnded(r.events)!;
    expect(ended).toMatchObject({ origin: 'nemesis', ref: 'x', playerSide: null });
    expect(ended.result.autoResolved).toBe(true);
    expect([tw.foe, other]).toContain(ended.winnerId);
    expect(r.events.some((e) => e.type === 'StandingChanged')).toBe(false);
  });

  it('validates its parameters (schema) and its fighters', () => {
    const tw = world();
    expect(validateEffects(tw.env, [{ op: 'startDuel', a: 'player', b: tw.foe, stakes: 'toTheDeath', arena: 'hall', origin: 'tavern' }])).not.toEqual([]);
    expect(validateEffects(tw.env, [{ op: 'startDuel', a: { charId: 'player', weapon: 'sword', armourTier: 3 }, b: tw.foe, stakes: 'yield', arena: 'hall', origin: 'thing' }])).toEqual([]);
    expect(() => effect(tw, tw.state, { op: 'startDuel', a: 'player', b: 'player', stakes: 'yield', arena: 'hall', origin: 'tavern' })).toThrow(/itself/);
    expect(() => effect(tw, tw.state, { op: 'startDuel', a: 'player', b: 'chr_99999', stakes: 'yield', arena: 'hall', origin: 'tavern' })).toThrow(/unknown/);
  });

  it('the duel omen in force gives nerve (§14.1 "Eidr’s Favor applies"); an expired reading does not', () => {
    const tw = world();
    const faith = tw.env.content.tunables as unknown as { faith: { omens: { extraModifiers: { duel: Record<string, Record<string, number>> } } } };
    const blessed = faith.faith.omens.extraModifiers.duel['blessed']!['duel.nervePct']!;
    const ill = faith.faith.omens.extraModifiers.duel['ill']!['duel.nervePct']!;
    // The faith module's published contract: player.house.omens[activity] and factions[id].omens[activity].
    const withOmens = (playerUntil: number) =>
      inDraft(tw.state, tw.env, (draft) => {
        const reading = (omen: string, untilHour: number) => ({ duel: { omen, score: 0, readHour: draft.time.hour, untilHour } });
        (draft.player.house as unknown as Record<string, unknown>)['omens'] = reading('blessed', playerUntil);
        (draft.factions[tw.foeFaction] as unknown as Record<string, unknown>)['omens'] = reading('ill', draft.time.hour + 100);
      }).state;
    const calm = challenge(tw, tw.state).state.subsims.duel!.setup.profiles!;
    const omened = challenge(tw, withOmens(tw.state.time.hour + 100)).state.subsims.duel!.setup.profiles!;
    expect(omened.a.nervePct).toBe(blessed);
    expect(omened.b.nervePct).toBe(ill);
    expect(omened.a.staminaMax).toBeGreaterThan(calm.a.staminaMax);
    expect(omened.b.rating).toBeLessThan(calm.b.rating);
    const expired = challenge(tw, withOmens(tw.state.time.hour)).state.subsims.duel!.setup.profiles!;
    expect(expired.a.nervePct).toBeUndefined();
    expect(expired.a.staminaMax).toBe(calm.a.staminaMax);
  });

  it('gear overrides and culture defaults reach the profiles', () => {
    const tw = world();
    const r = challenge(tw, tw.state, { a: { charId: 'player', weapon: 'spear', armourTier: 4, weaponTier: 2, ratingBonus: 5 } });
    const s = r.state.subsims.duel!.setup;
    expect(s.a).toMatchObject({ weapon: 'spear', armourTier: 4, weaponTier: 2, ratingBonus: 5 });
    expect(s.profiles!.a.shieldMax).toBe(70);
  });
});

describe('startDuel command', () => {
  it('auto-resolves (§14.8): consequences applied, DuelEnded, the decision resolved', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state).state;
    const r = ok(send(tw, s1, { type: 'startDuel', duelId: pendingDuelId(s1), mode: 'auto' }));
    expect(r.state.pending).toBeNull();
    const slot = r.state.subsims.duel!;
    expect(slot.status).toBe('resolved');
    const ended = duelEnded(r.events)!;
    expect(ended.result).toEqual(slot.result);
    expect(ended.result.autoResolved).toBe(true);
    expect(ended.result.reason).toBe('auto');
    const playerWon = ended.winnerId === r.state.player.rulerId;
    const renownDelta = r.state.player.house.renown - s1.player.house.renown;
    expect(renownDelta).toBe(ended.result.renown);
    expect(ended.result.renown).toBe(playerWon ? 20 : -10);
    expect(r.events.some((e) => e.type === 'ChronicleAdded')).toBe(true);
    expect(testPeopleCalls(r.state, 'woundCharacter', ended.loserId)).toBe(1);
  });

  it('real time: the duel runs with the decision still pending; applyDuelResult applies §14.9', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state).state;
    const id = pendingDuelId(s1);
    const s2 = ok(send(tw, s1, { type: 'startDuel', duelId: id, mode: 'realtime', weapon: 'spear' })).state;
    expect(s2.subsims.duel!.status).toBe('running');
    expect(s2.subsims.duel!.setup.a.weapon).toBe('spear');
    expect(s2.subsims.duel!.setup.profiles!.a.weapon).toBe('spear');
    expect(s2.pending?.kind).toBe('duel');
    const r = ok(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: WIN, choice: 'spare' }));
    expect(r.state.pending).toBeNull();
    const ended = duelEnded(r.events)!;
    expect(ended.result).toMatchObject({ winnerId: s1.player.rulerId, loserFate: 'spared', renown: 20 + 10, honor: 5, mode: 'realtime', reason: 'down', autoResolved: false, tauntsPaid: 1 });
    expect(r.state.player.house.renown - s1.player.house.renown).toBe(30);
    expect(r.state.player.house.honor - s1.player.house.honor).toBe(5);
    expect(testPeopleCalls(r.state, 'woundCharacter', tw.foe)).toBe(1);
    expect(r.events.map((e) => e.type)).toContain('PendingResolved');
  });

  it('a kill in a duel to the death: the foe dies (people op), Dread +, blood-feud opinion', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state, { stakes: 'death', origin: 'battle' }).state;
    const id = pendingDuelId(s1);
    const s2 = ok(send(tw, s1, { type: 'startDuel', duelId: id, mode: 'assisted' })).state;
    expect(s2.subsims.duel!.setup.assisted).toBe(true);
    const r = ok(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: { ...WIN, tauntsLanded: { a: 0, b: 0 } }, choice: 'kill' }));
    expect(r.state.characters[tw.foe]!.alive).toBe(false);
    expect(r.state.player.house.dread - s1.player.house.dread).toBe(5);
    expect(duelEnded(r.events)!.result).toMatchObject({ loserFate: 'killed', renown: 30, dread: 5 });
    const rel = Object.values(r.state.relations).find((x) => [x.a, x.b].includes(tw.foeFaction) && [x.a, x.b].includes(r.state.player.factionId));
    expect(rel?.opinion).toBe(-25);
  });

  it('refuses an illegal decision: a kill in a duel to yield, first blood in the wrong stakes', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state).state;
    const id = pendingDuelId(s1);
    const s2 = send(tw, s1, { type: 'startDuel', duelId: id, mode: 'realtime' }).state;
    expect(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: WIN, choice: 'kill' }).error?.code).toBe('invalidChoice');
    expect(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: { ...WIN, reason: 'firstBlood' } }).error?.code).toBe('invalidOutcome');
    expect(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: { ...WIN, reason: 'ringOut' } }).error?.code).toBe('invalidOutcome');
    expect(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: { ...WIN, winner: 'c' } } as unknown as Command).error?.code).toBe('invalidCommand');
    expect(send(tw, s1, { type: 'applyDuelResult', duelId: id, outcome: WIN }).error?.code).toBe('notRunning');
  });

  it('weapons are limited by the weapon tier; a champion cannot fight in real time', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state).state;
    expect(send(tw, s1, { type: 'startDuel', duelId: pendingDuelId(s1), mode: 'realtime', weapon: 'sword' }).error?.code).toBe('weaponNotAllowed');
    // A lieutenant of the player's house stands in.
    let champ: CharId = 'chr_0';
    const withChamp = inDraft(tw.state, tw.env, (draft, ctx) => {
      champ = testCreateFighter(draft, ctx, { factionId: draft.player.factionId, role: 'lieutenant', melee: 6 });
    }).state;
    const c1 = ok(effect(tw, withChamp, { op: 'startDuel', a: champ, b: tw.foe, stakes: 'yield', arena: 'deck', origin: 'boarding' })).state;
    expect(c1.subsims.duel!.setup).toMatchObject({ playerSide: 'a', champion: true });
    expect(send(tw, c1, { type: 'startDuel', duelId: pendingDuelId(c1), mode: 'realtime' }).error?.code).toBe('championRealtime');
    const c2 = ok(send(tw, c1, { type: 'startDuel', duelId: pendingDuelId(c1), mode: 'assisted' })).state;
    const r = ok(send(tw, c2, { type: 'applyDuelResult', duelId: pendingDuelId(c2), outcome: { ...WIN, tauntsLanded: { a: 0, b: 0 } } }));
    expect(duelEnded(r.events)!.result.renown).toBe(10);
  });

  it('declining a tavern challenge costs a little Renown; a battlefield duel cannot be declined', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state, { ref: 'hall-7' }).state;
    const r = ok(send(tw, s1, { type: 'startDuel', duelId: pendingDuelId(s1), mode: 'decline' }));
    expect(r.state.pending).toBeNull();
    expect(r.state.player.house.renown - s1.player.house.renown).toBe(-3);
    const declined = r.events.find((e) => e.type === 'DuelDeclined');
    expect(declined).toMatchObject({ origin: 'tavern', ref: 'hall-7', renown: -3, challengerId: tw.foe });
    expect(r.state.subsims.duel!.status).toBe('resolved');
    const b1 = challenge(tw, tw.state, { origin: 'battle' }).state;
    expect(send(tw, b1, { type: 'startDuel', duelId: pendingDuelId(b1), mode: 'decline' }).error?.code).toBe('notDeclinable');
  });

  it('only the pending duel can be started; a dead fighter cancels the duel', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state).state;
    expect(send(tw, s1, { type: 'startDuel', duelId: 'duel_424242', mode: 'auto' }).error?.code).toBe('notPending');
    const dead = inDraft(s1, tw.env, (draft) => {
      draft.characters[tw.foe]!.alive = false;
    }).state;
    const r = ok(send(tw, dead, { type: 'startDuel', duelId: pendingDuelId(dead), mode: 'auto' }));
    expect(r.state.pending).toBeNull();
    expect(r.state.subsims.duel!.status).toBe('resolved');
    expect(duelEnded(r.events)).toBeUndefined();
  });

  it('a second duel set up meanwhile waits in the queue and takes the slot in turn', () => {
    const tw = world();
    const other = tw.state.factions[tw.factionIds[2] as FactionId]!.rulerId;
    const s1 = challenge(tw, tw.state).state;
    const s2 = ok(effect(tw, s1, { op: 'startDuel', a: 'player', b: other, stakes: 'firstBlood', arena: 'holmgang', origin: 'thing' })).state;
    expect(s2.subsims.duelQueue).toHaveLength(1);
    expect(s2.pendingQueue).toHaveLength(1);
    const first = pendingDuelId(s2);
    const s3 = ok(send(tw, s2, { type: 'startDuel', duelId: first, mode: 'auto' })).state;
    const second = pendingDuelId(s3);
    expect(second).not.toBe(first);
    const s4 = ok(send(tw, s3, { type: 'startDuel', duelId: second, mode: 'realtime' })).state;
    expect(s4.subsims.duel!.id).toBe(second);
    expect(s4.subsims.duelQueue).toBeUndefined();
    expect(s4.subsims.duel!.setup.profiles!.a.shields).toBe(3);
    const r = ok(send(tw, s4, { type: 'applyDuelResult', duelId: second, outcome: { winner: 'a', reason: 'ringOut', durationS: 20, hpPct: { a: 90, b: 80 }, tauntsLanded: { a: 0, b: 0 } } }));
    // Eidr's Favor for the won holmgang is granted by faith (reacting to DuelEnded), not by the duel module.
    expect(r.state.player.house.favor.eidr).toBe(s4.player.house.favor.eidr);
    expect(duelEnded(r.events)).toMatchObject({ origin: 'thing', setup: { arena: 'holmgang' }, result: { reason: 'ringOut', winnerId: s4.player.rulerId } });
    expect(r.state.pending).toBeNull();
  });

  it('Gentle Mode: the player character is captured or spared, never killed', () => {
    for (let i = 0; i < 8; i++) {
      const tw = world({ gentleMode: true });
      const cruel = inDraft(tw.state, tw.env, (draft) => {
        const foe = draft.characters[tw.foe]!;
        foe.traits.push('ruthless', 'wrathful');
        foe.personality = { aggression: 90, greed: 50, honor: 0, caution: 10, ambition: 50, piety: 50 };
        draft.meta.seed = `gentle-${i}`;
      }).state;
      const s1 = challenge(tw, cruel, { stakes: 'death', origin: 'battle' }).state;
      const id = pendingDuelId(s1);
      const s2 = send(tw, s1, { type: 'startDuel', duelId: id, mode: 'realtime' }).state;
      const r = ok(send(tw, s2, { type: 'applyDuelResult', duelId: id, outcome: { winner: 'b', reason: 'down', durationS: 30, hpPct: { a: 0, b: 40 }, tauntsLanded: { a: 0, b: 0 } } }));
      const fate = duelEnded(r.events)!.result.loserFate;
      expect(['captured', 'spared']).toContain(fate);
      expect(r.state.characters[r.state.player.rulerId]!.alive).toBe(true);
    }
  });
});

describe('module hygiene', () => {
  it('is deterministic: the same seed and commands give identical states', () => {
    const run = () => {
      const tw = world();
      let s = challenge(tw, tw.state, { stakes: 'death', origin: 'guardian' }).state;
      s = send(tw, s, { type: 'startDuel', duelId: pendingDuelId(s), mode: 'auto', onWin: 'capture' }).state;
      const other = s.factions[tw.factionIds[2] as FactionId]!.rulerId;
      s = ok(effect(tw, s, { op: 'startDuel', a: tw.foe, b: other, stakes: 'yield', arena: 'beach', origin: 'other' })).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('init and migrate are harmless on a campaign under way; the module registers its contracts', () => {
    const tw = world();
    const s = inDraft(tw.state, tw.env, (draft, ctx) => {
      module.init!(draft, ctx);
      module.migrate!(draft, 0, ctx);
    }).state;
    expect(s.subsims).toEqual(tw.state.subsims);
    expect(tw.env.handlers.get('startDuel')?.moduleId).toBe('duel');
    expect(tw.env.handlers.get('applyDuelResult')?.moduleId).toBe('duel');
    expect(tw.env.effects.get('startDuel')?.moduleId).toBe('duel');
  });

  it('invariants catch a broken slot', () => {
    const tw = world();
    const s1 = challenge(tw, tw.state).state;
    const broken = inDraft(s1, tw.env, (draft) => {
      draft.pending = null;
      draft.subsims.duel!.setup.b.charId = draft.subsims.duel!.setup.a.charId;
    }).state;
    const v = module.invariants!(broken);
    expect(v.some((x) => x.includes('against itself'))).toBe(true);
    expect(v.some((x) => x.includes('without a pending duel decision'))).toBe(true);
  });
});
