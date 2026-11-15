/**
 * Duel test fixtures (other modules' tests may import these): synthetic fighter profiles and
 * setups for the pure engines, a stand-in for the people module's character effect ops, and a
 * helper that creates fighters in a test state.
 */
import { getContent } from '@content/index';
import type { DuelWeaponId } from '@content/schemas/ids';
import { createCharacter } from '@sim/core/factory';
import type { EffectHandlers, SimContext, SimModule } from '@sim/core/module';
import type { CharId, CultureId, DuelSetup, FactionId, GameState, WoundState } from '@sim/core/state';
import { buildProfile, type DuelContent, type FighterStats, type ProfileInput } from './stats';
import type { AiStyle, DuelArena, DuelStakes } from './types';

/** The bundled content as DuelContent. */
export function testDuelContent(): DuelContent {
  const c = getContent();
  return { balance: c.balance, traits: c.traits, feats: c.feats, cultures: c.cultures, tunables: c.tunables };
}

/** Options for a synthetic fighter. */
export interface TestFighter {
  name?: string;
  stats?: Partial<FighterStats>;
  weapon?: DuelWeaponId;
  armourTier?: number;
  weaponTier?: number;
  traits?: string[];
  feats?: string[];
  style?: AiStyle;
  hpPct?: number;
}

const BASE_STATS: FighterStats = { might: 4, agility: 4, wits: 4, vigor: 4, melee: 3, level: 1 };

/** A profile input with sensible defaults (Might/Agility/Wits/Vigor 4, Melee 3, axe, armour 2). */
export function testProfileInput(charId: CharId, f: TestFighter = {}, stakes: DuelStakes = 'yield', holmgang = false): ProfileInput {
  const input: ProfileInput = {
    charId,
    name: f.name ?? charId,
    stats: { ...BASE_STATS, ...f.stats },
    gear: { weapon: f.weapon ?? 'axe', armourTier: f.armourTier ?? 2, weaponTier: f.weaponTier ?? 3 },
    traits: f.traits ?? [],
    feats: f.feats ?? [],
    stakes,
    holmgang,
  };
  if (f.style !== undefined) input.style = f.style;
  if (f.hpPct !== undefined) input.hpPct = f.hpPct;
  return input;
}

/** A complete DuelSetup with profiles, for the pure engines (no GameState). */
export function testDuelSetup(
  a: TestFighter = {},
  b: TestFighter = {},
  opts: { arena?: DuelArena; stakes?: DuelStakes; seed?: string; playerSide?: 'a' | 'b' | null; content?: DuelContent } = {},
): DuelSetup {
  const content = opts.content ?? testDuelContent();
  const stakes = opts.stakes ?? 'yield';
  const arena = opts.arena ?? 'hall';
  const holmgang = arena === 'holmgang';
  const pa = buildProfile(content, testProfileInput('chr_9001', a, stakes, holmgang));
  const pb = buildProfile(content, testProfileInput('chr_9002', b, stakes, holmgang));
  return {
    id: 'duel_9000',
    a: { charId: pa.charId, weapon: pa.weapon, armourTier: pa.armourTier, weaponTier: pa.weaponTier },
    b: { charId: pb.charId, weapon: pb.weapon, armourTier: pb.armourTier, weaponTier: pb.weaponTier },
    arena,
    stakes,
    assisted: false,
    seed: opts.seed ?? 'test-duel',
    origin: 'other',
    lethal: stakes === 'death',
    gentle: false,
    difficulty: 'raider',
    playerSide: opts.playerSide === undefined ? null : opts.playerSide,
    profiles: { a: pa, b: pb },
    tiers: { a: 0, b: 0 },
  };
}

const WOUNDS: readonly WoundState[] = ['none', 'minor', 'serious', 'mortal'];

/** Record of the character ops a test people module received (kept in state.flags as JSON-safe counters). */
export function testPeopleCalls(state: GameState, op: string, charId: CharId): number {
  const v = state.flags[`testPeople.${op}.${charId}`];
  return typeof v === 'number' ? v : 0;
}

function bump(state: GameState, op: string, charId: string): void {
  const key = `testPeople.${op}.${charId}`;
  const v = state.flags[key];
  state.flags[key] = (typeof v === 'number' ? v : 0) + 1;
}

/**
 * A stand-in for the people module's character ops (woundCharacter, addTrait, kill, capture) with
 * the parameter shapes the duel module sends. Registered under a test module id.
 */
export function testPeopleModule(): SimModule {
  const effects = {
    woundCharacter(draft: GameState, e: { charId: CharId; wound: WoundState; injury?: string; cause?: string }, ctx: SimContext) {
      const ch = draft.characters[e.charId];
      if (!ch) throw new Error(`woundCharacter: unknown ${e.charId}`);
      if (WOUNDS.indexOf(e.wound) > WOUNDS.indexOf(ch.health.wound)) ch.health.wound = e.wound;
      if (e.injury !== undefined) ch.health.injuries.push({ id: e.injury, untilHour: ctx.hour + 30 * 24 });
      bump(draft, 'woundCharacter', e.charId);
    },
    addTrait(draft: GameState, e: { charId: CharId; trait: string }) {
      const ch = draft.characters[e.charId];
      if (!ch) throw new Error(`addTrait: unknown ${e.charId}`);
      if (!ch.traits.includes(e.trait)) ch.traits.push(e.trait);
      bump(draft, 'addTrait', e.charId);
    },
    kill(draft: GameState, e: { charId: CharId; cause: string; killerId?: CharId }, ctx: SimContext) {
      const ch = draft.characters[e.charId];
      if (!ch) throw new Error(`kill: unknown ${e.charId}`);
      ch.alive = false;
      ch.death = { hour: ctx.hour, cause: e.cause };
      bump(draft, 'kill', e.charId);
    },
    capture(draft: GameState, e: { charId: CharId; captorFactionId: FactionId; at?: string }) {
      const ch = draft.characters[e.charId];
      if (!ch) throw new Error(`capture: unknown ${e.charId}`);
      if (e.at !== undefined && e.at.startsWith('set_')) ch.location = { kind: 'captive', at: e.at as `set_${string}`, by: e.captorFactionId };
      bump(draft, 'capture', e.charId);
    },
  };
  return { id: 'testPeople', order: 100, effects: effects as unknown as EffectHandlers };
}

/** Options for a fighter created in a test state. */
export interface TestCharacterOptions {
  culture?: CultureId;
  factionId?: FactionId;
  attributes?: Partial<{ might: number; agility: number; wits: number; vigor: number }>;
  melee?: number;
  traits?: string[];
  level?: number;
  role?: 'lieutenant' | 'captain' | 'npc';
  personality?: { aggression: number; greed: number; honor: number; caution: number; ambition: number; piety: number };
}

/** Creates a fighter in a draft (use inside `inDraft`). */
export function testCreateFighter(draft: GameState, ctx: SimContext, opts: TestCharacterOptions = {}): CharId {
  const ch = createCharacter(draft, ctx, {
    culture: opts.culture ?? 'albric',
    age: 30,
    attributes: opts.attributes ?? {},
    skills: { melee: opts.melee ?? 3 },
    traits: opts.traits ?? [],
    level: opts.level ?? 3,
    ...(opts.factionId !== undefined ? { factionId: opts.factionId } : {}),
    ...(opts.role !== undefined ? { role: { kind: opts.role, ...(opts.factionId !== undefined ? { factionId: opts.factionId } : {}) } } : {}),
    ...(opts.personality !== undefined ? { personality: opts.personality } : {}),
  });
  return ch.id;
}
