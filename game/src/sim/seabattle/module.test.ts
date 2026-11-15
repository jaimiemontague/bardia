import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects, type EffectData } from '@sim/core/effects';
import type { SimEvent } from '@sim/core/events';
import type { EffectHandlers, EffectSchemas, SimModule } from '@sim/core/module';
import type { FleetId, GameState, SeaBattleResult } from '@sim/core/state';
import { inDraft, missingEventKeys, testWorld } from '@sim/testing';
import { SeaBattleEngine } from './engine';
import { module as seabattle, seaContent, seaInvariants } from './index';
import { seaResultEffects, splitLosses } from './apply';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`));
const strictOp = (name: string, shape: z.ZodRawShape) => z.object({ op: z.literal(name), ...shape }).strict();
const finite = z.number().finite();
const count = z.number().int().min(0);

/**
 * Strict copies of the published schemas of the ops the result is written back through (military:
 * src/sim/modules/military/schemas.ts, people: src/sim/modules/people/schemas.ts). A parameter the
 * owner would reject shows up in SeaBattleEnded.unapplied, which the tests require to be empty.
 */
const TEST_OWNER_SCHEMAS: Record<string, z.ZodTypeAny> = {
  damageShip: strictOp('damageShip', { shipId: id('shp'), hull: finite.optional(), sail: finite.optional(), cause: z.string().min(1).optional() }),
  sinkShip: strictOp('sinkShip', { shipId: id('shp'), cause: z.string().min(1).optional() }),
  captureShip: strictOp('captureShip', { shipId: id('shp'), factionId: id('fac').optional(), fleetId: id('flt').optional(), settlementId: id('set').optional() }),
  addShip: strictOp('addShip', {
    shipType: z.string(),
    factionId: id('fac').optional(),
    settlementId: id('set').optional(),
    fleetId: id('flt').optional(),
    name: z.string().min(1).max(60).optional(),
  }),
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
  capture: strictOp('capture', {
    charId: id('chr').optional(),
    byFactionId: id('fac').optional(),
    captorFactionId: id('fac').optional(),
    at: id('set').optional(),
    ransom: finite.min(0).optional(),
    cause: z.string().min(1).optional(),
    hostage: z.boolean().optional(),
  }),
  woundCharacter: strictOp('woundCharacter', {
    charId: id('chr').optional(),
    severity: z.enum(['minor', 'serious', 'mortal']).optional(),
    wound: z.enum(['none', 'minor', 'serious', 'mortal']).optional(),
    injury: z.string().optional(),
    rollInjury: z.boolean().optional(),
    cause: z.string().min(1).optional(),
  }),
};

/** Fake owners of the ops the result writes back through (military, people), with the owners' schemas. */
function fakeOwners(log: EffectData[]): SimModule[] {
  const record = (_d: GameState, e: unknown) => {
    log.push(e as EffectData);
  };
  const pick = (ops: string[]) => Object.fromEntries(ops.map((op) => [op, TEST_OWNER_SCHEMAS[op]!])) as unknown as EffectSchemas;
  const handlers = (ops: string[]) => Object.fromEntries(ops.map((op) => [op, record])) as unknown as EffectHandlers;
  const military = ['damageShip', 'sinkShip', 'captureShip', 'addShip', 'killMen'];
  const people = ['kill', 'capture', 'woundCharacter'];
  return [
    { id: 'testFakeMilitary', order: 91, effects: handlers(military), effectSchemas: pick(military) },
    { id: 'testFakePeople', order: 101, effects: handlers(people), effectSchemas: pick(people) },
  ];
}

/** Every effect the writer produces must pass the owner's schema. */
function expectValidForOwners(fx: readonly EffectData[]): void {
  for (const e of fx) {
    const schema = TEST_OWNER_SCHEMAS[e.op];
    if (schema) expect(schema.safeParse(e).success, JSON.stringify(e)).toBe(true);
  }
}

function world(withOwners: boolean, factions = 3) {
  const log: EffectData[] = [];
  const modules = withOwners ? [seabattle, ...fakeOwners(log)] : [seabattle];
  const w = testWorld({ modules, factions });
  const player = w.factionIds[0]!;
  const ai1 = w.factionIds[1]!;
  const ai2 = w.factionIds[2];
  const playerFleet = w.fleetIds[player]![0]!;
  const aiFleet = w.fleetIds[ai1]![0]!;
  const ai2Fleet = ai2 !== undefined ? w.fleetIds[ai2]![0] : undefined;
  return { ...w, log, playerFleet, aiFleet, ai2Fleet };
}

function startBattle(state: GameState, env: ReturnType<typeof world>['env'], attacker: FleetId, defender: FleetId, mode?: 'ask' | 'auto') {
  return inDraft(state, env, (_d, ctx) => {
    const e: EffectData = { op: 'startSeaBattle', attacker: { fleetId: attacker }, defender: { fleetId: defender }, origin: 'test', wind: { dir: 90, str: 'fresh' }, arena: 'coastal' };
    if (mode) e.mode = mode;
    ctx.applyEffects([e]);
  });
}

function ended(events: readonly SimEvent[]) {
  return events.find((e): e is Extract<SimEvent, { type: 'SeaBattleEnded' }> => e.type === 'SeaBattleEnded');
}

describe('startSeaBattle effect', () => {
  it('builds the setup from the fleets and raises the seaBattle decision for the player', () => {
    const w = world(false);
    const { state, events } = startBattle(w.state, w.env, w.playerFleet, w.aiFleet);
    const slot = state.subsims.seaBattle!;
    expect(slot.status).toBe('setup');
    expect(state.pending?.kind).toBe('seaBattle');
    expect(state.pending?.kind === 'seaBattle' && state.pending.payload.seaBattleId).toBe(slot.id);
    expect(events.some((e) => e.type === 'PendingRaised')).toBe(true);
    const a = slot.setup.attacker;
    expect(a.isPlayer).toBe(true);
    expect(a.fleetId).toBe(w.playerFleet);
    expect(a.ships).toHaveLength(2);
    expect(a.ships.reduce((n, s) => n + s.crew, 0)).toBe(50);
    // The ten trained archers are on the bows (plus levies to the default share).
    expect(a.ships.reduce((n, s) => n + s.archers, 0)).toBeGreaterThanOrEqual(10);
    for (const s of a.ships) expect(s.archers + s.boarders).toBeLessThanOrEqual(s.crew);
    expect(slot.setup.defender.isPlayer).toBe(false);
    expect(slot.setup.defender.captainId).toBeDefined();
    expect(slot.setup.wind).toEqual({ dir: 90, str: 'fresh' });
    expect(seaInvariants(state)).toEqual([]);
    // Time is stopped by the decision.
    expect(dispatch(state, { type: 'wait', days: 1 }, w.env).error?.code).toBe('pendingDecision');
  });

  it('a battle without the player is auto-resolved at once', () => {
    const w = world(false);
    const { state, events } = startBattle(w.state, w.env, w.aiFleet, w.ai2Fleet!);
    expect(state.pending).toBeNull();
    expect(state.subsims.seaBattle).toBeUndefined();
    const e = ended(events)!;
    expect(e.result.autoResolved).toBe(true);
    expect(e.playerSide).toBeUndefined();
  });

  it('a second player battle while one is open is auto-resolved without touching the open one', () => {
    const w = world(false);
    const first = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
    const open = first.subsims.seaBattle!;
    const { state, events } = startBattle(first, w.env, w.ai2Fleet!, w.playerFleet);
    expect(state.subsims.seaBattle).toEqual(open);
    expect(state.pending?.kind === 'seaBattle' && state.pending.payload.seaBattleId).toBe(open.id);
    expect(state.pendingQueue).toEqual(first.pendingQueue);
    const e = ended(events)!;
    expect(e.result.autoResolved).toBe(true);
    expect(e.playerSide).toBe('defender');
    expect(seaInvariants(state)).toEqual([]);
  });

  it('rejects impossible battles and bad parameters', () => {
    const w = world(false);
    expect(() => startBattle(w.state, w.env, w.playerFleet, w.playerFleet)).toThrow(/same faction/);
    expect(validateEffects(w.env, [{ op: 'startSeaBattle', attacker: {}, defender: { fleetId: w.aiFleet }, origin: 'x' }])).not.toEqual([]);
    expect(validateEffects(w.env, [{ op: 'startSeaBattle', attacker: { fleetId: w.playerFleet }, defender: { fleetId: w.aiFleet }, origin: 'x', arena: 'skerries' }])).toEqual([]);
    expect(validateEffects(w.env, [{ op: 'autoResolveSeaBattle', attacker: { fleetId: w.playerFleet }, defender: { factionId: w.factionIds[1], ships: [{ type: 'galley' }] }, origin: 'x' }])).toEqual([]);
  });
});

describe('startSeaBattle / applySeaBattleResult commands', () => {
  it("'auto' resolves now, applies the result through the owners' effects and clears the decision", () => {
    const w = world(true);
    const started = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
    const id = started.subsims.seaBattle!.id as `sea_${string}`;
    const r = dispatch(started, { type: 'startSeaBattle', seaBattleId: id, mode: 'auto' }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.pending).toBeNull();
    expect(r.state.subsims.seaBattle?.status).toBe('resolved');
    const e = ended(r.events)!;
    expect(e.unapplied).toEqual([]);
    expect(e.playerSide).toBe('attacker');
    expect(w.log.some((x) => x.op === 'killMen')).toBe(true);
    const shipOps = w.log.filter((x) => x.op === 'damageShip' || x.op === 'sinkShip' || x.op === 'captureShip');
    expect(shipOps.length).toBeGreaterThan(0);
    for (const op of shipOps) expect(typeof op.shipId).toBe('string');
    expect(missingEventKeys(r.events)).toEqual([]);
    expect(r.events.some((x) => x.type === 'Notification')).toBe(true);
    expect(r.events.some((x) => x.type === 'ChronicleAdded')).toBe(true);
    expect(seaInvariants(r.state)).toEqual([]);
  });

  it('every write-back effect passes the owners’ schemas over many auto-resolved battles', () => {
    for (let k = 0; k < 12; k++) {
      const w = world(true);
      const r = inDraft(w.state, w.env, (_d, ctx) => {
        ctx.applyEffects([
          {
            op: 'autoResolveSeaBattle',
            attacker: { fleetId: k % 2 === 0 ? w.playerFleet : w.aiFleet },
            defender: k % 3 === 0 ? { factionId: w.factionIds[2], ships: [{ type: 'knarr' }, { type: 'snekkja' }], role: 'merchant' } : { fleetId: k % 2 === 0 ? w.aiFleet : w.playerFleet },
            origin: `test${k}`,
            wind: { dir: k * 30, str: 'fresh' },
          },
        ]);
      });
      expect(ended(r.events)!.unapplied).toEqual([]);
      expectValidForOwners(w.log);
    }
  });

  it('reports ops that no module implements instead of failing', () => {
    const w = world(false);
    const started = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
    const r = dispatch(started, { type: 'startSeaBattle', seaBattleId: started.subsims.seaBattle!.id as `sea_${string}`, mode: 'auto' }, w.env);
    const e = ended(r.events)!;
    expect(e.unapplied.some((u) => u.startsWith('killMen: not registered'))).toBe(true);
  });

  it("'fight' hands the battle to the engine; the result comes back through applySeaBattleResult", () => {
    const w = world(true);
    const started = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
    const before = started.meta.mode;
    const id = started.subsims.seaBattle!.id as `sea_${string}`;
    const f = dispatch(started, { type: 'startSeaBattle', seaBattleId: id, mode: 'fight', deckShares: { archers: 0.2, boarders: 0.5 }, fireArrows: false }, w.env);
    expect(f.error).toBeUndefined();
    const slot = f.state.subsims.seaBattle!;
    expect(slot.status).toBe('running');
    expect(f.state.meta.mode).toBe('seaBattle');
    expect(f.state.pending?.kind).toBe('seaBattle');
    for (const s of slot.setup.attacker.ships) expect(s.boarders).toBe(Math.round(0.5 * s.crew));
    expect(seaInvariants(f.state)).toEqual([]);
    // The client runs the engine…
    const engine = new SeaBattleEngine(JSON.parse(JSON.stringify(slot.setup)), seaContent(getContent()), { aiControlsPlayer: true });
    const result = engine.runToEnd();
    // …and hands the result back.
    const a = dispatch(f.state, { type: 'applySeaBattleResult', seaBattleId: id, result }, w.env);
    expect(a.error).toBeUndefined();
    expect(a.state.pending).toBeNull();
    expect(a.state.meta.mode).toBe(before);
    expect(a.state.subsims.seaBattle?.status).toBe('resolved');
    expect(a.state.subsims.seaBattle?.result).toEqual(result);
    const e = ended(a.events)!;
    expect(e.result.autoResolved).toBe(false);
    expect(e.unapplied).toEqual([]);
    expect(seaInvariants(a.state)).toEqual([]);
    // Only once.
    expect(dispatch(a.state, { type: 'applySeaBattleResult', seaBattleId: id, result }, w.env).error?.code).toBe('notRunning');
  });

  it('rejects wrong ids, early results and results that do not fit the setup', () => {
    const w = world(true);
    const started = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
    const id = started.subsims.seaBattle!.id as `sea_${string}`;
    expect(dispatch(started, { type: 'startSeaBattle', seaBattleId: 'sea_999999', mode: 'auto' }, w.env).error?.code).toBe('noSeaBattle');
    const fake: SeaBattleResult = { winner: 'attacker', retreated: false, shipsSunk: ['shp_424242'], shipsCaptured: [], crewLost: [], durationS: 10, xp: {}, autoResolved: false };
    expect(dispatch(started, { type: 'applySeaBattleResult', seaBattleId: id, result: fake }, w.env).error?.code).toBe('notRunning');
    const running = dispatch(started, { type: 'startSeaBattle', seaBattleId: id, mode: 'fight' }, w.env).state;
    expect(dispatch(running, { type: 'applySeaBattleResult', seaBattleId: id, result: fake }, w.env).error?.code).toBe('invalidResult');
    expect(dispatch(running, { type: 'startSeaBattle', seaBattleId: id, mode: 'auto' }, w.env).error?.code).toBe('alreadyStarted');
    const badDeck = dispatch(started, { type: 'startSeaBattle', seaBattleId: id, mode: 'fight', deck: [{ shipId: 'shp_424242', archers: 1, boarders: 1 }] }, w.env);
    expect(badDeck.error?.code).toBe('unknownShip');
  });

  it('the autoResolveSeaBattle effect resolves a player battle without a decision', () => {
    const w = world(true);
    const r = inDraft(w.state, w.env, (_d, ctx) => {
      ctx.applyEffects([{ op: 'autoResolveSeaBattle', attacker: { fleetId: w.aiFleet }, defender: { fleetId: w.playerFleet }, origin: 'test' }]);
    });
    expect(r.state.pending).toBeNull();
    expect(r.state.subsims.seaBattle?.status).toBe('resolved');
    expect(ended(r.events)!.playerSide).toBe('defender');
    expect(seaInvariants(r.state)).toEqual([]);
  });

  it('the same game and commands give the same state', () => {
    const run = () => {
      const w = world(true);
      const s1 = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
      const r = dispatch(s1, { type: 'startSeaBattle', seaBattleId: s1.subsims.seaBattle!.id as `sea_${string}`, mode: 'auto' }, w.env);
      return JSON.stringify(r.state);
    };
    expect(run()).toBe(run());
  });
});

describe('writing results back', () => {
  function fixture() {
    const w = world(false);
    const started = startBattle(w.state, w.env, w.playerFleet, w.aiFleet).state;
    const setup = started.subsims.seaBattle!.setup;
    const state = inDraft(started, w.env, (d) => {
      d.fleets[w.aiFleet]!.cargo = { furs: 10, pitch: 2 };
      d.fleets[w.aiFleet]!.silver = 100;
      d.fleets[w.aiFleet]!.rations = 400;
    }).state;
    return { w, setup, state };
  }

  it('sinks, captures, damages, removes men, moves cargo and pitch', () => {
    const { w, setup, state } = fixture();
    const [p0, p1] = setup.attacker.ships;
    const [e0, e1] = setup.defender.ships;
    const result: SeaBattleResult = {
      winner: 'attacker',
      retreated: false,
      shipsSunk: [e0!.shipId],
      shipsCaptured: [e1!.shipId],
      capturedBy: { [e1!.shipId]: 'attacker' },
      crewLost: [
        { side: 'attacker', killed: 5, wounded: 4, captured: 0 },
        { side: 'defender', killed: 20, wounded: 0, captured: 15 },
      ],
      durationS: 600,
      xp: {},
      autoResolved: false,
      ships: [
        { shipId: p0!.shipId, side: 'attacker', status: 'active', hullHp: p0!.hullHp - 10, sailHp: p0!.sailHp, crew: 20 },
        { shipId: p1!.shipId, side: 'attacker', status: 'active', hullHp: p1!.hullHp, sailHp: p1!.sailHp, crew: 21 },
        { shipId: e0!.shipId, side: 'defender', status: 'sunk', hullHp: 0, sailHp: 0, crew: 0 },
        { shipId: e1!.shipId, side: 'defender', status: 'captured', hullHp: 30, sailHp: 20, crew: 0, capturedBy: 'attacker' },
      ],
      pitchUsedT: { attacker: 0, defender: 0.5 },
      captainFates: { [setup.defender.captainId!]: 'captured' },
    };
    const fx = seaResultEffects(state, getContent().balance, setup, result) as unknown as EffectData[];
    expectValidForOwners(fx);
    const ops = (op: string) => fx.filter((e) => e.op === op);
    expect(ops('sinkShip')).toEqual([{ op: 'sinkShip', shipId: e0!.shipId, cause: 'seaBattle' }]);
    // The prize is damaged to its battle condition first, then changes hands into the player's fleet.
    const prizeAt = fx.findIndex((e) => e.op === 'captureShip');
    expect(fx[prizeAt]).toEqual({ op: 'captureShip', shipId: e1!.shipId, factionId: setup.attacker.factionId, fleetId: w.playerFleet });
    const prizeDamage = fx.findIndex((e) => e.op === 'damageShip' && e.shipId === e1!.shipId);
    expect(prizeDamage).toBeGreaterThanOrEqual(0);
    expect(prizeDamage).toBeLessThan(prizeAt);
    expect(fx[prizeDamage]).toMatchObject({ hull: e1!.hullHp - 30, sail: e1!.sailHp - 20 });
    expect(ops('damageShip').find((e) => e.shipId === p0!.shipId)).toEqual({ op: 'damageShip', shipId: p0!.shipId, hull: 10, sail: 0, cause: 'seaBattle' });
    expect(ops('damageShip').some((e) => e.shipId === p1!.shipId)).toBe(false);
    // Men: the killed die, the captured are lost, the wounded go to recover (whole men per unit).
    const sum = (fleet: FleetId, k: 'count' | 'wounded' | 'captured') =>
      ops('killMen')
        .filter((e) => e.fleetId === fleet)
        .reduce((n, e) => n + ((e[k] as number | undefined) ?? 0), 0);
    expect(sum(w.aiFleet, 'count')).toBe(20);
    expect(sum(w.aiFleet, 'captured')).toBe(15);
    expect(sum(w.playerFleet, 'count')).toBe(5);
    expect(sum(w.playerFleet, 'wounded')).toBe(4);
    // Both enemy holds are lost; the prize's share of the cargo, silver and rations comes to the player's fleet.
    expect(ops('addGoods').find((e) => e.good === 'pitch' && e.fleetId === w.aiFleet && (e.tons as number) === -0.5)).toBeDefined();
    expect(ops('addGoods').find((e) => e.good === 'furs' && e.fleetId === w.aiFleet)?.tons).toBe(-10);
    const share = e1!.cargoShare!;
    expect(ops('addGoods').find((e) => e.good === 'furs' && e.fleetId === w.playerFleet)?.tons).toBeCloseTo(10 * share, 2);
    expect(ops('addSilver').find((e) => e.fleetId === w.playerFleet)?.amount).toBe(Math.floor(100 * share));
    expect(ops('addRations').find((e) => e.fleetId === w.aiFleet)?.count).toBe(-400);
    expect(ops('addRations').find((e) => e.fleetId === w.playerFleet)?.count).toBe(Math.floor(400 * share));
    expect(ops('capture')).toEqual([{ op: 'capture', charId: setup.defender.captainId, byFactionId: setup.attacker.factionId, cause: 'seaBattle' }]);
  });

  it("an encounter's explicit ship taken as a prize enters the world through addShip", () => {
    const w = world(false);
    const r = inDraft(w.state, w.env, (_d, ctx) => {
      ctx.applyEffects([
        { op: 'startSeaBattle', attacker: { fleetId: w.playerFleet }, defender: { factionId: w.factionIds[1], ships: [{ type: 'knarr', crew: 10 }], role: 'merchant' }, origin: 'test' },
      ]);
    });
    const setup = r.state.subsims.seaBattle!.setup;
    const prize = setup.defender.ships[0]!;
    expect(prize.virtual).toBe(true);
    const result: SeaBattleResult = {
      winner: 'attacker',
      retreated: false,
      shipsSunk: [],
      shipsCaptured: [prize.shipId],
      crewLost: [{ side: 'defender', killed: 0, wounded: 0, captured: 10 }],
      durationS: 100,
      xp: {},
      autoResolved: false,
      surrendered: true,
    };
    const fx = seaResultEffects(r.state, getContent().balance, setup, result) as unknown as EffectData[];
    expectValidForOwners(fx);
    expect(fx.filter((e) => e.op === 'captureShip')).toEqual([]);
    expect(fx.find((e) => e.op === 'addShip')).toMatchObject({ shipType: 'knarr', factionId: setup.attacker.factionId, fleetId: w.playerFleet });
    // No muster to remove men from on the encounter's side.
    expect(fx.filter((e) => e.op === 'killMen')).toEqual([]);
  });

  it("leaves the captain duel's death or capture of its loser to people's SeaBattleEnded reaction", () => {
    const { setup, state } = fixture();
    const player = setup.attacker.captainId!;
    const enemy = setup.defender.captainId!;
    const withPlayer = { ...setup, playerCharId: player };
    const base: SeaBattleResult = { winner: 'attacker', retreated: false, shipsSunk: [], shipsCaptured: [], crewLost: [], durationS: 60, xp: {}, autoResolved: false };
    const killed = seaResultEffects(state, getContent().balance, withPlayer, {
      ...base,
      captainFates: { [player]: 'fine', [enemy]: 'dead' },
      captainDuel: { winnerId: player, loserFate: 'killed', injuries: [{ charId: player, injury: 'scar' }], renown: 5, autoResolved: false },
    }) as unknown as EffectData[];
    expect(killed.filter((e) => e.op === 'kill')).toEqual([]);
    expect(killed.filter((e) => e.op === 'woundCharacter')).toEqual([]);
    // A yielded captain is not taken by the duel itself: the prize crew takes him.
    const yielded = seaResultEffects(state, getContent().balance, withPlayer, {
      ...base,
      captainFates: { [player]: 'wounded', [enemy]: 'captured' },
      captainDuel: { winnerId: player, loserFate: 'yielded', injuries: [], renown: 5, autoResolved: false },
    }) as unknown as EffectData[];
    expectValidForOwners(yielded);
    expect(yielded.filter((e) => e.op === 'capture').map((e) => e.charId)).toEqual([enemy]);
    expect(yielded.filter((e) => e.op === 'woundCharacter').map((e) => e.charId)).toEqual([player]);
  });

  it('never sinks a ship the battle left afloat (rounding keeps 1 hull)', () => {
    const { setup, state } = fixture();
    const [p0] = setup.attacker.ships;
    const result: SeaBattleResult = {
      winner: 'defender',
      retreated: true,
      shipsSunk: [],
      shipsCaptured: [],
      crewLost: [],
      durationS: 300,
      xp: {},
      autoResolved: false,
      ships: [{ shipId: p0!.shipId, side: 'attacker', status: 'fled', hullHp: 0, sailHp: 0, crew: 10 }],
    };
    const fx = seaResultEffects(state, getContent().balance, setup, result) as unknown as EffectData[];
    expect(fx.filter((e) => e.op === 'sinkShip')).toEqual([]);
    expect(fx.find((e) => e.op === 'damageShip' && e.shipId === p0!.shipId)).toMatchObject({ hull: p0!.hullHp - 1, sail: p0!.sailHp });
  });

  it('splits losses over units without taking more than a unit has', () => {
    const men: Record<string, number> = { bondi: 30, archers: 10, huscarls: 2 };
    const rows = splitLosses(men, { killed: 20, wounded: 12, captured: 9 });
    const total = (k: 'killed' | 'wounded' | 'captured') => rows.reduce((n, r) => n + r[k], 0);
    expect(total('killed')).toBe(20);
    expect(total('wounded')).toBe(12);
    expect(total('captured')).toBe(9);
    for (const r of rows) expect(r.killed + r.wounded + r.captured).toBeLessThanOrEqual(men[r.unit]!);
    expect(splitLosses({ bondi: 5 }, { killed: 9, wounded: 9, captured: 9 })).toEqual([{ unit: 'bondi', killed: 5, wounded: 0, captured: 0 }]);
  });
});
