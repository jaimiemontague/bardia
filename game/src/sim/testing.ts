/**
 * Test helpers for kernel and module tests (pure, deterministic; safe to import from any *.test.ts).
 * This file imports ONLY the kernel — never the module registry or session.ts — so a module's tests
 * load core plus that module, and another agent's half-written module cannot break them.
 *
 *   const env = testEnv([myModule]);
 *   const state = testState({ modules: [myModule] });
 *   const { state: next, events } = inDraft(state, env, (draft, ctx) => mySystem(draft, ctx));
 *   const world = testWorld({ modules: [myModule], factions: 4 });   // several factions, markets, fleets
 *
 * Module-specific fixtures belong in src/sim/modules/<id>/testing.ts (other modules' tests may
 * import those). Never snapshot ids or state hashes from full-registry runs in module tests: ids
 * come from one global counter, so another module creating an entity shifts them.
 */
import type { Content } from '@content/index';
import { getContent } from '@content/index';
import { missingLocaleKeys } from '@content/locales/index';
import { CULTURE_IDS, GOOD_IDS, type CultureId, type GoodId } from '@content/schemas/ids';
import { eventTextKeys } from './core/builtins';
import { runOperation, type KernelContext } from './core/context';
import { createSimEnv } from './core/env';
import type { SimEvent } from './core/events';
import {
  createCharacter,
  createFaction,
  createFleet,
  createProvince,
  createSettlement,
  createShip,
  getOrCreateRelation,
} from './core/factory';
import { createNewGameState, type NewGameOptions } from './core/lifecycle';
import type { SimContext, SimEnv, SimModule } from './core/module';
import type { FactionId, FleetId, GameState, Market, SettlementId } from './core/state';

/** A validated env with only the given modules (plus core). */
export function testEnv(modules: readonly SimModule[] = [], content: Content = getContent()): SimEnv {
  return createSimEnv({ modules, content });
}

/** Options for testState / testWorld. */
export type TestStateOptions = Partial<NewGameOptions> & { modules?: readonly SimModule[]; content?: Content };

/** A fresh new-game state (placeholder player, given modules initialised). */
export function testState(opts: TestStateOptions = {}): GameState {
  const { modules = [], content, ...rest } = opts;
  return createNewGameState({ seed: 'test-seed', ...rest }, testEnv(modules, content ?? getContent())).state;
}

/** Runs `fn` on an Immer draft of `state` with a context (one kernel operation); returns the new state and events. */
export function inDraft(
  state: GameState,
  env: SimEnv,
  fn: (draft: GameState, ctx: SimContext) => void,
): { state: GameState; events: SimEvent[] } {
  const r = runOperation(state, env, (draft: GameState, ctx: KernelContext) => {
    fn(draft, ctx);
  });
  return { state: r.state, events: r.events };
}

/**
 * Localisation keys carried by `events` that have no English string (src/content/locales/en).
 * Module tests: `expect(missingEventKeys(events)).toEqual([])`.
 */
export function missingEventKeys(events: readonly SimEvent[]): string[] {
  return missingLocaleKeys(events.flatMap(eventTextKeys));
}

export interface TestWorldOptions extends TestStateOptions {
  /** Factions including the player's (default 3). */
  factions?: number;
  /** Settlements per faction, the player's capital included (default 2). */
  settlementsPerFaction?: number;
  /** Fleets per faction (default 1). */
  fleetsPerFaction?: number;
}

export interface TestWorld {
  state: GameState;
  env: SimEnv;
  /** factionIds[0] is the player's faction. */
  factionIds: FactionId[];
  settlementIds: Record<FactionId, SettlementId[]>;
  fleetIds: Record<FactionId, FleetId[]>;
}

const NPC_CULTURES: readonly CultureId[] = CULTURE_IDS.filter((c) => c !== 'skarn');
const MARKET_GOODS: readonly GoodId[] = GOOD_IDS;

function testMarket(index: number): Market {
  const stock: Market['stock'] = {};
  const target: Market['target'] = {};
  const prod: Market['prod'] = {};
  const cons: Market['cons'] = {};
  MARKET_GOODS.forEach((good, g) => {
    const base = 5 + ((index * 7 + g * 3) % 11);
    stock[good] = base;
    target[good] = 10;
    prod[good] = (index + g) % 3;
    cons[good] = (index + g + 1) % 3;
  });
  return { stock, target, prod, cons, lastUpdate: 0 };
}

