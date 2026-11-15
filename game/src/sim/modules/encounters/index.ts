/**
 * 'encounters' simulation module (scheduler order 30).
 * Scope: Visible and hidden encounters at sea and on land: sighting, evade, toll, hail (§8.6, §8.7, §15.1, §31.4).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: resolveEncounter
 *   pending kinds: encounter
 *   events: EncounterSighted
 * Module-owned additions: event EncounterResolved; state `encounters`; id prefix `enc_`.
 * Effects used (owned elsewhere, skipped when absent): core addSilver/addGoods/addRations, changeOpinion/Renown/
 *   Honor/Dread; news hearNews, addNews; intel observeSettlement; people grantXp, woundCharacter; military killMen;
 *   battle startBattle; seabattle startSeaBattle. Fleet morale and crew stamina are written directly (no owner op).
 * Tunables: src/content/data/tunables/encounters.json (+ schemas/tunables/encounters.ts), read as ctx.tunables.encounters;
 *   the §31.4 formulas are balance.encounters; zone traffic and encounter mix are the world geography's.
 * Strings/assets: src/content/locales/en/encounters.json and src/content/assets/manifest/encounters.json (prefix 'encounters.').
 * Gate: npm run verify:module -- encounters
 *
 * HOW IT WORKS
 *   - daily: while the player's expedition is under way (a route ahead, past `graceDays`, not within
 *     `minDaysBetween` of the last encounter) roll once. At sea: a real fleet in sight (§8.6 visible), else a
 *     sighting with the zone's daily chance (generate.ts). Ashore: the land party meets outlaws or patrols.
 *   - The encounter card (pending 'encounter') carries the generic modal's fields: the options of §15.1 with
 *     the companion whose skill counts and honest odds; unavailable options greyed out with the reason. Its
 *     first choice is always safe (hail, pass, evade, slip away; on the "caught" card: yield goods or fall back).
 *   - resolveEncounter applies the answer (resolve.ts). Fights go to the battle modules (their pre-battle
 *     decisions: battleSetup, seaBattle); BattleEnded / SeaBattleEnded with origin `encounters:<id>` settle
 *     standing and plunder.
 */
