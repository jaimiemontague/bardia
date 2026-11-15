import { getContent } from '@content/index';
import { GOD_IDS } from '@content/schemas/ids';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import { advance } from '@sim/core/scheduler';
import type { FactionId, GameState } from '@sim/core/state';
import { HOURS_PER_MONTH } from '@sim/core/time';
import { inDraft, missingEventKeys, testEnv, testState, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { groveMultiplier, sacrificeGain } from './favor';
import { module as faith } from './index';
import { withPlayerOmen } from './testing';

const content = getContent();
const t = content.tunables.faith;
const env = testEnv([faith]);

/** A new game whose ruler has no traits or feats (no Pious/Skeptic/Lucky noise). */
function plainState(): GameState {
  return inDraft(testState({ modules: [faith] }), env, (d) => {
    const ruler = d.characters[d.player.rulerId];
    if (ruler) {
      ruler.traits = [];
      ruler.feats = [];
    }
  }).state;
}

function edit(state: GameState, fn: (d: GameState) => void): GameState {
  return inDraft(state, env, (d) => fn(d)).state;
}

/** Emits a foreign event as its owning module would (payload read defensively by faith). */
function emitAs(state: GameState, moduleId: string, event: Record<string, unknown>): { state: GameState; events: SimEvent[] } {
  return inDraft(state, env, (_d, ctx) => ctx.runAs(moduleId, () => ctx.emit(event as unknown as SimEvent)));
}

describe('monthly neglect (§22.6: −1 per month toward 0)', () => {
  it('pulls positive and negative Favor one step toward 0 and stops at 0', () => {
    let s = edit(plainState(), (d) => {
      Object.assign(d.player.house.favor, { valgrim: 10, dunnar: -3, saltha: 0, fjorna: 1 });
    });
    s = advance(s, HOURS_PER_MONTH, env).state;
    expect(s.player.house.favor).toMatchObject({ valgrim: 9, dunnar: -2, saltha: 0, fjorna: 0 });
    s = advance(s, HOURS_PER_MONTH, env).state;
    expect(s.player.house.favor).toMatchObject({ valgrim: 8, dunnar: -1, saltha: 0, fjorna: 0 });
  });

  it('spares a god tended last month', () => {
    let s = plainState();
    const r = dispatch(s, { type: 'sacrifice', god: 'eidr', kind: 'silver', size: 'modest' }, env);
    expect(r.error).toBeUndefined();
    s = r.state;
    const tended = s.player.house.favor.eidr;
    s = advance(s, HOURS_PER_MONTH, env).state; // month 1: eidr was tended in month 0
    expect(s.player.house.favor.eidr).toBe(tended);
    expect(s.player.house.favor.valgrim).toBe(content.balance.standing.favor.start - 1);
    s = advance(s, HOURS_PER_MONTH, env).state; // month 2: untended in month 1
    expect(s.player.house.favor.eidr).toBe(tended - 1);
  });

  it('decays Old Ways AI factions too, and gives them a Favor record', () => {
    const w = testWorld({ modules: [faith], factions: 5 });
    const oldWays = w.factionIds.filter((id) => id !== w.state.player.factionId && w.state.factions[id]?.faith === 'oldways');
    const lantern = w.factionIds.filter((id) => w.state.factions[id]?.faith === 'lantern');
    expect(oldWays.length).toBeGreaterThan(0);
    expect(lantern.length).toBeGreaterThan(0);
    for (const id of lantern) expect(w.state.factions[id]?.favor).toBeUndefined();
    const id = oldWays[0] as FactionId;
    // testWorld adds its AI factions after the modules' init: the first month gives them Favor.
    const s0 = inDraft(advance(w.state, HOURS_PER_MONTH, w.env).state, w.env, (d) => {
      const f = d.factions[id];
      expect(f?.favor).toBeDefined();
      if (f?.favor) for (const god of GOD_IDS) f.favor[god] = 20;
      if (f) f.treasury = 0; // no offerings
    }).state;
    const s1 = advance(s0, HOURS_PER_MONTH, w.env).state;
    for (const god of GOD_IDS) expect(s1.factions[id]?.favor?.[god]).toBe(19);
    for (const fid of w.factionIds) if (fid !== w.state.player.factionId) expect(s1.factions[fid]?.omens?.battle).toBeDefined();
  });
});

describe('sacrifice at the grove', () => {
  it('has diminishing returns per god per month and the grove tier multiplier', () => {
    let s = plainState();
    const mult = groveMultiplier(content.balance, 1);
    expect(mult).toBe(1.25);
    const expected = [1, 2, 3, 4].map((n) => sacrificeGain(content.balance, t, 'lavish', 'silver', n, mult, 1));
    expect(expected).toEqual([10, 5, 3, 0]);
    const start = s.player.house.favor.saltha;
    const gains: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = dispatch(s, { type: 'sacrifice', god: 'saltha', kind: 'silver', size: 'lavish' }, env);
      expect(r.error).toBeUndefined();
      const ev = r.events.find((e) => e.type === 'OfferingMade');
      expect(ev?.type === 'OfferingMade' && ev.nth).toBe(i + 1);
      gains.push(r.state.player.house.favor.saltha - s.player.house.favor.saltha);
      expect(missingEventKeys(r.events)).toEqual([]);
      s = r.state;
    }
    expect(gains).toEqual(expected);
    expect(s.player.house.favor.saltha).toBe(start + 18);
    // Another god this month starts fresh; next month resets the count.
    const other = dispatch(s, { type: 'sacrifice', god: 'dunnar', kind: 'silver', size: 'lavish' }, env);
    expect(other.state.player.house.favor.dunnar - s.player.house.favor.dunnar).toBe(10);
    const next = advance(s, HOURS_PER_MONTH, env).state;
    const fresh = dispatch(next, { type: 'sacrifice', god: 'saltha', kind: 'silver', size: 'lavish' }, env);
    expect(fresh.state.player.house.favor.saltha - next.player.house.favor.saltha).toBe(10);
  });

  it('pays silver; a better grove and a Pious ruler give more', () => {
    const s = plainState();
    const treasury = s.factions[s.player.factionId]?.treasury ?? 0;
    const r = dispatch(s, { type: 'sacrifice', god: 'fjorna', kind: 'silver', size: 'lavish' }, env);
    expect(r.state.factions[s.player.factionId]?.treasury).toBe(treasury - t.sacrifice.sizes.lavish.silver);
    const grove2 = edit(s, (d) => {
      const cap = d.settlements[d.player.capitalId];
      if (cap) cap.buildings['grove'] = 2;
    });
    const r2 = dispatch(grove2, { type: 'sacrifice', god: 'fjorna', kind: 'silver', size: 'lavish' }, env);
    expect(r2.state.player.house.favor.fjorna - grove2.player.house.favor.fjorna).toBe(12);
    const pious = edit(s, (d) => {
      const ruler = d.characters[d.player.rulerId];
      if (ruler) ruler.traits = ['pious'];
    });
    const r3 = dispatch(pious, { type: 'sacrifice', god: 'fjorna', kind: 'silver', size: 'lavish' }, env);
    expect(r3.state.player.house.favor.fjorna - pious.player.house.favor.fjorna).toBe(12);
  });

  it('slaughters the holding’s livestock for a livestock offering', () => {
    const w = testWorld({ modules: [faith] });
    const cap = w.state.player.capitalId;
    const s = inDraft(w.state, w.env, (d) => {
      const ruler = d.characters[d.player.rulerId];
      if (ruler) {
        ruler.traits = [];
        ruler.feats = [];
      }
      const m = d.markets[cap];
      if (m) m.stock.rations = 5;
    }).state;
    expect(dispatch(s, { type: 'sacrifice', god: 'saltha', kind: 'livestock', size: 'lavish' }, w.env).error?.code).toBe('notEnoughLivestock');
    const r = dispatch(s, { type: 'sacrifice', god: 'saltha', kind: 'livestock', size: 'generous' }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.markets[cap]?.stock.rations).toBe(5 - t.sacrifice.sizes.generous.livestockTons);
    expect(r.state.player.house.favor.saltha - s.player.house.favor.saltha).toBe(sacrificeGain(content.balance, t, 'generous', 'livestock', 1, 1.25, 1));
  });

  it('requires a grove in one of your holdings (or a temple-stead) and the Old Ways', () => {
    const s = plainState();
    const noGrove = edit(s, (d) => {
      const cap = d.settlements[d.player.capitalId];
      if (cap) cap.buildings['grove'] = 0;
    });
    expect(dispatch(noGrove, { type: 'sacrifice', god: 'saltha', kind: 'silver', size: 'modest' }, env).error?.code).toBe('noGrove');
    const stead = edit(noGrove, (d) => {
      const cap = d.settlements[d.player.capitalId];
      if (cap) cap.tier = 'templeStead';
    });
    expect(dispatch(stead, { type: 'sacrifice', god: 'saltha', kind: 'silver', size: 'modest' }, env).error).toBeUndefined();
    const lantern = edit(s, (d) => {
      d.player.house.faith = 'lantern';
    });
    expect(dispatch(lantern, { type: 'sacrifice', god: 'saltha', kind: 'silver', size: 'modest' }, env).error?.code).toBe('wrongFaith');
    expect(dispatch(s, { type: 'sacrifice', god: 'nobody', kind: 'silver', size: 'modest' } as never, env).error?.code).toBe('invalidCommand');
  });
});

