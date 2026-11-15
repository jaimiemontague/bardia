/**
 * The empty, valid root state. Player references point at the reserved "unset" ids (`*_0`, never
 * minted because meta.nextId starts at 1) until createPlaceholderPlayer or the world module sets them.
 */
import type { DifficultyId } from '@content/schemas/ids';
import { CURRENT_SCHEMA_VERSION } from '../save/migrations';
import type { GameOptions, GameState } from './state';
import { GAME_VERSION } from './version';

export const UNSET_CHAR_ID = 'chr_0' as const;
export const UNSET_FACTION_ID = 'fac_0' as const;
export const UNSET_SETTLEMENT_ID = 'set_0' as const;

export const DEFAULT_OPTIONS: GameOptions = {
  ironman: false,
  gentleMode: false,
  duelAssist: true,
  autoResolveFair: false,
  harshWinters: false,
  blood: true,
  anySexMarriage: true,
};

export interface EmptyStateOptions {
  seed: string;
  difficulty?: DifficultyId;
  options?: Partial<GameOptions>;
}

export function createEmptyState(opts: EmptyStateOptions): GameState {
  if (typeof opts.seed !== 'string' || opts.seed.length === 0) throw new RangeError('createEmptyState: seed must be a non-empty string');
  return {
    meta: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      gameVersion: GAME_VERSION,
      seed: opts.seed,
      difficulty: opts.difficulty ?? 'raider',
      options: { ...DEFAULT_OPTIONS, ...(opts.options ?? {}) },
      nextId: 1,
      mode: 'hub',
      moduleVersions: {},
    },
    time: { hour: 0 },
    rng: {},
    player: {
      rulerId: UNSET_CHAR_ID,
      factionId: UNSET_FACTION_ID,
      capitalId: UNSET_SETTLEMENT_ID,
      house: {
        renown: 0,
        honor: 0,
        dread: 0,
        favor: { valgrim: 0, dunnar: 0, saltha: 0, fjorna: 0, eidr: 0, skell: 0, grayQueen: 0 },
        faithWrath: 0,
        faith: 'oldways',
      },
      sagaLedger: { milestones: {}, ambitions: [] },
      knownMapRef: '',
      policies: { envoy: 'acceptFavorable', petitions: 'ask' },
    },
    characters: {},
    factions: {},
    provinces: {},
    settlements: {},
    sites: {},
    fleets: {},
    ships: {},
    armies: {},
    relations: {},
    markets: {},
    intel: {},
    news: {},
    storylets: { cooldowns: {}, onceFired: [], scheduled: [] },
    quests: {},
    relics: {},
    weather: { zones: {}, storms: [], lastUpdateHour: 0 },
    chronicle: [],
    codex: { unlocked: {} },
    subsims: {},
    pending: null,
    pendingQueue: [],
    flags: {},
  };
}