/**
 * A deterministic multi-faction world for module tests: the placeholder player plus N−1 AI
 * factions (rulers, coastal settlements with markets, docked fleets with ships, men and rations)
 * and neutral relations between every pair of factions. The player's settlements are holdings.
 * Entities are created with the 'testWorld' factory/name streams, so module streams are untouched.
 */
export function testWorld(opts: TestWorldOptions = {}): TestWorld {
  const { factions = 3, settlementsPerFaction = 2, fleetsPerFaction = 1, modules = [], content, ...rest } = opts;
  const env = testEnv(modules, content ?? getContent());
  const base = createNewGameState({ seed: 'test-world', ...rest }, env).state;
  const factionIds: FactionId[] = [];
  const settlementIds: Record<FactionId, SettlementId[]> = {};
  const fleetIds: Record<FactionId, FleetId[]> = {};
  const r = runOperation(base, env, (draft, ctx) =>
    ctx.runAs('testWorld', () => {
      const balance = ctx.balance;
      const player = draft.player;
      factionIds.push(player.factionId);
      settlementIds[player.factionId] = [player.capitalId];
      draft.markets[player.capitalId] = testMarket(0);
      for (let f = 1; f < factions; f++) {
        const culture = NPC_CULTURES[(f - 1) % NPC_CULTURES.length] as CultureId;
        const faction = createFaction(draft, ctx, { culture, kind: 'jarldom', treasury: 1000 * f, colorIndex: f });
        factionIds.push(faction.id);
        settlementIds[faction.id] = [];
      }
      factionIds.forEach((factionId, f) => {
        const faction = draft.factions[factionId];
        if (!faction) return;
        const province = createProvince(draft, { name: `Province ${f}`, regionId: `testRegion${f}`, homeland: f === 0 });
        const list = settlementIds[factionId] as SettlementId[];
        while (list.length < settlementsPerFaction) {
          const j = list.length;
          const s = createSettlement(draft, ctx, {
            culture: faction.culture,
            provinceId: province.id,
            factionId,
            tier: j === 0 ? 'town' : 'village',
            pop: j === 0 ? 1500 : 400,
            mapPos: { x: 10 + 40 * f, y: 10 + 15 * j },
            silver: 200,
            garrison: { bondi: 30, archers: 10 },
            fortTier: 1,
            coastal: true,
            isCapital: j === 0,
          });
          draft.markets[s.id] = testMarket(f * 10 + j);
          if (f === 0) {
            s.holding = {
              governorId: player.rulerId,
              tax: 'fair',
              loyalty: balance.holdings.startLoyalty,
              foodMonths: 6,
              pool: { max: 0, current: 0, veterans: {} },
              buildQueue: [],
              shipQueue: [],
              garrisonTarget: Math.ceil(s.pop * balance.holdings.garrisonMinPopShare),
            };
          }
          list.push(s.id);
        }
        fleetIds[factionId] = [];
        for (let k = 0; k < fleetsPerFaction; k++) {
          const home = draft.settlements[list[0] as SettlementId];
          if (!home) break;
          const captain = createCharacter(draft, ctx, {
            culture: faction.culture,
            age: 30,
            role: { kind: 'captain', factionId },
            factionId,
            location: { kind: 'settlement', id: home.id },
          });
          const ships = [0, 1].map(() => createShip(draft, ctx, { type: 'snekkja', ownerId: factionId, homeName: home.name, dockedAt: home.id }).id);
          const fleet = createFleet(draft, ctx, {
            ownerId: factionId,
            leaderId: captain.id,
            pos: { ...home.mapPos },
            shipIds: ships,
            men: { bondi: 40, archers: 10 },
            rations: 1000,
            silver: 100,
            mode: 'docked',
          });
          captain.location = { kind: 'fleet', id: fleet.id };
          (fleetIds[factionId] as FleetId[]).push(fleet.id);
        }
      });
      for (let i = 0; i < factionIds.length; i++) {
        for (let j = i + 1; j < factionIds.length; j++) getOrCreateRelation(draft, factionIds[i] as string, factionIds[j] as string);
      }
    }),
  );
  return { state: r.state, env, factionIds, settlementIds, fleetIds };
}