import { CommandError } from '@sim/core/commands';
import type { CommandSchemas, Reactions, SimContext, SimModule } from '@sim/core/module';
import type { ArmyId, FleetId, GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { z } from 'zod';
import {
  composeEncounter,
  drawParty,
  enemyLord,
  fleetsInSight,
  hostileShores,
  landChance,
  localLord,
  merchantLord,
  nearbySettlements,
  pickLandKind,
  pickSeaKind,
  raiderHome,
  seaChance,
  sightRadius,
} from './generate';
import { handleResolveEncounter, raiseEncounter, settleFight, sliceOf } from './resolve';
import { armyMen, landParties, menTotal } from './rules';
import { ENCOUNTER_CHOICES, type EncounterChoice, type EncounterKind } from './types';
import './types';

export type * from './types';
export { encounterOptions, evadeChance, tollAcceptChance, catchChance, slipChance, winChance, sidePower, safeDefault } from './rules';
export { seaChance, landChance, zoneInfo, composeEncounter } from './generate';

const VERSION = 1;
const FIGHT_TIMEOUT_DAYS = 60;

/** The land party ashore from `fleetId`, if any. */
function partyAshore(state: GameState, fleetId: FleetId): ArmyId | undefined {
  const parties = landParties(state);
  for (const armyId of Object.keys(parties) as ArmyId[]) if (parties[armyId] === fleetId && state.armies[armyId]) return armyId;
  return undefined;
}

/** One day's roll for the player's expedition (sea or land). */
export function dailyEncounters(draft: GameState, ctx: SimContext): void {
  const slice = sliceOf(draft);
  const hour = ctx.hour;
  // Old fights whose battle never reported back.
  for (const id of Object.keys(slice.fights)) if ((slice.fights[id]?.hour ?? 0) + FIGHT_TIMEOUT_DAYS * HOURS_PER_DAY < hour) delete slice.fights[id];
  for (const id of Object.keys(slice.met)) if ((slice.met[id] ?? 0) <= hour) delete slice.met[id];
  const fleetId = draft.player.expeditionFleetId;
  if (fleetId === undefined || draft.pending !== null) return;
  const fleet = draft.fleets[fleetId];
  if (!fleet || fleet.ownerId !== draft.player.factionId) return;
  const t = ctx.tunables.encounters;
  const armyId = partyAshore(draft, fleetId);
  const key = armyId ?? fleetId;
  if ((slice.quietUntil[key] ?? -1) > hour) return;
  if (fleet.voyageDays < t.graceDays) return;
  const rng = ctx.rng('encounters');
  const quiet = () => {
    slice.quietUntil[key] = hour + t.minDaysBetween * HOURS_PER_DAY;
  };

  if (armyId !== undefined) {
    const army = draft.armies[armyId];
    if (!army) return;
    const men = armyMen(draft, armyId);
    if (men <= 0) return;
    const near = nearbySettlements(draft, army.pos, t.land.landRadius);
    const owner = near[0]?.factionId;
    if (!rng.chance(landChance(draft, ctx.content, army.route.length > 0, owner))) return;
    const lord = localLord(draft, near);
    const kind = pickLandKind(t, rng, lord);
    if (kind === null) return;
    const party = drawParty(draft, ctx.content, rng, kind, men, kind === 'landPatrol' ? lord : undefined);
    quiet();
    raiseEncounter(draft, ctx, composeEncounter(draft, ctx.content, { id: ctx.newId('enc'), kind, stage: 'sighted', fleetId, armyId, party, variant: rng.int(1, t.textVariants[kind]) }, ctx.env.effects));
    return;
  }

  // At sea: under way (a route ahead; coastal legs lie on a beach at night), not in harbour.
  if (fleet.route.length === 0 || fleet.mode === 'docked' || fleet.mode === 'landed') return;
  const ourMen = menTotal(fleet.men);
  const near = nearbySettlements(draft, fleet.pos, t.sea.shoreRadius);
  const shores = hostileShores(draft, t, near);
  const chance = seaChance(draft, ctx.content, fleet, shores.share);

  // A real fleet in sight (§8.6 visible encounters).
  const seen = fleetsInSight(draft, fleet, sightRadius(draft, ctx.content, fleet, chance.fog), slice.met, hour);
  for (const other of seen) {
    slice.met[other.id] = hour + t.realFleets.cooldownDays * HOURS_PER_DAY;
    if (!rng.chance(t.realFleets.chance)) continue;
    const intent = other.intent ?? 'trade';
    const kind: EncounterKind = Object.hasOwn(t.realFleets.kindByIntent, intent) ? (t.realFleets.kindByIntent[intent] as EncounterKind) : 'merchant';
    const party = drawParty(draft, ctx.content, rng, kind, ourMen, other.ownerId, other);
    quiet();
    const rationsOffered = Math.min(Math.max(0, Math.floor(other.rations)), rng.int(t.trade.rationsOffered[0], t.trade.rationsOffered[1]));
    raiseEncounter(draft, ctx, composeEncounter(draft, ctx.content, { id: ctx.newId('enc'), kind, stage: 'sighted', fleetId, party, variant: rng.int(1, t.textVariants[kind]), rationsOffered }, ctx.env.effects));
    return;
  }

  if (!rng.chance(chance.p)) return;
  const lords = {
    patrol: localLord(draft, near),
    enemy: enemyLord(draft, t, shores.hostile),
    raiders: raiderHome(draft, rng, near),
    merchant: merchantLord(draft, rng, near),
  };
  const kind = pickSeaKind(draft, t, rng, chance.zoneId, shores.share, lords);
  if (kind === null) return;
  const factionId = kind === 'patrol' ? lords.patrol : kind === 'warfleet' ? lords.enemy : kind === 'raiders' ? lords.raiders : lords.merchant;
  const party = drawParty(draft, ctx.content, rng, kind, ourMen, factionId);
  quiet();
  const rationsOffered = kind === 'merchant' ? rng.int(t.trade.rationsOffered[0], t.trade.rationsOffered[1]) : 0;
  raiseEncounter(draft, ctx, composeEncounter(draft, ctx.content, { id: ctx.newId('enc'), kind, stage: 'sighted', fleetId, party, variant: rng.int(1, t.textVariants[kind]), rationsOffered }, ctx.env.effects));
}

type Loose = Record<string, unknown>;

const REACTIONS: Record<string, (draft: GameState, e: Loose, ctx: SimContext) => void> = {
  SeaBattleEnded: (draft, e, ctx) => settleFight(draft, ctx, e),
  BattleEnded: (draft, e, ctx) => settleFight(draft, ctx, e),
  ExpeditionReturned(draft, e) {
    const fleetId = typeof e['fleetId'] === 'string' ? e['fleetId'] : undefined;
    const slice = sliceOf(draft);
    if (fleetId !== undefined && Object.hasOwn(slice.quietUntil, fleetId)) delete slice.quietUntil[fleetId];
  },
  PartyReturned(draft, e) {
    const armyId = typeof e['armyId'] === 'string' ? e['armyId'] : undefined;
    const slice = sliceOf(draft);
    if (armyId !== undefined && Object.hasOwn(slice.quietUntil, armyId)) delete slice.quietUntil[armyId];
  },
};

export const ENCOUNTERS_COMMAND_SCHEMAS: CommandSchemas = {
  resolveEncounter: z.object({ type: z.literal('resolveEncounter'), choice: z.enum(ENCOUNTER_CHOICES as unknown as [EncounterChoice, ...EncounterChoice[]]) }),
};

/** Encounters invariants: every pending encounter can be answered; bookkeeping is sane. */
export function encountersInvariants(state: GameState): string[] {
  const out: string[] = [];
  const slice = state.encounters;
  if (slice) {
    if (!(Number.isInteger(slice.count) && slice.count >= 0)) out.push(`encounters: count ${slice.count}`);
    for (const [k, h] of Object.entries(slice.quietUntil)) if (!Number.isFinite(h)) out.push(`encounters: quietUntil[${k}] = ${h}`);
    for (const [k, h] of Object.entries(slice.met)) if (!Number.isFinite(h)) out.push(`encounters: met[${k}] = ${h}`);
    for (const [k, f] of Object.entries(slice.fights)) if (!(f.plunderSilver >= 0)) out.push(`encounters: fight ${k} plunder ${f.plunderSilver}`);
  }
  for (const p of [state.pending, ...state.pendingQueue]) {
    if (!p || p.kind !== 'encounter' || p.payload.encounterId === undefined) continue;
    const choices = p.payload.choices ?? [];
    if (!choices.some((c) => c.disabled !== true)) out.push(`encounters: ${p.id} has no choice that can be taken`);
    for (const c of choices) if (c.command.type !== 'resolveEncounter') out.push(`encounters: ${p.id} choice ${c.id} dispatches ${c.command.type}`);
    if (typeof p.payload.titleKey !== 'string' || typeof p.payload.key !== 'string') out.push(`encounters: ${p.id} has no text`);
  }
  return out;
}

export const module: SimModule = {
  id: 'encounters',
  order: 30,
  version: VERSION,
  init(draft) {
    sliceOf(draft);
  },
  migrate(draft) {
    sliceOf(draft);
  },
  handlers: {
    resolveEncounter: (d, c, ctx) => {
      if (!ENCOUNTER_CHOICES.includes(c.choice)) throw new CommandError('unavailable', 'encounters.error.notAnOption');
      handleResolveEncounter(d, c, ctx);
    },
  },
  commandSchemas: ENCOUNTERS_COMMAND_SCHEMAS,
  systems: { daily: dailyEncounters },
  reactions: REACTIONS as unknown as Reactions,
  invariants: (state) => encountersInvariants(state),
};
