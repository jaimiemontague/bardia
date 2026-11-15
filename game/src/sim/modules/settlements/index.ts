/**
 * 'settlements' simulation module (scheduler order 45).
 * Scope: Arrival, settlement hub services, raids/assaults setup, aftermath, cargo, sieges, conquest (§9, §16, §31.20-31.21).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: resolveArrival, chooseAftermath, loadCargo, tavernAction
 *   pending kinds: arrival, aftermath
 *   events: SettlementFate
 * Module-owned additions: command leaveSettlement; events ArrivalResolved, SettlementEntered; state
 *   `settlementsState`; Settlement.tributaryOf/raidedHour/lastFate; condition fns insideSettlement, lastFate.
 * Effects used (owned elsewhere): battle startBattle; core changeRenown/Dread/Honor, changeOpinion, addSilver,
 *   addGoods; economy changeEconomy; people capture; military moveMen; news hearNews; intel observeSettlement;
 *   world revealSettlement — each skipped (or replaced by a direct write of this module's own fields) when absent.
 * Tunables: src/content/data/tunables/settlements.json (+ schemas/tunables/settlements.ts), read as ctx.tunables.settlements.
 * Strings/assets: src/content/locales/en/settlements.json and src/content/assets/manifest/settlements.json (prefix 'settlements.').
 * Gate: npm run verify:module -- settlements
 *
 * HOW IT WORKS
 *   - The player's fleet or war-band reaching a foreign settlement (world's Arrived) raises the Arrival Card
 *     (pending 'arrival') with every §9.5 option, greyed out with its reason when unavailable.
 *   - Raid and Assault start a battle through the battle module (its pre-battle decision follows). When the
 *     player wins: a raid scars the settlement and opens the Cargo window; an assault raises the Aftermath
 *     (pending 'aftermath', §16.3 fates with previews). Enter and Trade open the settlement hub.
 *   - Fates apply standing, relations, prosperity, devastation, captives, tribute or annexation, and emit
 *     SettlementFate (news and faith react).
 */
import type { Content } from '@content/index';
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import { getOrCreateRelation, getRelation } from '@sim/core/factory';
import type { CommandSchemas, ConditionFns, Reactions, SimContext, SimModule } from '@sim/core/module';
import type { ArmyId, BattleId, CharId, FactionId, Fleet, FleetId, GameState, GoodId, PendingDecision, Settlement, SettlementId } from '@sim/core/state';
import { HOURS_PER_YEAR } from '@sim/core/time';
import { z } from 'zod';
import {
  AFTERMATH_FATES,
  ARRIVAL_CHOICES,
  type AftermathFate,
  type ArrivalChoice,
  type DecisionChoice,
  type DecisionOption,
  type SettlementsState,
} from './types';
import './types';

export type * from './types';

const VERSION = 1;

function sliceOf(draft: GameState): SettlementsState {
  draft.settlementsState ??= { version: VERSION, battles: {} };
  draft.settlementsState.battles ??= {};
  return draft.settlementsState;
}

function menIn(state: GameState, fleetId: FleetId | undefined, armyId: ArmyId | undefined): number {
  let n = 0;
  if (fleetId !== undefined) for (const v of Object.values(state.fleets[fleetId]?.men ?? {})) n += Math.max(0, v);
  if (armyId !== undefined) for (const sq of state.armies[armyId]?.squads ?? []) n += Math.max(0, sq.men);
  return n;
}

function atWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return a !== b && getRelation(state, a, b)?.stance === 'war';
}

