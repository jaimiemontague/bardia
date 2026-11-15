/**
 * Building a duel from GameState (reads only): resolving duelist references, default gear, the
 * player's side, Renown tiers (§14.9) and the fighter profiles. Pure functions over a (draft or
 * frozen) state; the module's effect and command handlers write the result into `subsims.duel`.
 */
import type { DuelWeaponId } from '@content/schemas/ids';
import type { Tunables as DuelTunables } from '@content/schemas/tunables/duel';
import type { Character, CharId, DuelId, Duelist, DuelSetup, FactionId, GameState, SettlementId } from '@sim/core/state';
import { defaultWeapon, duelStyle, effectiveStats, profileFromCharacter, type DuelContent, type DuelGear } from './stats';
import type { DuelistRef, DuelSide, StartDuelEffect } from './types';

/** A duelist reference resolved to a character id plus optional gear overrides. */
export interface ResolvedRef {
  charId: CharId;
  weapon?: DuelWeaponId;
  armourTier?: number;
  weaponTier?: number;
  ratingBonus?: number;
  damagePct?: number;
}

/** Resolves 'player' to the player's ruler and unwraps the object form. */
export function resolveRef(state: GameState, ref: DuelistRef): ResolvedRef {
  if (typeof ref === 'string') return { charId: ref === 'player' ? state.player.rulerId : ref };
  const out: ResolvedRef = { charId: ref.charId === 'player' ? state.player.rulerId : ref.charId };
  if (ref.weapon !== undefined) out.weapon = ref.weapon;
  if (ref.armourTier !== undefined) out.armourTier = ref.armourTier;
  if (ref.weaponTier !== undefined) out.weaponTier = ref.weaponTier;
  if (ref.ratingBonus !== undefined) out.ratingBonus = ref.ratingBonus;
  if (ref.damagePct !== undefined) out.damagePct = ref.damagePct;
  return out;
}

/** The character, if it exists (own property) — never throws. */
export function characterOf(state: GameState, id: CharId): Character | undefined {
  return Object.hasOwn(state.characters, id) ? state.characters[id] : undefined;
}

/** The faction a character fights for: its own faction, or the faction it rules. */
export function factionOfCharacter(state: GameState, ch: Character): FactionId | undefined {
  if (ch.factionId !== undefined && Object.hasOwn(state.factions, ch.factionId)) return ch.factionId;
  const ruled = ch.role?.factionId;
  if (ruled !== undefined && Object.hasOwn(state.factions, ruled)) return ruled;
  return undefined;
}

/** True when the player's house controls this fighter: the ruler, or a member of the player's faction (a champion). */
export function playerControls(state: GameState, ch: Character): boolean {
  return ch.id === state.player.rulerId || factionOfCharacter(state, ch) === state.player.factionId;
}

/** Renown tier of a fighter (§14.9): commoner 0, hersir 1, jarl 2, king 3, Nemesis 4. */
export function renownTier(state: GameState, tunables: DuelTunables, tiers: { commoner: number; hersir: number; jarl: number; king: number; nemesis: number }, ch: Character): number {
  const factionId = factionOfCharacter(state, ch);
  const faction = factionId !== undefined ? state.factions[factionId] : undefined;
  if (faction && faction.rulerId === ch.id) {
    if (faction.kind === 'nemesis' || state.player.nemesis?.factionId === faction.id) return tiers.nemesis;
    if (tunables.outcome.kingFactionKinds.includes(faction.kind)) return tiers.king;
    return tiers.jarl;
  }
  if (ch.role !== undefined && tunables.outcome.hersirRoles.includes(ch.role.kind)) return tiers.hersir;
  return tiers.commoner;
}

/** Where a captive taken by this fighter's house would be held: the fighter's settlement, else the faction's first holding. */
export function captiveSettlement(state: GameState, ch: Character): SettlementId | undefined {
  if (ch.location.kind === 'settlement' && Object.hasOwn(state.settlements, ch.location.id)) return ch.location.id;
  const factionId = factionOfCharacter(state, ch);
  const faction = factionId !== undefined ? state.factions[factionId] : undefined;
  if (faction && faction.id === state.player.factionId && Object.hasOwn(state.settlements, state.player.capitalId)) return state.player.capitalId;
  return faction?.holdingIds.find((id) => Object.hasOwn(state.settlements, id));
}

/** Default gear of a fighter: its faction's armoury and weapon tiers and the §14.4 default weapon. */
export function gearFor(state: GameState, content: DuelContent, ch: Character, ref: ResolvedRef, npc: boolean): Duelist {
  const factionId = factionOfCharacter(state, ch);
  const faction = factionId !== undefined ? state.factions[factionId] : undefined;
  const weaponTier = ref.weaponTier ?? faction?.weaponTier ?? 1;
  const armourTier = ref.armourTier ?? faction?.armouryTier ?? 1;
  const cultureWeapon = Object.hasOwn(content.cultures, ch.culture) ? content.cultures[ch.culture].defaultWeapon : undefined;
  const style = npc ? duelStyle(content.tunables.duel, ch.personality, ch.traits, effectiveStats(content, ch, state.time.hour).might) : undefined;
  const weapon = ref.weapon ?? defaultWeapon(content, cultureWeapon, weaponTier, style);
  const duelist: Duelist = { charId: ch.id, weapon, armourTier, weaponTier };
  if (ref.ratingBonus !== undefined) duelist.ratingBonus = ref.ratingBonus;
  if (ref.damagePct !== undefined) duelist.damagePct = ref.damagePct;
  return duelist;
}

