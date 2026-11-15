import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getContent, type Content } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects, type EffectData } from '@sim/core/effects';
import type { SimEvent } from '@sim/core/events';
import type { EffectHandlers, EffectSchemas, SimModule } from '@sim/core/module';
import type { BattleResult, CharId, FactionId, FleetId, GameState, SettlementId, SiteId } from '@sim/core/state';
import { inDraft, missingEventKeys, testWorld } from '@sim/testing';
import { battleResultEffects } from './apply';
import { BattleEngine } from './engine/engine';
import { battleInvariants, module as battle } from './index';
import { runEngine } from './testing';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`));
const strictOp = (name: string, shape: z.ZodRawShape) => z.object({ op: z.literal(name), ...shape }).strict();
const count = z.number().int().min(0);

/** Strict copies of the published schemas of the ops a result is written back through. */
const OWNER_SCHEMAS: Record<string, z.ZodTypeAny> = {
  killMen: strictOp('killMen', {
    settlementId: id('set').optional(),
    fleetId: id('flt').optional(),
    armyId: id('arm').optional(),
    pool: z.boolean().optional(),
    unit: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    count,
    wounded: count.optional(),
    captured: count.optional(),
    homeId: id('set').optional(),
    popLoss: z.boolean().optional(),
  }),
  kill: strictOp('kill', { charId: id('chr').optional(), cause: z.string().min(1), killerId: id('chr').optional(), byFactionId: id('fac').optional() }),
  capture: strictOp('capture', { charId: id('chr').optional(), byFactionId: id('fac').optional(), at: id('set').optional(), cause: z.string().min(1).optional() }),
  woundCharacter: strictOp('woundCharacter', {
    charId: id('chr').optional(),
    severity: z.enum(['minor', 'serious', 'mortal']).optional(),
    wound: z.enum(['none', 'minor', 'serious', 'mortal']).optional(),
    cause: z.string().min(1).optional(),
  }),
  grantXp: strictOp('grantXp', { charId: id('chr').optional(), amount: z.number().finite(), source: z.string().optional() }),
};

/** Fake owners (military: killMen takes men out of fleets/garrisons; people: logged). */
function fakeOwners(log: EffectData[]): SimModule[] {
  const pick = (ops: string[]) => Object.fromEntries(ops.map((op) => [op, OWNER_SCHEMAS[op]!])) as unknown as EffectSchemas;
  const record = (_d: GameState, e: unknown) => {
    log.push(e as EffectData);
  };
  const killMen = (d: GameState, e: unknown) => {
    const x = e as { unit: string; count: number; wounded?: number; captured?: number; fleetId?: FleetId; settlementId?: SettlementId };
    log.push(e as EffectData);
    const men = x.fleetId ? d.fleets[x.fleetId]?.men : x.settlementId ? d.settlements[x.settlementId]?.garrison : undefined;
    if (men) men[x.unit] = Math.max(0, (men[x.unit] ?? 0) - x.count - (x.wounded ?? 0) - (x.captured ?? 0));
  };
  const people = ['kill', 'capture', 'woundCharacter', 'grantXp'];
  return [
    { id: 'testFakeMilitary', order: 91, effects: { killMen } as unknown as EffectHandlers, effectSchemas: pick(['killMen']) },
    { id: 'testFakePeople', order: 101, effects: Object.fromEntries(people.map((op) => [op, record])) as unknown as EffectHandlers, effectSchemas: pick(people) },
  ];
}

function world(opts: { content?: Content } = {}) {
  const log: EffectData[] = [];
  const w = testWorld({ modules: [battle, ...fakeOwners(log)], factions: 3, ...(opts.content ? { content: opts.content } : {}) });
  const player = w.factionIds[0]!;
  const ai = w.factionIds[1]!;
  const ai2 = w.factionIds[2]!;
  return { ...w, log, player, ai, ai2, playerFleet: w.fleetIds[player]![0]!, aiFleet: w.fleetIds[ai]![0]!, aiTown: w.settlementIds[ai]![0]!, ai2Town: w.settlementIds[ai2]![0]! };
}
type World = ReturnType<typeof world>;

function raid(w: World, state: GameState = w.state, extra: Partial<EffectData> = {}) {
  const ruler = state.player.rulerId;
  const captain = state.fleets[w.playerFleet]!.leaderId;
  return inDraft(state, w.env, (_d, ctx) => {
    ctx.applyEffects([{ op: 'startBattle', kind: 'raid', attacker: { fleetId: w.playerFleet, characterIds: [ruler, captain] }, defender: {}, settlementId: w.aiTown, origin: 'test', ...extra }]);
  });
}

function eventOf<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('startBattle effect', () => {
  it('gathers both sides, stores the setup and raises the battleSetup decision', () => {
    const w = world();
    const { state, events } = raid(w);
    const slot = state.subsims.battle!;
    expect(slot.status).toBe('setup');
    expect(state.pending?.kind).toBe('battleSetup');
    expect(state.pending?.kind === 'battleSetup' && state.pending.payload.battleId).toBe(slot.id);
    expect(events.some((e) => e.type === 'PendingRaised')).toBe(true);
    const s = slot.setup;
    expect(s.kind).toBe('raid');
    expect(s.mapTemplate).toBe(getContent().tunables.battle.templateByTier[state.settlements[w.aiTown]!.tier]);
    expect(s.mapSeed).toBe(`${state.meta.seed}|${w.aiTown}`);
    expect(s.timerS).toBe(getContent().tunables.battle.raid.timerByTier.town);
    expect(s.lootCeiling).toBe(getContent().balance.loot.raidMaxShare);
    expect(s.loot!.silver).toBe(state.settlements[w.aiTown]!.silver);
    // The player's party: one squad per named leader, fleet men as sources, the ruler first.
    const a = s.attacker;
    expect(a.isPlayer).toBe(true);
    expect(a.chiefId).toBeUndefined();
    expect(a.squads.length).toBe(2);
    expect(a.squads[0]!.leaderId).toBe(state.player.rulerId);
    for (const sq of a.squads) {
      expect(sq.sources!.every((src) => src.kind === 'fleet' && src.id === w.playerFleet)).toBe(true);
      expect(sq.men).toBe(sq.sources!.reduce((n, x) => n + x.men, 0));
      expect(s.leaders![sq.leaderId]).toBeDefined();
    }
    expect(a.available).toBeDefined();
    expect(Object.values(a.available!).reduce((n, v) => n + v, 0)).toBe(50);
    // The defenders: the garrison under sergeants, the settlement's lord as chief with a bodyguard.
    const d = s.defender;
    expect(d.isPlayer).toBe(false);
    expect(d.factionId).toBe(w.ai);
    expect(d.squads.reduce((n, x) => n + x.men, 0)).toBe(40);
    expect(d.squads.length).toBeLessThanOrEqual(10);
    if (d.chiefId) expect(d.squads.some((x) => x.leaderId === d.chiefId && x.unnamed !== true)).toBe(true);
    expect(battleInvariants(state)).toEqual([]);
    // Time is stopped by the decision.
    expect(dispatch(state, { type: 'wait', days: 1 }, w.env).error?.code).toBe('pendingDecision');
  });

  it('a battle without the player is auto-resolved at once and written back', () => {
    const w = world();
    const { state, events } = inDraft(w.state, w.env, (_d, ctx) => {
      ctx.applyEffects([{ op: 'startBattle', kind: 'assault', attacker: { fleetId: w.aiFleet }, defender: {}, settlementId: w.ai2Town, origin: 'ai' }]);
    });
    expect(state.pending).toBeNull();
    expect(state.subsims.battle).toBeUndefined();
    const started = eventOf(events, 'BattleStarted')!;
    const ended = eventOf(events, 'BattleEnded')!;
    expect(started.mode).toBe('auto');
    expect(ended.result.autoResolved).toBe(true);
    expect(ended.playerSide).toBeUndefined();
    expect(ended.unapplied).toEqual([]);
    expect(w.log.some((e) => e.op === 'killMen')).toBe(true);
    expect(missingEventKeys(events)).toEqual([]);
  });

  it('relic-site guardians come from the tunables; omens and weather are read defensively', () => {
    const w = world();
    const siteId = 'site_test' as SiteId;
    const { state } = inDraft(w.state, w.env, (d) => {
      d.sites[siteId] = { id: siteId, name: 'Ashbarrow', kind: 'barrow', mapPos: { x: 5, y: 5 }, revealed: true, delveId: 'd', cleared: false };
      (d.player.house as unknown as Record<string, unknown>).omens = { battle: { omen: 'blessed', untilHour: d.time.hour + 100, score: 3, readHour: 0 } };
      d.weather.zones.z1 = { windDir: 90, windStr: 'gale', fog: false, ice: false };
      (d.fleets[w.playerFleet] as unknown as Record<string, unknown>).seaZoneId = 'z1';
    });
    const r = inDraft(state, w.env, (_d, ctx) => {
      ctx.applyEffects([{ op: 'startBattle', kind: 'guardian', attacker: { fleetId: w.playerFleet }, defender: {}, siteId, origin: 'quests' }]);
    });
    const s = r.state.subsims.battle!.setup;
    expect(s.mapTemplate).toBe('caveMouth');
    expect(s.siteKind).toBe('barrow');
    expect(s.defender.squads.map((q) => q.unit)).toEqual(getContent().tunables.battle.guardiansBySiteKind.barrow!.map(([u]) => u));
    expect(s.defender.factionId).toBe(getContent().tunables.battle.wildFactionId);
    expect(s.omen).toBe('blessed');
    expect(s.weather.windDir).toBe(90);
    expect(s.weather.windStr).toBe(getContent().tunables.battle.windStrength.gale);
  });

  it('rejects bad references and validates its parameters', () => {
    const w = world();
    expect(() => inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'startBattle', kind: 'raid', attacker: { fleetId: 'flt_nope' }, defender: {}, settlementId: w.aiTown, origin: 't' }]))).toThrow(/unknown fleet/);
    expect(validateEffects(w.env, [{ op: 'startBattle', kind: 'raid', attacker: {}, defender: {} }], 'test').length).toBeGreaterThan(0);
    expect(validateEffects(w.env, [{ op: 'startBattle', kind: 'raid', attacker: { fleetId: w.playerFleet }, defender: {}, settlementId: w.aiTown, origin: 'x' }], 'test')).toEqual([]);
  });
});

describe('startBattle command', () => {
  it('auto: resolves at once, writes casualties back through killMen and emits BattleEnded', () => {
    const w = world();
    const s1 = raid(w).state;
    const battleId = s1.subsims.battle!.id as `bat_${string}`;
    const r = dispatch(s1, { type: 'startBattle', battleId, mode: 'auto' }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.pending).toBeNull();
    expect(r.state.subsims.battle!.status).toBe('resolved');
    const ended = eventOf(r.events, 'BattleEnded')!;
    expect(ended.playerSide).toBe('attacker');
    expect(ended.result.autoResolved).toBe(true);
    expect(ended.unapplied).toEqual([]);
    for (const e of w.log) {
      const schema = OWNER_SCHEMAS[e.op];
      if (schema) expect(schema.safeParse(e).success, JSON.stringify(e)).toBe(true);
    }
    const lostA = ended.result.casualties.filter((c) => c.side === 'attacker').reduce((n, c) => n + c.killed + c.wounded + c.captured, 0);
    const fleetMen = Object.values(r.state.fleets[w.playerFleet]!.men).reduce((n, v) => n + v, 0);
    expect(fleetMen).toBe(50 - lostA);
    expect(r.events.some((e) => e.type === 'Notification')).toBe(true);
    expect(r.events.some((e) => e.type === 'ChronicleAdded')).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
    expect(battleInvariants(r.state)).toEqual([]);
  });

  it('fight: hands over to the engine; applyBattleResult writes the fought result back', () => {
    const w = world();
    const s1 = raid(w).state;
    const slot = s1.subsims.battle!;
    const battleId = slot.id as `bat_${string}`;
    const before = s1.meta.mode;
    const r1 = dispatch(s1, { type: 'startBattle', battleId, mode: 'fight' }, w.env);
    expect(r1.error).toBeUndefined();
    expect(r1.state.meta.mode).toBe('battle');
    expect(r1.state.subsims.battle!.status).toBe('running');
    expect(eventOf(r1.events, 'BattleStarted')!.mode).toBe('fight');
    // Still pending: time stays stopped while the battle is fought.
    expect(r1.state.pending?.kind).toBe('battleSetup');
    expect(battleInvariants(r1.state)).toEqual([]);
    // The client runs the engine (here both sides on the AI) and hands back the result.
    const engine = BattleEngine.create(r1.state.subsims.battle!.setup, getContent(), { humanSides: [] });
    runEngine(engine);
    const result = engine.result()!;
    const r2 = dispatch(r1.state, { type: 'applyBattleResult', battleId, result }, w.env);
    expect(r2.error).toBeUndefined();
    expect(r2.state.meta.mode).toBe(before);
    expect(r2.state.pending).toBeNull();
    expect(r2.state.subsims.battle!.status).toBe('resolved');
    expect(r2.state.subsims.battle!.result).toEqual(JSON.parse(JSON.stringify(result)));
    const ended = eventOf(r2.events, 'BattleEnded')!;
    expect(ended.result.autoResolved).toBe(false);
    expect(ended.unapplied).toEqual([]);
    expect(battleInvariants(r2.state)).toEqual([]);
    // A second application is refused.
    expect(dispatch(r2.state, { type: 'applyBattleResult', battleId, result }, w.env).error?.code).toBe('notRunning');
  });

  it('applyBattleResult refuses results that do not fit the setup', () => {
    const w = world();
    const s1 = raid(w).state;
    const battleId = s1.subsims.battle!.id as `bat_${string}`;
    const s2 = dispatch(s1, { type: 'startBattle', battleId, mode: 'fight' }, w.env).state;
    const leader = s2.subsims.battle!.setup.attacker.squads[0]!.leaderId;
    const bogus: BattleResult = {
      winner: 'attacker',
      retreated: false,
      casualties: [{ side: 'attacker', leaderId: leader, killed: 500, wounded: 0, captured: 0 }],
      chief: { killed: false, captured: false },
      lootValue: 0,
      lootGoods: {},
      buildingsBurned: 0,
      durationS: 10,
      xp: {},
      autoResolved: false,
    };
    expect(dispatch(s2, { type: 'applyBattleResult', battleId, result: bogus }, w.env).error?.code).toBe('invalidResult');
    expect(dispatch(s2, { type: 'applyBattleResult', battleId: 'bat_nope', result: bogus }, w.env).error?.code).toBe('noBattle');
    expect(dispatch(s2, { type: 'applyBattleResult', battleId, result: { ...bogus, winner: 'maybe' } as unknown as BattleResult }, w.env).error).toBeDefined();
  });

  it('the Groups screen re-assigns squads within the men and caps available', () => {
    const w = world();
    const s1 = raid(w).state;
    const slot = s1.subsims.battle!;
    const battleId = slot.id as `bat_${string}`;
    const ruler = s1.player.rulerId;
    const captain = s1.fleets[w.playerFleet]!.leaderId;
    const too = dispatch(s1, { type: 'startBattle', battleId, mode: 'auto', squads: [{ leaderId: ruler, unit: 'bondi', men: 41 }] }, w.env);
    expect(too.error?.code).toBe('badGroups');
    const stranger = dispatch(s1, { type: 'startBattle', battleId, mode: 'auto', squads: [{ leaderId: 'chr_999999' as CharId, unit: 'bondi', men: 5 }] }, w.env);
    expect(stranger.error?.code).toBe('badGroups');
    const ok = dispatch(
      s1,
      {
        type: 'startBattle',
        battleId,
        mode: 'fight',
        squads: [
          { leaderId: ruler, unit: 'archers', men: 10, formation: 'line', stance: 'hold' },
          { leaderId: captain, unit: 'bondi', men: 20, formation: 'shieldWall' },
        ],
      },
      w.env,
    );
    expect(ok.error).toBeUndefined();
    const squads = ok.state.subsims.battle!.setup.attacker.squads;
    expect(squads.map((q) => [q.leaderId, q.unit, q.men, q.formation])).toEqual([
      [ruler, 'archers', 10, 'line'],
      [captain, 'bondi', 20, 'shieldWall'],
    ]);
    expect(squads[0]!.stance).toBe('hold');
    expect(battleInvariants(ok.state)).toEqual([]);
  });

  it('a night raid needs Wolf-coats or Wildcraft 5', () => {
    const w = world();
    const s1 = raid(w).state;
    const battleId = s1.subsims.battle!.id as `bat_${string}`;
    expect(dispatch(s1, { type: 'startBattle', battleId, mode: 'auto', approach: 'night' }, w.env).error?.code).toBe('nightRaidUnavailable');
    const skilled = inDraft(w.state, w.env, (d) => {
      d.characters[d.player.rulerId]!.skills.wildcraft = 6;
    }).state;
    const s2 = raid(w, skilled).state;
    const id2 = s2.subsims.battle!.id as `bat_${string}`;
    const r = dispatch(s2, { type: 'startBattle', battleId: id2, mode: 'fight', approach: 'night' }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.subsims.battle!.setup.approach).toBe('night');
    expect(r.state.subsims.battle!.setup.weather.night).toBe(true);
  });

  it('is deterministic: same world and commands, identical state', () => {
    const go = () => {
      const w = world();
      const s1 = raid(w).state;
      const battleId = s1.subsims.battle!.id as `bat_${string}`;
      return dispatch(s1, { type: 'startBattle', battleId, mode: 'auto' }, w.env).state;
    };
    expect(JSON.stringify(go())).toBe(JSON.stringify(go()));
  });
});

describe('result effects', () => {
  it('loot leaves the place for the winning fleet; character effects only when switched on', () => {
    const base = getContent();
    const on: Content = { ...base, tunables: { ...base.tunables, battle: { ...base.tunables.battle, resultEffects: { characters: true, lootToWinner: true } } } };
    const w = world({ content: on });
    const s1 = raid(w).state;
    const setup = s1.subsims.battle!.setup;
    const ruler = s1.player.rulerId;
    const result: BattleResult = {
      winner: 'attacker',
      retreated: false,
      casualties: [],
      chief: { killed: false, captured: false },
      lootValue: 100,
      lootGoods: { furs: 0.5 },
      lootSilver: 60,
      buildingsBurned: 1,
      durationS: 100,
      xp: { [ruler]: 40 },
      leaderFates: { [ruler]: 'wounded' },
      autoResolved: false,
    };
    const fx = battleResultEffects(s1, on, setup, result);
    expect(fx.lootApplied).toBe(true);
    expect(fx.effects).toContainEqual({ op: 'addSilver', amount: 60, fleetId: w.playerFleet });
    expect(fx.effects).toContainEqual({ op: 'addSilver', amount: -60, settlementId: w.aiTown });
    expect(fx.effects).toContainEqual({ op: 'addGoods', good: 'furs', tons: 0.5, fleetId: w.playerFleet });
    expect(fx.effects).toContainEqual({ op: 'grantXp', charId: ruler, amount: 40, source: 'battle' });
    expect(fx.effects).toContainEqual({ op: 'woundCharacter', charId: ruler, wound: 'minor', cause: 'battle' });
    const off = battleResultEffects(s1, base, setup, result);
    expect(off.effects.some((e) => e.op === 'grantXp' || e.op === 'woundCharacter')).toBe(false);
    const defeat = battleResultEffects(s1, base, setup, { ...result, winner: 'defender', lootValue: 0, lootSilver: 0, lootGoods: {} });
    expect(defeat.lootApplied).toBe(false);
    expect(defeat.effects.some((e) => e.op === 'addSilver' && (e.amount as number) > 0)).toBe(false);
  });

  it('casualties go back to the container each squad came from', () => {
    const w = world();
    const s1 = raid(w).state;
    const setup = s1.subsims.battle!.setup;
    const engine = BattleEngine.create(setup, getContent(), { humanSides: [] });
    runEngine(engine);
    const result = engine.result()!;
    const fx = battleResultEffects(s1, getContent(), setup, result).effects.filter((e) => e.op === 'killMen');
    const byFleet = fx.filter((e) => e.fleetId === w.playerFleet).reduce((n, e) => n + (e.count as number) + ((e.wounded as number) ?? 0) + ((e.captured as number) ?? 0), 0);
    const lostA = result.casualties.filter((c) => c.side === 'attacker').reduce((n, c) => n + c.killed + c.wounded + c.captured, 0);
    expect(byFleet).toBe(lostA);
    const byTown = fx.filter((e) => e.settlementId === w.aiTown).reduce((n, e) => n + (e.count as number) + ((e.wounded as number) ?? 0) + ((e.captured as number) ?? 0), 0);
    const lostD = (result.squadLosses ?? []).filter((r) => r.side === 'defender' && r.source.kind === 'settlement').reduce((n, r) => n + r.killed + r.wounded + r.captured, 0);
    expect(byTown).toBe(lostD);
  });
});

describe('invariants', () => {
  it('flag a battle running without its decision', () => {
    const w = world();
    const s1 = raid(w).state;
    const broken = inDraft(s1, w.env, (d) => {
      d.pending = null;
    }).state;
    expect(battleInvariants(broken).length).toBeGreaterThan(0);
    const f: FactionId = w.player;
    expect(f).toBeDefined();
  });
});