function hasMarket(content: Content, s: Settlement): boolean {
  return (content.balance.settlementTiers[s.tier] as { market?: boolean }).market === true || (s.buildings['market'] ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------
// Arrival (§9.5).

/** The Arrival Card's options for a party at a settlement (pure). */
export function arrivalOptions(state: GameState, content: Content, settlementId: SettlementId, fleetId?: FleetId, armyId?: ArmyId): DecisionOption<ArrivalChoice>[] {
  const s = state.settlements[settlementId];
  const player = state.player.factionId;
  if (!s) return [];
  const own = s.factionId === player;
  const war = atWar(state, player, s.factionId);
  const men = menIn(state, fleetId, armyId);
  const market = hasMarket(content, s);
  const opt = (id: ArrivalChoice, available: boolean, reason?: string): DecisionOption<ArrivalChoice> => ({ id, available, ...(available || reason === undefined ? {} : { reasonKey: `settlements.reason.${reason}` }) });
  return ARRIVAL_CHOICES.map((c) => {
    switch (c) {
      case 'enter':
        return opt(c, !war, 'atWar');
      case 'parley':
        return opt(c, !own, 'own');
      case 'trade':
        return opt(c, !war && market, war ? 'atWar' : 'noMarket');
      case 'raid':
      case 'assault':
        return opt(c, !own && men > 0, own ? 'own' : 'noMen');
      case 'besiege':
        return opt(c, false, s.fortTier < 1 ? 'noWalls' : 'siegeLater');
      default:
        return opt(c, true);
    }
  });
}

function arrivalChoices(options: readonly DecisionOption<ArrivalChoice>[]): DecisionChoice[] {
  return options.map((o) => ({
    id: o.id,
    labelKey: `settlements.arrival.${o.id}`,
    command: { type: 'resolveArrival', choice: o.id } as never,
    tone: o.id === 'raid' || o.id === 'assault' ? 'danger' : o.id === 'leave' ? 'secondary' : 'primary',
    ...(o.available ? {} : { disabled: true, ...(o.reasonKey !== undefined ? { previewKey: o.reasonKey } : {}) }),
  }));
}

function raiseArrival(draft: GameState, ctx: SimContext, settlementId: SettlementId, fleetId?: FleetId, armyId?: ArmyId): void {
  const s = draft.settlements[settlementId];
  if (!s) return;
  const options = arrivalOptions(draft, ctx.content, settlementId, fleetId, armyId);
  ctx.pend({
    kind: 'arrival',
    payload: {
      settlementId,
      ...(fleetId !== undefined ? { fleetId } : {}),
      ...(armyId !== undefined ? { armyId } : {}),
      options,
      choices: arrivalChoices(options),
      own: s.factionId === draft.player.factionId,
    },
  });
}

function pendingOf(draft: GameState, kind: 'arrival' | 'aftermath'): PendingDecision | null {
  const p = draft.pending;
  return p && p.kind === kind ? p : null;
}

function handleResolveArrival(draft: GameState, cmd: { choice: ArrivalChoice }, ctx: SimContext): void {
  const p = pendingOf(draft, 'arrival');
  if (!p) throw new CommandError('noArrival', 'settlements.error.noArrival');
  const payload = p.payload as { settlementId: SettlementId; fleetId?: FleetId; armyId?: ArmyId };
  const s = draft.settlements[payload.settlementId];
  if (!s) throw new CommandError('noArrival', 'settlements.error.noArrival');
  const option = arrivalOptions(draft, ctx.content, payload.settlementId, payload.fleetId, payload.armyId).find((o) => o.id === cmd.choice);
  if (!option?.available) throw new CommandError('unavailable', option?.reasonKey ?? 'settlements.error.unavailable');
  const slice = sliceOf(draft);
  ctx.resolvePending(p.id);
  ctx.emit({ type: 'ArrivalResolved', settlementId: s.id, choice: cmd.choice });
  switch (cmd.choice) {
    case 'enter':
    case 'trade': {
      slice.inside = s.id;
      if (ctx.env.effects.has('revealSettlement')) ctx.applyEffects([{ op: 'revealSettlement', settlementId: s.id, visit: true } as never]);
      ctx.emit({ type: 'SettlementEntered', settlementId: s.id });
      break;
    }
    case 'parley': {
      // The leader meets you at the shore: news of the place and what anyone can see of it (§9.5).
      if (ctx.env.effects.has('hearNews')) ctx.applyEffects([{ op: 'hearNews', settlementId: s.id, via: 'envoy' } as never]);
      if (ctx.env.effects.has('observeSettlement')) ctx.applyEffects([{ op: 'observeSettlement', settlementId: s.id, source: 'envoy', keys: ['leader', 'wars', 'fortTier'] } as never]);
      ctx.notify('settlements.notify.parley', { priority: 'normal', vars: { settlement: s.name, leader: draft.characters[s.leaderId]?.name ?? '' }, link: { kind: 'settlement', id: s.id } });
      break;
    }
    case 'raid':
    case 'assault':
      startAttack(draft, ctx, s, cmd.choice, payload.fleetId, payload.armyId);
      break;
    default:
      break;
  }
}

/**
 * The baggage of a war-band on the march (expeditions' land expedition: a shipless fleet record, `overland`, whose
 * land party the army is; contract in ARCHITECTURE §19). Its plunder rides there, within the war-band's carry.
 */
function marchBaggage(state: GameState, armyId: ArmyId | undefined): FleetId | undefined {
  if (armyId === undefined) return undefined;
  const parties = (state as GameState & { expeditions?: { landParties?: Record<string, FleetId> } }).expeditions?.landParties ?? {};
  const fid = Object.hasOwn(parties, armyId) ? parties[armyId] : undefined;
  const f = fid !== undefined ? state.fleets[fid] : undefined;
  return f && (f as { overland?: unknown }).overland !== undefined ? fid : undefined;
}

/** The war-band of a march whose baggage is `fleetId` (the reverse of `marchBaggage`), if any. */
function marchBand(state: GameState, fleetId: FleetId | undefined): ArmyId | undefined {
  const f = fleetId !== undefined ? state.fleets[fleetId] : undefined;
  if (!f || (f as { overland?: unknown }).overland === undefined) return undefined;
  const parties = (state as GameState & { expeditions?: { landParties?: Record<string, FleetId> } }).expeditions?.landParties ?? {};
  for (const armyId of Object.keys(parties) as ArmyId[]) if (parties[armyId] === fleetId && state.armies[armyId]) return armyId;
  return undefined;
}

/** Men by unit of the party that would hold a town: the fleet's crews, or on a march its war-band. */
function holdersOf(state: GameState, fleetId: FleetId | undefined): Record<string, number> {
  const band = marchBand(state, fleetId);
  if (band === undefined) return { ...(fleetId !== undefined ? (state.fleets[fleetId]?.men ?? {}) : {}) };
  const out: Record<string, number> = {};
  for (const sq of state.armies[band]?.squads ?? []) if (sq.men > 0) out[sq.unit] = (out[sq.unit] ?? 0) + sq.men;
  return out;
}

function startAttack(draft: GameState, ctx: SimContext, s: Settlement, approach: 'raid' | 'assault', fleetId?: FleetId, armyId?: ArmyId): void {
  if (!ctx.env.effects.has('startBattle')) throw new CommandError('noBattles', 'settlements.error.noBattles');
  const player = draft.player.factionId;
  const attacker: Record<string, unknown> = { factionId: player, isPlayer: true };
  if (armyId !== undefined) attacker['armyId'] = armyId;
  else if (fleetId !== undefined) attacker['fleetId'] = fleetId;
  // A war-band on the march carries its plunder in its baggage, and came overland (no beach, no ships).
  const baggage = fleetId === undefined ? marchBaggage(draft, armyId) : undefined;
  if (baggage !== undefined) attacker['fleetId'] = baggage;
  ctx.applyEffects([
    {
      op: 'startBattle',
      kind: approach,
      attacker,
      defender: { factionId: s.factionId, settlementId: s.id },
      settlementId: s.id,
      origin: 'settlements',
      ...(baggage !== undefined ? { coastal: false } : {}),
    } as never,
  ]);
  const slot = draft.subsims.battle;
  const loot = fleetId ?? baggage;
  if (slot && slot.status !== 'resolved') {
    sliceOf(draft).battles[slot.id as BattleId] = { settlementId: s.id, approach, ...(loot !== undefined ? { fleetId: loot } : {}), ...(armyId !== undefined ? { armyId } : {}) };
  }
}

// ---------------------------------------------------------------------------------------------
// After the battle.

type Loose = Record<string, unknown>;

function onBattleEnded(draft: GameState, e: Loose, ctx: SimContext): void {
  const battleId = typeof e['battleId'] === 'string' ? (e['battleId'] as BattleId) : undefined;
  const slice = sliceOf(draft);
  if (battleId === undefined || !Object.hasOwn(slice.battles, battleId)) return;
  const rec = slice.battles[battleId] as SettlementsState['battles'][BattleId];
  delete slice.battles[battleId];
  const result = e['result'] as { winner?: string } | undefined;
  const playerSide = e['playerSide'];
  const s = draft.settlements[rec.settlementId];
  if (!s) return;
  if (result?.winner !== playerSide || playerSide === undefined) {
    ctx.notify('settlements.notify.repulsed', { priority: 'high', vars: { settlement: s.name }, link: { kind: 'settlement', id: s.id } });
    return;
  }
  if (rec.approach === 'raid') {
    applyFate(draft, ctx, s, 'raid', rec.fleetId, s.factionId);
    return;
  }
  const options = aftermathOptions(draft, ctx.content, s.id, rec.fleetId);
  ctx.pend({
    kind: 'aftermath',
    payload: {
      settlementId: s.id,
      battleId,
      approach: rec.approach,
      options,
      choices: options.map((o) => ({
        id: o.id,
        labelKey: `settlements.fate.${o.id}`,
        command: { type: 'chooseAftermath', fate: o.id } as never,
        tone: o.id === 'sackAndBurn' ? 'danger' : 'primary',
        ...(o.available ? {} : { disabled: true, ...(o.reasonKey !== undefined ? { previewKey: o.reasonKey } : {}) }),
      })),
    },
  });
}

/** Characters aboard a fleet who could govern a conquered town (lieutenants and kin, not the ruler). */
export function governorCandidates(state: GameState, fleetId: FleetId | undefined): CharId[] {
  const f = fleetId !== undefined ? state.fleets[fleetId] : undefined;
  if (!f) return [];
  const out: CharId[] = [];
  for (const id of [f.leaderId, ...f.lieutenantIds]) {
    const c = state.characters[id];
    if (!c?.alive || id === state.player.rulerId || c.location.kind === 'captive') continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The Aftermath screen's options with previews (pure). */
export function aftermathOptions(state: GameState, content: Content, settlementId: SettlementId, fleetId?: FleetId): DecisionOption<AftermathFate>[] {
  const t = content.tunables.settlements;
  const s = state.settlements[settlementId];
  if (!s) return [];
  const sameCulture = state.factions[state.player.factionId]?.culture === s.culture;
  const governors = governorCandidates(state, fleetId);
  const minGarrison = Math.max(t.annex.minGarrison, Math.ceil(s.pop * t.annex.popShare));
  // On a march the war-band holds the town (the baggage fleet carries no men).
  const men = menIn(state, fleetId, marchBand(state, fleetId));
  return AFTERMATH_FATES.map((fate) => {
    const f = t.fates[fate];
    const preview: Record<string, number> = {
      renown: f.renown,
      dread: f.dread,
      honor: f.honor + (sameCulture ? f.honorSameCulture : 0),
      opinion: f.ownerOpinion,
      silver: Math.round(s.silver * f.lootShare[0]),
    };
    if (fate === 'annex') {
      if (governors.length === 0) return { id: fate, available: false, reasonKey: 'settlements.reason.noGovernor', preview };
      if (men < minGarrison) return { id: fate, available: false, reasonKey: 'settlements.reason.tooFewToHold', preview: { ...preview, garrison: minGarrison } };
      return { id: fate, available: true, preview: { ...preview, garrison: minGarrison } };
    }
    if (fate === 'liberate') return { id: fate, available: false, reasonKey: 'settlements.reason.noAlly', preview };
    if (fate === 'takeCaptives' && !state.characters[s.leaderId]?.alive) return { id: fate, available: false, reasonKey: 'settlements.reason.noNotables', preview };
    return { id: fate, available: true, preview };
  });
}

function handleChooseAftermath(draft: GameState, cmd: { fate: AftermathFate; governorId?: CharId; garrison?: Record<string, number> }, ctx: SimContext): void {
  const p = pendingOf(draft, 'aftermath');
  if (!p) throw new CommandError('noAftermath', 'settlements.error.noAftermath');
  const settlementId = (p.payload as { settlementId: SettlementId }).settlementId;
  const s = draft.settlements[settlementId];
  if (!s) throw new CommandError('noAftermath', 'settlements.error.noAftermath');
  const fleetId = draft.player.expeditionFleetId;
  const option = aftermathOptions(draft, ctx.content, settlementId, fleetId).find((o) => o.id === cmd.fate);
  if (!option?.available) throw new CommandError('unavailable', option?.reasonKey ?? 'settlements.error.unavailable');
  ctx.resolvePending(p.id);
  const owner = s.factionId;
  if (cmd.fate === 'annex') annex(draft, ctx, s, fleetId, cmd.governorId, cmd.garrison);
  applyFate(draft, ctx, s, cmd.fate, fleetId, owner);
}

/**
 * Applies a fate's standing, relations, prosperity, devastation and loot; emits SettlementFate.
 * `owner` is the settlement's lord before the fate (an annexation has already moved it to the player).
 */
function applyFate(draft: GameState, ctx: SimContext, s: Settlement, fate: AftermathFate | 'raid', fleetId: FleetId | undefined, owner: FactionId): void {
  const t = ctx.tunables.settlements;
  const f = t.fates[fate];
  const player = draft.player.factionId;
  const rng = ctx.rng('settlements');
  const sameCulture = draft.factions[player]?.culture === s.culture;
  const effects: Record<string, unknown>[] = [];
  if (f.renown !== 0) effects.push({ op: 'changeRenown', amount: f.renown });
  if (f.dread !== 0) effects.push({ op: 'changeDread', amount: f.dread });
  const honor = f.honor + (sameCulture ? f.honorSameCulture : 0);
  if (honor !== 0) effects.push({ op: 'changeHonor', amount: honor });
  const raid = fate === 'raid';
  const decay = raid ? ctx.balance.diplomacy.opinionModifiers.recentRaidDecay : 1;
  const reason = raid ? 'recentRaid' : `fate.${fate}`;
  if (f.ownerOpinion !== 0 && owner !== player) effects.push({ op: 'changeOpinion', a: owner, b: player, amount: f.ownerOpinion, reason, decayPerMonth: decay });
  if (f.neighbourOpinion !== 0) {
    const neighbours: FactionId[] = [];
    for (const sid of draft.provinces[s.provinceId]?.settlementIds ?? []) {
      const o = draft.settlements[sid]?.factionId;
      if (o !== undefined && o !== player && o !== owner && !neighbours.includes(o)) neighbours.push(o);
    }
    for (const n of neighbours) effects.push({ op: 'changeOpinion', a: n, b: player, amount: f.neighbourOpinion, reason, decayPerMonth: 1 });
  }
  // The kin of a leader carried off remember it (§16.3 Take captives).
  if (f.kinOpinion !== 0) {
    const fam = draft.characters[s.leaderId]?.family;
    const kin = fam ? [fam.fatherId, fam.motherId, ...fam.spouseIds, ...fam.childIds] : [];
    for (const id of kin) if (id !== undefined && draft.characters[id]?.alive) effects.push({ op: 'changeOpinion', a: id, b: player, amount: f.kinOpinion, reason, decayPerMonth: 1 });
  }
  // Loot beyond what the battle carried off: hidden hoards, an offering, a tribute lump.
  const share = f.lootShare[0] === f.lootShare[1] ? f.lootShare[0] : rng.range(f.lootShare[0], f.lootShare[1]);
  if (share > 0 && s.silver > 0) {
    const silver = Math.floor(s.silver * share);
    if (silver > 0) {
      effects.push({ op: 'addSilver', amount: -silver, settlementId: s.id });
      effects.push(fleetId !== undefined && draft.fleets[fleetId] ? { op: 'addSilver', amount: silver, fleetId } : { op: 'addSilver', amount: silver });
    }
  }
  ctx.applyEffects(effects as never);
  // Prosperity, people and devastation.
  if ((f.economy !== undefined || f.economySteps !== 0) && ctx.env.effects.has('changeEconomy')) {
    ctx.applyEffects([{ op: 'changeEconomy', settlementId: s.id, ...(f.economy !== undefined ? { set: f.economy } : { steps: f.economySteps }), reason: fate } as never]);
  }
  if (f.popLoss[1] > 0) {
    const loss = rng.range(f.popLoss[0], f.popLoss[1]);
    s.pop = Math.max(0, Math.round(s.pop * (1 - loss)));
  }
  if (f.devastationYears[1] > 0) {
    const years = rng.range(f.devastationYears[0], f.devastationYears[1]);
    s.devastationUntil = Math.max(s.devastationUntil ?? 0, ctx.hour + Math.round(years * HOURS_PER_YEAR));
  }
  // Captives: the settlement's leader (§16.5).
  if (fate === 'takeCaptives' && ctx.env.effects.has('capture')) {
    const leader = draft.characters[s.leaderId];
    if (leader?.alive && leader.location.kind !== 'captive') ctx.applyEffects([{ op: 'capture', charId: leader.id, byFactionId: player, cause: 'aftermath' } as never]);
  }
  if (fate === 'makeTributary') s.tributaryOf = player;
  s.raidedHour = ctx.hour;
  s.lastFate = { fate, hour: ctx.hour, byFactionId: player };
  (s.deeds ??= []).push({ kind: raid ? 'raid' : fate, by: player, hour: ctx.hour, weight: Math.max(1, Math.abs(f.ownerOpinion) / 10) });
  if (s.deeds.length > 12) s.deeds.splice(0, s.deeds.length - 12);
  if (f.cargo && fleetId !== undefined && draft.fleets[fleetId]) sliceOf(draft).loot = { settlementId: s.id, fleetId, untilHour: ctx.hour + t.lootWindowHours };
  ctx.emit({
    type: 'SettlementFate',
    settlementId: s.id,
    fate,
    ...(owner !== s.factionId ? { previousFactionId: owner } : {}),
    ...(s.tier === 'cloister' ? { clergy: true } : {}),
  });
  ctx.notify(`settlements.notify.fate.${fate}`, { priority: 'normal', vars: { settlement: s.name }, link: { kind: 'settlement', id: s.id } });
}

/** Annexation: the settlement becomes a holding of the house with a governor and a garrison from the fleet (§16.3). */
function annex(draft: GameState, ctx: SimContext, s: Settlement, fleetId: FleetId | undefined, governorId: CharId | undefined, garrison: Record<string, number> | undefined): void {
  const t = ctx.tunables.settlements.annex;
  const player = draft.player.factionId;
  const candidates = governorCandidates(draft, fleetId);
  const gov = governorId ?? candidates[0];
  if (gov === undefined || !candidates.includes(gov)) throw new CommandError('noGovernor', 'settlements.reason.noGovernor');
  const fleet = fleetId !== undefined ? draft.fleets[fleetId] : undefined;
  if (!fleet) throw new CommandError('noFleet', 'settlements.error.noFleet');
  const min = Math.max(t.minGarrison, Math.ceil(s.pop * t.popShare));
  // The men who can stay: the fleet's crews, or on a march its war-band.
  const band = marchBand(draft, fleet.id);
  const pool = holdersOf(draft, fleet.id);
  // Men to hold the town: as given, else the cheapest men of the party up to the minimum.
  let men: Record<string, number> = {};
  if (garrison) men = { ...garrison };
  else {
    let need = min;
    for (const u of Object.keys(pool).sort((a, b) => (ctx.balance.units[a]?.wage ?? 0) - (ctx.balance.units[b]?.wage ?? 0) || (a < b ? -1 : 1))) {
      if (need <= 0) break;
      const take = Math.min(need, pool[u] ?? 0);
      if (take > 0) men[u] = take;
      need -= take;
    }
  }
  let total = 0;
  for (const [u, n] of Object.entries(men)) {
    if (n > (pool[u] ?? 0)) throw new CommandError('notEnoughMen', 'settlements.reason.tooFewToHold');
    total += n;
  }
  if (total < min) throw new CommandError('tooFewToHold', 'settlements.reason.tooFewToHold');
  const previous = s.factionId;
  const prevFaction = draft.factions[previous];
  if (prevFaction) prevFaction.holdingIds = prevFaction.holdingIds.filter((id) => id !== s.id);
  s.factionId = player;
  const mine = draft.factions[player];
  if (mine && !mine.holdingIds.includes(s.id)) mine.holdingIds.push(s.id);
  // The defeated garrison disperses; the conquerors take its place.
  s.garrison = {};
  if (band !== undefined) {
    if (!ctx.env.effects.has('moveMen')) throw new CommandError('noFleet', 'settlements.error.noFleet');
    ctx.applyEffects([{ op: 'moveMen', from: { armyId: band }, to: { settlementId: s.id }, men } as never]);
  } else if (ctx.env.effects.has('moveMen')) ctx.applyEffects([{ op: 'moveMen', from: { fleetId: fleet.id }, to: { settlementId: s.id }, men } as never]);
  else
    for (const [u, n] of Object.entries(men)) {
      fleet.men[u] = (fleet.men[u] ?? 0) - n;
      s.garrison[u] = n;
    }
  const governor = draft.characters[gov];
  let loyalty = t.startLoyalty;
  if (governor && (governor.culture !== s.culture || governor.faith !== s.faith)) loyalty += t.foreignGovernorLoyalty;
  s.holding = {
    governorId: gov,
    tax: 'fair',
    loyalty: clamp(loyalty, 0, 100),
    foodMonths: 3,
    pool: { max: 0, current: 0, veterans: {} },
    buildQueue: [],
    shipQueue: [],
    garrisonTarget: min,
  };
  if (governor) {
    governor.location = { kind: 'settlement', id: s.id };
    governor.role = { kind: 'governor', holdingId: s.id, factionId: player };
    fleet.lieutenantIds = fleet.lieutenantIds.filter((id) => id !== gov);
    if (fleet.leaderId === gov) fleet.leaderId = (fleet.lieutenantIds[0] ?? draft.player.rulerId) as CharId;
  }
  // The old lord's leader stays as a local notable.
  s.leaderId = gov;
  // Taking a town by force is war with its former lord (diplomacy owns stances; until it records one, write it).
  if (previous !== player) {
    const rel = getOrCreateRelation(draft, previous, player);
    if (rel.stance !== 'war') {
      rel.stance = 'war';
      rel.warSinceHour = ctx.hour;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cargo (§16.2) and the hub.

function handleLoadCargo(draft: GameState, cmd: { take?: Partial<Record<GoodId, number>>; burn?: Partial<Record<GoodId, number>>; givePoor?: Partial<Record<GoodId, number>> }, ctx: SimContext): void {
  const t = ctx.tunables.settlements;
  const loot = sliceOf(draft).loot;
  if (!loot || loot.untilHour < ctx.hour) throw new CommandError('noLoot', 'settlements.error.noLoot');
  const fleet = draft.fleets[loot.fleetId];
  const market = draft.markets[loot.settlementId];
  if (!fleet || !market) throw new CommandError('noLoot', 'settlements.error.noLoot');
  let capacity = 0;
  for (const id of fleet.shipIds) capacity += ctx.balance.ships[draft.ships[id]?.type ?? 'snekkja']?.cargoT ?? 0;
  // A war-band on the march carries what its men can (expeditions keeps `overland.carryT`).
  capacity += Math.max(0, (fleet as { overland?: { carryT?: number } }).overland?.carryT ?? 0);
  let used = fleet.rations / ctx.balance.economy.rationsPerTon;
  for (const [g, v] of Object.entries(fleet.cargo)) if (g !== 'rations') used += Math.max(0, v ?? 0);
  const takeFrom = (good: GoodId, tons: number): number => {
    const have = market.stock[good] ?? 0;
    const n = Math.max(0, Math.min(tons, have));
    if (n > 0) market.stock[good] = Math.round((have - n) * 1000) / 1000;
    return n;
  };
  for (const [good, tons] of Object.entries(cmd.take ?? {}) as [GoodId, number][]) {
    if (!(tons > 0)) continue;
    const room = Math.max(0, capacity - used);
    if (tons > room + 1e-9) throw new CommandError('holdFull', 'settlements.error.holdFull');
    const n = takeFrom(good, tons);
    if (good === 'rations') fleet.rations += Math.round(n * ctx.balance.economy.rationsPerTon);
    else fleet.cargo[good] = Math.round(((fleet.cargo[good] ?? 0) + n) * 1000) / 1000;
    used += n;
  }
  let burned = 0;
  for (const [good, tons] of Object.entries(cmd.burn ?? {}) as [GoodId, number][]) if (tons > 0) burned += takeFrom(good, tons);
  let given = 0;
  for (const [good, tons] of Object.entries(cmd.givePoor ?? {}) as [GoodId, number][]) if (tons > 0) given += takeFrom(good, tons);
  const effects: Record<string, unknown>[] = [];
  if (burned > 0) effects.push({ op: 'changeDread', amount: t.cargo.burnDread });
  if (given > 0) effects.push({ op: 'changeHonor', amount: t.cargo.givePoorHonor }, { op: 'changeRenown', amount: t.cargo.givePoorRenown });
  if (effects.length > 0) ctx.applyEffects(effects as never);
}

function playerAt(state: GameState, settlementId: SettlementId, radius: number): boolean {
  const s = state.settlements[settlementId];
  if (!s) return false;
  const near = (p: { x: number; y: number }) => (p.x - s.mapPos.x) ** 2 + (p.y - s.mapPos.y) ** 2 <= radius * radius;
  const ruler = state.characters[state.player.rulerId];
  if (ruler?.location.kind === 'settlement' && ruler.location.id === settlementId) return true;
  const exp = state.player.expeditionFleetId;
  const f = exp !== undefined ? state.fleets[exp] : undefined;
  return f !== undefined && f.mode !== 'sailing' && near(f.pos);
}

function handleTavern(draft: GameState, cmd: { settlementId: SettlementId; action: 'anyNews' | 'travellers' | 'drink' | 'buyRound' }, ctx: SimContext): void {
  const t = ctx.tunables.settlements;
  const s = draft.settlements[cmd.settlementId];
  if (!s) throw new CommandError('unknownSettlement', 'settlements.error.unknownSettlement');
  const home = s.factionId === draft.player.factionId;
  if (!home && sliceOf(draft).inside !== s.id) throw new CommandError('notInside', 'settlements.error.notInside');
  if (!playerAt(draft, s.id, t.presenceRadius)) throw new CommandError('notThere', 'settlements.error.notThere');
  const fleet = draft.player.expeditionFleetId !== undefined ? draft.fleets[draft.player.expeditionFleetId] : undefined;
  const pay = (cost: number) => {
    if (cost <= 0) return;
    if (fleet && fleet.silver >= cost && !home) ctx.applyEffects([{ op: 'addSilver', amount: -cost, fleetId: fleet.id } as never]);
    else if ((draft.factions[draft.player.factionId]?.treasury ?? 0) >= cost) ctx.applyEffects([{ op: 'addSilver', amount: -cost } as never]);
    else throw new CommandError('notEnoughSilver', 'settlements.error.notEnoughSilver');
  };
  switch (cmd.action) {
    case 'anyNews':
      if (ctx.env.effects.has('hearNews')) ctx.applyEffects([{ op: 'hearNews', settlementId: s.id, via: 'keeper' } as never]);
      break;
    case 'travellers': {
      if (!ctx.env.effects.has('observeSettlement')) break;
      const lanes = (draft as GameState & { worldIndex?: { settlements: Record<string, { lanes: { to: SettlementId }[] }> } }).worldIndex?.settlements[s.id]?.lanes ?? [];
      const rng = ctx.rng('settlements:tavern');
      const n = Math.min(lanes.length, rng.int(t.tavern.travellersFacts[0], t.tavern.travellersFacts[1]));
      const picks = rng.shuffle(lanes.map((l) => l.to)).slice(0, n);
      for (const to of picks) if (draft.settlements[to]) ctx.applyEffects([{ op: 'observeSettlement', settlementId: to, source: 'server' } as never]);
      break;
    }
    case 'drink': {
      // §20.2: a cup by the fire, and now and then an overheard rumour. At home the hall's news reaches the
      // house by messenger anyway, so the client offers the drink only abroad.
      pay(t.tavern.drinkCost);
      if (ctx.env.effects.has('hearNews') && ctx.rng('settlements:tavern').chance(t.tavern.drinkRumourChance)) {
        ctx.applyEffects([{ op: 'hearNews', settlementId: s.id, via: 'keeper', maxItems: 1 } as never]);
      }
      break;
    }
    case 'buyRound': {
      pay(t.tavern.roundCost[s.tier] ?? 20);
      const rng = ctx.rng('settlements:tavern');
      ctx.applyEffects([{ op: 'changeRenown', amount: rng.int(t.tavern.roundRenown[0], t.tavern.roundRenown[1]) } as never]);
      if (home && s.holding) ctx.applyEffects([{ op: 'changeLoyalty', settlementId: s.id, amount: t.tavern.roundLoyaltyAtHome } as never]);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reactions.

const REACTIONS: Record<string, (draft: GameState, e: Loose, ctx: SimContext) => void> = {
  Arrived(draft, e, ctx) {
    const settlementId = typeof e['settlementId'] === 'string' ? (e['settlementId'] as SettlementId) : undefined;
    if (settlementId === undefined || e['factionId'] !== draft.player.factionId) return;
    const fleetId = typeof e['fleetId'] === 'string' ? (e['fleetId'] as FleetId) : undefined;
    const armyId = typeof e['armyId'] === 'string' ? (e['armyId'] as ArmyId) : undefined;
    // A fleet that stood down at home (expeditions) is gone: no card.
    if (fleetId !== undefined && !draft.fleets[fleetId]) return;
    if (armyId !== undefined && !draft.armies[armyId]) return;
    const s = draft.settlements[settlementId];
    if (!s || s.factionId === draft.player.factionId) return;
    const slice = sliceOf(draft);
    if (slice.inside !== undefined) delete slice.inside;
    if (slice.loot && slice.loot.settlementId !== settlementId) delete slice.loot;
    raiseArrival(draft, ctx, settlementId, fleetId, armyId);
  },
  BattleEnded: onBattleEnded,
  ExpeditionReturned(draft) {
    const slice = sliceOf(draft);
    delete slice.inside;
    delete slice.loot;
  },
};

// ---------------------------------------------------------------------------------------------

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const goods = z.record(z.string().min(1), z.number().finite().min(0));

export const SETTLEMENTS_COMMAND_SCHEMAS: CommandSchemas = {
  resolveArrival: z.object({ type: z.literal('resolveArrival'), choice: z.enum(ARRIVAL_CHOICES as unknown as [ArrivalChoice, ...ArrivalChoice[]]) }),
  chooseAftermath: z.object({
    type: z.literal('chooseAftermath'),
    fate: z.enum(AFTERMATH_FATES as unknown as [AftermathFate, ...AftermathFate[]]),
    governorId: prefixed('chr').optional(),
    garrison: z.record(z.string().min(1), z.number().int().min(0)).optional(),
  }),
  loadCargo: z.object({ type: z.literal('loadCargo'), take: goods.optional(), burn: goods.optional(), givePoor: goods.optional() }),
  tavernAction: z.object({ type: z.literal('tavernAction'), settlementId: prefixed('set'), action: z.enum(['anyNews', 'travellers', 'drink', 'buyRound']) }),
  leaveSettlement: z.object({ type: z.literal('leaveSettlement') }),
};

export const SETTLEMENTS_CONDITION_FNS: ConditionFns = {
  /** insideSettlement(): the player is in a settlement's hub. */
  insideSettlement: { args: z.tuple([]), returns: 'boolean', evaluate: (_a, ctx) => ctx.state.settlementsState?.inside !== undefined },
  /** lastFate(settlement?): the last §16.3 fate it met ('' if none). */
  lastFate: {
    args: z.union([z.tuple([]), z.tuple([z.string()])]),
    returns: 'string',
    evaluate: (args, ctx) => {
      const id = typeof args[0] === 'string' ? args[0] : Object.hasOwn(ctx.scope, 'settlement') ? ctx.scope['settlement'] : undefined;
      return id !== undefined ? (ctx.state.settlements[id as SettlementId]?.lastFate?.fate ?? '') : '';
    },
  },
};

export function settlementsInvariants(state: GameState): string[] {
  const out: string[] = [];
  const slice = state.settlementsState;
  if (slice?.inside !== undefined && !state.settlements[slice.inside]) out.push(`settlements: inside unknown ${slice.inside}`);
  for (const s of Object.values(state.settlements)) {
    if (s.tributaryOf !== undefined && !state.factions[s.tributaryOf]) out.push(`settlement ${s.id}: tributary of unknown ${s.tributaryOf}`);
    if (s.tributaryOf === s.factionId && s.tributaryOf !== undefined) out.push(`settlement ${s.id}: tributary of its own lord`);
    if (!(s.pop >= 0)) out.push(`settlement ${s.id}: pop ${s.pop}`);
  }
  return out;
}

export const module: SimModule = {
  id: 'settlements',
  order: 45,
  version: VERSION,
  init(draft) {
    sliceOf(draft);
  },
  migrate(draft) {
    sliceOf(draft);
  },
  handlers: {
    resolveArrival: (d, c, ctx) => handleResolveArrival(d, c, ctx),
    chooseAftermath: (d, c, ctx) => handleChooseAftermath(d, c, ctx),
    loadCargo: (d, c, ctx) => handleLoadCargo(d, c, ctx),
    tavernAction: (d, c, ctx) => handleTavern(d, c, ctx),
    leaveSettlement: (d) => {
      // Leaving ends the visit and any plunder still lying about (the Cargo screen's "Done").
      const slice = sliceOf(d);
      delete slice.inside;
      delete slice.loot;
    },
  },
  commandSchemas: SETTLEMENTS_COMMAND_SCHEMAS,
  systems: {
    daily(draft) {
      const slice = sliceOf(draft);
      if (slice.loot && slice.loot.untilHour < draft.time.hour) delete slice.loot;
    },
  },
  reactions: REACTIONS as unknown as Reactions,
  conditionFns: SETTLEMENTS_CONDITION_FNS,
  invariants: (state) => settlementsInvariants(state),
};

/** Fleet type used by the client (re-export convenience). */
export type { Fleet };