/** The DuelGear of a setup duelist. */
export function gearOf(d: Duelist): DuelGear {
  const gear: DuelGear = { weapon: d.weapon, armourTier: d.armourTier, weaponTier: d.weaponTier };
  if (d.ratingBonus !== undefined) gear.ratingBonus = d.ratingBonus;
  if (d.damagePct !== undefined) gear.damagePct = d.damagePct;
  return gear;
}

/** An own property of a plain object (never the prototype chain), else undefined. */
function own(obj: unknown, key: string): unknown {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj) && Object.hasOwn(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * `duel.nervePct` of the duel omen in force for a fighter's house (§14.1 "Eidr's Favor applies",
 * §22.6 duel omen = Eidr + Dunnar): the player's house reading (`player.house.omens.duel`) for the
 * player's side, otherwise the fighter's faction's (`factions[id].omens.duel`), looked up in the
 * faith tunables `omens.extraModifiers.duel[omen]`. This reads the faith module's published state
 * contract structurally (no runtime or type coupling to its folder); 0 when there is no reading in
 * force or faith is not loaded.
 */
export function omenNervePct(state: GameState, content: DuelContent, ch: Character, playerHouse: boolean): number {
  let holder: unknown;
  if (playerHouse) holder = state.player.house;
  else {
    const factionId = factionOfCharacter(state, ch);
    holder = factionId !== undefined ? state.factions[factionId] : undefined;
  }
  const reading = own(own(holder, 'omens'), 'duel');
  const omen = own(reading, 'omen');
  const until = own(reading, 'untilHour');
  if (typeof omen !== 'string' || typeof until !== 'number' || until <= state.time.hour) return 0;
  const tunables: unknown = content.tunables;
  const bag = own(own(own(own(own(tunables, 'faith'), 'omens'), 'extraModifiers'), 'duel'), omen);
  const v = own(bag, 'duel.nervePct');
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** (Re)computes both fighter profiles of a setup from the current characters. Throws if a fighter is missing. */
export function computeProfiles(state: GameState, content: DuelContent, setup: DuelSetup): NonNullable<DuelSetup['profiles']> {
  const make = (side: DuelSide) => {
    const d = setup[side];
    const ch = characterOf(state, d.charId);
    if (!ch) throw new RangeError(`duel ${setup.id}: unknown character ${d.charId}`);
    const opts = {
      hour: state.time.hour,
      stakes: setup.stakes,
      holmgang: setup.arena === 'holmgang',
      omenNervePct: omenNervePct(state, content, ch, setup.playerSide === side),
    };
    return profileFromCharacter(content, ch, gearOf(d), opts);
  };
  return { a: make('a'), b: make('b') };
}

/** Which side the player's house fights as (null: an NPC duel). */
export function playerSideOf(state: GameState, a: Character, b: Character): DuelSide | null {
  const pa = playerControls(state, a);
  const pb = playerControls(state, b);
  if (pa && pb) return b.id === state.player.rulerId ? 'b' : 'a';
  if (pa) return 'a';
  if (pb) return 'b';
  return null;
}

/** Builds a complete DuelSetup (profiles and tiers included) for a `startDuel` effect. */
export function buildDuelSetup(
  state: GameState,
  content: DuelContent,
  params: StartDuelEffect,
  refs: { a: ResolvedRef; b: ResolvedRef },
  id: DuelId,
  seed: string,
): DuelSetup {
  const a = characterOf(state, refs.a.charId);
  const b = characterOf(state, refs.b.charId);
  if (!a || !b) throw new RangeError(`duel ${id}: unknown fighter`);
  const playerSide = playerSideOf(state, a, b);
  const tunables = content.tunables.duel;
  const declinable = params.declinable ?? Object.hasOwn(tunables.outcome.declineRenown, params.origin);
  const setup: DuelSetup = {
    id,
    a: gearFor(state, content, a, refs.a, playerSide !== 'a'),
    b: gearFor(state, content, b, refs.b, playerSide !== 'b'),
    arena: params.arena,
    stakes: params.origin === 'practice' ? 'yield' : params.stakes,
    assisted: state.meta.options.duelAssist,
    seed,
    origin: params.origin,
    lethal: params.origin !== 'practice' && params.stakes === 'death',
    gentle: state.meta.options.gentleMode,
    difficulty: state.meta.difficulty,
    playerSide,
    champion: playerSide !== null && (playerSide === 'a' ? a : b).id !== state.player.rulerId,
    declinable: playerSide !== null && declinable,
  };
  if (params.ref !== undefined) setup.ref = params.ref;
  const tiers = content.balance.duel.renown.tiers;
  setup.tiers = { a: renownTier(state, tunables, tiers, a), b: renownTier(state, tunables, tiers, b) };
  setup.profiles = computeProfiles(state, content, setup);
  return setup;
}