describe('deeds through reactions', () => {
  const start = content.balance.standing.favor.start;

  it('a battle won pleases Valgrim, at most maxPerMonth times', () => {
    let s = plainState();
    const won = { type: 'BattleEnded', kind: 'raid', attackerFactionId: s.player.factionId, defenderFactionId: 'fac_9999', result: { winner: 'attacker' } };
    const r = emitAs(s, 'battle', won);
    expect(r.state.player.house.favor.valgrim).toBe(start + 2);
    expect(r.events.some((e) => e.type === 'FaithDeed')).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
    for (let i = 0; i < 5; i++) s = emitAs(s, 'battle', won).state;
    expect(s.player.house.favor.valgrim).toBe(start + 2 * (t.deeds['battleWon']?.maxPerMonth ?? 0));
  });

  it('holding your own settlement pleases Dunnar; burning halls pleases Skell', () => {
    const s = plainState();
    const defended = emitAs(s, 'battle', {
      type: 'BattleEnded',
      kind: 'raid',
      attackerFactionId: 'fac_9999',
      defenderFactionId: s.player.factionId,
      settlementId: s.player.capitalId,
      result: { winner: 'defender' },
    }).state;
    expect(defended.player.house.favor.dunnar).toBe(start + 3);
    expect(defended.player.house.favor.valgrim).toBe(start + 2);
    const burned = emitAs(s, 'battle', {
      type: 'BattleEnded',
      attackerFactionId: s.player.factionId,
      defenderFactionId: 'fac_9999',
      result: { winner: 'attacker', buildingsBurned: 3 },
    }).state;
    expect(burned.player.house.favor.skell).toBe(start + 2);
  });

  it('holmgang wins please Eidr and spend the duel omen; storms weathered please Saltha', () => {
    const w = testWorld({ modules: [faith] });
    let s = inDraft(w.state, w.env, (d) => {
      const r = d.characters[d.player.rulerId];
      if (r) {
        r.traits = [];
        r.feats = [];
      }
    }).state;
    s = withPlayerOmen(s, w.env, 'duel', 'fair');
    const ruler = s.player.rulerId;
    s = inDraft(s, w.env, (_d, ctx) =>
      ctx.runAs('duel', () => ctx.emit({ type: 'DuelEnded', result: { winnerId: ruler }, setup: { arena: 'holmgang', a: { charId: ruler }, b: { charId: 'chr_9999' } } } as unknown as SimEvent)),
    ).state;
    expect(s.player.house.favor.eidr - w.state.player.house.favor.eidr).toBe(4);
    expect(s.player.house.omens?.duel).toBeUndefined();
    const fleetId = w.fleetIds[w.state.player.factionId]?.[0];
    expect(fleetId).toBeDefined();
    const before = s.player.house.favor.saltha;
    s = inDraft(s, w.env, (_d, ctx) => ctx.runAs('weather', () => ctx.emit({ type: 'StormHit', fleetId, severity: 'severe' } as unknown as SimEvent))).state;
    expect(s.player.house.favor.saltha - before).toBe(3);
  });

  it('marriages please Fjorna; proper funerals the Gray Queen (not for the drowned)', () => {
    const s = plainState();
    const ruler = s.player.rulerId;
    expect(emitAs(s, 'people', { type: 'Marriage', aId: ruler, bId: 'chr_9999' }).state.player.house.favor.fjorna).toBe(start + 3);
    const lt = Object.values(s.characters).find((c) => c.factionId === s.player.factionId && c.id !== ruler);
    expect(lt).toBeDefined();
    expect(emitAs(s, 'people', { type: 'Death', charId: lt?.id, cause: 'battle' }).state.player.house.favor.grayQueen).toBe(start + 2);
    expect(emitAs(s, 'people', { type: 'Death', charId: lt?.id, cause: 'drowned' }).state.player.house.favor.grayQueen).toBe(start);
  });

  it('a relic pleases its god (Valgrim when the god is unknown); a temple-stead raid angers every god', () => {
    const s = plainState();
    const relic = content.balance.standing.favor.relic;
    expect(emitAs(s, 'quests', { type: 'RelicFound', relicId: 'rel_1', god: 'skell' }).state.player.house.favor.skell).toBe(start + relic);
    expect(emitAs(s, 'quests', { type: 'RelicFound', relicId: 'rel_1' }).state.player.house.favor.valgrim).toBe(start + relic);
    const stead = edit(s, (d) => {
      const cap = d.settlements[d.player.capitalId];
      if (cap) {
        cap.tier = 'templeStead';
        cap.factionId = 'fac_9999';
      }
    });
    const raided = emitAs(stead, 'settlements', { type: 'SettlementFate', settlementId: stead.player.capitalId, fate: 'plunderAndLeave' }).state;
    for (const god of GOD_IDS) expect(raided.player.house.favor[god]).toBe(start + content.balance.standing.favor.templeSteadRaided);
  });

  it('the faithDeed effect applies any deed; unknown deeds are refused', () => {
    const s = plainState();
    const r = inDraft(s, env, (_d, ctx) => ctx.applyEffects([{ op: 'faithDeed', deed: 'missionarySentAway' }]));
    for (const god of GOD_IDS) expect(r.state.player.house.favor[god]).toBe(start + 5);
    expect(() => inDraft(s, env, (_d, ctx) => ctx.applyEffects([{ op: 'faithDeed', deed: 'noSuchDeed' }]))).toThrow(/unknown deed/);
  });

  it('an Old Ways AI faction gains Favor from its own victories', () => {
    const w = testWorld({ modules: [faith], factions: 3 });
    const ai = w.factionIds.find((id) => id !== w.state.player.factionId && w.state.factions[id]?.faith === 'oldways') as FactionId;
    const s0 = advance(w.state, HOURS_PER_MONTH, w.env).state; // AI Favor records exist from the first month
    const before = s0.factions[ai]?.favor?.valgrim ?? Number.NaN;
    const r = inDraft(s0, w.env, (_d, ctx) =>
      ctx.runAs('battle', () =>
        ctx.emit({ type: 'BattleEnded', attackerFactionId: ai, defenderFactionId: w.state.player.factionId, result: { winner: 'attacker' } } as unknown as SimEvent),
      ),
    );
    expect(r.state.factions[ai]?.favor?.valgrim).toBe(Math.min(content.balance.standing.favor.max, before + 2));
    expect(r.events.filter((e) => e.type === 'Notification' && e.key.startsWith('faith.deed'))).toHaveLength(0);
  });
});
